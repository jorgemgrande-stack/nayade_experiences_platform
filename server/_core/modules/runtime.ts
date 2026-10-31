/**
 * Instancia de módulos del proceso: registro de manifiestos + control de acceso por licencia.
 *
 * Los módulos se registran al arrancar con `getModuleRegistry().register(manifest)`.
 * En `single` todo lo instalado está licenciado; en `multi` el origen de licencias lo
 * configura `installTenantResolution` con el registro de tenants.
 */
import { getFeatureFlag } from "../../config";
import { ModuleAccess, MemoryEntitlementStore, type EntitlementReader } from "./entitlements";
import { ModuleRegistry } from "./registry";
import { CORE_VERSION } from "../../../shared/version";

/** Versión del Core frente a la que se validan los manifiestos (fuente única: shared/version.ts). */
export { CORE_VERSION };

const registry = new ModuleRegistry(CORE_VERSION);
let access: ModuleAccess | null = null;

export function getModuleRegistry(): ModuleRegistry {
  return registry;
}

/** Flag operativo por módulo: `module.<id>.enabled`; activo si no existe. */
const flagFor = (moduleId: string) => getFeatureFlag(`module.${moduleId}.enabled`, true);

export function configureModuleAccess(reader: EntitlementReader): ModuleAccess {
  access = new ModuleAccess(registry, reader, { isFlagEnabled: flagFor });
  return access;
}

export function getModuleAccess(): ModuleAccess {
  if (!access) access = new ModuleAccess(registry, new MemoryEntitlementStore(), { isFlagEnabled: flagFor });
  return access;
}

/** Solo pruebas. */
export function _resetModulesForTests(): void {
  access = null;
}
