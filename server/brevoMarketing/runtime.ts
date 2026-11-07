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
    licensed: async () => {
      try {
        return (await getCapabilityAccess().check(BREVO_CAPABILITY, { write: true })).allowed;
      } catch {
        return false;
      }
    },
  });
}

/** Cada hora, en el minuto 17 (para no coincidir con las tareas en punto). */
export function startBrevoMarketingJob() {
  return scheduleTenantCron("17 * * * *", BREVO_JOB, ({ signal }) => brevoMarketingService().runScheduled(signal));
}
