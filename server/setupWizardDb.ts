/**
 * Persistencia del asistente «Primeros pasos» y del límite de usuarios del plan.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant): el progreso es un
 * ajuste más (`system_settings`), así que cada empresa tiene el suyo sin tablas nuevas ni
 * migraciones, y una empresa nunca puede leer ni escribir el de otra.
 */
import { TRPCError } from "@trpc/server";
import { and, count, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { clients, experiences, invoices, pageBlocks, quotes, reservations, staticPages, systemSettings, tpvSales, users } from "../drizzle/schema";
import { getDb } from "./db";
import { invalidateConfigCache } from "./config";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getLimitAccess } from "./_core/limits/access";
import { getQuotaExceptionAccess } from "./_core/erm/exceptionAccess";
import { SEAT_ROLES, licenceSummary, seatDecision, type LicenceSummary } from "./planSeats";
import { decide } from "./_core/capabilities/model";
import { PROGRESS_SETTING_KEY, STEP_CAPABILITIES, parseProgress, type SetupProgress } from "../shared/setupWizard";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

export async function readSettings(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const db = await requireDb();
  const rows = await db.select({ key: systemSettings.key, value: systemSettings.value }).from(systemSettings).where(inArray(systemSettings.key, keys));
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value ?? "";
  return out;
}

/** Última vez que cambió alguno de esos ajustes con valor (null si no hay ninguno guardado). */
export async function settingsUpdatedAt(keys: string[]): Promise<Date | null> {
  if (!keys.length) return null;
  const db = await requireDb();
  const [row] = await db
    .select({ ms: sql<number | string | null>`UNIX_TIMESTAMP(MAX(${systemSettings.updatedAt})) * 1000` })
    .from(systemSettings)
    .where(and(inArray(systemSettings.key, keys), sql`TRIM(COALESCE(${systemSettings.value}, '')) <> ''`));
  const ms = Number(row?.ms);
  return row?.ms != null && Number.isFinite(ms) ? new Date(ms) : null;
}

/** Crea o actualiza ajustes (los que falten se crean con su etiqueta y categoría). */
export async function upsertSettings(entries: Array<{ key: string; value: string; label: string; category: string; valueType?: "string" | "json" }>): Promise<void> {
  if (!entries.length) return;
  const db = await requireDb();
  for (const e of entries) {
    await db
      .insert(systemSettings)
      .values({ key: e.key, value: e.value, label: e.label, category: e.category, valueType: e.valueType ?? "string" })
      .onDuplicateKeyUpdate({ set: { value: e.value } });
  }
  invalidateConfigCache();
}

export async function readProgress(): Promise<SetupProgress> {
  const s = await readSettings([PROGRESS_SETTING_KEY]);
  return parseProgress(s[PROGRESS_SETTING_KEY]);
}

/**
 * Cambia el progreso dentro de una transacción con la fila bloqueada: dos pestañas o dos
 * administradores a la vez no se pisan los pasos.
 */
export async function updateProgress(change: (p: SetupProgress) => SetupProgress): Promise<SetupProgress> {
  const db = await requireDb();
  await db
    .insert(systemSettings)
    .values({ key: PROGRESS_SETTING_KEY, value: null, label: "Progreso de Primeros pasos", category: "onboarding", valueType: "json" })
    .onDuplicateKeyUpdate({ set: { key: sql`${systemSettings.key}` } });
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, PROGRESS_SETTING_KEY)).for("update");
    const next = change(parseProgress(row?.value));
    await tx.update(systemSettings).set({ value: JSON.stringify(next) }).where(eq(systemSettings.key, PROGRESS_SETTING_KEY));
    return next;
  });
}

// ── Datos reales y contratación (plan del asistente) ──────────────────────────

