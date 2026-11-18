/**
 * Modelo de release y de autorizaciones protegidas de Elephant Source (docs/elephant-source/AUTORIZACIONES_PROTEGIDAS.md).
 *
 * Causa raíz que corrige (incidente #875, 17-18/11/2026): `active-sha` devolvía el ANTECESOR COMÚN (merge-base --octopus)
 * de los commits que servían controlplane, core y core-gateway. Con Core ya en el commit protegido aprobado y los otros
 * dos atrasados, la referencia era el commit viejo y TODO el diff protegido ya aprobado volvía a aparecer en cada
 * publicación ordinaria. Además la aprobación no quedaba registrada en ningún sitio: no había forma de saber que ese
 * contenido ya estaba autorizado.
 *
 * Aquí se decide por SERVICIO (su commit real frente al destino) y la autorización queda ligada al CONTENIDO exacto
 * (huella = fichero protegido + blob en el commit aprobado), nunca al nombre del fichero. Todo es puro y recibe sus
 * dependencias (git, aprobaciones, estados), para probarlo con repositorios temporales sin Railway ni GitHub.
 */
import { ORDINARY_PRODUCTION_ACTIONS, ORDINARY_SERVICES, extraordinaryChanges } from "./esRailwayLib";

export type Service = (typeof ORDINARY_SERVICES)[number];

/** Lo que el modelo necesita de git (implementación real: gitView; en pruebas, un repositorio temporal). */
export interface GitView {
  diffFiles(from: string, to: string): string[];
  diffText(from: string, to: string): string;
  /** Contenido (id de blob) del fichero en el commit; null si no existe. */
  blobAt(commit: string, file: string): string | null;
  /** Contenido SQL de una migración en el commit de destino; null si no existe. */
  sqlAt(commit: string, file: string): string | null;
  isAncestor(ancestor: string, descendant: string): boolean;
  /** ¿El nombre de un interruptor existía ya en lo servido? (los nuevos nacen desactivados) */
  existsIn(commit: string, name: string): boolean;
}

// ── Aprobaciones ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Acciones de production que despliegan código bajo el procedimiento protegido y de las que puede salir una aprobación
 * de CONTENIDO. Variables, correo, almacenamiento, purgas, etc. son aprobaciones de otra cosa: no cubren código.
 */
export const APPROVING_ACTIONS: Record<string, readonly Service[]> = {
  "aplicar-production": ORDINARY_SERVICES,
  "desplegar-controlplane": ["controlplane"],
  "desplegar-core": ["core"],
  "desplegar-core-gateway": ["core-gateway"],
};

/** Formato del `run-name` del flujo de despliegue: «<acción> · <entorno> · <commit>». Lo fija el flujo, no el usuario. */
export const RUN_NAME = /^([a-z0-9-]+) · (live|production) · ([0-9a-f]{7,40})$/;

/** Ejecución del flujo de despliegue tal y como la devuelve GitHub (solo lo que se verifica). */
export interface RunRecord {
  id: number;
  displayTitle: string;
  event: string;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string;
  actor: string;
  actorPermission: string | null;
  createdAt: string;
  /** Si el entorno tuviera revisores obligatorios: quienes aprobaron. Vacío si no hay revisores configurados. */
  approvedBy?: string[];
}

export interface Approval {
  runId: number;
  action: string;
  environment: string;
  /** Commit exacto aprobado y desplegado. */
  sha: string;
  /** Servicios sobre los que se ejecutó. */
  services: readonly Service[];
  actor: string;
  at: string;
}

export const PROTECTED_BRANCH = "integration/elephant-source";

/**
 * Aprobaciones verificables a partir de ejecuciones de GitHub. Una ejecución cuenta SOLO si: es del flujo de despliegue
 * (lo comprueba quien consulta), event=workflow_dispatch, rama integration/elephant-source, terminó en `success`, su
 * nombre sigue el formato fijo, la acción es una de APPROVING_ACTIONS, el entorno es production y quien la lanzó es
 * administrador del repositorio. Un mensaje de commit, una variable de CI o un PR no pueden producir nada de esto.
 * `resolve` convierte el commit del nombre (corto o completo) en el completo; si no se resuelve de forma única, no cuenta.
 */
