/**
 * Purga definitiva de las empresas de prueba contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; bases aisladas
 * con todas las migraciones del CRM y del registro): borra solo lo de la lista cerrada, de hijos a padres; una empresa
 * real y Nextair intactas; las copias de seguridad se conservan; una factura o un dato live de una empresa de prueba
 * bloquea todo. Fuera del CRM y del registro: bases restauradas sobrantes, medición (es_erm) y ficheros del bucket.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { PURGE_TARGETS, applyPurge, planPurge, verifyPurge } from "./_core/ops/purgeTestCompanies";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const T = Date.UTC(2026, 9, 28, 9);

async function freshDb(admin: mysql.Pool, name: string) {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const u = new URL(URL_!);
  u.pathname = `/${name}`;
  return mysql.createPool({ uri: u.toString(), connectionLimit: 4, multipleStatements: false });
}
async function runSql(pool: mysql.Pool, file: string) {
  const ddl = fs.readFileSync(file, "utf8").replace(/^--.*$/gm, "");
  for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
}
/** Inserta una fila rellenando las columnas obligatorias que no se indican (solo para sembrar la prueba). */
async function seed(pool: mysql.Pool, table: string, values: Record<string, unknown>) {
  const [cols] = await pool.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\``);
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    const name = String(c.Field);
    if (name in row || c.Null === "YES" || c.Default !== null || /auto_increment|GENERATED/i.test(String(c.Extra))) continue;
    const ct = String(c.Type);
    row[name] = /^enum/.test(ct) ? /'([^']*)'/.exec(ct)![1] : /int|decimal|double|float/.test(ct) ? 1 : /json/.test(ct) ? "{}" : /timestamp|datetime/.test(ct) ? new Date(T) : /^date/.test(ct) ? "2026-10-28" : /char|text/.test(ct) ? `${name}-${Math.random().toString(36).slice(2, 8)}`.slice(0, Number(/\((\d+)\)/.exec(ct)?.[1] ?? 60)) : 1;
  }
  const keys = Object.keys(row);
  const [r] = await pool.query<mysql.ResultSetHeader>(`INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map((k) => row[k]));
  return r.insertId;
}

describe.skipIf(!URL_)("purga de las empresas de prueba (MySQL real)", () => {
  let admin: mysql.Pool;
  let crm: mysql.Pool;
  let reg: mysql.Pool;
  const realIds: number[] = [];
  const LEFTOVERS = ["es_t5_skibox_r20261020101010", "es_t9_empresa_real_r20261020101010"];
  // Bucket de medios simulado: ficheros de Skibox y de la empresa real
  const bucket = new Set(["t/t5-skibox/logo.png", "t/t5-skibox/docs/a.pdf", "t/t9-empresa-real/logo.png"]);
  const media = { describe: () => "memoria", list: async (p: string) => Array.from(bucket).filter((k) => k.startsWith(p)).map((key) => ({ key, bytes: 10 })) };
  const resources = () => ({ servers: [{ alias: "mysql-1", admin }], media });

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    crm = await freshDb(admin, "purge_test_crm");
    reg = await freshDb(admin, "purge_test_registry");
    await runSql(crm, path.resolve(__dirname, "../db/crm/0000_crm.sql"));
    for (const m of loadMigrations(path.resolve(__dirname, "../db/crm/migrations")).migrations) for (const s of splitStatements(m.up)) await crm.query(s);
    for (const f of fs.readdirSync(path.resolve(__dirname, "../db/registry")).filter((x) => /^\d{4}_.*\.sql$/.test(x) && !x.endsWith(".down.sql")).sort()) await runSql(reg, path.resolve(__dirname, "../db/registry", f));
    await crm.query("SET FOREIGN_KEY_CHECKS = 0");
    await reg.query("SET FOREIGN_KEY_CHECKS = 0");
    const company = async (name: string, tenantId: string | null) => seed(crm, "crm_companies", { name, tenant_id: tenantId, created_at: T });
    const all = [...PURGE_TARGETS.map((t) => ({ name: t.companyName, tenantId: t.tenantId, test: true })), { name: "Empresa Real", tenantId: "t9-empresa-real", test: false }, { name: "Nextair", tenantId: null, test: false }];
    for (const c of all) {
      const id = await company(c.name, c.tenantId);
      if (!c.test) realIds.push(id);
      await seed(crm, "crm_contacts", { company_id: id, first_name: "Persona" });
      const contract = await seed(crm, "crm_contracts", { company_id: id, tenant_id: c.tenantId });
      await seed(crm, "subscriptions", { company_id: id, tenant_id: c.tenantId, contract_id: contract });
      // Pedido con pago y evento del proveedor (el evento solo enlaza con el pago, no con la empresa)
      const order = await seed(crm, "commercial_orders", { company_id: id });
      const payment = await seed(crm, "commercial_payments", { order_id: order });
      await seed(crm, "commercial_payment_events", { provider_event_id: `evt_${id}`, payment_id: payment });
      if (c.tenantId) {
        await seed(reg, "tenants", { id: c.tenantId });
        await seed(reg, "tenant_domains", { tenant_id: c.tenantId, domain: `${c.tenantId}.example.test` });
        // Auditoría inmutable (trigger de solo anexado, como en production)
        await seed(reg, "tenant_events", { tenant_id: c.tenantId, actor_type: "system", actor_id: "alta", action: "created" });
        await seed(reg, "backup_inventory", { target_kind: "tenant", target_id: c.tenantId });
      }
    }
    await crm.query("SET FOREIGN_KEY_CHECKS = 1");
    await reg.query("SET FOREIGN_KEY_CHECKS = 1");
    // Servidor de bases: una restauración sobrante de Skibox, otra de la empresa real y la medición de ambas
    for (const db of LEFTOVERS) await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\``);
    await admin.query("CREATE DATABASE IF NOT EXISTS es_erm");
    await admin.query("CREATE TABLE IF NOT EXISTS es_erm.usage_hourly (tenant_id VARCHAR(63) NOT NULL, metric VARCHAR(32) NOT NULL, n INT NOT NULL)");
    await admin.query("INSERT INTO es_erm.usage_hourly VALUES ('t5-skibox','requests',3),('t5-skibox','storage',1),('t9-empresa-real','requests',7)");
  });

  afterAll(async () => {
    await crm?.end();
    await reg?.end();
    await admin?.query("DROP DATABASE IF EXISTS purge_test_crm");
    await admin?.query("DROP DATABASE IF EXISTS purge_test_registry");
    for (const db of LEFTOVERS) await admin?.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await admin?.query("DROP DATABASE IF EXISTS es_erm");
    await admin?.end();
  });

  // t3 sirve desde una base restaurada (`_r<fecha>`), como en production
  const dbName = async (t: string) => `es_${t.replace(/-/g, "_")}${t === "t3-empresa-demo-elephant-01" ? "_r20261016221031" : ""}`;

  it("una base con un nombre ajeno (ni el propio ni el de una restauración) bloquea la purga", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: async (t) => (t === "t1-empresa-demo-elephant-a" ? "es_t9_empresa_real" : dbName(t)), expectedDbName: (t) => `es_${t.replace(/-/g, "_")}` });
    expect(plan.problems.join()).toMatch(/no tiene el nombre propio/);
  });

  it("una factura de una empresa de prueba bloquea la purga sin tocar nada", async () => {
    const [[c]] = await crm.query<mysql.RowDataPacket[]>("SELECT id FROM crm_companies WHERE name = ?", [PURGE_TARGETS[0].companyName]);
    await crm.query("SET FOREIGN_KEY_CHECKS = 0");
    const inv = await seed(crm, "invoices", { company_id: c.id, source_key: "charge:999" });
    await crm.query("SET FOREIGN_KEY_CHECKS = 1");
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}` });
    expect(plan.problems.join()).toMatch(/invoices/);
    await expect(applyPurge({ crm, registry: reg }, plan)).rejects.toThrow(/No se purga nada/);
    await crm.query("DELETE FROM invoices WHERE id = ?", [inv]);
  });

  it("sin poder mirar el bucket de medios no se purga nada (quedarían ficheros huérfanos)", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, resources: { media: { unavailable: "BACKUP_MEDIA no activado" } } });
    expect(plan.problems.join()).toMatch(/ficheros/);
    expect(plan.files.checked).toBe(false);
  });

  it("purga solo la lista cerrada, de hijos a padres, conserva las copias y deja la empresa real y Nextair intactas", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}`, resources: resources() });
    expect(plan.problems).toEqual([]);
    expect(plan.companies.map((c) => c.name)).toContain("Skibox");
    expect(plan.extraDatabases).toEqual([{ tenantId: "t5-skibox", server: "mysql-1", database: "es_t5_skibox_r20261020101010" }]);
    expect(plan.measurement).toEqual([{ server: "mysql-1", table: "usage_hourly", rows: 2 }]);
    expect(plan.files.byTenant).toEqual([{ tenantId: "t5-skibox", objects: 2, bytes: 20, keys: ["t/t5-skibox/logo.png", "t/t5-skibox/docs/a.pdf"] }]);
    expect(plan.companies.map((c) => c.tenantId).sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    const tables = plan.steps.map((s) => `${s.db}.${s.table}`);
    expect(tables).toEqual(expect.arrayContaining(["crm.crm_contacts", "crm.crm_contracts", "crm.subscriptions", "crm.crm_companies", "registry.tenant_domains"]));
    expect(tables.some((t) => t.includes("backup_"))).toBe(false);
    // La auditoría no se borra y el tenant queda como lápida
    expect(tables).not.toContain("registry.tenant_events");
    expect(tables).not.toContain("registry.tenants");
    expect(plan.retire.map((x) => x.tenantId).sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    expect(tables.indexOf("crm.crm_companies")).toBeGreaterThan(tables.indexOf("crm.crm_contacts"));
    expect(tables).toEqual(expect.arrayContaining(["crm.commercial_payment_events", "crm.commercial_payments", "crm.commercial_orders"]));
    expect(tables.indexOf("crm.commercial_payments")).toBeGreaterThan(tables.indexOf("crm.commercial_payment_events"));
    expect(plan.databases.filter((x) => x.restored).map((x) => x.database)).toEqual(["es_t3_empresa_demo_elephant_01_r20261016221031"]);
    const dropped: string[] = [];
    const restored: string[] = [];
    const done = await applyPurge(
      { crm, registry: reg, dropDatabase: async (t) => void dropped.push(t), dropRestoredDatabase: async (_t, db) => void restored.push(db), servers: resources().servers, deleteMedia: async (k) => void bucket.delete(k) },
      plan,
    );
    expect(done.deletedFiles).toBe(2);
    expect(Array.from(bucket)).toEqual(["t/t9-empresa-real/logo.png"]);
    const [schemas] = await admin.query<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?)", [LEFTOVERS]);
    expect(schemas.map((r) => r.n)).toEqual(["es_t9_empresa_real_r20261020101010"]);
    const [usage] = await admin.query<mysql.RowDataPacket[]>("SELECT tenant_id FROM es_erm.usage_hourly");
    expect(usage.map((r) => r.tenant_id)).toEqual(["t9-empresa-real"]);
    expect(dropped.sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    expect(restored).toEqual(["es_t3_empresa_demo_elephant_01_r20261016221031"]);
    expect(done.deleted.find((d) => d.table === "commercial_payment_events")?.rows).toBe(PURGE_TARGETS.length);
    const [[events]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM commercial_payment_events");
    expect(Number(events.n)).toBe(2);
    expect(done.deleted.find((d) => d.table === "crm_companies")?.rows).toBe(PURGE_TARGETS.length);
    expect(await verifyPurge({ crm, registry: reg, resources: resources() })).toEqual({ ok: true, remaining: [] });
    const [left] = await crm.query<mysql.RowDataPacket[]>("SELECT name FROM crm_companies ORDER BY name");
    expect(left.map((r) => r.name)).toEqual(["Empresa Real", "Nextair"]);
    const [[contacts]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM crm_contacts WHERE company_id IN (?)", [realIds]);
    expect(Number(contacts.n)).toBe(2);
    const [[sk]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM tenants WHERE id = 't9-empresa-real' AND status <> 'deleted'");
    expect(Number(sk.n)).toBe(1);
    const [states] = await reg.query<mysql.RowDataPacket[]>("SELECT id, status FROM tenants WHERE id IN (?)", [PURGE_TARGETS.map((t) => t.tenantId)]);
    expect(states.every((r) => r.status === "deleted")).toBe(true);
    const [[dom]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM tenant_domains WHERE tenant_id IN (?)", [PURGE_TARGETS.map((t) => t.tenantId)]);
    expect(Number(dom.n)).toBe(0);
    const [ev] = await reg.query<mysql.RowDataPacket[]>("SELECT tenant_id, action FROM tenant_events ORDER BY id");
    expect(ev.filter((r) => r.action === "purged").map((r) => r.tenant_id).sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    expect(ev.filter((r) => r.action === "created").length).toBe(PURGE_TARGETS.length + 1);
    const [[backups]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM backup_inventory");
    expect(Number(backups.n)).toBe(PURGE_TARGETS.length + 1);
    // Repetir es inocuo: ya no queda nada que purgar
    const again = await planPurge({ crm, registry: reg, tenantDbName: async () => null });
    expect(again.steps).toEqual([]);
    expect(again.retire).toEqual([]);
    expect(again.missing.length).toBe(PURGE_TARGETS.length);
  });
});
