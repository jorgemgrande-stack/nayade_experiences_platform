/**
 * Documento contractual de un servicio externo: texto determinista a partir del contrato del CRM (versión exacta) y de
 * las condiciones de cobro. Lo que se presenta al firmante es exactamente lo que se resume en `documentSha256`: si el
 * contrato cambia, la huella cambia y una aceptación anterior deja de valer.
 */
import crypto from "node:crypto";
import { issuerLine } from "../stripe/issuer";
import { localDate } from "./schedule";
import { adjustmentText, cadence, isMonthly } from "./cadence";
import type { ExternalSubscription } from "./types";

export const eur = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(cents / 100);
const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;

export const taxCents = (x: Pick<ExternalSubscription, "amountCents" | "taxRateBp">) => Math.round((x.amountCents * x.taxRateBp) / 10_000);

export type BillingTermsInput = Pick<ExternalSubscription, "serviceName" | "amountCents" | "currency" | "taxRateBp" | "billingDay" | "billingHour" | "timezone" | "graceDays" | "firstChargeAt"> &
  Partial<Pick<ExternalSubscription, "interval" | "intervalCount" | "durationPeriods" | "endsAt" | "baseAmountCents" | "adjustment">>;

const ddmmyyyy = (at: number, tz: string) => {
  const d = localDate(at, tz);
  return `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}/${d.year}`;
};

/**
 * Condiciones de cobro en texto (las mismas en el contrato, en la página de aceptación y en la autorización de Stripe).
 * Mensual, sin duración fija ni ajuste: exactamente el texto de siempre (la huella de los contratos aceptados no cambia).
 */
export function billingTerms(x: BillingTermsInput): string[] {
  const first = localDate(x.firstChargeAt, x.timezone);
  const tax = taxCents(x);
  const c = cadence(x);
  const adjustment = x.adjustment && x.baseAmountCents ? [`Precio de lista: ${eur(x.baseAmountCents, x.currency)} más IVA por periodo; se aplica un ${adjustmentText(x.adjustment, x.currency)} autorizado (${x.adjustment.reason}).`] : [];
  const duration =
    x.durationPeriods && x.endsAt
      ? [`Duración: ${x.durationPeriods} ${x.durationPeriods === 1 ? `periodo ${c.adj}` : `periodos ${c.adj}es`}, hasta el ${ddmmyyyy(x.endsAt, x.timezone)}, sin renovación automática. Después no se emite ningún cargo más.`]
      : [];
  const tail = [
    "Autorización: el cliente autoriza a cobrar estas cuotas recurrentes con el método de pago que registre en Stripe. Puede consultar sus facturas, actualizar el método de pago o solicitar la baja conforme a este contrato desde el portal de facturación que se le facilita.",
    "El impago no detiene por sí solo la infraestructura tecnológica del cliente, que es externa a Elephant Source.",
  ];
  if (!isMonthly(x))
    return [
      `Servicio: ${x.serviceName}.`,
      ...adjustment,
      `Cuota ${c.adj}: ${eur(x.amountCents, x.currency)} más IVA (${pct(x.taxRateBp)}, ${eur(tax, x.currency)}): total previsto ${eur(x.amountCents + tax, x.currency)} ${c.per}.`,
      `Periodicidad: ${c.adj}. Cargo ordinario el día ${x.billingDay} del mes en que empieza cada periodo (${x.timezone}); primer cargo el ${ddmmyyyy(x.firstChargeAt, x.timezone)}.`,
      `Cada cargo corresponde al periodo ${c.adj} que empieza ese día. Margen de pago: ${x.graceDays} días desde cada cargo; en ese plazo se reintenta el cobro y no se emite ningún cargo adicional por el mismo periodo.`,
      ...duration,
      ...tail,
    ];
  return [
    `Servicio: ${x.serviceName}.`,
    ...adjustment,
    `Cuota mensual: ${eur(x.amountCents, x.currency)} más IVA (${pct(x.taxRateBp)}, ${eur(tax, x.currency)}): total previsto ${eur(x.amountCents + tax, x.currency)} al mes.`,
    `Periodicidad: mensual. Cargo ordinario el día ${x.billingDay} de cada mes (${x.timezone}); primer cargo el ${String(first.day).padStart(2, "0")}/${String(first.month).padStart(2, "0")}/${first.year}.`,
    `Cada cargo corresponde a la mensualidad que empieza ese día. Margen de pago: hasta el día ${x.billingDay + x.graceDays - 1} del mes; en ese plazo se reintenta el cobro y no se emite ningún cargo adicional por el mismo periodo.`,
    ...duration,
    ...tail,
  ];
}

export interface ContractDocumentInput {
  contract: { id: number; reference: string | null; version: number; conditions: string | null };
  company: { name: string; legalName: string | null; taxId: string | null };
  external: Parameters<typeof billingTerms>[0] & { externalRef: string | null };
}

export function renderContract(i: ContractDocumentInput): string {
  const lines = [
    `CONTRATO DE SERVICIO ${i.contract.reference ?? `#${i.contract.id}`} — versión ${i.contract.version}`,
    "",
    `Prestador: ${issuerLine()}.`,
    `Cliente: ${i.company.legalName ?? i.company.name}${i.company.taxId ? ` (NIF ${i.company.taxId})` : ""}.`,
    ...(i.external.externalRef ? [`Referencia del servicio: ${i.external.externalRef}.`] : []),
    "",
    "CONDICIONES ECONÓMICAS Y DE COBRO",
    ...billingTerms(i.external).map((l) => `- ${l}`),
    "",
    "CONDICIONES DEL SERVICIO",
    (i.contract.conditions ?? "Las acordadas entre las partes.").trim(),
  ];
  return lines.join("\n");
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
