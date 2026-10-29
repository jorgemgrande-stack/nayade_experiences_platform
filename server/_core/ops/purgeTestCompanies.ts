/**
 * Purga DEFINITIVA de las empresas de prueba de production (autorizada por el propietario el 28/10/2026).
 *
 *  - Lista CERRADA: solo las cinco empresas de `PURGE_TARGETS`, identificadas a la vez por su tenant y por su nombre
 *    exacto en el CRM. No admite identificadores por parámetro.
 *  - Simulación por defecto: calcula y lista cada registro y recurso afectado; `apply` solo ejecuta el plan calculado.
 *  - Aborta sin tocar nada si: aparece Skibox, Nextair u otra empresa; hay registros fiscales o de cobro (facturas,
 *    cargos, cola fiscal, clientes externos, aceptaciones); hay datos live (`livemode = 1`); una base de datos de
 *    tenant es compartida o no tiene el nombre propio del tenant; o queda una dependencia sin resolver.
 *  - Conserva las copias de seguridad (`backup_*` del registro): son la evidencia recuperable de lo borrado.
 *  - Después comprueba que no queda ningún registro de las cinco empresas ni referencias huérfanas.
 *  - El cliente de Stripe de PRUEBAS no se toca aquí (no hay clave de pruebas en production): solo su enlace local.
 */
import mysql from "mysql2/promise";
import { databaseNameFor } from "../provisioning/mysqlAdapters";
import { restoredUserFor } from "./backupRestore";

export const PURGE_TARGETS = [
  { tenantId: "t1-empresa-demo-elephant-a", companyName: "Empresa Demo Elephant A" },
  { tenantId: "t2-empresa-demo-elephant-b", companyName: "Empresa Demo Elephant B" },
  { tenantId: "t3-empresa-demo-elephant-01", companyName: "Empresa Demo Elephant 01" },
  { tenantId: "t4-empresa-demo-elephant-02", companyName: "Empresa Demo Elephant 02" },
  { tenantId: "prueba-e2e-stripe-sandbox-20261018", companyName: "PRUEBA E2E Stripe sandbox 20261018" },
] as const;
/** Empresas reales que nunca pueden aparecer en el plan. */
export const PROTECTED_TENANTS = ["t5-skibox"];
export const PROTECTED_COMPANY_NAMES = ["Nextair", "NEXTAIR SL", "Skibox"];

/** Tablas del CRM que se conservan siempre (fiscalidad, cobros y clientes externos): si tienen filas de las empresas, se aborta. */
export const CRM_PROTECTED = ["invoices", "invoice_lines", "invoice_series", "fiscal_documents", "billing_charges", "billing_charge_payments", "external_subscriptions", "external_subscription_events", "crm_contract_acceptances"];
/** Tablas del registro que se conservan (copias de seguridad: evidencia recuperable). */
export const REGISTRY_KEPT = ["backup_inventory", "backup_copies", "backup_restores"];

type Q = mysql.Pool | mysql.PoolConnection;
type Row = mysql.RowDataPacket & Record<string, unknown>;
const rows = async (q: Q, sql: string, p: unknown[] = []) => ((await q.query<Row[]>(sql, p))[0] ?? []) as Row[];

/** Claves por las que una fila pertenece a las empresas de prueba (columna → valores). */
interface Keys {
  company_id: number[];
  tenant_id: string[];
  order_id: number[];
  subscription_id: number[];
  contract_id: number[];
  contact_id: number[];
  trial_id: number[];
}
const NUMERIC_KEYS = ["company_id", "order_id", "subscription_id", "contract_id", "contact_id", "trial_id"] as const;

export interface PurgeStep {
  db: "crm" | "registry";
  table: string;
  where: string;
  params: unknown[];
  rows: number;
}
export interface PurgePlan {
  companies: Array<{ id: number; name: string; tenantId: string }>;
  missing: string[];
  steps: PurgeStep[];
  databases: Array<{ tenantId: string; database: string | null; action: "drop" | "none"; reason?: string; restored?: boolean }>;
  kept: string[];
  problems: string[];
}

