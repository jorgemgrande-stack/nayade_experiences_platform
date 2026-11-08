/**
 * Life Net · organización personal y familiar (capacidad `life-net`). Lógica pura compartida por el servidor, el
 * cliente y las pruebas: validaciones, nombre del hogar, estados de las tareas, seguimiento por miembro y hora local.
 *
 * Alcance aprobado (docs/life-net-alcance.md, sección 2, decisiones J5, J6 y J8 del 08/11/2026): organización personal,
 * gestión familiar, calendario y agenda, tareas y recordatorios, actividades compartidas, miembros del hogar y
 * seguimiento de actividades y compromisos. Nada más.
 */
import { validateTaxId } from "./formValidation";

export const LIFE_NET_CAPABILITY = "life-net";

/**
 * Métrica del cupo de miembros del hogar en el plan (`household_members`). Mientras el plan no la defina, se aplica
 * LIFE_HOUSEHOLD_MEMBERS_INCLUDED (decisión J5: un hogar incluye 5 miembros, contando al titular).
 */
export const HOUSEHOLD_MEMBERS_METRIC = "household_members";
export const LIFE_HOUSEHOLD_MEMBERS_INCLUDED = 5;

/** Zona horaria por defecto del hogar (recordatorios y «hoy»). */
export const LIFE_DEFAULT_TIME_ZONE = "Europe/Madrid";

/** Rutas del panel. */
export const LIFE_PATHS = {
  home: "/admin/net/life",
  agenda: "/admin/life/agenda",
  tasks: "/admin/life/tareas",
  tracking: "/admin/life/seguimiento",
  members: "/admin/life/miembros",
} as const;

/** Relación con el hogar (solo para mostrarla). */
export const LIFE_RELATIONSHIPS = ["titular", "pareja", "hijo", "hija", "padre", "madre", "abuelo", "abuela", "otro"] as const;
export type LifeRelationship = (typeof LIFE_RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<LifeRelationship, string> = {
  titular: "Titular",
  pareja: "Pareja",
  hijo: "Hijo",
  hija: "Hija",
  padre: "Padre",
  madre: "Madre",
  abuelo: "Abuelo",
  abuela: "Abuela",
  otro: "Otra persona",
};

/** Colores de los miembros en la agenda (claves; el cliente los traduce a clases). */
export const LIFE_COLORS = ["rojo", "azul", "verde", "ambar", "violeta", "rosa", "gris"] as const;
export type LifeColor = (typeof LIFE_COLORS)[number];

export const EVENT_KINDS = ["actividad", "compromiso"] as const;
export type LifeEventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABELS: Record<LifeEventKind, string> = { actividad: "Actividad", compromiso: "Compromiso" };

export type TaskState = "pending" | "overdue" | "done";
export const TASK_STATE_LABELS: Record<TaskState, string> = { pending: "Pendiente", overdue: "Vencida", done: "Hecha" };

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const isTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);

/** Hora de pared («AAAA-MM-DD HH:MM») en la zona indicada. */
export function wallClock(now: Date, timeZone: string = LIFE_DEFAULT_TIME_ZONE): { day: string; time: string; stamp: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  return { day, time, stamp: `${day} ${time}` };
}

/** Zona válida para Intl (si no, la del hogar por defecto). */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return LIFE_DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return LIFE_DEFAULT_TIME_ZONE;
  }
}

/** Suma días a una fecha AAAA-MM-DD. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Hogar y titular (J6) ─────────────────────────────────────────────────────

export interface HolderInput {
  firstName: string;
  lastName: string;
  taxId?: string | null;
}

/** Nombre del hogar por defecto: «Hogar de» y el nombre del titular. */
export function defaultHouseholdName(h: Pick<HolderInput, "firstName" | "lastName"> | null | undefined): string {
  const who = [h?.firstName?.trim(), h?.lastName?.trim()].filter(Boolean).join(" ");
  return who ? `Hogar de ${who}` : "Mi hogar";
}

