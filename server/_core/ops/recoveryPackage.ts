/**
 * Paquete de configuración para recuperación (SIN secretos), generado por el trabajo de copia en
 * cada ejecución y guardado, cifrado, en cada destino de copias:
 *
 *   recovery/latest.json.enc                       el más reciente (se sobrescribe)
 *   recovery/<AAAA>/<MM>/<AAAAMMDD>.json.enc       uno por día (el último del día)
 *
 * Contiene lo necesario para reconstruir la plataforma desde cero junto con los secretos de la
 * carpeta privada del propietario: servicios y su imagen, NOMBRES de las variables que necesita cada
 * uno (nunca valores secretos), commit desplegado (si se informa), identificadores públicos de Railway,
 * servidores MySQL (alias/host/puerto/nombre de la variable de administración), empresas con su
 * estado, base, servidor, dominios y la ubicación de su última copia en cada destino, y el orden de
 * restauración.
 *
 * Garantía: `assertNoSecrets` rechaza el paquete si contiene el valor de cualquier variable sensible
 * del entorno, una URL con credenciales o material de clave reconocible. El paquete va cifrado con la
 * clave de copias (AAD `recovery:platform`) porque revela la topología.
 */
import type { TenantRegistryReader } from "../tenantRegistry/store";
import type { Keyring } from "./backupCrypto";
import { decryptBuffer, encryptBuffer } from "./backupCrypto";
import type { BackupStorage } from "./backupStorage";
import { parseDatabaseServers } from "../provisioning/servers";

export const RECOVERY_AAD = "recovery:platform";
export const RECOVERY_LATEST_KEY = "recovery/latest.json.enc";
export const recoveryDatedKey = (at: number) => {
  const iso = new Date(at).toISOString();
  return `recovery/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(0, 10).replace(/-/g, "")}.json.enc`;
};

