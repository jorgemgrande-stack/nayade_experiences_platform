/**
 * Cobros con la cuenta Stripe de cada empresa: reglas puras (sin base de datos ni red), compartidas por servidor,
 * cliente y pruebas. Prueba y Real son dos conexiones distintas; nunca se mezclan.
 */
export type PaymentMode = "test" | "live";
export type PaymentAccountStatus = "no_conectada" | "pendiente" | "verificada" | "restringida";

export const MODE_LABEL: Record<PaymentMode, string> = { test: "Prueba", live: "Real" };
export const STATUS_LABEL: Record<PaymentAccountStatus, string> = {
  no_conectada: "No conectada",
  pendiente: "Pendiente de verificación",
  verificada: "Verificada",
  restringida: "Restringida",
};

/** Lo que Stripe dice de una cuenta conectada (solo los campos que usamos). */
export interface StripeAccountFacts {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** Campos que Stripe sigue pidiendo (currently_due + past_due). */
  requirementsDue: string[];
  /** Motivo de desactivación indicado por Stripe (p. ej. «rejected.fraud», «requirements.past_due»). */
  disabledReason: string | null;
}

/**
 * Estado de la cuenta, SIEMPRE derivado de lo que Stripe informa:
 *  - verificada: puede cobrar y cobrar sin requisitos vencidos ni motivo de desactivación;
 *  - restringida: Stripe la desactiva (motivo) o puede haber cobrado y ahora no, o tiene requisitos vencidos;
 *  - pendiente: aún faltan datos o Stripe está revisándolos.
 */
export function deriveAccountStatus(f: StripeAccountFacts): PaymentAccountStatus {
  if (f.disabledReason && !f.disabledReason.startsWith("requirements.pending")) {
    // «requirements.past_due» y «rejected.*», «listed», «under_review»… → restringida, salvo que aún no haya enviado datos
    if (!f.detailsSubmitted && f.disabledReason === "requirements.past_due") return "pendiente";
    return "restringida";
  }
  if (f.chargesEnabled && f.payoutsEnabled && f.requirementsDue.length === 0) return "verificada";
  if (f.chargesEnabled && f.detailsSubmitted && f.requirementsDue.length > 0) return "restringida";
  return "pendiente";
}

/** El interruptor «cobros en línea» solo puede encenderse con la cuenta verificada de ese modo. */
export function canEnableOnline(status: PaymentAccountStatus): boolean {
  return status === "verificada";
}

/** Un cobro en línea solo es posible con cuenta verificada, interruptor encendido y modo permitido en este entorno. */
export function onlinePaymentsAvailable(o: { status: PaymentAccountStatus | null; onlineEnabled: boolean }): boolean {
  return o.status === "verificada" && o.onlineEnabled;
}

/** Importe en céntimos desde un decimal del presupuesto (nunca del navegador), sin errores de coma flotante. */
export function eurosToCents(v: string | number): number {
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(String(v).trim());
  if (!m) return NaN;
  // Aritmética entera sobre el texto decimal: 1.005 → 101 (la coma flotante daría 100)
  const frac = (m[3] ?? "").padEnd(3, "0");
  const cents = Number(m[2]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return m[1] ? -cents : cents;
}
