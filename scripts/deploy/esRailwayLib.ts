/**
 * Lógica pura del despliegue de Elephant Source (scripts/deploy/esRailway.ts): qué órdenes de operación se
 * permiten, qué se excluye del export y cuándo un token NO es del proyecto o entorno pedido. Sin red ni secretos.
 */
import { createHash } from "node:crypto";

export interface DeployConfig {
  projectId: string;
  environments: string[];
  services: Record<string, { kind: "core" | "gateway" | "ops" | "crm" | "web" }>;
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
  // Base de medición del Resource Manager (es_erm): idempotente, permisos mínimos y sonda sin restos
  new RegExp(`^${BJ} erm-setup( --apply)?$`),
  // Recursos huérfanos del aprovisionamiento (solo lectura)
  new RegExp(`^${BJ} orphans$`),
  // Revisión de estados comerciales del catálogo por el flujo del CRM (simulación o --apply; nunca precios ni licencias)
  new RegExp(`^${BJ} catalog-review( --apply)?$`),
  // Fichas comerciales en borradores (simulación o --apply; nunca publica, ni precios ni licencias)
  new RegExp(`^${BJ} catalog-commercial-import( --apply)?$`),
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
 * Medición (Resource Manager): el plano de control lee el consumo de la MISMA base del ERM que escribe el Core, por
 * referencia a su variable (sin copiar credenciales). Solo live; en production es una operación protegida aparte.
 */
export function meteringReferences(env: string): Record<string, Record<string, string>> {
  return env === "live" ? { controlplane: { ERM_DATABASE_URL: "${{core.ERM_DATABASE_URL}}" } } : {};
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

/**
 * Correo de ACCESO de las empresas en production (docs/runbooks/CORREO_ACCESO_EMPRESAS.md): solo el servicio `core`,
 * solo las empresas indicadas y solo invitación, restablecimiento y aviso de contraseña cambiada. El plano de control
 * (avisos de prueba y comerciales) se queda en off. El token de Postmark lo pone el propietario en Railway: aquí solo se
 * comprueba que existe, nunca se copia ni se imprime.
 */
export const MAIL_ACCESS_CATEGORIES = "user_invite,password_reset,security_notice";
export const MAIL_ACCESS_SENDING_DOMAIN = "bigelephant.es";
const TENANT_ID_SHAPE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function mailAccessPlan(
  env: string,
  vars: Record<string, Record<string, string>>,
  o: { action: "activar" | "desactivar"; tenants: string[] },
): { changes: MailChange[]; problems: string[] } {
  const problems: string[] = [];
  const changes: MailChange[] = [];
  if (env !== "production") problems.push("el correo de acceso limitado se gestiona solo en production (live usa el sandbox)");
  const core = vars.core ?? {};
  const cp = vars.controlplane ?? {};
  if (o.action === "desactivar") {
    if ((core.MAIL_MODE ?? "off") !== "off") changes.push({ service: "core", name: "MAIL_MODE", value: "off" });
    return { changes, problems };
  }
  const tenants = Array.from(new Set(o.tenants.map((t) => t.trim()).filter(Boolean)));
  if (!tenants.length) problems.push("indica las empresas (ES_ONLY), p. ej. t5-skibox: nunca se activa para todas");
  for (const t of tenants) if (!TENANT_ID_SHAPE.test(t)) problems.push(`identificador de empresa no válido: ${t}`);
  if (tenants.length > 5) problems.push("como máximo 5 empresas por activación");
  if (!(core.POSTMARK_SERVER_TOKEN ?? "").trim()) problems.push("falta POSTMARK_SERVER_TOKEN en core (lo pone el propietario en Railway, como variable sellada)");
  // El plano de control (avisos comerciales y de prueba) nunca en live; off o sandbox (solo buzones propios) se respetan
  if ((cp.MAIL_MODE ?? "off") === "live") problems.push("el plano de control tiene MAIL_MODE=live: los avisos comerciales y de prueba no se activan con el correo de acceso");
  // Orden: primero el ámbito y el proveedor, al final el modo (un fallo a mitad deja el correo como estaba: off)
  const want: Array<[string, string]> = [
    ["MAIL_PROVIDER", "postmark"],
    ["MAIL_SENDING_DOMAIN", MAIL_ACCESS_SENDING_DOMAIN],
    ["MAIL_SCOPE_CATEGORIES", MAIL_ACCESS_CATEGORIES],
    ["MAIL_SCOPE_TENANTS", tenants.join(",")],
    ["MAIL_LIVE_AUTHORIZED", "1"],
    ["MAIL_MODE", "live"],
  ];
  for (const [k, v] of want) if ((core[k] ?? "") !== v) changes.push({ service: "core", name: k, value: v });
  return { changes, problems };
}

/**
 * Avisos INTERNOS de solicitudes web en production (server/crm/leadNotices.ts): solo el plano de control, en modo
 * `sandbox` (solo a los buzones internos indicados), solo la empresa «platform» y solo la categoría
 * `lead_request_notice`. Cualquier otro correo del plano de control (pruebas, pedidos, clientes) sigue sin salir.
 * El token de Postmark es el del servidor de PRODUCTION que ya usa `core` (mismo entorno, nunca el de live).
 */
export const LEAD_NOTICE_CATEGORY = "lead_request_notice";
export const LEAD_NOTICE_CRM_URL = "https://admin.bigelephant.es";
export function leadNoticesMailPlan(
  env: string,
  vars: Record<string, Record<string, string>>,
  o: { action: "activar" | "desactivar"; recipients: string[] },
): { changes: MailChange[]; problems: string[] } {
  const problems: string[] = [];
  const changes: MailChange[] = [];
  if (env !== "production") problems.push("los avisos de solicitudes se gestionan aquí solo en production (live usa el sandbox de pruebas)");
  const cp = vars.controlplane ?? {};
  if (o.action === "desactivar") {
    if ((cp.MAIL_MODE ?? "off") !== "off") changes.push({ service: "controlplane", name: "MAIL_MODE", value: "off" });
    return { changes, problems };
  }
  if (!o.recipients.length) problems.push("indica los buzones internos que reciben los avisos (destinatarios)");
  if ((cp.MAIL_MODE ?? "off") === "live" || cp.MAIL_LIVE_AUTHORIZED === "1") problems.push("el plano de control tiene correo live autorizado: no se toca sin el propietario");
  const scopeTenants = (cp.MAIL_SCOPE_TENANTS ?? "").trim();
  if (scopeTenants && scopeTenants !== "platform") problems.push(`el plano de control tiene otro ámbito de empresas (${scopeTenants}): no se amplía`);
  if (!(cp.POSTMARK_SERVER_TOKEN ?? "").trim()) {
    if ((vars.core?.POSTMARK_SERVER_TOKEN ?? "").trim()) changes.push({ service: "controlplane", name: "POSTMARK_SERVER_TOKEN", copyFrom: "core" });
    else problems.push("falta POSTMARK_SERVER_TOKEN en core y en controlplane (lo pone el propietario desde Postmark)");
  }
  if ((cp.POSTMARK_WEBHOOK_TOKEN ?? "").length < 32) changes.push({ service: "controlplane", name: "POSTMARK_WEBHOOK_TOKEN", generate: true });
  // Orden: ámbito, destinatarios y proveedor primero; el modo al final (un fallo a mitad deja el correo en off)
  const want: Array<[string, string]> = [
    ["MAIL_PROVIDER", "postmark"],
    ["MAIL_SENDING_DOMAIN", MAIL_ACCESS_SENDING_DOMAIN],
    ["MAIL_SCOPE_TENANTS", "platform"],
    ["MAIL_SCOPE_CATEGORIES", LEAD_NOTICE_CATEGORY],
    ["MAIL_SANDBOX_ALLOWLIST", o.recipients.join(",")],
    // Varias solicitudes seguidas no deben quedarse sin aviso por el límite general (8/h por destinatario)
    ["MAIL_RATE_RECIPIENT_PER_HOUR", "30"],
    ["CP_CRM_URL", LEAD_NOTICE_CRM_URL],
    ["MAIL_MODE", "sandbox"],
  ];
  for (const [k, v] of want) if ((cp[k] ?? "") !== v) changes.push({ service: "controlplane", name: k, value: v });
  return { changes, problems };
}

// ── Publicación continua (docs/elephant-source/PROTOCOLO_PUBLICACION.md) ─────────

/** Servicios que publica un despliegue ordinario, en este orden. Nada de copias, restore-drill ni pasarelas de prueba. */
export const ORDINARY_SERVICES = ["controlplane", "core", "core-gateway"] as const;

/** Commit de un despliegue a partir de sus metadatos de Railway (mensaje «<repositorio> <commit>» de `railway up`). */
export function shaFromDeployMeta(meta: unknown, repository: string): string | null {
  const text = typeof meta === "string" ? meta : JSON.stringify(meta ?? {});
  const i = text.indexOf(`${repository} `);
  const m = i >= 0 ? /^[0-9a-f]{40}\b/.exec(text.slice(i + repository.length + 1)) : null;
  return m ? m[0] : null;
}

/**
 * Cambios que un despliegue ORDINARIO de production no puede llevar: migraciones y esquema, infraestructura de
 * construcción (imágenes, dependencias, configuración de compilación) y los interruptores de funciones comerciales
 * bloqueadas. Si aparecen, hay que usar el procedimiento protegido (con aprobación).
 */
export const PROTECTED_PATHS: Array<{ re: RegExp; why: string }> = [
  { re: /^db\//, why: "migraciones o esquema" },
  { re: /^drizzle\//, why: "migraciones o esquema" },
  { re: /(^|\/)migrations?\//, why: "migraciones" },
  { re: /^scripts\/db\//, why: "herramienta de migraciones" },
  { re: /^deploy\//, why: "infraestructura (imágenes y configuración de Railway)" },
  { re: /(^|\/)Dockerfile[^/]*$/, why: "infraestructura (imagen)" },
  { re: /(^|\/)(railway[^/]*\.(toml|json)|nixpacks\.toml|Caddyfile[^/]*)$/, why: "infraestructura" },
  { re: /^server\/mail\/policy\.ts$/, why: "política del correo real" },
  { re: /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|tsconfig[^/]*\.json|vite\.config\.ts|esbuild[^/]*)$/, why: "dependencias o compilación" },
];

/** Interruptores de funciones bloqueadas (cobros, autoservicio, IA y correo real): una línea del diff que los toque es protegida. */
export const LOCKED_SWITCHES = /\b(CP_[A-Z_]*_ENABLED|CP_STRIPE_MODE|MAIL_MODE|MAIL_LIVE_AUTHORIZED|MAIL_SANDBOX_ALLOWLIST|LLM_[A-Z_]+|ES_AI_[A-Z_]+|IMAGE_MODEL|TENANT_MODE)\b/;

export function protectedChanges(files: string[], diff = ""): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hit = PROTECTED_PATHS.find((p) => p.re.test(f));
    if (hit) out.push(`${f} — ${hit.why}`);
  }
  for (const line of diff.split("\n")) {
    if (!/^[+-](?![+-])/.test(line)) continue;
    const m = line.match(LOCKED_SWITCHES);
    if (m) out.push(`cambio en ${m[1]} — funciones bloqueadas`);
  }
  return [...new Set(out)];
}

/** ¿El diff trae migraciones? En live se aplican solas antes de publicar; en production, nunca en un despliegue ordinario. */
export const hasMigrations = (files: string[]) => files.some((f) => /^db\/|(^|\/)migrations?\//.test(f));

/** Comprobaciones funcionales tras publicar. `auth`: credencial de la pasarela de live (secreto del entorno). */
export const FUNCTIONAL_CHECKS: Record<string, Array<{ url: string; expect: number; auth?: boolean }>> = {
  live: [
    { url: "https://cms-prueba-a-20261023.up.railway.app/readyz", expect: 200, auth: true },
    { url: "https://cms-prueba-a-20261023.up.railway.app/", expect: 200, auth: true },
    { url: "https://cms-prueba-a-20261023.up.railway.app/login", expect: 200, auth: true },
    { url: "https://elephant-source-crm-live.up.railway.app/healthz", expect: 200, auth: true },
  ],
  production: [
    { url: "https://app.bigelephant.es/readyz", expect: 200 },
    { url: "https://app.bigelephant.es/", expect: 200 },
    { url: "https://skibox.app.bigelephant.es/readyz", expect: 200 },
    { url: "https://skibox.app.bigelephant.es/login", expect: 200 },
  ],
};

/** Estado de commit que deja live al superar la publicación: production solo publica commits que lo tengan. */
export const LIVE_STATUS_CONTEXT = "elephant-source/live";

// ── CRM en la publicación continua ─────────────────────────────────────────────

/** Comprobaciones funcionales del CRM tras publicarlo (live, tras la pasarela del equipo; production, público). */
export const CRM_CHECKS: Record<string, Array<{ url: string; expect: number; auth?: boolean }>> = {
  live: [{ url: "https://elephant-source-crm-live.up.railway.app/healthz", expect: 200, auth: true }],
  production: [
    { url: "https://admin.bigelephant.es/__gateway/health", expect: 200 },
    { url: "https://admin.bigelephant.es/healthz", expect: 200 },
    { url: "https://admin.bigelephant.es/", expect: 200 },
  ],
};

/** Cambios del CRM que un despliegue ORDINARIO de production no puede llevar: imagen, pasarela, Railway y dependencias. */
export const CRM_PROTECTED_PATHS: Array<{ re: RegExp; why: string }> = [
  { re: /^deploy\//, why: "infraestructura (imagen, pasarela o configuración de Railway)" },
  { re: /(^|\/)(Dockerfile[^/]*|Caddyfile[^/]*|railway[^/]*\.(toml|json)|nixpacks\.toml)$/, why: "infraestructura" },
  { re: /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/, why: "dependencias" },
];
export function crmProtectedChanges(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hit = CRM_PROTECTED_PATHS.find((p) => p.re.test(f));
    if (hit) out.push(`${f} — ${hit.why}`);
  }
  return out;
}

// ── Ordinario frente a extraordinario (orden permanente del propietario, 26/10/2026) ─────────────────────────────
//
// ORDINARIO (production sin aprobación, tras CI y live superados por el mismo commit): código, interfaces, catálogos,
// dependencias, compilación e imágenes (probadas en live, con vuelta atrás automática) y migraciones ADITIVAS (copia y
// verificación de la copia antes; registro y CRM; empresas con canario primero).
// EXTRAORDINARIO (con aprobación del propietario): migraciones destructivas, interruptores de funciones bloqueadas
// (cobros, autoservicio, correo real, IA), la política del correo real y la pasarela de seguridad (quién accede).

/** Ficheros cuyo cambio sigue siendo extraordinario en el Core. */
export const EXTRAORDINARY_PATHS: Array<{ re: RegExp; why: string }> = [{ re: /^server\/mail\/policy\.ts$/, why: "política del correo real" }];

/**
 * ¿Una migración (solo el fichero de subida) borra o reescribe datos o esquema? Aditivo = crear tablas, añadir columnas
 * o índices y datos nuevos. Devuelve el motivo, o null si es aditiva. Ante la duda (sentencia no reconocida), extraordinaria.
 */
export function destructiveMigration(sql: string): string | null {
  const code = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .toUpperCase();
  const rules: Array<[RegExp, string]> = [
    [/\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|TRIGGER|PROCEDURE|FUNCTION)\b/, "borra objetos"],
    [/\bDROP\s+(COLUMN|INDEX|KEY|FOREIGN\s+KEY|PRIMARY\s+KEY|CONSTRAINT|CHECK)\b/, "quita columnas, índices o restricciones"],
    [/\bALTER\s+TABLE\s+\S+\s+DROP\b/, "quita partes de una tabla"],
    [/\bTRUNCATE\b/, "vacía tablas"],
    [/\bDELETE\s+FROM\b/, "borra datos"],
    [/\bUPDATE\s+\S+\s+SET\b/, "reescribe datos"],
    [/\b(MODIFY|CHANGE)\s+(COLUMN\s+)?\S+/, "cambia el tipo o el nombre de columnas"],
    [/\bRENAME\s+(TABLE|COLUMN|TO|AS)\b/, "renombra"],
  ];
  for (const [re, why] of rules) if (re.test(code)) return why;
  for (const stmt of code.split(";").map((s) => s.trim()).filter(Boolean)) {
    if (!/^(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)|ALTER\s+TABLE\s+\S+\s+(ADD|ALTER\s+COLUMN\s+\S+\s+SET\s+DEFAULT)|INSERT\s+INTO|SET\s|SELECT\b)/.test(stmt)) return `sentencia no reconocida como aditiva: ${stmt.slice(0, 60)}`;
  }
  return null;
}

/** Ficheros de migración de SUBIDA (los `.down.sql` no se aplican al publicar). */
export const migrationUpFiles = (files: string[]) => files.filter((f) => /(^db\/.*|(^|\/)migrations?\/.*)\.sql$/.test(f) && !/\.down\.sql$/.test(f) && !/(^|\/)README/i.test(f) && !/(^|\/)baseline\//.test(f));

/**
 * Lo que un despliegue de production del Core NO puede publicar por sí solo. `sqlOf` lee el contenido de una migración en
 * el commit de destino (null si se borró: borrar una migración es extraordinario).
 */
export function extraordinaryChanges(files: string[], diff: string, sqlOf: (file: string) => string | null): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hit = EXTRAORDINARY_PATHS.find((p) => p.re.test(f));
    if (hit) out.push(`${f} — ${hit.why}`);
  }
  for (const f of migrationUpFiles(files)) {
    const sql = sqlOf(f);
    const why = sql === null ? "migración borrada" : destructiveMigration(sql);
    if (why) out.push(`${f} — migración no aditiva (${why})`);
  }
  // Solo el código que se ejecuta: un comentario o un documento que mencionen un interruptor no lo cambian
  out.push(...coreLockedChanges(diff));
  return [...new Set(out)];
}

/** CRM y web: extraordinario solo la pasarela de seguridad (Caddyfile: quién accede y qué es público). */
export const EXTERNAL_EXTRAORDINARY_PATHS: Array<{ re: RegExp; why: string }> = [{ re: /(^|\/)Caddyfile[^/]*$/, why: "pasarela de seguridad (accesos y rutas públicas)" }];
export function externalExtraordinaryChanges(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hit = EXTERNAL_EXTRAORDINARY_PATHS.find((p) => p.re.test(f));
    if (hit) out.push(`${f} — ${hit.why}`);
  }
  return out;
}

/**
 * Acciones de production que no cambian nada sensible (solo lectura, copias o revisiones auditadas y reversibles): van
 * por el entorno de despliegue ordinario, sin aprobación. El resto (variables, secretos, almacenamiento, correo real,
 * aplicar a mano migraciones o restauraciones) sigue en el entorno protegido.
 */
export const ORDINARY_PRODUCTION_ACTIONS = [
  "publicar",
  "estado",
  "verificar-token",
  "comprobar-salud",
  "diagnostico-almacenamiento",
  "copia-de-seguridad",
  "verificar-copia",
  "migraciones-plataforma-simulacion",
  "migraciones-simulacion",
  "verificar-migraciones",
  "huerfanos",
  "correo-acceso-estado",
  "avisos-solicitudes-estado",
  "medicion-comprobar",
  "catalogo-revision",
  "catalogo-revision-aplicar",
  "catalogo-fichas",
  "catalogo-fichas-aplicar",
] as const;

/** Estado que deja live con el commit del CRM que ha superado live (production solo publica ese). */
export const CRM_LIVE_STATUS_CONTEXT = "elephant-source/crm-live";
export const crmLiveStatusDescription = (sha: string) => `crm ${sha}`;
export function crmShaFromStatus(description: string | null | undefined): string | null {
  const m = /^crm ([0-9a-f]{40})$/.exec((description ?? "").trim());
  return m ? m[1] : null;
}

// ── Web comercial en la publicación continua (mismo modelo que el CRM) ──────────

/** Rama del repositorio bigelephant-web que se publica (la de los despliegues de production hasta ahora). */
export const WEB_BRANCH = "feat/elephant-web-portfolio";

/**
 * Comprobaciones de la web comercial tras publicarla. Desde el 25/10/2026 la web es pública SOLO en el dominio
 * público (www.bigelephant.es); en los dominios de Railway sigue la contraseña de la pasarela salvo la salud y las
 * páginas de vuelta del pago. Se comprueban rutas abiertas antes y después de ese cambio, para que publicar una
 * versión anterior o la nueva no dispare una vuelta atrás.
 */
export const WEB_CHECKS: Record<string, Array<{ url: string; expect: number; auth?: boolean }>> = {
  live: [
    { url: "https://elephant-source-web-live.up.railway.app/__gateway/health", expect: 200 },
    { url: "https://elephant-source-web-live.up.railway.app/contratacion/estado", expect: 200 },
  ],
  production: [
    { url: "https://www.bigelephant.es/", expect: 200 },
    { url: "https://elephant-source-web.up.railway.app/contratacion/estado", expect: 200 },
  ],
};

export const WEB_LIVE_STATUS_CONTEXT = "elephant-source/web-live";

/**
 * Catálogo publicado que la web toma AL COMPILARSE. Su versión se escribe en el export (`CATALOG_STAMP_FILE`) antes de
 * subirlo: así la capa `RUN pnpm build` de la imagen solo se reutiliza si el catálogo no ha cambiado (sin esto, un
 * cambio de estado o de precio publicado desde el CRM no llegaba a la web hasta el siguiente cambio de código).
 */
export const WEB_CATALOG_SITE: Record<string, string> = {
  live: "https://elephant-source-web-live.up.railway.app/cp/v1/public/site",
  production: "https://www.bigelephant.es/cp/v1/public/site",
};
export const CATALOG_STAMP_FILE = "catalog-version.txt";

/** Servicios de otros repositorios que la publicación continua despliega por su commit verificado. */
export type ExternalService = "crm" | "web";
export const isExternalService = (s: string): s is ExternalService => s === "crm" || s === "web";
/** Mismas reglas para los dos: imagen, pasarela, Railway y dependencias exigen el procedimiento protegido. */
export const externalProtectedChanges = (files: string[]) => crmProtectedChanges(files);

/** Interruptores bloqueados en los repositorios externos (web y CRM): checkout, autoservicio, Stripe y la pasarela. */
export const EXTERNAL_LOCKED_SWITCHES = /\b(?:VITE_)?(?:PUBLIC_CHECKOUT_ENABLED|CHECKOUT_ENABLED|SELF_SERVICE[A-Z_]*|STRIPE_[A-Z_]+|GATEWAY_(?:USER|PASSWORD[A-Z_]*)|POSTMARK_WEBHOOK_PUBLIC|STRIPE_WEBHOOK_PUBLIC)\b/;

/**
 * Dominio de plataforma de LIVE (subdominios automáticos de las empresas de prueba): un comodín propio
 * `*.<dominio>` en la pasarela compartida core-gateway, como `*.app.bigelephant.es` en production. Railway no enruta
 * subdominios arbitrarios de `up.railway.app` (cada uno exige un servicio), así que ese dominio no sirve para altas.
 * Solo subdominios de bigelephant.es que no sean los de production ni corporativos.
 */
export const LIVE_PLATFORM_DOMAIN_DEFAULT = "live.bigelephant.es";
export function livePlatformDomainProblems(env: string, domain: string): string[] {
  const p: string[] = [];
  if (env !== "live") p.push("el dominio de plataforma de pruebas solo se prepara en live (production ya tiene *.app.bigelephant.es)");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bigelephant\.es$/.test(domain)) p.push(`«${domain}» debe ser <etiqueta>.bigelephant.es`);
  if (["app.bigelephant.es", "www.bigelephant.es", "admin.bigelephant.es", "api.bigelephant.es", "mail.bigelephant.es"].includes(domain)) p.push(`«${domain}» es un dominio de production o corporativo`);
  return p;
}
/** Valor de CP_PLATFORM_DOMAINS: el comodín nuevo primero (altas nuevas) y los anteriores después (transición). */
export function platformDomainsValue(domain: string, current: string | undefined): string {
  const rest = (current ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x && x !== domain);
  return [domain, ...rest].join(",");
}

