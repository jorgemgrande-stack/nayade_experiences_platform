/**
 * Servicio del registro: ÚNICO camino de escritura.
 *
 * Cada operación valida, aplica el cambio y escribe el evento de auditoría en la MISMA
 * transacción. No hay SQL directo sobre el registro. Los eventos nunca contienen secretos
 * (se filtran por nombre de clave como defensa adicional).
 */
import crypto from "node:crypto";
import {
  RegistryError,
  assertTenantId,
  type ActorType,
  type DomainKind,
  type Tenant,
  type TenantDatabaseRef,
  type TenantDomain,
  type TenantStatus,
} from "./contract";
import { decryptDsn, encryptDsn, reencryptDsn, type Keyring } from "./crypto";
import { normalizeHost } from "./host";
import { assertTransition, requiresOperator } from "./lifecycle";
import type { RegistryTx, TenantRegistryStore } from "./store";

export interface Actor {
  type: ActorType;
  id: string;
  requestId?: string;
}

const SECRET_KEY_RE = /dsn|secret|password|passwd|token|cipher|credential/i;

/** Elimina de los detalles cualquier clave de aspecto sensible (defensa en profundidad). */
function safeDetails(d: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!d) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!SECRET_KEY_RE.test(k)) out[k] = v;
  return out;
}

const REASON_REQUIRED: readonly TenantStatus[] = ["suspended", "archived", "deleting", "deleted"];

export class TenantRegistryService {
  constructor(
    private store: TenantRegistryStore,
    private ring: () => Keyring,
  ) {}

  // ── Tenants ────────────────────────────────────────────────────────────────

  async createTenant(
    input: { id: string; displayName: string; baselineVersion?: string },
    actor: Actor,
  ): Promise<Tenant> {
    assertTenantId(input.id);
    if (!input.displayName.trim()) throw new RegistryError("conflict", "El nombre es obligatorio");
    return this.store.transaction(async (tx) => {
      const t = await tx.insertTenant({
        id: input.id,
        displayName: input.displayName.trim(),
        status: "provisioning",
        statusReason: null,
        baselineVersion: input.baselineVersion ?? null,
        schemaVersion: null,
      });
      await this.audit(tx, actor, t.id, "tenant.created", null, "provisioning", { displayName: t.displayName });
      return t;
    });
  }

  async setStatus(
    tenantId: string,
    to: TenantStatus,
    actor: Actor,
    opts: { reason?: string; expectedVersion?: number } = {},
  ): Promise<Tenant> {
    return this.store.transaction(async (tx) => {
      const t = await tx.getTenant(tenantId);
      if (!t) throw new RegistryError("not_found", `Tenant ${tenantId} no encontrado`);
      if (t.status === to) return t; // idempotente
      assertTransition(t.status, to);
      if (requiresOperator(to) && actor.type !== "operator") {
        throw new RegistryError("forbidden", `El estado ${to} solo puede fijarlo un operador`);
      }
      if (REASON_REQUIRED.includes(to) && !opts.reason?.trim()) {
        throw new RegistryError("conflict", `El estado ${to} exige un motivo`);
      }
      const next = await tx.updateTenant(tenantId, opts.expectedVersion ?? t.registryVersion, {
        status: to,
        statusReason: opts.reason?.trim() ?? null,
      });
      await this.audit(tx, actor, tenantId, "status.changed", t.status, to, { reason: opts.reason ?? null });
      return next;
    });
  }

  async setSchemaVersion(tenantId: string, schemaVersion: string, actor: Actor): Promise<Tenant> {
    return this.store.transaction(async (tx) => {
      const t = await this.mustTenant(tx, tenantId);
      const next = await tx.updateTenant(tenantId, t.registryVersion, { schemaVersion });
      await this.audit(tx, actor, tenantId, "schema.version", t.schemaVersion, schemaVersion);
      return next;
    });
  }

  // ── Dominios ───────────────────────────────────────────────────────────────

