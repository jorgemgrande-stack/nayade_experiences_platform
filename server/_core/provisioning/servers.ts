/**
 * Varios servidores MySQL para las bases de las empresas.
 *
 * El Core no cambia: cada empresa tiene su DSN cifrado en `tenant_databases` con su `server_alias`.
 * Aquí solo se decide DÓNDE se crea una base nueva (aprovisionamiento o restauración).
 *
 * Configuración (sin secretos en claro, ni aquí ni en el registro):
 *   PROVISIONING_DB_SERVERS='[{"alias":"mysql-a","host":"mysql-a.railway.internal","port":3306,
 *                              "adminUrlEnv":"MYSQL_A_ADMIN_URL","maxTenants":200}]'
 *     - `host`/`port`: dirección con la que el Core conectará (va en el DSN de la empresa).
 *     - `adminUrlEnv`: NOMBRE de la variable que contiene la URL de administración de ese servidor.
 *     - `maxTenants` (opcional): tope de empresas; `acceptsNew: false` lo excluye de altas nuevas.
 *   PROVISIONING_DB_PLACEMENT=least_used (defecto) | explicit
 *   PROVISIONING_DB_DEFAULT_SERVER=<alias>   (modo explicit sin alias en la petición)
 * Compatibilidad: sin PROVISIONING_DB_SERVERS, PROVISIONING_DB_ADMIN_URL (+ _HOST/_PORT/_ALIAS) define
 * un único servidor.
 */
import mysql from "mysql2/promise";
import type { DatabaseProvisioner } from "./ports";
import { MysqlDatabaseProvisioner, databaseNameFor } from "./mysqlAdapters";

export interface DatabaseServerConfig {
  alias: string;
  host: string;
  port: number;
  adminUrlEnv: string;
  maxTenants?: number;
  acceptsNew?: boolean;
}

export type PlacementPolicy = "least_used" | "explicit";

export interface DatabaseServersConfig {
  servers: DatabaseServerConfig[];
  placement: PlacementPolicy;
  defaultAlias?: string;
}

const ALIAS_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigError";
  }
}

/** Lee la configuración de servidores; `null` si no hay ninguno configurado. */
export function parseDatabaseServers(env: NodeJS.ProcessEnv = process.env): DatabaseServersConfig | null {
  const placement = (env.PROVISIONING_DB_PLACEMENT || "least_used") as PlacementPolicy;
  if (placement !== "least_used" && placement !== "explicit") throw new ServerConfigError("PROVISIONING_DB_PLACEMENT debe ser least_used o explicit");
  const defaultAlias = env.PROVISIONING_DB_DEFAULT_SERVER || undefined;

  if (env.PROVISIONING_DB_SERVERS) {
    let raw: unknown;
    try {
      raw = JSON.parse(env.PROVISIONING_DB_SERVERS);
    } catch {
      throw new ServerConfigError("PROVISIONING_DB_SERVERS no es JSON válido");
    }
    if (!Array.isArray(raw) || raw.length === 0) throw new ServerConfigError("PROVISIONING_DB_SERVERS debe ser una lista no vacía");
    const seen = new Set<string>();
    const servers = raw.map((s: Record<string, unknown>, i: number) => {
      if (!s || typeof s !== "object") throw new ServerConfigError(`Servidor ${i}: formato no válido`);
      // Nunca credenciales en claro en esta variable: solo el nombre de la variable que las contiene
      for (const k of Object.keys(s)) {
        if (!["alias", "host", "port", "adminUrlEnv", "maxTenants", "acceptsNew"].includes(k)) throw new ServerConfigError(`Servidor ${i}: campo no admitido «${k}»`);
      }
      const alias = String(s.alias ?? "");
      const host = String(s.host ?? "");
      const port = Number(s.port ?? 3306);
      const adminUrlEnv = String(s.adminUrlEnv ?? "");
      if (!ALIAS_RE.test(alias)) throw new ServerConfigError(`Servidor ${i}: alias no válido`);
      if (seen.has(alias)) throw new ServerConfigError(`Alias repetido: ${alias}`);
      seen.add(alias);
      if (!host || /[\s/@:]/.test(host)) throw new ServerConfigError(`Servidor ${alias}: host no válido`);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ServerConfigError(`Servidor ${alias}: puerto no válido`);
      if (!ENV_RE.test(adminUrlEnv)) throw new ServerConfigError(`Servidor ${alias}: adminUrlEnv debe ser el NOMBRE de una variable`);
      const maxTenants = s.maxTenants === undefined ? undefined : Number(s.maxTenants);
      if (maxTenants !== undefined && (!Number.isInteger(maxTenants) || maxTenants < 0)) throw new ServerConfigError(`Servidor ${alias}: maxTenants no válido`);
      return { alias, host, port, adminUrlEnv, maxTenants, acceptsNew: s.acceptsNew === undefined ? undefined : s.acceptsNew === true };
    });
    if (defaultAlias && !seen.has(defaultAlias)) throw new ServerConfigError("PROVISIONING_DB_DEFAULT_SERVER no figura en PROVISIONING_DB_SERVERS");
    return { servers, placement, defaultAlias };
  }

  if (env.PROVISIONING_DB_ADMIN_URL) {
    const u = new URL(env.PROVISIONING_DB_ADMIN_URL);
    const host = env.PROVISIONING_DB_HOST ?? u.hostname;
    return {
      servers: [{ alias: env.PROVISIONING_DB_ALIAS ?? host, host, port: Number(env.PROVISIONING_DB_PORT ?? (u.port || 3306)), adminUrlEnv: "PROVISIONING_DB_ADMIN_URL" }],
      placement,
      defaultAlias,
    };
  }
  return null;
}

