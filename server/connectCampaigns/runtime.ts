/**
 * Ensamblado de Elephant Campaigns en el proceso: almacén en la BD de la empresa en curso, la MISMA clave de Brevo de la
 * bóveda (`brevo_marketing`) que la sincronización, la plantilla de correo con la marca de la empresa, el enlace de baja
 * firmado y la licencia `email-campaigns`. El job no es nuevo: va dentro del de Brevo marketing (runtime.ts).
 */
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getVault } from "../_core/credentials/runtime";
import { BREVO_CAPABILITY, BREVO_PROVIDER } from "../brevoMarketing/runtime";
import { TenantDbBrevoMarketingStore } from "../brevoMarketing/store";
import { buildCampaignHtml } from "../emailTemplates";
import { unsubscribeUrl } from "../netPublic/brevoUnsubscribe";
import { CampaignService } from "./service";
import { TenantDbCampaignStore } from "./store";

const store = new TenantDbCampaignStore();
const consents = new TenantDbBrevoMarketingStore();

export function campaignService(): CampaignService {
  return new CampaignService({
    store,
    consents,
    credentials: { apiKey: async () => (await getVault().resolve(BREVO_PROVIDER)).apiKey || null },
    render: buildCampaignHtml,
    unsubscribeUrl,
    licensed: async () => {
      try {
        return (await getCapabilityAccess().check(BREVO_CAPABILITY, { write: true })).allowed;
      } catch {
        return false;
      }
    },
  });
}
