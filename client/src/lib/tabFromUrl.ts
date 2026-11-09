/**
 * Pestaña inicial de una pantalla a partir de `?tab=` (enlaces directos como los del resumen del Paquete Marketing).
 * Solo se acepta una de las pestañas de la pantalla; si no, la de por defecto.
 */
export function tabFromUrl<T extends string>(allowed: readonly T[], fallback: T, search: string = typeof window === "undefined" ? "" : window.location.search): T {
  const t = new URLSearchParams(search).get("tab");
  return t && (allowed as readonly string[]).includes(t) ? (t as T) : fallback;
}