/** Servicios del proyecto «Elephant Source» (docs/runbooks/RAILWAY_ELEPHANT_SOURCE.md) y sus variables. */
export const SERVICE_CATALOG: ReadonlyArray<{
  service: string;
  repo: string;
  dockerfilePath: string;
  start?: string;
  cron?: string;
  healthcheck?: string;
  required: string[];
  optional: string[];
}> = [
  {
    service: "core",
    repo: "nayade_experiences_platform",
    dockerfilePath: "deploy/railway/core.Dockerfile",
    healthcheck: "/healthz",
    required: ["NODE_ENV", "TENANT_MODE", "REGISTRY_DATABASE_URL", "REGISTRY_KEYS", "REGISTRY_ACTIVE_KEY_ID", "INTEGRATION_KEYS", "INTEGRATION_ACTIVE_KEY_ID", "JWT_SECRET", "EMAIL_ENCRYPTION_KEY", "LOCAL_AUTH"],
    optional: ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_REGION", "TENANT_LEGACY_STORAGE_TENANT", "SUPPORT_JWT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"],
  },
  {
    service: "controlplane",
    repo: "nayade_experiences_platform",
    dockerfilePath: "Dockerfile.controlplane",
    start: "node dist-cp/main.js",
    healthcheck: "/healthz",
    required: ["CP_TOKENS", "REGISTRY_ADMIN_DATABASE_URL", "REGISTRY_KEYS", "REGISTRY_ACTIVE_KEY_ID", "CRM_DATABASE_URL", "CP_PLATFORM_DOMAIN"],
    optional: [
      "CP_PLATFORM_TARGET", "CP_ALLOWED_ORIGINS", "CP_TRUST_PROXY", "CP_SESSION_SECRET", "PROVISIONING_DB_ADMIN_URL", "PROVISIONING_DB_SERVERS",
      "ERM_DATABASE_URL", "BILLING_DATABASE_URL", "CP_ALERT_WEBHOOK", "CP_ALERTS_EVERY_SECONDS", "BACKUP_MAX_AGE_HOURS", "BACKUP_SECONDARY_MAX_AGE_HOURS",
      "SUPPORT_JWT_SECRET", "CP_PUBLIC_ORIGINS", "CP_PUBLIC_FORM_SECRET",
    ],
  },
  {
    service: "backup-job",
    repo: "nayade_experiences_platform",
    dockerfilePath: "Dockerfile.controlplane",
    start: "node dist-cp/backup-job.js run",
    cron: "*/15 * * * *",
    required: ["REGISTRY_ADMIN_DATABASE_URL", "REGISTRY_KEYS", "REGISTRY_ACTIVE_KEY_ID", "BACKUP_KEYS", "BACKUP_ACTIVE_KEY_ID", "BACKUP_STORAGE", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY", "BACKUP_S3_SECRET_KEY"],
    optional: [
      "BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_PREFIX", "BACKUP_S3_FORCE_PATH_STYLE", "CRM_DATABASE_URL", "BACKUP_MEDIA", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_ENDPOINT",
      "BACKUP_APPLY_RETENTION", "BACKUP_KEEP_DAILY", "BACKUP_KEEP_WEEKLY", "BACKUP_KEEP_MONTHLY",
      "BACKUP_SECONDARY_STORAGE", "BACKUP_SECONDARY_S3_BUCKET", "BACKUP_SECONDARY_S3_ACCESS_KEY", "BACKUP_SECONDARY_S3_SECRET_KEY", "BACKUP_SECONDARY_S3_ENDPOINT",
      "BACKUP_SECONDARY_S3_REGION", "BACKUP_SECONDARY_S3_PREFIX", "BACKUP_SECONDARY_TIMEOUT_SECONDS", "BACKUP_SECONDARY_APPLY_RETENTION",
      "BACKUP_SECONDARY_KEEP_DAILY", "BACKUP_SECONDARY_KEEP_WEEKLY", "BACKUP_SECONDARY_KEEP_MONTHLY", "PROVISIONING_DB_SERVERS", "PROVISIONING_DB_ADMIN_URL", "ES_DEPLOY_COMMIT",
    ],
  },
  { service: "crm", repo: "big-elephant-crm", dockerfilePath: "deploy/railway/Dockerfile", required: [], optional: [] },
  { service: "web", repo: "bigelephant-web", dockerfilePath: "deploy/railway/Dockerfile", required: [], optional: [] },
  {
    service: "pasarelas (web, crm, core-gateway, gw-<empresa>)",
    repo: "nayade_experiences_platform",
    dockerfilePath: "deploy/railway/gateway/Dockerfile",
    healthcheck: "/__gateway/health",
    required: ["UPSTREAM", "GATEWAY_USER", "GATEWAY_PASSWORD_HASH"],
    optional: ["PORT"],
  },
];

/** Variables cuyo VALOR no es secreto y puede figurar en el paquete. */
const PUBLIC_VALUE_VARS = [
  "RAILWAY_PROJECT_ID", "RAILWAY_PROJECT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_SERVICE_ID",
  "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID", "RAILWAY_REPLICA_REGION", "RAILWAY_GIT_COMMIT_SHA", "ES_DEPLOY_COMMIT",
];

const SENSITIVE_NAME = /(KEY|KEYS|SECRET|PASS|PASSWORD|TOKEN|TOKENS|URL|DSN|HASH|WEBHOOK|CREDENTIAL)/i;

/**
 * Dominios que Railway inyecta en cada servicio (`RAILWAY_SERVICE_<SERVICIO>_URL`, `RAILWAY_PUBLIC_DOMAIN`…).
 * Llevan «URL» en el nombre, pero su valor es un nombre de host público, el mismo que figura en los dominios
 * de las empresas. Solo se excluyen si el valor es exactamente un dominio de Railway (`<nombre>.up.railway.app`
 * o `<nombre>.railway.internal`): un token con puntos o un dominio propio bajo ese nombre se sigue tratando como
 * secreto.
 */
const RAILWAY_DOMAIN_NAME = /^RAILWAY_(SERVICE_[A-Z0-9_]+_URL|PUBLIC_DOMAIN|PRIVATE_DOMAIN|STATIC_URL)$/;
const RAILWAY_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:up\.railway\.app|railway\.internal)$/;
const isRailwayDomain = (name: string, value: string) => RAILWAY_DOMAIN_NAME.test(name) && RAILWAY_HOST.test(value);

