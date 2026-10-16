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
import type { SubscriptionStore } from "../subscriptions/store";

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

export interface OrganizationStore {
  sites(tenantId: string): Promise<Site[]>;
  fiscalEntities(tenantId: string): Promise<FiscalEntity[]>;
  insertSite(s: Site): Promise<void>;
  updateSite(tenantId: string, siteId: string, patch: Partial<Pick<Site, "name" | "fiscalEntityId" | "status" | "updatedAt">>): Promise<void>;
  insertFiscalEntity(f: FiscalEntity): Promise<void>;
  updateFiscalEntity(tenantId: string, entityId: string, patch: Partial<Pick<FiscalEntity, "legalName" | "address" | "isDefault" | "status" | "updatedAt">>): Promise<void>;
}

export class MemoryOrganizationStore implements OrganizationStore {
  private s = new Map<string, Site>();
  private f = new Map<string, FiscalEntity>();
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
/** Límites por defecto sin suscripción (mínimo de Essential). */
const FALLBACK = { sites: 1, fiscal_entities: 1 };

export class OrganizationService {
  private now: () => number;
  constructor(
    private d: {
      store: OrganizationStore;
      subscriptions: Pick<SubscriptionStore, "list" | "items">;
      catalog: () => Promise<QuoteCatalog>;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  /** Límites vigentes del tenant según su suscripción viva (null = por contrato, sin tope técnico). */
  async limits(tenantId: string): Promise<{ sites: number | null; fiscal_entities: number | null; source: string }> {
    const sub = (await this.d.subscriptions.list({})).find((s) => s.tenantId === tenantId && s.status !== "canceled");
    if (!sub) return { ...FALLBACK, source: "sin suscripción (mínimo de Essential)" };
    const now = this.now();
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
    return { sites: sites === null ? null : sites + extra("sites"), fiscal_entities: fiscal === null ? null : fiscal + extra("fiscal_entities"), source: `suscripción #${sub.id}` };
  }

  async overview(tenantId: string) {
    const [sites, fiscalEntities, limits] = await Promise.all([this.d.store.sites(tenantId), this.d.store.fiscalEntities(tenantId), this.limits(tenantId)]);
    return { sites, fiscalEntities, limits, used: { sites: sites.filter((s) => s.status === "active").length, fiscal_entities: fiscalEntities.filter((f) => f.status === "active").length } };
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
}
