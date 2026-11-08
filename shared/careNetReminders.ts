/**
 * Care Net · recordatorios de cita — lógica pura compartida por el servidor (server/careNetReminders.ts,
 * server/careNetRemindersDb.ts) y el panel (client/src/pages/admin/careNet/). Sin base de datos ni React.
 *
 * Reglas:
 *  - Solo se recuerdan las citas CONFIRMADAS (pagadas o con la plaza confirmada) que aún no han empezado.
 *  - Un recordatorio por cita y antelación (24 h, 2 h…). La hora de la cita es la de la franja del SPA, en
 *    Europe/Madrid (con su cambio de hora); la antelación se cuenta en horas reales.
 *  - Si se abren a la vez varias antelaciones (p. ej. una cita reservada con 1 h de margen con 24 h y 2 h activas),
 *    solo se envía la más corta y las demás se omiten («superado por otra antelación»): nunca dos correos seguidos.
 *  - Antelación 0 = envío manual desde el panel («Enviar recordatorio ahora»).
 */

export const CARE_REMINDER_TZ = "Europe/Madrid";
export const HOUR_MS = 3_600_000;
/** Antelaciones que se pueden elegir (horas). */
export const REMINDER_LEAD_OPTIONS = [2, 24, 48] as const;
export const MANUAL_LEAD = 0;
/** Intentos de envío automáticos de un mismo recordatorio antes de darlo por fallido. */
export const REMINDER_MAX_ATTEMPTS = 3;
export const REMINDER_EXTRA_TEXT_MAX = 500;
/** Un registro «enviando» sin cerrar tras este tiempo (caída a mitad de envío) se puede volver a reservar. */
export const STALE_SENDING_MS = 15 * 60_000;

export interface ReminderSettings {
  enabled: boolean;
  leadHours: number[];
  extraText: string;
}
/** Por defecto, apagado (la empresa lo activa en Care Net). */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: false, leadHours: [24], extraText: "" };

/** Antelaciones válidas, sin repetir y de mayor a menor. */
export function normalizeLeads(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" && v ? (() => { try { return JSON.parse(v); } catch { return []; } })() : [];
  const ok = new Set<number>();
  for (const x of Array.isArray(arr) ? arr : []) {
    const n = Number(x);
    if ((REMINDER_LEAD_OPTIONS as readonly number[]).includes(n)) ok.add(n);
  }
  return Array.from(ok).sort((a, b) => b - a);
}

export function settingsProblem(s: ReminderSettings): string | null {
  if (s.enabled && normalizeLeads(s.leadHours).length === 0) return "Elige al menos una antelación para los recordatorios.";
  if (s.extraText.length > REMINDER_EXTRA_TEXT_MAX) return `El texto adicional no puede superar ${REMINDER_EXTRA_TEXT_MAX} caracteres.`;
  return null;
}

/** Diferencia (ms) entre la hora de pared de `tz` y UTC en ese instante. */
export function tzOffsetMs(utcMs: number, tz = CARE_REMINDER_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Instante UTC (ms) de una hora de pared («2026-11-09», «10:30») en `tz`. Con el cambio de hora: una hora que no
 * existe (adelanto de marzo) se lleva a la siguiente válida; una que se repite (retraso de octubre) toma la segunda.
 * Devuelve null si la fecha u hora no son válidas.
 */
export function wallToUtc(date: string, time: string, tz = CARE_REMINDER_TZ): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, hh, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || hh > 23 || mi > 59) return null;
  const base = Date.UTC(y, mo - 1, da, hh, mi);
  // Día inexistente (31 de abril…): Date.UTC lo pasaría al mes siguiente
  if (!Number.isFinite(base) || new Date(base).getUTCDate() !== da) return null;
  const off1 = tzOffsetMs(base, tz);
  const t1 = base - off1;
  const off2 = tzOffsetMs(t1, tz);
  return off1 === off2 ? t1 : base - off2;
}

/** Día AAAA-MM-DD de un instante en `tz`. */
export const dayIn = (utcMs: number, tz = CARE_REMINDER_TZ): string => new Date(utcMs).toLocaleDateString("en-CA", { timeZone: tz });

