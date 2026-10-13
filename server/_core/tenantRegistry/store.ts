/**
 * Interfaces del almacén del registro.
 *
 * Separación de privilegios:
 *  - `TenantRegistryReader`: lo único que necesita el Core para servir peticiones. En
 *    producción se instancia con credenciales de SOLO LECTURA.
 *  - `TenantRegistryStore`: además, primitivas de escritura atómicas. Solo lo usa el
 *    `TenantRegistryService` (único camino de escritura, con auditoría).
 */
import type {
  Tenant,
  TenantDatabaseRef,
  TenantDomain,
  TenantEvent,
  TenantStatus,
} from "./contract";

export interface DomainResolution {
  domain: TenantDomain;
  tenant: Tenant;
}

export interface TenantVersionInfo {
  tenantId: string;
  status: TenantStatus;
  registryVersion: number;
}

export interface TenantRegistryReader {
  contractVersion(): Promise<string>;
  getTenant(id: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;
  /** Dominio + tenant en una sola lectura consistente. */
  resolveDomain(domain: string): Promise<DomainResolution | null>;
  listDomains(tenantId: string): Promise<TenantDomain[]>;
  getActiveDatabase(tenantId: string): Promise<TenantDatabaseRef | null>;
  listDatabases(tenantId: string): Promise<TenantDatabaseRef[]>;
  /** Estado y versión de todos los tenants: sondeo barato para invalidar cachés. */
  listVersions(): Promise<TenantVersionInfo[]>;
  listEvents(tenantId: string, limit?: number): Promise<TenantEvent[]>;
}

/** Operaciones de escritura dentro de una unidad atómica. */
export interface RegistryTx extends TenantRegistryReader {
  insertTenant(t: Omit<Tenant, "registryVersion" | "createdAt" | "updatedAt">): Promise<Tenant>;
  /** Falla con `stale_version` si `expectedVersion` no coincide. Incrementa la versión. */
  updateTenant(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Tenant, "displayName" | "status" | "statusReason" | "baselineVersion" | "schemaVersion">>,
  ): Promise<Tenant>;
  insertDomain(d: Omit<TenantDomain, "createdAt">): Promise<TenantDomain>;
  updateDomain(domain: string, patch: Partial<Omit<TenantDomain, "domain" | "tenantId" | "createdAt">>): Promise<TenantDomain>;
  insertDatabase(d: Omit<TenantDatabaseRef, "id" | "createdAt" | "rotatedAt">): Promise<TenantDatabaseRef>;
  updateDatabase(
    id: number,
    patch: Partial<Pick<TenantDatabaseRef, "state" | "dsnCipher" | "keyId" | "rotatedAt">>,
  ): Promise<TenantDatabaseRef>;
  insertEvent(e: Omit<TenantEvent, "id" | "at">): Promise<TenantEvent>;
}

export interface TenantRegistryStore extends TenantRegistryReader {
  /** Ejecuta `fn` de forma atómica: todo o nada. */
  transaction<T>(fn: (tx: RegistryTx) => Promise<T>): Promise<T>;
}
