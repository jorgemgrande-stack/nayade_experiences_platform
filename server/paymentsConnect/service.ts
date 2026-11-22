/**
 * Cobros con la cuenta Stripe de la empresa: casos de uso (conexión, estado, sesión de pago de un presupuesto y
 * aplicación de eventos). Sin Express ni SQL: todo entra por puertos (`PaymentStore`, `ConnectGateway`, `QuotePort`),
 * así las pruebas ejercitan las reglas reales con dobles.
 *
 * Reglas que impone este módulo (docs/architecture/COBROS_POR_EMPRESA_STRIPE.md):
 *  - sin cuenta verificada y cobros en línea encendidos, no se crea ninguna sesión de pago;
 *  - importe y moneda salen del presupuesto, nunca del navegador;
 *  - un presupuesto solo pasa a pagado con el evento firmado (nunca por la redirección);
 *  - cada evento y cada sesión se aplican una sola vez; un evento de otra cuenta queda aislado.
 */
import { deriveAccountStatus, eurosToCents, onlinePaymentsAvailable, type PaymentMode, type StripeAccountFacts } from "../../shared/paymentAccounts";
import type { ConnectConfig } from "./config";
import type { AccountIndexWriter } from "./accountIndex";
import type { ConnectGateway } from "./gateway";
import type { PaymentAccountRow, PaymentStore } from "./store";

export class PaymentsError extends Error {
  constructor(readonly code: "not_configured" | "not_connected" | "not_verified" | "online_disabled" | "quote_unavailable" | "unsupported_quote" | "bad_amount" | "cannot_enable" | "account_conflict", message: string) {
    super(message);
    this.name = "PaymentsError";
  }
}

export interface QuoteInfo {
  id: number;
  total: string;
  status: string;
  paidAt: Date | null;
  validUntil: Date | null;
  hasPaymentPlan: boolean;
  title: string | null;
  email: string | null;
  currency: string;
}

export interface QuotePort {
  byToken(token: string): Promise<QuoteInfo | null>;
  /** Marca el presupuesto como pagado con la lógica de siempre (factura, reserva, inscripción…). Idempotente. */
  markPaid(quoteId: number, reference: string): Promise<void | { alreadyPaid: true }>;
}

/** Pedidos de la tienda web: aplica el resultado de un pago con EL MISMO tratamiento que Redsys (reservas, factura, stock…). */
export interface ShopPort {
  applyPaid(merchantOrder: string, p: { amountCents: number; sessionId: string; paymentIntent: string | null }): Promise<void>;
  applyFailed(merchantOrder: string, p: { sessionId: string }): Promise<void>;
}

export interface PaymentsDeps {
  store: PaymentStore;
  gateway: ConnectGateway;
  config: ConnectConfig;
  quotes: QuotePort;
  shop: ShopPort;
  /** Reserva global de la cuenta (una cuenta, una empresa). */
  index: AccountIndexWriter;
  tenantId: string;
  now?: () => number;
}

export async function connectAccount(d: PaymentsDeps, p: { email?: string | null; returnUrl: string; refreshUrl: string; by: string | null }): Promise<{ url: string; account: PaymentAccountRow }> {
  const now = (d.now ?? Date.now)();
  // En modo Real NUNCA se crea una cuenta: se vincula la que la empresa ya tiene (linkExistingAccount)
  if (d.config.mode !== "test") throw new PaymentsError("not_configured", "En modo Real se vincula la cuenta de Stripe que la empresa ya tiene");
  let account = await d.store.getAccount(d.config.mode);
  if (!account) {
    const created = await d.gateway.createAccount({ tenantId: d.tenantId, email: p.email, country: "ES", idempotencyKey: `connect-acct-v2-${d.tenantId}-${d.config.mode}` });
    // Antes de guardarla, la cuenta se reserva para ESTA empresa en el índice global: si ya es de otra, no se vincula
    const claim = await d.index.claim(d.tenantId, d.config.mode, created.accountId);
    if (!claim.ok) throw new PaymentsError("account_conflict", "Esa cuenta de Stripe ya está vinculada a otra empresa");
    account = await d.store.insertAccount(d.config.mode, created.accountId, now, p.by);
  }
  const link = await d.gateway.createAccountLink({ accountId: account.accountId, returnUrl: p.returnUrl, refreshUrl: p.refreshUrl });
  return { url: link.url, account };
}

