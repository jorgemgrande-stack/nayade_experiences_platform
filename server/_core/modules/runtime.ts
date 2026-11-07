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
import { getCapabilityAccess } from "../capabilities/access";
import { decide } from "../capabilities/model";

/** Versión del Core frente a la que se validan los manifiestos (fuente única: shared/version.ts). */
export { CORE_VERSION };

const registry = new ModuleRegistry(CORE_VERSION);
let access: ModuleAccess | null = null;

export function getModuleRegistry(): ModuleRegistry {
  return registry;
}

/** Flag operativo por módulo: `module.<id>.enabled`; activo si no existe. */
const flagFor = (moduleId: string) => getFeatureFlag(`module.${moduleId}.enabled`, true);

/**
 * Capacidad vigente en alguna sede (activa o en solo lectura), con las licencias reales del registro: no depende de
 * CAPABILITY_ENFORCEMENT, para que la falta de aplicación no conceda módulos a quien no ha contratado nada.
 */
export async function capabilityGrantsModule(tenantId: string, capabilityId: string): Promise<boolean> {
  const caps = getCapabilityAccess();
  const list = await caps.list(tenantId);
  const now = caps.currentTime();
  return list.some((g) => g.capabilityId === capabilityId && decide([{ ...g, siteId: "" }], capabilityId, { write: false, now }).allowed);
}

export function configureModuleAccess(reader: EntitlementReader): ModuleAccess {
  access = new ModuleAccess(registry, reader, { isFlagEnabled: flagFor, hasCapability: capabilityGrantsModule });
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
