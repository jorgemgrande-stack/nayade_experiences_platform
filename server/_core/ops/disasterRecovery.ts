/**
 * Reconstrucción completa desde un destino de copias (normalmente el EXTERNO) a un servidor MySQL
 * nuevo, tras la pérdida total del proyecto: registro → CRM → cada empresa → ficheros → validación.
 *
 * Solo necesita el almacenamiento de copias, la clave de copias (BACKUP_KEYS), la clave del registro
 * (REGISTRY_KEYS, para volver a cifrar el DSN de cada base restaurada) y el servidor nuevo. No usa
 * ningún inventario previo: localiza las copias leyendo el almacenamiento (`latestManifestKey`).
 *
 * Reglas (las mismas que la restauración individual): bases NUEVAS, verificación completa (firma,
 * SHA-256, filas, CHECKSUM, triggers) antes de conmutar, una empresa que falla no detiene las demás y
 * nada se da por bueno sin verificar. El registro y el CRM se restauran con el nombre indicado; se
 * informa de cada fase con su duración (medida del RTO).
 */
import mysql from "mysql2/promise";
import path from "node:path";
import type { Keyring } from "./backupCrypto";
import type { BackupStorage, MediaTarget } from "./backupStorage";
import { MysqlBackupCopyLedger, type RestoreSource } from "./backupCopies";
import { BACKUP_TENANT_STATUSES, readFilesIndex, restoreTenantFiles } from "./backupJob";
import { latestManifestKey, restorePlatformDatabase, restoreTenant, RestoreError, type RestoreReport } from "./backupRestore";
import { safeError } from "./backupInventory";
import { readRecoveryPackage } from "./recoveryPackage";
import { migrateRegistry } from "../tenantRegistry/migrate";
import { MysqlTenantRegistryStore } from "../tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "../tenantRegistry/service";
import type { DatabaseServers } from "../provisioning/servers";

