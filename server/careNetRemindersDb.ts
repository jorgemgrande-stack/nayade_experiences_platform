/**
 * Care Net · recordatorios de cita — acceso a datos (tablas de la migración db/migrations/0051_care_net_recordatorios,
 * fuera de `drizzle/schema.ts` a propósito, como los bonos de la 0037). SQL parametrizado (drizzle `sql`).
 *
 *  - Ajustes de la empresa (`care_reminder_settings`, una fila id = 1; sin fila = apagado).
 *  - Registro de envíos (`care_reminder_sends`): clave única (reserva, antelación). `claimSend` reserva el registro
 *    ANTES de enviar (INSERT IGNORE o reintento de un fallido / atascado), `settleSend` lo cierra y `skipSend` deja
 *    constancia de una omisión sin enviar nada. Dos réplicas a la vez nunca envían dos veces el mismo recordatorio.
 *  - Citas candidatas: reservas de SPA del Core (`reservations` con franja `spa_slots`) de los próximos días, con
 *    tratamiento y profesional o cabina (`spa_resources`), sin datos clínicos.
 *  - Aislamiento: BD de la empresa (getDb del tenant en curso).
 */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { ModuleNotInstalled } from "./sdk";
import { CARE_NET_CAPABILITY, spaBookingState, type SpaBookingState } from "../shared/careNet";
import { DEFAULT_REMINDER_SETTINGS, MANUAL_LEAD, normalizeLeads, type ReminderSettings, type ReminderStatus } from "../shared/careNetReminders";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

/** Minutos tras los que un registro «enviando» se considera atascado (caída a mitad de envío) y se puede reintentar. */
export const STALE_SENDING_MS = 15 * 60_000;

const num = (v: unknown) => Number(v ?? 0);

export function isMissingReminderSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    const msg = String(x.sqlMessage ?? x.message ?? "");
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /care_reminder_/.test(msg)) return true;
  }
  return false;
}

export class ReminderSchemaMissing extends Error {
  constructor(cause?: unknown) {
    super("Los recordatorios de Care Net aún no están instalados en esta empresa (migración 0051).");
    (this as { cause?: unknown }).cause = cause;
  }
}

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await fn(await database());
  } catch (e) {
    if (isMissingReminderSchema(e)) throw new ReminderSchemaMissing(e);
    throw e;
  }
}

/** Para los procedimientos del panel: sin la migración, error claro de módulo no instalado. */
export function asPanelError(e: unknown): unknown {
  if (e instanceof ReminderSchemaMissing) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: "Los recordatorios de Care Net aún no están instalados en esta empresa. Pide a soporte que los activen.", cause: new ModuleNotInstalled(CARE_NET_CAPABILITY) });
  }
  return e;
}

async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function affected(exec: Exec, q: SQL): Promise<number> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows?: number }];
  return r.affectedRows ?? 0;
}

// ─── Ajustes ─────────────────────────────────────────────────────────────────

export function getReminderSettings(): Promise<ReminderSettings> {
  return run(async (d) => {
    const [r] = await rows(d, sql`SELECT enabled, lead_hours, extra_text FROM care_reminder_settings WHERE id = 1`);
    if (!r) return { ...DEFAULT_REMINDER_SETTINGS };
    const leads = normalizeLeads(r.lead_hours);
    return { enabled: Number(r.enabled) === 1, leadHours: leads.length ? leads : [...DEFAULT_REMINDER_SETTINGS.leadHours], extraText: String(r.extra_text ?? "") };
  });
}

