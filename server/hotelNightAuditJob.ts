/**
 * Hotel Net · cierre automático del día: cada madrugada guarda los indicadores (ocupación, ingresos, ADR, RevPAR) del
 * día anterior de cada empresa con Hotel Net. Es una tarea por empresa (`per-tenant`, ver jobPolicy.ts) desactivada por
 * defecto: su bandera es `hotel_night_audit_job_enabled`. Una empresa sin la capacidad, con el módulo de hotel apagado o
 * sin la migración 0034 se omite sin error. El cierre manual («Cerrar día» en Informes) hace exactamente lo mismo.
 */
import { scheduleTenantCron } from "./_core/tenantRegistry/scheduler";
import { getFeatureFlag } from "./config";
import { addDaysIso, todayInTimeZone } from "./hotelPms";
import { isMissingPmsSchema } from "./hotelPmsDb";

export const HOTEL_NIGHT_AUDIT_JOB = "hotel-night-audit";
export const HOTEL_NIGHT_AUDIT_FLAG = "hotel_night_audit_job_enabled";

/** Día que cierra la pasada de `now`: el anterior al de hoy en la zona horaria del hotel. */
export function nightAuditBusinessDate(now: Date = new Date()): string {
  return addDaysIso(todayInTimeZone(now), -1);
}

export async function runHotelNightAuditJob(now: Date = new Date()): Promise<{ businessDate: string; skipped?: string }> {
  const businessDate = nightAuditBusinessDate(now);
  if (!(await getFeatureFlag("hotel_module_enabled", false))) return { businessDate, skipped: "hotel_off" };
  try {
    const { getCapabilityAccess } = await import("./_core/capabilities/access");
    if (!(await getCapabilityAccess().check("hotel-net", { write: true })).allowed) return { businessDate, skipped: "sin_licencia" };
  } catch {
    return { businessDate, skipped: "licencia_no_verificable" };
  }
  try {
    const { runNightAudit } = await import("./hotelFolioDb");
    await runNightAudit(businessDate, { userId: null, source: "automatico" });
    return { businessDate };
  } catch (e) {
    const cause = (e as { cause?: unknown }).cause ?? e;
    if (isMissingPmsSchema(cause)) return { businessDate, skipped: "sin_migracion" };
    throw e;
  }
}

export function startHotelNightAuditJob(): void {
  console.log("[Jobs] Iniciando cron hotel_night_audit_job (30 4 * * *)");
  scheduleTenantCron("30 4 * * *", HOTEL_NIGHT_AUDIT_JOB, async () => {
    try {
      const r = await runHotelNightAuditJob();
      if (r.skipped) console.log(`[HotelNightAudit] ${r.businessDate}: omitido (${r.skipped})`);
      else console.log(`[HotelNightAudit] Día ${r.businessDate} cerrado`);
    } catch (err) {
      console.error("[HotelNightAudit] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}
