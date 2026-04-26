import { TRPCError } from "@trpc/server";
import { getFeatureFlag } from "../config";

/**
 * Throws FORBIDDEN if the given feature flag is disabled.
 * Call at the start of any adminProcedure handler that belongs to an optional module.
 */
export async function assertModuleEnabled(flagKey: string): Promise<void> {
  const enabled = await getFeatureFlag(flagKey, false);
  if (!enabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Módulo desactivado. Actívalo en Configuración → Estado del sistema (flag: ${flagKey}).`,
    });
  }
}
