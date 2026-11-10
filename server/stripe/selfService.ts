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
 *   Plan personal `life` (08/11/2026): solo particulares (`buyer.type: consumer`: nombre y apellidos, NIF opcional),
 *   solo mensual y con `household.name` opcional (nombre del hogar, editable después; por defecto, «Hogar de …»).
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
import { CrmError } from "../crm/types";
import { OrderError } from "../orchestrator/types";
import type { CatalogPort } from "../subscriptions/ports";
import type { CommercialOrder } from "../orchestrator/types";
import { CHECKOUT_PLANS, isPersonalCheckoutPlan } from "./catalog";
import { StripeCheckoutError, type CheckoutStart } from "./checkout";
import type { StripeMode } from "./config";
import type { StripeStore } from "./store";
import { BUYER_TYPES, BuyerProfileError, buildConsent, buyerProfileInput, toBuyerProfile, type ConsentVersions } from "./buyerProfile";
import { desiredCatalog } from "./catalog";
import { checkEligibility, priceFor, type EligibilityConfig, type EligibilityResult } from "./eligibility";
import { needsVies, type VatVerifier } from "./vies";
import { PUBLIC_CART_MAX_PRODUCTS, PublicCartError, type PublicCart } from "./publicCart";
import { displayPrice } from "./buyerProfile";

const productKey = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
/** Productos del carrito (además del plan): solo claves, nunca importes. */
const cartProducts = z.array(productKey).max(PUBLIC_CART_MAX_PRODUCTS);

