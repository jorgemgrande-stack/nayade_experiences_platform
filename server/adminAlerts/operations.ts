/**
 * Fuentes operativas de las alertas administrativas: hechos que el plano de control comprueba por sí mismo, sin que
 * nadie tenga que avisarle.
 *  - Restauraciones de prueba (`admin.restore_drill_failed`): el registro de restauraciones (`backup_restores`,
 *    registro 0011) que escribe `backup-job` en cada restauración. Una fallida, o una que sigue «en curso» horas después
 *    (el proceso murió a medias), es un hecho. Solo desde la activación: nunca avisa de fallos anteriores.
 *  - Disponibilidad de cada empresa (`admin.customer_down`): sonda periódica de `/readyz` en el dominio público de cada
 *    empresa en servicio (sin las de prueba o demostración). Caída = N fallos seguidos durante al menos X minutos; un
 *    único aviso por caída (la caída queda anotada en `admin_alert_state`, también entre reinicios) y un aviso de
 *    recuperación, como hecho distinto, cuando vuelve a responder.
 *  - Publicación automática (`admin.deploy_failed`): la API pública de GitHub Actions del repositorio (sin token: el
 *    repositorio es público). Una ejecución terminada en fallo cuyo trabajo «Publicar en live» o «Publicar en
 *    production» falló es un hecho; cada intento de cada ejecución, una sola vez.
 */
import crypto from "node:crypto";
import { opsLog } from "../_core/ops/log";
import type { RestoreLogRecord } from "../_core/ops/backupCopies";
import type { AlertFacts } from "./catalog";
import type { AdminAlertStore } from "./store";
import { dateTime } from "./templates";

type Raise = (alertId: string, f: AlertFacts) => Promise<unknown>;
type StateStore = Pick<AdminAlertStore, "getState" | "setState">;
const H = 3600_000;

// ── Restauraciones de prueba ──────────────────────────────────────────────────

/** Una restauración «en curso» más allá de este tiempo se da por fallida (el proceso terminó sin anotar el final). */
export const RESTORE_STALE_MS = 6 * H;

/** Alertas de las restauraciones fallidas o colgadas iniciadas desde `since` (pura). */
export function restoreDrillAlerts(list: RestoreLogRecord[], since: number, now: number): Array<{ id: string; facts: AlertFacts }> {
  const out: Array<{ id: string; facts: AlertFacts }> = [];
  for (const r of list) {
    if (r.startedAt < since) continue;
    const stale = r.status === "running" && now - r.startedAt >= RESTORE_STALE_MS;
    if (r.status !== "failed" && !stale) continue;
    const target = `${r.targetKind === "tenant" ? "empresa" : r.targetKind} ${r.targetId}`;
    out.push({
      id: "admin.restore_drill_failed",
      facts: {
        key: `restore:${r.id}`,
        occurredAt: r.finishedAt ?? now,
        tenantId: r.targetKind === "tenant" ? r.targetId : null,
        summary: stale ? `La restauración de prueba de ${target} sigue sin terminar ${Math.floor((now - r.startedAt) / H)} horas después de empezar.` : `La restauración de prueba de ${target} ha fallado${r.verified ? "" : " y la copia restaurada no se ha podido verificar"}.`,
        status: { label: stale ? "Sin terminar" : "Fallida", tone: "error" },
        reference: `Restauración #${r.id}`,
        details: [
          { label: "Origen de la copia", value: r.source === "secondary" ? "almacenamiento secundario" : "almacenamiento principal" },
          { label: "Inicio", value: dateTime(r.startedAt) },
          ...(r.error ? [{ label: "Error", value: r.error.slice(0, 200) }] : []),
        ],
        link: r.targetKind === "tenant" ? `#/clientes/${r.targetId}` : "#/dashboard",
      },
    });
  }
  return out;
}

/** Lee el registro de restauraciones y avisa de las fallidas desde la activación (la primera vez solo anota la fecha). */
export class RestoreDrillWatcher {
  constructor(private d: { restores: () => Promise<RestoreLogRecord[]>; store: StateStore; raise: Raise; now?: () => number }) {}
  async tick(): Promise<number> {
    const now = (this.d.now ?? Date.now)();
    const since = await this.d.store.getState("restore_drills_since");
    if (since === null) {
      await this.d.store.setState("restore_drills_since", now, now);
      return 0;
    }
    const list = restoreDrillAlerts(await this.d.restores(), since, now);
    for (const a of list) await this.d.raise(a.id, a.facts);
    return list.length;
  }
}

// ── Disponibilidad de cada empresa ────────────────────────────────────────────

export interface UptimeTarget {
  tenantId: string;
  company: string | null;
  /** URL de la sonda (`https://<dominio público>/readyz`). */
  url: string;
}

/** Empresas de prueba o demostración: no se vigilan (sus caídas no afectan a clientes). */
export const TEST_TENANT = /(^|[-_])(demo|prueba|pruebas|test|e2e|sandbox|staging)([-_]|$)|^cms-prueba-/;
export const isTestTenant = (id: string, name?: string | null) => TEST_TENANT.test(id) || /\b(demo|prueba|test|e2e|sandbox)\b/i.test(name ?? "");

