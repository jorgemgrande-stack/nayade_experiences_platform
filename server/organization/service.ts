/**
 * Organización de cada empresa cliente: sedes y entidades fiscales (Elephant Control).
 *
 *  - Límites del plan contratado (catálogo): sedes (Essential 1, Business 5 + sedes adicionales
 *    compradas, Enterprise por contrato) y entidades fiscales (1; varias solo con Enterprise).
 *    Superar el límite impide CREAR; nunca borra ni archiva nada por sí solo.
 *  - Nada se elimina: se archiva. Una entidad fiscal con sedes activas no se archiva.
 *  - Sin suscripción viva, rige el mínimo de Essential (1 y 1).
 */
import type mysql from "mysql2/promise";
import type { QuoteCatalog } from "../catalog/quote";
import { isEconomicOnly } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { includedUsers } from "../planSeats";
import { activeException } from "../_core/erm/policy";
import type { QuotaExceptionReader } from "../_core/erm/quotaExceptions";
import { PRIMARY_SITE_ID, siteIdFromName, validateSiteForm, type PanelSite, type PanelSites, type SiteFormInput } from "../../shared/sites";

export interface Site {
  tenantId: string;
  siteId: string;
  name: string;
  fiscalEntityId: string | null;
  status: "active" | "archived";
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}
export interface FiscalEntity {
  tenantId: string;
  entityId: string;
  legalName: string;
  taxId: string;
  country: string;
  address: string | null;
  isDefault: boolean;
  status: "active" | "archived";
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}

export class OrganizationError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "conflict" | "limit",
    message: string,
  ) {
    super(message);
  }
}

/** Datos de contacto de una sede (registro 0017, `tenant_site_details`). */
export interface SiteDetails {
  tenantId: string;
  siteId: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  updatedAt: number;
  updatedBy: string;
}

export interface OrganizationStore {
  sites(tenantId: string): Promise<Site[]>;
  fiscalEntities(tenantId: string): Promise<FiscalEntity[]>;
  insertSite(s: Site): Promise<void>;
  updateSite(tenantId: string, siteId: string, patch: Partial<Pick<Site, "name" | "fiscalEntityId" | "status" | "updatedAt">>): Promise<void>;
  insertFiscalEntity(f: FiscalEntity): Promise<void>;
  updateFiscalEntity(tenantId: string, entityId: string, patch: Partial<Pick<FiscalEntity, "legalName" | "address" | "isDefault" | "status" | "updatedAt">>): Promise<void>;
  /** Datos de contacto de las sedes (opcional: sin la tabla, las sedes no tienen contacto). */
  siteDetails?(tenantId: string): Promise<SiteDetails[]>;
  upsertSiteDetails?(d: SiteDetails): Promise<void>;
}

export class MemoryOrganizationStore implements OrganizationStore {
  private s = new Map<string, Site>();
  private f = new Map<string, FiscalEntity>();
  private d = new Map<string, SiteDetails>();
  async siteDetails(t: string) {
    return Array.from(this.d.values()).filter((x) => x.tenantId === t).map((x) => ({ ...x }));
  }
  async upsertSiteDetails(x: SiteDetails) {
    this.d.set(`${x.tenantId}\u0000${x.siteId}`, { ...x });
  }
  async sites(t: string) {
    return Array.from(this.s.values()).filter((x) => x.tenantId === t).map((x) => ({ ...x }));
  }
  async fiscalEntities(t: string) {
    return Array.from(this.f.values()).filter((x) => x.tenantId === t).map((x) => ({ ...x }));
  }
  async insertSite(x: Site) {
    const k = `${x.tenantId}\u0000${x.siteId}`;
    if (this.s.has(k)) throw new OrganizationError("conflict", "Ya existe una sede con ese identificador");
    this.s.set(k, { ...x });
  }
  async updateSite(t: string, id: string, p: Partial<Site>) {
    const k = `${t}\u0000${id}`;
    this.s.set(k, { ...this.s.get(k)!, ...p });
  }
  async insertFiscalEntity(x: FiscalEntity) {
    const k = `${x.tenantId}\u0000${x.entityId}`;
    if (this.f.has(k) || Array.from(this.f.values()).some((y) => y.tenantId === x.tenantId && y.taxId === x.taxId)) throw new OrganizationError("conflict", "Ya existe una entidad fiscal con ese identificador o NIF");
    this.f.set(k, { ...x });
  }
  async updateFiscalEntity(t: string, id: string, p: Partial<FiscalEntity>) {
    const k = `${t}\u0000${id}`;
    this.f.set(k, { ...this.f.get(k)!, ...p });
  }
}