/** Problema de los datos del hogar o null. El NIF es opcional; si se indica, debe ser válido. */
export function householdProblem(i: HolderInput & { householdName?: string | null }): string | null {
  if (!i.firstName.trim()) return "Indica el nombre del titular.";
  if (!i.lastName.trim()) return "Indica los apellidos del titular.";
  if (i.firstName.trim().length > 100 || i.lastName.trim().length > 160) return "El nombre o los apellidos son demasiado largos.";
  if (i.householdName != null && i.householdName.trim().length > 160) return "El nombre del hogar es demasiado largo.";
  if (i.taxId && i.taxId.trim()) {
    const p = validateTaxId(i.taxId);
    if (p) return "El NIF no es válido. Revisa los números y la letra (por ejemplo, 12345678Z).";
  }
  return null;
}

// ─── Miembros (J5) ────────────────────────────────────────────────────────────

/** El cupo vigente del hogar: el del plan si lo define (null = sin tope por contrato) o el incluido por defecto. */
export function memberLimitOf(planLimit: number | null | undefined): number | null {
  if (planLimit === undefined) return LIFE_HOUSEHOLD_MEMBERS_INCLUDED;
  return planLimit;
}

/** Mensaje si añadir `adding` miembros supera el cupo; null si cabe. */
export function memberLimitProblem(active: number, limit: number | null, adding = 1): string | null {
  if (limit === null) return null;
  if (active + adding <= limit) return null;
  return `Tu hogar ya tiene ${active} de ${limit} miembros incluidos. Archiva a un miembro que ya no uses para añadir a otro.`;
}

// ─── Tareas, agenda y recordatorios ───────────────────────────────────────────

export interface TaskLike {
  status: "pending" | "done";
  dueDate: string | null;
  dueTime: string | null;
}

/** Estado visible de una tarea con la hora local del hogar: hecha, vencida o pendiente. */
export function taskState(t: TaskLike, now: { day: string; time: string }): TaskState {
  if (t.status === "done") return "done";
  if (!t.dueDate) return "pending";
  if (t.dueDate < now.day) return "overdue";
  if (t.dueDate === now.day && t.dueTime && t.dueTime < now.time) return "overdue";
  return "pending";
}

/** Recordatorio «AAAA-MM-DD HH:MM» a partir de su fecha y hora (las dos o ninguna). */
export function reminderStamp(date: string | null | undefined, time: string | null | undefined): string | null | "invalid" {
  if (!date && !time) return null;
  if (!isDay(date) || !isTime(time)) return "invalid";
  return `${date} ${time}`;
}

/** Problema de una tarea o null. */
export function taskProblem(i: { title: string; dueDate?: string | null; dueTime?: string | null; remindDate?: string | null; remindTime?: string | null }): string | null {
  if (!i.title.trim()) return "Indica qué hay que hacer.";
  if (i.title.trim().length > 200) return "El título es demasiado largo (máximo 200 caracteres).";
  if (i.dueDate && !isDay(i.dueDate)) return "La fecha límite no es válida.";
  if (i.dueTime && !i.dueDate) return "Indica la fecha límite para poner una hora.";
  if (i.dueTime && !isTime(i.dueTime)) return "La hora límite no es válida.";
  if (reminderStamp(i.remindDate, i.remindTime) === "invalid") return "Para el recordatorio indica el día y la hora.";
  return null;
}

