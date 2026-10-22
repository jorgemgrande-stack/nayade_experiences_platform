/**
 * Política del motor de transiciones temporales. Los valores por defecto son las PROPUESTAS
 * provisionales D-15/D-16/D-17 (diseño y pruebas), no políticas definitivas: cada una se puede cambiar
 * por entorno sin tocar el código y ninguna borra datos.
 *
 *   CP_LIFECYCLE_SCHEDULER_ENABLED  «1» monta la tarea periódica (APAGADA por defecto).
 *   CP_LIFECYCLE_MODE               «plan» (por defecto): solo calcula y registra lo que haría.
 *                                   «apply»: aplica las transiciones por los caminos existentes.
 *   CP_LIFECYCLE_LIVE_APPLY         «1» exigido además para «apply» con CP_STRIPE_MODE=live; sin él, «plan».
 *   CP_LIFECYCLE_INTERVAL_MS        1 min – 24 h (15 min por defecto).
 *   CP_LIFECYCLE_DUNNING_DAYS       Días tras el impago con aviso (D-15 propuesto: 0,3,6). Solo se planifican.
 *   CP_LIFECYCLE_TRIAL_NOTICE_DAYS  Días antes del fin de la prueba con aviso (D-16 propuesto: 7,3,1). Solo se planifican.
 *   CP_LIFECYCLE_RETENTION_DAYS     Días tras el fin (prueba vencida o suscripción terminada) para revisar la
 *                                   conservación (D-17 propuesto: 30). Solo se señala; nunca se borra.
 *   CP_LIFECYCLE_ARCHIVE_NOTICE_DAYS Días tras el fin con aviso previo al archivado (propuesta adoptada
 *                                   provisionalmente: 60,83,89 con archivado a los 90). Vacío por defecto: sin
 *                                   avisos. Solo cuentan los anteriores a CP_LIFECYCLE_RETENTION_DAYS. Nunca archiva.
 *
 * La gracia tras el impago (D-15: 7 días) es la del orquestador (`GRACE_DAYS`), la misma que ya aplica.
 */

export type LifecycleMode = "plan" | "apply";

export interface LifecyclePolicy {
  enabled: boolean;
  mode: LifecycleMode;
  /** Por qué el modo efectivo es «plan» aunque se pidiera «apply». */
  modeReason: string | null;
  intervalMs: number;
  dunningDays: number[];
  trialNoticeDays: number[];
  retentionDays: number;
  /** Días tras el fin con aviso de archivado (antes de `retentionDays`). Vacío: sin avisos. */
  archiveNoticeDays: number[];
}

const DAY = 86_400_000;
export const DEFAULT_INTERVAL = 15 * 60_000;
const MIN_INTERVAL = 60_000;

/** Lista de días: enteros 0–60, sin repetir, ordenada. Un valor no válido deja la propuesta por defecto. */
function days(raw: string | undefined, fallback: number[]): number[] {
  if (raw === undefined || raw.trim() === "") return fallback;
  const out = raw.split(",").map((x) => Number(x.trim()));
  if (!out.length || out.some((n) => !Number.isInteger(n) || n < 0 || n > 60)) return fallback;
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** Avisos de archivado: enteros 1–3650, anteriores al plazo de conservación, sin repetir y ordenados. Mal formado: ninguno. */
function archiveDays(raw: string | undefined, retentionDays: number): number[] {
  if (raw === undefined || raw.trim() === "") return [];
  const out = raw.split(",").map((x) => Number(x.trim()));
  if (out.some((n) => !Number.isInteger(n) || n < 1 || n > 3650)) return [];
  return Array.from(new Set(out)).filter((n) => n < retentionDays).sort((a, b) => a - b);
}

export function lifecyclePolicyFromEnv(env: NodeJS.ProcessEnv): LifecyclePolicy {
  const wanted: LifecycleMode = env.CP_LIFECYCLE_MODE === "apply" ? "apply" : "plan";
  const live = (env.CP_STRIPE_MODE ?? "").trim().toLowerCase() === "live";
  const blocked = wanted === "apply" && live && env.CP_LIFECYCLE_LIVE_APPLY !== "1";
  const rawInterval = Number(env.CP_LIFECYCLE_INTERVAL_MS ?? DEFAULT_INTERVAL);
  const retention = Number(env.CP_LIFECYCLE_RETENTION_DAYS ?? 30);
  const retentionDays = Number.isInteger(retention) && retention >= 1 && retention <= 3650 ? retention : 30;
  return {
    enabled: env.CP_LIFECYCLE_SCHEDULER_ENABLED === "1",
    mode: blocked ? "plan" : wanted,
    modeReason: blocked ? "live_apply_not_authorized" : null,
    intervalMs: Number.isFinite(rawInterval) ? Math.min(DAY, Math.max(MIN_INTERVAL, Math.round(rawInterval))) : DEFAULT_INTERVAL,
    dunningDays: days(env.CP_LIFECYCLE_DUNNING_DAYS, [0, 3, 6]),
    trialNoticeDays: days(env.CP_LIFECYCLE_TRIAL_NOTICE_DAYS, [7, 3, 1]),
    retentionDays,
    archiveNoticeDays: archiveDays(env.CP_LIFECYCLE_ARCHIVE_NOTICE_DAYS, retentionDays),
  };
}
