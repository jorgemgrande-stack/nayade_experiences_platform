/**
 * Doble de Stripe para pruebas: sin red ni claves. Imita lo que nos importa del comportamiento real:
 * la misma Idempotency-Key devuelve el mismo objeto, los Prices se buscan por lookup_key y las
 * sesiones se pueden caducar. Registra cada llamada para poder comprobar qué se envió.
 */
import type { CheckoutSessionInput, GwCharge, GwCheckoutSession, GwEvent, GwInvoice, GwPrice, GwProduct, GwSubscription, StripeGateway } from "./gateway";

export class FakeStripeGateway implements StripeGateway {
  prices: GwPrice[] = [];
  products = new Map<string, GwProduct>();
  customers = new Map<string, { id: string; deleted: boolean; name: string; email: string | null; metadata: Record<string, string> }>();
  sessions = new Map<string, GwCheckoutSession & { input: CheckoutSessionInput }>();
  subscriptions = new Map<string, GwSubscription>();
  invoices = new Map<string, GwInvoice>();
  charges = new Map<string, GwCharge>();
  /** Reembolsos y disputas → su cargo. */
  chargeRefs = new Map<string, string>();
  /** Si es un objeto, la próxima creación de sesión con esa clave devuelve esta sesión (respuesta repetida de Stripe). */
  replay = new Map<string, string>();
  /** Eventos que «emite» Stripe (para la conciliación); el más reciente al principio, como la API. */
  events: GwEvent[] = [];
  /** Si es true, cada llamada falla como una caída de Stripe (error de red reintentable). */
  down = false;
  calls: Array<{ op: string; key?: string; input?: unknown }> = [];
  private idem = new Map<string, string>();
  private seq = 0;
  private next = (p: string) => `${p}_test_${String(++this.seq).padStart(10, "0")}`;

  addProduct(p: Partial<GwProduct> & { id: string }) {
    this.products.set(p.id, { name: "Producto", active: true, metadata: {}, ...p });
  }
  addPrice(p: Partial<GwPrice> & { id: string; productId: string }) {
    this.prices.push({ lookupKey: null, active: true, currency: "EUR", unitAmount: 0, type: "recurring", interval: "month", intervalCount: 1, taxBehavior: "exclusive", metadata: {}, ...p });
  }

