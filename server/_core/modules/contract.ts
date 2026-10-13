/**
 * Contrato versionado de módulos de Elephant Source.
 *
 * Un módulo es una unidad instalable e independiente (repositorio propio cuando
 * corresponda) que se declara con un manifiesto. El Core no conoce módulos concretos: lee
 * manifiestos y aplica licencia, permisos, navegación y migraciones de forma uniforme.
 */
export const MODULE_CONTRACT_VERSION = "1.0.0";

export type ModuleKind = "core" | "sector" | "addon";

export interface ModulePermission {
  /** Clave de permiso, con el prefijo del módulo: `hotel.rooms.manage`. */
  key: string;
  description: string;
}

export interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon?: string;
  /** Permiso necesario para ver la entrada (si no se indica, cualquiera con acceso al módulo). */
  permission?: string;
  order?: number;
}

export interface ModuleManifest {
  /** Identificador estable en minúsculas: `hotel`, `spa`, `restaurants`, `ski`. */
  id: string;
  name: string;
  version: string;
  kind: ModuleKind;
  /** Versiones del Core compatibles (rango semver). */
  coreRange: string;
  /** Módulos de los que depende, con rango de versión. */
  dependsOn?: Array<{ id: string; range: string }>;
  permissions?: ModulePermission[];
  navigation?: NavigationItem[];
  /** Feature flags operativos propios (distintos de la licencia). */
  featureFlags?: string[];
  /** Directorio de migraciones del módulo (NNNN_nombre.sql), relativo a su raíz. */
  migrationsDir?: string;
  /** Si es `true`, está disponible sin licencia explícita (p. ej. módulos del Core). */
  includedInBase?: boolean;
}

export const MODULE_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
export const PERMISSION_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

export type ModuleErrorCode =
  | "invalid_manifest"
  | "duplicate"
  | "missing_dependency"
  | "incompatible"
  | "cycle"
  | "not_found"
  | "not_licensed"
  | "dependency_active"
  | "dependency_inactive";

export class ModuleError extends Error {
  constructor(
    public readonly code: ModuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModuleError";
  }
}