/**
 * Modo Real: vincula la cuenta de Stripe que la empresa YA tiene. La empresa la autoriza en Stripe (OAuth) y vuelve con un
 * código de un solo uso; aquí se cambia por el identificador de la cuenta, se reserva en el índice global (una cuenta, una
 * empresa) y se lee su estado real. Nunca sustituye una cuenta ya vinculada por otra distinta.
 */
export async function linkExistingAccount(d: PaymentsDeps, p: { code: string; by: string | null }): Promise<PaymentAccountRow> {
  if (d.config.mode !== "live") throw new PaymentsError("not_configured", "El vínculo de una cuenta existente solo existe en modo Real");
  const now = (d.now ?? Date.now)();
  const authorized = await d.gateway.exchangeOAuthCode(p.code);
  if (!authorized.livemode) throw new PaymentsError("account_conflict", "La cuenta autorizada no es una cuenta real de Stripe");
  const existing = await d.store.getAccount("live");
  if (existing && existing.accountId !== authorized.accountId) throw new PaymentsError("account_conflict", "Esta empresa ya tiene otra cuenta real vinculada");
  if (!existing) {
    const claim = await d.index.claim(d.tenantId, "live", authorized.accountId);
    if (!claim.ok) throw new PaymentsError("account_conflict", "Esa cuenta de Stripe ya está vinculada a otra empresa");
    await d.store.insertAccount("live", authorized.accountId, now, p.by);
  }
  const refreshed = await refreshAccount(d, p.by);
  if (!refreshed) throw new PaymentsError("not_connected", "No se pudo leer la cuenta vinculada");
  return refreshed;
}

function applyFacts(d: PaymentsDeps, facts: StripeAccountFacts, by: string | null) {
  return d.store.updateAccount(d.config.mode, { ...facts, status: deriveAccountStatus(facts), now: (d.now ?? Date.now)(), by });
}

/** Relee la cuenta en Stripe (a demanda). Lo que dice el navegador no cuenta. */
export async function refreshAccount(d: PaymentsDeps, by: string | null): Promise<PaymentAccountRow | null> {
  const account = await d.store.getAccount(d.config.mode);
  if (!account) return null;
  return applyFacts(d, await d.gateway.retrieveAccount(account.accountId), by);
}

export async function setOnlineEnabled(d: Pick<PaymentsDeps, "store" | "now">, mode: PaymentMode, enabled: boolean, by: string | null): Promise<PaymentAccountRow | null> {
  const ok = await d.store.setOnline(mode, enabled, (d.now ?? Date.now)(), by);
  if (enabled && !ok) throw new PaymentsError("cannot_enable", "Solo se pueden activar los cobros en línea con la cuenta verificada");
  return d.store.getAccount(mode);
}

/** ¿Puede esta empresa cobrar en línea hoy (en el modo configurado)? Lo usa la página pública para mostrar el botón. */
export async function onlineAvailable(d: Pick<PaymentsDeps, "store" | "config">): Promise<boolean> {
  const a = await d.store.getAccount(d.config.mode);
  return !!a && onlinePaymentsAvailable({ status: a.status, onlineEnabled: a.onlineEnabled });
}