export function approvalsFromRuns(runs: RunRecord[], resolve: (sha: string) => string | null): Approval[] {
  const out: Approval[] = [];
  for (const r of runs) {
    if (r.event !== "workflow_dispatch" || r.conclusion !== "success" || r.headBranch !== PROTECTED_BRANCH) continue;
    const m = RUN_NAME.exec(r.displayTitle);
    if (!m) continue;
    const [, action, environment, shaText] = m;
    if (environment !== "production") continue;
    const services = APPROVING_ACTIONS[action];
    if (!services) continue;
    if ((ORDINARY_PRODUCTION_ACTIONS as readonly string[]).includes(action)) continue;
    if (r.actorPermission !== "admin") continue;
    const sha = resolve(shaText);
    if (!sha) continue;
    out.push({ runId: r.id, action, environment, sha, services, actor: r.actor, at: r.createdAt });
  }
  return out;
}

// ── Huellas protegidas ───────────────────────────────────────────────────────────────────────────────────────────

export interface Fingerprint {
  /** Fichero protegido, o null si el motivo no se puede ligar a un fichero (nunca aprobable: bloqueo seguro). */
  file: string | null;
  reason: string;
  /** Contenido del fichero en el commit de destino («ausente» si se borró). */
  digest: string;
}

/** El motivo empieza por la ruta: «ruta — motivo» o «ruta: motivo». */
export function reasonFile(reason: string): string | null {
  const m = /^([^\s:—][^\s:]*?)(?: — |: )/.exec(reason);
  return m && /[./]/.test(m[1]) ? m[1] : null;
}

/** Cambios protegidos de un servicio entre lo que sirve y el destino, ligados al contenido del destino. */
export function protectedFingerprints(git: GitView, from: string, to: string): { fingerprints: Fingerprint[]; migrations: boolean } {
  const files = git.diffFiles(from, to);
  const reasons = extraordinaryChanges(files, git.diffText(from, to), (f) => git.sqlAt(to, f), { existsInBase: (n) => git.existsIn(from, n) });
  const fingerprints = reasons.map((reason) => {
    const file = reasonFile(reason);
    return { file, reason, digest: file ? (git.blobAt(to, file) ?? "ausente") : `sin-fichero:${reason}` };
  });
  return { fingerprints, migrations: files.some((f) => /(^db\/.*|(^|\/)migrations?\/.*)\.sql$/.test(f) && !/\.down\.sql$/.test(f)) };
}

/**
 * ¿Hay una aprobación del MISMO contenido? Misma huella: el fichero tiene en el commit aprobado exactamente el
 * contenido que tendrá en el destino. Si el fichero se modificó otra vez, el contenido difiere y no cubre nada.
 */
export function isApproved(fp: Fingerprint, approvals: Approval[], git: GitView, environment: string, service: Service): Approval | null {
  // Sin fichero, o un fichero BORRADO (digest «ausente»), nunca se aprueba por igualdad: un borrado protegido exige su decisión.
  if (!fp.file || fp.digest === "ausente") return null;
  for (const a of approvals) {
    if (a.environment !== environment) continue;
    // Una aprobación de código cubre el contenido para los servicios del Core (se construyen del mismo commit exportado):
    // que falte desplegarlo en otro servicio no es una decisión nueva. Se exige que su alcance incluya servicios del Core.
    if (!a.services.some((s) => (ORDINARY_SERVICES as readonly string[]).includes(s)) || !(ORDINARY_SERVICES as readonly string[]).includes(service)) continue;
    if (git.blobAt(a.sha, fp.file) === fp.digest) return a;
  }
  return null;
}

// ── Plan de release por servicio ─────────────────────────────────────────────────────────────────────────────────

