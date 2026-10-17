/**
 * Contratación por AUTOSERVICIO (solicitud provisional → Checkout). SOLO MODO PRUEBAS y APAGADA salvo
 * CP_PUBLIC_SELF_SERVICE_ENABLED=1: el registro público sigue cerrado.
 *
 *   POST /cp/v1/public/checkout/start
 *     { idempotencyKey (uuid), plan: essential|business, interval: month|year,
 *       company: { name, taxId? }, admin: { name, email },
 *       consents: { terms: true, privacy: true, termsVersion }, ticket, website (campo trampa) }
 *   → 200 { sessionId, url, expiresAt }   (la URL de Stripe Checkout)
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

export const selfServiceBody = z
  .object({
    idempotencyKey: z.string().uuid(),
    plan: z.enum(SELF_SERVICE_PLANS),
    interval: z.enum(["month", "year"]),
    company: z.object({ name: z.string().trim().min(2).max(160), taxId: z.string().trim().max(40).optional() }).strict(),
    admin: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200) }).strict(),
    consents: z.object({ terms: z.literal(true), privacy: z.literal(true), termsVersion: z.string().trim().min(1).max(40) }).strict(),
    ticket: z.string().min(10).max(200),
    website: z.string().max(500).optional(),
  })
  .strict();
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
    if (!product || product.commercialStatus !== "available") throw new SelfServiceError(409, "plan_not_self_service", "Este plan todavía no se contrata en línea: solicita la contratación y te contactaremos");

    const key = orderKeyOf(b.idempotencyKey);
    // Repetición de la MISMA petición: el mismo pedido y la misma sesión de pago (sin otra empresa)
    const existing = await this.d.orders.byKey(key);
    if (existing) return this.d.checkout.start(existing.id, ACTOR);

    const now = this.now();
    const recent = (this.perEmail.get(b.admin.email) ?? []).filter((x) => now - x < 3600_000);
    if (recent.length >= (this.d.perEmailPerHour ?? 3)) throw new SelfServiceError(429, "rate_email", "Demasiados intentos con este correo: inténtalo más tarde");
    this.perEmail.set(b.admin.email, [...recent, now]);

    const company = await this.d.crm.createCompany({ name: b.company.name, ...(b.company.taxId ? { taxId: b.company.taxId } : {}), email: b.admin.email }, ACTOR);
    await this.d.crm.createContact(company.id, { name: b.admin.name, email: b.admin.email, role: "Administración", isPrimary: true }, ACTOR);
    const { order } = await this.d.orchestrator.create({ idempotencyKey: key, companyId: company.id, request: { plan: b.plan, interval: b.interval, items: [] } }, ACTOR);
    // Aceptación registrada: versión de las condiciones y huella de la petición (sin datos personales)
    const evidence = crypto.createHash("sha256").update(`${key}|${b.consents.termsVersion}|${now}`).digest("hex").slice(0, 16);
    const accepted = (await this.d.orchestrator.accept(order.id, { signatureRef: `web-terms:${b.consents.termsVersion}:${evidence}` }, ACTOR)).order;
    if (accepted.state !== "contracted") throw new SelfServiceError(409, "not_contracted", "No se ha podido preparar la contratación");
    opsLog("info", "SelfService", "order_ready", { orderId: order.id, plan: b.plan, interval: b.interval });
    return this.d.checkout.start(order.id, ACTOR);
  }
}

export function createSelfServiceRouter(svc: SelfServiceCheckout, origins: Set<string>): Router {
  const r = express.Router();
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
