/** Dobles de prueba de los cobros por empresa: almacén en memoria con la misma semántica que el SQL, y pasarela falsa. */
import type { StripeAccountFacts } from "../../shared/paymentAccounts";
import type { CheckoutParams, ConnectGateway } from "./gateway";
import type { AccountUpdate, CheckoutRow, PaymentAccountRow, PaymentStore } from "./store";
import type { PaymentIncident, QuoteInfo, QuotePort, ShopPort } from "./service";
import type { AccountIndexReader, AccountIndexWriter, ClaimResult } from "./accountIndex";

export class MemoryPaymentStore implements PaymentStore {
  accounts = new Map<string, PaymentAccountRow>();
  events = new Map<string, { outcome: string; accountId: string | null }>();
  checkouts = new Map<string, CheckoutRow>();
  async getAccount(mode: "test" | "live") {
    return this.accounts.get(mode) ?? null;
  }
  async insertAccount(mode: "test" | "live", accountId: string, now: number) {
    const ex = this.accounts.get(mode);
    if (ex) return ex;
    const a: PaymentAccountRow = {
      mode, accountId, status: "pendiente", chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, requirementsDue: [],
      disabledReason: null, onlineEnabled: false, connectedAt: now, verifiedAt: null, lastEventId: null, lastEventType: null, lastEventAt: null,
    };
    this.accounts.set(mode, a);
    return a;
  }
  async updateAccount(mode: "test" | "live", u: AccountUpdate) {
    const a = this.accounts.get(mode);
    if (!a) return null;
    Object.assign(a, {
      status: u.status, chargesEnabled: u.chargesEnabled, payoutsEnabled: u.payoutsEnabled, detailsSubmitted: u.detailsSubmitted,
      requirementsDue: u.requirementsDue, disabledReason: u.disabledReason,
      onlineEnabled: u.status === "verificada" ? a.onlineEnabled : false,
      verifiedAt: u.status === "verificada" ? (a.verifiedAt ?? u.now) : null,
    });
    return a;
  }
  async setOnline(mode: "test" | "live", enabled: boolean) {
    const a = this.accounts.get(mode);
    if (!a) return false;
    if (enabled && a.status !== "verificada") return false;
    a.onlineEnabled = enabled;
    return true;
  }
  async noteEvent(mode: "test" | "live", e: { id: string; type: string; at: number }) {
    const a = this.accounts.get(mode);
    if (a) Object.assign(a, { lastEventId: e.id, lastEventType: e.type, lastEventAt: e.at });
  }
  async claimEvent(e: { eventId: string; accountId: string | null; outcome: string }) {
    if (this.events.has(e.eventId)) return false;
    this.events.set(e.eventId, { outcome: e.outcome, accountId: e.accountId });
    return true;
  }
  async setEventOutcome(id: string, outcome: string) {
    const e = this.events.get(id);
    if (e) e.outcome = outcome;
  }
  async reclaimFailedEvent(id: string) {
    const e = this.events.get(id);
    if (e?.outcome !== "failed") return false;
    e.outcome = "processing";
    return true;
  }
  async insertCheckout(c: Omit<CheckoutRow, "status" | "paidAt" | "paymentIntentId">) {
    this.checkouts.set(c.sessionId, { ...c, status: "pending", paidAt: null, paymentIntentId: null });
  }
  async getCheckout(id: string) {
    return this.checkouts.get(id) ?? null;
  }
  async getCheckoutByPaymentIntent(pi: string) {
    return Array.from(this.checkouts.values()).find((c) => c.paymentIntentId === pi && c.status === "paid") ?? null;
  }
  async listQuoteCheckouts(quoteId: number) {
    return Array.from(this.checkouts.values()).filter((c) => c.kind === "quote" && c.quoteId === quoteId).sort((a, b) => a.createdAt - b.createdAt);
  }
  async markCheckoutPaid(id: string, pi: string | null, now: number) {
    const c = this.checkouts.get(id);
    // Como el SQL: un cobro real también se aplica sobre una sesión que localmente figuraba cerrada o fallida
    if (!c || c.status === "paid") return false;
    Object.assign(c, { status: "paid", paymentIntentId: pi, paidAt: now });
    return true;
  }
  async revertCheckoutPaid(id: string) {
    const c = this.checkouts.get(id);
    if (c?.status === "paid") Object.assign(c, { status: "pending", paidAt: null });
  }
  async setCheckoutStatus(id: string, status: "expired" | "failed") {
    const c = this.checkouts.get(id);
    if (c?.status === "pending") c.status = status;
  }
}