async function columns(q: Q): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  for (const r of await rows(q, "SELECT table_name t, column_name c, data_type d FROM information_schema.columns WHERE table_schema = DATABASE()")) {
    const t = String(r.t ?? r.TABLE_NAME);
    if (!out.has(t)) out.set(t, new Map());
    out.get(t)!.set(String(r.c ?? r.COLUMN_NAME), String(r.d ?? r.DATA_TYPE));
  }
  return out;
}
/** Hijo → padres (claves ajenas de la base actual), para borrar de hijos a padres. */
async function foreignKeys(q: Q): Promise<Array<{ child: string; parent: string; column: string; parentColumn: string }>> {
  return (
    await rows(q, "SELECT table_name child, referenced_table_name parent, column_name col, referenced_column_name pcol FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL")
  ).map((r) => ({ child: String(r.child ?? r.TABLE_NAME), parent: String(r.parent ?? r.REFERENCED_TABLE_NAME), column: String(r.col ?? r.COLUMN_NAME), parentColumn: String(r.pcol ?? r.REFERENCED_COLUMN_NAME) }));
}
const ids = async (q: Q, sql: string, p: unknown[]) => (await rows(q, sql, p)).map((r) => Number(r.id));

/** Filtro de una tabla por las claves de las empresas (columnas enteras para ids; texto para tenant_id). */
function filterFor(cols: Map<string, string>, k: Keys): { where: string; params: unknown[] } | null {
  const parts: string[] = [];
  const params: unknown[] = [];
  const isInt = (c: string) => /int/i.test(cols.get(c) ?? "");
  for (const key of NUMERIC_KEYS) if (cols.has(key) && isInt(key) && k[key].length) (parts.push(`\`${key}\` IN (?)`), params.push(k[key]));
  if (cols.has("tenant_id") && !isInt("tenant_id") && k.tenant_id.length) (parts.push("`tenant_id` IN (?)"), params.push(k.tenant_id));
  // Historial genérico del CRM (entity_type + entity_id)
  if (cols.has("entity_type") && cols.has("entity_id")) {
    for (const [type, vals] of [["company", k.company_id], ["contract", k.contract_id], ["contact", k.contact_id]] as const) if (vals.length) (parts.push("(`entity_type` = ? AND `entity_id` IN (?))"), params.push(type, vals));
  }
  return parts.length ? { where: parts.join(" OR "), params } : null;
}

/** Orden de borrado: hijos antes que padres (las tablas sin relación, al principio). */
function deleteOrder(tables: string[], fks: Awaited<ReturnType<typeof foreignKeys>>): string[] {
  const set = new Set(tables);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const f of fks) if (f.parent === t && f.child !== t && set.has(f.child)) visit(f.child, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}

