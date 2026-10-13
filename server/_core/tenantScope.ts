/**
 * Primitivas para estado en memoria aislado por tenant.
 *
 * Cualquier caché, emisor de eventos o contador con información empresarial debe vivir aquí
 * (o clavearse por tenant): un `Map` global compartiría datos entre clientes en el modo multi.
 *
 *  - El tenant se toma del contexto de la operación (`getTenantId()`); sin contexto en modo
 *    multi lanza (fallo seguro), salvo las variantes `peek*` que devuelven «sin dato».
 *  - Las claves de otro tenant nunca son alcanzables: cada tenant tiene su propio mapa.
 */
import { EventEmitter } from "node:events";
import { getTenantId, getTenantMode, peekTenantContext, DEFAULT_TENANT_ID } from "./tenant";

/** Tenant actual sin lanzar: `null` si no hay contexto en modo multi. */
export function currentTenantOrNull(): string | null {
  const ctx = peekTenantContext();
  if (ctx) return ctx.tenantId;
  return getTenantMode() === "multi" ? null : DEFAULT_TENANT_ID;
}

type Entry<V> = { value: V; expiresAt: number };

export class TenantCache<V> {
  private maps = new Map<string, Map<string, Entry<V>>>();

  constructor(
    private ttlMs: number,
    private maxPerTenant = 5000,
    private now: () => number = Date.now,
  ) {}

  private bucket(create: boolean, tenantId: string | null): Map<string, Entry<V>> | undefined {
    if (!tenantId) return undefined;
    let m = this.maps.get(tenantId);
    if (!m && create) this.maps.set(tenantId, (m = new Map()));
    return m;
  }

  /** `undefined` si no hay dato, está caducado o no hay tenant resuelto. */
  get(key: string): V | undefined {
    const m = this.bucket(false, currentTenantOrNull());
    const e = m?.get(key);
    if (!e) return undefined;
    if (this.now() > e.expiresAt) {
      m!.delete(key);
      return undefined;
    }
    return e.value;
  }

  /** Sin tenant resuelto en modo multi no se guarda nada (no hay dónde atribuirlo). */
  set(key: string, value: V): void {
    const id = currentTenantOrNull();
    const m = this.bucket(true, id);
    if (!m) return;
    if (m.size >= this.maxPerTenant) {
      const oldest = m.keys().next();
      if (!oldest.done) m.delete(oldest.value);
    }
    m.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Invalida solo el tenant actual. */
  clear(): void {
    const id = currentTenantOrNull();
    if (id) this.maps.delete(id);
  }

  clearTenant(tenantId: string): void {
    this.maps.delete(tenantId);
  }

  clearAll(): void {
    this.maps.clear();
  }

  tenants(): string[] {
    return Array.from(this.maps.keys());
  }
}

/**
 * Emisor de eventos aislado por tenant: `emit` y `on` operan sobre el canal del tenant del
 * contexto actual. Un evento de un tenant jamás llega a oyentes de otro.
 */
export class TenantEventEmitter {
  private ee = new EventEmitter();
  private registered = new WeakMap<(...a: any[]) => void, string>();

  constructor(maxListeners = 200) {
    this.ee.setMaxListeners(maxListeners);
  }

  private channel(event: string): string {
    return `${getTenantId()}\u0000${event}`;
  }

  emit(event: string, payload?: unknown, tenantId?: string): boolean {
    const ch = `${tenantId ?? getTenantId()}\u0000${event}`;
    return this.ee.emit(ch, payload);
  }

  on(event: string, listener: (payload: any) => void): this {
    const ch = this.channel(event);
    this.registered.set(listener, ch);
    this.ee.on(ch, listener);
    return this;
  }

  /** Funciona aunque el contexto ya no exista (p. ej. en `req.on("close")`). */
  off(_event: string, listener: (payload: any) => void): this {
    const ch = this.registered.get(listener);
    if (ch) {
      this.ee.off(ch, listener);
      this.registered.delete(listener);
    }
    return this;
  }

  listenerCount(event: string, tenantId?: string): number {
    return this.ee.listenerCount(`${tenantId ?? getTenantId()}\u0000${event}`);
  }
}
