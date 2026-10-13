/**
 * Almacén en memoria del registro: desarrollo, pruebas y modo sombra sin infraestructura.
 * Implementa la misma semántica que el almacén MySQL (unicidad, concurrencia optimista,
 * atomicidad de las transacciones).
 */
import {
  REGISTRY_CONTRACT_VERSION,
  RegistryError,
  type Tenant,
  type TenantDatabaseRef,
  type TenantDomain,
  type TenantEvent,
} from "./contract";
import type { DomainResolution, RegistryTx, TenantRegistryStore, TenantVersionInfo } from "./store";

type State = {
  tenants: Map<string, Tenant>;
  domains: Map<string, TenantDomain>;
  databases: Map<number, TenantDatabaseRef>;
  events: TenantEvent[];
  seq: { db: number; ev: number };
};

const clone = <T>(v: T): T => structuredClone(v);

function emptyState(): State {
  return { tenants: new Map(), domains: new Map(), databases: new Map(), events: [], seq: { db: 0, ev: 0 } };
}

function cloneState(s: State): State {
  return {
    tenants: new Map(Array.from(s.tenants).map(([k, v]) => [k, clone(v)])),
    domains: new Map(Array.from(s.domains).map(([k, v]) => [k, clone(v)])),
    databases: new Map(Array.from(s.databases).map(([k, v]) => [k, clone(v)])),
    events: s.events.map(clone),
    seq: { ...s.seq },
  };
}

class MemoryTx implements RegistryTx {
  constructor(
    protected s: State,
    private now: () => Date,
  ) {}

  async contractVersion() {
    return REGISTRY_CONTRACT_VERSION;
  }
  async getTenant(id: string) {
    const t = this.s.tenants.get(id);
    return t ? clone(t) : null;
  }
  async listTenants() {
    return Array.from(this.s.tenants.values()).map(clone).sort((a, b) => a.id.localeCompare(b.id));
  }
  async resolveDomain(domain: string): Promise<DomainResolution | null> {
    const d = this.s.domains.get(domain);
    if (!d) return null;
    const t = this.s.tenants.get(d.tenantId);
    return t ? { domain: clone(d), tenant: clone(t) } : null;
  }
  async listDomains(tenantId: string) {
    return Array.from(this.s.domains.values()).filter((d) => d.tenantId === tenantId).map(clone);
  }
  async getActiveDatabase(tenantId: string) {
    const d = Array.from(this.s.databases.values()).find((x) => x.tenantId === tenantId && x.state === "active");
    return d ? clone(d) : null;
  }
  async listDatabases(tenantId: string) {
    return Array.from(this.s.databases.values()).filter((x) => x.tenantId === tenantId).map(clone);
  }
  async listVersions(): Promise<TenantVersionInfo[]> {
    return Array.from(this.s.tenants.values()).map((t) => ({
      tenantId: t.id,
      status: t.status,
      registryVersion: t.registryVersion,
    }));
  }
  async listEvents(tenantId: string, limit = 100) {
    return this.s.events.filter((e) => e.tenantId === tenantId).slice(-limit).map(clone);
  }

  async insertTenant(t: Omit<Tenant, "registryVersion" | "createdAt" | "updatedAt">) {
    if (this.s.tenants.has(t.id)) throw new RegistryError("conflict", `El tenant ${t.id} ya existe`);
    const now = this.now();
    const full: Tenant = { ...t, registryVersion: 1, createdAt: now, updatedAt: now };
    this.s.tenants.set(t.id, full);
    return clone(full);
  }
  async updateTenant(id: string, expectedVersion: number, patch: Parameters<RegistryTx["updateTenant"]>[2]) {
    const cur = this.s.tenants.get(id);
    if (!cur) throw new RegistryError("not_found", `Tenant ${id} no encontrado`);
    if (cur.registryVersion !== expectedVersion) {
      throw new RegistryError("stale_version", `El tenant ${id} cambió (versión ${cur.registryVersion})`);
    }
    const next: Tenant = { ...cur, ...patch, registryVersion: cur.registryVersion + 1, updatedAt: this.now() };
    this.s.tenants.set(id, next);
    return clone(next);
  }
  async insertDomain(d: Omit<TenantDomain, "createdAt">) {
    if (this.s.domains.has(d.domain)) throw new RegistryError("conflict", `El dominio ${d.domain} ya está registrado`);
    if (!this.s.tenants.has(d.tenantId)) throw new RegistryError("not_found", `Tenant ${d.tenantId} no encontrado`);
    const full: TenantDomain = { ...d, createdAt: this.now() };
    this.s.domains.set(d.domain, full);
    return clone(full);
  }
  async updateDomain(domain: string, patch: Parameters<RegistryTx["updateDomain"]>[1]) {
    const cur = this.s.domains.get(domain);
    if (!cur) throw new RegistryError("not_found", `Dominio ${domain} no encontrado`);
    const next = { ...cur, ...patch };
    this.s.domains.set(domain, next);
    return clone(next);
  }
  async insertDatabase(d: Omit<TenantDatabaseRef, "id" | "createdAt" | "rotatedAt">) {
    if (!this.s.tenants.has(d.tenantId)) throw new RegistryError("not_found", `Tenant ${d.tenantId} no encontrado`);
    if (d.state === "active" && Array.from(this.s.databases.values()).some((x) => x.tenantId === d.tenantId && x.state === "active")) {
      throw new RegistryError("conflict", "El tenant ya tiene una base de datos activa");
    }
    const full: TenantDatabaseRef = { ...d, id: ++this.s.seq.db, createdAt: this.now(), rotatedAt: null };
    this.s.databases.set(full.id, full);
    return clone(full);
  }
  async updateDatabase(id: number, patch: Parameters<RegistryTx["updateDatabase"]>[1]) {
    const cur = this.s.databases.get(id);
    if (!cur) throw new RegistryError("not_found", `Base de datos ${id} no encontrada`);
    const next = { ...cur, ...patch };
    if (next.state === "active" && Array.from(this.s.databases.values()).some((x) => x.id !== id && x.tenantId === cur.tenantId && x.state === "active")) {
      throw new RegistryError("conflict", "El tenant ya tiene una base de datos activa");
    }
    this.s.databases.set(id, next);
    return clone(next);
  }
  async insertEvent(e: Omit<TenantEvent, "id" | "at">) {
    const full: TenantEvent = { ...e, id: ++this.s.seq.ev, at: this.now() };
    this.s.events.push(full);
    return clone(full);
  }
}

export class MemoryTenantRegistryStore implements TenantRegistryStore {
  private state = emptyState();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private now: () => Date = () => new Date()) {}

  private view(): MemoryTx {
    return new MemoryTx(this.state, this.now);
  }

  contractVersion() { return this.view().contractVersion(); }
  getTenant(id: string) { return this.view().getTenant(id); }
  listTenants() { return this.view().listTenants(); }
  resolveDomain(d: string) { return this.view().resolveDomain(d); }
  listDomains(t: string) { return this.view().listDomains(t); }
  getActiveDatabase(t: string) { return this.view().getActiveDatabase(t); }
  listDatabases(t: string) { return this.view().listDatabases(t); }
  listVersions() { return this.view().listVersions(); }
  listEvents(t: string, l?: number) { return this.view().listEvents(t, l); }

  /** Transacción serializada con rollback ante cualquier error. */
  transaction<T>(fn: (tx: RegistryTx) => Promise<T>): Promise<T> {
    const run = async () => {
      const working = cloneState(this.state);
      const result = await fn(new MemoryTx(working, this.now));
      this.state = working; // commit
      return result;
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }
}
