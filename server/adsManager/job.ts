/**
 * Elephant Ads Manager · importación diaria (tarea `ads-manager-sync`, por empresa con `scheduleTenantCron`, a las
 * 06:25). Solo actúa en empresas con la capacidad `ads-manager`, la migración 0055, la importación automática
 * encendida (por defecto) y alguna conexión configurada en SU bóveda; el resto se omite sin tocar nada. Importa los
 * últimos 7 días (90 la primera vez) de Meta Ads y de Google Ads, en solo lectura.
 * Flag global: `ads_manager_sync_enabled` (activa por defecto: el interruptor real es el de cada empresa).
 */
import { scheduleTenantCron } from "../_core/tenantRegistry/scheduler";

export const ADS_SYNC_JOB = "ads-manager-sync";
export const ADS_SYNC_FLAG = "ads_manager_sync_enabled";

export function startAdsManagerSyncJob(): void {
  console.log("[Jobs] Iniciando cron ads_manager_sync (25 6 * * *)");
  scheduleTenantCron("25 6 * * *", ADS_SYNC_JOB, async ({ signal }) => {
    const { adsManagerService } = await import("./runtime");
    const r = await adsManagerService().runScheduled(signal);
    const failed = r.results?.filter((x) => !x.ok) ?? [];
    if (failed.length) console.warn(`[AdsManager] importación con error: ${failed.map((x) => `${x.platform}=${x.error}`).join(", ")}`);
    return r;
  });
}