/** Problema de un evento de la agenda o null. */
export function eventProblem(i: { title: string; date: string; startTime?: string | null; endTime?: string | null; remindDate?: string | null; remindTime?: string | null; memberIds: number[] }): string | null {
  if (!i.title.trim()) return "Indica el nombre de la actividad.";
  if (i.title.trim().length > 200) return "El nombre es demasiado largo (máximo 200 caracteres).";
  if (!isDay(i.date)) return "La fecha no es válida.";
  if (i.startTime && !isTime(i.startTime)) return "La hora de inicio no es válida.";
  if (i.endTime && !isTime(i.endTime)) return "La hora de fin no es válida.";
  if (i.endTime && !i.startTime) return "Indica la hora de inicio para poner una hora de fin.";
  if (i.startTime && i.endTime && i.endTime <= i.startTime) return "La hora de fin debe ser posterior a la de inicio.";
  if (!i.memberIds.length) return "Elige al menos un miembro del hogar.";
  if (reminderStamp(i.remindDate, i.remindTime) === "invalid") return "Para el recordatorio indica el día y la hora.";
  return null;
}

/** Ventana de envío de un recordatorio: los vencidos hace más de este margen no se envían (tarea parada o fecha pasada). */
export const REMINDER_GRACE_HOURS = 24;
/** Intentos de envío de un mismo recordatorio. */
export const REMINDER_MAX_ATTEMPTS = 3;

/** El recordatorio toca ahora: ya ha llegado su hora y no hace más del margen. */
export function reminderDue(remindAt: string, now: Date, timeZone: string): boolean {
  const n = wallClock(now, timeZone).stamp;
  const floor = wallClock(new Date(now.getTime() - REMINDER_GRACE_HOURS * 3_600_000), timeZone).stamp;
  return remindAt <= n && remindAt >= floor;
}

// ─── Seguimiento por miembro (F7) ─────────────────────────────────────────────

export interface TrackingTask extends TaskLike {
  id: number;
  assigneeIds: number[];
}
export interface TrackingEvent {
  id: number;
  date: string;
  memberIds: number[];
}
export interface MemberTracking {
  memberId: number;
  pending: number;
  overdue: number;
  done: number;
  upcomingEvents: number;
  pastEvents: number;
}

/**
 * Seguimiento por miembro: tareas pendientes, vencidas y hechas de las que es responsable, y actividades próximas
 * (de hoy en adelante, 30 días) y recientes (últimos 30 días) en las que participa.
 */
export function memberTracking(memberIds: number[], tasks: TrackingTask[], events: TrackingEvent[], now: { day: string; time: string }): MemberTracking[] {
  const from = addDays(now.day, -30);
  const to = addDays(now.day, 30);
  return memberIds.map((memberId) => {
    const mine = tasks.filter((t) => t.assigneeIds.includes(memberId));
    const states = mine.map((t) => taskState(t, now));
    const ev = events.filter((e) => e.memberIds.includes(memberId));
    return {
      memberId,
      pending: states.filter((s) => s === "pending").length,
      overdue: states.filter((s) => s === "overdue").length,
      done: states.filter((s) => s === "done").length,
      upcomingEvents: ev.filter((e) => e.date >= now.day && e.date <= to).length,
      pastEvents: ev.filter((e) => e.date < now.day && e.date >= from).length,
    };
  });
}

// ─── Panel personal ──────────────────────────────────────────────────────────

/** Capacidades de empresa que, si están, hacen que el inicio sea el de Elephant Core y no el del hogar. */
const BUSINESS_HOME_CAPABILITIES = ["crm-contacts", "crm-leads", "shop-orders", "shop-catalog", "cms-editor", "bill-invoices", "bill-cash"];

/**
 * Inicio personal: el plan es `life` o la empresa solo tiene Life Net entre sus herramientas (sin CRM, tienda, web ni
 * facturación). Una empresa con Essential y Life Net sigue con su inicio de siempre.
 */
export function prefersLifeHome(o: { planKey?: string | null; capabilityState: (id: string) => "active" | "read_only" | null }): boolean {
  if (!o.capabilityState(LIFE_NET_CAPABILITY)) return false;
  if (o.planKey === "life") return true;
  return !BUSINESS_HOME_CAPABILITIES.some((c) => o.capabilityState(c) !== null);
}
