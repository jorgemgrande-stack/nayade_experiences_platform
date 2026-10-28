/**
 * Purga definitiva de las cinco empresas de prueba contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; bases aisladas
 * con todas las migraciones del CRM y del registro): borra solo lo de las cinco, de hijos a padres; Skibox y Nextair
 * intactas; las copias de seguridad se conservan; una factura o un dato live de una empresa de prueba bloquea todo.
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
    const all = [...PURGE_TARGETS.map((t) => ({ name: t.companyName, tenantId: t.tenantId, test: true })), { name: "Skibox", tenantId: "t5-skibox", test: false }, { name: "Nextair", tenantId: null, test: false }];
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
        await seed(reg, "backup_inventory", { target_kind: "tenant", target_id: c.tenantId });
      }
    }
    await crm.query("SET FOREIGN_KEY_CHECKS = 1");
    await reg.query("SET FOREIGN_KEY_CHECKS = 1");
  });

  afterAll(async () => {
    await crm?.end();
    await reg?.end();
    await admin?.query("DROP DATABASE IF EXISTS purge_test_crm");
    await admin?.query("DROP DATABASE IF EXISTS purge_test_registry");
    await admin?.end();
  });

  // t3 sirve desde una base restaurada (`_r<fecha>`), como en production
  const dbName = async (t: string) => `es_${t.replace(/-/g, "_")}${t === "t3-empresa-demo-elephant-01" ? "_r20261016221031" : ""}`;

  it("una base con un nombre ajeno (ni el propio ni el de una restauración) bloquea la purga", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: async (t) => (t === "t1-empresa-demo-elephant-a" ? "es_t5_skibox" : dbName(t)), expectedDbName: (t) => `es_${t.replace(/-/g, "_")}` });
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

  it("purga solo las cinco empresas, de hijos a padres, conserva las copias y deja Skibox y Nextair intactas", async () => {
    const plan = await planPurge({ crm, registry: reg, tenantDbName: dbName, expectedDbName: (t) => `es_${t.replace(/-/g, "_")}` });
    expect(plan.problems).toEqual([]);
    expect(plan.companies.map((c) => c.tenantId).sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    const tables = plan.steps.map((s) => `${s.db}.${s.table}`);
    expect(tables).toEqual(expect.arrayContaining(["crm.crm_contacts", "crm.crm_contracts", "crm.subscriptions", "crm.crm_companies", "registry.tenant_domains", "registry.tenants"]));
    expect(tables.some((t) => t.includes("backup_"))).toBe(false);
    expect(tables.indexOf("crm.crm_companies")).toBeGreaterThan(tables.indexOf("crm.crm_contacts"));
    expect(tables[tables.length - 1]).toBe("registry.tenants");
    expect(tables).toEqual(expect.arrayContaining(["crm.commercial_payment_events", "crm.commercial_payments", "crm.commercial_orders"]));
    expect(tables.indexOf("crm.commercial_payments")).toBeGreaterThan(tables.indexOf("crm.commercial_payment_events"));
    expect(plan.databases.filter((x) => x.restored).map((x) => x.database)).toEqual(["es_t3_empresa_demo_elephant_01_r20261016221031"]);
    const dropped: string[] = [];
    const restored: string[] = [];
    const done = await applyPurge({ crm, registry: reg, dropDatabase: async (t) => void dropped.push(t), dropRestoredDatabase: async (_t, db) => void restored.push(db) }, plan);
    expect(dropped.sort()).toEqual(PURGE_TARGETS.map((t) => t.tenantId).sort());
    expect(restored).toEqual(["es_t3_empresa_demo_elephant_01_r20261016221031"]);
    expect(done.deleted.find((d) => d.table === "commercial_payment_events")?.rows).toBe(5);
    const [[events]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM commercial_payment_events");
    expect(Number(events.n)).toBe(2);
    expect(done.deleted.find((d) => d.table === "crm_companies")?.rows).toBe(5);
    expect(await verifyPurge({ crm, registry: reg })).toEqual({ ok: true, remaining: [] });
    const [left] = await crm.query<mysql.RowDataPacket[]>("SELECT name FROM crm_companies ORDER BY name");
    expect(left.map((r) => r.name)).toEqual(["Nextair", "Skibox"]);
    const [[contacts]] = await crm.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM crm_contacts WHERE company_id IN (?)", [realIds]);
    expect(Number(contacts.n)).toBe(2);
    const [[sk]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM tenants WHERE id = 't5-skibox'");
    expect(Number(sk.n)).toBe(1);
    const [[backups]] = await reg.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM backup_inventory");
    expect(Number(backups.n)).toBe(6);
    // Repetir es inocuo: ya no queda nada que purgar
    const again = await planPurge({ crm, registry: reg, tenantDbName: async () => null });
    expect(again.steps).toEqual([]);
    expect(again.missing.length).toBe(5);
  });
});