const siteRow = (r: mysql.RowDataPacket): Site => ({
  tenantId: String(r.tenant_id),
  siteId: String(r.site_id),
  name: String(r.name),
  fiscalEntityId: (r.fiscal_entity_id as string) ?? null,
  status: r.status,
  createdAt: Number(r.created_at),
  createdBy: String(r.created_by),
  updatedAt: Number(r.updated_at),
});
const fiscalRow = (r: mysql.RowDataPacket): FiscalEntity => ({
  tenantId: String(r.tenant_id),
  entityId: String(r.entity_id),
  legalName: String(r.legal_name),
  taxId: String(r.tax_id),
  country: String(r.country),
  address: (r.address as string) ?? null,
  isDefault: Number(r.is_default) === 1,
  status: r.status,
  createdAt: Number(r.created_at),
  createdBy: String(r.created_by),
  updatedAt: Number(r.updated_at),
});
const dup = (e: unknown, msg: string) => {
  if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new OrganizationError("conflict", msg);
  throw e;
};

export class MysqlOrganizationStore implements OrganizationStore {
  constructor(private pool: mysql.Pool) {}
  async siteDetails(t: string) {
    try {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_site_details WHERE tenant_id = ?", [t]);
      return rows.map(
        (r): SiteDetails => ({
          tenantId: String(r.tenant_id),
          siteId: String(r.site_id),
          address: (r.address as string) ?? null,
          phone: (r.phone as string) ?? null,
          email: (r.email as string) ?? null,
          updatedAt: Number(r.updated_at),
          updatedBy: String(r.updated_by),
        }),
      );
    } catch (e) {
      // Registro sin la migración 0017: las sedes siguen funcionando, sin datos de contacto
      if ((e as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
      throw e;
    }
  }
  async upsertSiteDetails(x: SiteDetails) {
    await this.pool
      .query(
        "INSERT INTO tenant_site_details (tenant_id, site_id, address, phone, email, updated_at, updated_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE address = VALUES(address), phone = VALUES(phone), email = VALUES(email), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)",
        [x.tenantId, x.siteId, x.address, x.phone, x.email, x.updatedAt, x.updatedBy],
      )
      .catch((e) => {
        if ((e as { code?: string }).code === "ER_NO_SUCH_TABLE") throw new OrganizationError("conflict", "Los datos de contacto de las sedes aún no están disponibles");
        throw e;
      });
  }
  async sites(t: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_sites WHERE tenant_id = ? ORDER BY created_at, site_id", [t]);
    return rows.map(siteRow);
  }
  async fiscalEntities(t: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_fiscal_entities WHERE tenant_id = ? ORDER BY created_at, entity_id", [t]);
    return rows.map(fiscalRow);
  }
  async insertSite(x: Site) {
    await this.pool
      .query("INSERT INTO tenant_sites (tenant_id, site_id, name, fiscal_entity_id, status, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?)", [x.tenantId, x.siteId, x.name, x.fiscalEntityId, x.status, x.createdAt, x.createdBy, x.updatedAt])
      .catch((e) => dup(e, "Ya existe una sede con ese identificador"));
  }
  async updateSite(t: string, id: string, p: Partial<Site>) {
    const cols: string[] = [];
    const args: unknown[] = [];
    if (p.name !== undefined) (cols.push("name = ?"), args.push(p.name));
    if (p.fiscalEntityId !== undefined) (cols.push("fiscal_entity_id = ?"), args.push(p.fiscalEntityId));
    if (p.status !== undefined) (cols.push("status = ?"), args.push(p.status));
    cols.push("updated_at = ?");
    args.push(p.updatedAt ?? Date.now());
    await this.pool.query(`UPDATE tenant_sites SET ${cols.join(", ")} WHERE tenant_id = ? AND site_id = ?`, [...args, t, id]);
  }
  async insertFiscalEntity(x: FiscalEntity) {
    await this.pool
      .query("INSERT INTO tenant_fiscal_entities (tenant_id, entity_id, legal_name, tax_id, country, address, is_default, status, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
        x.tenantId,
        x.entityId,
        x.legalName,
        x.taxId,
        x.country,
        x.address,
        x.isDefault ? 1 : 0,
        x.status,
        x.createdAt,
        x.createdBy,
        x.updatedAt,
      ])
      .catch((e) => dup(e, "Ya existe una entidad fiscal con ese identificador o NIF"));
  }
  async updateFiscalEntity(t: string, id: string, p: Partial<FiscalEntity>) {
    const cols: string[] = [];
    const args: unknown[] = [];
    if (p.legalName !== undefined) (cols.push("legal_name = ?"), args.push(p.legalName));
    if (p.address !== undefined) (cols.push("address = ?"), args.push(p.address));
    if (p.isDefault !== undefined) (cols.push("is_default = ?"), args.push(p.isDefault ? 1 : 0));
    if (p.status !== undefined) (cols.push("status = ?"), args.push(p.status));
    cols.push("updated_at = ?");
    args.push(p.updatedAt ?? Date.now());
    await this.pool.query(`UPDATE tenant_fiscal_entities SET ${cols.join(", ")} WHERE tenant_id = ? AND entity_id = ?`, [...args, t, id]);
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Límites por defecto sin suscripción (mínimo de Essential; usuarios, los del catálogo oficial). */
const FALLBACK = { sites: 1, fiscal_entities: 1, users: includedUsers("essential") ?? 3 };

export class OrganizationService {
  private now: () => number;
  constructor(
    private d: {
      store: OrganizationStore;
      subscriptions: Pick<SubscriptionStore, "list" | "items">;
      catalog: () => Promise<QuoteCatalog>;
      now?: () => number;
      /** Excepciones comerciales de cuota (registro 0016): mandan sobre lo contratado mientras están vigentes. */
      exceptions?: QuotaExceptionReader;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  /** Límites vigentes del tenant: su suscripción viva (null = por contrato, sin tope técnico) o la excepción comercial vigente. */
  async limits(tenantId: string): Promise<{ sites: number | null; fiscal_entities: number | null; users: number | null; source: string }> {
    const base = await this.contractLimits(tenantId);
    if (!this.d.exceptions) return base;
    // Si las excepciones no se pueden leer, se aplica lo contratado (nunca más de lo contratado por un fallo)
    const list = await this.d.exceptions.exceptions(tenantId).catch(() => []);
    const now = this.now();
    const out = { ...base };
    const applied: string[] = [];
    for (const m of ["sites", "fiscal_entities", "users"] as const) {
      const e = activeException(list, m, "total", now);
      if (!e) continue;
      out[m] = e.newLimit;
      applied.push(`excepción #${e.id} (${m})`);
    }
    return applied.length ? { ...out, source: `${base.source} + ${applied.join(", ")}` } : base;
  }

  private async contractLimits(tenantId: string): Promise<{ sites: number | null; fiscal_entities: number | null; users: number | null; source: string }> {
    const now = this.now();
    // La suscripción del SaaS de la plataforma: una solo económica (sin plan ni productos de plataforma) no define límites
    let sub: Awaited<ReturnType<typeof this.d.subscriptions.list>>[number] | undefined;
    for (const s of (await this.d.subscriptions.list({})).filter((x) => x.tenantId === tenantId && x.status !== "canceled")) {
      if (isEconomicOnly(await this.d.subscriptions.items(s.id), now)) continue;
      sub = s;
      break;
    }
    if (!sub) return { ...FALLBACK, source: "sin suscripción (mínimo de Essential)" };
    const items = (await this.d.subscriptions.items(sub.id)).filter((i) => i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now));
    const catalog = await this.d.catalog();
    const byKey = new Map(catalog.products.map((p) => [p.key, p]));
    const plan = items.find((i) => i.family === "core_plan");
    const quota = (metric: string): number | null => {
      for (let p = plan ? byKey.get(plan.productKey) : undefined, g = 0; p && g < 10; p = p.inherits ? byKey.get(p.inherits) : undefined, g++) {
        const q = p.quotas.find((x) => x.metric === metric);
        if (q) return q.included;
      }
      return (FALLBACK as Record<string, number>)[metric] ?? null;
    };
    const extra = (metric: string) =>
      items.reduce((a, i) => {
        const p = byKey.get(i.productKey);
        return p?.addonFor?.metric === metric ? a + i.quantity * p.addonFor.step : a;
      }, 0);
    const sites = quota("sites");
    const fiscal = quota("fiscal_entities");
    const users = quota("users");
    return {
      sites: sites === null ? null : sites + extra("sites"),
      fiscal_entities: fiscal === null ? null : fiscal + extra("fiscal_entities"),
      users: users === null ? null : users + extra("users"),
      source: `suscripción #${sub.id}`,
    };
  }

  async overview(tenantId: string) {
    const [sites, fiscalEntities, limits] = await Promise.all([this.d.store.sites(tenantId), this.d.store.fiscalEntities(tenantId), this.limits(tenantId)]);
    return {
      sites,
      fiscalEntities,
      limits,
      used: {
        sites: sites.filter((s) => s.status === "active").length,
        fiscal_entities: fiscalEntities.filter((f) => f.status === "active").length,
        // Los usuarios viven en la base de datos de cada empresa, a la que el plano de control no accede
        // (solo guarda su DSN cifrado para el aprovisionamiento): no se cuentan aquí. El recuento real lo
        // aplica la propia empresa al invitar (planSeats). null = no disponible desde el plano de control.
        users: null as number | null,
      },
    };
  }

  async createFiscalEntity(tenantId: string, input: { entityId: string; legalName: string; taxId: string; country?: string; address?: string | null }, actor: string) {
    if (!ID_RE.test(input.entityId)) throw new OrganizationError("invalid_input", "Identificador no válido (minúsculas, números y guiones)");
    const legalName = input.legalName.trim();
    const taxId = input.taxId.trim().toUpperCase().replace(/[\s.-]/g, "");
    if (legalName.length < 2) throw new OrganizationError("invalid_input", "Razón social obligatoria");
    if (!/^[A-Z0-9]{5,20}$/.test(taxId)) throw new OrganizationError("invalid_input", "Identificador fiscal no válido");
    const { fiscal_entities: max } = await this.limits(tenantId);
    const current = (await this.d.store.fiscalEntities(tenantId)).filter((f) => f.status === "active");
    if (max !== null && current.length >= max) throw new OrganizationError("limit", `El plan contratado permite ${max} entidad(es) fiscal(es); varias entidades fiscales requieren Enterprise`);
    const now = this.now();
    await this.d.store.insertFiscalEntity({ tenantId, entityId: input.entityId, legalName, taxId, country: (input.country ?? "ES").toUpperCase(), address: input.address?.trim() || null, isDefault: current.length === 0, status: "active", createdAt: now, createdBy: actor.slice(0, 100), updatedAt: now });
    return this.overview(tenantId);
  }

  async createSite(tenantId: string, input: { siteId: string; name: string; fiscalEntityId?: string | null }, actor: string) {
    if (!ID_RE.test(input.siteId)) throw new OrganizationError("invalid_input", "Identificador no válido (minúsculas, números y guiones)");
    const name = input.name.trim();
    if (name.length < 2) throw new OrganizationError("invalid_input", "Nombre de sede obligatorio");
    const { sites: max } = await this.limits(tenantId);
    const active = (await this.d.store.sites(tenantId)).filter((s) => s.status === "active");
    if (max !== null && active.length >= max) throw new OrganizationError("limit", `El plan contratado permite ${max} sede(s): contrata sedes adicionales o un plan superior`);
    let fiscal = input.fiscalEntityId ?? null;
    const entities = (await this.d.store.fiscalEntities(tenantId)).filter((f) => f.status === "active");
    if (fiscal && !entities.some((f) => f.entityId === fiscal)) throw new OrganizationError("invalid_input", "La entidad fiscal no existe o está archivada");
    if (!fiscal) fiscal = entities.find((f) => f.isDefault)?.entityId ?? null;
    const now = this.now();
    await this.d.store.insertSite({ tenantId, siteId: input.siteId, name, fiscalEntityId: fiscal, status: "active", createdAt: now, createdBy: actor.slice(0, 100), updatedAt: now });
    return this.overview(tenantId);
  }

  async archiveSite(tenantId: string, siteId: string) {
    const site = (await this.d.store.sites(tenantId)).find((s) => s.siteId === siteId);
    if (!site) throw new OrganizationError("not_found", "Sede no encontrada");
    await this.d.store.updateSite(tenantId, siteId, { status: "archived", updatedAt: this.now() });
    return this.overview(tenantId);
  }

  async archiveFiscalEntity(tenantId: string, entityId: string) {
    const all = await this.d.store.fiscalEntities(tenantId);
    if (!all.some((f) => f.entityId === entityId)) throw new OrganizationError("not_found", "Entidad fiscal no encontrada");
    if ((await this.d.store.sites(tenantId)).some((s) => s.status === "active" && s.fiscalEntityId === entityId)) throw new OrganizationError("conflict", "Hay sedes activas que emiten con esta entidad fiscal: reasígnalas antes");
    await this.d.store.updateFiscalEntity(tenantId, entityId, { status: "archived", isDefault: false, updatedAt: this.now() });
    return this.overview(tenantId);
  }

  // ── Sedes desde el panel de la propia empresa (capacidad Business `multi-site`; el Core comprueba la licencia) ──

  private async orderedSites(tenantId: string) {
    // A igual fecha de alta, la principal implícita va primero (se crea justo antes que la sede que la obliga a existir)
    return (await this.d.store.sites(tenantId)).sort((a, b) => a.createdAt - b.createdAt || Number(b.siteId === PRIMARY_SITE_ID) - Number(a.siteId === PRIMARY_SITE_ID) || a.siteId.localeCompare(b.siteId));
  }

  /** Sedes de la empresa para su panel: la principal (también implícita), datos de contacto y límite del plan. */
  async panelSites(tenantId: string): Promise<PanelSites> {
    const [sites, details, limits] = await Promise.all([this.orderedSites(tenantId), this.d.store.siteDetails?.(tenantId) ?? Promise.resolve([]), this.limits(tenantId)]);
    const contact = new Map(details.map((x) => [x.siteId, x]));
    const primary = sites.find((s) => s.status === "active") ?? null;
    const list: PanelSite[] = sites.map((s) => ({
      siteId: s.siteId,
      name: s.name,
      status: s.status,
      isPrimary: s.siteId === primary?.siteId,
      virtual: false,
      address: contact.get(s.siteId)?.address ?? null,
      phone: contact.get(s.siteId)?.phone ?? null,
      email: contact.get(s.siteId)?.email ?? null,
      createdAt: s.createdAt,
    }));
    if (!primary) list.unshift({ siteId: PRIMARY_SITE_ID, name: "Sede principal", status: "active", isPrimary: true, virtual: true, address: null, phone: null, email: null, createdAt: null });
    const used = Math.max(1, sites.filter((s) => s.status === "active").length);
    return { sites: list, primarySiteId: primary?.siteId ?? PRIMARY_SITE_ID, limit: limits.sites, used, canAdd: limits.sites === null || used < limits.sites };
  }

  /** Lleva la principal implícita al registro (sin cambiar nada si ya hay una sede activa). */
  private async ensurePrimary(tenantId: string, actor: string, name?: string) {
    const sites = await this.orderedSites(tenantId);
    const active = sites.find((s) => s.status === "active");
    if (active) return active.siteId;
    const now = this.now();
    if (sites.some((s) => s.siteId === PRIMARY_SITE_ID)) {
      await this.d.store.updateSite(tenantId, PRIMARY_SITE_ID, { status: "active", ...(name ? { name } : {}), updatedAt: now });
    } else {
      const fiscal = (await this.d.store.fiscalEntities(tenantId)).find((f) => f.status === "active" && f.isDefault)?.entityId ?? null;
      await this.d.store.insertSite({ tenantId, siteId: PRIMARY_SITE_ID, name: name ?? "Sede principal", fiscalEntityId: fiscal, status: "active", createdAt: now, createdBy: actor.slice(0, 100), updatedAt: now });
    }
    return PRIMARY_SITE_ID;
  }

  private async saveContact(tenantId: string, siteId: string, input: { address?: string | null; phone?: string | null; email?: string | null }, actor: string) {
    if (input.address === undefined && input.phone === undefined && input.email === undefined) return;
    if (!this.d.store.siteDetails || !this.d.store.upsertSiteDetails) throw new OrganizationError("conflict", "Los datos de contacto de las sedes aún no están disponibles");
    const prev = (await this.d.store.siteDetails(tenantId)).find((x) => x.siteId === siteId);
    const pick = (v: string | null | undefined, old: string | null | undefined) => (v === undefined ? old ?? null : v?.trim() || null);
    await this.d.store.upsertSiteDetails({
      tenantId,
      siteId,
      address: pick(input.address, prev?.address),
      phone: pick(input.phone, prev?.phone),
      email: pick(input.email, prev?.email),
      updatedAt: this.now(),
      updatedBy: actor.slice(0, 100),
    });
  }

  private static assertForm(input: SiteFormInput) {
    const errors = validateSiteForm(input);
    const first = Object.values(errors)[0];
    if (first) throw new OrganizationError("invalid_input", first);
  }

  /** Alta desde el panel: id a partir del nombre; la principal implícita pasa antes al registro (cuenta en el límite). */
  async createPanelSite(tenantId: string, input: SiteFormInput, actor: string): Promise<PanelSites> {
    OrganizationService.assertForm(input);
    const name = input.name.trim();
    const sites = await this.d.store.sites(tenantId);
    const active = sites.filter((s) => s.status === "active").length;
    const { sites: max } = await this.limits(tenantId);
    if (max !== null && Math.max(1, active) + 1 > max) throw new OrganizationError("limit", `El plan contratado permite ${max} sede(s): contrata sedes adicionales o un plan superior`);
    await this.ensurePrimary(tenantId, actor);
    const siteId = siteIdFromName(name, [...sites.map((s) => s.siteId), PRIMARY_SITE_ID]);
    await this.createSite(tenantId, { siteId, name }, actor);
    await this.saveContact(tenantId, siteId, input, actor);
    return this.panelSites(tenantId);
  }

  /** Nombre y datos de contacto. La principal implícita se crea en el registro al editarla. */
  async updatePanelSite(tenantId: string, siteId: string, input: Partial<SiteFormInput>, actor: string): Promise<PanelSites> {
    if (input.name !== undefined || input.address !== undefined || input.phone !== undefined || input.email !== undefined) {
      OrganizationService.assertForm({ name: input.name ?? "xx", address: input.address, phone: input.phone, email: input.email });
    }
    const current = await this.panelSites(tenantId);
    const site = current.sites.find((s) => s.siteId === siteId);
    if (!site) throw new OrganizationError("not_found", "Sede no encontrada");
    const name = input.name?.trim();
    if (site.virtual) await this.ensurePrimary(tenantId, actor, name);
    else if (name && name !== site.name) await this.d.store.updateSite(tenantId, siteId, { name, updatedAt: this.now() });
    await this.saveContact(tenantId, siteId, input, actor);
    return this.panelSites(tenantId);
  }

  /** Desactivar (archivar): nunca la principal, que es donde quedan los datos sin sede. */
  async archivePanelSite(tenantId: string, siteId: string): Promise<PanelSites> {
    const site = (await this.panelSites(tenantId)).sites.find((s) => s.siteId === siteId);
    if (!site) throw new OrganizationError("not_found", "Sede no encontrada");
    if (site.isPrimary) throw new OrganizationError("conflict", "La sede principal no se puede desactivar");
    if (site.status === "active") await this.archiveSite(tenantId, siteId);
    return this.panelSites(tenantId);
  }

  /** Reactivar una sede archivada, dentro del límite del plan. */
  async restorePanelSite(tenantId: string, siteId: string): Promise<PanelSites> {
    const all = await this.d.store.sites(tenantId);
    const site = all.find((s) => s.siteId === siteId);
    if (!site) throw new OrganizationError("not_found", "Sede no encontrada");
    if (site.status === "active") return this.panelSites(tenantId);
    const { sites: max } = await this.limits(tenantId);
    const active = all.filter((s) => s.status === "active").length;
    // Sin ninguna activa, la reactivada pasa a ser la principal (ocupa el sitio de la implícita)
    if (max !== null && (active === 0 ? 1 : active + 1) > max) throw new OrganizationError("limit", `El plan contratado permite ${max} sede(s): contrata sedes adicionales o un plan superior`);
    await this.d.store.updateSite(tenantId, siteId, { status: "active", updatedAt: this.now() });
    return this.panelSites(tenantId);
  }
}
