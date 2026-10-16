/**
 * Registro de módulos del SDK y guardián de licencias.
 *
 * Reutiliza el registro del Core (`ModuleRegistry`: manifiesto 1.1, compatibilidad con el Core,
 * dependencias, ciclos y orden de activación) y añade lo propio del SDK: compatibilidad con el contrato
 * de módulo, capacidad del catálogo, eventos con prefijo y errores tipados. Los módulos del Core
 * (`BUILTIN_MODULES`) se cargan como base para que las dependencias hacia ellos se resuelvan.
 *
 * El guardián (`ModuleGate`) decide con la licencia REAL por capacidad (`CapabilityAccess`): empresa o
 * sede, `read_only` (consulta sí, opera no) y fallo cerrado si el origen no responde.
 */
import { CapabilityAccess, getCapabilityAccess } from "../_core/capabilities/access";
import type { Decision } from "../_core/capabilities/model";
import { BUILTIN_MODULES } from "../_core/modules/builtin";
import { ModuleError, type ModuleManifest } from "../_core/modules/contract";
import type { ModuleAccess } from "../_core/modules/entitlements";
import { ModuleRegistry } from "../_core/modules/registry";
import { CORE_VERSION, getModuleAccess } from "../_core/modules/runtime";
import { parseVersion, satisfies } from "../_core/modules/semver";
import { capability } from "../catalog/capabilities";
import { MODULE_CONTRACT_VERSION, type SdkModuleDefinition } from "./contract";
import { getCompanyContext } from "./context";
import {
  DependencyMissing,
  IncompatibleModule,
  InvalidManifest,
  LicenseUnverifiable,
  ModuleNotLicensed,
  ModuleReadOnly,
  ModuleUnknown,
  SdkError,
  SiteRequired,
  fromModuleError,
} from "./errors";

export interface SdkRegistryOptions {
  coreVersion?: string;
  contractVersion?: string;
  /** Módulos del Core ya instalados (por defecto, `BUILTIN_MODULES`). */
  base?: ModuleManifest[];
}

export class SdkModuleRegistry {
  private readonly reg: ModuleRegistry;
  private readonly defs = new Map<string, SdkModuleDefinition<any>>();
  private readonly contractVersion: string;

  constructor(opts: SdkRegistryOptions = {}) {
    this.reg = new ModuleRegistry(opts.coreVersion ?? CORE_VERSION);
    this.contractVersion = opts.contractVersion ?? MODULE_CONTRACT_VERSION;
    for (const m of opts.base ?? BUILTIN_MODULES) this.reg.register(m);
  }

  private check(def: SdkModuleDefinition<any>): void {
    const id = def.manifest?.id ?? null;
    if (!def.contract || !parseVersion(def.contract.replace(/^[\^~]|^>=/, ""))) throw new InvalidManifest(id, `${id}: rango de contrato no válido`);
    if (!satisfies(this.contractVersion, def.contract)) {
      throw new IncompatibleModule(id ?? "", `${id} implementa el contrato ${def.contract} (Core con contrato ${this.contractVersion})`);
    }
    if (!capability(def.capability)) throw new InvalidManifest(id, `${id}: capacidad desconocida en el catálogo (${def.capability})`);
    for (const ev of def.events ?? []) {
      if (!ev.startsWith(`${id}.`)) throw new InvalidManifest(id, `${id}: el evento ${ev} debe empezar por "${id}."`);
    }
  }

  /** Registra un módulo. Valida manifiesto, Core y contrato; las dependencias se validan con `validate()`. */
  register(def: SdkModuleDefinition<any>): void {
    this.check(def);
    try {
      this.reg.register(def.manifest);
    } catch (e) {
      throw e instanceof ModuleError ? fromModuleError(e, def.manifest.id) : e;
    }
    this.defs.set(def.manifest.id, def);
  }

  /** Dependencias presentes y compatibles y sin ciclos en todo el conjunto. */
  validate(): void {
    try {
      this.reg.validate();
    } catch (e) {
      throw e instanceof ModuleError ? fromModuleError(e, null) : e;
    }
  }

