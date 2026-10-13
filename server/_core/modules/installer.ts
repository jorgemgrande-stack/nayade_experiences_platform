/**
 * Instalación de módulos en la BD de un tenant: aplica las migraciones de los módulos
 * externos cargados (y las de sus dependencias, en orden). Los módulos incorporados al Core
 * no tienen migraciones propias: su esquema forma parte del baseline.
 */
import mysql from "mysql2/promise";
import type { ModuleInstaller } from "../provisioning/ports";
import { applyModuleMigrations } from "./migrations";
import type { LoadedModule } from "./loader";
import type { ModuleRegistry } from "./registry";

export function createModuleInstaller(getLoaded: () => LoadedModule[], registry: ModuleRegistry): ModuleInstaller {
  return {
    async install(dsn, moduleIds) {
      const wanted = new Set<string>();
      for (const id of moduleIds) for (const dep of registry.withDependencies(id)) wanted.add(dep);
      const loaded = getLoaded();
      const order = registry.activationOrder().filter((id) => wanted.has(id));
      const installed: string[] = [];
      const pool = mysql.createPool({ uri: dsn, connectionLimit: 2 });
      try {
        for (const id of order) {
          const m = loaded.find((x) => x.manifest.id === id);
          if (!m) continue; // incorporado al Core
          await applyModuleMigrations(pool, m.manifest, m.root, { apply: true });
          installed.push(id);
        }
      } finally {
        await pool.end().catch(() => undefined);
      }
      return { installed };
    },
  };
}