export function saveReminderSettings(s: ReminderSettings, userId: number | null): Promise<ReminderSettings> {
  return run(async (d) => {
    const leads = JSON.stringify(normalizeLeads(s.leadHours));
    const extra = s.extraText.trim() || null;
    const now = Date.now();
    await d.execute(sql`INSERT INTO care_reminder_settings (id, enabled, lead_hours, extra_text, updated_by, updated_at)
      VALUES (1, ${s.enabled ? 1 : 0}, ${leads}, ${extra}, ${userId}, ${now})
      ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), lead_hours = VALUES(lead_hours), extra_text = VALUES(extra_text), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
    return getReminderSettings();
  });
}

// ─── Citas ───────────────────────────────────────────────────────────────────

export interface ReminderAppointment {
  reservationId: number;
  reservationNumber: string | null;
  date: string;
  startTime: string;
  endTime: string;
  treatmentName: string | null;
  resourceType: "cabina" | "terapeuta" | null;
  resourceName: string | null;
  customerName: string;
  customerEmail: string | null;
  people: number;
  state: SpaBookingState;
}

const APPOINTMENT_SELECT = sql`SELECT r.id, r.reservation_number, r.people, r.customer_name, r.customer_email, r.status, r.status_reservation, r.hold_status,
    s.date, s.startTime, s.endTime, t.name AS treatment_name, sr.type AS resource_type, sr.name AS resource_name
  FROM reservations r JOIN spa_slots s ON s.id = r.inventory_ref_id LEFT JOIN spa_treatments t ON t.id = s.treatmentId
  LEFT JOIN spa_resources sr ON sr.id = s.resourceId`;

const toAppointment = (r: any): ReminderAppointment => ({
  reservationId: num(r.id), reservationNumber: r.reservation_number ?? null, date: String(r.date), startTime: String(r.startTime), endTime: String(r.endTime),
  treatmentName: r.treatment_name ?? null, resourceType: r.resource_type === "cabina" || r.resource_type === "terapeuta" ? r.resource_type : null, resourceName: r.resource_name ?? null,
  customerName: String(r.customer_name ?? ""), customerEmail: r.customer_email ?? null, people: num(r.people),
  state: spaBookingState({ status: String(r.status), holdStatus: r.hold_status ?? null, statusReservation: r.status_reservation ?? null }),
});

/** Citas de SPA entre dos días (AAAA-MM-DD) para el job; el estado y la hora se filtran en la lógica pura. */
export async function appointmentsBetween(from: string, to: string, limit: number): Promise<ReminderAppointment[]> {
  return run(async (d) => (await rows(d, sql`${APPOINTMENT_SELECT}
      WHERE r.inventory_kind = 'spa_slot' AND s.date BETWEEN ${from} AND ${to} AND (r.status = 'paid' OR r.hold_status = 'confirmada')
      ORDER BY s.date, s.startTime, r.id LIMIT ${limit}`)).map(toAppointment));
}

export async function appointmentById(reservationId: number): Promise<ReminderAppointment | null> {
  const d = await database();
  const [r] = await rows(d, sql`${APPOINTMENT_SELECT} WHERE r.id = ${reservationId} AND r.inventory_kind = 'spa_slot'`);
  return r ? toAppointment(r) : null;
}

// ─── Registro de envíos ──────────────────────────────────────────────────────

export interface SendRow {
  reservationId: number;
  leadHours: number;
  status: ReminderStatus;
  reason: string | null;
  attempts: number;
  at: number;
}

export async function sendsFor(reservationIds: readonly number[]): Promise<SendRow[]> {
  if (!reservationIds.length) return [];
  return run(async (d) => (await rows(d, sql`SELECT reservation_id, lead_hours, status, reason, attempts, sent_at, updated_at FROM care_reminder_sends
      WHERE reservation_id IN (${sql.join(reservationIds.map((i) => sql`${i}`), sql`, `)})`)).map((r: any) => ({
    reservationId: num(r.reservation_id), leadHours: num(r.lead_hours), status: String(r.status) as ReminderStatus, reason: r.reason ?? null,
    attempts: num(r.attempts), at: num(r.sent_at ?? r.updated_at),
  })));
}

/**
 * Reserva el envío (cita, antelación) antes de enviar. true si esta pasada lo envía: registro nuevo, fallido con
 * intentos libres o «enviando» atascado. El envío manual (antelación 0) se puede repetir si ya terminó.
 */
export async function claimSend(reservationId: number, leadHours: number, appointmentAt: number, maxAttempts: number, userId: number | null = null): Promise<boolean> {
  return run(async (d) => {
    const now = Date.now();
    const ins = await affected(d, sql`INSERT IGNORE INTO care_reminder_sends (reservation_id, lead_hours, appointment_at, status, attempts, sent_by, created_at, updated_at)
      VALUES (${reservationId}, ${leadHours}, ${appointmentAt}, 'sending', 1, ${userId}, ${now}, ${now})`);
    if (ins === 1) return true;
    const stale = now - STALE_SENDING_MS;
    const retry = leadHours === MANUAL_LEAD
      ? sql`(status <> 'sending' OR updated_at < ${stale})`
      : sql`attempts < ${maxAttempts} AND (status = 'failed' OR (status = 'sending' AND updated_at < ${stale}))`;
    const upd = await affected(d, sql`UPDATE care_reminder_sends SET status = 'sending', reason = NULL, attempts = LEAST(attempts + 1, 255), appointment_at = ${appointmentAt},
        sent_by = ${userId}, updated_at = ${now}
      WHERE reservation_id = ${reservationId} AND lead_hours = ${leadHours} AND ${retry}`);
    return upd === 1;
  });
}

export async function settleSend(reservationId: number, leadHours: number, status: Exclude<ReminderStatus, "sending">, reason: string | null): Promise<void> {
  await run(async (d) => {
    const now = Date.now();
    await d.execute(sql`UPDATE care_reminder_sends SET status = ${status}, reason = ${reason}, sent_at = ${status === "sent" ? now : null}, updated_at = ${now}
      WHERE reservation_id = ${reservationId} AND lead_hours = ${leadHours} AND status = 'sending'`);
  });
}

/** Deja constancia de un recordatorio omitido (sin enviar nada); si ya hay registro, no lo toca. */
export async function skipSend(reservationId: number, leadHours: number, appointmentAt: number, reason: string): Promise<void> {
  await run(async (d) => {
    const now = Date.now();
    await d.execute(sql`INSERT IGNORE INTO care_reminder_sends (reservation_id, lead_hours, appointment_at, status, reason, attempts, created_at, updated_at)
      VALUES (${reservationId}, ${leadHours}, ${appointmentAt}, 'skipped', ${reason}, 0, ${now}, ${now})`);
  });
}

/** Estado de los recordatorios de las citas de SPA entre dos días (para el listado del panel). */
export async function sendsBetween(from: string, to: string): Promise<SendRow[]> {
  return run(async (d) => (await rows(d, sql`SELECT k.reservation_id, k.lead_hours, k.status, k.reason, k.attempts, k.sent_at, k.updated_at
      FROM care_reminder_sends k JOIN reservations r ON r.id = k.reservation_id JOIN spa_slots s ON s.id = r.inventory_ref_id
      WHERE r.inventory_kind = 'spa_slot' AND s.date BETWEEN ${from} AND ${to} ORDER BY k.updated_at DESC LIMIT 2000`)).map((r: any) => ({
    reservationId: num(r.reservation_id), leadHours: num(r.lead_hours), status: String(r.status) as ReminderStatus, reason: r.reason ?? null,
    attempts: num(r.attempts), at: num(r.sent_at ?? r.updated_at),
  })));
}
