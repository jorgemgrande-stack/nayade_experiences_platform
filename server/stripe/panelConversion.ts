/**
 * Contratación desde el PANEL de una empresa en prueba gratuita (conversión a pago con Stripe Checkout). APAGADA
 * salvo CP_PANEL_CONVERSION_ENABLED=1, y con las mismas exigencias que el autoservicio público: plan «available»
 * en el catálogo publicado, condiciones publicadas (CP_TERMS_VERSION) y, en live, política fiscal decidida,
 * perfil fiscal del comprador y elegibilidad.
 *
 *   GET  /commerce/conversion/status                      commerce:purchase  { enabled, reasons[] }
 *   POST /commerce/tenants/:tenantId/conversion/preview   commerce:purchase  { plan, interval, add? } → presupuesto (no crea nada)
 *   POST /commerce/tenants/:tenantId/conversion           commerce:purchase  { idempotencyKey, plan, interval, add?, buyer, consents, user }
 *                                                                            → { sessionId, url, expiresAt }
 *
 * Reutiliza el circuito existente sin atajos: pedido `trial_conversion` del orquestador sobre la MISMA empresa,
 * tenant y suscripción (los datos se conservan), aceptación registrada (versión de las condiciones) → `contracted`
 * → Checkout. Nada se activa aquí: la conversión llega solo con el pago VERIFICADO en Stripe (webhook o
 * conciliación). El tenant lo pone el Core con la sesión (nunca el navegador). Repetir la misma petición devuelve
 * el mismo pedido y la misma sesión; con otro pedido de conversión abierto para la prueba no se crea un segundo.
 */
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { QuoteRequest, QuoteResult } from "../catalog/quote";
import { PIPELINE, type CommercialOrder } from "../orchestrator/types";
import { stableHash } from "../subscriptions/pricing";
import type { CatalogPort } from "../subscriptions/ports";
import type { TrialRequest } from "../trials/store";
import { BuyerProfileError, buildConsent, buyerProfileInput, toBuyerProfile, type ConsentVersions } from "./buyerProfile";
import { SELF_SERVICE_PLANS } from "./catalog";
import { StripeCheckoutError, type CheckoutStart } from "./checkout";
import type { StripeMode } from "./config";
import type { EligibilityResult } from "./eligibility";
import { StripeGatewayError } from "./gateway";
import type { StripeStore } from "./store";

const moduleKey = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
export const conversionQuoteBody = z
  .object({
    plan: z.enum(SELF_SERVICE_PLANS),
    interval: z.enum(["month", "year"]),
    add: z.array(moduleKey).max(20).optional(),
  })
  .strict();
export const conversionBody = conversionQuoteBody
  .extend({
    idempotencyKey: z.string().uuid(),
    buyer: buyerProfileInput,
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
    /** Usuario del Core que contrata (solo auditoría: el rol lo comprueba el Core). */
    user: z.string().regex(/^[A-Za-z0-9:_.@-]{1,80}$/),
  })
  .strict();
export type ConversionQuoteBody = z.infer<typeof conversionQuoteBody>;
export type ConversionBody = z.infer<typeof conversionBody>;

export interface PanelConversionDeps {
  enabled: boolean;
  trials: { get(id: number): Promise<TrialRequest | null> };
  orders: { byKey(key: string): Promise<CommercialOrder | null>; list(f: { trialId: number; limit: number }): Promise<CommercialOrder[]> };
  orchestrator: {
    create(input: { idempotencyKey: string; trialId: number; request: unknown }, actor: string): Promise<{ order: CommercialOrder }>;
    accept(id: number, input: { signatureRef: string }, actor: string): Promise<{ order: CommercialOrder }>;
    reject(id: number, input: { reason: string }, actor: string): Promise<unknown>;
  };
  /** Sesiones de Checkout del pedido: una selección anterior solo se sustituye sin pago completado ni enlace vivo. */
  sessions: Pick<StripeStore, "openSession" | "hasCompletedSession">;
  /** Checkout montado (null: apagado, sin URL de vuelta o, en live, sin política fiscal). */
  checkout: { start(orderId: number, actor: string): Promise<CheckoutStart> } | null;
  catalog: CatalogPort;
  quote: (r: QuoteRequest) => Promise<QuoteResult>;
  /** Versión publicada de las condiciones de contratación; sin ella no se contrata. */
  termsVersion: string | null;
  consent?: ConsentVersions;
  buyers?: Pick<StripeStore, "saveBuyerProfile">;
  /** Elegibilidad del comprador (la del autoservicio público); en live es obligatoria. */
  eligibility?: (b: ConversionBody["buyer"]) => Promise<EligibilityResult>;
  mode: StripeMode;
  now?: () => number;
}

export class PanelConversionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PanelConversionError";
  }
}

