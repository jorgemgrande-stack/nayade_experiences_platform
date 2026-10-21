/**
 * Lógica pura del despliegue de Elephant Source (scripts/deploy/esRailway.ts): qué órdenes de operación se
 * permiten, qué se excluye del export y cuándo un token NO es del proyecto o entorno pedido. Sin red ni secretos.
 */
export interface DeployConfig {
  projectId: string;
  environments: string[];
  services: Record<string, { kind: "core" | "gateway" | "ops" }>;
}


const BJ = "node dist-cp/backup-job.js";
const ONLY = "( --only [a-z0-9][a-z0-9-]{1,62}(,[a-z0-9][a-z0-9-]{1,62})*)?";
/** Órdenes de operación que el flujo puede lanzar en restore-drill (nada de restauraciones ni retención). */
export const DRILL_ALLOWED: RegExp[] = [
  new RegExp(`^${BJ} run${ONLY}$`),
  new RegExp(`^${BJ} list$`),
  new RegExp(`^${BJ} migrate-tenants${ONLY}$`),
  new RegExp(`^${BJ} migrate-tenants${ONLY} --apply$`),
  new RegExp(`^${BJ} check-data-exports${ONLY}$`),
];
export const isAllowedDrill = (cmd: string) => DRILL_ALLOWED.some((r) => r.test(cmd.trim()));
export const DRILL_IDLE = `${BJ} list`;

/** Ficheros que NO van al servicio: la configuración de Railway de Náyade (raíz) y datos de semilla. */
export const EXCLUDED_FROM_EXPORT = ["railway.toml", "data/seed.json"];

export interface TokenScope {
  projectId: string;
  environmentId: string;
  environmentName: string;
  services: string[];
}

/** Decide si se puede actuar: proyecto y entorno exactos, y servicio conocido y existente. */
export function guard(cfg: DeployConfig, scope: TokenScope, want: { env: string; service?: string }): string[] {
  const out: string[] = [];
  if (scope.projectId !== cfg.projectId) out.push("el token no es del proyecto de Elephant Source");
  if (!cfg.environments.includes(want.env)) out.push(`entorno no admitido: ${want.env}`);
  if (scope.environmentName !== want.env) out.push(`el token es del entorno «${scope.environmentName}», no de «${want.env}»`);
  if (want.service) {
    if (!cfg.services[want.service]) out.push(`servicio no admitido: ${want.service}`);
    else if (!scope.services.includes(want.service)) out.push(`el servicio ${want.service} no existe en el entorno`);
  }
  return out;
}

/** Quita del registro cualquier cosa con forma de DSN, clave o token antes de mostrarlo. */
export const scrub = (s: string) =>
  s
    .replace(/mysql:\/\/[^\s"']+/g, "mysql://***")
    .replace(/(sk|rk|whsec|pk)_(live|test)_[A-Za-z0-9]+/g, "***")
    .replace(/(token|password|secret|key)=([^\s&"']+)/gi, "$1=***");