export interface RebuildInput {
  storage: BackupStorage;
  source: RestoreSource;
  ring: Keyring;
  /** Llavero del registro (REGISTRY_KEYS de la carpeta privada). */
  registryRing: () => Keyring;
  /** URL de administración del servidor nuevo donde se crean registro y CRM. */
  adminUrl: string;
  registryDatabase: string;
  crmDatabase?: string | null;
  /** Servidores nuevos para las empresas y alias donde restaurarlas. */
  servers: DatabaseServers;
  serverAlias: string;
  /** Bucket de medios nuevo (opcional): se suben ahí los ficheros recuperados. */
  media?: MediaTarget | null;
  /** Directorio con las migraciones del registro (para comprobar el esquema restaurado). */
  registryMigrationsDir: string;
  actor: Actor;
  only?: string[];
  now?: () => number;
  tmpDir?: string;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface RebuildPhase {
  phase: string;
  ok: boolean;
  ms: number;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface RebuildReport {
  ok: boolean;
  source: RestoreSource;
  startedAt: number;
  finishedAt: number;
  totalMs: number;
  phases: RebuildPhase[];
  /** Edad de la copia más antigua y más reciente usadas (ms respecto al inicio): medida del RPO. */
  copies: { oldestCreatedAt: string | null; newestCreatedAt: string | null; maxAgeMs: number | null };
  tenants: Array<{ id: string; ok: boolean; database?: string; rows?: number; files?: number; error?: string }>;
  /** Paquete de recuperación leído (resumen): ayuda a comprobar que no falta nadie. */
  recoveryPackage: { generatedAt: string; tenants: number } | null;
}

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

export async function rebuildPlatform(i: RebuildInput): Promise<RebuildReport> {
  const now = i.now ?? Date.now;
  const log = i.log ?? (() => undefined);
  const startedAt = now();
  const phases: RebuildPhase[] = [];
  const created: number[] = [];
  const tenants: RebuildReport["tenants"] = [];
  const phase = async <T>(name: string, fn: () => Promise<T>, detail?: (r: T) => Record<string, unknown>): Promise<T | null> => {
    const t0 = now();
    try {
      const r = await fn();
      const p: RebuildPhase = { phase: name, ok: true, ms: now() - t0, ...(detail ? { detail: detail(r) } : {}) };
      phases.push(p);
      log("rebuild_phase", { ...p });
      return r;
    } catch (e) {
      const p: RebuildPhase = { phase: name, ok: false, ms: now() - t0, error: safeError(e) };
      phases.push(p);
      log("rebuild_phase", { ...p });
      return null;
    }
  };

  // 0. Paquete de configuración (opcional: sin él se sigue con lo que hay en el almacenamiento)
  const pkg = await phase("paquete de recuperación", async () => readRecoveryPackage(i.storage, i.ring), (p) => ({ found: !!p, generatedAt: p?.generatedAt ?? null }));

  // 1. Registro
  const reg = await phase(
    "registro",
    async () => {
      const key = await latestManifestKey(i.storage, "registry", "registry");
      if (!key) throw new RestoreError("No hay copias del registro en este destino");
      const r = await restorePlatformDatabase({ storage: i.storage, ring: i.ring }, { kind: "registry", manifestKey: key, source: i.source, adminUrl: i.adminUrl, database: i.registryDatabase, tmpDir: i.tmpDir, actor: `${i.actor.type}:${i.actor.id}` });
      if (!r.verification.ok) throw new RestoreError(`Registro restaurado pero no verificado: ${r.verification.problems.slice(0, 3).join("; ")}`);
      created.push(Date.parse(r.backup.createdAt));
      return r;
    },
    (r) => ({ database: r.database, createdAt: r.backup.createdAt, tables: r.verification.tables, rows: r.verification.rows }),
  );
  if (!reg) return finish(false);

  const regPool = mysql.createPool({ uri: withDb(i.adminUrl, i.registryDatabase), connectionLimit: 4, multipleStatements: true });
  try {
    // 2. Esquema del registro restaurado: sin migraciones pendientes ni objetos ausentes
    await phase(
      "esquema del registro",
      async () => {
        const plan = await migrateRegistry(regPool, i.registryMigrationsDir);
        if (plan.pending.length || plan.incomplete.length) throw new RestoreError(`Registro restaurado en ${plan.current}: pendientes ${plan.pending.join(",") || "ninguna"}, incompletas ${plan.incomplete.join(",") || "ninguna"}`);
        return plan;
      },
      (p) => ({ version: p.current }),
    );

    // 3. CRM comercial
    let crm: RestoreReport | null = null;
    if (i.crmDatabase) {
      crm = await phase(
        "CRM comercial",
        async () => {
          const key = await latestManifestKey(i.storage, "crm", "crm");
          if (!key) throw new RestoreError("No hay copias del CRM en este destino");
          const r = await restorePlatformDatabase({ storage: i.storage, ring: i.ring }, { kind: "crm", manifestKey: key, source: i.source, adminUrl: i.adminUrl, database: i.crmDatabase!, tmpDir: i.tmpDir, actor: `${i.actor.type}:${i.actor.id}` });
          if (!r.verification.ok) throw new RestoreError(`CRM restaurado pero no verificado: ${r.verification.problems.slice(0, 3).join("; ")}`);
          created.push(Date.parse(r.backup.createdAt));
          return r;
        },
        (r) => ({ database: r.database, createdAt: r.backup.createdAt, tables: r.verification.tables, rows: r.verification.rows }),
      );
    }

    // 4. Empresas (en el servidor nuevo, con conmutación del registro restaurado)
    const store = new MysqlTenantRegistryStore(regPool);
    const registry = new TenantRegistryService(store, i.registryRing);
    const copies = new MysqlBackupCopyLedger(regPool);
    const ledger = (await copies.ready()) ? copies : null;
    // Constancia de la restauración del registro y del CRM en el propio registro restaurado
    for (const r of [reg, crm]) {
      if (!ledger || !r) continue;
      const id = await ledger
        .restoreStarted({ startedAt, actor: `${i.actor.type}:${i.actor.id}`, source: i.source, targetKind: r.target.kind, targetId: r.target.id, manifestKey: r.backup.manifestKey, databaseName: r.database })
        .catch(() => null);
      if (id) await ledger.restoreFinished(id, { finishedAt: now(), status: "ok", verified: true, databaseName: r.database }).catch(() => undefined);
    }
    const list = (await store.listTenants()).filter((t) => BACKUP_TENANT_STATUSES.includes(t.status)).filter((t) => !i.only || i.only.includes(t.id)).sort((a, b) => a.id.localeCompare(b.id));
    await phase(
      "empresas",
      async () => {
        for (const t of list) {
          try {
            const key = await latestManifestKey(i.storage, "tenant", t.id);
            if (!key) throw new RestoreError("No hay copias de la empresa en este destino");
            const r = await restoreTenant(
              { storage: i.storage, ring: i.ring, copies: ledger, servers: i.servers, registry, reader: store, now, tmpDir: i.tmpDir },
              { tenantId: t.id, manifestKey: key, source: i.source, serverAlias: i.serverAlias, switch: true, actor: i.actor },
            );
            created.push(Date.parse(r.backup.createdAt));
            tenants.push({ id: t.id, ok: r.verification.ok && r.switched, database: r.database, rows: r.verification.rows });
          } catch (e) {
            tenants.push({ id: t.id, ok: false, error: safeError(e) });
          }
        }
        if (tenants.some((t) => !t.ok)) throw new RestoreError(`Empresas sin recuperar: ${tenants.filter((t) => !t.ok).map((t) => t.id).join(", ")}`);
        return tenants.length;
      },
      (n) => ({ tenants: n }),
    );

    // 5. Ficheros de cada empresa al bucket de medios nuevo
    if (i.media) {
      await phase(
        "ficheros",
        async () => {
          let total = 0;
          const problems: string[] = [];
          for (const t of tenants.filter((x) => x.ok)) {
            if (!(await readFilesIndex(i.storage, i.ring, t.id))) {
              t.files = 0;
              continue;
            }
            try {
              const r = await restoreTenantFiles({ storage: i.storage, ring: i.ring, copies: ledger, source: i.source, actor: `${i.actor.type}:${i.actor.id}`, now }, t.id, i.media!);
              t.files = r.files;
              total += r.files;
            } catch (e) {
              problems.push(`${t.id}: ${safeError(e)}`);
            }
          }
          if (problems.length) throw new RestoreError(problems.join("; "));
          return total;
        },
        (n) => ({ files: n }),
      );
    }

    // 6. Consistencia: cada empresa recuperada apunta a una base que responde y es la restaurada
    await phase(
      "validación de consistencia",
      async () => {
        const problems: string[] = [];
        for (const t of tenants.filter((x) => x.ok)) {
          const dsn = await registry.getActiveDsn(t.id);
          if (!dsn || new URL(dsn).pathname !== `/${t.database}`) {
            problems.push(`${t.id}: el registro no apunta a la base restaurada`);
            continue;
          }
          const c = await mysql.createConnection({ uri: dsn });
          try {
            await c.query("SELECT 1");
          } finally {
            await c.end().catch(() => undefined);
          }
        }
        if (pkg) {
          const missing = pkg.tenants.filter((p) => (BACKUP_TENANT_STATUSES as readonly string[]).includes(p.status) && (!i.only || i.only.includes(p.id)) && !tenants.some((t) => t.id === p.id && t.ok)).map((p) => p.id);
          if (missing.length) problems.push(`Empresas del paquete de recuperación sin recuperar: ${missing.join(", ")}`);
        }
        if (problems.length) throw new RestoreError(problems.join("; "));
        return tenants.length;
      },
      (n) => ({ tenants: n }),
    );
  } finally {
    await regPool.end().catch(() => undefined);
  }
  return finish(phases.every((p) => p.ok || p.phase === "paquete de recuperación"));

  function finish(ok: boolean): RebuildReport {
    const finishedAt = now();
    const valid = created.filter((x) => Number.isFinite(x));
    const oldest = valid.length ? Math.min(...valid) : null;
    const newest = valid.length ? Math.max(...valid) : null;
    return {
      ok,
      source: i.source,
      startedAt,
      finishedAt,
      totalMs: finishedAt - startedAt,
      phases,
      copies: {
        oldestCreatedAt: oldest ? new Date(oldest).toISOString() : null,
        newestCreatedAt: newest ? new Date(newest).toISOString() : null,
        maxAgeMs: oldest ? startedAt - oldest : null,
      },
      tenants,
      recoveryPackage: pkg ? { generatedAt: pkg.generatedAt, tenants: pkg.tenants.length } : null,
    };
  }
}

export const defaultRegistryMigrationsDir = () => path.resolve(process.cwd(), "db/registry");
