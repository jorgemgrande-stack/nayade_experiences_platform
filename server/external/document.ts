/**
 * Documento contractual de un servicio externo: texto determinista a partir del contrato del CRM (versión exacta) y de
 * las condiciones de cobro. Lo que se presenta al firmante es exactamente lo que se resume en `documentSha256`: si el
 * contrato cambia, la huella cambia y una aceptación anterior deja de valer.
 */
import crypto from "node:crypto";
import { issuerLine } from "../stripe/issuer";
import { localDate } from "./schedule";
import type { ExternalSubscription } from "./types";

const eur = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(cents / 100);
const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;

export const taxCents = (x: Pick<ExternalSubscription, "amountCents" | "taxRateBp">) => Math.round((x.amountCents * x.taxRateBp) / 10_000);

/** Condiciones de cobro en texto (las mismas en el contrato, en la página de aceptación y en la autorización de Stripe). */
export function billingTerms(x: Pick<ExternalSubscription, "serviceName" | "amountCents" | "currency" | "taxRateBp" | "billingDay" | "billingHour" | "timezone" | "graceDays" | "firstChargeAt">): string[] {
  const first = localDate(x.firstChargeAt, x.timezone);
  const tax = taxCents(x);
  return [
    `Servicio: ${x.serviceName}.`,
    `Cuota mensual: ${eur(x.amountCents, x.currency)} más IVA (${pct(x.taxRateBp)}, ${eur(tax, x.currency)}): total previsto ${eur(x.amountCents + tax, x.currency)} al mes.`,
    `Periodicidad: mensual. Cargo ordinario el día ${x.billingDay} de cada mes (${x.timezone}); primer cargo el ${String(first.day).padStart(2, "0")}/${String(first.month).padStart(2, "0")}/${first.year}.`,
    `Cada cargo corresponde a la mensualidad que empieza ese día. Margen de pago: hasta el día ${x.billingDay + x.graceDays - 1} del mes; en ese plazo se reintenta el cobro y no se emite ningún cargo adicional por el mismo periodo.`,
    "Autorización: el cliente autoriza a cobrar estas cuotas recurrentes con el método de pago que registre en Stripe. Puede consultar sus facturas, actualizar el método de pago o solicitar la baja conforme a este contrato desde el portal de facturación que se le facilita.",
    "El impago no detiene por sí solo la infraestructura tecnológica del cliente, que es externa a Elephant Source.",
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