/**
 * Cuántos datos reales tiene la empresa en curso (su propia BD): completan los pasos «de hacer» del asistente
 * y alimentan el estado de configuración del Inicio. La web cuenta como revisada si alguna página se ha editado
 * después de crearse o tiene bloques propios (las páginas de la plantilla inicial no cuentan).
 *
 * Primera venta: un pedido cobrado, un pedido registrado pendiente de cobro (no un pago online que se quedó a medias)
 * o una venta en caja cobrada. Primer presupuesto o factura: cualquier presupuesto (también un borrador) o factura.
 */
export async function readSetupCounts(): Promise<{ clients: number; products: number; sales: number; documents: number; webEdited: boolean }> {
  const db = await requireDb();
  const n = async (q: Promise<Array<{ n: number | string }>>) => Number((await q)[0]?.n ?? 0);
  const orderPlaced = or(
    eq(reservations.status, "paid"),
    and(eq(reservations.status, "pending_payment"), or(isNull(reservations.channel), notInArray(reservations.channel, ["ONLINE_DIRECTO", "ONLINE_ASISTIDO"]))),
  );
  const [cl, pr, qu, re, inv, tpv, blocks, edited] = await Promise.all([
    n(db.select({ n: count() }).from(clients)),
    n(db.select({ n: count() }).from(experiences)),
    n(db.select({ n: count() }).from(quotes)),
    n(db.select({ n: count() }).from(reservations).where(orderPlaced)),
    n(db.select({ n: count() }).from(invoices)),
    n(db.select({ n: count() }).from(tpvSales).where(eq(tpvSales.status, "paid"))),
    n(db.select({ n: count() }).from(pageBlocks)),
    n(db.select({ n: count() }).from(staticPages).where(gt(staticPages.updatedAt, staticPages.createdAt))),
  ]);
  return { clients: cl, products: pr, sales: re + tpv, documents: qu + inv, webEdited: blocks + edited > 0 };
}

/**
 * Capacidades contratadas (activas o en solo lectura) que deciden qué pasos se ven. `null` sin licencias por
 * capacidad (instalación de una sola empresa): se ve todo salvo lo sectorial. Si no pueden leerse, también null.
 */
export async function contractedSetupCapabilities(): Promise<Set<string> | null> {
  const access = getCapabilityAccess();
  let grants: Awaited<ReturnType<typeof access.grants>>;
  try {
    grants = await access.grants();
  } catch {
    return null;
  }
  if (!grants) return null;
  const now = access.currentTime();
  const ids = new Set(Object.values(STEP_CAPABILITIES).flat() as string[]);
  return new Set(Array.from(ids).filter((id) => decide(grants!, id, { write: false, now }).allowed));
}

// ── Recordatorios de «Primeros pasos» (server/onboardingReminders.ts) ──────────

/** Ajuste con el primer acceso al asistente y los recordatorios ya enviados (JSON). */
export const ONBOARDING_REMINDERS_KEY = "onboarding_reminders";

export interface OnboardingReminderState {
  /** Primer acceso al asistente sin ningún paso dado (ms). */
  firstAccessAt: number;
  /** Quien lo abrió (destinatario de los recordatorios). */
  userId: number | null;
  /** Hito (días) → cuándo se envió o se dio por cubierto. */
  sent: Record<string, number>;
}

export function parseReminderState(raw: string | null | undefined): OnboardingReminderState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OnboardingReminderState>;
    if (typeof v.firstAccessAt !== "number") return null;
    const sent: Record<string, number> = {};
    for (const [k, t] of Object.entries(v.sent ?? {})) if (typeof t === "number") sent[k] = t;
    return { firstAccessAt: v.firstAccessAt, userId: typeof v.userId === "number" ? v.userId : null, sent };
  } catch {
    return null;
  }
}

/** Registra el primer acceso UNA vez (si ya existe, no cambia nada). */
export async function recordOnboardingFirstAccess(userId: number | null, now: number): Promise<void> {
  const db = await requireDb();
  const value = JSON.stringify({ firstAccessAt: now, userId, sent: {} } satisfies OnboardingReminderState);
  await db
    .insert(systemSettings)
    .values({ key: ONBOARDING_REMINDERS_KEY, value, label: "Recordatorios de Primeros pasos", category: "onboarding", valueType: "json" })
    .onDuplicateKeyUpdate({ set: { key: sql`${systemSettings.key}` } });
}

