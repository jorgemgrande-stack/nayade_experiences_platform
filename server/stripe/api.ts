/**
 * Stripe Billing en el plano de control (`/cp/v1/stripe/*`), en modo pruebas o live, y solo operadores.
 *
 *   GET  /stripe/status                         ops:read      configuración (sin secretos) y catálogo enlazado
 *   GET  /stripe/catalog/plan                   ops:read      escrituras que FALTAN en Stripe (las ejecuta una persona)
 *   POST /stripe/catalog/sync                   orders:write  enlaza los Prices que ya existen (solo lectura en Stripe)
 *   GET  /stripe/catalog/yearly-proposals       ops:read      propuesta anual = 10 × mensual aprobado (no crea nada)
 *   POST /stripe/orders/:id/checkout            orders:write  abre o reutiliza la Checkout Session del pedido (*)
 *   POST /stripe/orders/:id/checkout/expire     orders:write  cierra la sesión abierta del pedido
 *   POST /stripe/checkout/:sessionId/sync       orders:write  relee sesión y suscripción (no confirma nada)
 *   GET  /stripe/events                         ops:read      eventos por estado (pendientes, fallidos…)
 *   POST /stripe/events/:id/retry               orders:write  reprograma ya un evento fallido
 *   POST /stripe/reconcile                      orders:write  conciliación manual (la misma que la periódica)
 *   GET  /stripe/adjustments                    ops:read      reembolsos y disputas registrados (retenciones)
 *   POST /stripe/adjustments/:chargeId/resolve  orders:write  levanta una retención con motivo y reaplica el estado
 *   GET  /stripe/orders/:id/buyer               orders:read   perfil fiscal del comprador (tipo, territorio, escenario)
 *   PUT  /stripe/orders/:id/buyer               orders:write  registra el perfil y el consentimiento (venta asistida)
 *   GET  /stripe/portal/plan                    ops:read      Customer Portal: configuración deseada frente a la actual (solo lectura)
 *   GET  /stripe/invoices?orderId=              ops:read      facturas cobradas registradas (base, impuesto, total, reembolsado)
 *   GET  /stripe/fiscal-documents?status=       ops:read      cola de documentos fiscales (facturas y rectificativas)
 *   POST /stripe/fiscal-documents/:id/issued    orders:write  registra el número del documento emitido en el sistema legal
 *
 * El webhook (`POST /cp/v1/stripe/webhook`) no usa token: se autentica por firma y se monta aparte, antes
 * del analizador JSON global (server/stripe/webhook.ts).
 *
 * (*) Además exige CP_STRIPE_CHECKOUT_ENABLED=1 y las URL de vuelta; si no, 409 `checkout_disabled`.
 * No hay ninguna ruta pública: el registro público sigue cerrado. El Customer Portal no se expone
 * hasta que sus cambios se sincronicen con webhooks (Fase C/E).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CatalogPort } from "../subscriptions/ports";
import { StripeCatalogError, desiredCatalog, planCatalogWrites, syncCatalog, type SkippedProduct } from "./catalog";
import { StripeCheckoutError, type StripeCheckoutService } from "./checkout";
import type { OrderStore } from "../orchestrator/store";
import { BuyerProfileError, FISCAL_SCENARIOS, buildConsent, buyerProfileInput, consentInput, toBuyerProfile, type ConsentVersions, type FiscalScenario, type TaxTreatment } from "./buyerProfile";
import { checkoutBlockedReason, describeStripeConfig, type StripeConfig } from "./config";
import { describeIssuer } from "./issuer";
import { proposeYearlyPrices } from "./multipart";
import { sessionIdRe } from "./status";
import { StripeGatewayError, type StripeGateway } from "./gateway";
import { FiscalDocumentConflictError, StripeStoreError, type StripeStore } from "./store";
import { EXTERNAL_REF } from "./fiscalDocuments";
import { planPortal, portalWriteParams } from "./portal";
import type { StripeEventProcessor } from "./events";
import type { StripeReconciler } from "./reconcile";

const STATUS: Record<string, number> = { not_found: 404, invalid_state: 409, unsupported: 422, unavailable: 409, conflict: 409, price_conflict: 409, open_session_exists: 409, mode_mismatch: 409 };

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof StripeCheckoutError || e instanceof StripeStoreError) return void res.status(STATUS[e.code] ?? 400).json({ error: e.code, message: e.message });
      if (e instanceof StripeCatalogError) return void res.status(409).json({ error: "catalog_invalid", message: e.message });
      if (e instanceof FiscalDocumentConflictError) return void res.status(409).json({ error: "conflict", message: e.message });
      if (e instanceof BuyerProfileError) return void res.status(e.code === "consumer_pending" ? 409 : 422).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "Stripe", "gateway_error", { code: e.code, retryable: e.retryable });
        recordFailure("stripe.gateway_error");
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable });
      }
      opsLog("error", "Stripe", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("stripe.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

export interface StripeRouterDeps {
  config: StripeConfig;
  store: StripeStore;
  gateway: StripeGateway;
  catalog: CatalogPort;
  /** null si faltan las URL de vuelta o no está CP_STRIPE_CHECKOUT_ENABLED=1. */
  checkout: StripeCheckoutService | null;
  processor?: StripeEventProcessor;
  reconciler?: StripeReconciler;
  now?: () => number;
  /** URL publicadas de los textos legales (CP_TERMS_URL, CP_PRIVACY_URL) para el Customer Portal. */
  legalUrls?: { terms: string | null; privacy: string | null };
  /** Nombre del adaptador del sistema de facturación legal (por defecto «pending»: nada se emite). */
  fiscalSinkName?: string;
  /** Pedidos (perfil fiscal del comprador). Sin ellos, las rutas del perfil no se montan. */
  orders?: Pick<OrderStore, "get">;
  /** Escenarios fiscales aprobados y versiones de consentimiento vigentes. */
  fiscal?: { scenarios: Set<FiscalScenario>; consent: ConsentVersions; taxExpectations?: Map<FiscalScenario, TaxTreatment> };
}

