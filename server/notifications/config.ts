/**
 * Despacho de comunicaciones transaccionales desde el entorno: SOLO con `CP_NOTIFICATIONS_SINCE` (fecha ISO o
 * milisegundos). Nada anterior a esa fecha se notifica. Sin ella no se despacha nada (solo se publica el catálogo).
 * No hay tarea periódica: el despacho lo lanza un operador o un cron externo (POST /cp/v1/notifications/dispatch).
 * Un valor no válido impide arrancar (mejor que despachar desde una fecha equivocada).
 */
export function notificationsFromEnv(env: NodeJS.ProcessEnv): { since: number } | undefined {
  const raw = (env.CP_NOTIFICATIONS_SINCE ?? "").trim();
  if (!raw) return undefined;
  const since = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(since) || since <= 0) throw new Error("CP_NOTIFICATIONS_SINCE no es una fecha válida (ISO o milisegundos)");
  return { since };
}