export async function startQuoteCheckout(
  d: PaymentsDeps,
  p: { token: string; successUrl: string; cancelUrl: string },
): Promise<{ url: string; sessionId: string }> {
  const account = await d.store.getAccount(d.config.mode);
  if (!account) throw new PaymentsError("not_connected", "Esta empresa aún no tiene cobros en línea");
  if (account.status !== "verificada") throw new PaymentsError("not_verified", "La cuenta de cobros de la empresa no está verificada");
  if (!account.onlineEnabled) throw new PaymentsError("online_disabled", "Los cobros en línea no están activados");
  const quote = await d.quotes.byToken(p.token);
  if (!quote) throw new PaymentsError("quote_unavailable", "Presupuesto no encontrado");
  const now = (d.now ?? Date.now)();
  if (quote.paidAt || quote.status === "rechazado") throw new PaymentsError("quote_unavailable", "Este presupuesto ya no admite pago");
  if (quote.status !== "aceptado" && quote.validUntil && quote.validUntil.getTime() < now) throw new PaymentsError("quote_unavailable", "Este presupuesto ha expirado");
  // Primera entrega: pago único. Un plan de pagos (cuotas) sigue por los medios de siempre.
  if (quote.hasPaymentPlan) throw new PaymentsError("unsupported_quote", "Este presupuesto tiene un plan de pagos: el cobro por cuotas con Stripe aún no está disponible");
  const amountCents = eurosToCents(quote.total);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new PaymentsError("bad_amount", "El presupuesto tiene un importe no válido");
  const currency = quote.currency.toLowerCase();
  // Un presupuesto no puede tener DOS sesiones abiertas: con la clave por ventana de tiempo, una segunda sesión (otra
  // pestaña, otra ventana de 30 min) dejaba la primera pagable 24 h y el cliente podía pagar dos veces. Antes de abrir una
  // nueva se cierran las anteriores; si alguna ya está pagada (o pagándose), no se abre otra.
  const previous = await d.store.listQuoteCheckouts(quote.id);
  for (const c of previous) {
    if (c.status === "paid") throw new PaymentsError("quote_unavailable", "Este presupuesto ya tiene un pago registrado");
    if (c.status !== "pending") continue;
    const r = await d.gateway.expireCheckoutSession({ accountId: account.accountId, sessionId: c.sessionId });
    if (r === "completed") throw new PaymentsError("quote_unavailable", "Este presupuesto ya tiene un pago en curso: espera a que se confirme");
    await d.store.setCheckoutStatus(c.sessionId, "expired");
  }
  const session = await d.gateway.createCheckoutSession({
    accountId: account.accountId,
    // La clave cambia con cada sesión anterior: dos clics a la vez comparten sesión; un intento nuevo, no
    idempotencyKey: `co-${d.tenantId}-${quote.id}-${amountCents}-${previous.length}`,
    amountCents,
    currency,
    description: quote.title ?? `Presupuesto ${quote.id}`,
    customerEmail: quote.email,
    successUrl: p.successUrl,
    cancelUrl: p.cancelUrl,
    metadata: { tenant_id: d.tenantId, quote_id: String(quote.id) },
  });
  if (!(await d.store.getCheckout(session.id))) {
    await d.store.insertCheckout({ sessionId: session.id, mode: d.config.mode, accountId: account.accountId, kind: "quote", quoteId: quote.id, merchantOrder: null, amountCents, currency, createdAt: now });
  }
  return { url: session.url, sessionId: session.id };
}

/** Mínimo de Stripe para cobrar con tarjeta en euros. */
export const STRIPE_MIN_AMOUNT_CENTS = 50;

/**
 * Sesión de pago de un pedido de la tienda (carrito). El importe lo calcula el servidor al crear el pedido (con sus
 * descuentos); aquí solo se cobra ese importe en la cuenta de la empresa. El pedido sigue pendiente (reservas en
 * `pending_payment`) hasta el evento firmado.
 */
