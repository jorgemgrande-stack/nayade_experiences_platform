/**
 * Manifiestos de los módulos que hoy viven dentro del Core.
 *
 * Los módulos sectoriales se extraerán a repositorios propios; hasta entonces se declaran
 * aquí con el mismo contrato, de modo que licencia, permisos y navegación ya funcionan por
 * manifiesto y la extracción no cambia el comportamiento.
 */
import type { ModuleManifest } from "./contract";
import { CORE_EXTENSION_PANELS } from "../../../shared/panelExtensions";
import { getModuleRegistry } from "./runtime";

export const BUILTIN_MODULES: ModuleManifest[] = [
  {
    id: "cms",
    name: "CMS y sitio web",
    version: "1.0.0",
    kind: "core",
    coreRange: "^1.0.0",
    includedInBase: true,
    description: "Web pública, páginas, menús y multimedia",
    resources: ["http.request", "storage.write.bytes"],
    source: { location: "core" },
  },
  {
    id: "commerce",
    name: "Comercio y reservas",
    version: "1.0.0",
    kind: "core",
    coreRange: "^1.0.0",
    includedInBase: true,
    description: "Catálogo, reservas y pagos online",
    resources: ["http.request", "email.sent"],
    source: { location: "core" },
  },
  {
    id: "tpv",
    name: "TPV",
    version: "1.0.0",
    kind: "core",
    coreRange: "^1.0.0",
    includedInBase: true,
    description: "Punto de venta presencial",
    resources: ["http.request"],
    source: { location: "core" },
  },
  {
    id: "hotel",
    name: "Hotel",
    version: "1.0.0",
    kind: "sector",
    coreRange: "^1.0.0",
    dependsOn: [{ id: "commerce", range: "^1.0.0" }],
    permissions: [{ key: "hotel.manage", description: "Gestionar habitaciones, tarifas y reservas de hotel" }],
    description: "Habitaciones, tarifas, temporadas y reservas de alojamiento",
    resources: ["http.request", "email.sent", "storage.write.bytes"],
    source: { location: "core" },
    ...CORE_EXTENSION_PANELS.hotel,
  },
  {
    id: "spa",
    name: "SPA y bienestar",
    version: "1.0.0",
    kind: "sector",
    coreRange: "^1.0.0",
    dependsOn: [{ id: "commerce", range: "^1.0.0" }],
    permissions: [{ key: "spa.manage", description: "Gestionar tratamientos y reservas de spa" }],
    description: "Tratamientos, recursos, agenda y reservas de spa",
    resources: ["http.request", "email.sent"],
    source: { location: "core" },
    ...CORE_EXTENSION_PANELS.spa,
  },
  {
    id: "restaurants",
    name: "Restaurantes",
    version: "1.0.0",
    kind: "sector",
    coreRange: "^1.0.0",
    dependsOn: [{ id: "commerce", range: "^1.0.0" }],
    permissions: [{ key: "restaurants.manage", description: "Gestionar turnos, mesas y reservas de restaurante" }],
    description: "Turnos, mesas y reservas de restaurante",
    resources: ["http.request", "email.sent"],
    source: { location: "core" },
    ...CORE_EXTENSION_PANELS.restaurants,
  },
];

/**
 * Extras de Elephant Connect que viven en el Core y se licencian SOLO por capacidad (sin licencia de módulo):
 * no entran en el registro de módulos ni en su catálogo; aportan su menú, rutas y APIs por manifiesto.
 */
export const CONNECT_EXTENSIONS: ModuleManifest[] = [
  {
    id: "people",
    name: "Elephant People",
    version: "1.0.0",
    kind: "addon",
    coreRange: "^1.0.0",
    description: "Empleados, fichajes, horarios y nóminas",
    resources: ["http.request"],
    source: { location: "core" },
    ...CORE_EXTENSION_PANELS.people,
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
