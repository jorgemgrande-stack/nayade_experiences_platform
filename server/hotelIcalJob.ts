/**
 * Hotel Net · sincronización automática de los calendarios iCal de los canales (tarea `hotel-ical-sync`, por empresa con
 * `scheduleTenantCron`, cada 15 minutos).
 *
 *  - Solo en empresas con la capacidad `hotel-net` activa y el módulo de hotel encendido (sin poder comprobarlo, no
 *    toca nada) y con su interruptor de sincronización automática encendido (apagado por defecto; se enciende solo al
 *    configurar la primera URL de importación y se puede apagar en «Canales iCal»).
 *  - Sin la migración 0050 la empresa se omite sin error.
 *  - Cada URL se intenta como mucho cada 15 minutos, con tope de URLs por pasada; un fallo de una no para las demás y
 *    queda a la vista en el panel.
 * Flag global: `hotel_ical_sync_enabled` (activa por defecto: el interruptor real es el de cada empresa).
 */
import { scheduleTenantCron } from "./_core/tenantRegistry/scheduler";

export const HOTEL_ICAL_JOB = "hotel-ical-sync";
export const HOTEL_ICAL_FLAG = "hotel_ical_sync_enabled";

export async function runHotelIcalSync(signal?: AbortSignal): Promise<{ ok: number; failed: number; skipped?: string }> {
  const { icalAvailable, syncDueFeeds, IcalNotInstalled } = await import("./hotelIcalDb");
  if (!(await icalAvailable())) return { ok: 0, failed: 0, skipped: "sin_hotel_net" };
  try {
    const r = await syncDueFeeds({ signal });
    if (r.skipped) return { ok: 0, failed: 0, skipped: r.skipped };
    return { ok: r.results.filter((x) => x.ok).length, failed: r.results.filter((x) => !x.ok).length };
  } catch (e) {
    if (e instanceof IcalNotInstalled) return { ok: 0, failed: 0, skipped: "sin_migracion" };
    throw e;
  }
}

export function startHotelIcalSyncJob(): void {
  console.log("[Jobs] Iniciando cron hotel_ical_sync (*/15 * * * *)");
  scheduleTenantCron("*/15 * * * *", HOTEL_ICAL_JOB, async ({ signal }) => {
    try {
      const r = await runHotelIcalSync(signal);
      if (r.ok || r.failed) console.log(`[HotelIcal] ${r.ok} calendario(s) sincronizado(s), ${r.failed} con error`);
    } catch (err) {
      console.error("[HotelIcal] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}