export async function planPurge(d: { crm: Q; registry: Q; tenantDbName?: (tenantId: string) => Promise<string | null>; expectedDbName?: (tenantId: string) => string }): Promise<PurgePlan> {
  const problems: string[] = [];
  const tenants = PURGE_TARGETS.map((t) => t.tenantId);
  if (tenants.some((t) => PROTECTED_TENANTS.includes(t))) problems.push("la lista incluye una empresa protegida");

  // 1. Empresas del CRM: tenant y nombre exactos
  const found = await rows(d.crm, "SELECT id, name, tenant_id FROM crm_companies WHERE tenant_id IN (?) OR name IN (?)", [tenants, PURGE_TARGETS.map((t) => t.companyName)]);
  const companies: PurgePlan["companies"] = [];
  for (const r of found) {
    const t = PURGE_TARGETS.find((x) => x.tenantId === r.tenant_id && x.companyName === r.name);
    if (!t) problems.push(`la empresa ${r.id} («${r.name}», ${r.tenant_id ?? "sin plataforma"}) no coincide exactamente con la lista: no se toca nada`);
    else companies.push({ id: Number(r.id), name: String(r.name), tenantId: t.tenantId });
  }
  if (companies.some((c) => PROTECTED_COMPANY_NAMES.includes(c.name))) problems.push("aparece una empresa protegida");
  const missing = PURGE_TARGETS.filter((t) => !companies.some((c) => c.tenantId === t.tenantId)).map((t) => t.tenantId);

  // 2. Claves derivadas
  const companyIds = companies.map((c) => c.id);
  const k: Keys = { company_id: companyIds, tenant_id: tenants, order_id: [], subscription_id: [], contract_id: [], contact_id: [], trial_id: [] };
  const crmCols = await columns(d.crm);
  const has = (t: string) => crmCols.has(t);
  if (companyIds.length) {
    if (has("commercial_orders")) k.order_id = await ids(d.crm, "SELECT id FROM commercial_orders WHERE company_id IN (?)", [companyIds]);
    if (has("subscriptions")) k.subscription_id = await ids(d.crm, "SELECT id FROM subscriptions WHERE company_id IN (?)", [companyIds]);
    if (has("crm_contracts")) k.contract_id = await ids(d.crm, "SELECT id FROM crm_contracts WHERE company_id IN (?)", [companyIds]);
    if (has("crm_contacts")) k.contact_id = await ids(d.crm, "SELECT id FROM crm_contacts WHERE company_id IN (?)", [companyIds]);
  }
  if (has("trial_requests")) k.trial_id = await ids(d.crm, "SELECT id FROM trial_requests WHERE tenant_id IN (?)", [tenants]);
  // Las claves de las tablas raíz también por id
  const rootIds: Record<string, number[]> = { crm_companies: k.company_id, commercial_orders: k.order_id, subscriptions: k.subscription_id, crm_contracts: k.contract_id, crm_contacts: k.contact_id, trial_requests: k.trial_id };

  // 3. Pasos del CRM
  const crmFks = await foreignKeys(d.crm);
  const crmSteps: PurgeStep[] = [];
  for (const [table, cols] of Array.from(crmCols.entries())) {
    const f = filterFor(cols, k);
    const root = rootIds[table]?.length ? { where: "`id` IN (?)", params: [rootIds[table]] } : null;
    const where = [f?.where, root?.where].filter(Boolean).join(" OR ");
    if (!where) continue;
    const params = [...(f?.params ?? []), ...(root?.params ?? [])];
    const [{ n }] = await rows(d.crm, `SELECT COUNT(*) n FROM \`${table}\` WHERE ${where}`, params);
    if (!Number(n)) continue;
    if (CRM_PROTECTED.includes(table)) {
      problems.push(`${table}: ${n} registro(s) de las empresas de prueba son fiscales o de cobro y se conservan: no se purga nada`);
      continue;
    }
    if (cols.has("livemode")) {
      const [{ n: live }] = await rows(d.crm, `SELECT COUNT(*) n FROM \`${table}\` WHERE livemode = 1 AND (${where})`, params);
      if (Number(live)) problems.push(`${table}: ${live} registro(s) live de las empresas de prueba: no se purga nada`);
    }
    crmSteps.push({ db: "crm", table, where, params, rows: Number(n) });
  }
  // Hijos por clave ajena de lo que se borra que no llevan las claves de las empresas (p. ej. commercial_payment_events →
  // commercial_payments): se borran sus filas de esos padres, con las mismas reglas (fiscal o live → se aborta)
  for (let added = true; added; ) {
    added = false;
    for (const s of [...crmSteps]) {
      for (const f of crmFks.filter((x) => x.parent === s.table && x.child !== s.table && !crmSteps.some((y) => y.table === x.child))) {
        const where = `\`${f.column}\` IN (SELECT \`${f.parentColumn}\` FROM \`${s.table}\` WHERE ${s.where})`;
        const [{ n }] = await rows(d.crm, `SELECT COUNT(*) n FROM \`${f.child}\` WHERE ${where}`, s.params);
        if (!Number(n)) continue;
        if (CRM_PROTECTED.includes(f.child)) {
          problems.push(`${f.child}: ${n} registro(s) de las empresas de prueba son fiscales o de cobro y se conservan: no se purga nada`);
          continue;
        }
        if (crmCols.get(f.child)?.has("livemode")) {
          const [{ n: live }] = await rows(d.crm, `SELECT COUNT(*) n FROM \`${f.child}\` WHERE livemode = 1 AND ${where}`, s.params);
          if (Number(live)) problems.push(`${f.child}: ${live} registro(s) live de las empresas de prueba: no se purga nada`);
        }
        crmSteps.push({ db: "crm", table: f.child, where, params: [...s.params], rows: Number(n) });
        added = true;
      }
    }
  }
  const crmOrder = deleteOrder(crmSteps.map((s) => s.table), crmFks);
  crmSteps.sort((a, b) => crmOrder.indexOf(a.table) - crmOrder.indexOf(b.table));
  // Un hijo por clave ajena que no esté en el plan dejaría al borrar un padre una referencia rota: se aborta
  for (const s of crmSteps) {
    for (const f of crmFks.filter((x) => x.parent === s.table && x.child !== s.table)) {
      const [{ n }] = await rows(d.crm, `SELECT COUNT(*) n FROM \`${f.child}\` WHERE \`${f.column}\` IN (SELECT \`${f.parentColumn}\` FROM \`${s.table}\` WHERE ${s.where})`, s.params);
      if (Number(n) && !crmSteps.some((x) => x.table === f.child)) problems.push(`${f.child}.${f.column} referencia ${s.table} y no está en el plan: no se purga nada`);
    }
  }

  // 4. Pasos del registro (todo lo que tenga tenant_id, salvo las copias) y el tenant al final
  const regCols = await columns(d.registry);
  const regSteps: PurgeStep[] = [];
  for (const [table, cols] of Array.from(regCols.entries())) {
    if (REGISTRY_KEPT.includes(table)) continue;
    const col = table === "tenants" ? "id" : cols.has("tenant_id") ? "tenant_id" : null;
    if (!col) continue;
    const [{ n }] = await rows(d.registry, `SELECT COUNT(*) n FROM \`${table}\` WHERE \`${col}\` IN (?)`, [tenants]);
    if (Number(n)) regSteps.push({ db: "registry", table, where: `\`${col}\` IN (?)`, params: [tenants], rows: Number(n) });
  }
  const regOrder = deleteOrder(regSteps.map((s) => s.table), await foreignKeys(d.registry));
  regSteps.sort((a, b) => (a.table === "tenants" ? 1 : b.table === "tenants" ? -1 : regOrder.indexOf(a.table) - regOrder.indexOf(b.table)));

  // 5. Bases de datos de tenant: solo las propias (nombre del tenant) y no compartidas
  const databases: PurgePlan["databases"] = [];
  const allDbs = new Map<string, string[]>();
  if (d.tenantDbName) {
    for (const r of await rows(d.registry, "SELECT DISTINCT tenant_id FROM tenant_databases")) {
      const tid = String(r.tenant_id ?? r.TENANT_ID);
      const db = await d.tenantDbName(tid).catch(() => null);
      if (db) allDbs.set(db, [...(allDbs.get(db) ?? []), tid]);
    }
  }
  for (const t of tenants) {
    const db = d.tenantDbName ? await d.tenantDbName(t).catch(() => null) : null;
    if (!db) {
      databases.push({ tenantId: t, database: null, action: "none", reason: "sin base de datos activa" });
      continue;
    }
    const sharers = (allDbs.get(db) ?? []).filter((x) => x !== t);
    const expected = d.expectedDbName?.(t);
    // Una base restaurada desde copia lleva el nombre propio con el sufijo de la restauración (`_r<AAAAMMDDhhmmss>`)
    const restored = !!expected && new RegExp(`^${expected}_r\\d{14}$`).test(db);
    if (sharers.length) problems.push(`la base ${db} de ${t} la usa también ${sharers.join(", ")}: no se purga nada`);
    else if (expected && db !== expected && !restored) problems.push(`la base de ${t} (${db}) no tiene el nombre propio del tenant (${expected}): no se purga nada`);
    databases.push({ tenantId: t, database: db, action: "drop", ...(restored ? { restored } : {}) });
  }

  return {
    companies,
    missing,
    steps: [...crmSteps, ...regSteps],
    databases,
    kept: [...REGISTRY_KEPT.map((t) => `registro.${t} (copias de seguridad)`), ...CRM_PROTECTED.map((t) => `crm.${t}`), "cliente de Stripe de pruebas (se elimina en el Dashboard de Stripe en modo test)"],
    problems,
  };
}

