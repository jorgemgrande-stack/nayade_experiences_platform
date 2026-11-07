import { TRPCError } from "@trpc/server";
import { getFeatureFlag } from "../config";

/**
 * Interruptores de los módulos sectoriales de Elephant Net (Hotel Net, Care Net): una empresa nueva no tiene su fila
 * (la siembra solo crea los del Core), así que sin fila cuentan como ENCENDIDOS y decide la licencia, que ya aplica el
 * guardián de módulos (capacidad del producto o licencia de módulo). Si la empresa tiene la fila, manda su valor.
 */
export const SECTOR_MODULE_FLAG_DEFAULTS: Readonly<Record<string, boolean>> = {
  hotel_module_enabled: true,
  spa_module_enabled: true,
};

/** Valor efectivo del interruptor de un módulo (con el valor por defecto de los sectoriales si no hay fila). */
export function moduleFlagEnabled(flagKey: string): Promise<boolean> {
  return getFeatureFlag(flagKey, SECTOR_MODULE_FLAG_DEFAULTS[flagKey] ?? false);
}

/**
 * Throws FORBIDDEN if the given feature flag is disabled.
 * Call at the start of any adminProcedure handler that belongs to an optional module.
 */
export async function assertModuleEnabled(flagKey: string): Promise<void> {
  const enabled = await moduleFlagEnabled(flagKey);
  if (!enabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Módulo desactivado. Actívalo en Configuración → Estado del sistema (flag: ${flagKey}).`,
    });
  }
}