  async addDomain(
    tenantId: string,
    rawDomain: string,
    kind: DomainKind,
    actor: Actor,
    opts: { primary?: boolean } = {},
  ): Promise<TenantDomain> {
    const domain = normalizeHost(rawDomain);
    if (!domain) throw new RegistryError("invalid_domain", "Dominio no válido");
    return this.store.transaction(async (tx) => {
      const t = await this.mustTenant(tx, tenantId);
      if (t.status === "deleted") throw new RegistryError("conflict", "El tenant está eliminado");
      const existing = await tx.resolveDomain(domain);
      if (existing) throw new RegistryError("conflict", "El dominio ya está registrado");
      const d = await tx.insertDomain({
        domain,
        tenantId,
        kind,
        // Los subdominios de plataforma los controlamos nosotros; los propios requieren verificación DNS
        status: kind === "platform_subdomain" ? "verified" : "pending_verification",
        isPrimary: false,
        verificationToken: kind === "custom" ? crypto.randomBytes(24).toString("hex") : null,
        verifiedAt: kind === "platform_subdomain" ? new Date() : null,
        activatedAt: null,
      });
      await this.bump(tx, t);
      await this.audit(tx, actor, tenantId, "domain.added", null, d.status, { domain, kind });
      if (opts.primary) return this.makePrimaryInTx(tx, tenantId, domain, actor);
      return d;
    });
  }

  async markDomainVerified(domain: string, actor: Actor): Promise<TenantDomain> {
    return this.store.transaction(async (tx) => {
      const r = await this.mustDomain(tx, domain);
      if (r.domain.status === "verified" || r.domain.status === "active") return r.domain;
      if (r.domain.status !== "pending_verification") {
        throw new RegistryError("invalid_transition", `El dominio está ${r.domain.status}`);
      }
      const d = await tx.updateDomain(domain, { status: "verified", verifiedAt: new Date(), verificationToken: null });
      await this.bump(tx, r.tenant);
      await this.audit(tx, actor, r.tenant.id, "domain.verified", "pending_verification", "verified", { domain });
      return d;
    });
  }

  async activateDomain(domain: string, actor: Actor): Promise<TenantDomain> {
    return this.store.transaction(async (tx) => {
      const r = await this.mustDomain(tx, domain);
      if (r.domain.status === "active") return r.domain;
      if (r.domain.status !== "verified" && r.domain.status !== "disabled") {
        throw new RegistryError("invalid_transition", "Solo se activan dominios verificados");
      }
      const d = await tx.updateDomain(domain, { status: "active", activatedAt: new Date() });
      await this.bump(tx, r.tenant);
      await this.audit(tx, actor, r.tenant.id, "domain.activated", r.domain.status, "active", { domain });
      return d;
    });
  }

  async disableDomain(domain: string, actor: Actor, reason?: string): Promise<TenantDomain> {
    return this.store.transaction(async (tx) => {
      const r = await this.mustDomain(tx, domain);
      if (r.domain.status === "disabled" || r.domain.status === "removed") return r.domain;
      const d = await tx.updateDomain(domain, { status: "disabled", isPrimary: false });
      await this.bump(tx, r.tenant);
      await this.audit(tx, actor, r.tenant.id, "domain.disabled", r.domain.status, "disabled", { domain, reason: reason ?? null });
      return d;
    });
  }

  async setPrimaryDomain(tenantId: string, domain: string, actor: Actor): Promise<TenantDomain> {
    return this.store.transaction((tx) => this.makePrimaryInTx(tx, tenantId, domain, actor));
  }

  private async makePrimaryInTx(tx: RegistryTx, tenantId: string, domain: string, actor: Actor) {
    const r = await this.mustDomain(tx, domain);
    if (r.tenant.id !== tenantId) throw new RegistryError("forbidden", "El dominio no pertenece a ese tenant");
    for (const other of await tx.listDomains(tenantId)) {
      if (other.isPrimary && other.domain !== domain) await tx.updateDomain(other.domain, { isPrimary: false });
    }
    const d = await tx.updateDomain(domain, { isPrimary: true });
    await this.bump(tx, await this.mustTenant(tx, tenantId));
    await this.audit(tx, actor, tenantId, "domain.primary", null, null, { domain });
    return d;
  }

  // ── Base de datos ──────────────────────────────────────────────────────────

