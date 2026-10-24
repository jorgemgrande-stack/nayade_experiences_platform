/**
 * Estado TÉCNICO de los módulos para una empresa (ficha 360° → Módulos), con datos reales del proceso y de la base de
 * la empresa; nada simulado:
 *  - disponibles en la plataforma: manifiestos registrados (los del Core y los externos cargados), su versión, origen,
 *    compatibilidad con el Core y dependencias;
 *  - errores de carga de los módulos externos (`ELEPHANT_MODULES`) en este arranque;
 *  - por empresa: habilitado (licencia + flag operativo en este momento), migraciones del módulo aplicadas (historial
 *    `__elephant_module_migrations`, con fecha) y pendientes (plan sin aplicar), y módulos con historial en la base que
 *    ya no están disponibles en la plataforma (obsoletos).
 * Las migraciones se aplican solo por el procedimiento protegido; aquí únicamente se informa.
 */
import fs from "node:fs";
import path from "node:path";
import type mysql from "mysql2/promise";
import { CORE_VERSION, getModuleAccess, getModuleRegistry } from "./runtime";
import { getLoadedModules, getModuleLoadFailures } from "./loader";
import { satisfies } from "./semver";
import { MODULE_CONTRACT_VERSION, type ModuleManifest } from "./contract";

export interface ModuleTechnical {
  id: string;
  name: string;
  version: string;
  kind: string;
  source: "core" | "external";
  repository: string | null;
  coreRange: string;
  compatible: boolean;
  dependsOn: Array<{ id: string; range: string; satisfied: boolean }>;
  /** Habilitado para la empresa ahora (licencia vigente o incluido, y flag operativo). */
  enabled: boolean;
  migrations: { own: boolean; applied: Array<{ id: string; appliedAt: string | null }>; pending: string[]; error: string | null };
}

export interface ModulesTechnicalReport {
  coreVersion: string;
  contractVersion: string;
  modules: ModuleTechnical[];
  loadFailures: Array<{ spec: string; error: string; at: string }>;
  /** Módulos con migraciones en la base de la empresa que no están disponibles en la plataforma. */
  obsolete: Array<{ id: string; lastAppliedAt: string | null }>;
}

type Pool = Pick<mysql.Pool, "query">;

/**
 * Migraciones del módulo que aún no constan en el historial de la empresa. Se leen los nombres de fichero del módulo
 * (NNNN_nombre.sql, sin las reversiones) sin cargar el aplicador de migraciones, que no forma parte del binario del Core.
 */
export function pendingFromFiles(dir: string, applied: Set<string>): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^d{4}_[a-z0-9_]+.sql$/.test(f) && !f.endsWith(".down.sql"))
    .map((f) => f.replace(/.sql$/, ""))
    .sort()
    .filter((id) => !applied.has(id));
}

async function historyRows(pool: Pool | null): Promise<Array<{ module_id: string; migration_id: string; applied_at: Date | null }>> {
  if (!pool) return [];
  try {
    const [rows] = await pool.query("SELECT module_id, migration_id, applied_at FROM __elephant_module_migrations ORDER BY applied_at");
    return rows as Array<{ module_id: string; migration_id: string; applied_at: Date | null }>;
  } catch (e) {
    // Sin la tabla: ningún módulo externo ha instalado migraciones en esta empresa
    if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(String((e as { code?: string }).code ?? "") + String((e as Error).message))) return [];
    throw e;
  }
}

export async function modulesTechnicalReport(tenantId: string, pool: Pool | null, deps: { isEnabled?: (id: string) => Promise<boolean> } = {}): Promise<ModulesTechnicalReport> {
  const registry = getModuleRegistry();
  const manifests: ModuleManifest[] = registry.list();
  const loaded = new Map(getLoadedModules().map((m) => [m.manifest.id, m]));
  const history = await historyRows(pool);
  const isEnabled = deps.isEnabled ?? ((id: string) => getModuleAccess().isModuleAvailable(id, tenantId));
  const modules: ModuleTechnical[] = [];
  for (const m of manifests) {
    const ext = loaded.get(m.id);
    let pending: string[] = [];
    let error: string | null = null;
    if (ext && m.migrationsDir && pool) {
      try {
        pending = pendingFromFiles(path.resolve(ext.root, m.migrationsDir), new Set(history.filter((h) => h.module_id === m.id).map((h) => h.migration_id)));
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : "error";
      }
    }
    modules.push({
      id: m.id,
      name: m.name,
      version: m.version,
      kind: m.kind,
      source: ext || m.source?.location === "external" ? "external" : "core",
      repository: m.source?.repository ?? null,
      coreRange: m.coreRange,
      compatible: satisfies(CORE_VERSION, m.coreRange),
      dependsOn: (m.dependsOn ?? []).map((d) => {
        const dep = registry.get(d.id);
        return { id: d.id, range: d.range, satisfied: !!dep && satisfies(dep.version, d.range) };
      }),
      enabled: await isEnabled(m.id).catch(() => false),
      migrations: {
        own: !!m.migrationsDir,
        applied: history.filter((h) => h.module_id === m.id).map((h) => ({ id: h.migration_id, appliedAt: h.applied_at ? new Date(h.applied_at).toISOString() : null })),
        pending,
        error,
      },
    });
  }
  const known = new Set(manifests.map((m) => m.id));
  const obsolete = Array.from(new Set(history.map((h) => h.module_id)))
    .filter((id) => !known.has(id))
    .map((id) => {
      const last = history.filter((h) => h.module_id === id).at(-1);
      return { id, lastAppliedAt: last?.applied_at ? new Date(last.applied_at).toISOString() : null };
    });
  return { coreVersion: CORE_VERSION, contractVersion: MODULE_CONTRACT_VERSION, modules, loadFailures: getModuleLoadFailures(), obsolete };
}
