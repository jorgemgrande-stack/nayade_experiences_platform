/**
 * Ensamblado de Brevo marketing en el proceso: almacén en la BD de la empresa en curso, clave de la bóveda
 * (`brevo_marketing`) y licencia `email-campaigns`. El job de sincronización (`startBrevoMarketingJob`) corre por
 * empresa con `runForEachTenant` (programador del Core) y está desactivado por defecto (flag
 * `brevo_marketing_sync_enabled`); además, cada empresa decide con su interruptor de sincronización automática.
 */
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getVault } from "../_core/credentials/runtime";
import { scheduleTenantCron } from "../_core/tenantRegistry/scheduler";
import { BrevoMarketingService } from "./service";
import { TenantDbBrevoMarketingStore } from "./store";

export const BREVO_PROVIDER = "brevo_marketing";
export const BREVO_JOB = "brevo-marketing-sync";
export const BREVO_JOB_FLAG = "brevo_marketing_sync_enabled";
export const BREVO_CAPABILITY = "email-campaigns";

const store = new TenantDbBrevoMarketingStore();

export function brevoMarketingService(): BrevoMarketingService {
  return new BrevoMarketingService({
    store,
    credentials: {
      apiKey: async () => (await getVault().resolve(BREVO_PROVIDER)).apiKey || null,
      clear: () => getVault().clear(BREVO_PROVIDER),
    },
    // Elephant Campaigns: una retirada saca el correo de las listas de las campañas aún no enviadas (import diferido: ciclo)
    onWithdrawn: async (clientId, o) => (await import("../connectCampaigns/runtime")).campaignService().onWithdrawn(clientId, o),
    licensed: async () => {
      try {
        return (await getCapabilityAccess().check(BREVO_CAPABILITY, { write: true })).allowed;
      } catch {
        return false;
      }
    },
  });
}

/**
 * Cada hora, en el minuto 17 (para no coincidir con las tareas en punto). Primero la sincronización; después las
 * campañas de correo (Elephant Campaigns): termina las que se están preparando y lee estadísticas y bajas de Brevo.
 * Un fallo de las campañas no tumba la sincronización ni al revés.
 */
export function startBrevoMarketingJob() {
  return scheduleTenantCron("17 * * * *", BREVO_JOB, async ({ signal }) => {
    let sync: unknown;
    let syncError: unknown = null;
    try {
      sync = await brevoMarketingService().runScheduled(signal);
    } catch (e) {
      syncError = e;
    }
    const { campaignService } = await import("../connectCampaigns/runtime");
    const campaigns = await campaignService()
      .tick(signal)
      .catch(() => ({ skipped: "error" }));
    if (syncError) throw syncError;
    return { sync, campaigns };
  });
}