export async function readOnboardingReminderState(): Promise<OnboardingReminderState | null> {
  const s = await readSettings([ONBOARDING_REMINDERS_KEY]);
  return parseReminderState(s[ONBOARDING_REMINDERS_KEY]);
}

/**
 * Reserva el hito con la fila bloqueada: true solo si nadie lo había enviado (idempotencia por empresa e hito). Los
 * hitos anteriores sin enviar quedan cubiertos por este (nunca se envían después: máximo un aviso por hito).
 */
export async function claimOnboardingReminder(days: number, earlier: number[], now: number): Promise<boolean> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, ONBOARDING_REMINDERS_KEY)).for("update");
    const st = parseReminderState(row?.value);
    if (!st || st.sent[String(days)] !== undefined) return false;
    st.sent[String(days)] = now;
    for (const d of earlier) if (st.sent[String(d)] === undefined) st.sent[String(d)] = now;
    await tx.update(systemSettings).set({ value: JSON.stringify(st) }).where(eq(systemSettings.key, ONBOARDING_REMINDERS_KEY));
    return true;
  });
}

/** Deshace la reserva de un hito cuyo correo no salió (se reintenta en la siguiente pasada). */
export async function releaseOnboardingReminder(days: number, earlier: number[], claimedAt: number): Promise<void> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, ONBOARDING_REMINDERS_KEY)).for("update");
    const st = parseReminderState(row?.value);
    if (!st) return;
    for (const d of [days, ...earlier]) if (st.sent[String(d)] === claimedAt) delete st.sent[String(d)];
    await tx.update(systemSettings).set({ value: JSON.stringify(st) }).where(eq(systemSettings.key, ONBOARDING_REMINDERS_KEY));
  });
}

/** Correo y nombre de un usuario activo (destinatario de los recordatorios), o null. */
export async function activeUserContact(userId: number): Promise<{ email: string; name: string | null } | null> {
  const db = await requireDb();
  const [u] = await db.select({ email: users.email, name: users.name, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  return u && u.isActive && u.email ? { email: u.email, name: u.name ?? null } : null;
}

/** Usuarios que ocupan plaza: activos y con rol de panel. */
export async function countSeatUsers(): Promise<number> {
  const db = await requireDb();
  const [r] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, [...SEAT_ROLES])));
  return Number(r?.n ?? 0);
}

/**
 * Plan, prueba y límite de usuarios de la empresa en curso según sus licencias. Si el plano de control ha
 * fijado un límite contratado (plan + usuarios adicionales, registro 0013), manda ese; si no, lo del plan.
 */
export async function currentLicence(): Promise<LicenceSummary> {
  const access = getCapabilityAccess();
  const summary = licenceSummary(await access.grants(), access.currentTime());
  if (!summary.plan) return summary;
  // Excepción comercial vigente (registro 0016): manda sobre lo contratado hasta que caduca o se revoca
  const exception = await getQuotaExceptionAccess()?.active("users");
  if (exception) return { ...summary, userLimit: exception.newLimit };
  const contracted = await getLimitAccess()?.limit("users");
  return contracted === undefined ? summary : { ...summary, userLimit: contracted };
}

/**
 * Comprueba en el servidor que cabe `adding` usuarios más en el plan. Si las licencias no pueden
 * leerse, falla cerrado (no se crean usuarios a ciegas).
 */
export async function assertSeatAvailable(adding = 1): Promise<void> {
  let summary: LicenceSummary;
  try {
    summary = await currentLicence();
  } catch {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "No se pudo comprobar el límite de usuarios de tu plan; inténtalo en unos minutos" });
  }
  if (!summary.plan || summary.userLimit === null) return;
  const used = await countSeatUsers();
  // Uso real para el plano de control (no deja bajar los usuarios contratados por debajo de lo usado)
  getLimitAccess()?.report("users", used);
  const d = seatDecision(summary, used, adding);
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason });
}
