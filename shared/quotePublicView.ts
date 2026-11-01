/**
 * Presentación del presupuesto en la página pública de aceptación (lógica pura: la usan la página y las pruebas).
 * Cada estado tiene un texto para el cliente y un significado (tono), no un color: el color sale del tema.
 */
export type QuoteTone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

const STATUS: Record<string, { label: string; tone: QuoteTone }> = {
  borrador: { label: "Borrador", tone: "neutral" },
  enviado: { label: "Pendiente", tone: "warning" },
  visualizado: { label: "Visto", tone: "info" },
  convertido_carrito: { label: "Pago iniciado", tone: "info" },
  pago_fallido: { label: "Pago no completado", tone: "warning" },
  aceptado: { label: "Aceptado y pagado", tone: "success" },
  rechazado: { label: "Rechazado", tone: "danger" },
  perdido: { label: "Expirado", tone: "danger" },
};

export function quoteStatusView(status: string, isExpired: boolean): { label: string; tone: QuoteTone } {
  if (isExpired) return { label: "Expirado", tone: "danger" };
  return STATUS[status] ?? { label: "Pendiente", tone: "neutral" };
}
