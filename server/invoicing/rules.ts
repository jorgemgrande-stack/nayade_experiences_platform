/**
 * Reglas PURAS de la facturación propia (sin BD ni red).
 *
 *  - Devengo: en un servicio de tracto sucesivo el IVA se devenga cuando es exigible cada parte del precio (art. 75.1.7.º
 *    de la Ley 37/1992). Para una cuota mensual pactada a día fijo, la fecha de operación es el día de vencimiento de
 *    cada periodo, no el del cobro. Pendiente de confirmación profesional (contrato §5).
 *  - Datos fiscales del cliente: razón social, NIF válido y domicilio completo. Sin ellos no se expide (nunca se inventan).
 *    Canarias, Ceuta y Melilla no llevan IVA peninsular: se bloquea hasta revisarlo.
 *  - Numeración: serie-año-número correlativo; la huella encadena cada factura expedida con la anterior de su serie.
 */
import crypto from "node:crypto";
import { isValidSpanishCif } from "../stripe/issuer";
import { localDate, nextChargeAfter, periodLabel } from "../external/schedule";
import type { FiscalParty, Invoice, InvoiceLine } from "./types";

export const TIME_ZONE = "Europe/Madrid";

/** Cuota de IVA de una base (redondeo al céntimo, medios hacia arriba). */
export const taxOf = (baseCents: number, rateBp: number) => Math.round((baseCents * rateBp) / 10_000);

export function lineOf(position: number, concept: string, quantity: number, unitCents: number, taxRateBp: number): InvoiceLine {
  const baseCents = unitCents * quantity;
  return { position, concept, quantity, unitCents, baseCents, taxRateBp, taxCents: taxOf(baseCents, taxRateBp) };
}

export function totals(lines: InvoiceLine[]) {
  const baseCents = lines.reduce((a, l) => a + l.baseCents, 0);
  const taxCents = lines.reduce((a, l) => a + l.taxCents, 0);
  return { baseCents, taxCents, totalCents: baseCents + taxCents };
}

/** AAAA-MM-DD de un instante en la zona fiscal. */
export function ymd(at: number, timeZone = TIME_ZONE): string {
  const d = localDate(at, timeZone);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

const DNI = /^(\d{8})([A-Z])$/;
const NIE = /^([XYZ])(\d{7})([A-Z])$/;
const LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
/** NIF español: persona jurídica (CIF), DNI o NIE, con su control. */
export function isValidSpanishTaxId(value: string): boolean {
  const v = value.trim().toUpperCase().replace(/[\s-]/g, "").replace(/^ES/, "");
  if (isValidSpanishCif(v)) return true;
  const d = DNI.exec(v);
  if (d) return LETTERS[Number(d[1]) % 23] === d[2];
  const n = NIE.exec(v);
  if (n) return LETTERS[Number(`${"XYZ".indexOf(n[1])}${n[2]}`) % 23] === n[3];
  return false;
}

/** Territorios españoles sin IVA (Canarias, Ceuta, Melilla) por código postal. */
const NO_VAT_PREFIX = ["35", "38", "51", "52"];

export interface CompanyFiscal {
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  billingEmail?: string | null;
  email?: string | null;
}

/** Datos fiscales del cliente para la factura, o los motivos por los que todavía no se puede expedir. */
export function customerOf(c: CompanyFiscal): { party: FiscalParty | null; problems: string[] } {
  const problems: string[] = [];
  const country = (c.country ?? "").trim().toUpperCase();
  const taxId = (c.taxId ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!c.legalName?.trim()) problems.push("falta la razón social");
  if (!taxId) problems.push("falta el NIF");
  else if (country === "ES" && !isValidSpanishTaxId(taxId)) problems.push("el NIF no es válido");
  if (!c.address?.trim()) problems.push("falta el domicilio fiscal");
  if (!c.postalCode?.trim()) problems.push("falta el código postal");
  if (!c.city?.trim()) problems.push("falta la localidad");
  if (!/^[A-Z]{2}$/.test(country)) problems.push("falta el país");
  if (country === "ES" && c.postalCode && !/^\d{5}$/.test(c.postalCode.trim())) problems.push("el código postal no es válido");
  if (country === "ES" && c.postalCode && NO_VAT_PREFIX.includes(c.postalCode.trim().slice(0, 2))) problems.push("domicilio en Canarias, Ceuta o Melilla: el IVA del 21 % no aplica sin revisión fiscal");
  if (country && country !== "ES") problems.push("cliente fuera de España: el tratamiento del IVA requiere revisión fiscal");
  if (problems.length) return { party: null, problems };
  return {
    party: { legalName: c.legalName!.trim(), taxId, address: c.address!.trim(), postalCode: c.postalCode!.trim(), city: c.city!.trim(), country, email: c.billingEmail ?? c.email ?? null },
    problems,
  };
}

export interface ExternalSchedule {
  id: number;
  serviceName: string;
  amountCents: number;
  taxRateBp: number;
  currency: string;
  billingDay: number;
  billingHour: number;
  timezone: string;
  firstChargeAt: number;
}

export interface Period {
  start: number;
  end: number;
  label: string;
  /** Fecha de operación (devengo): el día de vencimiento en la zona fiscal. */
  operationDate: string;
  /** `AAAA-MM` del vencimiento: identifica el periodo en la clave de origen. */
  month: string;
}

/** Periodos devengados de un servicio externo hasta `now` (incluido el que vence justo ahora). */
export function externalPeriods(x: ExternalSchedule, now: number, max = 36): Period[] {
  const out: Period[] = [];
  let start = x.firstChargeAt;
  while (start <= now && out.length < max) {
    const end = nextChargeAfter(start, x.billingDay, x.billingHour, x.timezone);
    const operationDate = ymd(start, x.timezone);
    out.push({ start, end, label: periodLabel(start, x.timezone), operationDate, month: operationDate.slice(0, 7) });
    start = end;
  }
  return out;
}

export const externalSourceKey = (externalId: number, month: string) => `external:${externalId}:${month}`;

export const invoiceNumber = (series: string, year: number, n: number) => `${series}-${year}-${String(n).padStart(5, "0")}`;

/** Huella de una factura expedida, encadenada con la anterior de su serie (integridad e inalterabilidad). */
export function invoiceHash(previousHash: string | null, inv: Pick<Invoice, "number" | "issueDate" | "operationDate" | "baseCents" | "taxCents" | "totalCents" | "currency" | "kind"> & { issuerTaxId: string; customerTaxId: string; lines: InvoiceLine[] }): string {
  const canonical = JSON.stringify([previousHash ?? "", inv.number, inv.kind, inv.issueDate, inv.operationDate, inv.issuerTaxId, inv.customerTaxId, inv.currency, inv.baseCents, inv.taxCents, inv.totalCents, inv.lines.map((l) => [l.position, l.concept, l.quantity, l.unitCents, l.baseCents, l.taxRateBp, l.taxCents])]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