/**
 * Medición del Resource Manager (base `es_erm`, como live desde el 21/10/2026). Todo por REFERENCIA: la contraseña del
 * usuario `es_erm` vive solo en `MySQL.ES_ERM_PASSWORD` (generada si falta; nunca se imprime ni se copia).
 *  - restore-drill: `ES_ERM_PASSWORD` → la usa `backup-job erm-setup` para crear o ajustar el usuario;
 *  - core: `ERM_DATABASE_URL` (escribe el consumo);
 *  - controlplane: la misma URL por referencia al core (lee el consumo: Resource Manager y costes).
 */
export const ERM_PASSWORD_VAR = "ES_ERM_PASSWORD";
export const ERM_DB_SERVICE = "MySQL";
const ermRef = (service: string, name: string) => "${{" + service + "." + name + "}}";
export function ermUrlTemplate(hostVar: string, portVar: string): string {
  return `mysql://es_erm:${ermRef(ERM_DB_SERVICE, ERM_PASSWORD_VAR)}@${ermRef(ERM_DB_SERVICE, hostVar)}:${ermRef(ERM_DB_SERVICE, portVar)}/es_erm`;
}
/** Variables por servicio (sin valores en claro). `coreCurrent`: la URL actual del core, que se respeta si ya existe. */
export function meteringPlan(hostVar: string, portVar: string, coreCurrent?: string): Record<string, Record<string, string>> {
  return {
    "restore-drill": { [ERM_PASSWORD_VAR]: ermRef(ERM_DB_SERVICE, ERM_PASSWORD_VAR) },
    core: { ERM_DATABASE_URL: coreCurrent || ermUrlTemplate(hostVar, portVar) },
    controlplane: { ERM_DATABASE_URL: ermRef("core", "ERM_DATABASE_URL") },
  };
}

