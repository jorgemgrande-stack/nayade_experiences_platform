/**
 * Contratos tipados del SDK de Elephant Source.
 *
 * El manifiesto NO se redefine: es el contrato 1.1 de `_core/modules/contract.ts`. El SDK solo añade lo
 * que un módulo necesita declarar para funcionar con licencias por capacidad y sedes:
 *  - `contract`: rango del contrato de módulo que implementa (compatibilidad con el Core).
 *  - `capability`: id estable del catálogo (`server/catalog/capabilities.ts`) que lo licencia.
 *  - `siteScoped`: cada operación se hace en una sede (licencia y activación por sede).
 *  - `events`: eventos que publica, con el prefijo `<id>.`.
 */
import {
  MODULE_CONTRACT_VERSION,
  MODULE_ID_RE,
  PERMISSION_KEY_RE,
  type ModuleKind,
  type ModuleManifest,
  type ModulePermission,
  type NavigationItem,
} from "../_core/modules/contract";
import { capability } from "../catalog/capabilities";
import { InvalidManifest } from "./errors";

export { MODULE_CONTRACT_VERSION, type ModuleKind, type ModuleManifest, type ModulePermission, type NavigationItem };

/** Identificador de módulo validado (`ski_rental`, `hotel`…). */
export type ModuleId = string & { readonly __moduleId: unique symbol };
/** Identificador de capacidad del catálogo validado (`ski-rental`, `crm-leads`…). */
export type CapabilityId = string & { readonly __capabilityId: unique symbol };
/** Clave de permiso con el prefijo del módulo: `ski_rental.manage`. */
export type PermissionKey<Id extends string = string> = `${Id}.${string}`;

export function moduleId(id: string): ModuleId {
  if (!MODULE_ID_RE.test(id)) throw new InvalidManifest(id, `Identificador de módulo no válido: ${id}`);
  return id as ModuleId;
}

export function capabilityId(id: string): CapabilityId {
  if (!capability(id)) throw new InvalidManifest(null, `Capacidad desconocida en el catálogo: ${id}`);
  return id as CapabilityId;
}

/** Mapa de eventos de un módulo: tipo → carga útil. */
export type EventMap = Record<string, unknown>;

export interface SdkModuleDefinition<E extends EventMap = EventMap> {
  /** Manifiesto del contrato 1.1 (mismo tipo que los módulos del Core). */
  manifest: ModuleManifest;
  /** Rango del contrato de módulo que implementa (p. ej. `^1.1.0`). */
  contract: string;
  /** Capacidad del catálogo que lo licencia. */
  capability: string;
  /** Si es `true`, toda operación exige sede (licencia y activación por sede). */
  siteScoped: boolean;
  /** Eventos que publica (prefijo `<id>.`). Solo sirve para validar y documentar. */
  events?: ReadonlyArray<keyof E & string>;
}

/** Identidad tipada: fija el mapa de eventos del módulo en el sistema de tipos. */
export function defineSdkModule<E extends EventMap>(def: SdkModuleDefinition<E>): SdkModuleDefinition<E> {
  return def;
}

/** ¿Declara el módulo este permiso? (los permisos se validan con el prefijo `<id>.`). */
export function declaresPermission(def: SdkModuleDefinition, key: string): boolean {
  return PERMISSION_KEY_RE.test(key) && (def.manifest.permissions ?? []).some((p) => p.key === key);
}
