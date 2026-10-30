/**
 * Cortocircuitos de las tareas en segundo plano por empresa (Core: tenantRegistry/jobIsolation.ts), vistos desde el plano
 * de control por el canal interno (acción `modules`): la consulta de `/cp/v1/jobs/circuits` y el aviso a la
 * administración (`admin.integration_error`) cuando una tarea queda en cortocircuito para una empresa.
 *
 * Un aviso por apertura: la clave del hecho lleva el número de aperturas seguidas, así que una reapertura (la tarea
 * vuelve a fallar tras la espera) avisa de nuevo y un ciclo repetido sobre el mismo estado no.
 */
import { accessPolicy } from "../_core/tenantRegistry/lifecycle";
import { mapLimit } from "../_core/tenantRegistry/jobIsolation";
import type { CoreAccessClient } from "./tenantAccess";

export interface JobCircuitsView {
  available: boolean;
  checked: number;
  circuits: Array<Record<string, unknown>>;
  /** Ejecuciones colgadas por tarea en la réplica que responde. */
  hung: Record<string, number>;
  unreachable: string[];
}

export async function collectJobCircuits(o: {
  client: CoreAccessClient | null;
  listTenants: () => Promise<Array<{ id: string; status: string }>>;
  operator: string;
  only?: string | null;
  onlyOpen?: boolean;
}): Promise<JobCircuitsView> {
  if (!o.client) return { available: false, checked: 0, circuits: [], hung: {}, unreachable: [] };
  const client = o.client;
  const tenants = o.only ? [o.only] : (await o.listTenants()).filter((t) => accessPolicy(t.status as never).admin).map((t) => t.id);
  const circuits: Array<Record<string, unknown>> = [];
  const hung: Record<string, number> = {};
  const unreachable: string[] = [];
  await mapLimit(tenants, 4, async (id) => {
    const r = await client.call({ tenantId: id, act: "modules", operator: o.operator }).catch(() => null);
    const jobs = r?.status === 200 ? (r.body.jobs as { circuits?: Array<Record<string, unknown>>; hung?: Record<string, number> } | undefined) : undefined;
    if (!jobs) return void unreachable.push(id);
    for (const c of jobs.circuits ?? []) if (o.onlyOpen === false || c.state !== "closed") circuits.push(c);
    for (const [job, n] of Object.entries(jobs.hung ?? {})) hung[job] = Math.max(hung[job] ?? 0, n);
  });
  return { available: true, checked: tenants.length, circuits, hung, unreachable: unreachable.sort() };
}

type Facts = { key: string; occurredAt: number; tenantId: string; summary: string; status: { label: string; tone: "error" | "warning" }; details: Array<{ label: string; value: string }>; link: string };

/** Cortocircuitos abiertos → avisos (puro). */
export function jobCircuitAlerts(circuits: Array<Record<string, unknown>>, now: number): Array<{ id: "admin.integration_error"; facts: Facts }> {
  const out: Array<{ id: "admin.integration_error"; facts: Facts }> = [];
  for (const c of circuits) {
    if (c.state !== "open") continue;
    const tenantId = String(c.tenantId ?? "");
    const job = String(c.job ?? "");
    if (!tenantId || !job) continue;
    const opens = Number(c.opens) || 1;
    const failures = Number(c.consecutiveFailures) || 0;
    const until = Number(c.openUntil) || null;
    const lastError = typeof c.lastError === "string" ? c.lastError.slice(0, 160) : null;
    out.push({
      id: "admin.integration_error",
      facts: {
        key: `jobs:${tenantId}:${job}:open:${opens}`,
        occurredAt: now,
        tenantId,
        summary: `La tarea «${job}» se ha detenido para esta empresa tras ${failures} fallos seguidos${opens > 1 ? ` (apertura ${opens})` : ""}; el resto de empresas sigue con normalidad.`,
        status: { label: "Tarea en pausa", tone: opens > 1 ? "error" : "warning" },
        details: [
          { label: "Tarea", value: job },
          { label: "Fallos seguidos", value: String(failures) },
          ...(until ? [{ label: "Próximo intento", value: new Date(until).toISOString().slice(0, 16).replace("T", " ") + " UTC" }] : []),
          ...(lastError ? [{ label: "Último error", value: lastError }] : []),
        ],
        link: `#/clientes/${tenantId}`,
      },
    });
  }
  return out;
}