const CONVERTIBLE = new Set<TrialRequest["state"]>(["active", "expired", "suspended"]);
/** Clave del pedido derivada de la del navegador: misma petición → mismo pedido. */
export const conversionKeyOf = (uuid: string) => `pc-${uuid.replace(/-/g, "").toLowerCase()}`;
/** Id de la prueba a partir de su tenant (`t<id>-<slug>`, server/trials/onboarding.ts); se comprueba después. */
export const trialIdOfTenant = (tenantId: string) => {
  const m = /^t(\d{1,9})-/.exec(tenantId);
  return m ? Number(m[1]) : null;
};

export class PanelConversionService {
  private now: () => number;
  constructor(private d: PanelConversionDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Qué impide hoy contratar desde el panel (vacío: disponible). Sin datos de ninguna empresa. */
  async status(): Promise<{ enabled: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    if (!this.d.enabled) reasons.push("panel_conversion_disabled");
    if (!this.d.termsVersion) reasons.push("terms_unpublished");
    if (!this.d.checkout) reasons.push("checkout_unavailable");
    const plans = await Promise.all(SELF_SERVICE_PLANS.map((p) => this.d.catalog.product(p).catch(() => null)));
    if (!plans.some((p) => p && p.commercialStatus === "available" && !p.internalOnly)) reasons.push("no_self_service_plan");
    return { enabled: reasons.length === 0, reasons };
  }

  /** Presupuesto de la conversión (importes del servidor, nunca del navegador). No crea ni guarda nada. */
  async preview(tenantId: string, b: ConversionQuoteBody) {
    this.assertEnabled();
    await this.trialOf(tenantId);
    await this.assertPlan(b.plan);
    const q = await this.d.quote(this.requestOf(b));
    return {
      plan: b.plan,
      interval: b.interval,
      quote: q,
      // En live, Stripe Tax calcula el impuesto en el pago con el domicilio del comprador; en pruebas, neto sin impuesto
      taxNotice: this.d.mode === "live" ? "Los impuestos se calculan en el pago según tu domicilio fiscal." : "Entorno de pruebas: importes netos, sin impuestos y sin cobro real.",
      termsVersion: this.d.termsVersion,
      privacyVersion: this.d.consent?.privacy ?? null,
    };
  }

  async start(tenantId: string, b: ConversionBody): Promise<CheckoutStart> {
    this.assertEnabled();
    if (!this.d.termsVersion) throw new PanelConversionError(503, "terms_unpublished", "La contratación en línea no está disponible");
    if (b.consents.termsVersion !== this.d.termsVersion) throw new PanelConversionError(409, "terms_outdated", "Las condiciones han cambiado: revísalas y acéptalas de nuevo");
    const trial = await this.trialOf(tenantId);
    await this.assertPlan(b.plan);
    const actor = `panel:${tenantId}/${b.user}`.slice(0, 100);
    const key = conversionKeyOf(b.idempotencyKey);
    // Repetición de la MISMA petición: el mismo pedido y la misma sesión de pago
    const existing = await this.d.orders.byKey(key);
    if (existing) {
      if (existing.trialId !== trial.id) throw new PanelConversionError(409, "conflict", "Solicitud no válida");
      return this.pay(existing.id, actor);
    }
    // Otro pedido de conversión abierto: nunca dos a la vez (ni dos cobros). Uno anterior del panel sin pago se retoma
    // (misma selección) o, si su enlace de pago ya caducó, se sustituye; el de un operador o uno pagado, no se toca
    const request = this.requestOf(b);
    const open = (await this.d.orders.list({ trialId: trial.id, limit: 50 })).find((o) => PIPELINE.includes(o.state));
    if (open) {
      const fromPanel = open.idempotencyKey.startsWith("pc-") && !open.confirmation && !(await this.d.sessions.hasCompletedSession(open.id));
      if (!fromPanel) throw new PanelConversionError(409, "conversion_open", "Ya hay una contratación en curso para tu empresa: escríbenos si necesitas cambiarla");
      if (open.state === "contracted" && stableHash(open.request) === stableHash(request)) return this.pay(open.id, actor);
      const live = await this.d.sessions.openSession(open.id);
      if (live && live.expiresAt > this.now()) throw new PanelConversionError(409, "conversion_open", "Tienes un pago abierto con otra selección: complétalo o espera a que caduque el enlace");
      await this.d.orchestrator.reject(open.id, { reason: "Sustituida por otra selección desde el panel (sin pago)" }, actor);
    }
    const q = await this.d.quote(request);
    if (!q.ok) throw new PanelConversionError(400, "invalid_selection", q.errors[0] ?? "Revisa el plan y los módulos elegidos");

    // Perfil fiscal y consentimiento COMPLETOS antes de crear nada; en live, además, elegibilidad
    const now = this.now();
    const versions: ConsentVersions = this.d.consent ?? { terms: this.d.termsVersion, privacy: null, precontract: null, withdrawal: "pending" };
    if (!this.d.buyers) throw new PanelConversionError(503, "buyer_unavailable", "La contratación en línea no está disponible");
    try {
      toBuyerProfile(0, b.buyer, buildConsent(0, b.buyer.type, b.consents, versions, "web", now), now);
    } catch (e) {
      throw this.buyerError(e);
    }
    if (this.d.mode === "live") {
      if (!this.d.eligibility) throw new PanelConversionError(503, "eligibility_unavailable", "La contratación en línea no está disponible");
      const r = await this.d.eligibility(b.buyer);
      if (!r.eligible) {
        opsLog("warn", "PanelConversion", "not_eligible", { scenario: r.scenario, reasons: r.reasons });
        throw new PanelConversionError(403, "not_eligible", "Todavía no podemos cobrar en línea a este tipo de cliente o país. Escríbenos y te ayudamos con la contratación");
      }
    }

    const { order } = await this.d.orchestrator.create({ idempotencyKey: key, trialId: trial.id, request }, actor);
    try {
      await this.d.buyers.saveBuyerProfile(toBuyerProfile(order.id, b.buyer, buildConsent(order.id, b.buyer.type, b.consents, versions, "web", now), now), actor);
    } catch (e) {
      throw this.buyerError(e);
    }
    const evidence = crypto.createHash("sha256").update(`${key}|${b.consents.termsVersion}|${now}`).digest("hex").slice(0, 16);
    const accepted = (await this.d.orchestrator.accept(order.id, { signatureRef: `panel-terms:${b.consents.termsVersion}:${evidence}` }, actor)).order;
    if (accepted.state !== "contracted") throw new PanelConversionError(409, "not_contracted", "No se ha podido preparar la contratación");
    opsLog("info", "PanelConversion", "order_ready", { orderId: order.id, trialId: trial.id, plan: b.plan, interval: b.interval, modules: b.add?.length ?? 0 });
    return this.pay(order.id, actor);
  }

  private requestOf(b: ConversionQuoteBody): QuoteRequest {
    return { plan: b.plan, interval: b.interval, items: Array.from(new Set(b.add ?? [])).map((key) => ({ key })) };
  }

  private assertEnabled() {
    if (!this.d.enabled || !this.d.checkout) throw new PanelConversionError(503, "disabled", "La contratación desde el panel no está disponible");
  }

  private pay(orderId: number, actor: string) {
    this.assertEnabled();
    return this.d.checkout!.start(orderId, actor);
  }

  private async assertPlan(plan: string) {
    const p = await this.d.catalog.product(plan);
    if (!p || p.commercialStatus !== "available" || p.internalOnly) throw new PanelConversionError(409, "plan_not_self_service", "Este plan todavía no se contrata en línea: escríbenos y te ayudamos con la contratación");
  }

  /** La prueba de ESTE tenant (el id sale del tenant y se comprueba contra lo guardado). */
  private async trialOf(tenantId: string): Promise<TrialRequest> {
    const id = trialIdOfTenant(tenantId);
    const t = id === null ? null : await this.d.trials.get(id);
    if (!t || t.tenantId !== tenantId) throw new PanelConversionError(404, "not_in_trial", "Tu empresa no está en periodo de prueba");
    if (!CONVERTIBLE.has(t.state)) throw new PanelConversionError(409, "not_in_trial", "Tu prueba ya no se puede convertir desde aquí");
    return t;
  }

  private buyerError(e: unknown): Error {
    if (!(e instanceof BuyerProfileError)) return e as Error;
    if (e.code === "consumer_pending") return new PanelConversionError(503, "consumer_unavailable", "La contratación como particular todavía no está disponible");
    if (e.code === "consent_missing") return new PanelConversionError(409, "consent_outdated", "Revisa y acepta los textos vigentes antes de continuar");
    return new PanelConversionError(400, e.code, e.message);
  }
}

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof PanelConversionError) return void res.status(e.status).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Revisa los datos del formulario" });
      if (e instanceof StripeCheckoutError) return void res.status(e.code === "not_found" ? 404 : 409).json({ error: e.code, message: "No se ha podido iniciar el pago" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "PanelConversion", "gateway_error", { code: e.code, retryable: e.retryable });
        recordFailure("stripe.gateway_error");
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", message: "El servicio de pago no responde: inténtalo de nuevo en unos minutos" });
      }
      opsLog("error", "PanelConversion", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("stripe.panel_conversion_failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

export function createPanelConversionRouter(svc: PanelConversionService): Router {
  const r = express.Router();
  r.get("/conversion/status", requireScope("commerce:purchase"), wrap(async (_req, res) => void res.json(await svc.status())));
  r.post(
    "/tenants/:tenantId/conversion/preview",
    requireScope("commerce:purchase"),
    wrap(async (req, res) => void res.json({ preview: await svc.preview(tenant.parse(req.params.tenantId), conversionQuoteBody.parse(req.body)) })),
  );
  r.post(
    "/tenants/:tenantId/conversion",
    requireScope("commerce:purchase"),
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const s = await svc.start(tenant.parse(req.params.tenantId), conversionBody.parse(req.body));
      res.json({ sessionId: s.sessionId, url: s.url, expiresAt: s.expiresAt });
    }),
  );
  return r;
}
