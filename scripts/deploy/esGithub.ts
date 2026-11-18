/**
 * Lectura de las aprobaciones protegidas desde GitHub (gh api con GH_TOKEN del flujo). Solo lee. Si algo no se puede
 * leer, devuelve error: el llamador trata la ausencia de datos como «sin aprobaciones» (bloqueo seguro), nunca al revés.
 */
import { spawnSync } from "node:child_process";
import { approvalsFromRuns, type Approval, type RunRecord } from "./esReleaseLib";

const gh = (args: string[]): string => {
  const r = spawnSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh api ${args[0]} falló: ${(r.stderr ?? "").slice(0, 200)}`);
  return r.stdout ?? "";
};

/** Ejecuciones correctas del flujo de despliegue lanzadas a mano en la rama de integración (hasta 300, las más recientes). */
export function fetchApprovals(repository: string, resolve: (sha: string) => string | null): { approvals: Approval[]; scanned: number } {
  const wf = "deploy-elephant-source.yml";
  const raw: RunRecord[] = [];
  const perms = new Map<string, string | null>();
  for (let page = 1; page <= 3; page++) {
    const body = JSON.parse(gh([`repos/${repository}/actions/workflows/${wf}/runs?event=workflow_dispatch&status=success&branch=integration/elephant-source&per_page=100&page=${page}`])) as {
      workflow_runs: Array<{ id: number; display_title: string; event: string; conclusion: string | null; head_branch: string | null; head_sha: string; created_at: string; actor?: { login: string } | null; triggering_actor?: { login: string } | null }>;
    };
    for (const r of body.workflow_runs) {
      // Solo se consulta el permiso de quien lanzó las que pueden ser aprobaciones (nombre con el formato fijo)
      const actor = r.actor?.login ?? "";
      // Un relanzamiento (re-run) de otra persona no hereda la autoridad del primer lanzador
      if ((r.triggering_actor?.login ?? actor) !== actor) continue;
      if (!/^[a-z0-9-]+ · production · [0-9a-f]{7,40}$/.test(r.display_title)) continue;
      if (!perms.has(actor)) {
        try {
          perms.set(actor, (JSON.parse(gh([`repos/${repository}/collaborators/${actor}/permission`])) as { permission?: string }).permission ?? null);
        } catch (e) {
          // El GITHUB_TOKEN puede no poder leer permisos: en un repositorio de usuario solo su dueño es administrador
          const owner = (process.env.GITHUB_REPOSITORY_OWNER ?? repository.split("/")[0]).toLowerCase();
          console.error(`AVISO: permiso de ${actor} no legible (${(e as Error).message.slice(0, 80)}); ${actor.toLowerCase() === owner ? "es el dueño del repositorio: administrador" : "se descarta"}`);
          perms.set(actor, actor.toLowerCase() === owner ? "admin" : null);
        }
      }
      raw.push({ id: r.id, displayTitle: r.display_title, event: r.event, conclusion: r.conclusion, headBranch: r.head_branch, headSha: r.head_sha, actor, actorPermission: perms.get(actor) ?? null, createdAt: r.created_at });
    }
    if (body.workflow_runs.length < 100) break;
    if (page === 3) console.error("AVISO: historial de ejecuciones al tope (300): una aprobación antigua puede no verse y se pediría de nuevo (bloqueo seguro)");
  }
  return { approvals: approvalsFromRuns(raw, resolve), scanned: raw.length };
}