export type ReminderStatus = "sending" | "sent" | "failed" | "skipped";
export interface SendRecord {
  leadHours: number;
  status: ReminderStatus;
  attempts: number;
  /** Última actualización del registro (ms); con «enviando», para detectar un envío atascado. */
  at?: number;
}

export interface ReminderPlan {
  /** Antelación que toca enviar ahora (null = ninguna). */
  send: number | null;
  /** Antelaciones abiertas que se omiten porque otra más corta ya toca. */
  supersede: number[];
}

/**
 * Qué recordatorio toca para una cita a `appointmentAt` en el instante `now`. Puro.
 *  - Una antelación L está abierta si now ≥ cita − L h y la cita no ha empezado.
 *  - Se envía la abierta más corta si no tiene registro, si falló o si quedó «enviando» atascado (más de
 *    STALE_SENDING_MS sin cerrarse, p. ej. por una caída), siempre con intentos libres; las abiertas más largas sin
 *    registro se omiten. Una antelación ya enviada u omitida nunca se repite.
 */
export function planReminder(appointmentAt: number, now: number, leads: readonly number[], done: readonly SendRecord[], maxAttempts = REMINDER_MAX_ATTEMPTS): ReminderPlan {
  const none: ReminderPlan = { send: null, supersede: [] };
  if (!(now < appointmentAt)) return none;
  const open = normalizeLeads(leads).filter((l) => now >= appointmentAt - l * HOUR_MS).sort((a, b) => a - b);
  if (!open.length) return none;
  const rec = (l: number) => done.find((r) => r.leadHours === l);
  const shortest = open[0];
  const r = rec(shortest);
  const stuck = r != null && r.status === "sending" && r.at != null && now - r.at > STALE_SENDING_MS;
  const retryable = r != null && (r.status === "failed" || stuck) && r.attempts < maxAttempts;
  const send = r == null || retryable ? shortest : null;
  // Una antelación más corta ya resuelta (enviada u omitida) también cierra las largas que queden sin registro
  const supersede = open.slice(1).filter((l) => rec(l) == null);
  return { send, supersede };
}

export interface AppointmentLike {
  state: string;
  date: string;
  startTime: string;
}

/** ¿Se le puede recordar la cita? (confirmada y aún no empezada). Motivo si no; null si sí. */
export function appointmentProblem(a: AppointmentLike, now: number, tz = CARE_REMINDER_TZ): string | null {
  if (a.state !== "confirmada") return "Solo se recuerdan las citas confirmadas.";
  const at = wallToUtc(a.date, a.startTime, tz);
  if (at == null) return "La cita no tiene una fecha u hora válida.";
  if (at <= now) return "La cita ya ha empezado o ha pasado.";
  return null;
}

export const REMINDER_REASON_LABELS: Record<string, string> = {
  sin_correo: "El cliente no tiene un correo válido",
  superado: "Superado por otra antelación",
  prueba_gratuita: "No enviado: la prueba gratuita solo envía a los buzones de la empresa",
  envio_fallido: "El envío ha fallado",
  enviando: "Enviando",
};

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  sending: "Enviando",
  sent: "Enviado",
  failed: "Fallido",
  skipped: "Omitido",
};

export const leadLabel = (l: number): string => (l === MANUAL_LEAD ? "manual" : `${l} h antes`);

/** Resumen de una cita para el panel: el último envío relevante (enviado gana a fallido u omitido). */
export function reminderSummary(rows: ReadonlyArray<{ leadHours: number; status: ReminderStatus; reason: string | null; at: number }>): { status: ReminderStatus; label: string; at: number } | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const best = sorted.find((r) => r.status === "sent") ?? sorted.find((r) => r.status !== "skipped" || r.reason !== "superado") ?? sorted[0];
  const why = best.status === "sent" ? leadLabel(best.leadHours) : best.reason ? REMINDER_REASON_LABELS[best.reason] ?? best.reason : leadLabel(best.leadHours);
  return { status: best.status, label: `${REMINDER_STATUS_LABELS[best.status]} · ${why}`, at: best.at };
}
