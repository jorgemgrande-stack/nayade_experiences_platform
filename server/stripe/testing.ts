/**
 * Doble de Stripe para pruebas: sin red ni claves. Imita lo que nos importa del comportamiento real:
 * la misma Idempotency-Key devuelve el mismo objeto, los Prices se buscan por lookup_key y las
 * sesiones se pueden caducar. Registra cada llamada para poder comprobar qué se envió.
 */
import type { GwPortalConfig } from "./portal";
import { StripeGatewayError, type CheckoutSessionInput, type CustomerInput, type GwCharge, type GwCheckoutSession, type GwEvent, type GwInvoice, type GwInvoiceLine, type GwInvoicePreview, type GwPrice, type GwProduct, type GwSubscription, type GwSubscriptionItem, type GwSetupSession, type GwPaymentSession, type PaymentSessionInput, type ServiceSubscriptionInput, type SetupSessionInput, type StripeGateway, type SubscriptionItemsChange } from "./gateway";
import { prorationCents, supportsPendingUpdate } from "./multipart";

export class FakeStripeGateway implements StripeGateway {
  prices: GwPrice[] = [];
  products = new Map<string, GwProduct>();
  customers = new Map<string, { id: string; deleted: boolean } & CustomerInput>();
  sessions = new Map<string, GwCheckoutSession & { input: CheckoutSessionInput }>();
  subscriptions = new Map<string, GwSubscription>();
  invoices = new Map<string, GwInvoice>();
  charges = new Map<string, GwCharge>();
  /** Reembolsos y disputas → su cargo. */
  chargeRefs = new Map<string, string>();
  /** Simula que la lista de sesiones del cliente aún no incluye una recién creada. */
  hideSessions = false;
  /** Configuraciones del Customer Portal que «tiene» la cuenta. */
  portalConfigs: GwPortalConfig[] = [];
  /** Identificadores fiscales que el cliente dio en Checkout (por Customer); sin entrada, ninguno. */
  taxIdsOf = new Map<string, number>();
  /** Tipo de Stripe Tax de las facturas que «emite» (puntos básicos); null: impuesto no informado. */
  invoiceTaxBp: number | null = null;
  /** Parámetros enviados con cada clave: como Stripe, otra petición con la misma clave y otros parámetros falla. */
  private idemParams = new Map<string, string>();
  /** Eventos que «emite» Stripe (para la conciliación); el más reciente al principio, como la API. */
  events: GwEvent[] = [];
  /** `livemode` de los eventos que «emite» (false: sandbox; true: imita una cuenta live). */
  livemode = false;
  /** Si es true, cada llamada falla como una caída de Stripe (error de red reintentable). */
  down = false;
  calls: Array<{ op: string; key?: string; input?: unknown }> = [];
  private idem = new Map<string, string>();
  private seq = 0;
  private next = (p: string) => `${p}_${this.livemode ? "live" : "test"}_${String(++this.seq).padStart(10, "0")}`;

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
  async createCustomer(input: CustomerInput, key: string) {
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
    if (prev) {
      if (this.idemParams.get(key) !== JSON.stringify(input)) throw new StripeGatewayError("idempotency_error", "Stripe respondió 400 (idempotency_error)", false);
      return this.view(prev);
    }
    this.idemParams.set(key, JSON.stringify(input));
    const id = this.next("cs");
    this.sessions.set(id, { id, status: "open", paymentStatus: "unpaid", url: `https://checkout.stripe.test/c/pay/${id}`, customerId: input.customerId, subscriptionId: null, clientReferenceId: input.clientReferenceId, metadata: { ...input.metadata }, expiresAt: input.expiresAt, input });
    this.idem.set(`cs:${key}`, id);
    return this.view(id);
  }
  async checkoutSession(id: string) {
    return this.sessions.has(id) ? this.view(id) : null;
  }
  async sessionsOfCustomer(customerId: string) {
    this.calls.push({ op: "checkout.sessions.list", input: customerId });
    if (this.hideSessions) return [];
    return Array.from(this.sessions.keys()).filter((id) => this.sessions.get(id)!.customerId === customerId).reverse().map((id) => this.view(id));
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
    return s ? this.subView(s) : null;
  }
  private subView(s: GwSubscription): GwSubscription {
    return { ...s, priceIds: [...s.priceIds], metadata: { ...s.metadata }, items: s.items?.map((i) => ({ ...i })), pendingUpdate: s.pendingUpdate ? { ...s.pendingUpdate } : (s.pendingUpdate ?? null) };
  }

