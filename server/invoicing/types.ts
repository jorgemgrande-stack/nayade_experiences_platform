/**
 * Facturación propia de Elephant Source (CRM 0027). Contrato: docs/elephant-source/CONTRATO_COBROS_FACTURACION.md §5.
 * Se factura por DEVENGO (fecha de operación); el cobro es un estado aparte. Importes en céntimos enteros.
 */

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