export async function startShopCheckout(
  d: PaymentsDeps,
  p: { merchantOrder: string; amountCents: number; description: string; email?: string | null; successUrl: string; cancelUrl: string },
): Promise<{ url: string; sessionId: string }> {
  const account = await d.store.getAccount(d.config.mode);
  if (!account) throw new PaymentsError("not_connected", "Esta empresa aún no tiene cobros en línea");
  if (account.status !== "verificada") throw new PaymentsError("not_verified", "La cuenta de cobros de la empresa no está verificada");
  if (!account.onlineEnabled) throw new PaymentsError("online_disabled", "Los cobros en línea no están activados");
  if (!Number.isInteger(p.amountCents) || p.amountCents < STRIPE_MIN_AMOUNT_CENTS) throw new PaymentsError("bad_amount", "El importe del pedido no es válido para pagar con tarjeta");
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(p.merchantOrder)) throw new PaymentsError("bad_amount", "Pedido no válido");
  const now = (d.now ?? Date.now)();
  const session = await d.gateway.createCheckoutSession({
    accountId: account.accountId,
    idempotencyKey: `shop-${d.tenantId}-${p.merchantOrder}-${p.amountCents}`,
    amountCents: p.amountCents,
    currency: "eur",
    description: p.description,
    customerEmail: p.email ?? null,
    successUrl: p.successUrl,
    cancelUrl: p.cancelUrl,
    // Mínimo de Stripe: 30 minutos. Pasado ese tiempo la sesión caduca y el pedido lo cancela la limpieza de siempre
    expiresAtSeconds: Math.floor(now / 1000) + 31 * 60,
    metadata: { tenant_id: d.tenantId, merchant_order: p.merchantOrder },
  });
  if (!(await d.store.getCheckout(session.id))) {
    await d.store.insertCheckout({ sessionId: session.id, mode: d.config.mode, accountId: account.accountId, kind: "shop_order", quoteId: null, merchantOrder: p.merchantOrder, amountCents: p.amountCents, currency: "eur", createdAt: now });
  }
  return { url: session.url, sessionId: session.id };
}

// ─── Eventos ──────────────────────────────────────────────────────────────────

/** Forma mínima del evento de Stripe que usamos (el SDK la cumple). */
export interface ConnectEvent {
  id: string;
  type: string;
  livemode: boolean;
  /** Cuenta conectada que originó el evento. */
  account?: string | null;
  created?: number;
  data: { object: Record<string, any> };
}

/** «duplicate_payment»: se cobró una sesión de un presupuesto que YA estaba pagado. No se factura de nuevo: queda para reembolso manual. */
export type EventOutcome = "applied" | "duplicate" | "ignored" | "isolated" | "mode_mismatch" | "failed" | "amount_mismatch" | "duplicate_payment";

/** Empresa a la que el emisor dice que pertenece el evento (metadato que pusimos nosotros). Se contrasta luego con su base. */
export function claimedTenantId(ev: ConnectEvent): string | null {
  const m = ev.data?.object?.metadata;
  const t = m && typeof m === "object" ? (m as Record<string, unknown>).tenant_id : null;
  return typeof t === "string" && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(t) ? t : null;
}

const HANDLED = new Set(["account.updated", "account.application.deauthorized", "checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"]);

export function factsFromEventAccount(o: Record<string, any>): StripeAccountFacts {
  const r = o.requirements ?? {};
  return {
    chargesEnabled: !!o.charges_enabled,
    payoutsEnabled: !!o.payouts_enabled,
    detailsSubmitted: !!o.details_submitted,
    requirementsDue: Array.from(new Set([...(Array.isArray(r.currently_due) ? r.currently_due : []), ...(Array.isArray(r.past_due) ? r.past_due : [])].map(String))),
    disabledReason: typeof r.disabled_reason === "string" ? r.disabled_reason : null,
  };
}

/**
 * Aplica un evento YA VERIFICADO (firma comprobada fuera) en la base de esta empresa. Nunca lanza por eventos ajenos o
 * repetidos; lanza solo si fallar al aplicar un pago real, para que Stripe reintente (el evento queda «failed» y
 * reintentable).
 */
export async function handleConnectEvent(d: PaymentsDeps, ev: ConnectEvent): Promise<EventOutcome> {
  const now = (d.now ?? Date.now)();
  const mode = d.config.mode;
  if (ev.livemode !== (mode === "live")) return "mode_mismatch";
  if (!HANDLED.has(ev.type)) return "ignored";

  const account = await d.store.getAccount(mode);
  // Un evento de otra cuenta (o de una empresa sin cuenta vinculada) no se aplica ni deja rastro en esta empresa
  if (!account || !ev.account || ev.account !== account.accountId) return "isolated";

  const fresh = await d.store.claimEvent({ eventId: ev.id, accountId: ev.account, mode, type: ev.type, outcome: "processing", at: now });
  if (!fresh && !(await d.store.reclaimFailedEvent(ev.id))) return "duplicate";

  try {
    const outcome = await applyEvent(d, ev, now);
    await d.store.setEventOutcome(ev.id, outcome);
    await d.store.noteEvent(mode, { id: ev.id, type: ev.type, at: now });
    return outcome;
  } catch (e) {
    await d.store.setEventOutcome(ev.id, "failed").catch(() => undefined);
    throw e;
  }
}

