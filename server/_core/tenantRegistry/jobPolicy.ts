/**
 * Qué hace cada tarea programada heredada en modo multiempresa.
 *
 *  - `per-tenant`: se ejecuta una vez por empresa, dentro de su contexto y con su base arrendada
 *    (programador de `scheduler.ts`). Solo para tareas que trabajan con datos y credenciales de la
 *    propia empresa.
 *  - `disabled-in-multi`: no se arranca en multiempresa; se deja UNA línea informativa al arrancar.
 *    Para tareas que dependen de recursos globales de la instalación (buzones IMAP del entorno,
 *    integraciones propias de Náyade): ejecutarlas por empresa volcaría datos de una instalación en
 *    la base de otra.
 *
 * Una tarea sin política declarada no se arranca en multiempresa (falla cerrado).
 * En single/shadow no cambia nada: se arrancan todas como siempre (ver `bootSingleTenant`).
 */
import { setJobFlag } from "./scheduler";

export type JobMultiPolicy =
  | { mode: "per-tenant"; reason: string }
  | { mode: "disabled-in-multi"; reason: string };

export const JOB_MULTI_POLICIES: Readonly<Record<string, JobMultiPolicy>> = {
  "abandoned-checkout": { mode: "per-tenant", reason: "Reservas y presupuestos de la propia empresa" },
  "installment-overdue": { mode: "per-tenant", reason: "Cuotas de la propia empresa; correo con el remitente de la empresa" },
  "cancellation-stale": { mode: "per-tenant", reason: "Anulaciones de la propia empresa; aviso al correo de la empresa" },
  "email-tpv-ingestion": { mode: "disabled-in-multi", reason: "Lee un buzón IMAP global de la instalación (IMAP_TPV_*)" },
  "expense-email-ingestion": { mode: "disabled-in-multi", reason: "Lee un buzón IMAP global de la instalación (IMAP_EXPENSE_*)" },
  "commercial-email-sync": { mode: "per-tenant", reason: "Cuentas de correo guardadas en la base de cada empresa" },
  "card-terminal-matching": { mode: "per-tenant", reason: "Conciliación con datos de la propia empresa" },
  "card-terminal-relink": { mode: "per-tenant", reason: "Revinculación con datos de la propia empresa" },
  "email-automation": { mode: "per-tenant", reason: "Cola de correos programados de la propia empresa" },
  "tax-reminder": { mode: "per-tenant", reason: "Obligaciones fiscales de la propia empresa" },
  "data-export": { mode: "per-tenant", reason: "Exportación de los datos de la propia empresa (también suspendida o en solo lectura)" },
};

export function jobMultiPolicy(name: string): JobMultiPolicy {
  return JOB_MULTI_POLICIES[name] ?? { mode: "disabled-in-multi", reason: "Sin política multiempresa declarada" };
}

export interface ScheduledJobSpec {
  name: string;
  flag: string;
  start: () => void;
  label: string;
  def: boolean;
}

/**
 * Arranque de las tareas en modo multi: las de empresa se registran una vez y evalúan su flag
 * dentro del contexto de cada empresa; las desactivadas dejan una única línea informativa.
 * Devuelve los nombres de las tareas arrancadas.
 */
export function startScheduledJobsMulti(jobs: ScheduledJobSpec[], log: (line: string) => void = console.log): string[] {
  const started: string[] = [];
  for (const j of jobs) {
    const policy = jobMultiPolicy(j.name);
    if (policy.mode === "disabled-in-multi") {
      log(`[Jobs] '${j.label}' no se arranca en multiempresa: ${policy.reason}`);
      continue;
    }
    setJobFlag(j.name, j.flag, j.def);
    j.start();
    started.push(j.name);
  }
  return started;
}
