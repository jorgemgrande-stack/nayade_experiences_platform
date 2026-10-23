/**
 * Lógica pura del despliegue de Elephant Source (scripts/deploy/esRailway.ts): qué órdenes de operación se
 * permiten, qué se excluye del export y cuándo un token NO es del proyecto o entorno pedido. Sin red ni secretos.
 */
import { createHash } from "node:crypto";

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
  // Migraciones de plataforma con el paquete auditado de la imagen (sin --database: nunca otra base)
  /^node \.mig\/run\.cjs registry (plan|apply)$/,
  /^node \.mig\/run\.cjs crm (status|plan|apply)$/,
  // Prueba de restauración: restaura la copia de UNA empresa en una base NUEVA y la verifica; sin --switch, la base real
  // no se toca (autorizado por el propietario el 23/10/2026)
  /^node dist-cp\/backup-job\.js restore-tenant [a-z0-9][a-z0-9-]{1,62} --apply$/,
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

/** Variables de almacenamiento que el diagnóstico describe (copias, destino secundario y ficheros). */
export const STORAGE_VARS = [
  "BACKUP_STORAGE",
  ...["", "SECONDARY_"].flatMap((p) => ["ENDPOINT", "BUCKET", "REGION", "PREFIX", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY"].map((k) => `BACKUP_${p}S3_${k}`)),
  ...["ENDPOINT", "BUCKET", "REGION", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY"].map((k) => `S3_${k}`),
];

/**
 * Describe una variable de almacenamiento SIN revelar secretos. Las claves (ACCESS_KEY, SECRET_KEY) solo dicen si
 * son una referencia de Railway (`${{Servicio.VAR}}`, se renueva sola) o un valor fijo, más una huella de 8
 * caracteres del valor efectivo para comparar servicios. El resto (endpoint, bucket, región…) se muestra tal cual.
 */
export function describeStorageVar(name: string, unrendered: string | undefined, rendered: string | undefined): string {
  if (!unrendered) return "—";
  const isRef = /^\s*(\$\{\{[^}]+\}\}\s*)+$/.test(unrendered);
  if (/(ACCESS|SECRET)_KEY$/.test(name)) {
    const print = rendered ? ` · huella ${createHash("sha256").update(rendered).digest("hex").slice(0, 8)}` : "";
    return isRef ? `referencia ${unrendered.trim()}${print}` : `valor fijo${print}`;
  }
  return isRef ? `referencia ${unrendered.trim()} → ${rendered ?? "?"}` : unrendered;
}

/**
 * Almacenamiento de live como REFERENCIAS de Railway a sus buckets (se renuevan solas si se rota una clave), en lugar de
 * valores fijos copiados a mano. Copias: bucket `es-live-backups`; ficheros de las empresas: `es-live-media`.
 * Solo live: production tiene sus propios buckets y su propia aprobación.
 */
const ref = (bucket: string, v: string) => `\${{${bucket}.${v}}}`;
const s3Refs = (prefix: string, bucket: string): Record<string, string> => ({
  [`${prefix}ENDPOINT`]: ref(bucket, "ENDPOINT"),
  [`${prefix}BUCKET`]: ref(bucket, "BUCKET"),
  [`${prefix}REGION`]: ref(bucket, "REGION"),
  [`${prefix}ACCESS_KEY`]: ref(bucket, "ACCESS_KEY_ID"),
  [`${prefix}SECRET_KEY`]: ref(bucket, "SECRET_ACCESS_KEY"),
});
export const STORAGE_BUCKETS: Record<string, { backups: string; media: string }> = {
  live: { backups: "es-live-backups", media: "es-live-media" },
  // Production (autorizado por el propietario el 23/10/2026)
  production: { backups: "elephant-source-backups", media: "elephant-source-media" },
};
export function storageReferences(env: string): Record<string, Record<string, string>> {
  const b = STORAGE_BUCKETS[env];
  if (!b) throw new Error(`sin buckets definidos para el entorno «${env}»`);
  const ops = {
    "backup-job": { ...s3Refs("BACKUP_S3_", b.backups), ...s3Refs("S3_", b.media) },
    "restore-drill": { ...s3Refs("BACKUP_S3_", b.backups), ...s3Refs("S3_", b.media) },
  };
  // Production: también el Core desde el 23/10/2026 (autorizado: sus claves de ficheros eran incorrectas)
  return { ...ops, core: s3Refs("S3_", b.media) };
}

/**
 * Pasarelas de las empresas de PRUEBA de live: Railway da un dominio por servicio y el Core elige la empresa por el
 * host, así que cada empresa de prueba usa una pasarela propia de live (`gw-prueba-a`, `gw-prueba-b`; autorizadas por el
 * propietario el 23/10/2026) con el dominio `<empresa>.up.railway.app`. Solo identificadores de empresas de prueba;
 * nunca dominios comerciales.
 */
export const TEST_TENANT_GATEWAYS = ["gw-prueba-a", "gw-prueba-b"] as const;
/** Pasarela de referencia de live: de ella se copian la construcción y estas variables (nunca PUBLIC_HOSTS: siguen protegidas). */
export const GATEWAY_TEMPLATE_SERVICE = "core-gateway";
export const GATEWAY_COPIED_VARS = ["GATEWAY_USER", "GATEWAY_PASSWORD_HASH", "UPSTREAM"] as const;
export const TEST_TENANT_RE = /^cms-prueba-[ab]-\d{8}$/;
export function testTenantDomains(env: string, only: string): Array<{ service: string; tenantId: string; domain: string }> {
  if (env !== "live") throw new Error("las pasarelas de prueba solo existen en live");
  const ids = only.split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.length !== TEST_TENANT_GATEWAYS.length) throw new Error(`hacen falta ${TEST_TENANT_GATEWAYS.length} empresas de prueba (only)`);
  for (const id of ids) if (!TEST_TENANT_RE.test(id)) throw new Error(`no es una empresa de prueba: ${id}`);
  if (new Set(ids).size !== ids.length) throw new Error("empresas repetidas");
  return ids.map((tenantId, i) => ({ service: TEST_TENANT_GATEWAYS[i], tenantId, domain: `${tenantId}.up.railway.app` }));
}

/** Quita del registro cualquier cosa con forma de DSN, clave o token antes de mostrarlo. */
export const scrub = (s: string) =>
  s
    .replace(/mysql:\/\/[^\s"']+/g, "mysql://***")
    .replace(/(sk|rk|whsec|pk)_(live|test)_[A-Za-z0-9]+/g, "***")
    .replace(/(token|password|secret|key)=([^\s&"']+)/gi, "$1=***");


/**
 * Correo de PRUEBAS en live con Postmark (autorizado por el propietario el 23/10/2026): MAIL_MODE=sandbox, que solo
 * entrega a la lista de destinatarios autorizados. Nunca en production (allí MAIL_MODE sigue en off).
 */
export const MAIL_TEST_SERVICES = ["controlplane", "core"] as const;
export const MAIL_SENDING_DOMAIN_LIVE = "bigelephant.es";
const ALLOW_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Destinatarios de prueba: direcciones completas (sin dominios enteros ni comodines), entre 1 y 10. */
export function parseMailAllowlist(raw: string): string[] {
  const list = raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.length > 10) throw new Error("la lista de destinatarios de prueba debe tener entre 1 y 10 direcciones");
  for (const a of list) if (!ALLOW_EMAIL.test(a)) throw new Error(`no es una dirección de correo completa: ${a}`);
  return Array.from(new Set(list));
}

export type MailChange = { service: string; name: string; value?: string; generate?: true; copyFrom?: string };

/** Qué hay que poner en cada servicio para el sandbox; sin token de Postmark en ningún servicio, no se puede (acción humana). */
export function mailSandboxPlan(env: string, vars: Record<string, Record<string, string>>, allow: string[]): { changes: MailChange[]; problems: string[] } {
  const problems: string[] = [];
  if (env !== "live") problems.push("el correo de pruebas solo se configura en live (production sigue en off)");
  const has = (s: string, k: string) => !!(vars[s]?.[k] ?? "").trim();
  const tokenAt = MAIL_TEST_SERVICES.filter((s) => has(s, "POSTMARK_SERVER_TOKEN"));
  if (!tokenAt.length) problems.push("falta POSTMARK_SERVER_TOKEN en controlplane y core (lo pone el propietario desde Postmark)");
  const changes: MailChange[] = [];
  for (const s of MAIL_TEST_SERVICES) {
    if (!has(s, "POSTMARK_SERVER_TOKEN") && tokenAt.length) changes.push({ service: s, name: "POSTMARK_SERVER_TOKEN", copyFrom: tokenAt[0] });
    // En el sandbox de pruebas la batería completa (≈80 correos) va a 1-10 buzones propios: el límite por destinatario
    // de producción (8/h) la retendría. Solo aquí; en production no se toca.
    const want: Record<string, string> = { MAIL_PROVIDER: "postmark", MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: MAIL_SENDING_DOMAIN_LIVE, MAIL_SANDBOX_ALLOWLIST: allow.join(","), MAIL_RATE_RECIPIENT_PER_HOUR: "200" };
    for (const [k, v] of Object.entries(want)) if ((vars[s]?.[k] ?? "") !== v) changes.push({ service: s, name: k, value: v });
    if ((vars[s]?.MAIL_LIVE_AUTHORIZED ?? "") === "1") problems.push(`${s} tiene MAIL_LIVE_AUTHORIZED=1: no se toca sin el propietario`);
  }
  if ((vars.controlplane?.POSTMARK_WEBHOOK_TOKEN ?? "").length < 32) changes.push({ service: "controlplane", name: "POSTMARK_WEBHOOK_TOKEN", generate: true });
  if ((vars.crm?.POSTMARK_WEBHOOK_PUBLIC ?? "") !== "1") changes.push({ service: "crm", name: "POSTMARK_WEBHOOK_PUBLIC", value: "1" });
  return { changes, problems };
}

/** Eventos del webhook de Postmark (sin aperturas ni clics: no se hace seguimiento). */
export const POSTMARK_WEBHOOK_TRIGGERS = {
  Open: { Enabled: false },
  Click: { Enabled: false },
  Delivery: { Enabled: true },
  Bounce: { Enabled: true, IncludeContent: false },
  SpamComplaint: { Enabled: true, IncludeContent: false },
  SubscriptionChange: { Enabled: true },
};