  // --- Suscripción multipartida (cambios de partidas con cobro condicionado) ---

  /** Reloj (segundos) de los cambios de partidas; null: el reloj real. */
  now: number | null = null;
  /** Qué pasa al cobrar la factura de un cambio, por Customer (por defecto, se cobra). */
  paymentOutcome = new Map<string, "succeed" | "fail" | "requires_action">();
  /** Tipo del método de pago por Customer (por defecto, tarjeta). */
  pmTypeOf = new Map<string, string>();
  /** Cambios pendientes de cobro: suscripción → partidas que se aplicarían, factura y caducidad. */
  pending = new Map<string, { items: GwSubscriptionItem[]; invoiceId: string; expiresAt: number }>();
  private nowSec = () => this.now ?? Math.floor(Date.now() / 1000);

  /** Partidas resultantes y líneas de prorrateo de un cambio (sin efectos). */
  private planChange(s: GwSubscription, change: Pick<SubscriptionItemsChange, "items" | "prorationBehavior">) {
    const items = (s.items ?? []).map((i) => ({ ...i }));
    for (const c of change.items) {
      const idx = c.id ? items.findIndex((i) => i.id === c.id) : -1;
      if (c.id && idx < 0) throw new StripeGatewayError("resource_missing", `Stripe respondió 400 (resource_missing: ${c.id})`, false);
      if (c.deleted) items.splice(idx, 1);
      else if (idx >= 0) items[idx] = { ...items[idx], ...(c.priceId ? { priceId: c.priceId } : {}), ...(c.quantity !== undefined ? { quantity: c.quantity } : {}) };
      else {
        if (!c.priceId || !this.prices.some((p) => p.id === c.priceId)) throw new StripeGatewayError("resource_missing", "Stripe respondió 400 (precio inexistente)", false);
        if (items.some((i) => i.priceId === c.priceId)) throw new StripeGatewayError("invalid_request_error", "Stripe respondió 400 (precio repetido en la suscripción)", false);
        items.push({ id: this.next("si"), priceId: c.priceId, quantity: c.quantity ?? 1 });
      }
    }
    const intervals = new Set(items.map((i) => this.prices.find((p) => p.id === i.priceId)?.interval ?? "month"));
    if (intervals.size > 1 && s.billingMode !== "flexible") throw new StripeGatewayError("invalid_request_error", "Stripe respondió 400 (periodicidades distintas en modo clásico)", false);
    const at = this.nowSec();
    const start = s.currentPeriodStart ?? at;
    const end = s.currentPeriodEnd ?? at;
    const lines: GwInvoiceLine[] = [];
    if (change.prorationBehavior === "always_invoice") {
      const before = new Map((s.items ?? []).map((i) => [i.id, i]));
      const after = new Map(items.map((i) => [i.id, i]));
      for (const id of Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]))) {
        const b = before.get(id);
        const a = after.get(id);
        if (b && a && b.priceId !== a.priceId) {
          lines.push(this.prorationLine(id, b.priceId, b.quantity, 0, start, end, at));
          lines.push(this.prorationLine(id, a.priceId, 0, a.quantity, start, end, at));
        } else if ((b?.quantity ?? 0) !== (a?.quantity ?? 0)) {
          lines.push(this.prorationLine(id, (a ?? b)!.priceId, b?.quantity ?? 0, a?.quantity ?? 0, start, end, at));
        }
      }
    }
    return { items, lines: lines.filter((l) => l.amount !== 0) };
  }
  private prorationLine(siId: string, priceId: string, from: number, to: number, start: number, end: number, at: number): GwInvoiceLine {
    const unit = this.prices.find((p) => p.id === priceId)?.unitAmount ?? 0;
    const amount = prorationCents(unit, from, to, start, end, at);
    const taxCents = this.invoiceTaxBp === null ? null : Math.round((amount * this.invoiceTaxBp) / 10_000);
    return { id: this.next("il"), subscriptionItemId: siId, priceId, quantity: Math.abs(to - from), amount, taxCents, proration: true, periodStart: at, periodEnd: end };
  }
  private applyItems(subId: string, items: GwSubscriptionItem[], metadata?: Record<string, string>) {
    const s = this.subscriptions.get(subId)!;
    this.subscriptions.set(subId, { ...s, items, priceIds: items.map((i) => i.priceId), pendingUpdate: null, metadata: metadata ? { ...s.metadata, ...metadata } : s.metadata });
    this.pending.delete(subId);
  }

  async updateSubscriptionItems(change: SubscriptionItemsChange, key: string) {
    this.guard();
    this.calls.push({ op: "subscriptions.update", key, input: change });
    const prev = this.idem.get(`sub-upd:${key}`);
    if (prev !== undefined) {
      if (this.idemParams.get(key) !== JSON.stringify(change)) throw new StripeGatewayError("idempotency_error", "Stripe respondió 400 (idempotency_error)", false);
      const inv = prev ? this.invoices.get(prev) : undefined;
      return { subscription: this.subView(this.subscriptions.get(change.subscriptionId)!), invoice: inv ? { ...inv } : null };
    }
    const s = this.subscriptions.get(change.subscriptionId);
    if (!s) throw new StripeGatewayError("resource_missing", "Stripe respondió 404 (resource_missing)", false);
    const { items, lines } = this.planChange(s, change);
    if (change.paymentBehavior === "pending_if_incomplete" && !supportsPendingUpdate(this.pmTypeOf.get(s.customerId) ?? "card"))
      throw new StripeGatewayError("invalid_request_error", "Stripe respondió 400 (pending_if_incomplete no admite este método de pago)", false);
    this.idemParams.set(key, JSON.stringify(change));
    // Un cambio nuevo con partidas sustituye al pendiente (como Stripe)
    const old = this.pending.get(s.id);
    if (old) {
      this.invoices.set(old.invoiceId, { ...this.invoices.get(old.invoiceId)!, status: "void" });
      this.pending.delete(s.id);
      this.subscriptions.set(s.id, { ...s, pendingUpdate: null });
    }
    const net = lines.reduce((a, l) => a + l.amount, 0);
    if (!lines.length) {
      this.applyItems(s.id, items, change.metadata);
      this.idem.set(`sub-upd:${key}`, "");
      this.emit("customer.subscription.updated", "subscription", s.id);
      return { subscription: this.subView(this.subscriptions.get(s.id)!), invoice: null };
    }
    const outcome = net <= 0 ? "succeed" : (this.paymentOutcome.get(s.customerId) ?? "succeed");
    if (outcome !== "succeed" && change.paymentBehavior === "error_if_incomplete") throw new StripeGatewayError("card_declined", "Stripe respondió 402 (card_declined)", false);
    const invId = this.addInvoice(s.id, s.customerId, "subscription_update", outcome === "succeed" ? "paid" : "open", net, lines);
    if (outcome === "succeed") {
      this.applyItems(s.id, items, change.metadata);
      this.emit("invoice.paid", "invoice", invId);
      this.emit("customer.subscription.updated", "subscription", s.id);
    } else {
      const expiresAt = this.nowSec() + 23 * 3600;
      this.pending.set(s.id, { items, invoiceId: invId, expiresAt });
      this.subscriptions.set(s.id, { ...this.subscriptions.get(s.id)!, pendingUpdate: { expiresAt } });
      this.emit("invoice.payment_failed", "invoice", invId);
      this.emit("customer.subscription.updated", "subscription", s.id);
    }
    this.idem.set(`sub-upd:${key}`, invId);
    return { subscription: this.subView(this.subscriptions.get(s.id)!), invoice: { ...this.invoices.get(invId)! } };
  }
  async previewSubscriptionChange(change: Omit<SubscriptionItemsChange, "paymentBehavior" | "metadata">): Promise<GwInvoicePreview> {
    this.guard();
    this.calls.push({ op: "invoices.createPreview", input: change });
    const s = this.subscriptions.get(change.subscriptionId);
    if (!s) throw new StripeGatewayError("resource_missing", "Stripe respondió 404 (resource_missing)", false);
    const { lines } = this.planChange(s, change);
    const subtotal = lines.reduce((a, l) => a + l.amount, 0);
    const taxCents = this.invoiceTaxBp === null ? null : lines.reduce((a, l) => a + (l.taxCents ?? 0), 0);
    return { currency: "EUR", subtotal, taxCents, amountDue: Math.max(subtotal + (taxCents ?? 0), 0), lines };
  }
  async voidInvoice(id: string) {
    this.guard();
    this.calls.push({ op: "invoices.voidInvoice", input: id });
    const inv = this.invoices.get(id);
    if (!inv || inv.status !== "open") throw new StripeGatewayError("invalid_request_error", "Stripe respondió 400 (solo se anulan facturas abiertas)", false);
    this.invoices.set(id, { ...inv, status: "void" });
    for (const [subId, p] of Array.from(this.pending.entries())) {
      if (p.invoiceId !== id) continue;
      this.pending.delete(subId);
      this.subscriptions.set(subId, { ...this.subscriptions.get(subId)!, pendingUpdate: null });
      this.emit("customer.subscription.updated", "subscription", subId);
    }
    this.emit("invoice.voided", "invoice", id);
    return { ...this.invoices.get(id)! };
  }
  async paymentMethodTypeOf(subscriptionId: string) {
    this.guard();
    const s = this.subscriptions.get(subscriptionId);
    return s ? (this.pmTypeOf.get(s.customerId) ?? "card") : null;
  }
  /** Fin al final del periodo (como Stripe desde 2025: `cancel_at` pasa a ser el fin del periodo) o deshacerlo. */
  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean, key: string) {
    this.guard();
    this.calls.push({ op: "subscriptions.update(cancel_at_period_end)", key, input: { subscriptionId, cancel } });
    const params = JSON.stringify({ subscriptionId, cancel });
    if (this.idem.has(`sub-cancel:${key}`)) {
      if (this.idemParams.get(key) !== params) throw new StripeGatewayError("idempotency_error", "Stripe respondió 400 (idempotency_error)", false);
      return this.subView(this.subscriptions.get(subscriptionId)!);
    }
    const s = this.subscriptions.get(subscriptionId);
    if (!s) throw new StripeGatewayError("resource_missing", "Stripe respondió 404 (resource_missing)", false);
    if (s.status === "canceled") throw new StripeGatewayError("invalid_request_error", "Stripe respondió 400 (suscripción cancelada)", false);
    this.idemParams.set(key, params);
    this.idem.set(`sub-cancel:${key}`, subscriptionId);
    this.subscriptions.set(subscriptionId, { ...s, cancelAtPeriodEnd: cancel, cancelAt: cancel ? s.currentPeriodEnd : null });
    this.emit("customer.subscription.updated", "subscription", subscriptionId);
    return this.subView(this.subscriptions.get(subscriptionId)!);
  }
  /** El cliente paga (o autentica) la factura abierta: si llevaba un cambio pendiente, se aplica. */
  payInvoice(id: string) {
    const inv = this.invoices.get(id)!;
    this.invoices.set(id, { ...inv, status: "paid", amountPaid: inv.total ?? inv.subtotal ?? 0 });
    this.emit("invoice.paid", "invoice", id);
    for (const [subId, p] of Array.from(this.pending.entries())) {
      if (p.invoiceId !== id) continue;
      this.applyItems(subId, p.items);
      this.emit("customer.subscription.updated", "subscription", subId);
    }
  }
  /** Pasan las 23 h sin cobro: Stripe descarta el cambio y anula su factura. */
  expirePendingUpdate(subId: string) {
    const p = this.pending.get(subId);
    if (!p) return;
    this.invoices.set(p.invoiceId, { ...this.invoices.get(p.invoiceId)!, status: "void" });
    this.pending.delete(subId);
    this.subscriptions.set(subId, { ...this.subscriptions.get(subId)!, pendingUpdate: null });
    this.emit("invoice.voided", "invoice", p.invoiceId);
    this.emit("customer.subscription.pending_update_expired", "subscription", subId);
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
    // Igual que Stripe: como máximo 20 valores en `types`
    if (q.types && q.types.length > 20) throw new StripeGatewayError("invalid_request_error", "Stripe respondió 400 (más de 20 valores en types)", false);
    let list = this.events.filter((e) => (q.createdGte === undefined || e.created >= q.createdGte) && (!q.types || q.types.includes(e.type)));
    if (q.startingAfter) list = list.slice(list.findIndex((e) => e.id === q.startingAfter) + 1);
    const limit = q.limit ?? 100;
    return { events: list.slice(0, limit).map((e) => ({ ...e })), hasMore: list.length > limit };
  }
  async portalConfigurations() {
    this.calls.push({ op: "billing_portal.configurations.list" });
    return this.portalConfigs.map((c) => structuredClone(c));
  }
  async createPortalSession(input: { customerId: string; returnUrl: string; configuration?: string }) {
    this.calls.push({ op: "billing_portal.sessions.create", input });
    return { url: `https://billing.stripe.test/p/session/${input.customerId}` };
  }

  /** Simula que el cliente paga la sesión en Stripe (lo que en la realidad hace la página de Checkout). */
  completeSession(id: string, status: GwSubscription["status"] = "active", amount?: number) {
    const s = this.sessions.get(id)!;
    // Partidas recurrentes de la sesión (las de importe único solo van en la primera factura)
    const lineItems = s.input.lineItems ?? [{ priceId: s.input.priceId, quantity: 1 }];
    const recurring = lineItems.filter((l): l is { priceId: string; quantity: number } => "priceId" in l);
    amount ??= lineItems.reduce((a, l) => a + ("priceId" in l ? (this.prices.find((p) => p.id === l.priceId)?.unitAmount ?? 2900) : l.oneTime.unitAmount) * l.quantity, 0);
    const subId = this.next("sub");
    const inv = this.addInvoice(subId, s.customerId!, "subscription_create", status === "active" ? "paid" : "open", amount);
    const end = s.expiresAt + 30 * 86_400;
    // Checkout crea la suscripción en modo flexible (gateway.ts): admite añadir partidas de otra periodicidad
    const items = recurring.map((l) => ({ id: this.next("si"), priceId: l.priceId, quantity: l.quantity }));
    this.subscriptions.set(subId, { id: subId, customerId: s.customerId!, status, cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: end, currentPeriodStart: end - 30 * 86_400, latestInvoiceId: inv, priceIds: items.map((i) => i.priceId), metadata: { ...s.metadata }, items, pendingUpdate: null, billingMode: "flexible" });
    this.sessions.set(id, { ...s, status: "complete", paymentStatus: status === "active" ? "paid" : "unpaid", subscriptionId: subId, url: null });
    this.emit("checkout.session.completed", "checkout.session", id);
    return subId;
  }
  /** Nueva factura de la suscripción (renovación, cambio…) y la deja como última. */
  addInvoice(subId: string, customerId: string, reason: string, status: GwInvoice["status"], amount: number, lines?: GwInvoiceLine[]) {
    const id = this.next("in");
    const addr = this.customers.get(customerId)?.address;
    // Como en Stripe: el subtotal es el neto y lo pagado es el total (neto + impuesto de Stripe Tax)
    const tax = this.invoiceTaxBp === null ? null : lines ? lines.reduce((a, l) => a + (l.taxCents ?? 0), 0) : Math.round((amount * this.invoiceTaxBp) / 10_000);
    const total = amount + (tax ?? 0);
    const sub = this.subscriptions.get(subId);
    lines ??= (sub?.items ?? []).map((i) => {
      const unit = this.prices.find((p) => p.id === i.priceId)?.unitAmount ?? 0;
      const net = unit * i.quantity;
      return { id: this.next("il"), subscriptionItemId: i.id, priceId: i.priceId, quantity: i.quantity, amount: net, taxCents: this.invoiceTaxBp === null ? null : Math.round((net * this.invoiceTaxBp) / 10_000), proration: false, periodStart: sub?.currentPeriodStart ?? null, periodEnd: sub?.currentPeriodEnd ?? null };
    });
    this.invoices.set(id, { id, status, subscriptionId: subId, customerId, amountPaid: status === "paid" ? total : 0, currency: "EUR", billingReason: reason, periodStart: 1_800_000_000 + this.seq, subtotal: amount, customerCountry: addr?.country ?? null, customerPostalCode: addr?.postalCode ?? null, customerTaxIds: this.taxIdsOf.get(customerId) ?? 0, taxCents: tax, number: `ES-${String(this.seq).padStart(4, "0")}`, total, hostedInvoiceUrl: `https://invoice.stripe.test/i/${id}`, lines });
    if (sub) this.subscriptions.set(subId, { ...this.subscriptions.get(subId)!, latestInvoiceId: id });
    return id;
  }
  /** Cambia el estado de una suscripción (lo que haría Stripe por impago, el Portal, etc.). */
  updateSubscription(subId: string, patch: Partial<GwSubscription>) {
    this.subscriptions.set(subId, { ...this.subscriptions.get(subId)!, ...patch });
  }
  emit(type: string, objectType: string, objectId: string, created = 1_800_000_000 + ++this.seq) {
    const ev: GwEvent = { id: this.next("evt"), type, created, livemode: this.livemode, apiVersion: "2026-09-30.endive", objectType, objectId };
    this.events.unshift(ev);
    return ev;
  }
  // --- Servicios de clientes externos (Checkout setup, suscripción con primer cargo diferido, IVA fijo) ---
  setupSessions = new Map<string, GwSetupSession>();
  defaultPaymentMethod = new Map<string, string>();
  taxRates: Array<{ id: string; bp: number; country: string }> = [];
  serviceSubs = new Map<string, { unitAmount: number; taxBp: number; trialEnd: number }>();
  testClocks = new Map<string, { id: string; status: string; frozenTime: number }>();
  async createSetupSession(i: SetupSessionInput, key: string) {
    this.calls.push({ op: "checkout.sessions.create(setup)", key, input: i });
    const prev = this.idem.get(`setup:${key}`);
    if (prev) return { ...this.setupSessions.get(prev)! };
    const id = this.next("cs");
    this.setupSessions.set(id, { id, url: `https://checkout.stripe.test/c/setup/${id}`, status: "open", customerId: i.customerId, setupIntentId: this.next("seti"), paymentMethodId: null, metadata: { ...i.metadata }, expiresAt: i.expiresAt });
    this.idem.set(`setup:${key}`, id);
    return { ...this.setupSessions.get(id)! };
  }
  async setupSession(id: string) {
    const s = this.setupSessions.get(id);
    return s ? { ...s, metadata: { ...s.metadata } } : null;
  }
  /** El cliente registra la tarjeta en la página de Stripe (modo setup): ningún cargo. */
  completeSetupSession(id: string, paymentMethodId = this.next("pm")) {
    const s = this.setupSessions.get(id)!;
    this.setupSessions.set(id, { ...s, status: "complete", paymentMethodId, url: null });
    this.emit("checkout.session.completed", "checkout.session", id);
    return paymentMethodId;
  }
  // --- Cobro único de un cargo (Checkout en modo payment, IVA fijo) ---
  paymentSessions = new Map<string, GwPaymentSession>();
  async createPaymentSession(i: PaymentSessionInput, key: string) {
    this.calls.push({ op: "checkout.sessions.create(payment)", key, input: i });
    const prev = this.idem.get(`payment:${key}`);
    if (prev) return { ...this.paymentSessions.get(prev)! };
    const id = this.next("cs");
    const rate = this.taxRates.find((r) => r.id === i.taxRateId);
    const tax = rate ? Math.round((i.amountCents * rate.bp) / 10_000) : 0;
    this.paymentSessions.set(id, { id, url: `https://checkout.stripe.test/c/pay/${id}`, status: "open", paymentStatus: "unpaid", customerId: i.customerId, currency: i.currency.toLowerCase(), amountSubtotal: i.amountCents, amountTotal: i.amountCents + tax, paymentIntentId: null, metadata: { ...i.metadata }, expiresAt: i.expiresAt });
    this.idem.set(`payment:${key}`, id);
    return { ...this.paymentSessions.get(id)! };
  }
  async paymentSession(id: string) {
    const s = this.paymentSessions.get(id);
    return s ? { ...s, metadata: { ...s.metadata } } : null;
  }
  /** El cliente paga en la página de Stripe (o la sesión caduca sin pagar). */
  completePaymentSession(id: string, outcome: "paid" | "expired" = "paid") {
    const s = this.paymentSessions.get(id)!;
    this.paymentSessions.set(id, outcome === "paid" ? { ...s, status: "complete", paymentStatus: "paid", paymentIntentId: this.next("pi"), url: null } : { ...s, status: "expired", url: null });
    return this.emit(outcome === "paid" ? "checkout.session.completed" : "checkout.session.expired", "checkout.session", id);
  }
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    this.calls.push({ op: "customers.update(default_payment_method)", input: { customerId, paymentMethodId } });
    this.defaultPaymentMethod.set(customerId, paymentMethodId);
  }
  async ensureServiceProduct(p: { id: string; name: string; metadata: Record<string, string> }) {
    if (!this.products.has(p.id)) this.addProduct({ id: p.id, name: p.name, metadata: p.metadata });
    return p.id;
  }
  async ensureTaxRate(t: { percentageBp: number; country: string }) {
    const cur = this.taxRates.find((r) => r.bp === t.percentageBp && r.country === t.country);
    if (cur) return cur.id;
    const id = this.next("txr");
    this.taxRates.push({ id, bp: t.percentageBp, country: t.country });
    return id;
  }
  async createServiceSubscription(i: ServiceSubscriptionInput, key: string) {
    this.calls.push({ op: "subscriptions.create(service)", key, input: i });
    const prev = this.idem.get(`svcsub:${key}`);
    if (prev) return this.subView(this.subscriptions.get(prev)!);
    const id = this.next("sub");
    const taxBp = this.taxRates.find((r) => r.id === i.taxRateId)?.bp ?? 0;
    const priceId = this.next("price");
    // Sin cargo hasta el primer vencimiento (trial_end); ninguna factura todavía
    this.subscriptions.set(id, { id, customerId: i.customerId, status: "trialing", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: i.trialEnd, currentPeriodStart: this.nowSec(), latestInvoiceId: null, priceIds: [priceId], metadata: { ...i.metadata }, items: [{ id: this.next("si"), priceId, quantity: 1 }], pendingUpdate: null, billingMode: "flexible" });
    this.serviceSubs.set(id, { unitAmount: i.unitAmount, taxBp, trialEnd: i.trialEnd });
    this.idem.set(`svcsub:${key}`, id);
    this.emit("customer.subscription.created", "subscription", id);
    return this.subView(this.subscriptions.get(id)!);
  }
  /**
   * Stripe llega al día de cobro de una suscripción de servicio: una factura del periodo (neto + IVA fijo), cobrada o
   * pendiente (cobro fallido; Stripe la reintentará). Devuelve la factura.
   */
  chargeServicePeriod(subId: string, periodStart: number, periodEnd: number, outcome: "paid" | "open") {
    const s = this.subscriptions.get(subId)!;
    const svc = this.serviceSubs.get(subId)!;
    const tax = Math.round((svc.unitAmount * svc.taxBp) / 10_000);
    const reason = s.latestInvoiceId ? "subscription_cycle" : "subscription_cycle";
    const id = this.addInvoice(subId, s.customerId, reason, outcome, svc.unitAmount, [{ id: this.next("il"), subscriptionItemId: s.items![0].id, priceId: s.items![0].priceId, quantity: 1, amount: svc.unitAmount, taxCents: tax, proration: false, periodStart, periodEnd }]);
    const inv = this.invoices.get(id)!;
    // Como Stripe: el period_start de la factura de una suscripción mira un periodo atrás (el de prueba en la primera);
    // el periodo del servicio está en sus líneas
    const lookBack = s.currentPeriodStart ?? periodStart - (periodEnd - periodStart);
    this.invoices.set(id, { ...inv, periodStart: lookBack, taxCents: tax, total: svc.unitAmount + tax, amountPaid: outcome === "paid" ? svc.unitAmount + tax : 0 });
    this.subscriptions.set(subId, { ...this.subscriptions.get(subId)!, status: outcome === "paid" ? "active" : "past_due", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, latestInvoiceId: id });
    this.emit(outcome === "paid" ? "invoice.paid" : "invoice.payment_failed", "invoice", id);
    this.emit("customer.subscription.updated", "subscription", subId);
    return id;
  }
  /** Reintento de Stripe con éxito (o el cliente paga con otro método): la MISMA factura queda cobrada. */
  recoverServiceInvoice(invoiceId: string) {
    const inv = this.invoices.get(invoiceId)!;
    this.invoices.set(invoiceId, { ...inv, status: "paid", amountPaid: inv.total ?? inv.subtotal ?? 0 });
    this.subscriptions.set(inv.subscriptionId!, { ...this.subscriptions.get(inv.subscriptionId!)!, status: "active" });
    this.emit("invoice.paid", "invoice", invoiceId);
    this.emit("customer.subscription.updated", "subscription", inv.subscriptionId!);
  }
  async createTestClock(frozenTime: number) {
    const id = this.next("clock");
    this.testClocks.set(id, { id, status: "ready", frozenTime });
    return { id };
  }
  async advanceTestClock(id: string, frozenTime: number) {
    const c = this.testClocks.get(id)!;
    this.testClocks.set(id, { ...c, frozenTime });
    return { id, status: "ready" };
  }
  async testClock(id: string) {
    return this.testClocks.get(id) ?? null;
  }

  private guard() {
    if (this.down) throw Object.assign(new Error("Stripe no responde"), { name: "StripeGatewayError", code: "network_error", retryable: true });
  }

  private view(id: string): GwCheckoutSession {
    const { input: _i, ...s } = this.sessions.get(id)!;
    return { ...s, metadata: { ...s.metadata } };
  }
}