/** Estados en los que la plataforma de una empresa debe responder. */
export const SERVED_STATUSES: readonly string[] = ["active", "grace", "trial"];

export const DOWN_AFTER_FAILURES = 3;
export const DOWN_AFTER_MS = 5 * 60_000;

/** Sonda HTTP: 200 en `/readyz` (proceso y base de datos de la empresa) en 10 s o menos. */
export async function probeReady(url: string, timeoutMs = 10_000): Promise<boolean> {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "cache-control": "no-cache", "user-agent": "elephant-source-uptime" } });
    await r.body?.cancel().catch(() => undefined);
    return r.status === 200;
  } catch {
    return false;
  }
}

/**
 * Vigilancia de disponibilidad. Los fallos seguidos se cuentan en memoria; la caída DECLARADA (con su aviso) se guarda
 * en `admin_alert_state` (`uptime:<huella del tenant>` = inicio de la caída; 0 = en servicio), así que un reinicio a
 * mitad de una caída no repite el aviso y la recuperación se avisa igual.
 */
export class UptimeMonitor {
  private failures = new Map<string, { count: number; since: number }>();
  private declared = new Map<string, number>();
  constructor(
    private d: {
      targets: () => Promise<UptimeTarget[]>;
      probe?: (url: string) => Promise<boolean>;
      store: StateStore;
      raise: Raise;
      now?: () => number;
      failuresToAlert?: number;
      minDownMs?: number;
      concurrency?: number;
    },
  ) {}

  private stateName(tenantId: string) {
    return `uptime:${crypto.createHash("sha256").update(tenantId).digest("hex").slice(0, 32)}`;
  }

  private async declaredSince(tenantId: string): Promise<number> {
    if (!this.declared.has(tenantId)) this.declared.set(tenantId, (await this.d.store.getState(this.stateName(tenantId))) ?? 0);
    return this.declared.get(tenantId)!;
  }

  private async setDeclared(tenantId: string, v: number, now: number) {
    await this.d.store.setState(this.stateName(tenantId), v, now);
    this.declared.set(tenantId, v);
  }

  async tick(): Promise<{ checked: number; down: number; recovered: number }> {
    const probe = this.d.probe ?? probeReady;
    const targets = await this.d.targets();
    const out = { checked: 0, down: 0, recovered: 0 };
    const n = Math.max(1, this.d.concurrency ?? 8);
    for (let i = 0; i < targets.length; i += n) {
      const batch = targets.slice(i, i + n);
      const results = await Promise.all(batch.map((t) => probe(t.url)));
      for (let k = 0; k < batch.length; k++) {
        out.checked++;
        const r = await this.handle(batch[k], results[k]).catch((e) => (opsLog("warn", "AdminAlerts", "uptime_step_failed", { tenantId: batch[k].tenantId, error: e instanceof Error ? e.name : "error" }), null));
        if (r === "down") out.down++;
        if (r === "recovered") out.recovered++;
      }
    }
    return out;
  }

