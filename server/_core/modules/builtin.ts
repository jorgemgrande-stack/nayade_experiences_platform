/**
 * Manifiestos de los módulos que hoy viven dentro del Core.
 *
 * Los módulos sectoriales se extraerán a repositorios propios; hasta entonces se declaran
 * aquí con el mismo contrato, de modo que licencia, permisos y navegación ya funcionan por
 * manifiesto y la extracción no cambia el comportamiento.
 */
import type { ModuleManifest } from "./contract";
import { getModuleRegistry } from "./runtime";

export const BUILTIN_MODULES: ModuleManifest[] = [
  { id: "cms", name: "CMS y sitio web", version: "1.0.0", kind: "core", coreRange: "^1.0.0", includedInBase: true },
  { id: "commerce", name: "Comercio y reservas", version: "1.0.0", kind: "core", coreRange: "^1.0.0", includedInBase: true },
  { id: "tpv", name: "TPV", version: "1.0.0", kind: "core", coreRange: "^1.0.0", includedInBase: true },
  {
    id: "hotel",
    name: "Hotel",
    version: "1.0.0",
    kind: "sector",
    coreRange: "^1.0.0",
    dependsOn: [{ id: "commerce", range: "^1.0.0" }],
    permissions: [{ key: "hotel.manage", description: "Gestionar habitaciones, tarifas y reservas de hotel" }],
  },
  {
    id: "spa",
    name: "SPA y bienestar",
    version: "1.0.0",
    kind: "sector",
    coreRange: "^1.0.0",
    dependsOn: [{ id: "commerce", range: "^1.0.0" }],
    permissions: [{ key: "spa.manage", description: "Gestionar tratamientos y reservas de spa" }],
  },
  {
    id: "restaurants",
    name: "Restaurantes",
    version: "1.0.0",
    kind: "sector",
    coreRange: "^1.0.0",
    dependsOn: [{ id: "commerce", range: "^1.0.0" }],
    permissions: [{ key: "restaurants.manage", description: "Gestionar turnos, mesas y reservas de restaurante" }],
  },
];

let registered = false;

/** Idempotente: registra los módulos incorporados y valida el conjunto. */
export function registerBuiltinModules(): void {
  if (registered) return;
  const reg = getModuleRegistry();
  for (const m of BUILTIN_MODULES) if (!reg.get(m.id)) reg.register(m);
  reg.validate();
  registered = true;
}

/** Solo pruebas. */
export function _resetBuiltinForTests(): void {
  registered = false;
}