  /** Registra un lote y lo valida; si algo falla, no queda nada del lote registrado. */
  registerAll(defs: SdkModuleDefinition<any>[]): void {
    const done: string[] = [];
    try {
      for (const d of defs) {
        this.register(d);
        done.push(d.manifest.id);
      }
      this.validate();
    } catch (e) {
      for (const id of done) this.unregister(id);
      throw e;
    }
  }

  unregister(id: string): void {
    if (!this.defs.has(id)) return;
    this.defs.delete(id);
    this.reg.unregister(id);
  }

  get(id: string): SdkModuleDefinition<any> | undefined {
    return this.defs.get(id);
  }

  /** Solo los módulos del SDK (sin la base del Core). */
  list(): SdkModuleDefinition<any>[] {
    return Array.from(this.defs.values());
  }

  manifest(id: string): ModuleManifest | undefined {
    return this.reg.get(id);
  }

  activationOrder(): string[] {
    return this.reg.activationOrder();
  }

  withDependencies(id: string): string[] {
    return this.reg.withDependencies(id);
  }
}

export interface GateOptions {
  capabilities?: () => CapabilityAccess;
  /** Licencia de los módulos del Core que no están en la base (p. ej. `hotel`). */
  modules?: () => ModuleAccess;
}

export interface GateCheck {
  write: boolean;
  /** Sede de la operación; por defecto, la del contexto (`runWithSite`). */
  siteId?: string | null;
  tenantId?: string;
}

export class ModuleGate {
  constructor(
    private registry: SdkModuleRegistry,
    private opts: GateOptions = {},
  ) {}

  private async decision(moduleId: string, cap: string, o: { write: boolean; siteId: string | null; tenantId?: string }): Promise<Decision> {
    try {
      return await (this.opts.capabilities ?? getCapabilityAccess)().check(cap, o);
    } catch {
      throw new LicenseUnverifiable(moduleId);
    }
  }

  /**
   * Comprueba la licencia del módulo (y de sus dependencias) para la operación. Lanza un error tipado:
   * `ModuleNotLicensed`, `ModuleReadOnly`, `DependencyMissing`, `SiteRequired`, `LicenseUnverifiable`.
   * Las dependencias se exigen al menos en lectura; la escritura solo se exige al módulo pedido.
   */
  async assert(moduleId: string, o: GateCheck): Promise<{ status: Decision["status"]; siteId: string | null }> {
    const def = this.registry.get(moduleId);
    if (!def) throw new ModuleUnknown(moduleId);
    const siteId = o.siteId ?? getCompanyContext().siteId;
    if (def.siteScoped && !siteId) throw new SiteRequired(moduleId);
    let own: Decision | null = null;
    for (const id of this.registry.withDependencies(moduleId)) {
      const sdk = this.registry.get(id);
      if (sdk) {
        const write = id === moduleId && o.write;
        const d = await this.decision(id, sdk.capability, { write, siteId, tenantId: o.tenantId });
        if (!d.allowed) {
          if (id !== moduleId) throw new DependencyMissing(moduleId, `${moduleId} requiere ${id}, que no está disponible (${d.reason})`);
          if (d.status === "read_only" || d.status === "expired") throw new ModuleReadOnly(moduleId, d.status, d.reason);
          throw new ModuleNotLicensed(moduleId, d.status, d.reason);
        }
        if (id === moduleId) own = d;
        continue;
      }
      const m = this.registry.manifest(id);
      if (!m) throw new DependencyMissing(moduleId, `${moduleId} depende de ${id}, que no está instalado`);
      if (m.includedInBase) continue;
      let ok: boolean;
      try {
        ok = await (this.opts.modules ?? getModuleAccess)().isModuleAvailable(id, o.tenantId);
      } catch {
        throw new LicenseUnverifiable(moduleId);
      }
      if (!ok) throw new DependencyMissing(moduleId, `${moduleId} requiere ${id}, que no está disponible`);
    }
    return { status: own!.status, siteId };
  }

  /** Igual que `assert`, pero devuelve la decisión en lugar de lanzar (para pantallas de estado). */
  async status(moduleId: string, o: GateCheck): Promise<{ allowed: boolean; code: string | null; reason: string | null }> {
    try {
      await this.assert(moduleId, o);
      return { allowed: true, code: null, reason: null };
    } catch (e) {
      if (e instanceof SdkError) return { allowed: false, code: e.code, reason: e.message };
      throw e;
    }
  }
}
