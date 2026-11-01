/**
 * Elephant People (Personal): consultas de los primeros pasos y del horario semanal. Siempre sobre la BD de la empresa
 * en curso (`getDb()` resuelve la del tenant): nunca mezcla empresas.
 */
import { eq, sql } from "drizzle-orm";
import { employees, hrScheduleTemplates, siteSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { peopleOnboarding, type PeopleOnboarding, type ScheduleSlot } from "../shared/peopleOnboarding";

/** Marca de «configuración revisada» (se guarda al pulsar Guardar en Personal → Configuración). */
export const PEOPLE_SETTINGS_REVIEWED_KEY = "people_settings_reviewed_at";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}

export async function markPeopleSettingsReviewed(now = new Date()): Promise<void> {
  const d = await db();
  const value = now.toISOString();
  await d.insert(siteSettings).values({ key: PEOPLE_SETTINGS_REVIEWED_KEY, value, type: "text" }).onDuplicateKeyUpdate({ set: { value } });
}

export async function getPeopleOnboarding(): Promise<PeopleOnboarding> {
  const d = await db();
  const [reviewed] = await d.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, PEOPLE_SETTINGS_REVIEWED_KEY)).limit(1);
  const [emp] = await d
    .select({ total: sql<number>`COUNT(*)`, first: sql<number | null>`MIN(${employees.id})`, portal: sql<number>`SUM(${employees.userId} IS NOT NULL)` })
    .from(employees);
  const [sched] = await d.select({ n: sql<number>`COUNT(DISTINCT ${hrScheduleTemplates.employeeId})` }).from(hrScheduleTemplates);
  return peopleOnboarding({
    settingsReviewed: !!reviewed?.value,
    employees: Number(emp?.total ?? 0),
    firstEmployeeId: emp?.first != null ? Number(emp.first) : null,
    employeesWithSchedule: Number(sched?.n ?? 0),
    employeesWithPortal: Number(emp?.portal ?? 0),
  });
}

export async function employeeExists(employeeId: number): Promise<boolean> {
  const d = await db();
  const [row] = await d.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  return !!row;
}

/** Sustituye el horario semanal del empleado por los tramos dados (validados antes con `scheduleErrors`). */
export async function replaceEmployeeSchedule(employeeId: number, slots: readonly ScheduleSlot[]): Promise<void> {
  const d = await db();
  await d.transaction(async (tx) => {
    await tx.delete(hrScheduleTemplates).where(eq(hrScheduleTemplates.employeeId, employeeId));
    if (slots.length) {
      await tx.insert(hrScheduleTemplates).values(slots.map((s) => ({ employeeId, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })));
    }
  });
}