export interface RecoveryTenant {
  id: string;
  displayName: string;
  status: string;
  schemaVersion: string | null;
  serverAlias: string | null;
  databaseState: string | null;
  domains: Array<{ domain: string; kind: string; status: string; isPrimary: boolean }>;
  latest: Record<string, { manifestKey: string | null; createdAt: number | null } | null>;
  files: Record<string, { indexKey: string; entries: number | null } | null>;
}

export interface RecoveryPackage {
  format: "elephant-recovery-package";
  version: 1;
  generatedAt: string;
  runId: string;
  deployment: { commit: string | null; railway: Record<string, string> };
  services: typeof SERVICE_CATALOG;
  /** Variables del servicio de copias: solo si están definidas (nunca el valor). */
  backupJobEnvironment: Record<string, boolean>;
  databases: {
    registry: { database: string | null; schemaVersion: string | null };
    crm: { configured: boolean; database: string | null };
    servers: Array<{ alias: string; host: string; port: number; adminUrlEnv: string }>;
  };
  backups: {
    destinations: Record<string, string | null>;
    keyIds: string[];
    activeKeyId: string;
    retention: Record<string, { daily: number; weekly: number; monthly: number }>;
  };
  tenants: RecoveryTenant[];
  restoreOrder: string[];
}

export class RecoveryPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryPackageError";
  }
}

/** Lanza si el paquete contiene un valor sensible del entorno, credenciales en una URL o material de clave. */
export function assertNoSecrets(pkg: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const text = JSON.stringify(pkg);
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 8 || PUBLIC_VALUE_VARS.includes(name) || !SENSITIVE_NAME.test(name) || isRailwayDomain(name, value)) continue;
    if (text.includes(value)) throw new RecoveryPackageError(`El paquete contiene el valor de ${name}: no se genera`);
    // Contraseña de una URL (DSN) o claves de un llavero (`id:clave,id2:clave2`)
    let parts: string[];
    try {
      const u = new URL(value);
      parts = u.password ? [decodeURIComponent(u.password)] : [];
    } catch {
      parts = value.split(",").map((p) => p.slice(p.indexOf(":") + 1));
    }
    for (const part of parts) {
      if (part.length >= 6 && text.includes(part)) throw new RecoveryPackageError(`El paquete contiene parte del valor de ${name}: no se genera`);
    }
  }
  if (/[a-z][a-z0-9+.-]*:\/\/[^/\s"@:]+:[^/\s"@]+@/i.test(text)) throw new RecoveryPackageError("El paquete contiene una URL con credenciales: no se genera");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) throw new RecoveryPackageError("El paquete contiene una clave privada: no se genera");
}

export interface RecoveryInputs {
  runId: string;
  now: number;
  env: NodeJS.ProcessEnv;
  reader: Pick<TenantRegistryReader, "listTenants" | "getActiveDatabase" | "listDomains">;
  registry: { database: string | null; schemaVersion: string | null };
  crm: { configured: boolean; database: string | null };
  destinations: Record<string, BackupStorage | null>;
  ring: Keyring;
  retention: Record<string, { daily: number; weekly: number; monthly: number }>;
  /** Última copia correcta conocida de cada empresa en cada destino. */
  latest: (destination: string, tenantId: string) => Promise<{ manifestKey: string | null; createdAt: number | null } | null>;
  filesEntries?: (destination: string, tenantId: string) => Promise<number | null>;
}