// ── Clasificación por cambios EFECTIVOS (docs/elephant-source/AUTONOMIA_DESPLIEGUES.md) ───────────────────────────
//
// Un despliegue no se vuelve extraordinario porque un comentario, un documento o una prueba mencionen un interruptor:
// solo cuenta el código que se ejecuta. Se descartan documentación, pruebas y e2e; en cada línea cambiada se quitan los
// comentarios (con las cadenas respetadas: lo que va dentro de una cadena sí cuenta). Ante la duda, cuenta como código.

/** Ficheros que no se ejecutan en el servicio: documentación, imágenes, pruebas, e2e y ejemplos de variables. */
const NON_EFFECTIVE = /(^|\/)(docs?|e2e|__tests__)\/|\.(md|mdx|txt|png|jpe?g|gif|svg|webp|ico|pdf)$|\.(test|spec|e2e)\.[cm]?[jt]sx?$|(^|\/)\.?env\.example$/i;
const HASH_COMMENTS = /(^|\/)(Caddyfile[^/]*|Dockerfile[^/]*|[^/]*\.(ya?ml|toml|sh|conf)|\.env[^/]*)$/i;

/** Línea sin comentarios. `lang` js (por defecto): //, /* *\/ y continuaciones de JSDoc; hash: #; html: <!-- -->. */
export function codeOfLine(line: string, lang: "js" | "hash" | "html" = "js"): string {
  if (lang === "html") return line.replace(/<!--[\s\S]*?(-->|$)/g, "");
  const t = line.trim();
  // Continuación de un bloque de comentario (JSDoc): solo cuenta lo que haya tras su cierre
  if (lang === "js" && (t.startsWith("*") || t.startsWith("/*"))) {
    const end = line.indexOf("*/");
    if (end < 0) return "";
    line = line.slice(end + 2);
  }
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      out += line.slice(i, i + 2);
      i++;
      continue;
    }
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || (lang === "js" && c === "`")) {
      quote = c;
      out += c;
      continue;
    }
    if (lang === "hash" && c === "#") break;
    if (lang === "js" && c === "/" && line[i + 1] === "/") break;
    if (lang === "js" && c === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Líneas añadidas o quitadas de un diff unificado, con su fichero y sin comentarios; sin los ficheros que no se
 * ejecutan. Un diff sin cabeceras (fragmento suelto) se trata como código.
 */
export function effectiveChangedLines(diff: string): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = [];
  let file = "";
  for (const line of diff.split("\n")) {
    const h = /^diff --git a\/\S+ b\/(\S+)/.exec(line);
    if (h) {
      file = h[1];
      continue;
    }
    if (/^(\+\+\+|---) /.test(line)) continue;
    if (!/^[+-]/.test(line) || NON_EFFECTIVE.test(file)) continue;
    const lang = HASH_COMMENTS.test(file) ? "hash" : /\.html?$/i.test(file) ? "html" : "js";
    const code = codeOfLine(line.slice(1), lang);
    if (code.trim()) out.push({ file, code });
  }
  return out;
}

