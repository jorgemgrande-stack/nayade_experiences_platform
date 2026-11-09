/**
 * Automatizaciones avanzadas · tarea programada `connect-automations` (por empresa con `scheduleTenantCron`, cada 10
 * minutos). En cada empresa solo actúa con la licencia `automations-advanced` en escritura y reglas encendidas; sin la
 * migración 0062 la empresa se omite sin error. Flag de la instalación: `connect_automations_enabled` (activa por
 * defecto; el interruptor real es cada regla, apagada al crearse).
 */
import { scheduleTenantCron } from "../_core/tenantRegistry/scheduler";
import { automationService } from "./runtime";
import { AutomationsNotInstalled } from "./store";
import type { PassResult } from "./service";

export const AUTOMATIONS_JOB = "connect-automations";
export const AUTOMATIONS_FLAG = "connect_automations_enabled";

export async function runAutomationsPass(): Promise<PassResult> {
  try {
    return await automationService().runPass();
  } catch (e) {
    if (e instanceof AutomationsNotInstalled) return { rules: 0, done: 0, skipped: 0, failed: 0, deferred: 0, skippedAll: "sin_migracion" };
    throw e;
  }
}

export function startAutomationsJob(): void {
  console.log("[Jobs] Iniciando cron connect_automations (*/10 * * * *)");
  scheduleTenantCron("*/10 * * * *", AUTOMATIONS_JOB, async () => {
    try {
      const r = await runAutomationsPass();
      if (r.done || r.failed) console.log(`[Automatizaciones] ${r.done} hecha(s), ${r.failed} fallida(s), ${r.skipped} omitida(s), ${r.deferred} en espera por topes`);
    } catch (err) {
      console.error("[Automatizaciones] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}
