/**
 * Contratación por AUTOSERVICIO (solicitud provisional → Checkout). En pruebas o live (en live, solo con
 * política fiscal decidida: sin ella Checkout no se monta) y APAGADA salvo
 * CP_PUBLIC_SELF_SERVICE_ENABLED=1: el registro público sigue cerrado.
 *
 *   POST /cp/v1/public/checkout/start
 *     { idempotencyKey (uuid), plan: essential|business, interval: month|year,
 *       company?: { name, taxId? },  buyer?: perfil fiscal (empresa o particular; server/stripe/buyerProfile.ts),
 *       admin: { name, email },
 *       consents: { terms: true, privacy: true, termsVersion, privacyVersion?, precontractVersion?, immediateExecution? },
 *       ticket, website (campo trampa) }
 *   Con `buyer`, el nombre y el identificador fiscal salen del perfil: un particular no da razón social. En live
 *   `buyer` es obligatorio (sin perfil fiscal no se abre el pago); en pruebas, `company` sigue valiendo.
 *   → 200 { sessionId, url, expiresAt }   (la URL de Stripe Checkout)
 *
 *   POST /cp/v1/public/checkout/eligibility
 *     { type: business|consumer, country, postalCode?, taxId?, plan?, interval? }
 *   → 200 { eligible, reasons[], territory, scenario, price? }   (consulta: no crea ni guarda nada)
 *   Con plan y periodicidad, el precio que verá ese comprador: con impuestos si es particular y hay tipo decidido.
 *
 * En live, el control de elegibilidad (server/stripe/eligibility.ts) se aplica ANTES de crear la empresa, el
 * contacto o el pedido: un comprador no habilitado no deja registros a medias.
 *
 * Reutiliza el circuito existente sin atajos:
 *  - Empresa y contacto administrador en el CRM; pedido del orquestador (`new`) con la petición del plan;
 *    aceptación registrada (versión de las condiciones aceptadas en la web) → `contracted`; Checkout.
 *  - El importe lo calcula el servidor (catálogo aprobado y enlazado con Stripe); nunca el navegador.
 *  - Nada se activa aquí: la confirmación, el alta de la empresa, las licencias y el acceso llegan solo
 *    con el pago VERIFICADO en Stripe (webhook o conciliación).
 *
 * Exigencias que hoy NO se cumplen (a propósito, la ruta queda inutilizable hasta decidirlas):
 *  - el plan debe estar «available» en el catálogo publicado (hoy Essential y Business son «on_request»,
 *    que exige aprobación motivada de una persona y no se salta);
 *  - debe existir una versión publicada de las condiciones de contratación (CP_TERMS_VERSION) y la
 *    aceptada en la web debe coincidir.
 *
 * Defensas: origen permitido, ticket de formulario firmado (HMAC) con tiempo mínimo, campo trampa,
 * límites por IP y por correo, idempotencia por clave (repetir la petición devuelve el mismo pedido y
 * la misma sesión, sin otra empresa).
 */
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { checkTicket } from "../crm/publicApi";
import type { CatalogPort } from "../subscriptions/ports";
import type { CommercialOrder } from "../orchestrator/types";
import { SELF_SERVICE_PLANS } from "./catalog";
import { StripeCheckoutError, type CheckoutStart } from "./checkout";
import type { StripeMode } from "./config";
import type { StripeStore } from "./store";
import { BUYER_TYPES, BuyerProfileError, buildConsent, buyerProfileInput, toBuyerProfile, type ConsentVersions } from "./buyerProfile";
import { desiredCatalog } from "./catalog";
import { checkEligibility, priceFor, type EligibilityConfig, type EligibilityResult } from "./eligibility";
import { needsVies, type VatVerifier } from "./vies";

export const eligibilityQuery = z
  .object({
    type: z.enum(BUYER_TYPES),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    postalCode: z.string().trim().max(12).optional(),
    taxId: z.string().trim().max(40).optional(),
    plan: z.enum(SELF_SERVICE_PLANS).optional(),
    interval: z.enum(["month", "year"]).optional(),
  })
  .strict();
export type EligibilityQuery = z.infer<typeof eligibilityQuery>;

