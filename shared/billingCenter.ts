/**
 * Centro de suscripción, pagos y facturas de UNA empresa (solo lectura).
 *
 * Contrato compartido entre el plano de control (que lo calcula), el router del Core y la página
 * `/admin/suscripcion`. Reglas que el contrato hace explícitas para no confundir conceptos:
 *  - Un COBRO real es una factura de Stripe pagada con importe > 0. Una factura de 0 € (prueba gratuita) es un
 *    documento sin cobro; una suscripción en prueba o con método de pago autorizado no es una mensualidad pagada.
 *  - La fecha del próximo cobro es la de Stripe (fin de la prueba o fin del periodo en curso), no el periodo interno
 *    del CRM.
 *  - Nada aquí expone identificadores de Stripe de otra empresa, claves ni datos de tarjeta.
 */

/** Etapa económica real de la empresa. */
export type BillingStage =
  /** Sin contratación formalizada (prueba o plataforma sin contrato). */
  | "no_contract"
  /** Contrato aceptado, pero todavía sin método de pago autorizado. */
  | "contract_pending_payment"
  /** Contrato aceptado y método de pago autorizado; ningún cobro todavía (p. ej. prueba gratuita). */
  | "trial_authorized"
  /** Suscripción activa con al menos un cobro confirmado. */
  | "active"
  /** Cobro fallido o pendiente (periodo de gracia). */
  | "payment_issue"
  /** Suscripción suspendida (impago o cobro revertido). */
  | "suspended"
  /** Suscripción cancelada o con baja programada ya efectiva. */
  | "canceled";

export type BillingPaymentStatus = "paid" | "failed" | "pending" | "free" | "refunded" | "partially_refunded" | "disputed";

export interface BillingCenterPayment {
  /** Identificador opaco para la lista (no es un identificador de Stripe). */
  id: string;
  /** Fecha del cargo (ms); null si aún no se cobró. */
  at: number | null;
  amountCents: number;
  currency: string;
  /** Inicio del periodo de facturación al que corresponde (ms). */
  periodStart: number | null;
  status: BillingPaymentStatus;
  kind: "first" | "renewal" | "change" | "other";
  /** Referencia de la factura de Stripe de la empresa (in_…); nunca de otra empresa. */
  reference: string | null;
  invoiceNumber: string | null;
  /** Importe reembolsado, si se conoce. */
  refundedCents: number | null;
}

export type BillingInvoiceState = "paid" | "open" | "free" | "void" | "uncollectible";

export interface BillingCenterInvoice {
  /** Identificador opaco que el panel devuelve al pedir los enlaces del documento; el servidor lo verifica contra la empresa. */
  id: string;
  source: "stripe" | "crm";
  number: string | null;
  /** Fecha de emisión (ms). */
  issuedAt: number | null;
  concept: string | null;
  baseCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  currency: string;
  state: BillingInvoiceState;
  /** Factura de 0 € por prueba gratuita: documento sin cobro. */
  free: boolean;
  /** Hay documento oficial descargable (PDF de Stripe o documento del sistema). */
  hasDocument: boolean;
}

export interface TenantBillingCenter {
  company: { name: string };
  stage: BillingStage;
  /** La empresa tiene condiciones comerciales personalizadas (no puede alterarlas por su cuenta). */
  customTerms: boolean;
  /** Plan con el que probó la plataforma (si difiere del contratado) y fin de la prueba. */
  trial: { planName: string | null; endsAt: number | null } | null;
  /** Plan contratado. */
  contracted: { planName: string | null; interval: "month" | "year" | null; reference: string | null } | null;
  /** Estado real de la suscripción en Stripe (trialing, active, past_due…), si se cobra allí. */
  stripeStatus: string | null;
  /** Servicios y módulos incluidos en la cuota. */
  included: string[];
  /** Cuota vigente con su desglose de impuestos. */
  fee: { netCents: number; taxCents: number; totalCents: number; currency: string; interval: "month" | "year" | null } | null;
  /** Próximo cobro según Stripe (no el periodo interno del CRM). */
  nextCharge: { at: number | null; estimatedTotalCents: number | null; currency: string; basis: "trial_end" | "period_end" | null } | null;
  /** Último cobro efectivamente confirmado (factura pagada > 0 €). */
  lastPayment: { at: number | null; amountCents: number; currency: string; invoiceNumber: string | null } | null;
  /** Periodo de facturación vigente en Stripe. */
  billingPeriod: { start: number | null; end: number | null } | null;
  /** Estado del método de pago; nunca datos de tarjeta. */
  paymentMethod: { state: "authorized" | "missing" | "unknown" };
  payments: BillingCenterPayment[];
  invoices: BillingCenterInvoice[];
  /** Acciones permitidas hoy. */
  actions: {
    /** Acceso seguro al portal de Stripe (método de pago y facturas). */
    portal: boolean;
    /** La empresa puede pedir cambios de plan por sí misma (false con condiciones personalizadas o contrato en curso). */
    selfServicePlanChange: boolean;
    /** Motivo legible cuando una acción no está permitida. */
    note: string | null;
  };
}

/** Enlaces oficiales de una factura (PDF y página alojada de Stripe); caducan: se piden al pulsar. */
export interface BillingInvoiceLinks {
  pdfUrl: string | null;
  hostedUrl: string | null;
}
