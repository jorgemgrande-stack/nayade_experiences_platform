/**
 * Ensamblado de Elephant Ads Manager en el proceso: BD de la empresa en curso, credenciales de SU bóveda (`meta`,
 * `google_ads`), sus ajustes de la web (píxel y GA4) y licencia `ads-manager`. Solo en multiempresa: en la instalación
 * única no se sirve (allí las variables del entorno son de una sola empresa y no deben mezclarse).
 */
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { getSystemSetting } from "../config";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { getVault } from "../_core/credentials/runtime";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { systemAdsFetch } from "./connectors";
import { ADS_CAPABILITY, AdsManagerService } from "./service";

export function adsManagerService(): AdsManagerService {
  return new AdsManagerService({
    exec: async () => {
      if (!isMultiTenant()) throw new TRPCError({ code: "FORBIDDEN", message: "Ads Manager no está disponible en esta instalación." });
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
      return d;
    },
    vault: async (provider) => (isMultiTenant() ? getVault().resolve(provider) : {}),
    setting: (key) => getSystemSetting(key, ""),
    fetch: systemAdsFetch,
    tenantKey: () => getTenantIdOrDefault(),
    licensed: async () => {
      if (!isMultiTenant()) return false;
      try {
        return (await getCapabilityAccess().check(ADS_CAPABILITY, { write: true })).allowed;
      } catch {
        return false;
      }
    },
  });
}