/** Presupuesto del carrito antes de pagar (no crea ni guarda nada). */
export const cartQuoteBody = z
  .object({
    plan: z.string().trim().min(1).max(63),
    interval: z.enum(["month", "year"]),
    products: cartProducts.optional(),
    buyer: z
      .object({
        type: z.enum(BUYER_TYPES),
        country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
        postalCode: z.string().trim().max(12).optional(),
        taxId: z.string().trim().max(40).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CartQuoteBody = z.infer<typeof cartQuoteBody>;

export const eligibilityQuery = z
  .object({
    type: z.enum(BUYER_TYPES),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    postalCode: z.string().trim().max(12).optional(),
    taxId: z.string().trim().max(40).optional(),
    plan: z.enum(CHECKOUT_PLANS).optional(),
    interval: z.enum(["month", "year"]).optional(),
  })
  .strict();
export type EligibilityQuery = z.infer<typeof eligibilityQuery>;

export const selfServiceBody = z
  .object({
    idempotencyKey: z.string().uuid(),
    plan: z.enum(CHECKOUT_PLANS),
    interval: z.enum(["month", "year"]),
    /** Soluciones Net y extensiones Connect habilitadas para la venta en línea (lista blanca del servidor). */
    products: cartProducts.optional(),
    /** Total del primer cobro que mostró /quote (solo para comparar; nunca se cobra a partir de él). */
    expectedFirstChargeNetCents: z.number().int().min(0).max(100_000_000).optional(),
    company: z.object({ name: z.string().trim().min(2).max(160), taxId: z.string().trim().max(40).optional() }).strict().optional(),
    /** Plan personal: nombre del hogar (opcional y editable después). Nunca razón social. */
    household: z.object({ name: z.string().trim().min(2).max(160) }).strict().optional(),
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
  .refine((b) => !!b.company || !!b.buyer, { message: "Indica los datos del comprador", path: ["buyer"] })
  // Plan personal: un particular con nombre y apellidos (NIF opcional), sin datos de empresa y solo mensual
  .refine((b) => !isPersonalCheckoutPlan(b.plan) || (b.buyer?.type === "consumer" && !b.company), { message: "El plan personal lo contrata un particular: nombre y apellidos, NIF opcional", path: ["buyer"] })
  .refine((b) => !isPersonalCheckoutPlan(b.plan) || b.interval === "month", { message: "El plan personal solo tiene tarifa mensual", path: ["interval"] })
  .refine((b) => !b.household || isPersonalCheckoutPlan(b.plan), { message: "El nombre del hogar es del plan personal", path: ["household"] });
export type SelfServiceBody = z.infer<typeof selfServiceBody>;

export interface SelfServiceDeps {
  crm: {
    createCompany(input: { name: string; taxId?: string; email?: string }, author: string): Promise<{ id: number }>;
    createContact(companyId: number, input: { name: string; email: string; role?: string; isPrimary?: boolean }, author: string): Promise<unknown>;
  };
  /** `list`: pedidos de la empresa (cambio de carrito con la misma clave). Sin él, otra selección se rechaza. */
  orders: { byKey(key: string): Promise<CommercialOrder | null>; list?(f: { companyId: number }): Promise<CommercialOrder[]> };
  orchestrator: {
    create(input: { idempotencyKey: string; companyId: number; request: unknown }, actor: string): Promise<{ order: CommercialOrder }>;
    accept(id: number, input: { signatureRef: string }, actor: string): Promise<{ order: CommercialOrder }>;
    /** Sustituir un pedido SIN pagar por otra selección del mismo comprador. */
    reject?(id: number, input: { reason: string }, actor: string): Promise<unknown>;
  };
  checkout: { start(orderId: number, actor: string): Promise<CheckoutStart>; expire?(orderId: number, actor: string): Promise<{ expired: boolean }> };
  /** Sesiones de pago registradas (¿se pagó ya un pedido?). Necesario para sustituir un pedido sin pagar. */
  sessions?: Pick<StripeStore, "hasCompletedSession">;
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
  /**
   * Carrito público (plan + productos en línea; ./publicCart.ts). Sin él, solo se contrata el plan, como antes, y
   * cualquier producto se rechaza.
   */
  cart?: PublicCart;
  /** Tratamiento fiscal con el que se cobraría (StripeCheckoutService.taxPolicy); null: no se cobra. */
  taxTreatment?: string | null;
  now?: () => number;
  minFillMs?: number;
  maxAgeMs?: number;
  perEmailPerHour?: number;
}

export type BuyerForEligibility = { type: "business" | "consumer"; country: string; postalCode?: string; taxId?: string; line1?: string; city?: string };

/**
 * Elegibilidad de un comprador con la configuración aprobada (en live, con domicilio si se puede guardar). La comparten
 * el autoservicio público y la contratación desde el panel (./panelConversion.ts).
 */
export async function buyerEligibility(d: Pick<SelfServiceDeps, "eligibility" | "mode" | "buyers" | "vat" | "consent">, b: BuyerForEligibility): Promise<EligibilityResult> {
  const cfg: EligibilityConfig = d.eligibility ?? { scenarios: new Set(), taxExpectations: new Map(), countries: new Map(), consumerRates: new Map() };
  const requireAddress = d.mode === "live" && !!(await d.buyers?.hasBuyerAddressColumn());
  // Inversión del sujeto pasivo: consulta (o reutiliza) la verificación en VIES ANTES de crear nada
  const pre = checkEligibility({ type: b.type, country: b.country, postalCode: b.postalCode, taxId: b.taxId }, cfg);
  const vat = needsVies(pre.taxExpectation) && pre.taxId && d.vat ? (await d.vat.verify(b.country, b.taxId!)).status : undefined;
  return checkEligibility({ type: b.type, country: b.country, postalCode: b.postalCode, taxId: b.taxId, hasAddress: !!(b.line1 && b.city), vat }, { ...cfg, consent: cfg.consent ?? d.consent }, { requireAddress });
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

/** Mismo carrito: plan, periodicidad y productos (sin orden ni repetidos). */
const sameCart = (o: Pick<CommercialOrder, "request">, b: { plan: string; interval: string }, products: string[]) =>
  !!o.request && o.request.plan === b.plan && o.request.interval === b.interval && (o.request.items ?? []).map((i) => i.key).sort().join(",") === [...products].sort().join(",");

export class SelfServiceCheckout {
  private now: () => number;
  private perEmail = new Map<string, number[]>();
  /** Peticiones en curso por clave: un doble clic simultáneo espera a la primera (y recibe su misma sesión). */
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private d: SelfServiceDeps) {
    this.now = d.now ?? Date.now;
  }

  async start(b: SelfServiceBody): Promise<CheckoutStart> {
    const key = orderKeyOf(b.idempotencyKey);
    const prev = this.inflight.get(key);
    if (prev) await prev.catch(() => undefined);
    const run = this.startOnce(b);
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      if (this.inflight.get(key) === run) this.inflight.delete(key);
    }
  }

  private async startOnce(b: SelfServiceBody): Promise<CheckoutStart> {
    if (!this.d.termsVersion) throw new SelfServiceError(503, "terms_unpublished", "La contratación en línea no está disponible");
    if (b.website && b.website.trim()) throw new SelfServiceError(400, "rejected", "Solicitud no válida");
    const t = checkTicket(this.d.ticketSecret, b.ticket, this.now(), this.d.minFillMs ?? 3000, this.d.maxAgeMs ?? 2 * 3600_000);
    if (!t.ok) throw new SelfServiceError(400, t.reason === "too_fast" ? "too_fast" : "invalid_ticket", "Vuelve a cargar el formulario e inténtalo de nuevo");
    if (b.consents.termsVersion !== this.d.termsVersion) throw new SelfServiceError(409, "terms_outdated", "Las condiciones han cambiado: revísalas y acéptalas de nuevo");
    const product = await this.d.catalog.product(b.plan);
    if (!product || product.commercialStatus !== "available" || product.internalOnly) throw new SelfServiceError(409, "plan_not_self_service", "Este plan todavía no se contrata en línea: solicita la contratación y te contactaremos");

    // Carrito: el servidor valida plan, productos, compatibilidades y Prices ANTES de crear nada
    const products = Array.from(new Set(b.products ?? []));
    if (products.length && !this.d.cart) throw new PublicCartError("no_online", "Los productos todavía no se contratan en línea: contrata el plan y añádelos después desde el panel", products[0]);
    const cart = this.d.cart ? await this.d.cart.validate({ plan: b.plan, interval: b.interval, products }) : null;
    // El total que vio el comprador (opcional, solo para comparar): si el precio cambió, se avisa antes de cobrar
    if (cart && b.expectedFirstChargeNetCents !== undefined && b.expectedFirstChargeNetCents !== cart.lines.firstChargeCents) {
      throw new SelfServiceError(409, "price_changed", "El importe ha cambiado desde que revisaste el carrito: revísalo de nuevo antes de pagar");
    }

    const key = orderKeyOf(b.idempotencyKey);
    // Repetición de la MISMA petición: el mismo pedido y la misma sesión de pago (sin otra empresa)
    let orderKey = key;
    let reuseCompany: number | null = null;
    const existing = await this.d.orders.byKey(key);
    if (existing) {
      const r = await this.resume(existing, key, b, products);
      if ("start" in r) return r.start;
      orderKey = r.orderKey;
      reuseCompany = existing.companyId;
    }

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
    const holder = b.buyer && b.buyer.type === "consumer" ? `${b.buyer.firstName} ${b.buyer.lastName}` : null;
    // Plan personal: la ficha del CRM es el hogar (su nombre, o «Hogar de» y el titular); el titular es el contacto
    const name = isPersonalCheckoutPlan(b.plan) ? (b.household?.name ?? `Hogar de ${holder}`) : b.buyer ? (b.buyer.type === "business" ? b.buyer.legalName : holder!) : b.company!.name;
    const taxId = b.buyer ? b.buyer.taxId : b.company!.taxId;
    // Otra selección del mismo comprador (misma clave): la misma empresa, sin otra ficha ni otro contacto
    const company = reuseCompany !== null ? { id: reuseCompany } : await this.d.crm.createCompany({ name, ...(taxId ? { taxId } : {}), email: b.admin.email }, ACTOR);
    if (reuseCompany === null) await this.d.crm.createContact(company.id, { name: b.admin.name, email: b.admin.email, role: "Administración", isPrimary: true }, ACTOR);
    const { order } = await this.d.orchestrator.create({ idempotencyKey: orderKey, companyId: company.id, request: { plan: b.plan, interval: b.interval, items: cart ? cart.request.items : [] } }, ACTOR);
    if (b.buyer) {
      try {
        const consent = buildConsent(order.id, b.buyer.type, b.consents, versions, "web", now);
        await this.d.buyers!.saveBuyerProfile(toBuyerProfile(order.id, b.buyer, consent, now), ACTOR);
      } catch (e) {
        throw this.buyerError(e);
      }
    }
    // Aceptación registrada: versión de las condiciones y huella de la petición (sin datos personales)
    const evidence = crypto.createHash("sha256").update(`${orderKey}|${b.consents.termsVersion}|${now}`).digest("hex").slice(0, 16);
    const accepted = (await this.d.orchestrator.accept(order.id, { signatureRef: `web-terms:${b.consents.termsVersion}:${evidence}` }, ACTOR)).order;
    if (accepted.state !== "contracted") throw new SelfServiceError(409, "not_contracted", "No se ha podido preparar la contratación");
    opsLog("info", "SelfService", "order_ready", { orderId: order.id, plan: b.plan, interval: b.interval, products: products.length,...(b.buyer ? { buyerType: b.buyer.type } : {}) });
    return this.d.checkout.start(order.id, ACTOR);
  }

  /**
   * La misma clave ya tiene pedido. Mismo carrito: su sesión de pago (o el error si ya se pagó). Otro carrito: los pedidos
   * SIN pagar de esa clave se cierran (sesión caducada en Stripe y pedido rechazado) y se crea otro para la misma empresa.
   * Si alguno ya se pagó o está en curso, no se toca nada: nunca dos cobros ni dos suscripciones.
   */
  private async resume(existing: CommercialOrder, key: string, b: SelfServiceBody, products: string[]): Promise<{ start: CheckoutStart } | { orderKey: string }> {
    const chain = this.d.orders.list ? (await this.d.orders.list({ companyId: existing.companyId })).filter((o) => o.idempotencyKey === key || o.idempotencyKey.startsWith(`${key}-v`)) : [existing];
    const open = chain.filter((o) => o.state !== "rejected" && o.state !== "superseded");
    const same = open.filter((o) => sameCart(o, b, products)).sort((x, y) => y.id - x.id)[0];
    if (same) return { start: await this.d.checkout.start(same.id, ACTOR) };
    const { reject } = this.d.orchestrator;
    const { expire } = this.d.checkout;
    if (!this.d.orders.list || !reject || !expire || !this.d.sessions) throw new SelfServiceError(409, "idempotency_mismatch", "Esta contratación ya se inició con otra selección: vuelve a revisar el carrito");
    const inProgress = () => new SelfServiceError(409, "payment_in_progress", "Ya hay un pago de esta contratación completado o en curso: consulta su estado antes de cambiar la selección");
    for (const o of open) if (o.confirmation || !["requested", "quoted", "contracted"].includes(o.state) || (await this.d.sessions.hasCompletedSession(o.id))) throw inProgress();
    for (const o of open) {
      try {
        await expire.call(this.d.checkout, o.id, ACTOR);
      } catch {
        throw inProgress();
      }
      // Pagado justo antes de caducar: se conserva (lo confirmará el webhook)
      if (await this.d.sessions.hasCompletedSession(o.id)) throw inProgress();
      await reject.call(this.d.orchestrator, o.id, { reason: "Sustituido por otra selección en la web" }, ACTOR);
      opsLog("info", "SelfService", "order_superseded", { orderId: o.id });
    }
    return { orderKey: `${key}-v${chain.length}` };
  }

  /** Error tipado si falta el plan o no es un plan de Checkout (null si el plan es de los de Checkout). */
  async planProblem(plan: unknown): Promise<PublicCartError | null> {
    if (typeof plan === "string" && (CHECKOUT_PLANS as readonly string[]).includes(plan)) return null;
    if (!this.d.cart) return typeof plan === "string" && plan.trim() ? null : new PublicCartError("plan_required", "Elige un plan Elephant Core: es obligatorio en toda contratación");
    return this.d.cart.checkPlan(plan).then(
      () => null,
      (e) => (e instanceof PublicCartError ? e : Promise.reject(e)),
    );
  }

  /** Qué se puede comprar en línea (planes y productos de la lista blanca que pasan todas las reglas). */
  async offer() {
    if (!this.d.cart) throw new PublicCartError("unavailable", "La venta en línea no está disponible");
    return { enabled: true, ...(await this.d.cart.offer()) };
  }

  /**
   * Presupuesto del carrito calculado por el servidor (no crea ni guarda nada): las mismas reglas y los mismos importes
   * que cobrará Stripe. El impuesto es orientativo: el definitivo lo calcula Stripe Tax en la página de pago.
   */
  async quote(b: CartQuoteBody) {
    if (!this.d.cart) throw new PublicCartError("unavailable", "La venta en línea no está disponible");
    const v = await this.d.cart.validate({ plan: b.plan, interval: b.interval, products: b.products ?? [] }, { cachedPrices: true });
    const treatment = this.d.taxTreatment ?? null;
    let rateBp: number | null = null;
    let eligibility: { eligible: boolean; reasons: string[]; scenario: string | null } | undefined;
    if (treatment === "stripe_tax_exclusive") {
      if (b.buyer) {
        // Una caída de VIES no rompe el presupuesto: se responde sin estimación del impuesto
        const r = await this.eligibilityOf(b.buyer).catch(() => null);
        if (!r) return this.quoteView(v, treatment, null, undefined);
        const reasons = r.reasons.filter((x) => x !== "address_incomplete");
        eligibility = { eligible: reasons.length === 0, reasons, scenario: r.scenario };
        // Particulares con tipo decidido: ese. España peninsular sujeta a IVA: el del catálogo. Inversión del sujeto
        // pasivo o no sujeto: sin impuesto en la factura. Lo demás, sin estimación
        rateBp = !eligibility.eligible
          ? null
          : (r.displayRateBp ?? (r.taxExpectation === "taxed" && r.territory === "es_mainland" ? v.quote.totals.taxRateBp : r.taxExpectation === "reverse_charge" || r.taxExpectation === "not_subject" ? 0 : null));
      } else rateBp = v.quote.totals.taxRateBp;
    }
    return this.quoteView(v, treatment, rateBp, eligibility);
  }

  private quoteView(v: Awaited<ReturnType<PublicCart["validate"]>>, treatment: string | null, rateBp: number | null, eligibility: { eligible: boolean; reasons: string[]; scenario: string | null } | undefined) {
    const lines = [...v.lines.recurring, ...v.lines.deferred];
    const est = displayPrice(v.lines.firstChargeCents, rateBp);
    return {
      ok: true as const,
      catalogVersion: v.quote.catalogVersion,
      currency: "EUR" as const,
      plan: v.quote.plan,
      lines: lines.map((l) => ({ key: l.productKey, name: l.name, family: v.quote.lines.find((x) => x.key === l.productKey)?.family ?? null, quantity: l.quantity, unitCents: l.unitAmountCents, amountCents: l.unitAmountCents * l.quantity, interval: l.interval })),
      totals: { firstChargeNetCents: v.lines.firstChargeCents, monthlyNetCents: v.lines.monthlyCents, yearlyNetCents: v.lines.yearlyCents },
      tax: { treatment, estimatedRateBp: est.rateBp, estimatedTaxCents: est.taxCents, estimatedGrossCents: est.grossCents, final: false as const },
      ...(eligibility ? { eligibility } : {}),
    };
  }

  /** Elegibilidad de un comprador con la configuración aprobada (en live, con domicilio si se puede guardar). */
  private eligibilityOf(b: BuyerForEligibility): Promise<EligibilityResult> {
    return buyerEligibility(this.d, b);
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

/** Respuesta de error tipada del carrito y del autoservicio (la web muestra `message`). */
function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof PublicCartError) return void res.status(e.status).json({ error: e.code, message: e.message, ...(e.product ? { product: e.product } : {}) });
  if (e instanceof SelfServiceError) return void res.status(e.status).json({ error: e.code, message: e.message });
  if (e instanceof StripeCheckoutError) return void res.status(e.code === "not_found" ? 404 : e.code === "unavailable" ? 503 : 409).json({ error: e.code, message: e.code === "unavailable" ? "El pago en línea no está disponible ahora mismo: inténtalo más tarde" : "No se ha podido iniciar el pago" });
  // Ya hay una empresa con ese identificador fiscal (o ese nombre): no se crea otra (ni otra suscripción)
  if (e instanceof CrmError && e.code === "conflict") {
    return void res.status(409).json(
      /identificador fiscal/i.test(e.message)
        ? { error: "company_exists", message: "Ya hay una empresa registrada con este NIF. Si ya es cliente, añade los productos desde su panel; si no, escríbenos y te ayudamos" }
        : { error: "company_name_taken", message: "Ya hay una empresa registrada con este nombre: revisa el nombre o la razón social, o escríbenos y te ayudamos" },
    );
  }
  // El pedido no se pudo preparar (el catálogo cambió entre la validación y el alta, o la clave ya se usó con otra petición)
  if (e instanceof OrderError) return void res.status(e.code === "not_found" ? 404 : 409).json({ error: e.code === "conflict" ? "idempotency_conflict" : "not_contractable", message: "No se ha podido preparar la contratación: revisa el carrito e inténtalo de nuevo" });
  opsLog("error", "SelfService", ctx, { error: e instanceof Error ? e.name : "error" });
  if (ctx === "internal_error") recordFailure("stripe.self_service_failed");
  res.status(500).json({ error: "internal_error", message: "Error interno" });
}

export function createSelfServiceRouter(svc: SelfServiceCheckout, origins: Set<string>): Router {
  const r = express.Router();
  const originOk = (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const o = req.headers.origin;
    if (typeof o === "string" && origins.has(o)) return true;
    res.status(403).json({ error: "origin_not_allowed" });
    return false;
  };
  /** Sin plan (o con un producto en su lugar): error tipado antes de validar el resto del formulario. */
  const planProblem = (body: unknown) => svc.planProblem((body as { plan?: unknown } | null)?.plan);
  r.get(
    "/offer",
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
    (req: Request, res: Response) => {
      if (!originOk(req, res)) return;
      svc
        .offer()
        .then((x) => res.json(x))
        .catch((e) => sendError(res, e, "offer_error"));
    },
  );
  r.post(
    "/quote",
    rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }),
    (req: Request, res: Response) => {
      if (!originOk(req, res)) return;
      planProblem(req.body)
        .then((p) => {
          if (p) throw p;
          const parsed = cartQuoteBody.safeParse(req.body);
          if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "Revisa el plan, la periodicidad y los productos" });
          return svc.quote(parsed.data).then((x) => void res.json(x));
        })
        .catch((e) => sendError(res, e, "quote_error"));
    },
  );
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
      planProblem(req.body)
        .then((p) => {
          if (p) throw p;
          const parsed = selfServiceBody.safeParse(req.body);
          if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "Revisa los datos del formulario" });
          return svc.start(parsed.data).then((s) => void res.json({ sessionId: s.sessionId, url: s.url, expiresAt: s.expiresAt }));
        })
        .catch((e) => sendError(res, e, "internal_error"));
    },
  );
  return r;
}