/**
 * Borra la base RESTAURADA activa de una empresa de la lista cerrada y su usuario propio en cada servidor indicado.
 * Solo admite el nombre exacto `es_<empresa>_r<AAAAMMDDhhmmss>` de una empresa de `PURGE_TARGETS`.
 */
export async function dropRestoredTestDatabase(admins: Array<Pick<mysql.Pool, "query">>, tenantId: string, database: string): Promise<void> {
  if (!PURGE_TARGETS.some((t) => t.tenantId === tenantId)) throw new Error(`${tenantId} no está en la lista cerrada de la purga`);
  if (!new RegExp(`^${databaseNameFor(tenantId)}_r\\d{14}$`).test(database)) throw new Error(`${database} no es una base restaurada de ${tenantId}`);
  for (const admin of admins) {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query("DROP USER IF EXISTS ?@?", [restoredUserFor(database), "%"]);
  }
}

/** Funciones de borrado de bases para `applyPurge` (sin servidor de bases de datos, ninguna). */
export function purgeDatabaseDroppers(dbs: { dropDatabase(tenantId: string): Promise<void> } | null, admins: Array<Pick<mysql.Pool, "query">> | null) {
  return {
    dropDatabase: dbs ? (t: string) => dbs.dropDatabase(t) : undefined,
    dropRestoredDatabase: admins ? (t: string, database: string) => dropRestoredTestDatabase(admins, t, database) : undefined,
  };
}

