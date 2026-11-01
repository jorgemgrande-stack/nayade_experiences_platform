/**
 * Canje de un ticket de caja (o de un pedido ya cobrado) por una factura completa.
 *
 * Una factura completa debe identificar al destinatario: nombre y apellidos o razón social, NIF y domicilio
 * (art. 6 del Real Decreto 1619/2012). Por eso el canje no admite el nombre genérico de las ventas sin
 * cliente («Cliente TPV») ni se emite sin NIF. Lógica pura, compartida por el servidor y el diálogo.
 */

import { validateNif } from "./directInvoice";

/** Nombre con el que la caja guarda las ventas sin cliente: no identifica a nadie. */
export const ANONYMOUS_TICKET_NAME = "Cliente TPV";

export interface TicketInvoiceRecipient {
  name: string;
  nif: string;
  address: string;
  postalCode: string;
  city: string;
}

export type TicketInvoiceRecipientErrors = Partial<Record<keyof TicketInvoiceRecipient, string>>;

const isAnonymousName = (n: string) => n.trim().toLowerCase() === ANONYMOUS_TICKET_NAME.toLowerCase();

/** Errores por campo (vacío = se puede emitir la factura). */
export function validateTicketInvoiceRecipient(r: Partial<TicketInvoiceRecipient>): TicketInvoiceRecipientErrors {
  const e: TicketInvoiceRecipientErrors = {};
  const name = (r.name ?? "").trim();
  const nif = (r.nif ?? "").trim();
  if (!name || isAnonymousName(name)) e.name = "Indica el nombre o la razón social del destinatario de la factura.";
  if (!nif) e.nif = "Indica el NIF del destinatario de la factura.";
  else {
    const bad = validateNif(nif);
    if (bad) e.nif = `${bad}. Revisa la letra y los números (por ejemplo, B12345674).`;
  }
  if (!(r.address ?? "").trim()) e.address = "Indica la dirección del destinatario.";
  if (!(r.postalCode ?? "").trim()) e.postalCode = "Indica el código postal.";
  if (!(r.city ?? "").trim()) e.city = "Indica la población.";
  return e;
}

/** Domicilio en una línea, como figura en la factura: «Calle Mayor 4, 28901 Getafe». */
export function formatRecipientAddress(r: Pick<TicketInvoiceRecipient, "address" | "postalCode" | "city">): string {
  const place = [r.postalCode.trim(), r.city.trim()].filter(Boolean).join(" ");
  return [r.address.trim(), place].filter(Boolean).join(", ");
}

/** Datos que se proponen en el diálogo: los del cliente vinculado a la venta o, si no hay, el nombre del ticket. */
export function proposeTicketInvoiceRecipient(
  client: { name: string; company?: string | null; nif?: string | null; address?: string | null; postalCode?: string | null; city?: string | null } | null,
  customerName: string | null | undefined,
): TicketInvoiceRecipient & { fromClient: boolean } {
  if (client) {
    return {
      name: ((client.company ?? "").trim() || client.name || "").trim(),
      nif: (client.nif ?? "").trim(),
      address: (client.address ?? "").trim(),
      postalCode: (client.postalCode ?? "").trim(),
      city: (client.city ?? "").trim(),
      fromClient: true,
    };
  }
  const n = (customerName ?? "").trim();
  return { name: isAnonymousName(n) ? "" : n, nif: "", address: "", postalCode: "", city: "", fromClient: false };
}

export type InvoicePaymentMethod = "redsys" | "transferencia" | "efectivo" | "otro" | "tarjeta_fisica" | "tarjeta_redsys";

/**
 * Forma de pago de la factura a partir de los cobros del ticket: la del cobro de mayor importe
 * (efectivo, tarjeta; Bizum y otros figuran como «otro»). Sin cobros, la del pedido.
 */
