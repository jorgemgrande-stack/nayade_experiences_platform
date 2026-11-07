/**
 * Travel Net — acceso a datos. Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant). Tablas de
 * db/migrations/0040_travel_net (fuera de drizzle/schema.ts, como las de 0021/0025): sin la migración, cada función
 * responde con un error claro (`[module_not_installed]`).
 *
 * Reutiliza el Core: los proveedores son `suppliers` (aquí, solo su perfil turístico y contactos); el presupuesto y la
 * reserva los crea `service.ts` con los procedimientos del CRM (`crm.leads.convertToQuote`, `crm.quotes.update`,
 * `crm.quotes.convertToReservation`).
 */
import { TRPCError } from "@trpc/server";
import { eq, sql, type SQL } from "drizzle-orm";
import { int, mysqlTable } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import { isDeadlock } from "../creditNoteNumber";
import type { MarginRule, MarginScope, OperationStatus } from "./rules";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Exec = Pick<Db, "execute" | "delete">;

export const TRAVEL_NOT_INSTALLED_MESSAGE =
  "[module_not_installed] Travel Net aún no está preparado en tu empresa: falta aplicar la actualización 0040_travel_net de su base de datos.";

/** Solo para borrar con el ORM (el resto de lecturas y escrituras van en SQL explícito). */
const travelFileServices = mysqlTable("travel_file_services", { id: int("id").autoincrement().primaryKey() });
const travelSupplierContacts = mysqlTable("travel_supplier_contacts", { id: int("id").autoincrement().primaryKey() });

function errCode(e: unknown): string | undefined {
  for (let x: any = e, i = 0; x && i < 5; x = x.cause, i++) if (typeof x.code === "string" && x.code.startsWith("ER_")) return x.code;
  return undefined;
}

export async function travel<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const c = errCode(e);
    if (c === "ER_NO_SUCH_TABLE" || c === "ER_BAD_FIELD_ERROR") throw new TRPCError({ code: "PRECONDITION_FAILED", message: TRAVEL_NOT_INSTALLED_MESSAGE, cause: e });
    if (c === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe.", cause: e });
    throw e;
  }
}

export async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

export async function rows<T>(exec: Pick<Db, "execute">, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

export async function insertId(exec: Pick<Db, "execute">, q: SQL): Promise<number> {
  const [r] = (await exec.execute(q)) as unknown as [{ insertId: number }];
  return Number(r.insertId);
}

export async function inTx<T>(fn: (tx: Exec) => Promise<T>): Promise<T> {
  const d = await db();
  for (let attempt = 1; ; attempt++) {
    try {
      return await d.transaction((tx) => fn(tx as unknown as Exec), { isolationLevel: "read committed" });
    } catch (err) {
      if (attempt >= 5 || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * attempt));
    }
  }
}

export async function audit(exec: Pick<Db, "execute">, entityType: string, entityId: number, action: string, actorUserId: number | null, details: Record<string, unknown> = {}) {
  await exec.execute(sql`
    INSERT INTO travel_audit_log (entity_type, entity_id, action, actor_user_id, details_json, created_at)
    VALUES (${entityType}, ${entityId}, ${action}, ${actorUserId}, ${JSON.stringify(details)}, ${Date.now()})`);
}

// ─── Expedientes ──────────────────────────────────────────────────────────────

export interface FileRow {
  id: number;
  file_number: string | null;
  site_id: string | null;
  title: string;
  status: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  start_date: string | null;
  end_date: string | null;
  adults: number;
  children: number;
  fiscal_regime: "reav" | "general";
  tax_rate_bp: number;
  lead_id: number | null;
  quote_id: number | null;
  reservation_id: number | null;
  notes: string | null;
  created_at: number | string;
  updated_at: number | string;
}

