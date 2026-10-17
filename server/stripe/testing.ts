/**
 * Doble de Stripe para pruebas: sin red ni claves. Imita lo que nos importa del comportamiento real:
 * la misma Idempotency-Key devuelve el mismo objeto, los Prices se buscan por lookup_key y las
 * sesiones se pueden caducar. Registra cada llamada para poder comprobar qué se envió.
 */
import type { CheckoutSessionInput, GwCheckoutSession, GwPrice, GwProduct, GwSubscription, StripeGateway } from "./gateway";

export class FakeStripeGateway implements StripeGateway {
  prices: GwPrice[] = [];
  products = new Map<string, GwProduct>();
  customers = new Map<string, { id: string; deleted: boolean; name: string; email: string | null; metadata: Record<string, string> }>();
  sessions = new Map<string, GwCheckoutSession & { input: CheckoutSessionInput }>();
  subscriptions = new Map<string, GwSubscription>();
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
    const prev = this.idem.get(`cs:${key}`);
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
    const s = this.subscriptions.get(id);
    return s ? { ...s, priceIds: [...s.priceIds], metadata: { ...s.metadata } } : null;
  }
  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    this.calls.push({ op: "billing_portal.sessions.create", input });
    return { url: `https://billing.stripe.test/p/session/${input.customerId}` };
  }

  /** Simula que el cliente paga la sesión en Stripe (lo que en la realidad hace la página de Checkout). */
  completeSession(id: string, status: GwSubscription["status"] = "active") {
    const s = this.sessions.get(id)!;
    const subId = this.next("sub");
    this.subscriptions.set(subId, { id: subId, customerId: s.customerId!, status, cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: s.expiresAt + 30 * 86_400, latestInvoiceId: this.next("in"), priceIds: [s.input.priceId], metadata: { ...s.metadata } });
    this.sessions.set(id, { ...s, status: "complete", paymentStatus: "paid", subscriptionId: subId, url: null });
    return subId;
  }

  private view(id: string): GwCheckoutSession {
    const { input: _i, ...s } = this.sessions.get(id)!;
    return { ...s, metadata: { ...s.metadata } };
  }
}
