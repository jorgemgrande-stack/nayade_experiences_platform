/** Puertos del aprovisionamiento: el servicio no conoce MySQL, correo ni plantillas concretas. */
import type { ProvisioningRecord } from "./types";

export interface DatabaseProvisioner {
  /**
   * Crea (si no existe) la base de datos del tenant y un usuario propio con permisos solo
   * sobre ella. Idempotente: puede llamarse de nuevo y devuelve un DSN válido.
   */
  ensureDatabase(tenantId: string): Promise<{ dsn: string; serverAlias: string }>;
  dropDatabase(tenantId: string): Promise<void>;
  /**
   * Crea con privilegios de administración los triggers que la baseline no puede llevar (ver
   * tenantTriggers.ts). Idempotente: no toca los que ya existen. Devuelve los creados.
   */
  ensureTriggers?(tenantId: string): Promise<string[]>;
}

export interface SchemaApplier {
  /** Aplica baseline y migraciones pendientes. Idempotente. */
  apply(dsn: string): Promise<{ baselineVersion: string; schemaVersion: string }>;
}

export interface TenantSeeder {
  /** Crea el administrador inicial con una invitación; idempotente por correo. */
  seedAdmin(dsn: string, input: { email: string; name: string }): Promise<{ created: boolean; inviteToken?: string }>;
  /**
   * Emite una invitación nueva para el administrador inicial SOLO si todavía no la aceptó (sin
   * contraseña): la anterior queda invalidada. `null` si ya entró o no existe. Sirve para recuperar
   * el acceso cuando la invitación original se perdió (alta reanudada tras un fallo).
   */
  reissueAdminInvite?(dsn: string, input: { email: string }): Promise<{ inviteToken: string } | null>;
  seedBranding(dsn: string, settings: Record<string, string>): Promise<void>;
  seedTemplate?(dsn: string, templateId: string): Promise<void>;
}

export interface ModuleInstaller {
  /** Aplica las migraciones de los módulos indicados (y sus dependencias) a la BD del tenant. Idempotente. */
  install(dsn: string, moduleIds: string[]): Promise<{ installed: string[] }>;
}

export interface ProvisioningListFilter {
  status?: ProvisioningRecord["status"];
  limit: number;
  offset: number;
}

export interface ProvisioningStore {
  get(tenantId: string): Promise<ProvisioningRecord | null>;
  put(rec: ProvisioningRecord): Promise<void>;
  /** Listado global (los más recientes primero). Opcional: sin él no hay listado. */
  list?(f: ProvisioningListFilter): Promise<{ items: ProvisioningRecord[]; total: number }>;
}

export class MemoryProvisioningStore implements ProvisioningStore {
  private rows = new Map<string, ProvisioningRecord>();
  async get(tenantId: string) {
    const r = this.rows.get(tenantId);
    return r ? (JSON.parse(JSON.stringify(r)) as ProvisioningRecord) : null;
  }
  async put(rec: ProvisioningRecord) {
    this.rows.set(rec.tenantId, JSON.parse(JSON.stringify(rec)));
  }
  async list(f: ProvisioningListFilter) {
    const all = Array.from(this.rows.values())
      .filter((r) => !f.status || r.status === f.status)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.tenantId.localeCompare(b.tenantId));
    return { items: all.slice(f.offset, f.offset + f.limit).map((r) => JSON.parse(JSON.stringify(r)) as ProvisioningRecord), total: all.length };
  }
}

export interface WelcomeNotifier {
  notify(input: { tenantId: string; adminEmail: string; domain: string; inviteToken?: string }): Promise<void>;
}
