/**
 * Reglas deterministas de conciliación bancaria automática (Contabilidad › Bancos). Cada regla reconoce un movimiento
 * por su concepto EXACTO (normalizado: mayúsculas y espacios simples) y su signo, nunca por parecido de texto. Lo que no
 * casa con ninguna regla, o casa con una que exige un registro que no existe (p. ej. el pago de una obligación sin la
 * obligación presentada), se queda pendiente de revisión. Sin IA: si una regla no basta, el movimiento no se toca.
 *
 * Tipos de regla:
 *  - `bank_fee`: cargo de la propia entidad (comisiones del TPV, mantenimiento, extractos, transferencias, tarjetas):
 *    asiento contra 626 con la naturaleza «servicio bancario» o «comisión de cobro» (sin gasto ni IVA).
 *  - `supplier_charge`: cargo con tarjeta de un proveedor de servicios digitales identificado por su concepto: gasto en
 *    Contabilidad › Gastos «pendiente de factura» (sin IVA inventado, fuera de los modelos hasta tener la factura) y su
 *    pago por banco. Solo cargos (importe negativo); las devoluciones se quedan pendientes.
 *  - `tax_payment`: pago de un modelo a la AEAT: se concilia SOLO contra una obligación presentada con ese importe exacto
 *    (o una cuota de aplazamiento con su principal e intereses); sin ella, pendiente.
 */
import type { BankFeeNature } from "./opsTypes";

/** Proveedor conocido de un cargo con tarjeta: datos que se dan de alta si no existe (país por verificar con la factura). */
export interface KnownSupplier {
  key: string;
  name: string;
  country: string;
  /** Categoría de gasto (nombre sembrado en la migración 0035) y su cuenta. */
  category: string;
  accountCode: string;
}

export type BankRule =
  | { code: string; kind: "bank_fee"; label: string; test: RegExp; nature: BankFeeNature }
  | { code: string; kind: "supplier_charge"; label: string; test: RegExp; supplier: KnownSupplier }
  | { code: string; kind: "tax_payment"; label: string; test: RegExp; model: "303" | "111" | "115" | "deferral" };

const SOFTWARE = { category: "Software y licencias", accountCode: "629" } as const;
const HOSTING = { category: "Hosting e infraestructura en la nube", accountCode: "629" } as const;
const ADS = { category: "Publicidad y marketing", accountCode: "627" } as const;

export const KNOWN_SUPPLIERS: Record<string, KnownSupplier> = {
  openai: { key: "openai", name: "OpenAI", country: "IE", ...SOFTWARE },
  anthropic: { key: "anthropic", name: "Anthropic", country: "IE", ...SOFTWARE },
  railway: { key: "railway", name: "Railway", country: "US", ...HOSTING },
  postmark: { key: "postmark", name: "Postmark", country: "US", ...HOSTING },
  brevo: { key: "brevo", name: "Brevo", country: "FR", ...SOFTWARE },
  microsoft: { key: "microsoft", name: "Microsoft", country: "IE", ...SOFTWARE },
  google_ads: { key: "google_ads", name: "Google Ads", country: "IE", ...ADS },
  meta: { key: "meta", name: "Meta (Facebook Ads)", country: "IE", ...ADS },
};

/**
 * Reglas vigentes. El orden importa poco (los patrones son exclusivos), pero se evalúan en este orden y gana la primera.
 * Conceptos de CaixaBank tal cual llegan en su extracto (sin el tercero).
 */