export const toFile = (r: FileRow) => ({
  id: Number(r.id),
  fileNumber: r.file_number,
  siteId: r.site_id,
  title: r.title,
  status: r.status,
  clientName: r.client_name,
  clientEmail: r.client_email,
  clientPhone: r.client_phone,
  startDate: r.start_date,
  endDate: r.end_date,
  adults: Number(r.adults),
  children: Number(r.children),
  fiscalRegime: r.fiscal_regime,
  taxRateBp: Number(r.tax_rate_bp),
  leadId: r.lead_id === null ? null : Number(r.lead_id),
  quoteId: r.quote_id === null ? null : Number(r.quote_id),
  reservationId: r.reservation_id === null ? null : Number(r.reservation_id),
  notes: r.notes,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
export type TravelFile = ReturnType<typeof toFile>;

const FILE_COLUMNS = sql.raw(
  "id, file_number, site_id, title, status, client_name, client_email, client_phone, start_date, end_date, adults, children, fiscal_regime, " +
    "tax_rate_bp, lead_id, quote_id, reservation_id, notes, created_at, updated_at",
);

export async function getFile(exec: Pick<Db, "execute">, id: number, lock = false): Promise<TravelFile | null> {
  const [r] = await rows<FileRow>(exec, sql`SELECT ${FILE_COLUMNS} FROM travel_files WHERE id = ${id} ${lock ? sql`FOR UPDATE` : sql``}`);
  return r ? toFile(r) : null;
}

export async function listFiles(exec: Pick<Db, "execute">, f: { status?: string; search?: string; site?: { siteId: string; isPrimary: boolean } | null; limit?: number }) {
  const where: SQL[] = [sql`1 = 1`];
  if (f.status) where.push(sql`f.status = ${f.status}`);
  if (f.search?.trim()) {
    const like = `%${f.search.trim()}%`;
    where.push(sql`(f.title LIKE ${like} OR f.client_name LIKE ${like} OR f.client_email LIKE ${like} OR f.file_number LIKE ${like})`);
  }
  // Sede: la principal incluye lo que no tiene sede (NULL)
  if (f.site) where.push(f.site.isPrimary ? sql`(f.site_id IS NULL OR f.site_id = ${f.site.siteId})` : sql`f.site_id = ${f.site.siteId}`);
  const list = await rows<FileRow & { services: number; selling: number | null; net: number | null }>(exec, sql`
    SELECT f.id, f.file_number, f.site_id, f.title, f.status, f.client_name, f.client_email, f.client_phone, f.start_date, f.end_date, f.adults,
      f.children, f.fiscal_regime, f.tax_rate_bp, f.lead_id, f.quote_id, f.reservation_id, f.notes, f.created_at, f.updated_at,
      (SELECT COUNT(*) FROM travel_file_services s WHERE s.file_id = f.id) AS services,
      (SELECT SUM(s.selling_cents) FROM travel_file_services s WHERE s.file_id = f.id) AS selling,
      (SELECT SUM(s.net_cents) FROM travel_file_services s WHERE s.file_id = f.id) AS net
    FROM travel_files f WHERE ${sql.join(where, sql` AND `)}
    ORDER BY f.updated_at DESC LIMIT ${sql.raw(String(Math.max(1, Math.min(f.limit ?? 200, 500))))}`);
  return list.map((r) => ({ ...toFile(r), services: Number(r.services), sellingCents: Number(r.selling ?? 0), netCents: Number(r.net ?? 0) }));
}

export interface FileInput {
  title: string;
  siteId: string | null;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  startDate: string | null;
  endDate: string | null;
  adults: number;
  children: number;
  fiscalRegime: "reav" | "general";
  taxRateBp: number;
  notes: string | null;
}

export async function insertFile(exec: Pick<Db, "execute">, f: FileInput, userId: number | null): Promise<number> {
  const now = Date.now();
  return insertId(exec, sql`
    INSERT INTO travel_files (site_id, title, status, client_name, client_email, client_phone, start_date, end_date, adults, children, fiscal_regime,
      tax_rate_bp, notes, created_by, created_at, updated_at)
    VALUES (${f.siteId}, ${f.title}, 'borrador', ${f.clientName}, ${f.clientEmail}, ${f.clientPhone}, ${f.startDate}, ${f.endDate}, ${f.adults}, ${f.children},
      ${f.fiscalRegime}, ${f.taxRateBp}, ${f.notes}, ${userId}, ${now}, ${now})`);
}

export async function updateFileFields(exec: Pick<Db, "execute">, id: number, patch: Record<string, string | number | null>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => sql`${sql.raw(k)} = ${patch[k]}`);
  await exec.execute(sql`UPDATE travel_files SET ${sql.join(sets, sql`, `)}, updated_at = ${Date.now()} WHERE id = ${id}`);
}

// ─── Servicios ────────────────────────────────────────────────────────────────

interface ServiceRow {
  id: number;
  file_id: number;
  kind: string;
  source: string;
  supplier_id: number | null;
  supplier_name: string | null;
  title: string;
  description: string | null;
  service_date: string | null;
  end_date: string | null;
  quantity: number;
  pricing_mode: string;
  net_cents: number;
  selling_cents: number;
  markup_bp: number | null;
  commission_bp: number | null;
  rule_source: string | null;
  sort_order: number;
}

const toService = (r: ServiceRow) => ({
  id: Number(r.id),
  fileId: Number(r.file_id),
  kind: r.kind,
  source: r.source,
  supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
  supplierName: r.supplier_name,
  title: r.title,
  description: r.description,
  serviceDate: r.service_date,
  endDate: r.end_date,
  quantity: Number(r.quantity),
  pricingMode: r.pricing_mode,
  netCents: Number(r.net_cents),
  sellingCents: Number(r.selling_cents),
  markupBp: r.markup_bp === null ? null : Number(r.markup_bp),
  commissionBp: r.commission_bp === null ? null : Number(r.commission_bp),
  ruleSource: r.rule_source,
  sortOrder: Number(r.sort_order),
});
export type TravelService = ReturnType<typeof toService>;

export async function listServices(exec: Pick<Db, "execute">, fileId: number): Promise<TravelService[]> {
  const list = await rows<ServiceRow>(exec, sql`
    SELECT s.id, s.file_id, s.kind, s.source, s.supplier_id, COALESCE(NULLIF(sp.commercialName, ''), sp.fiscalName) AS supplier_name, s.title, s.description,
      s.service_date, s.end_date, s.quantity, s.pricing_mode, s.net_cents, s.selling_cents, s.markup_bp, s.commission_bp, s.rule_source, s.sort_order
    FROM travel_file_services s LEFT JOIN suppliers sp ON sp.id = s.supplier_id
    WHERE s.file_id = ${fileId} ORDER BY s.sort_order, s.service_date IS NULL, s.service_date, s.id`);
  return list.map(toService);
}

export interface ServiceWrite {
  kind: string;
  source: string;
  supplierId: number | null;
  title: string;
  description: string | null;
  serviceDate: string | null;
  endDate: string | null;
  quantity: number;
  pricingMode: string;
  netCents: number;
  sellingCents: number;
  markupBp: number | null;
  commissionBp: number | null;
  ruleSource: string;
  sortOrder: number;
}

export async function insertService(exec: Pick<Db, "execute">, fileId: number, s: ServiceWrite): Promise<number> {
  const now = Date.now();
  return insertId(exec, sql`
    INSERT INTO travel_file_services (file_id, kind, source, supplier_id, title, description, service_date, end_date, quantity, pricing_mode, net_cents,
      selling_cents, markup_bp, commission_bp, rule_source, sort_order, created_at, updated_at)
    VALUES (${fileId}, ${s.kind}, ${s.source}, ${s.supplierId}, ${s.title}, ${s.description}, ${s.serviceDate}, ${s.endDate}, ${s.quantity}, ${s.pricingMode},
      ${s.netCents}, ${s.sellingCents}, ${s.markupBp}, ${s.commissionBp}, ${s.ruleSource}, ${s.sortOrder}, ${now}, ${now})`);
}

export async function updateService(exec: Pick<Db, "execute">, id: number, s: ServiceWrite) {
  await exec.execute(sql`
    UPDATE travel_file_services SET kind = ${s.kind}, source = ${s.source}, supplier_id = ${s.supplierId}, title = ${s.title}, description = ${s.description},
      service_date = ${s.serviceDate}, end_date = ${s.endDate}, quantity = ${s.quantity}, pricing_mode = ${s.pricingMode}, net_cents = ${s.netCents},
      selling_cents = ${s.sellingCents}, markup_bp = ${s.markupBp}, commission_bp = ${s.commissionBp}, rule_source = ${s.ruleSource},
      sort_order = ${s.sortOrder}, updated_at = ${Date.now()}
    WHERE id = ${id}`);
}

export async function deleteService(exec: Exec, id: number) {
  await exec.delete(travelFileServices).where(eq(travelFileServices.id, id));
}

// ─── Márgenes ─────────────────────────────────────────────────────────────────

export async function listMarginRules(exec: Pick<Db, "execute">): Promise<Array<MarginRule & { id: number; updatedAt: number }>> {
  const list = await rows<{ id: number; scope: MarginScope; scope_key: string; markup_bp: number; commission_bp: number; is_active: number; updated_at: number | string }>(exec, sql`
    SELECT id, scope, scope_key, markup_bp, commission_bp, is_active, updated_at FROM travel_margin_rules ORDER BY FIELD(scope, 'global', 'sede', 'proveedor'), scope_key`);
  return list.map((r) => ({ id: Number(r.id), scope: r.scope, scopeKey: r.scope_key, markupBp: Number(r.markup_bp), commissionBp: Number(r.commission_bp), isActive: !!Number(r.is_active), updatedAt: Number(r.updated_at) }));
}

export async function upsertMarginRule(exec: Pick<Db, "execute">, r: MarginRule, userId: number | null) {
  await exec.execute(sql`
    INSERT INTO travel_margin_rules (scope, scope_key, markup_bp, commission_bp, is_active, updated_by, updated_at)
    VALUES (${r.scope}, ${r.scopeKey}, ${r.markupBp}, ${r.commissionBp}, ${r.isActive ? 1 : 0}, ${userId}, ${Date.now()})
    ON DUPLICATE KEY UPDATE markup_bp = VALUES(markup_bp), commission_bp = VALUES(commission_bp), is_active = VALUES(is_active),
      updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
}

// ─── Proveedores (suppliers del Core + perfil turístico) ──────────────────────

export async function listSuppliers(exec: Pick<Db, "execute">) {
  const list = await rows<{
    id: number; fiscalName: string; commercialName: string | null; nif: string | null; adminEmail: string | null; phone: string | null;
    contactPerson: string | null; connection_mode: string | null; service_kinds: unknown; operational_email: string | null; operational_phone: string | null;
    notes: string | null; is_active: number | null; contacts: number;
  }>(exec, sql`
    SELECT s.id, s.fiscalName, s.commercialName, s.nif, s.adminEmail, s.phone, s.contactPerson,
      p.connection_mode, p.service_kinds, p.operational_email, p.operational_phone, p.notes, p.is_active,
      (SELECT COUNT(*) FROM travel_supplier_contacts c WHERE c.supplier_id = s.id) AS contacts
    FROM suppliers s LEFT JOIN travel_supplier_profiles p ON p.supplier_id = s.id
    ORDER BY COALESCE(NULLIF(s.commercialName, ''), s.fiscalName)`);
  return list.map((r) => {
    let kinds: string[] = [];
    try {
      kinds = Array.isArray(r.service_kinds) ? (r.service_kinds as string[]) : r.service_kinds ? JSON.parse(String(r.service_kinds)) : [];
    } catch {
      kinds = [];
    }
    return {
      id: Number(r.id), name: (r.commercialName ?? "").trim() || r.fiscalName, fiscalName: r.fiscalName, nif: r.nif, email: r.adminEmail, phone: r.phone,
      contactPerson: r.contactPerson, isTravel: r.connection_mode !== null, connectionMode: r.connection_mode ?? "manual", serviceKinds: kinds,
      operationalEmail: r.operational_email, operationalPhone: r.operational_phone, notes: r.notes, isActive: r.is_active === null ? true : !!Number(r.is_active),
      contacts: Number(r.contacts),
    };
  });
}

export async function supplierExists(exec: Pick<Db, "execute">, id: number): Promise<boolean> {
  const [r] = await rows<{ id: number }>(exec, sql`SELECT id FROM suppliers WHERE id = ${id}`);
  return !!r;
}

export async function insertSupplier(exec: Pick<Db, "execute">, s: { fiscalName: string; commercialName: string | null; nif: string | null; email: string | null; phone: string | null; contactPerson: string | null }) {
  return insertId(exec, sql`
    INSERT INTO suppliers (fiscalName, commercialName, nif, adminEmail, phone, contactPerson)
    VALUES (${s.fiscalName}, ${s.commercialName}, ${s.nif}, ${s.email}, ${s.phone}, ${s.contactPerson})`);
}

export async function upsertSupplierProfile(exec: Pick<Db, "execute">, supplierId: number, p: { connectionMode: string; serviceKinds: string[]; operationalEmail: string | null; operationalPhone: string | null; notes: string | null; isActive: boolean }) {
  await exec.execute(sql`
    INSERT INTO travel_supplier_profiles (supplier_id, connection_mode, service_kinds, operational_email, operational_phone, notes, is_active, updated_at)
    VALUES (${supplierId}, ${p.connectionMode}, ${JSON.stringify(p.serviceKinds)}, ${p.operationalEmail}, ${p.operationalPhone}, ${p.notes}, ${p.isActive ? 1 : 0}, ${Date.now()})
    ON DUPLICATE KEY UPDATE connection_mode = VALUES(connection_mode), service_kinds = VALUES(service_kinds), operational_email = VALUES(operational_email),
      operational_phone = VALUES(operational_phone), notes = VALUES(notes), is_active = VALUES(is_active), updated_at = VALUES(updated_at)`);
}

export async function listContacts(exec: Pick<Db, "execute">, supplierId: number) {
  const list = await rows<{ id: number; name: string; role: string | null; email: string | null; phone: string | null; is_primary: number }>(exec, sql`
    SELECT id, name, role, email, phone, is_primary FROM travel_supplier_contacts WHERE supplier_id = ${supplierId} ORDER BY is_primary DESC, name`);
  return list.map((c) => ({ id: Number(c.id), name: c.name, role: c.role, email: c.email, phone: c.phone, isPrimary: !!Number(c.is_primary) }));
}

export async function insertContact(exec: Pick<Db, "execute">, supplierId: number, c: { name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }) {
  if (c.isPrimary) await exec.execute(sql`UPDATE travel_supplier_contacts SET is_primary = 0 WHERE supplier_id = ${supplierId}`);
  return insertId(exec, sql`
    INSERT INTO travel_supplier_contacts (supplier_id, name, role, email, phone, is_primary, created_at)
    VALUES (${supplierId}, ${c.name}, ${c.role}, ${c.email}, ${c.phone}, ${c.isPrimary ? 1 : 0}, ${Date.now()})`);
}

export async function deleteContact(exec: Exec, id: number) {
  await exec.delete(travelSupplierContacts).where(eq(travelSupplierContacts.id, id));
}

// ─── Operaciones ──────────────────────────────────────────────────────────────

interface OperationRow {
  id: number;
  file_id: number;
  service_id: number;
  reservation_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  status: OperationStatus;
  provider_locator: string | null;
  sla_deadline_at: number | string | null;
  submitted_at: number | string | null;
  confirmed_at: number | string | null;
  consolidated_at: number | string | null;
  internal_notes: string | null;
  service_title: string | null;
  service_kind: string | null;
  service_date: string | null;
  file_number: string | null;
  client_name: string | null;
  updated_at: number | string;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

const toOperation = (r: OperationRow) => ({
  id: Number(r.id),
  fileId: Number(r.file_id),
  serviceId: Number(r.service_id),
  reservationId: num(r.reservation_id),
  supplierId: num(r.supplier_id),
  supplierName: r.supplier_name,
  status: r.status,
  providerLocator: r.provider_locator,
  slaDeadlineAt: num(r.sla_deadline_at),
  submittedAt: num(r.submitted_at),
  confirmedAt: num(r.confirmed_at),
  consolidatedAt: num(r.consolidated_at),
  internalNotes: r.internal_notes,
  serviceTitle: r.service_title,
  serviceKind: r.service_kind,
  serviceDate: r.service_date,
  fileNumber: r.file_number,
  clientName: r.client_name,
  updatedAt: Number(r.updated_at),
});
export type TravelOperation = ReturnType<typeof toOperation>;

const OPERATION_SELECT = sql.raw(`
  SELECT o.id, o.file_id, o.service_id, o.reservation_id, o.supplier_id, COALESCE(NULLIF(sp.commercialName, ''), sp.fiscalName) AS supplier_name, o.status,
    o.provider_locator, o.sla_deadline_at, o.submitted_at, o.confirmed_at, o.consolidated_at, o.internal_notes, s.title AS service_title,
    s.kind AS service_kind, s.service_date, f.file_number, f.client_name, o.updated_at
  FROM travel_operations o
  LEFT JOIN travel_file_services s ON s.id = o.service_id
  LEFT JOIN travel_files f ON f.id = o.file_id
  LEFT JOIN suppliers sp ON sp.id = o.supplier_id`);

export async function listOperations(exec: Pick<Db, "execute">, f: { fileId?: number; statuses?: readonly string[] }) {
  const where: SQL[] = [sql`1 = 1`];
  if (f.fileId != null) where.push(sql`o.file_id = ${f.fileId}`);
  if (f.statuses?.length) where.push(sql`o.status IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`);
  const list = await rows<OperationRow>(exec, sql`${OPERATION_SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY COALESCE(s.service_date, ''), o.id LIMIT 1000`);
  return list.map(toOperation);
}

export async function getOperation(exec: Pick<Db, "execute">, id: number, lock = false): Promise<TravelOperation | null> {
  if (lock) await rows(exec, sql`SELECT id FROM travel_operations WHERE id = ${id} FOR UPDATE`);
  const [r] = await rows<OperationRow>(exec, sql`${OPERATION_SELECT} WHERE o.id = ${id}`);
  return r ? toOperation(r) : null;
}

export async function insertOperation(exec: Pick<Db, "execute">, o: { fileId: number; serviceId: number; reservationId: number | null; supplierId: number | null }) {
  const now = Date.now();
  await exec.execute(sql`
    INSERT INTO travel_operations (file_id, service_id, reservation_id, supplier_id, status, created_at, updated_at)
    VALUES (${o.fileId}, ${o.serviceId}, ${o.reservationId}, ${o.supplierId}, 'pending_submission', ${now}, ${now})
    ON DUPLICATE KEY UPDATE id = id`);
}

export async function setOperationStatus(
  exec: Pick<Db, "execute">,
  op: { id: number; status: string },
  to: OperationStatus,
  fields: { locator?: string | null; notes?: string | null; slaDeadlineAt?: number | null },
  actor: { userId: number | null; reason: string | null },
) {
  const now = Date.now();
  const sets: SQL[] = [sql`status = ${to}`, sql`updated_at = ${now}`];
  if (fields.locator !== undefined) sets.push(sql`provider_locator = ${fields.locator}`);
  if (fields.notes !== undefined) sets.push(sql`internal_notes = ${fields.notes}`);
  if (fields.slaDeadlineAt !== undefined) sets.push(sql`sla_deadline_at = ${fields.slaDeadlineAt}`);
  if (to === "submitted") sets.push(sql`submitted_at = ${now}`);
  if (to === "provider_confirmed") sets.push(sql`confirmed_at = ${now}`);
  if (to === "consolidated") sets.push(sql`consolidated_at = ${now}`);
  await exec.execute(sql`UPDATE travel_operations SET ${sql.join(sets, sql`, `)} WHERE id = ${op.id}`);
  await exec.execute(sql`
    INSERT INTO travel_operation_status_log (operation_id, from_status, to_status, actor_user_id, reason, created_at)
    VALUES (${op.id}, ${op.status}, ${to}, ${actor.userId}, ${actor.reason?.slice(0, 500) ?? null}, ${now})`);
}

export async function operationHistory(exec: Pick<Db, "execute">, operationId: number) {
  const list = await rows<{ id: number; from_status: string | null; to_status: string; actor_user_id: number | null; reason: string | null; created_at: number | string }>(exec, sql`
    SELECT id, from_status, to_status, actor_user_id, reason, created_at FROM travel_operation_status_log WHERE operation_id = ${operationId} ORDER BY created_at DESC, id DESC`);
  return list.map((h) => ({ id: Number(h.id), fromStatus: h.from_status, toStatus: h.to_status, actorUserId: num(h.actor_user_id), reason: h.reason, createdAt: Number(h.created_at) }));
}

export async function quoteStatus(exec: Pick<Db, "execute">, quoteId: number | null): Promise<{ status: string; quoteNumber: string; paymentLinkUrl: string | null } | null> {
  if (!quoteId) return null;
  const [q] = await rows<{ status: string; quoteNumber: string; paymentLinkUrl: string | null }>(exec, sql`SELECT status, quoteNumber, paymentLinkUrl FROM quotes WHERE id = ${quoteId}`);
  return q ?? null;
}
