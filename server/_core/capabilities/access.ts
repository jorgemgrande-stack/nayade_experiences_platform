/**
 * Acceso a capacidades en el Core: caché corta por tenant con continuidad acotada si el registro cae
 * (después, falla cerrado), igual que las licencias de módulo. Solo se aplica en modo `multi`.
 */
import { getTenantId, getTenantMode } from "../tenant";
import { decide, type Decision } from "./model";
import type { CapabilityReader } from "./store";
import { MemoryCapabilityStore } from "./store";

export interface CapabilityAccessOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  now?: () => number;
  /** Fuerza la aplicación (por defecto, solo en TENANT_MODE=multi). */
  enforce?: boolean;
}

export class CapabilityAccess {
  private cache = new Map<string, { at: number; list: Awaited<ReturnType<CapabilityReader["list"]>> }>();
  private readonly ttl: number;
  private readonly maxStale: number;
  private readonly now: () => number;
  constructor(
    private reader: CapabilityReader,
    private opts: CapabilityAccessOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.maxStale = opts.maxStaleMs ?? 10 * 60_000;
    this.now = opts.now ?? Date.now;
  }
  /**
   * Se aplica en multi SOLO si CAPABILITY_ENFORCEMENT=on: las empresas creadas antes de este motor
   * no tienen licencias por capacidad y quedarían bloqueadas. Se activa cuando todas las tengan
   * aplicadas (alta, prueba o suscripción). Las pruebas lo fuerzan con `enforce`.
   */
  enforcing(): boolean {
    return this.opts.enforce ?? (getTenantMode() === "multi" && process.env.CAPABILITY_ENFORCEMENT === "on");
  }
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
  private async load(tenantId: string) {
    const t = this.now();
    const c = this.cache.get(tenantId);
    if (c && t - c.at < this.ttl) return c.list;
    try {
      const list = await this.reader.list(tenantId);
      this.cache.set(tenantId, { at: t, list });
      return list;
    } catch (e) {
      if (c && t - c.at <= this.maxStale) return c.list;
      throw e;
    }
  }
  /** Decisión para el tenant actual. Lanza si no puede verificarse (quien llama falla cerrado). */
  async check(capabilityId: string, o: { write: boolean; siteId?: string | null; tenantId?: string }): Promise<Decision> {
    if (!this.enforcing()) return { allowed: true, status: "active" };
    const list = await this.load(o.tenantId ?? getTenantId());
    return decide(list, capabilityId, { write: o.write, siteId: o.siteId ?? null, now: this.now() });
  }
}

let access: CapabilityAccess | null = null;
/** Lo llama el arranque multiempresa con el lector del registro. */
export function configureCapabilityAccess(reader: CapabilityReader, opts: CapabilityAccessOptions = {}): CapabilityAccess {
  access = new CapabilityAccess(reader, opts);
  return access;
}
export function getCapabilityAccess(): CapabilityAccess {
  if (!access) access = new CapabilityAccess(new MemoryCapabilityStore());
  return access;
}
export function _resetCapabilityAccessForTests(): void {
  access = null;
}