export async function buildRecoveryPackage(i: RecoveryInputs): Promise<RecoveryPackage> {
  const railway: Record<string, string> = {};
  for (const k of PUBLIC_VALUE_VARS) if (k.startsWith("RAILWAY_") && i.env[k]) railway[k] = String(i.env[k]);
  let servers: RecoveryPackage["databases"]["servers"] = [];
  try {
    servers = (parseDatabaseServers(i.env)?.servers ?? []).map((s) => ({ alias: s.alias, host: s.host, port: s.port, adminUrlEnv: s.adminUrlEnv }));
  } catch {
    servers = [];
  }
  const jobService = SERVICE_CATALOG.find((s) => s.service === "backup-job")!;
  const backupJobEnvironment: Record<string, boolean> = {};
  for (const v of [...jobService.required, ...jobService.optional]) backupJobEnvironment[v] = !!i.env[v];

  const tenants: RecoveryTenant[] = [];
  for (const t of (await i.reader.listTenants()).sort((a, b) => a.id.localeCompare(b.id))) {
    const db = await i.reader.getActiveDatabase(t.id);
    const domains = (await i.reader.listDomains(t.id)).map((d) => ({ domain: d.domain, kind: d.kind, status: d.status, isPrimary: d.isPrimary }));
    const latest: RecoveryTenant["latest"] = {};
    const files: RecoveryTenant["files"] = {};
    for (const dest of Object.keys(i.destinations)) {
      if (!i.destinations[dest]) continue;
      latest[dest] = await i.latest(dest, t.id);
      files[dest] = { indexKey: `files/${t.id}/index.json.enc`, entries: i.filesEntries ? await i.filesEntries(dest, t.id) : null };
    }
    tenants.push({ id: t.id, displayName: t.displayName, status: t.status, schemaVersion: t.schemaVersion, serverAlias: db?.serverAlias ?? null, databaseState: db?.state ?? null, domains, latest, files });
  }

  const pkg: RecoveryPackage = {
    format: "elephant-recovery-package",
    version: 1,
    generatedAt: new Date(i.now).toISOString(),
    runId: i.runId,
    deployment: { commit: i.env.ES_DEPLOY_COMMIT || i.env.RAILWAY_GIT_COMMIT_SHA || null, railway },
    services: SERVICE_CATALOG,
    backupJobEnvironment,
    databases: { registry: i.registry, crm: i.crm, servers },
    backups: {
      destinations: Object.fromEntries(Object.entries(i.destinations).map(([k, s]) => [k, s ? s.describe() : null])),
      keyIds: Array.from(i.ring.keys.keys()),
      activeKeyId: i.ring.activeKeyId,
      retention: i.retention,
    },
    tenants,
    restoreOrder: [
      "1. MySQL nuevo y servicios (sin tráfico)",
      "2. registro (restore-platform registry o rebuild)",
      "3. CRM comercial (restore-platform crm)",
      "4. cada empresa en el servidor nuevo, con conmutación (restore-tenant --switch)",
      "5. ficheros de cada empresa al bucket de medios nuevo (restore-files --to-media)",
      "6. variables, pasarelas y dominios; validación; reapertura controlada",
    ],
  };
  assertNoSecrets(pkg, i.env);
  return pkg;
}

/** Cifra y escribe el paquete (más reciente y el del día) en un destino; verifica la escritura. */
export async function writeRecoveryPackage(storage: BackupStorage, ring: Keyring, pkg: RecoveryPackage, at: number): Promise<{ keys: string[]; bytes: number }> {
  const enc = encryptBuffer(Buffer.from(JSON.stringify(pkg, null, 2), "utf8"), ring, RECOVERY_AAD);
  const keys = [recoveryDatedKey(at), RECOVERY_LATEST_KEY];
  for (const k of keys) {
    await storage.putBuffer(k, enc);
    const back = await storage.getBuffer(k);
    if (!back || !back.equals(enc)) throw new RecoveryPackageError("El paquete almacenado no coincide con el escrito");
  }
  return { keys, bytes: enc.length };
}

export async function readRecoveryPackage(storage: BackupStorage, ring: Keyring, key = RECOVERY_LATEST_KEY): Promise<RecoveryPackage | null> {
  const buf = await storage.getBuffer(key);
  if (!buf) return null;
  const pkg = JSON.parse(decryptBuffer(buf, ring, RECOVERY_AAD).toString("utf8")) as RecoveryPackage;
  if (pkg.format !== "elephant-recovery-package") throw new RecoveryPackageError("Formato de paquete de recuperación no admitido");
  return pkg;
}
