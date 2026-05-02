export function formatPaymentMethod(method: string | null | undefined): string {
  if (!method) return "—";
  const labels: Record<string, string> = {
    tarjeta_fisica:  "Tarjeta Física",
    tarjeta_redsys:  "Tarjeta Redsys",
    redsys:          "Tarjeta Redsys",   // backward compat
    tarjeta:         "Tarjeta",          // backward compat
    transferencia:   "Transferencia",
    efectivo:        "Efectivo",
    link_pago:       "Link de pago",
    otro:            "Otro",
  };
  return labels[method] ?? method;
}