/** Conexiones de administración por servidor (perezosas). */
export class DatabaseServers {
  private pools = new Map<string, mysql.Pool>();
  constructor(
    readonly config: DatabaseServersConfig,
    private env: NodeJS.ProcessEnv = process.env,
  ) {}

  aliases(): string[] {
    return this.config.servers.map((s) => s.alias);
  }

  server(alias: string): DatabaseServerConfig {
    const s = this.config.servers.find((x) => x.alias === alias);
    if (!s) throw new ServerConfigError(`Servidor de BD desconocido: ${alias}`);
    return s;
  }

  /** URL de administración (nunca se registra ni se imprime). */
  adminUrl(alias: string): string {
    const s = this.server(alias);
    const url = this.env[s.adminUrlEnv];
    if (!url) throw new ServerConfigError(`La variable ${s.adminUrlEnv} (servidor ${alias}) no está definida`);
    return url;
  }

  admin(alias: string): mysql.Pool {
    let p = this.pools.get(alias);
    if (!p) {
      p = mysql.createPool({ uri: this.adminUrl(alias), connectionLimit: 2 });
      this.pools.set(alias, p);
    }
    return p;
  }

  async end(): Promise<void> {
    await Promise.all(Array.from(this.pools.values()).map((p) => p.end().catch(() => undefined)));
    this.pools.clear();
  }
}

/** Empresas por servidor según el registro (BD activas o pendientes). */
export async function registryServerUsage(registry: Pick<mysql.Pool, "query">): Promise<Record<string, number>> {
  const [rows] = await registry.query<mysql.RowDataPacket[]>(
    "SELECT server_alias AS a, COUNT(DISTINCT tenant_id) AS n FROM tenant_databases WHERE state IN ('active','pending') AND server_alias IS NOT NULL GROUP BY server_alias",
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.a)] = Number(r.n);
  return out;
}

/** Elige servidor para una base nueva. Pura: recibe el uso actual. */
export function chooseServer(cfg: DatabaseServersConfig, usage: Record<string, number>, requested?: string): string {
  if (requested) {
    if (!cfg.servers.some((s) => s.alias === requested)) throw new ServerConfigError(`Servidor de BD desconocido: ${requested}`);
    return requested;
  }
  if (cfg.placement === "explicit") {
    if (!cfg.defaultAlias) throw new ServerConfigError("Colocación explícita: indica el servidor (o define PROVISIONING_DB_DEFAULT_SERVER)");
    return cfg.defaultAlias;
  }
  const candidates = cfg.servers.filter((s) => s.acceptsNew !== false && (s.maxTenants === undefined || (usage[s.alias] ?? 0) < s.maxTenants));
  if (!candidates.length) throw new ServerConfigError("Ningún servidor de BD admite empresas nuevas (todos llenos o cerrados)");
  return candidates.reduce((best, s) => ((usage[s.alias] ?? 0) < (usage[best.alias] ?? 0) ? s : best)).alias;
}

/**
 * Aprovisionador sobre varios servidores. Idempotente: si la base de la empresa ya existe en algún
 * servidor (alta reanudada), se reutiliza ese servidor.
 */
export class MultiServerDatabaseProvisioner implements DatabaseProvisioner {
  constructor(
    private servers: DatabaseServers,
    private opts: { usage: () => Promise<Record<string, number>>; dbPrefix?: string; userHost?: string },
  ) {}

  private single(alias: string): MysqlDatabaseProvisioner {
    const s = this.servers.server(alias);
    return new MysqlDatabaseProvisioner(this.servers.admin(alias), { host: s.host, port: s.port, alias: s.alias, dbPrefix: this.opts.dbPrefix, userHost: this.opts.userHost });
  }

  /** Servidor donde ya existe la base de la empresa (o null). */
  async locate(tenantId: string): Promise<string | null> {
    const db = databaseNameFor(tenantId, this.opts.dbPrefix);
    const found: string[] = [];
    for (const alias of this.servers.aliases()) {
      const [r] = await this.servers.admin(alias).query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [db]);
      if (r.length) found.push(alias);
    }
    if (found.length > 1) throw new ServerConfigError(`La base de ${tenantId} existe en varios servidores (${found.join(", ")}): revisión manual`);
    return found[0] ?? null;
  }

  async ensureDatabase(tenantId: string, opts: { serverAlias?: string } = {}) {
    const existing = await this.locate(tenantId);
    if (existing && opts.serverAlias && existing !== opts.serverAlias) {
      throw new ServerConfigError(`La base de ${tenantId} ya existe en ${existing}, no en ${opts.serverAlias}`);
    }
    const alias = existing ?? chooseServer(this.servers.config, await this.opts.usage(), opts.serverAlias);
    return this.single(alias).ensureDatabase(tenantId);
  }

  async ensureTriggers(tenantId: string) {
    const alias = await this.locate(tenantId);
    if (!alias) throw new ServerConfigError(`No existe la base de ${tenantId} en ningún servidor`);
    return this.single(alias).ensureTriggers(tenantId);
  }

  async dropDatabase(tenantId: string) {
    const alias = await this.locate(tenantId);
    for (const a of alias ? [alias] : this.servers.aliases()) await this.single(a).dropDatabase(tenantId);
  }
}
