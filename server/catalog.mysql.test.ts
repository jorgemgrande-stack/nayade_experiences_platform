/**
 * Catálogo de Elephant Source con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): migración 0008
 * (tipo «capability»), semilla completa e idempotente, cotización sobre la BD y reversión de 0008.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { quote } from "./catalog/quote";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { CrmService } from "./crm/service";
import { MysqlCrmStore } from "./crm/mysqlStore";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const DB = "catalog_es_test";

describe.skipIf(!URL_)("catálogo de Elephant Source con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlWebStore;
  let svc: WebAdminService;
  const migrations = () => {
    const { migrations: list, errors } = loadMigrations(DIR);
    if (errors.length) throw new Error(errors.join("; "));
    return list;
  };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 6 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    for (const m of migrations()) for (const s of splitStatements(m.up)) await pool.query(s);
    store = new MysqlWebStore(pool);
    svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("semilla completa: 74 capacidades y todos los productos publicados con sus tarifas; repetirla no cambia nada", async () => {
    const r = await seedElephantSource(svc, store);
    expect(r.conflicts).toEqual([]);
    expect(r.created).toHaveLength(74 + PRODUCTS.length);
    const [[counts]] = (await pool.query<mysql.RowDataPacket[]>(
      "SELECT SUM(kind = 'capability') AS caps, SUM(kind = 'product') AS products, SUM(publication = 'published') AS published FROM web_entries",
    )) as unknown as [[{ caps: string; products: string; published: string }]];
    expect([Number(counts.caps), Number(counts.products), Number(counts.published)]).toEqual([74, PRODUCTS.length, 74 + PRODUCTS.length]);
    const [[prices]] = (await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM web_prices WHERE status = 'approved'")) as unknown as [[{ n: number }]];
    expect(Number(prices.n)).toBe(PRODUCTS.reduce((a, p) => a + p.prices.length, 0));
    const again = await seedElephantSource(svc, store);
    expect([again.created, again.updated, again.published, again.pricesApproved]).toEqual([[], [], [], []]);
  }, 180_000);

  it("cotiza sobre la BD con las tarifas oficiales", async () => {
    const cat = quoteCatalogFromSite(await svc.site("published"));
    const r = quote(cat, { plan: "business", interval: "year", items: [{ key: "restaurant-net-complete" }, { key: "connect-pack-finance" }], sites: 6 });
    expect(r.ok).toBe(true);
    expect(r.totals.yearlyCents).toBe(75_900);
    expect(r.totals.monthlyCents).toBe(5_900 + 4_500 + 1_200);
  });

  it("contrato con configuración cotizada (migración 0009): se guarda, se lee y entra en la versión", async () => {
    const crm = new CrmService({ store: new MysqlCrmStore(pool) });
    const co = await crm.createCompany({ name: "Empresa Prueba" }, "t");
    const cat = quoteCatalogFromSite(await svc.site("published"));
    const q = quote(cat, { plan: "essential", interval: "month", items: [{ key: "connect-people" }] });
    const configuration = { request: { plan: "essential", interval: "month" as const, items: [{ key: "connect-people" }] }, quote: { catalogVersion: q.catalogVersion, currency: q.currency, lines: q.lines, totals: q.totals, capabilities: q.capabilities, contractable: q.contractable, blocking: q.blocking, warnings: q.warnings }, quotedAt: 1 };
    const c = await crm.createContract({ companyId: co.id, planId: "essential", billingInterval: "month", amountCents: q.totals.monthlyCents, configuration }, "t");
    const again = await new MysqlCrmStore(pool).get("contracts", c.id);
    expect(again!.configuration!.quote.totals.monthlyCents).toBe(2900 + 1900);
    const [[v]] = (await pool.query<mysql.RowDataPacket[]>("SELECT snapshot FROM crm_contract_versions WHERE contract_id = ?", [c.id])) as unknown as [[{ snapshot: string | Record<string, unknown> }]];
    const snap = typeof v.snapshot === "string" ? JSON.parse(v.snapshot) : v.snapshot;
    expect(snap.configuration.request.items).toEqual([{ key: "connect-people" }]);
    // Un contrato sin configuración sigue funcionando igual (null)
    const plain = await crm.createContract({ companyId: co.id, planId: "essential" }, "t");
    expect((await new MysqlCrmStore(pool).get("contracts", plain.id))!.configuration).toBeNull();
  });

  it("la reversión de 0008 retira solo las capacidades y vuelve a aplicarse limpia", async () => {
    const m8 = migrations().find((m) => m.id.startsWith("0008"))!;
    for (const s of splitStatements(m8.down!)) await pool.query(s);
    const [[after]] = (await pool.query<mysql.RowDataPacket[]>("SELECT SUM(kind = 'capability') AS caps, COUNT(*) AS total FROM web_entries")) as unknown as [[{ caps: string | null; total: number }]];
    expect(Number(after.caps ?? 0)).toBe(0);
    expect(Number(after.total)).toBe(PRODUCTS.length);
    for (const s of splitStatements(m8.up)) await pool.query(s);
    await expect(pool.query("INSERT INTO web_entries (kind, entry_key, draft, created_at, created_by, updated_at, updated_by) VALUES ('capability', 'crm-tags', '{}', 0, 't', 0, 't')")).resolves.toBeTruthy();
  });
});