export function invoicePaymentMethodFromTicket(
  payments: { method: string; amount: number | string }[],
  fallback?: string | null,
): InvoicePaymentMethod {
  const map: Record<string, InvoicePaymentMethod> = { cash: "efectivo", card: "tarjeta_fisica", bizum: "otro", other: "otro" };
  if (payments.length) {
    const main = [...payments].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    return map[main.method] ?? "otro";
  }
  const known: InvoicePaymentMethod[] = ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"];
  return known.includes(fallback as InvoicePaymentMethod) ? (fallback as InvoicePaymentMethod) : "otro";
}

/**
 * Límite de la factura simplificada (ticket): 400 € IVA incluido, el general del art. 4.1 a) del
 * Real Decreto 1619/2012. Por encima solo cabe la factura completa (art. 6). Las excepciones de hasta
 * 3.000 € del art. 4.1 b) para determinadas actividades (comercio minorista, hostelería...) no se aplican:
 * la caja usa siempre el límite general.
 */
export const SIMPLIFIED_INVOICE_LIMIT_EUR = 400;

/** Si el importe cobrado (IVA incluido) supera lo que admite un ticket. */
export function exceedsSimplifiedInvoiceLimit(total: number): boolean {
  return Math.round(total * 100) > SIMPLIFIED_INVOICE_LIMIT_EUR * 100;
}

export type CashSaleDocument =
  | { kind: "ticket" }
  | { kind: "factura"; recipient: TicketInvoiceRecipient; source: "cliente" | "caja" }
  | { kind: "rechazo"; message: string };

const normalizeRecipient = (r: Partial<TicketInvoiceRecipient>): TicketInvoiceRecipient => ({
  name: (r.name ?? "").trim(),
  nif: (r.nif ?? "").trim().toUpperCase(),
  address: (r.address ?? "").trim(),
  postalCode: (r.postalCode ?? "").trim(),
  city: (r.city ?? "").trim(),
});

/**
 * Qué documento fiscal emite una venta de caja al cobrarla (en efectivo, con tarjeta o de otra forma):
 *  - Datos del destinatario escritos en la caja (el cliente pide factura): factura completa a su nombre;
 *    si están incompletos, la venta no se cobra hasta corregirlos.
 *  - Cliente vinculado con nombre o razón social, NIF válido y domicilio: factura completa a su nombre.
 *  - En otro caso, solo ticket (factura simplificada, art. 4 RD 1619/2012); el cliente puede pedir después
 *    la factura completa canjeando el ticket. Nunca una factura completa sin destinatario identificado.
 *  - Por encima del límite de la simplificada no se admite solo ticket: hay que indicar el destinatario.
 */
export function cashSaleDocument(params: {
  total: number;
  requested?: Partial<TicketInvoiceRecipient> | null;
  client?: Parameters<typeof proposeTicketInvoiceRecipient>[0];
}): CashSaleDocument {
  if (params.requested) {
    const recipient = normalizeRecipient(params.requested);
    const errors = Object.values(validateTicketInvoiceRecipient(recipient));
    if (errors.length) return { kind: "rechazo", message: `Faltan datos para la factura completa: ${errors.join(" ")}` };
    return { kind: "factura", recipient, source: "caja" };
  }
  if (params.client) {
    const { fromClient: _f, ...proposal } = proposeTicketInvoiceRecipient(params.client, null);
    const recipient = normalizeRecipient(proposal);
    if (Object.keys(validateTicketInvoiceRecipient(recipient)).length === 0) return { kind: "factura", recipient, source: "cliente" };
  }
  if (exceedsSimplifiedInvoiceLimit(params.total)) {
    return {
      kind: "rechazo",
      message: `Esta venta supera ${SIMPLIFIED_INVOICE_LIMIT_EUR} € (IVA incluido) y no se puede cobrar solo con ticket: hace falta factura completa. Indica los datos del destinatario (nombre o razón social, NIF y dirección).`,
    };
  }
  return { kind: "ticket" };
}