export const selfServiceBody = z
  .object({
    idempotencyKey: z.string().uuid(),
    plan: z.enum(SELF_SERVICE_PLANS),
    interval: z.enum(["month", "year"]),
    company: z.object({ name: z.string().trim().min(2).max(160), taxId: z.string().trim().max(40).optional() }).strict().optional(),
    buyer: buyerProfileInput.optional(),
    admin: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200) }).strict(),
    consents: z
      .object({
        terms: z.literal(true),
        privacy: z.literal(true),
        termsVersion: z.string().trim().min(1).max(40),
        privacyVersion: z.string().trim().min(1).max(40).optional(),
        precontractVersion: z.string().trim().min(1).max(40).optional(),
        immediateExecution: z.literal(true).optional(),
      })
      .strict(),
    ticket: z.string().min(10).max(200),
    website: z.string().max(500).optional(),
  })
  .strict()
  .refine((b) => !!b.company || !!b.buyer, { message: "Indica los datos del comprador", path: ["buyer"] });
export type SelfServiceBody = z.infer<typeof selfServiceBody>;

export interface SelfServiceDeps {
  crm: {
    createCompany(input: { name: string; taxId?: string; email?: string }, author: string): Promise<{ id: number }>;
    createContact(companyId: number, input: { name: string; email: string; role?: string; isPrimary?: boolean }, author: string): Promise<unknown>;
  };
  orders: { byKey(key: string): Promise<CommercialOrder | null> };
  orchestrator: {
    create(input: { idempotencyKey: string; companyId: number; request: unknown }, actor: string): Promise<{ order: CommercialOrder }>;
    accept(id: number, input: { signatureRef: string }, actor: string): Promise<{ order: CommercialOrder }>;
  };
  checkout: { start(orderId: number, actor: string): Promise<CheckoutStart> };
  catalog: CatalogPort;
  /** Secreto de los tickets de formulario (el mismo de la captación pública). */
  ticketSecret: string;
  origins: Set<string>;
  /** Versión publicada de las condiciones de contratación; sin ella, la ruta responde 503. */
  termsVersion: string | null;
  /** Perfiles fiscales del comprador (0014). */
  buyers?: Pick<StripeStore, "saveBuyerProfile" | "hasBuyerAddressColumn">;
  /** Control de elegibilidad por tipo de cliente, país y territorio (server/stripe/eligibility.ts). */
  eligibility?: EligibilityConfig;
  /** Verificación de NIF-IVA en VIES (inversión del sujeto pasivo); sin ella, ese escenario no se cobra. */
  vat?: Pick<VatVerifier, "verify">;
  /** Modo del entorno: en live el perfil fiscal es obligatorio. */
  mode?: StripeMode;
  /** Versiones de consentimiento vigentes (condiciones, privacidad, precontractual) y decisión sobre el desistimiento. */
  consent?: ConsentVersions;
  now?: () => number;
  minFillMs?: number;
  maxAgeMs?: number;
  perEmailPerHour?: number;
}

export class SelfServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SelfServiceError";
  }
}

const ACTOR = "web:self-service";

/** Clave del pedido derivada de la del navegador: misma petición → mismo pedido (y misma empresa). */
export const orderKeyOf = (uuid: string) => `ss-${uuid.replace(/-/g, "").toLowerCase()}`;

export class SelfServiceCheckout {
  private now: () => number;
  private perEmail = new Map<string, number[]>();
  constructor(private d: SelfServiceDeps) {
    this.now = d.now ?? Date.now;
  }

