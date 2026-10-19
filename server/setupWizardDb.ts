/**
 * Persistencia del asistente «Primeros pasos» y del límite de usuarios del plan.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant): el progreso es un
 * ajuste más (`system_settings`), así que cada empresa tiene el suyo sin tablas nuevas ni
 * migraciones, y una empresa nunca puede leer ni escribir el de otra.
 */
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { systemSettings, users } from "../drizzle/schema";
import { getDb } from "./db";
import { invalidateConfigCache } from "./config";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getLimitAccess } from "./_core/limits/access";
import { SEAT_ROLES, licenceSummary, seatDecision, type LicenceSummary } from "./planSeats";
import { PROGRESS_SETTING_KEY, parseProgress, type SetupProgress } from "../shared/setupWizard";

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
  const used = await countSeatUsers();
  // Uso real para el plano de control (no deja bajar los usuarios contratados por debajo de lo usado)
  getLimitAccess()?.report("users", used);
  if (!summary.plan || summary.userLimit === null) return;
  const d = seatDecision(summary, used, adding);
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason });
}