/** Ficheros de configuración del CRM o la web donde un interruptor cuenta en cualquier parte del código (no solo leído). */
const EXTERNAL_CONFIG_FILES = /(^|\/)(\.env[^/]*|vite\.config\.[cm]?[jt]s|Dockerfile[^/]*|railway[^/]*\.(json|toml)|nixpacks\.toml|index\.html)$/i;
const ENV_READ = /(?:import\.meta\.env|process\.env|\benv)\s*(?:\.\s*|\[\s*["'`])([A-Z][A-Z0-9_]*)/g;

/**
 * Interruptores de funciones bloqueadas (cobros, autoservicio, Stripe, accesos de la pasarela) que un cambio del CRM o
 * de la web toca DE VERDAD: una lectura de variable en el código (`import.meta.env.X`, `process.env.X`, `env.X`) o
 * el nombre en un fichero de configuración (variables, compilación, imagen). Un comentario, una constante con un
 * nombre parecido (p. ej. `STRIPE_LIVE_PROVIDER`) o un texto no lo son. La pasarela (Caddyfile) ya es extraordinaria.
 */
export function externalLockedChanges(diff: string): string[] {
  const out = new Set<string>();
  const anywhere = new RegExp(EXTERNAL_LOCKED_SWITCHES.source, "g");
  for (const { file, code } of effectiveChangedLines(diff)) {
    if (EXTERNAL_CONFIG_FILES.test(file)) {
      for (const m of code.matchAll(anywhere)) out.add(`${file}: cambio en ${m[0]} — funciones bloqueadas`);
      continue;
    }
    for (const m of code.matchAll(ENV_READ)) if (EXTERNAL_LOCKED_SWITCHES.test(m[1])) out.add(`${file}: lectura de ${m[1]} — funciones bloqueadas`);
  }
  return Array.from(out);
}

/** Interruptores del Core tocados en código efectivo (sin comentarios): cualquier aparición en código o en cadenas. */
export function coreLockedChanges(diff: string): string[] {
  const out = new Set<string>();
  for (const { file, code } of effectiveChangedLines(diff)) {
    const m = code.match(LOCKED_SWITCHES);
    if (m) out.add(`${file ? `${file}: ` : ""}cambio en ${m[1]} — funciones bloqueadas`);
  }
  return Array.from(out);
}

/**
 * Commit del CRM sellado en cada despliegue (se sirve como fichero estático): tras publicar se comprueba que el dominio
 * REAL sirve ese commit; si no, vuelta atrás.
 */
export const CRM_VERSION_FILE = "public/version.txt";
export const CRM_VERSION_URL: Record<string, { url: string; auth?: boolean }> = {
  live: { url: "https://elephant-source-crm-live.up.railway.app/version.txt", auth: true },
  production: { url: "https://admin.bigelephant.es/version.txt" },
};