  /** Registra la BD de un tenant en estado `pending`. El DSN se guarda solo cifrado. */
  async registerDatabase(
    tenantId: string,
    dsn: string,
    actor: Actor,
    opts: { serverAlias?: string } = {},
  ): Promise<TenantDatabaseRef> {
    if (!/^mysql:\/\//i.test(dsn)) throw new RegistryError("conflict", "El DSN debe ser mysql://");
    return this.store.transaction(async (tx) => {
      const t = await this.mustTenant(tx, tenantId);
      const { cipher, keyId } = encryptDsn(dsn, tenantId, this.ring());
      const ref = await tx.insertDatabase({
        tenantId,
        state: "pending",
        dsnCipher: cipher,
        keyId,
        serverAlias: opts.serverAlias ?? null,
      });
      await this.bump(tx, t);
      await this.audit(tx, actor, tenantId, "database.registered", null, "pending", {
        databaseId: ref.id,
        keyId,
        serverAlias: ref.serverAlias,
      });
      return ref;
    });
  }

  /** Activa una BD pendiente y retira la activa anterior (movimiento sin corte). */
  async activateDatabase(tenantId: string, databaseId: number, actor: Actor): Promise<TenantDatabaseRef> {
    return this.store.transaction(async (tx) => {
      const t = await this.mustTenant(tx, tenantId);
      const all = await tx.listDatabases(tenantId);
      const target = all.find((d) => d.id === databaseId);
      if (!target) throw new RegistryError("not_found", "Base de datos no encontrada para ese tenant");
      if (target.state === "active") return target;
      if (target.state === "retired") throw new RegistryError("invalid_transition", "Una BD retirada no se reactiva");
      const prev = all.find((d) => d.state === "active");
      if (prev) await tx.updateDatabase(prev.id, { state: "retired" });
      const next = await tx.updateDatabase(databaseId, { state: "active" });
      await this.bump(tx, t);
      await this.audit(tx, actor, tenantId, "database.activated", target.state, "active", {
        databaseId,
        retiredDatabaseId: prev?.id ?? null,
      });
      return next;
    });
  }

  /** Descifra el DSN activo (uso interno del resolvedor de conexiones; nunca se registra). */
  async getActiveDsn(tenantId: string): Promise<string | null> {
    const ref = await this.store.getActiveDatabase(tenantId);
    return ref ? decryptDsn(ref.dsnCipher, ref.keyId, tenantId, this.ring()) : null;
  }

  /** Re-cifra todas las credenciales con la clave activa. Devuelve cuántas se rotaron. */
  async rotateKeys(actor: Actor): Promise<number> {
    return this.store.transaction(async (tx) => {
      let n = 0;
      for (const t of await tx.listTenants()) {
        for (const d of await tx.listDatabases(t.id)) {
          const re = reencryptDsn(d.dsnCipher, d.keyId, t.id, this.ring());
          if (!re) continue;
          await tx.updateDatabase(d.id, { dsnCipher: re.cipher, keyId: re.keyId, rotatedAt: new Date() });
          await this.audit(tx, actor, t.id, "database.key_rotated", d.keyId, re.keyId, { databaseId: d.id });
          n++;
        }
      }
      return n;
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async mustTenant(tx: RegistryTx, id: string): Promise<Tenant> {
    const t = await tx.getTenant(id);
    if (!t) throw new RegistryError("not_found", `Tenant ${id} no encontrado`);
    return t;
  }

  private async mustDomain(tx: RegistryTx, domain: string) {
    const d = normalizeHost(domain);
    const r = d ? await tx.resolveDomain(d) : null;
    if (!r) throw new RegistryError("not_found", "Dominio no encontrado");
    return r;
  }

  /** Incrementa la versión del tenant (invalida cachés) sin cambiar nada más. */
  private async bump(tx: RegistryTx, t: Tenant) {
    const cur = await tx.getTenant(t.id);
    if (cur) await tx.updateTenant(t.id, cur.registryVersion, {});
  }

  private async audit(
    tx: RegistryTx,
    actor: Actor,
    tenantId: string,
    action: string,
    from: string | null,
    to: string | null,
    details?: Record<string, unknown>,
  ) {
    await tx.insertEvent({
      tenantId,
      actorType: actor.type,
      actorId: actor.id,
      action,
      fromState: from,
      toState: to,
      details: safeDetails(details),
      requestId: actor.requestId ?? null,
    });
  }
}
