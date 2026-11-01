/** Porcentaje con formato de España: coma decimal, un decimal y espacio fijo antes de «%» («76,9 %»). */
export function formatPercentEs(value: number, decimals = 1): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}\u00a0%`;
}
