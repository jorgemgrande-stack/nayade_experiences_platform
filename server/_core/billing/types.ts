/**
 * Suscripciones y facturación SaaS — modelo.
 *
 * Esta lógica pertenece, por diseño, al plano comercial (Big Elephant CRM): vive aquí como
 * biblioteca independiente del Core (sin dependencias del resto de la aplicación salvo los
 * puertos que declara) para poder extraerse al repositorio del CRM sin cambios.
 *
 * Los precios son DATOS del catálogo; el motor no inventa tarifas: sin precio no se factura.
 */

export type Interval = "month" | "year";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended" | "canceled" | "ended";

export interface Plan {
  id: string;
  name: string;
  /** `base`: suscripción obligatoria. `capacity`: amplía cuotas sobre la base. */
  kind: "base" | "capacity";
  interval: Interval;
  /** Céntimos; `null` = sin tarifa definida (no se puede facturar). */
  priceCents: number | null;
  currency: string;
  /** Módulos incluidos en el plan. */
  includedModules: string[];
  /** Dominios propios permitidos. */
  maxCustomDomains: number;
  /** Cuotas que concede el plan (metric/period/limit). */
  quotas: Array<{ metric: string; period: "minute" | "hour" | "day" | "month"; limit: number }>;
}

export interface ModulePrice {
  moduleId: string;
  interval: Interval;
  priceCents: number | null;
  currency: string;
}

export interface Catalog {
  plans: Plan[];
  modules: ModulePrice[];
  trialDays: number; // 15
  graceDays: number; // 7
  /** Restricciones durante la prueba. */
  trial: {
    maxCustomDomains: number;
    /** Integraciones externas permitidas en prueba (ids). */
    integrations: string[];
    quotas: Array<{ metric: string; period: "minute" | "hour" | "day" | "month"; limit: number }>;
  };
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  /** Módulos adicionales contratados (los incluidos en el plan no se repiten). */
  modules: string[];
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  trialEnd: number | null;
  graceEnd: number | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: string | null;
  currency: string;
  /** Referencia del cliente en el proveedor de pagos. */
  providerCustomerId: string | null;
  createdAt: number;
  canceledAt: number | null;
  /** Intentos de cobro del periodo en curso. */
  attempts: number;
}

export interface InvoiceLine {
  description: string;
  amountCents: number;
}

export interface Invoice {
  id: string;
  number: string;
  tenantId: string;
  subscriptionId: string;
  status: "open" | "paid" | "void" | "uncollectible";
  currency: string;
  amountCents: number;
  lines: InvoiceLine[];
  issuedAt: number;
  dueAt: number;
  paidAt: number | null;
  periodStart: number;
  periodEnd: number;
  providerChargeId: string | null;
}

export class BillingError extends Error {
  constructor(
    public readonly code:
      | "no_price"
      | "invalid_plan"
      | "invalid_state"
      | "not_found"
      | "duplicate"
      | "invalid_signature"
      | "domain_limit",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export const DAY = 86_400_000;
