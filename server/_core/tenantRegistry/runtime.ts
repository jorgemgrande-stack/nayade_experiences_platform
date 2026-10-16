/**
 * Ensamblado del registro en el proceso del Core.
 *
 * Configuración (todas por entorno, ninguna toca la infraestructura existente):
 *  - REGISTRY_DATABASE_URL   BD del registro, con usuario de SOLO LECTURA.
 *  - REGISTRY_KEYS / REGISTRY_ACTIVE_KEY_ID   claves de cifrado de DSN (ver crypto.ts).
 *  - TENANT_MODE             single (defecto) | shadow | multi.
 *
 * Con TENANT_MODE=single no se crea nada: el Core se comporta exactamente como hoy.
 */
import mysql from "mysql2/promise";
import { evictTenantDatabase, setConnectionResolver, type ConnectionResolver } from "../dbRegistry";
import { getTenantMode } from "../tenant";
import { keyringFromEnv } from "./crypto";
import { accessPolicy } from "./lifecycle";
import { MysqlEntitlementReader } from "../modules/mysqlEntitlements";
import { MysqlCapabilityStore } from "../capabilities/store";
import { MysqlQuotaReader } from "../erm/mysqlQuotas";
import { MysqlSupportReader } from "../support/grants";
import { MysqlOrganizationStore } from "../../organization/service";
import { invalidateTenantIdentity, registryIdentitySource, type TenantIdentitySource } from "../tenantIdentity";
import { MysqlTenantRegistryStore } from "./mysqlStore";
import { TenantResolver } from "./resolver";
import { TenantRegistryService } from "./service";
import type { TenantRegistryReader } from "./store";
import { fixedPoolOptions } from "../dbPoolConfig";

export interface TenantRuntime {
  resolver: TenantResolver;
  reader: TenantRegistryReader;
  service: TenantRegistryService;
  /** Licencias de módulos (solo lectura). */
  entitlements: MysqlEntitlementReader;
  /** Licencias por capacidad (registro 0008); solo lectura desde el Core. */
  capabilities: MysqlCapabilityStore;
  /** Cuotas de recursos (solo lectura). */
  quotas: MysqlQuotaReader;
  /** Identidad de cada empresa: dominio público y entidad fiscal (solo lectura). */
  identity: TenantIdentitySource;
  /** Concesiones de soporte delegado (solo lectura). */
  support: MysqlSupportReader;
  /** Comprueba que la BD del registro responde (salud); rechaza si no. */
  ping(): Promise<void>;
  /** Detiene el sondeo y cierra el pool del registro. */
  close(): Promise<void>;
}

/**
 * Resolvedor de conexiones para `dbRegistry`: solo entrega la credencial de tenants servibles.
 * El DSN descifrado vive únicamente dentro de la llamada; no se registra ni se devuelve en errores.
 */
export function registryConnectionResolver(
  reader: Pick<TenantRegistryReader, "getTenant">,
  service: Pick<TenantRegistryService, "getActiveDsn">,
): ConnectionResolver {
  return async (tenantId) => {
    const t = await reader.getTenant(tenantId);
    if (!t) return null;
    const p = accessPolicy(t.status);
    if (!p.publicWeb && !p.admin) return null;
    return service.getActiveDsn(tenantId);
  };
}

export function createTenantRuntime(
  env: NodeJS.ProcessEnv = process.env,
  opts: { pollMs?: number; allowLocalhost?: boolean } = {},
): TenantRuntime | null {
  const mode = getTenantMode();
  if (mode === "single") return null;
  const url = env.REGISTRY_DATABASE_URL;
  if (!url) {
    if (mode === "multi") throw new Error("TENANT_MODE=multi requiere REGISTRY_DATABASE_URL");
    console.warn(JSON.stringify({ ctx: "TenantRuntime", event: "shadow_without_registry" }));
    return null;
  }

  // Pool fijo del registro (fuera del presupuesto de empresas): DB_REGISTRY_POOL_CONNECTIONS
  const pool = mysql.createPool({ uri: url, ...fixedPoolOptions("DB_REGISTRY_POOL_CONNECTIONS", 5, env) });
  const store = new MysqlTenantRegistryStore(pool);
  const ring = keyringFromEnv(env);
  const service = new TenantRegistryService(store, () => ring);
  const resolver = new TenantResolver(store, { host: { allowLocalhost: opts.allowLocalhost ?? false } });

  if (mode === "multi") setConnectionResolver(registryConnectionResolver(store, service));

  // Invalidación activa: cambios de versión/estado → caché de dominios y pool del tenant
  const timer = setInterval(async () => {
    try {
      for (const id of await resolver.refreshVersions()) {
        invalidateTenantIdentity(id);
        await evictTenantDatabase(id);
      }
    } catch {
      /* el registro caído lo gestiona el propio resolutor (continuidad acotada) */
    }
  }, opts.pollMs ?? 15_000);
  timer.unref?.();

  return {
    resolver,
    reader: store,
    service,
    entitlements: new MysqlEntitlementReader(pool),
    capabilities: new MysqlCapabilityStore(pool),
    quotas: new MysqlQuotaReader(pool),
    support: new MysqlSupportReader(pool),
    identity: registryIdentitySource(store, new MysqlOrganizationStore(pool)),
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      clearInterval(timer);
      setConnectionResolver(null);
      await pool.end().catch(() => undefined);
    },
  };
}