export class FakeConnectGateway implements ConnectGateway {
  calls: string[] = [];
  sessions: CheckoutParams[] = [];
  accountFacts: StripeAccountFacts = { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, requirementsDue: [], disabledReason: null };
  private n = 0;
  constructor(readonly accountId = "acct_1TestQuantum0001") {}
  async createAccount() {
    this.calls.push("createAccount");
    return { accountId: this.accountId };
  }
  async createAccountLink(p: { accountId: string }) {
    this.calls.push(`createAccountLink:${p.accountId}`);
    return { url: `https://connect.stripe.test/setup/${p.accountId}`, expiresAt: Date.now() + 300_000 };
  }
  async retrieveAccount() {
    this.calls.push("retrieveAccount");
    return this.accountFacts;
  }
  oauthResult: { accountId: string; livemode: boolean } = { accountId: "acct_1LiveAsociacion01", livemode: true };
  async exchangeOAuthCode(code: string) {
    this.calls.push(`exchangeOAuthCode:${code}`);
    return this.oauthResult;
  }
  async createCheckoutSession(p: CheckoutParams) {
    this.calls.push("createCheckoutSession");
    this.sessions.push(p);
    const id = `cs_test_${++this.n}`;
    return { id, url: `https://checkout.stripe.test/c/pay/${id}` };
  }
  /** Sesiones cerradas por el servidor y sesiones que el doble considera ya pagadas (no se pueden cerrar). */
  expired: string[] = [];
  completedSessions = new Set<string>();
  async expireCheckoutSession(p: { accountId: string; sessionId: string }) {
    this.calls.push(`expireCheckoutSession:${p.sessionId}`);
    if (this.completedSessions.has(p.sessionId)) return "completed" as const;
    if (this.expired.includes(p.sessionId)) return "closed" as const;
    this.expired.push(p.sessionId);
    return "expired" as const;
  }
}

export class FakeQuotes implements QuotePort {
  paid: Array<{ quoteId: number; reference: string }> = [];
  failNext = false;
  constructor(public quote: QuoteInfo & { token: string }) {}
  async byToken(token: string) {
    return token === this.quote.token ? this.quote : null;
  }
  duplicates: Array<{ quoteId: number; reference: string }> = [];
  incidents: Array<{ quoteId: number; incident: PaymentIncident }> = [];
  async noteIncident(quoteId: number, incident: PaymentIncident) {
    this.incidents.push({ quoteId, incident });
  }
  async markPaid(quoteId: number, reference: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("fallo al aplicar");
    }
    // Como el puerto real: un presupuesto ya cobrado (por otro medio o por otra sesión) no se vuelve a aplicar
    if (this.quote.paidAt) {
      this.duplicates.push({ quoteId, reference });
      return { alreadyPaid: true as const };
    }
    this.paid.push({ quoteId, reference });
    this.quote.paidAt = new Date();
  }
}

/** Índice global en memoria con la misma semántica que la tabla (clave = cuenta; una cuenta por empresa y modo). */
export class MemoryAccountIndex implements AccountIndexWriter, AccountIndexReader {
  rows = new Map<string, { tenantId: string; mode: string }>();
  async claim(tenantId: string, mode: "test" | "live", accountId: string): Promise<ClaimResult> {
    const ex = this.rows.get(accountId);
    if (ex) return ex.tenantId === tenantId && ex.mode === mode ? { ok: true, alreadyOwned: true } : { ok: false, reason: "taken" };
    for (const r of Array.from(this.rows.values())) if (r.tenantId === tenantId && r.mode === mode) return { ok: false, reason: "tenant_has_other" };
    this.rows.set(accountId, { tenantId, mode });
    return { ok: true, alreadyOwned: false };
  }
  async tenantOf(accountId: string) {
    return this.rows.get(accountId)?.tenantId ?? null;
  }
}

export class FakeShop implements ShopPort {
  paid: Array<{ merchantOrder: string; amountCents: number; paymentIntent: string | null }> = [];
  failed: string[] = [];
  failNext = false;
  async applyPaid(merchantOrder: string, p: { amountCents: number; paymentIntent: string | null }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("fallo al aplicar");
    }
    this.paid.push({ merchantOrder, amountCents: p.amountCents, paymentIntent: p.paymentIntent });
  }
  async applyFailed(merchantOrder: string) {
    this.failed.push(merchantOrder);
  }
  expired: string[] = [];
  async applyExpired(merchantOrder: string) {
    this.expired.push(merchantOrder);
  }
  incidents: Array<{ merchantOrder: string; incident: PaymentIncident }> = [];
  failIncident = false;
  async applyIncident(merchantOrder: string, incident: PaymentIncident) {
    if (this.failIncident) {
      this.failIncident = false;
      throw new Error("fallo al aplicar");
    }
    this.incidents.push({ merchantOrder, incident });
  }
}
