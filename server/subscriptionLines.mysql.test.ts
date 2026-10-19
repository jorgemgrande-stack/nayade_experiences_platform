/**
 * Partidas comerciales contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada
 * aquí): la migración 0017 guarda tipo y métrica de cada partida; un cambio de cantidad cierra y abre partidas
 * en una transacción; la BD rechaza una ampliación sin métrica; y el almacén sigue funcionando en una BD sin la
 * 0017 (desplegar antes de migrar no rompe nada). Ida y vuelta de la migración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { CrmService } from "./crm/service";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService, activeAt } from "./subscriptions/service";
import { MysqlSubscriptionStore } from "./subscriptions/store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "subscription_lines_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const actor = "operator:partidas";

describe.skipIf(!URL_)("partidas comerciales con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let crm: CrmService;
  let web: MysqlWebStore;
  let clock = Date.UTC(2026, 9, 20, 9);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 5 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    for (const m of loadMigrations(DIR).migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    web = new MysqlWebStore(pool);
    await seedElephantSource(new WebAdminService({ store: web, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), web);
    crm = new CrmService({ store: new MysqlCrmStore(pool), now: () => clock });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const service = () => new SubscriptionService({ store: new MysqlSubscriptionStore(pool), catalog: catalogFromWebStore(web), crm: crmFromStore(new MysqlCrmStore(pool)), now: () => clock });
  const priceOf = async (k: string) => (await catalogFromWebStore(web).offer()).find((x) => x.key === k)!.prices.find((x) => x.kind === "monthly")!.id;
  const newSub = async (svc: SubscriptionService, name: string, users: number) => {
    const c = await crm.createCompany({ name }, actor);
    return svc.create({ companyId: c.id, tenantId: `t-${c.id}`, interval: "month", plan: { productKey: "essential", priceId: await priceOf("essential") }, addons: [{ productKey: "addon-user-essential", priceId: await priceOf("addon-user-essential"), quantity: users }] }, actor);
  };
  const rows = async (subId: number) => (await pool.query<mysql.RowDataPacket[]>("SELECT product_key, line_kind, metric, quantity, effective_from, effective_to FROM subscription_items WHERE subscription_id = ? ORDER BY id", [subId]))[0];

  it("cada partida guarda su tipo y métrica; un cambio de cantidad cierra y abre partidas en la misma transacción", async () => {
    const svc = service();
    const sub = await newSub(svc, "Partidas SL", 2);
    expect((await rows(sub.id)).map((r) => [r.product_key, r.line_kind, r.metric, r.quantity])).toEqual([
      ["essential", "plan", null, 1],
      ["addon-user-essential", "quantity", "users", 2],
    ]);
    clock += 86_400_000;
    const up = await svc.changeQuantity(sub.id, { productKey: "addon-user-essential", quantity: 5 }, sub.version, actor);
    const r = await rows(sub.id);
    expect(r.filter((x) => x.product_key === "addon-user-essential").map((x) => [x.quantity, Number(x.effective_from), x.effective_to === null ? null : Number(x.effective_to)])).toEqual([
      [2, sub.createdAt, clock],
      [5, clock, null],
    ]);
    expect(activeAt(await new MysqlSubscriptionStore(pool).items(sub.id), clock).find((i) => i.productKey === "addon-user-essential")).toMatchObject({ quantity: 5, lineKind: "quantity", metric: "users" });
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT kind, version FROM subscription_events WHERE subscription_id = ? ORDER BY id", [sub.id]);
    expect(ev.map((x) => x.kind)).toEqual(["created", "quantity_changed"]);
    expect(up.subscription.version).toBe(2);
    // La BD no admite una ampliación sin métrica
    await expect(pool.query("UPDATE subscription_items SET metric = NULL WHERE subscription_id = ? AND line_kind = 'quantity'", [sub.id])).rejects.toThrow();
  });

  it("sin la migración 0017 el almacén sigue funcionando (desplegar antes de migrar no rompe); ida y vuelta", async () => {
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0017_subscription_item_lines")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    const [cols] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM subscription_items LIKE 'line_kind'");
    expect(cols).toHaveLength(0);
    const sub = await newSub(service(), "Sin Columnas SL", 1);
    expect((await new MysqlSubscriptionStore(pool).items(sub.id)).map((i) => [i.productKey, i.lineKind ?? null])).toEqual([
      ["essential", null],
      ["addon-user-essential", null],
    ]);
    for (const s of splitStatements(m.up)) await pool.query(s);
    const again = await newSub(service(), "Con Columnas SL", 3);
    expect((await rows(again.id)).map((r) => r.line_kind)).toEqual(["plan", "quantity"]);
  });
});
