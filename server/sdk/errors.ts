/**
 * Errores tipados del SDK. Cada uno lleva un `code` estable (para clientes y pruebas) y el módulo
 * afectado. `toTrpcError` los traduce al borde tRPC sin perder el mensaje.
 */
import { TRPCError } from "@trpc/server";
import { ModuleError } from "../_core/modules/contract";

export type SdkErrorCode =
  | "invalid_manifest"
  | "duplicate_module"
  | "dependency_missing"
  | "circular_dependency"
  | "incompatible_module"
  | "module_unknown"
  | "module_not_licensed"
  | "module_read_only"
  | "module_not_active"
  | "module_not_installed"
  | "site_required"
  | "site_unknown"
  | "license_unverifiable";

export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    public readonly moduleId: string | null,
    message: string,
    public readonly details: Record<string, string | null> = {},
  ) {
    super(message);
    this.name = "SdkError";
  }
}

export class InvalidManifest extends SdkError {
  constructor(moduleId: string | null, message: string) {
    super("invalid_manifest", moduleId, message);
    this.name = "InvalidManifest";
  }
}
export class DuplicateModule extends SdkError {
  constructor(moduleId: string, message = `Módulo ya registrado: ${moduleId}`) {
    super("duplicate_module", moduleId, message);
    this.name = "DuplicateModule";
  }
}
export class DependencyMissing extends SdkError {
  constructor(moduleId: string, message: string) {
    super("dependency_missing", moduleId, message);
    this.name = "DependencyMissing";
  }
}
export class CircularDependency extends SdkError {
  constructor(moduleId: string | null, message: string) {
    super("circular_dependency", moduleId, message);
    this.name = "CircularDependency";
  }
}
export class IncompatibleModule extends SdkError {
  constructor(moduleId: string, message: string) {
    super("incompatible_module", moduleId, message);
    this.name = "IncompatibleModule";
  }
}
export class ModuleUnknown extends SdkError {
  constructor(moduleId: string) {
    super("module_unknown", moduleId, `Módulo no registrado: ${moduleId}`);
    this.name = "ModuleUnknown";
  }
}
/** Sin licencia vigente (no contratada, pendiente, suspendida, cancelada) para la empresa o la sede. */
export class ModuleNotLicensed extends SdkError {
  constructor(moduleId: string, status: string, message: string) {
    super("module_not_licensed", moduleId, message, { status });
    this.name = "ModuleNotLicensed";
  }
}
/** Licencia en solo lectura (o caducada): se consulta, no se opera. */
export class ModuleReadOnly extends SdkError {
  constructor(moduleId: string, status: string, message: string) {
    super("module_read_only", moduleId, message, { status });
    this.name = "ModuleReadOnly";
  }
}
/** Con licencia, pero desactivado en la sede (los datos se conservan). */
export class ModuleNotActive extends SdkError {
  constructor(moduleId: string, siteId: string) {
    super("module_not_active", moduleId, `El módulo ${moduleId} no está activado en la sede ${siteId}`, { siteId });
    this.name = "ModuleNotActive";
  }
}
/** Las tablas del módulo no existen en la base de datos de la empresa (migración no aplicada). */
export class ModuleNotInstalled extends SdkError {
  constructor(moduleId: string) {
    super("module_not_installed", moduleId, `El módulo ${moduleId} no está instalado en esta empresa`);
    this.name = "ModuleNotInstalled";
  }
}
export class SiteRequired extends SdkError {
  constructor(moduleId: string) {
    super("site_required", moduleId, `El módulo ${moduleId} opera por sede: indica la sede`);
    this.name = "SiteRequired";
  }
}
export class SiteUnknown extends SdkError {
  constructor(moduleId: string | null, siteId: string, message = `Sede no válida o archivada: ${siteId}`) {
    super("site_unknown", moduleId, message, { siteId });
    this.name = "SiteUnknown";
  }
}
/** El origen de licencias (o de sedes) no responde: se falla cerrado. */
export class LicenseUnverifiable extends SdkError {
  constructor(moduleId: string | null, message = "No se pudo verificar la licencia") {
    super("license_unverifiable", moduleId, message);
    this.name = "LicenseUnverifiable";
  }
}

/** Traduce los errores del registro del Core (`ModuleError`) a errores tipados del SDK. */
export function fromModuleError(e: ModuleError, moduleId: string | null): SdkError {
  const id = moduleId ?? "";
  switch (e.code) {
    case "duplicate":
      return new DuplicateModule(id, e.message);
    case "missing_dependency":
      return new DependencyMissing(id, e.message);
    case "incompatible":
      return new IncompatibleModule(id, e.message);
    case "cycle":
      return new CircularDependency(moduleId, e.message);
    case "not_found":
      return new ModuleUnknown(id);
    case "not_licensed":
      return new ModuleNotLicensed(id, "not_contracted", e.message);
    default:
      return new InvalidManifest(moduleId, e.message);
  }
}

const TRPC_CODE: Record<SdkErrorCode, TRPCError["code"]> = {
  invalid_manifest: "INTERNAL_SERVER_ERROR",
  duplicate_module: "INTERNAL_SERVER_ERROR",
  dependency_missing: "INTERNAL_SERVER_ERROR",
  circular_dependency: "INTERNAL_SERVER_ERROR",
  incompatible_module: "INTERNAL_SERVER_ERROR",
  module_unknown: "NOT_FOUND",
  module_not_licensed: "FORBIDDEN",
  module_read_only: "FORBIDDEN",
  module_not_active: "PRECONDITION_FAILED",
  module_not_installed: "PRECONDITION_FAILED",
  site_required: "BAD_REQUEST",
  site_unknown: "BAD_REQUEST",
  license_unverifiable: "INTERNAL_SERVER_ERROR",
};

/** Error tRPC equivalente. El mensaje empieza por `[code]` para que el cliente pueda distinguirlo. */
export function toTrpcError(e: unknown): unknown {
  if (!(e instanceof SdkError)) return e;
  return new TRPCError({ code: TRPC_CODE[e.code], message: `[${e.code}] ${e.message}`, cause: e });
}
