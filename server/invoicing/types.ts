/**
 * Facturación propia de Elephant Source (CRM 0027). Contrato: docs/elephant-source/CONTRATO_COBROS_FACTURACION.md §5.
 * Se factura por DEVENGO (fecha de operación); el cobro es un estado aparte. Importes en céntimos enteros.
 */
import type { CreditDecision, FiscalEvidence } from "./fiscalMatrix";

/** `draft`: preparada, sin número. `issued`: expedida (número, datos congelados, huella). `rectified`: corregida por una rectificativa. */
export type InvoiceStatus = "draft" | "issued" | "rectified";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type InvoiceKind = "invoice" | "rectification";

export interface FiscalParty {
  legalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alfa-2. */
  country: string;
  email?: string | null;
}

export interface InvoiceLine {
  position: number;
  concept: string;
  quantity: number;
  unitCents: number;
  baseCents: number;
  taxRateBp: number;
  taxCents: number;
  /**
   * Solo en líneas con descuento (CRM 0045): importe antes del descuento y descuento aplicado, sin impuestos. Siempre
   * `grossCents − discountCents = baseCents`; el precio unitario (`unitCents`) es el previo al descuento.
   */
  grossCents?: number | null;
  discountCents?: number | null;
}

/** Tipo de factura: completa (art. 6 del RD 1619/2012) o simplificada (arts. 4 y 7). */
export type InvoiceType = "complete" | "simplified";

/**
 * Datos fiscales de la factura (CRM 0045, `invoices.fiscal_json`). Las facturas sin ellos (servicios externos, cargos y
 * todo lo anterior) se comportan exactamente como antes.
 */
export interface InvoiceFiscalDetail {
  invoiceType: InvoiceType;
  /** Caso fiscal del comprador (`server/invoicing/fiscalCases.ts`); null si no se ha clasificado. */
  fiscalCase: string | null;
  /** Tratamiento aplicado (`taxed_es`, `not_subject`, `reverse_charge`, `oss_destination`). */
  treatment: string | null;
  /** Mención legal impresa en la factura (plantilla del caso); null = ninguna. */
  legalMention: string | null;
  /** Fecha del cobro (AAAA-MM-DD, Europe/Madrid) si consta. */
  collectionDate: string | null;
  /** Criterio de devengo: cobro anticipado (art. 75.Dos) o exigibilidad del periodo (art. 75.Uno.7.º). */
  accrualBasis: "advance_payment" | "due_date" | null;
  /** Saldo a favor del cliente aplicado en Stripe (forma de pago, no descuento), en céntimos. */
  balanceAppliedCents: number;
  /** Supuestos pendientes de confirmar por la gestoría que afectan a esta factura (identificadores de `ADVISOR_QUESTIONS`). */
  advisorPending: string[];
  /** Versión de la matriz fiscal con la que se expidió (`FISCAL_MATRIX_VERSION`) y regla aplicada. Ausentes en las anteriores. */
  matrixVersion?: string | null;
  ruleId?: string | null;
  /** Evidencias fiscales congeladas al expedir: comprador, VIES, localización, Stripe Tax, fechas e importes. */
  evidence?: FiscalEvidence | null;
  /** Origen del saldo a favor aplicado (lo decide una persona): medio de pago o ajuste de precio con su rectificativa. */
  credit?: CreditDecision | null;
  /** Rectificativa: la factura que rectifica (serie, número, fecha y tipo). */
  rectifies?: { invoiceId: number; number: string | null; issueDate: string | null; invoiceType: InvoiceType } | null;
}

export interface Invoice {
  id: number;
  /** Hecho facturable, único por entorno: `external:<id>:<AAAA-MM>`, `charge:<id>`… */
  sourceKey: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  companyId: number;
  /** Lo que se factura: `external:<id>`, `order:<id>`, `charge:<id>`. */
  billingRef: string;
  /** Cobro que la liquida (`stripe:in:<id>`, `offline:<ref>`). */
  paymentRef: string | null;
  originalInvoiceId: number | null;
  seriesCode: string | null;
  number: string | null;
  /** Fecha de operación (devengo), AAAA-MM-DD en Europe/Madrid. */
  operationDate: string;
  periodStart: number | null;
  periodEnd: number | null;
  periodLabel: string | null;
  /** Fecha de expedición (AAAA-MM-DD), al expedir. */
  issueDate: string | null;
  currency: string;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  issuer: FiscalParty | null;
  customer: FiscalParty | null;
  hash: string | null;
  previousHash: string | null;
  notes: string | null;
  issuedAt: number | null;
  issuedBy: string | null;
  paidAt: number | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  lines: InvoiceLine[];
  /** Datos fiscales (tipo de factura, caso, mención, fechas); ausente o null en las facturas que no los tienen. */
  fiscal?: InvoiceFiscalDetail | null;
}

export type NewInvoice = Omit<Invoice, "id" | "status" | "seriesCode" | "number" | "issueDate" | "issuer" | "hash" | "previousHash" | "issuedAt" | "issuedBy" | "paidAt" | "updatedAt" | "version"> & { status?: "draft" };

export class InvoicingError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_state" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "InvoicingError";
  }
}
