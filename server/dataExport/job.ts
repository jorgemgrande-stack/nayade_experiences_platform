/**
 * Trabajo `data-export`: cada minuto, en cada empresa con panel (también suspendidas o en solo lectura, que es
 * justo cuando la exportación está garantizada), genera la siguiente exportación en cola, retoma las
 * interrumpidas cuando caduca su arriendo, cierra las que agotaron sus intentos y retira temporales caducados.
 * Flag por empresa: `data_export_job_enabled` (activo por defecto).
 */
import { scheduleTenantInterval } from "../_core/tenantRegistry/scheduler";
import { exportService } from "./runtime";

export const DATA_EXPORT_JOB_INTERVAL_MS = 60_000;

export function startDataExportJob() {
  return scheduleTenantInterval("data-export", DATA_EXPORT_JOB_INTERVAL_MS, 30_000, () => exportService().processNext(), { includeReadOnly: true });
}
