/**
 * Interruptor de la implantación asistida (apagado por defecto): con CP_ASSISTED_IMPLEMENTATION_ENABLED=1 y la
 * migración 0035 del CRM aplicada se montan el expediente, la orden de implantación y la apertura automática desde las
 * solicitudes de la web de soluciones asistidas. Sin él, nada cambia.
 */
export function assistedImplementationEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.CP_ASSISTED_IMPLEMENTATION_ENABLED ?? "").trim() === "1";
}