  async start(b: SelfServiceBody): Promise<CheckoutStart> {
    if (!this.d.termsVersion) throw new SelfServiceError(503, "terms_unpublished", "La contratación en línea no está disponible");
    if (b.website && b.website.trim()) throw new SelfServiceError(400, "rejected", "Solicitud no válida");
    const t = checkTicket(this.d.ticketSecret, b.ticket, this.now(), this.d.minFillMs ?? 3000, this.d.maxAgeMs ?? 2 * 3600_000);
    if (!t.ok) throw new SelfServiceError(400, t.reason === "too_fast" ? "too_fast" : "invalid_ticket", "Vuelve a cargar el formulario e inténtalo de nuevo");
    if (b.consents.termsVersion !== this.d.termsVersion) throw new SelfServiceError(409, "terms_outdated", "Las condiciones han cambiado: revísalas y acéptalas de nuevo");
    const product = await this.d.catalog.product(b.plan);
    if (!product || product.commercialStatus !== "available" || product.internalOnly) throw new SelfServiceError(409, "plan_not_self_service", "Este plan todavía no se contrata en línea: solicita la contratación y te contactaremos");

    const key = orderKeyOf(b.idempotencyKey);
    // Repetición de la MISMA petición: el mismo pedido y la misma sesión de pago (sin otra empresa)
    const existing = await this.d.orders.byKey(key);
    if (existing) return this.d.checkout.start(existing.id, ACTOR);

    const now = this.now();
    const recent = (this.perEmail.get(b.admin.email) ?? []).filter((x) => now - x < 3600_000);
    if (recent.length >= (this.d.perEmailPerHour ?? 3)) throw new SelfServiceError(429, "rate_email", "Demasiados intentos con este correo: inténtalo más tarde");
    this.perEmail.set(b.admin.email, [...recent, now]);

    // Perfil fiscal: obligatorio en live; se valida ANTES de crear nada (consentimientos exigidos y territorio)
    const versions: ConsentVersions = this.d.consent ?? { terms: this.d.termsVersion, privacy: null, precontract: null, withdrawal: "pending" };
    if (this.d.mode === "live" && !b.buyer) throw new SelfServiceError(400, "buyer_required", "Indica si contratas como empresa o como particular, con tu país y código postal");
    if (b.buyer) {
      if (!this.d.buyers) throw new SelfServiceError(503, "buyer_unavailable", "La contratación en línea no está disponible");
      try {
        // Consentimiento COMPLETO (versiones vigentes y casillas propias) y territorio, sin persistir nada
        toBuyerProfile(0, b.buyer, buildConsent(0, b.buyer.type, b.consents, versions, "web", now), now);
      } catch (e) {
        throw this.buyerError(e);
      }
      // En live, el comprador debe poder cobrarse ANTES de crear nada (empresa, contacto, pedido)
      if (this.d.mode === "live") {
        const r = await this.eligibilityOf(b.buyer);
        if (!r.eligible) {
          opsLog("warn", "SelfService", "not_eligible", { scenario: r.scenario, reasons: r.reasons });
          throw new SelfServiceError(403, "not_eligible", "Todavía no podemos cobrar en línea a este tipo de cliente o país. Escríbenos y te ayudamos con la contratación");
        }
      }
    }
    const name = b.buyer ? (b.buyer.type === "business" ? b.buyer.legalName : `${b.buyer.firstName} ${b.buyer.lastName}`) : b.company!.name;
    const taxId = b.buyer ? b.buyer.taxId : b.company!.taxId;
    const company = await this.d.crm.createCompany({ name, ...(taxId ? { taxId } : {}), email: b.admin.email }, ACTOR);
    await this.d.crm.createContact(company.id, { name: b.admin.name, email: b.admin.email, role: "Administración", isPrimary: true }, ACTOR);
    const { order } = await this.d.orchestrator.create({ idempotencyKey: key, companyId: company.id, request: { plan: b.plan, interval: b.interval, items: [] } }, ACTOR);
    if (b.buyer) {
      try {
        const consent = buildConsent(order.id, b.buyer.type, b.consents, versions, "web", now);
        await this.d.buyers!.saveBuyerProfile(toBuyerProfile(order.id, b.buyer, consent, now), ACTOR);
      } catch (e) {
        throw this.buyerError(e);
      }
    }
    // Aceptación registrada: versión de las condiciones y huella de la petición (sin datos personales)
    const evidence = crypto.createHash("sha256").update(`${key}|${b.consents.termsVersion}|${now}`).digest("hex").slice(0, 16);
    const accepted = (await this.d.orchestrator.accept(order.id, { signatureRef: `web-terms:${b.consents.termsVersion}:${evidence}` }, ACTOR)).order;
    if (accepted.state !== "contracted") throw new SelfServiceError(409, "not_contracted", "No se ha podido preparar la contratación");
    opsLog("info", "SelfService", "order_ready", { orderId: order.id, plan: b.plan, interval: b.interval, ...(b.buyer ? { buyerType: b.buyer.type } : {}) });
    return this.d.checkout.start(order.id, ACTOR);
  }