export const BANK_RULES: readonly BankRule[] = [
  { code: "caixabank.tpv_commission", kind: "bank_fee", label: "Comisión del TPV de CaixaBank", test: /^C\. \d+ \d+$/, nature: "cobro" },
  { code: "caixabank.tpv_maintenance", kind: "bank_fee", label: "Mantenimiento del TPV de CaixaBank", test: /^(MANTENIMIENTO TPV|SERV\.TPV\.MANT\/B\.OP\.|SERVICIO ALTA TPV)$/, nature: "servicio" },
  { code: "caixabank.service_fee", kind: "bank_fee", label: "Comisión de servicio de CaixaBank", test: /^(PRECIO ED\. EXTRACTO|P\.SERV\. TRF\. AJENA|P\.SERV\.CERTIF\.|COSTE USO CAJERO|CUOTA T\. V\.ELE\.BU)$/, nature: "servicio" },
  { code: "supplier.openai", kind: "supplier_charge", label: "Cargo de OpenAI", test: /^OPENAI( CHATGPT S)?$/, supplier: KNOWN_SUPPLIERS.openai },
  { code: "supplier.anthropic", kind: "supplier_charge", label: "Cargo de Anthropic", test: /^ANTHROPIC( CLAUDE)?$/, supplier: KNOWN_SUPPLIERS.anthropic },
  { code: "supplier.railway", kind: "supplier_charge", label: "Cargo de Railway", test: /^RAILWAY$/, supplier: KNOWN_SUPPLIERS.railway },
  { code: "supplier.postmark", kind: "supplier_charge", label: "Cargo de Postmark", test: /^POSTMARKAPP\.COM$/, supplier: KNOWN_SUPPLIERS.postmark },
  { code: "supplier.brevo", kind: "supplier_charge", label: "Cargo de Brevo (Sendinblue)", test: /^(BREVO|SENDINBLUE)$/, supplier: KNOWN_SUPPLIERS.brevo },
  { code: "supplier.microsoft", kind: "supplier_charge", label: "Cargo de Microsoft", test: /^MICROSOFT MICROSO$/, supplier: KNOWN_SUPPLIERS.microsoft },
  { code: "supplier.google_ads", kind: "supplier_charge", label: "Cargo de Google Ads", test: /^GOOGLE ADS\d*$/, supplier: KNOWN_SUPPLIERS.google_ads },
  { code: "supplier.meta", kind: "supplier_charge", label: "Cargo de Meta (Facebook Ads)", test: /^FACEBK [A-Z0-9*#]+$/, supplier: KNOWN_SUPPLIERS.meta },
  { code: "aeat.vat_303", kind: "tax_payment", label: "Pago del modelo 303 (IVA)", test: /^I\.V\.A\. MODELO 303$/, model: "303" },
  { code: "aeat.irpf_111", kind: "tax_payment", label: "Pago del modelo 111 (retenciones)", test: /^I\.R\.P\.F\. MOD\.111$/, model: "111" },
  { code: "aeat.irpf_115", kind: "tax_payment", label: "Pago del modelo 115 (retenciones de alquileres)", test: /^I\.R\.P\.F\. MOD\.115$/, model: "115" },
  { code: "aeat.deferral", kind: "tax_payment", label: "Cuota de aplazamiento o fraccionamiento de la AEAT", test: /^APLAZAM\.\/FRACC\.$/, model: "deferral" },
];

/** Concepto normalizado para las reglas: mayúsculas, sin espacios repetidos ni en los extremos. */
export const normalizeConcept = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/** Primera regla que reconoce el movimiento (por concepto exacto y signo), o null. */
export function ruleFor(m: { description: string | null; amountCents: number }): BankRule | null {
  const concept = normalizeConcept(m.description);
  if (!concept || m.amountCents === 0) return null;
  for (const r of BANK_RULES) {
    if (!r.test.test(concept)) continue;
    // Los cargos de proveedores y los pagos a la AEAT solo son salidas; las comisiones, en ambos sentidos (devoluciones)
    if (r.kind !== "bank_fee" && m.amountCents > 0) return null;
    return r;
  }
  return null;
}

/** Gasto pendiente de factura nacido de un cargo bancario: `bank-charge:<movimiento>`. */
export const BANK_CHARGE_EXPENSE_PREFIX = "bank-charge:";
export const bankChargeExpenseSourceKey = (movementId: number) => `${BANK_CHARGE_EXPENSE_PREFIX}${movementId}`;
