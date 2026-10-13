/**
 * Implementaciones en memoria de los puertos (pruebas y desarrollo). `FakeProvider` firma
 * los webhooks con HMAC-SHA256 igual que lo haría un proveedor real.
 */
import crypto from "node:crypto";
import type { BillingStore, ChargeResult, PaymentProvider, ProviderEvent, TenantEffects } from "./ports";
import { BillingError, type Invoice, type Subscription } from "./types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class MemoryBillingStore implements BillingStore {
  private subs = new Map<string, Subscription>();
  private invoices = new Map<string, Invoice>();
  private counters = new Map<number, number>();
  private events = new Set<string>();

  async getSubscription(id: string) {
    const s = this.subs.get(id);
    return s ? clone(s) : null;
  }
  async getSubscriptionByTenant(tenantId: string) {
    const s = Array.from(this.subs.values()).find((x) => x.tenantId === tenantId);
    return s ? clone(s) : null;
  }
  async putSubscription(s: Subscription) {
    this.subs.set(s.id, clone(s));
  }
  async listSubscriptions() {
    return Array.from(this.subs.values()).map(clone);
  }
  async getInvoice(id: string) {
    const i = this.invoices.get(id);
    return i ? clone(i) : null;
  }
  async listInvoices(tenantId: string) {
    return Array.from(this.invoices.values()).filter((i) => i.tenantId === tenantId).map(clone);
  }
  async putInvoice(i: Invoice) {
    this.invoices.set(i.id, clone(i));
  }
  async nextInvoiceNumber(year: number) {
    const n = (this.counters.get(year) ?? 0) + 1;
    this.counters.set(year, n);
    return `SAAS-${year}-${String(n).padStart(6, "0")}`;
  }
  async recordEvent(id: string) {
    if (this.events.has(id)) return false;
    this.events.add(id);
    return true;
  }
}

export class FakeProvider implements PaymentProvider {
  readonly secret = "whsec_test_secret";
  charges: Array<{ chargeId: string; invoiceId: string; amountCents: number; ok: boolean; key: string }> = [];
  /** Si es `true`, rechaza los cobros. */
  declineAll = false;
  private byKey = new Map<string, ChargeResult>();

  async charge(input: Parameters<PaymentProvider["charge"]>[0]): Promise<ChargeResult> {
    const prev = this.byKey.get(input.idempotencyKey);
    if (prev) return prev; // idempotencia: nunca cobra dos veces con la misma clave
    const ok = !this.declineAll;
    const chargeId = `ch_${this.charges.length + 1}`;
    const res: ChargeResult = { ok, chargeId, failure: ok ? undefined : "card_declined" };
    this.charges.push({ chargeId, invoiceId: input.invoiceId, amountCents: input.amountCents, ok, key: input.idempotencyKey });
    this.byKey.set(input.idempotencyKey, res);
    return res;
  }

  sign(rawBody: string): string {
    return crypto.createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  verifyWebhook(rawBody: string, signature: string): ProviderEvent {
    const expected = Buffer.from(this.sign(rawBody));
    const got = Buffer.from(signature || "");
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
      throw new BillingError("invalid_signature", "Firma de webhook no válida");
    }
    return JSON.parse(rawBody) as ProviderEvent;
  }

  async listCharges(from: number, to: number) {
    void from;
    void to;
    return this.charges.map(({ chargeId, invoiceId, amountCents, ok }) => ({ chargeId, invoiceId, amountCents, ok }));
  }
}

export class RecordingEffects implements TenantEffects {
  status = new Map<string, string>();
  modules = new Map<string, { status: "active" | "suspended"; until: Date | null }>(); // clave tenant|module
  quotas = new Map<string, number>(); // tenant|metric|period
  log: string[] = [];

  async setTenantStatus(tenantId: string, status: "trial" | "active" | "grace" | "suspended" | "archived", reason?: string) {
    this.status.set(tenantId, status);
    this.log.push(`status:${tenantId}:${status}${reason ? ":" + reason : ""}`);
  }
  async grantModule(tenantId: string, moduleId: string, validUntil: Date | null) {
    this.modules.set(`${tenantId}|${moduleId}`, { status: "active", until: validUntil });
  }
  async setModuleStatus(tenantId: string, moduleId: string, status: "active" | "suspended") {
    const m = this.modules.get(`${tenantId}|${moduleId}`);
    if (m) m.status = status;
  }
  async revokeModule(tenantId: string, moduleId: string) {
    this.modules.delete(`${tenantId}|${moduleId}`);
  }
  async setQuota(tenantId: string, q: { metric: string; period: string; limit: number }) {
    this.quotas.set(`${tenantId}|${q.metric}|${q.period}`, q.limit);
  }
}
