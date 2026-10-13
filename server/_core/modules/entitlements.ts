/**
 * Licencias (entitlements) de módulos por tenant.
 *
 * Reglas:
 *  - La licencia la emite el plano de control (operador/CRM) y vive FUERA de la BD del tenant:
 *    el tenant no puede concederse módulos. El Core solo lee.
 *  - Licencia ≠ feature flag: el flag es un interruptor operativo del tenant; la licencia es
 *    un derecho contratado. Un módulo está disponible si y solo si ambas lo permiten.
 *  - La licencia se verifica en el servidor, en cada operación protegida (APIs y negocio),
 *    nunca solo ocultando una opción del menú.
 *  - Un módulo solo está efectivo si también lo están sus dependencias.
 *  - Modo `single` (producción actual): todos los módulos instalados están licenciados.
 */
import { getTenantId, getTenantMode } from "../tenant";
import { ModuleError } from "./contract";
import type { ModuleRegistry } from "./registry";

export type EntitlementStatus = "active" | "suspended" | "expired";

export interface Entitlement {
  tenantId: string;
  moduleId: string;
  status: EntitlementStatus;
  /** `null` = sin caducidad. */
  validUntil: Date | null;
  source: "operator" | "crm";
}

export interface EntitlementReader {
  listEntitlements(tenantId: string): Promise<Entitlement[]>;
}

export class MemoryEntitlementStore implements EntitlementReader {
  private rows = new Map<string, Entitlement>();
  private fail = false;

  grant(e: Omit<Entitlement, "status"> & { status?: EntitlementStatus }): void {
    this.rows.set(`${e.tenantId}\u0000${e.moduleId}`, { status: "active", ...e });
  }
  revoke(tenantId: string, moduleId: string): void {
    this.rows.delete(`${tenantId}\u0000${moduleId}`);
  }
  setStatus(tenantId: string, moduleId: string, status: EntitlementStatus): void {
    const r = this.rows.get(`${tenantId}\u0000${moduleId}`);
    if (r) r.status = status;
  }
  /** Simula la caída del origen de licencias. */
  setFailing(f: boolean): void {
    this.fail = f;
  }
  async listEntitlements(tenantId: string): Promise<Entitlement[]> {
    if (this.fail) throw new Error("origen de licencias no disponible");
    return Array.from(this.rows.values()).filter((r) => r.tenantId === tenantId);
  }
}

export interface ModuleAccessOptions {
  /** TTL de la caché de licencias por tenant. */
  ttlMs?: number;
  /** Si el origen cae, cuánto tiempo se sigue sirviendo la última licencia conocida. */
  maxStaleMs?: number;
  now?: () => number;
  /** Flag operativo por módulo (por defecto, activo). */
  isFlagEnabled?: (moduleId: string) => Promise<boolean>;
  /** Fuerza el modo de licenciamiento (por defecto, según TENANT_MODE). */
  enforce?: boolean;
}

type CacheEntry = { at: number; list: Entitlement[] };

export class ModuleAccess {
  private cache = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly maxStale: number;
  private readonly now: () => number;

  constructor(
    private registry: ModuleRegistry,
    private reader: EntitlementReader,
    private opts: ModuleAccessOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.maxStale = opts.maxStaleMs ?? 10 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  private enforcing(): boolean {
    return this.opts.enforce ?? getTenantMode() === "multi";
  }

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  private async load(tenantId: string): Promise<Entitlement[]> {
    const t = this.now();
    const c = this.cache.get(tenantId);
    if (c && t - c.at < this.ttl) return c.list;
    try {
      const list = await this.reader.listEntitlements(tenantId);
      this.cache.set(tenantId, { at: t, list });
      return list;
    } catch (e) {
      // Continuidad acotada con la última licencia conocida; después, falla cerrado (sin módulos).
      if (c && t - c.at <= this.maxStale) return c.list;
      throw e;
    }
  }

  /** ¿Tiene licencia vigente (sin contar dependencias ni flag)? */
  private async licensed(tenantId: string, moduleId: string): Promise<boolean> {
    const m = this.registry.get(moduleId);
    if (!m) return false;
    if (!this.enforcing() || m.includedInBase) return true;
    let list: Entitlement[];
    try {
      list = await this.load(tenantId);
    } catch {
      return false;
    }
    const e = list.find((x) => x.moduleId === moduleId);
    if (!e || e.status !== "active") return false;
    return !e.validUntil || e.validUntil.getTime() > this.now();
  }

  /** Disponibilidad efectiva: licencia + dependencias + flag operativo. */
  async isModuleAvailable(moduleId: string, tenantId: string = getTenantId()): Promise<boolean> {
    for (const id of this.registry.withDependencies(moduleId)) {
      if (!(await this.licensed(tenantId, id))) return false;
    }
    if (this.opts.isFlagEnabled && !(await this.opts.isFlagEnabled(moduleId))) return false;
    return true;
  }

  async activeModules(tenantId: string = getTenantId()): Promise<string[]> {
    const out: string[] = [];
    for (const m of this.registry.list()) if (await this.isModuleAvailable(m.id, tenantId)) out.push(m.id);
    return out;
  }

  /** Lanza `not_licensed` si el módulo no está disponible para el tenant actual. */
  async assertModule(moduleId: string, tenantId: string = getTenantId()): Promise<void> {
    if (!this.registry.get(moduleId)) throw new ModuleError("not_found", `Módulo desconocido: ${moduleId}`);
    if (!(await this.isModuleAvailable(moduleId, tenantId))) {
      throw new ModuleError("not_licensed", `El módulo ${moduleId} no está disponible para este tenant`);
    }
  }
}
