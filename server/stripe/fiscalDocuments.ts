/**
 * Registro de facturas de Stripe y cola de documentos fiscales (migración CRM 0015).
 *
 * Quién emite la factura LEGAL no está decidido (DF-2) y Elephant Source no implementa VeriFactu. Por eso:
 *  - cada factura COBRADA en Stripe se copia en `stripe_invoices` (trazabilidad: base, impuesto, total,
 *    reembolsado, número de Stripe, escenario fiscal del comprador);
 *  - cada cobro deja un documento `invoice` y cada reembolso una `rectification` (importe negativo, ligada al
 *    documento original) en la cola `fiscal_documents`, con clave de origen única: nunca hay dos documentos
 *    del mismo hecho aunque el evento llegue repetido, fuera de orden o por la conciliación;
 *  - el sistema de facturación que se apruebe los toma de la cola mediante un adaptador (`FiscalDocumentSink`)
 *    y registra su número (`issued`). Hasta entonces quedan `pending`: aquí no se emite ni se numera nada.
 *
 * El reparto base/impuesto de una rectificativa es PROPORCIONAL a la factura original (provisional): el
 * sistema legal es quien lo confirma.
 */
import type { GwInvoice } from "./gateway";

export type InvoicePurpose = "initial" | "renewal" | "change";

export interface StripeInvoiceRecord {
  stripeInvoiceId: string;
  orderId: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  number: string | null;
  status: NonNullable<GwInvoice["status"]>;
  billingReason: string | null;
  purpose: InvoicePurpose;
  currency: string;
  subtotalCents: number;
  taxCents: number | null;
  totalCents: number;
  amountPaidCents: number;
  amountRefundedCents: number;
  periodStart: number | null;
  customerCountry: string | null;
  customerPostalCode: string | null;
  buyerScenario: string | null;
  createdAt: number;
  updatedAt: number;
}

export type FiscalDocumentKind = "invoice" | "rectification";
export type FiscalDocumentStatus = "pending" | "issued" | "failed";

export interface FiscalDocument {
  id: number;
  kind: FiscalDocumentKind;
  sourceKey: string;
  orderId: number;
  stripeInvoiceId: string;
  stripeChargeId: string | null;
  originalDocumentId: number | null;
  currency: string;
  baseCents: number;
  taxCents: number | null;
  totalCents: number;
  status: FiscalDocumentStatus;
  externalRef: string | null;
  issuedAt: number | null;
  issuedBy: string | null;
  lastError: string | null;
  createdAt: number;
}
export type FiscalDocumentDraft = Omit<FiscalDocument, "id" | "status" | "externalRef" | "issuedAt" | "issuedBy" | "lastError">;

export const invoiceSourceKey = (stripeInvoiceId: string) => `invoice:${stripeInvoiceId}`;
export const refundSourceKey = (chargeId: string, refundedTotalCents: number) => `refund:${chargeId}:${refundedTotalCents}`;

/** Copia local de una factura cobrada (la de Stripe es la fuente de verdad). */
export function invoiceRecordOf(inv: GwInvoice, d: { orderId: number; purpose: InvoicePurpose; buyerScenario: string | null; now: number; refundedCents?: number }): StripeInvoiceRecord {
  const subtotal = inv.subtotal ?? inv.amountPaid;
  const total = inv.total ?? inv.amountPaid;
  return {
    stripeInvoiceId: inv.id,
    orderId: d.orderId,
    stripeCustomerId: inv.customerId,
    stripeSubscriptionId: inv.subscriptionId,
    number: inv.number ?? null,
    status: inv.status ?? "paid",
    billingReason: inv.billingReason,
    purpose: d.purpose,
    currency: inv.currency.toUpperCase(),
    subtotalCents: subtotal,
    taxCents: inv.taxCents ?? null,
    totalCents: total,
    amountPaidCents: inv.amountPaid,
    amountRefundedCents: d.refundedCents ?? 0,
    periodStart: inv.periodStart === null ? null : inv.periodStart * 1000,
    customerCountry: inv.customerCountry ?? null,
    customerPostalCode: inv.customerPostalCode ?? null,
    buyerScenario: d.buyerScenario,
    createdAt: d.now,
    updatedAt: d.now,
  };
}

/** Documento fiscal de una factura cobrada: base, impuesto y total de la factura de Stripe. */
export function invoiceDocumentOf(r: StripeInvoiceRecord, now: number): FiscalDocumentDraft {
  return {
    kind: "invoice",
    sourceKey: invoiceSourceKey(r.stripeInvoiceId),
    orderId: r.orderId,
    stripeInvoiceId: r.stripeInvoiceId,
    stripeChargeId: null,
    originalDocumentId: null,
    currency: r.currency,
    baseCents: r.subtotalCents,
    taxCents: r.taxCents,
    totalCents: r.totalCents,
    createdAt: now,
  };
}

/**
 * Rectificativa por el importe reembolsado DESDE la última vez (`refundedTotal - previousRefunded`), en
 * negativo, con el impuesto repartido en proporción al de la factura original (provisional). `null` si no hay
 * nada nuevo que rectificar.
 */
export function rectificationOf(
  original: Pick<FiscalDocument, "id" | "orderId" | "stripeInvoiceId" | "currency" | "taxCents" | "totalCents">,
  d: { chargeId: string; refundedTotalCents: number; previousRefundedCents: number; now: number },
): FiscalDocumentDraft | null {
  const delta = d.refundedTotalCents - d.previousRefundedCents;
  if (delta <= 0) return null;
  const tax = original.taxCents === null || original.totalCents <= 0 ? null : Math.round((delta * original.taxCents) / original.totalCents);
  return {
    kind: "rectification",
    sourceKey: refundSourceKey(d.chargeId, d.refundedTotalCents),
    orderId: original.orderId,
    stripeInvoiceId: original.stripeInvoiceId,
    stripeChargeId: d.chargeId,
    originalDocumentId: original.id,
    currency: original.currency,
    baseCents: -(delta - (tax ?? 0)),
    taxCents: tax === null ? null : -tax,
    totalCents: -delta,
    createdAt: d.now,
  };
}

/**
 * Adaptador del sistema de facturación legal que se apruebe (Stripe Invoicing, software con VeriFactu…).
 * `submit` devuelve el número del documento emitido o lo deja pendiente. Nunca lanza por un rechazo de negocio:
 * devuelve `failed` con el motivo.
 */
export interface FiscalDocumentSink {
  readonly name: string;
  submit(doc: FiscalDocument): Promise<{ status: "issued"; externalRef: string } | { status: "pending" } | { status: "failed"; error: string }>;
}

/** Adaptador por defecto mientras DF-2 esté pendiente: no emite nada; todo queda en la cola. */
export const pendingSink: FiscalDocumentSink = {
  name: "pending",
  async submit() {
    return { status: "pending" };
  },
};

/** Referencia externa admitida (número o identificador del documento legal). */
export const EXTERNAL_REF = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]{1,79}$/;