  /** Elegibilidad de un comprador con la configuración aprobada (en live, con domicilio si se puede guardar). */
  private async eligibilityOf(b: { type: "business" | "consumer"; country: string; postalCode?: string; taxId?: string; line1?: string; city?: string }): Promise<EligibilityResult> {
    const cfg: EligibilityConfig = this.d.eligibility ?? { scenarios: new Set(), taxExpectations: new Map(), countries: new Map(), consumerRates: new Map() };
    const requireAddress = this.d.mode === "live" && !!(await this.d.buyers?.hasBuyerAddressColumn());
    // Inversión del sujeto pasivo: consulta (o reutiliza) la verificación en VIES ANTES de crear nada
    const pre = checkEligibility({ type: b.type, country: b.country, postalCode: b.postalCode, taxId: b.taxId }, cfg);
    const vat = needsVies(pre.taxExpectation) && pre.taxId && this.d.vat ? (await this.d.vat.verify(b.country, b.taxId!)).status : undefined;
    return checkEligibility({ type: b.type, country: b.country, postalCode: b.postalCode, taxId: b.taxId, hasAddress: !!(b.line1 && b.city), vat }, { ...cfg, consent: cfg.consent ?? this.d.consent }, { requireAddress });
  }

  /**
   * Consulta pública de elegibilidad: no crea ni guarda nada. El domicilio no se pide aquí (lo pide el formulario),
   * así que no cuenta como motivo. Con plan y periodicidad, devuelve el precio que verá este comprador.
   */
  async eligibility(q: EligibilityQuery) {
    const r = await this.eligibilityOf(q);
    const reasons = r.reasons.filter((x) => x !== "address_incomplete");
    let price: ReturnType<typeof priceFor> | null = null;
    if (q.plan && q.interval) {
      const kind = q.interval === "year" ? "yearly" : "monthly";
      // Un catálogo incompleto no rompe la consulta: se responde sin precio
      const d = (await desiredCatalog(this.d.catalog).catch(() => [])).find((x) => x.productKey === q.plan && x.kind === kind);
      if (d) price = priceFor(d.amountCents, r);
    }
    return { eligible: reasons.length === 0, reasons, territory: r.territory, scenario: r.scenario, price };
  }

  private buyerError(e: unknown): Error {
    if (!(e instanceof BuyerProfileError)) return e as Error;
    if (e.code === "consumer_pending") return new SelfServiceError(503, "consumer_unavailable", "La contratación como particular todavía no está disponible");
    if (e.code === "consent_missing") return new SelfServiceError(409, "consent_outdated", "Revisa y acepta los textos vigentes antes de continuar");
    return new SelfServiceError(400, e.code, e.message);
  }
}

export function createSelfServiceRouter(svc: SelfServiceCheckout, origins: Set<string>): Router {
  const r = express.Router();
  r.post(
    "/eligibility",
    rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
    (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const o = req.headers.origin;
      if (typeof o !== "string" || !origins.has(o)) return void res.status(403).json({ error: "origin_not_allowed" });
      const parsed = eligibilityQuery.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "Revisa el tipo de cliente y el país" });
      svc
        .eligibility(parsed.data)
        .then((x) => res.json(x))
        .catch((e) => {
          opsLog("error", "SelfService", "eligibility_error", { error: e instanceof Error ? e.name : "error" });
          res.status(500).json({ error: "internal_error", message: "Error interno" });
        });
    },
  );
  r.post(
    "/start",
    rateLimit({ windowMs: 3600_000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
    (req: Request, res: Response, _next: NextFunction) => {
      res.setHeader("Cache-Control", "no-store");
      const o = req.headers.origin;
      if (typeof o !== "string" || !origins.has(o)) return void res.status(403).json({ error: "origin_not_allowed" });
      const parsed = selfServiceBody.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "Revisa los datos del formulario" });
      svc
        .start(parsed.data)
        .then((s) => res.json({ sessionId: s.sessionId, url: s.url, expiresAt: s.expiresAt }))
        .catch((e) => {
          if (e instanceof SelfServiceError) return void res.status(e.status).json({ error: e.code, message: e.message });
          if (e instanceof StripeCheckoutError) return void res.status(e.code === "not_found" ? 404 : 409).json({ error: e.code, message: "No se ha podido iniciar el pago" });
          opsLog("error", "SelfService", "internal_error", { error: e instanceof Error ? e.name : "error" });
          recordFailure("stripe.self_service_failed");
          res.status(500).json({ error: "internal_error", message: "Error interno" });
        });
    },
  );
  return r;
}
