/**
 * Texto y aviso de los reembolsos y disputas que comunica Stripe (charge.refunded, charge.dispute.*). Compartido por el
 * puerto de pedidos y el de presupuestos. El Core solo reacciona: no ejecuta reembolsos ni emite abonos o rectificativas
 * (decisión fiscal de la administración); deja constancia y avisa.
 */
import { notifyOwner } from "../_core/notification";
import type { PaymentIncident, PaymentIncidentKind } from "./service";

export const INCIDENT_LABEL: Record<PaymentIncidentKind, string> = {
  refund_full: "Reembolso total",
  refund_partial: "Reembolso parcial",
  dispute_opened: "Disputa abierta",
  dispute_won: "Disputa ganada",
  dispute_lost: "Disputa perdida",
};

const eur = (cents: number, currency: string) => `${(cents / 100).toFixed(2).replace(".", ",")} ${currency.toUpperCase() === "EUR" ? "€" : currency.toUpperCase()}`;

/** Qué debe hacer la administración tras este hecho (el Core no lo hace solo). */
export function incidentAdvice(kind: PaymentIncidentKind): string {
  switch (kind) {
    case "refund_full":
      return "Revisa la devolución: decide si procede el abono o la rectificativa (circuito de anulaciones). El Core no ha emitido ningún documento ni ha tocado reservas ni stock.";
    case "refund_partial":
      return "Reembolso parcial: decide si procede una rectificativa por la parte devuelta. El Core no ha emitido ningún documento y el acceso del alumno no se ha modificado.";
    case "dispute_opened":
      return "Responde a la disputa en el panel de Stripe dentro del plazo. Por precaución, el acceso a la formación queda suspendido mientras se resuelve.";
    case "dispute_won":
      return "Disputa resuelta a tu favor: el cobro se mantiene. El acceso suspendido por la disputa se ha reabierto.";
    case "dispute_lost":
      return "Disputa perdida: el importe se pierde. El acceso a la formación queda revocado. Decide el tratamiento contable.";
  }
}

export function incidentText(ref: string, i: PaymentIncident): { title: string; content: string } {
  const lines = [
    `${INCIDENT_LABEL[i.kind]} en ${ref}.`,
    `Cobrado: ${eur(i.chargedCents, i.currency)}.`,
    i.refundedCents != null ? `Devuelto hasta ahora: ${eur(i.refundedCents, i.currency)}.` : null,
    i.reason ? `Motivo indicado por Stripe: ${i.reason}.` : null,
    i.paymentIntent ? `Referencia de Stripe: ${i.paymentIntent}.` : null,
    incidentAdvice(i.kind),
  ].filter(Boolean);
  return { title: `Stripe: ${INCIDENT_LABEL[i.kind].toLowerCase()} (${ref})`, content: lines.join("\n") };
}

/** Aviso a la administración. Nunca falla: el hecho ya está marcado y un fallo del aviso no debe reabrir el evento. */
export async function alertAdmin(ref: string, i: PaymentIncident): Promise<void> {
  try {
    await notifyOwner(incidentText(ref, i));
  } catch (e) {
    console.error("[Stripe] No se pudo avisar de la incidencia de cobro:", (e as Error).message);
  }
}