/** Estados en los que aún se puede registrar o corregir el perfil fiscal (antes de confirmar el pago). */
const BUYER_EDITABLE = new Set(["requested", "quoted", "contracted"]);

export function createStripeRouter(d: StripeRouterDeps): Router {
  const r = express.Router();
  const now = d.now ?? Date.now;
  // Solo ids de sesión del modo del entorno: cs_test_ en pruebas, cs_live_ en live (nunca el del otro)
  const sessionId = z.string().regex(sessionIdRe(d.config.mode));

  r.get("/status", requireScope("ops:read"), wrap(async (_req, res) => {
    const approved = Array.from(d.fiscal?.scenarios ?? new Set<FiscalScenario>());
    res.json({
      ...describeStripeConfig(d.config),
      issuer: describeIssuer(),
      checkoutEnabled: !!d.checkout,
      ...(checkoutBlockedReason(d.config) ? { checkoutBlocked: checkoutBlockedReason(d.config) } : {}),
      fiscal: { approved, pending: FISCAL_SCENARIOS.filter((s) => !approved.includes(s)), consumerWithdrawal: d.fiscal?.consent.withdrawal ?? "pending", taxExpectations: Object.fromEntries(d.fiscal?.taxExpectations ?? new Map()) },
      prices: await d.store.listPrices(),
    });
  }));
  if (d.orders) {
    const orders = d.orders;
    r.get("/orders/:id/buyer", requireScope("orders:read"), wrap(async (req, res) => {
      const p = await d.store.buyerProfile(id.parse(req.params.id));
      if (!p) return void res.status(404).json({ error: "not_found", message: "El pedido no tiene perfil fiscal" });
      res.json({ buyer: p, approved: !!d.fiscal?.scenarios.has(p.scenario) });
    }));
    // Comprobaciones del NIF-IVA en VIES de un pedido (resultado, número de consulta y fecha), más recientes primero
    r.get("/orders/:id/vat-checks", requireScope("orders:read"), wrap(async (req, res) => {
      if (!(await d.store.hasVatCheckTable())) return void res.status(503).json({ error: "unavailable", message: "Falta la migración 0021 (comprobaciones VIES)" });
      res.json({ checks: await d.store.vatChecksOfOrder(id.parse(req.params.id)) });
    }));
    // Venta asistida: el operador registra el perfil y el consentimiento recogidos con el cliente
    r.put("/orders/:id/buyer", requireScope("orders:write"), wrap(async (req, res) => {
      const orderId = id.parse(req.params.id);
      const b = z.object({ buyer: buyerProfileInput, consent: consentInput }).strict().parse(req.body);
      const o = await orders.get(orderId);
      if (!o) return void res.status(404).json({ error: "not_found", message: "Pedido no encontrado" });
      if (o.kind === "change" || !BUYER_EDITABLE.has(o.state) || o.confirmation) {
        return void res.status(409).json({ error: "invalid_state", message: `El perfil fiscal se registra antes de confirmar el pago (el pedido está en «${o.state}»)` });
      }
      const t = now();
      const consent = buildConsent(orderId, b.buyer.type, b.consent, d.fiscal?.consent ?? { terms: null, privacy: null, precontract: null, withdrawal: "pending" }, "operator", t);
      const saved = await d.store.saveBuyerProfile(toBuyerProfile(orderId, b.buyer, consent, t), who(req));
      opsLog("info", "Stripe", "buyer_profile_saved", { orderId, type: saved.type, scenario: saved.scenario, version: saved.version, actor: who(req) });
      res.json({ buyer: saved, approved: !!d.fiscal?.scenarios.has(saved.scenario) });
    }));
  }
  // Registro de facturas cobradas y cola de documentos fiscales (0016). Sin la migración, 404 explícito
  const fiscalMissing = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";
  r.get("/invoices", requireScope("ops:read"), wrap(async (req, res) => {
    const q = z.object({ orderId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    try {
      res.json({ invoices: await d.store.listInvoiceRecords(q) });
    } catch (e) {
      if (!fiscalMissing(e)) throw e;
      res.status(404).json({ error: "not_migrated", message: "Falta la migración 0016 (registro de facturas)" });
    }
  }));
  r.get("/fiscal-documents", requireScope("ops:read"), wrap(async (req, res) => {
    const q = z.object({ status: z.enum(["pending", "issued", "failed"]).optional(), orderId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    try {
      res.json({ documents: await d.store.listFiscalDocuments(q), sink: d.fiscalSinkName ?? "pending" });
    } catch (e) {
      if (!fiscalMissing(e)) throw e;
      res.status(404).json({ error: "not_migrated", message: "Falta la migración 0016 (documentos fiscales)" });
    }
  }));
  // Emisión registrada a mano (o por el adaptador): el número lo da el sistema de facturación legal, no este
  r.post("/fiscal-documents/:id/issued", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ externalRef: z.string().trim().regex(EXTERNAL_REF) }).strict().parse(req.body);
    const doc = await d.store.markFiscalDocumentIssued(id.parse(req.params.id), b.externalRef, who(req), now());
    if (!doc) return void res.status(404).json({ error: "not_found", message: "Documento fiscal no encontrado" });
    opsLog("info", "Stripe", "fiscal_document_issued", { documentId: doc.id, kind: doc.kind, actor: who(req) });
    res.json({ document: doc });
  }));
  // Customer Portal: solo lectura. Aplicarlo en Stripe lo autoriza el propietario (como el catálogo)
  r.get("/portal/plan", requireScope("ops:read"), wrap(async (_req, res) => {
    const configs = await d.gateway.portalConfigurations();
    const current = configs.find((c) => c.isDefault) ?? null;
    const input = { prices: await d.store.listPrices(), termsUrl: d.legalUrls?.terms ?? null, privacyUrl: d.legalUrls?.privacy ?? null };
    const differences = planPortal(current, input);
    res.json({ configurationId: current?.id ?? null, differences, applicable: differences.filter((x) => !x.pending).length, writeParams: portalWriteParams(differences, input) });
  }));
  r.get("/catalog/plan", requireScope("ops:read"), wrap(async (_req, res) => {
    // Las extensiones «bajo solicitud» van con `sellable: false`: su Price se prepara, pero no se venden
    const skipped: SkippedProduct[] = [];
    const desired = await desiredCatalog(d.catalog, { includeInternal: d.config.mode === "test", onSkip: (s) => skipped.push(s) });
    res.json({ desired, ...(await planCatalogWrites(desired, d.gateway)), skipped });
  }));
  // Propuestas de precio anual (decisión A): solo lectura; crearlas pasa por aprobar el catálogo y por una persona en Stripe
  r.get("/catalog/yearly-proposals", requireScope("ops:read"), wrap(async (_req, res) => {
    res.json({ rule: "yearly = 10 × monthly", proposals: proposeYearlyPrices(await d.catalog.offer()) });
  }));
  r.post("/catalog/sync", requireScope("orders:write"), wrap(async (req, res) => {
    const report = await syncCatalog(await desiredCatalog(d.catalog, { includeInternal: d.config.mode === "test" }), d.gateway, d.store, now());
    opsLog("info", "Stripe", "catalog_sync", { linked: report.linked.length, missing: report.missing.length, conflicts: report.conflicts.length, actor: who(req) });
    if (report.conflicts.length) recordFailure("stripe.catalog_conflict");
    res.status(report.conflicts.length ? 409 : 200).json(report);
  }));
  r.post("/orders/:id/checkout", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.checkout) return void res.status(409).json({ error: "checkout_disabled", message: "Checkout desactivado (CP_STRIPE_CHECKOUT_ENABLED y URL de vuelta)" });
    res.json(await d.checkout.start(id.parse(req.params.id), who(req)));
  }));
  r.post("/orders/:id/checkout/expire", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.checkout) return void res.status(409).json({ error: "checkout_disabled", message: "Checkout desactivado" });
    res.json(await d.checkout.expire(id.parse(req.params.id), who(req)));
  }));
  r.post("/checkout/:sessionId/sync", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.checkout) return void res.status(409).json({ error: "checkout_disabled", message: "Checkout desactivado" });
    res.json(await d.checkout.sync(sessionId.parse(req.params.sessionId)));
  }));
  // Recuentos y los eventos fallidos (para revisarlos y reprogramarlos con /events/:id/retry); nunca el cuerpo del evento
  r.get("/events", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ counts: await d.store.eventCounts(), failed: await d.store.failedEvents(100) })));
  r.post("/events/:id/retry", requireScope("orders:write"), wrap(async (req, res) => {
    const eventId = z.string().regex(/^evt_[A-Za-z0-9]{8,240}$/).parse(req.params.id);
    const ev = await d.store.event(eventId);
    if (!ev) return void res.status(404).json({ error: "not_found", message: "Evento no registrado" });
    if (ev.status !== "failed") return void res.status(409).json({ error: "invalid_state", message: `El evento está en «${ev.status}»: solo se reprograma uno fallido` });
    await d.store.failEvent(eventId, ev.lastError ?? "Reintento manual", now());
    opsLog("info", "Stripe", "event_retry", { eventId, actor: who(req) });
    res.json({ scheduled: true, result: d.processor ? await d.processor.processDue(10) : null });
  }));
  r.get("/adjustments", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ adjustments: await d.store.listAdjustments(200) })));
  r.post("/adjustments/:chargeId/resolve", requireScope("orders:write"), wrap(async (req, res) => {
    const chargeId = z.string().regex(/^(ch|py)_[A-Za-z0-9_]{8,240}$/).parse(req.params.chargeId);
    const { reason } = z.object({ reason: z.string().trim().min(5).max(200) }).parse(req.body ?? {});
    const a = await d.store.adjustment(chargeId);
    if (!a) return void res.status(404).json({ error: "not_found", message: "Cargo sin reembolsos ni disputas registrados" });
    if (!a.coverageLost || a.resolvedAt !== null) return void res.status(409).json({ error: "invalid_state", message: "Este cargo no tiene una retención vigente" });
    // Quién y por qué quedan en la propia retención (`resolution`) y en el log
    if (!(await d.store.resolveHolds({ chargeId }, `${who(req).slice(0, 90)}: ${reason}`, now()))) return void res.status(409).json({ error: "invalid_state", message: "La retención ya se resolvió" });
    opsLog("warn", "Stripe", "hold_resolved", { chargeId, orderId: a.orderId, actor: who(req) });
    // Si el pedido se está procesando ahora mismo, el estado se aplica en el siguiente evento o en la conciliación
    const applied = d.processor && a.subscriptionId ? await d.processor.handleSubscription(a.subscriptionId).catch(() => null) : null;
    res.json({ resolved: true, applied, pending: !applied });
  }));
  r.post("/reconcile", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.reconciler) return void res.status(409).json({ error: "unavailable", message: "Conciliación no disponible" });
    const out = await d.reconciler.tick();
    opsLog("info", "Stripe", "reconcile_manual", { actor: who(req), skipped: out.skipped, recovered: out.recovered });
    res.status(out.skipped ? 409 : 200).json(out);
  }));
  return r;
}
