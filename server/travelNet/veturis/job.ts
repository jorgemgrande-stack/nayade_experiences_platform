/**
 * Job de inventario de Veturis por empresa (`runForEachTenant` del programador del Core): comprueba la disponibilidad
 * de los hoteles de cada empresa con su propia cuenta. Desactivado por defecto con el flag `veturis_inventory_enabled`
 * y, además, por empresa con su interruptor de inventario. Tope de llamadas por ejecución. Nunca reserva.
 */
import { scheduleTenantCron } from "../../_core/tenantRegistry/scheduler";
import { runInventoryCheck } from "./service";

export const VETURIS_JOB = "veturis-inventory";
export const VETURIS_JOB_FLAG = "veturis_inventory_enabled";

/** Cada día a las 05:40, fuera de horas punta. */
export function startVeturisInventoryJob() {
  return scheduleTenantCron("40 5 * * *", VETURIS_JOB, ({ signal }) => runInventoryCheck(signal));
}
