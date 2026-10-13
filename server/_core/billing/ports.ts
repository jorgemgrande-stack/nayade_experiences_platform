/** Puertos del motor de suscripciones: persistencia, pagos y efectos sobre el Core. */
import type { Invoice, Subscription } from "./types";

export interface BillingStore {
  getSubscription(id: string): Promise<Subscription | null>;
  getSubscriptionByTenant(tenantId: string): Promise<Subscription | null>;
  putSubscription(s: Subscription): Promise<void>;
  listSubscriptions(): Promise<Subscription[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  listInvoices(tenantId: string): Promise<Invoice[]>;
  putInvoice(i: Invoice): Promise<void>;
  /** Siguiente número correlativo de factura SaaS del año (atómico). */
  nextInvoiceNumber(year: number): Promise<string>;
  /** `true` si es la primera vez que se ve el evento (deduplicación de webhooks). */
  recordEvent(providerEventId: string, at: number): Promise<boolean>;
}

export interface ChargeResult {
  ok: boolean;
  chargeId: string;
  /** Motivo genérico del rechazo (sin datos de tarjeta). */
  failure?: string;
}

export interface ProviderEvent {
  id: string;
  type: "payment.succeeded" | "payment.failed";
  invoiceId: string;
  chargeId: string;
  at: number;
}

export interface PaymentProvider {
  /** Cobro idempotente: la misma `idempotencyKey` nunca cobra dos veces. */
  charge(input: {
    customerId: string | null;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    description: string;
    invoiceId: string;
  }): Promise<ChargeResult>;
  /** Verifica la firma del webhook y devuelve el evento; lanza si no es auténtico. */
  verifyWebhook(rawBody: string, signature: string): ProviderEvent;
  /** Cobros del proveedor en una ventana (conciliación). */
  listCharges(from: number, to: number): Promise<Array<{ chargeId: string; invoiceId: string; amountCents: number; ok: boolean }>>;
}

/** Efectos sobre el resto de la plataforma (registro de tenants, licencias, cuotas). */
export interface TenantEffects {
  setTenantStatus(tenantId: string, status: "trial" | "active" | "grace" | "suspended" | "archived", reason?: string): Promise<void>;
  grantModule(tenantId: string, moduleId: string, validUntil: Date | null): Promise<void>;
  setModuleStatus(tenantId: string, moduleId: string, status: "active" | "suspended"): Promise<void>;
  revokeModule(tenantId: string, moduleId: string): Promise<void>;
  setQuota(tenantId: string, q: { metric: string; period: "minute" | "hour" | "day" | "month"; limit: number }): Promise<void>;
}

export interface BillingNotifier {
  notify(event: "trial_ending" | "payment_failed" | "suspended" | "reactivated" | "canceled", tenantId: string): Promise<void>;
}