/** Cierra, sin fallar nunca, las sesiones aún abiertas del presupuesto distintas de la pagada (best effort). */
async function closeOtherQuoteSessions(d: PaymentsDeps, accountId: string, quoteId: number, paidSessionId: string): Promise<void> {
  try {
    for (const c of await d.store.listQuoteCheckouts(quoteId)) {
      if (c.sessionId === paidSessionId || c.status !== "pending") continue;
      const r = await d.gateway.expireCheckoutSession({ accountId, sessionId: c.sessionId });
      if (r !== "completed") await d.store.setCheckoutStatus(c.sessionId, "expired");
    }
  } catch {
    /* el pago ya está aplicado: un fallo al cerrar otras sesiones no lo deshace (se reintenta al abrir otra o al cobrar) */
  }
}

async function applyEvent(d: PaymentsDeps, ev: ConnectEvent, now: number): Promise<EventOutcome> {
  const o = ev.data.object;
  if (ev.type === "account.application.deauthorized") {
    // La empresa (o Stripe) ha retirado el acceso de la plataforma: deja de cobrar de inmediato (el interruptor se apaga)
    await applyFacts(d, { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true, requirementsDue: [], disabledReason: "deauthorized" }, "Stripe");
    return "applied";
  }
  if (ev.type === "account.updated") {
    await applyFacts(d, factsFromEventAccount(o), "Stripe");
    return "applied";
  }
  const sessionId = typeof o.id === "string" ? o.id : "";
  const checkout = sessionId ? await d.store.getCheckout(sessionId) : null;
  // Sesión que no creó esta empresa (o de otra cuenta): sin efecto
  if (!checkout || checkout.accountId !== ev.account) return "isolated";
  if (ev.type === "checkout.session.expired") {
    await d.store.setCheckoutStatus(sessionId, "expired");
    return "applied";
  }
  if (ev.type === "checkout.session.async_payment_failed") {
    await d.store.setCheckoutStatus(sessionId, "failed");
    if (checkout.kind === "shop_order" && checkout.merchantOrder) await d.shop.applyFailed(checkout.merchantOrder, { sessionId });
    return "applied";
  }
  // checkout.session.completed / async_payment_succeeded: solo cuenta con el pago realmente cobrado
  if (o.payment_status !== "paid") return "ignored";
  if (o.amount_total !== checkout.amountCents || String(o.currency ?? "").toLowerCase() !== checkout.currency) {
    // El importe cobrado no es el del presupuesto: no se aplica solo (queda registrado para revisión, sin reintentos)
    return "amount_mismatch";
  }
  const pi = typeof o.payment_intent === "string" ? o.payment_intent : null;
  const won = await d.store.markCheckoutPaid(sessionId, pi, now);
  if (!won) return "duplicate";
  try {
    if (checkout.kind === "shop_order") {
      if (!checkout.merchantOrder) throw new PaymentsError("quote_unavailable", "Sesión de pedido sin referencia");
      await d.shop.applyPaid(checkout.merchantOrder, { amountCents: checkout.amountCents, sessionId, paymentIntent: pi });
    } else {
      const r = await d.quotes.markPaid(checkout.quoteId!, `stripe:${pi ?? sessionId}`);
      // Se cobró una sesión de un presupuesto que ya estaba pagado: no se factura de nuevo (la factura ya existe) y el
      // cargo queda trazado como «duplicate_payment» (evento + ficha del presupuesto) para su reembolso manual
      if (r && r.alreadyPaid) return "duplicate_payment";
      // Presupuesto pagado: se cierran sus otras sesiones abiertas para que no puedan cobrarse
      await closeOtherQuoteSessions(d, checkout.accountId, checkout.quoteId!, sessionId);
    }
  } catch (e) {
    await d.store.revertCheckoutPaid(sessionId).catch(() => undefined);
    throw e;
  }
  return "applied";
}