export type ServiceState = "al-dia" | "ordinario" | "requiere-aprobacion" | "regresion" | "desconocido";

export interface ServicePlan {
  service: Service;
  active: string | null;
  state: ServiceState;
  /** Cambios protegidos sin aprobación válida. */
  missing: string[];
  /** Cambios protegidos ya cubiertos, con la ejecución que los aprobó. */
  covered: Array<{ reason: string; runId: number; sha: string }>;
  migrations: boolean;
}

export type Decision = "sin-cambios" | "publicar" | "bloqueado-protegido" | "bloqueado-regresion" | "bloqueado-desconocido";

export interface ReleasePlan {
  environment: string;
  target: string;
  services: ServicePlan[];
  decision: Decision;
  migrations: "yes" | "no" | "unknown";
  /** Motivos legibles del bloqueo, para el aviso y el resumen. */
  reasons: string[];
}

/**
 * Decide qué hay que hacer con el commit `target` en un entorno, mirando cada servicio contra SU commit real.
 * - Commit servido desconocido → bloqueo seguro (nunca se infiere ni se supone).
 * - El destino no desciende de lo servido → bloqueo: una publicación vieja no pisa una nueva (vuelta atrás = revertir-*).
 * - Cambios protegidos: solo bloquean los que no tienen una aprobación del mismo contenido.
 * La decisión es de la release entera (todo o nada, con vuelta atrás automática al publicar), pero cada servicio
 * conserva su propio estado, así que un despliegue parcial legítimo no deja el flujo inutilizado.
 */
export function planRelease(input: { environment: string; target: string; active: Record<Service, string | null>; git: GitView; approvals: Approval[] }): ReleasePlan {
  const { environment, target, active, git, approvals } = input;
  const services: ServicePlan[] = [];
  const reasons: string[] = [];
  for (const service of ORDINARY_SERVICES) {
    const cur = active[service] ?? null;
    const base: ServicePlan = { service, active: cur, state: "ordinario", missing: [], covered: [], migrations: false };
    if (!cur) {
      services.push({ ...base, state: "desconocido" });
      reasons.push(`${service}: no se puede verificar qué commit sirve`);
      continue;
    }
    if (cur === target) {
      services.push({ ...base, state: "al-dia" });
      continue;
    }
    if (!git.isAncestor(cur, target)) {
      services.push({ ...base, state: "regresion" });
      reasons.push(`${service}: sirve ${cur.slice(0, 12)}, que no es antecesor de ${target.slice(0, 12)} (una publicación antigua no sustituye a una nueva; para volver atrás, revertir-${service})`);
      continue;
    }
    const { fingerprints, migrations } = protectedFingerprints(git, cur, target);
    const missing: string[] = [];
    const covered: ServicePlan["covered"] = [];
    for (const fp of fingerprints) {
      const a = isApproved(fp, approvals, git, environment, service);
      if (a) covered.push({ reason: fp.reason, runId: a.runId, sha: a.sha });
      else missing.push(fp.reason);
    }
    services.push({ ...base, state: missing.length ? "requiere-aprobacion" : "ordinario", missing, covered, migrations });
    for (const m of missing) reasons.push(`${service}: ${m}`);
  }
  const has = (s: ServiceState) => services.some((x) => x.state === s);
  let decision: Decision;
  if (has("desconocido")) decision = "bloqueado-desconocido";
  else if (has("regresion")) decision = "bloqueado-regresion";
  else if (has("requiere-aprobacion")) decision = "bloqueado-protegido";
  else if (services.every((s) => s.state === "al-dia")) decision = "sin-cambios";
  else decision = "publicar";
  const migrations = has("desconocido") ? "unknown" : services.some((s) => s.migrations) ? "yes" : "no";
  return { environment, target, services, decision, migrations, reasons: Array.from(new Set(reasons)) };
}

export const isBlocked = (d: Decision) => d.startsWith("bloqueado-");

// ── Comprobación estricta de CI ──────────────────────────────────────────────────────────────────────────────────