/** Ejecuta el plan (cada base en una transacción) y borra las bases de los tenants. Exige un plan sin problemas. */
export async function applyPurge(
  d: { crm: mysql.Pool; registry: mysql.Pool; dropDatabase?: (tenantId: string) => Promise<void>; dropRestoredDatabase?: (tenantId: string, database: string) => Promise<void> },
  plan: PurgePlan,
): Promise<{ deleted: Array<{ db: string; table: string; rows: number }>; droppedDatabases: string[] }> {
  if (plan.problems.length) throw new Error(`No se purga nada:\n - ${plan.problems.join("\n - ")}`);
  const deleted: Array<{ db: string; table: string; rows: number }> = [];
  for (const [db, pool] of [["crm", d.crm], ["registry", d.registry]] as const) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      for (const s of plan.steps.filter((x) => x.db === db)) {
        const [r] = await c.query<mysql.ResultSetHeader>(`DELETE FROM \`${s.table}\` WHERE ${s.where}`, s.params);
        deleted.push({ db, table: s.table, rows: r.affectedRows });
      }
      await c.commit();
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  const droppedDatabases: string[] = [];
  for (const x of plan.databases.filter((y) => y.action === "drop")) {
    if (!d.dropDatabase) throw new Error("Sin servidor de bases de datos (PROVISIONING_DB_*): no se pueden borrar las bases de los tenants");
    if (x.restored && !d.dropRestoredDatabase) throw new Error(`Sin forma de borrar la base restaurada ${x.database}`);
    // La base con el nombre propio (si aún existe) y, si la activa es una restaurada, también esa y su usuario
    await d.dropDatabase(x.tenantId);
    if (x.restored) await d.dropRestoredDatabase!(x.tenantId, x.database!);
    droppedDatabases.push(x.database!);
  }
  return { deleted, droppedDatabases };
}

/** Comprobación posterior: ningún registro de las cinco empresas y ninguna referencia huérfana en las tablas tocadas. */
export async function verifyPurge(d: { crm: Q; registry: Q }): Promise<{ ok: boolean; remaining: string[] }> {
  const again = await planPurge({ crm: d.crm, registry: d.registry });
  const remaining = again.steps.map((s) => `${s.db}.${s.table}: ${s.rows}`);
  for (const [name, q] of [["crm", d.crm], ["registry", d.registry]] as const) {
    for (const f of await foreignKeys(q)) {
      const [{ n }] = await rows(q, `SELECT COUNT(*) n FROM \`${f.child}\` c LEFT JOIN \`${f.parent}\` p ON p.\`${f.parentColumn}\` = c.\`${f.column}\` WHERE c.\`${f.column}\` IS NOT NULL AND p.\`${f.parentColumn}\` IS NULL`);
      if (Number(n)) remaining.push(`${name}.${f.child}.${f.column}: ${n} referencia(s) huérfana(s)`);
    }
  }
  return { ok: remaining.length === 0, remaining };
}