  private async handle(t: UptimeTarget, ok: boolean): Promise<"down" | "recovered" | null> {
    const now = (this.d.now ?? Date.now)();
    if (ok) {
      this.failures.delete(t.tenantId);
      const since = await this.declaredSince(t.tenantId);
      if (!since) return null;
      await this.d.raise("admin.customer_down", {
        key: `up:${t.tenantId}:${since}`,
        occurredAt: now,
        tenantId: t.tenantId,
        company: t.company,
        summary: `La plataforma vuelve a responder tras ${Math.max(1, Math.round((now - since) / 60_000))} minutos sin servicio.`,
        status: { label: "Recuperada", tone: "success" },
        intervention: false,
        details: [{ label: "Sin servicio desde", value: dateTime(since) }, { label: "Recuperada", value: dateTime(now) }],
        link: `#/clientes/${t.tenantId}`,
      });
      await this.setDeclared(t.tenantId, 0, now);
      return "recovered";
    }
    const f = this.failures.get(t.tenantId) ?? { count: 0, since: now };
    f.count++;
    this.failures.set(t.tenantId, f);
    if (f.count < (this.d.failuresToAlert ?? DOWN_AFTER_FAILURES) || now - f.since < (this.d.minDownMs ?? DOWN_AFTER_MS)) return null;
    // Ya declarada (en esta réplica o antes de un reinicio): un único aviso por caída
    if (await this.declaredSince(t.tenantId)) return null;
    await this.d.raise("admin.customer_down", {
      key: `down:${t.tenantId}:${f.since}`,
      occurredAt: now,
      tenantId: t.tenantId,
      company: t.company,
      summary: `La plataforma no responde: ${f.count} comprobaciones seguidas fallidas desde hace ${Math.round((now - f.since) / 60_000)} minutos.`,
      status: { label: "Caída", tone: "error" },
      details: [{ label: "Primer fallo", value: dateTime(f.since) }, { label: "Comprobación", value: t.url.replace(/^https?:\/\//, "") }],
      link: `#/clientes/${t.tenantId}`,
    });
    await this.setDeclared(t.tenantId, f.since, now);
    return "down";
  }
}

// ── Publicación automática ────────────────────────────────────────────────────

export const DEPLOY_JOB = /Publicar en (live|production)/;
export const DEPLOY_WORKFLOWS = ["publicacion.yml", "ci.yml"] as const;

interface GhRun { id: number; run_attempt?: number; run_number?: number; conclusion: string | null; status: string; created_at: string; head_sha: string; html_url: string; name?: string }
interface GhJob { name: string; conclusion: string | null }

/** Petición GET a la API de GitHub: estado HTTP y cuerpo JSON (o null). */
export type GithubGet = (path: string) => Promise<{ status: number; body: unknown }>;

export function githubGet(o: { token?: string | null; base?: string } = {}): GithubGet {
  const base = o.base ?? "https://api.github.com";
  return async (path) => {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "elephant-source-controlplane", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  };
}

/** Alerta de una ejecución fallida de la publicación, o null si no falló ningún trabajo de publicación (pura). */
export function deployFailureAlert(run: GhRun, jobs: GhJob[], now: number): { id: string; facts: AlertFacts } | null {
  const failed = jobs.filter((j) => j.conclusion === "failure" && DEPLOY_JOB.test(j.name));
  if (!failed.length) return null;
  const stages = Array.from(new Set(failed.map((j) => DEPLOY_JOB.exec(j.name)![1])));
  const prod = stages.includes("production");
  const attempt = run.run_attempt ?? 1;
  return {
    id: "admin.deploy_failed",
    facts: {
      key: `deploy:${run.id}:${attempt}`,
      occurredAt: Number.isFinite(Date.parse(run.created_at)) ? Date.parse(run.created_at) : now,
      summary: prod ? "La publicación automática en production ha fallado: los clientes pueden seguir con la versión anterior o con una publicación a medias." : "La publicación automática ha fallado en live: este cambio no ha llegado a production.",
      status: { label: prod ? "Fallida en production" : "Fallida en live", tone: "error" },
      reference: `Commit ${run.head_sha.slice(0, 12)}`,
      details: [
        { label: "Etapa", value: stages.join(" y ") },
        { label: "Ejecución", value: `${run.name ?? "Publicación"} #${run.run_number ?? run.id}${attempt > 1 ? ` (intento ${attempt})` : ""}` },
        { label: "Trabajos fallidos", value: failed.slice(0, 3).map((j) => j.name).join(" · ").slice(0, 300) },
        { label: "Registro", value: run.html_url.slice(0, 200) },
      ],
      link: "#/dashboard",
    },
  };
}

/**
 * Consulta periódica (cada `everyMs`) de las ejecuciones terminadas de la publicación en la rama de integración.
 * Solo las creadas desde la activación; cada intento se revisa una vez por proceso (y `raise` es idempotente).
 */
export class DeployWatcher {
  private lastRun = 0;
  private seen = new Set<string>();
  constructor(
    private d: {
      get: GithubGet;
      repo: string;
      branch: string;
      workflows?: readonly string[];
      store: StateStore;
      raise: Raise;
      everyMs?: number;
      now?: () => number;
    },
  ) {}

  async tick(): Promise<number> {
    const now = (this.d.now ?? Date.now)();
    if (this.lastRun && now - this.lastRun < (this.d.everyMs ?? 10 * 60_000)) return 0;
    this.lastRun = now;
    const since = await this.d.store.getState("deploy_runs_since");
    if (since === null) {
      await this.d.store.setState("deploy_runs_since", now, now);
      return 0;
    }
    let raised = 0;
    for (const wf of this.d.workflows ?? DEPLOY_WORKFLOWS) {
      const res = await this.d.get(`/repos/${this.d.repo}/actions/workflows/${wf}/runs?branch=${encodeURIComponent(this.d.branch)}&status=completed&per_page=20`);
      if (res.status !== 200) {
        opsLog("warn", "AdminAlerts", "deploy_watch_unavailable", { workflow: wf, status: res.status });
        continue;
      }
      const runs = ((res.body as { workflow_runs?: GhRun[] })?.workflow_runs ?? []).filter((r) => r.conclusion === "failure" && Date.parse(r.created_at) >= since);
      for (const run of runs) {
        const id = `${run.id}:${run.run_attempt ?? 1}`;
        if (this.seen.has(id)) continue;
        const jr = await this.d.get(`/repos/${this.d.repo}/actions/runs/${run.id}/attempts/${run.run_attempt ?? 1}/jobs?per_page=100`);
        if (jr.status !== 200) continue; // se reintenta en la siguiente consulta
        this.seen.add(id);
        const a = deployFailureAlert(run, (jr.body as { jobs?: GhJob[] })?.jobs ?? [], now);
        if (!a) continue;
        await this.d.raise(a.id, a.facts);
        raised++;
      }
    }
    return raised;
  }
}