/**
 * La CI exigida debe estar en `success` para el SHA exacto. Una comprobación ausente, duplicada en otro estado,
 * en curso (conclusion null), cancelada, omitida o fallida NO autoriza publicar. Devuelve los motivos del bloqueo.
 */
export function ciGate(runs: Array<{ name: string; conclusion: string | null }>, required: readonly string[]): string[] {
  const problems: string[] = [];
  for (const name of required) {
    const same = runs.filter((r) => r.name === name);
    if (same.length === 0) problems.push(`«${name}»: sin resultado para este commit`);
    else {
      const bad = same.filter((r) => r.conclusion !== "success");
      if (bad.length) problems.push(`«${name}»: ${bad.map((b) => b.conclusion ?? "pendiente").join(", ")}`);
    }
  }
  return problems;
}

// ── Verificación real y resumen ──────────────────────────────────────────────────────────────────────────────────

export type Verified = "verificado" | "desalineado" | "desconocido";

/** Lo que Railway dice que sirve cada servicio frente al destino. Sin dato fiable: «desconocido», nunca éxito. */
export function verifyRelease(target: string, active: Record<Service, string | null>): Record<Service, Verified> {
  const r = {} as Record<Service, Verified>;
  for (const s of ORDINARY_SERVICES) r[s] = !active[s] ? "desconocido" : active[s] === target ? "verificado" : "desalineado";
  return r;
}

export type EnvOutcome = "publicado-verificado" | "publicado-sin-verificar" | "bloqueado" | "pendiente" | "fallido" | "omitido";

export interface Outcome {
  environment: string;
  outcome: EnvOutcome;
  detail?: string;
}

/** Texto de un resultado, sin ambigüedad: nunca «publicación correcta» si solo se actualizó live. */
export function describeOutcome(o: Outcome): string {
  const label: Record<EnvOutcome, string> = {
    "publicado-verificado": "PUBLICADO y verificado",
    "publicado-sin-verificar": "publicado, SIN verificar",
    bloqueado: "NO PUBLICADO — bloqueado por el procedimiento protegido",
    pendiente: "NO PUBLICADO — pendiente",
    fallido: "NO PUBLICADO — fallido",
    omitido: "NO PUBLICADO — omitido",
  };
  return `${o.environment}: ${label[o.outcome]}${o.detail ? ` (${o.detail})` : ""}`;
}

export function releaseOk(o: Outcome): boolean {
  return o.outcome === "publicado-verificado";
}

/** Resumen estructurado por servicio y entorno (Markdown para GITHUB_STEP_SUMMARY). */
export function renderSummary(args: { target: string; outcomes: Outcome[]; plans?: ReleasePlan[]; verified?: Record<string, Record<Service, Verified>> }): string {
  const L: string[] = [`## Publicación de ${args.target.slice(0, 12)}`, ""];
  for (const o of args.outcomes) L.push(`- **${describeOutcome(o)}**`);
  const live = args.outcomes.find((o) => o.environment === "live");
  const prod = args.outcomes.find((o) => o.environment === "production");
  if (live && prod && releaseOk(live) && !releaseOk(prod)) L.push("", "> Live está publicado, pero **production NO**. No es una publicación satisfactoria de production.");
  for (const p of args.plans ?? []) {
    L.push("", `### ${p.environment}: ${p.decision}`, "", "| Servicio | Sirve | Estado | Pendiente de aprobar | Ya aprobado |", "|---|---|---|---|---|");
    for (const s of p.services) L.push(`| ${s.service} | ${s.active ? s.active.slice(0, 12) : "desconocido"} | ${s.state}${args.verified?.[p.environment]?.[s.service] ? ` · ${args.verified[p.environment][s.service]}` : ""} | ${s.missing.join("; ") || "—"} | ${s.covered.map((c) => `run ${c.runId}`).join(", ") || "—"} |`);
    if (p.reasons.length) L.push("", ...p.reasons.map((r) => `- ${r}`));
  }
  return L.join("\n");
}
