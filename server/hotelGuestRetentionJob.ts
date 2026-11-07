/**
 * Hotel Net · conservación de las fichas de huésped: cada día anonimiza las fichas cuya última estancia terminó antes
 * del plazo configurado por la empresa. Tarea por empresa (`per-tenant`, ver jobPolicy.ts) DESACTIVADA por defecto
 * (bandera `hotel_guest_retention_job_enabled`); y aunque se active, sin plazo configurado (el valor por defecto) no
 * toca nada. Una empresa sin Hotel Net, con el módulo de hotel apagado o sin la migración 0043 se omite sin error.
 */
import { scheduleTenantCron } from "./_core/tenantRegistry/scheduler";
import { getFeatureFlag } from "./config";
import { todayInTimeZone } from "./hotelPms";
import { isMissingPmsSchema } from "./hotelPmsDb";

export const HOTEL_GUEST_RETENTION_JOB = "hotel-guest-retention";

export async function runHotelGuestRetentionJob(now: Date = new Date()): Promise<{ anonymized: number; skipped?: string }> {
  if (!(await getFeatureFlag("hotel_module_enabled", false))) return { anonymized: 0, skipped: "hotel_off" };
  try {
    const { getCapabilityAccess } = await import("./_core/capabilities/access");
    if (!(await getCapabilityAccess().check("hotel-net", { write: true })).allowed) return { anonymized: 0, skipped: "sin_licencia" };
  } catch {
    return { anonymized: 0, skipped: "licencia_no_verificable" };
  }
  try {
    const { anonymizeExpiredGuests } = await import("./hotelGuestsDb");
    const r = await anonymizeExpiredGuests(todayInTimeZone(now));
    return r.cutoff ? { anonymized: r.anonymized } : { anonymized: 0, skipped: "sin_plazo" };
  } catch (e) {
    const cause = (e as { cause?: unknown }).cause ?? e;
    if (isMissingPmsSchema(cause)) return { anonymized: 0, skipped: "sin_migracion" };
    throw e;
  }
}

export function startHotelGuestRetentionJob(): void {
  console.log("[Jobs] Iniciando cron hotel_guest_retention_job (15 3 * * *)");
  scheduleTenantCron("15 3 * * *", HOTEL_GUEST_RETENTION_JOB, async () => {
    try {
      const r = await runHotelGuestRetentionJob();
      if (r.skipped) console.log(`[HotelGuestRetention] omitido (${r.skipped})`);
      else console.log(`[HotelGuestRetention] ${r.anonymized} ficha(s) anonimizada(s)`);
    } catch (err) {
      console.error("[HotelGuestRetention] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}