  async pricesByLookupKeys(keys: string[]) {
    this.calls.push({ op: "prices.list", input: keys });
    return this.prices.filter((p) => p.lookupKey && keys.includes(p.lookupKey)).map((p) => ({ ...p, metadata: { ...p.metadata } }));
  }
  async product(id: string) {
    this.calls.push({ op: "products.retrieve", input: id });
    const p = this.products.get(id);
    return p ? { ...p, metadata: { ...p.metadata } } : null;
  }
  async createCustomer(input: { name: string; email: string | null; metadata: Record<string, string> }, key: string) {
    this.calls.push({ op: "customers.create", key, input });
    const prev = this.idem.get(`cus:${key}`);
    if (prev) return { id: prev };
    const id = this.next("cus");
    this.customers.set(id, { id, deleted: false, ...input });
    this.idem.set(`cus:${key}`, id);
    return { id };
  }
  async customer(id: string) {
    const c = this.customers.get(id);
    return c ? { id: c.id, deleted: c.deleted } : null;
  }
  async createCheckoutSession(input: CheckoutSessionInput, key: string) {
    this.calls.push({ op: "checkout.sessions.create", key, input });
    const prev = this.idem.get(`cs:${key}`) ?? this.replay.get(key);
    if (prev) return this.view(prev);
    const id = this.next("cs");
    this.sessions.set(id, { id, status: "open", paymentStatus: "unpaid", url: `https://checkout.stripe.test/c/pay/${id}`, customerId: input.customerId, subscriptionId: null, clientReferenceId: input.clientReferenceId, metadata: { ...input.metadata }, expiresAt: input.expiresAt, input });
    this.idem.set(`cs:${key}`, id);
    return this.view(id);
  }
  async checkoutSession(id: string) {
    return this.sessions.has(id) ? this.view(id) : null;
  }
  async expireCheckoutSession(id: string) {
    this.calls.push({ op: "checkout.sessions.expire", input: id });
    const s = this.sessions.get(id);
    if (!s) throw new Error("no existe");
    if (s.status === "open") this.sessions.set(id, { ...s, status: "expired", url: null });
    return this.view(id);
  }
  async subscription(id: string) {
    this.guard();
    const s = this.subscriptions.get(id);
    return s ? { ...s, priceIds: [...s.priceIds], metadata: { ...s.metadata } } : null;
  }
  async invoice(id: string) {
    this.guard();
    const i = this.invoices.get(id);
    return i ? { ...i } : null;
  }
  async charge(id: string) {
    this.guard();
    const c = this.charges.get(id);
    return c ? { ...c } : null;
  }
  async chargeIdOf(_t: "refund" | "dispute", id: string) {
    this.guard();
    return this.chargeRefs.get(id) ?? null;
  }
  /** Cargo que pagó una factura (lo que Stripe crea al cobrarla). */
  chargeForInvoice(invoiceId: string) {
    const inv = this.invoices.get(invoiceId)!;
    const id = this.next("ch");
    this.charges.set(id, { id, customerId: inv.customerId, amount: inv.amountPaid, amountRefunded: 0, refunded: false, currency: inv.currency, invoiceId, disputeStatus: null });
    return id;
  }
  /** Reembolso (total si no se indica importe). Devuelve el id del reembolso. */
  refund(chargeId: string, amount?: number) {
    const c = this.charges.get(chargeId)!;
    const refunded = Math.min(c.amount, c.amountRefunded + (amount ?? c.amount));
    this.charges.set(chargeId, { ...c, amountRefunded: refunded, refunded: refunded >= c.amount });
    const id = this.next("re");
    this.chargeRefs.set(id, chargeId);
    return id;
  }
  /** Abre o cambia la disputa del cargo. Devuelve el id de la disputa. */
  dispute(chargeId: string, status: string, id?: string) {
    const c = this.charges.get(chargeId)!;
    this.charges.set(chargeId, { ...c, disputeStatus: status });
    const did = id ?? this.next("dp");
    this.chargeRefs.set(did, chargeId);
    return did;
  }
  async listEvents(q: { createdGte?: number; types?: string[]; startingAfter?: string; limit?: number }) {
    this.guard();
    let list = this.events.filter((e) => (q.createdGte === undefined || e.created >= q.createdGte) && (!q.types || q.types.includes(e.type)));
    if (q.startingAfter) list = list.slice(list.findIndex((e) => e.id === q.startingAfter) + 1);
    const limit = q.limit ?? 100;
    return { events: list.slice(0, limit).map((e) => ({ ...e })), hasMore: list.length > limit };
  }
  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    this.calls.push({ op: "billing_portal.sessions.create", input });
    return { url: `https://billing.stripe.test/p/session/${input.customerId}` };
  }

  /** Simula que el cliente paga la sesión en Stripe (lo que en la realidad hace la página de Checkout). */
  completeSession(id: string, status: GwSubscription["status"] = "active", amount?: number) {
    const s = this.sessions.get(id)!;
    amount ??= this.prices.find((p) => p.id === s.input.priceId)?.unitAmount ?? 2900;
    const subId = this.next("sub");
    const inv = this.addInvoice(subId, s.customerId!, "subscription_create", status === "active" ? "paid" : "open", amount);
    this.subscriptions.set(subId, { id: subId, customerId: s.customerId!, status, cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: s.expiresAt + 30 * 86_400, latestInvoiceId: inv, priceIds: [s.input.priceId], metadata: { ...s.metadata } });
    this.sessions.set(id, { ...s, status: "complete", paymentStatus: status === "active" ? "paid" : "unpaid", subscriptionId: subId, url: null });
    this.emit("checkout.session.completed", "checkout.session", id);
    return subId;
  }
  /** Nueva factura de la suscripción (renovación, cambio…) y la deja como última. */
  addInvoice(subId: string, customerId: string, reason: string, status: GwInvoice["status"], amount: number) {
    const id = this.next("in");
    this.invoices.set(id, { id, status, subscriptionId: subId, customerId, amountPaid: status === "paid" ? amount : 0, currency: "EUR", billingReason: reason, periodStart: 1_800_000_000 + this.seq });
    const sub = this.subscriptions.get(subId);
    if (sub) this.subscriptions.set(subId, { ...sub, latestInvoiceId: id });
    return id;
  }
  /** Cambia el estado de una suscripción (lo que haría Stripe por impago, el Portal, etc.). */
  updateSubscription(subId: string, patch: Partial<GwSubscription>) {
    this.subscriptions.set(subId, { ...this.subscriptions.get(subId)!, ...patch });
  }
  emit(type: string, objectType: string, objectId: string, created = 1_800_000_000 + ++this.seq) {
    const ev: GwEvent = { id: this.next("evt"), type, created, livemode: false, apiVersion: "2026-09-30.endive", objectType, objectId };
    this.events.unshift(ev);
    return ev;
  }
  private guard() {
    if (this.down) throw Object.assign(new Error("Stripe no responde"), { name: "StripeGatewayError", code: "network_error", retryable: true });
  }

  private view(id: string): GwCheckoutSession {
    const { input: _i, ...s } = this.sessions.get(id)!;
    return { ...s, metadata: { ...s.metadata } };
  }
}
