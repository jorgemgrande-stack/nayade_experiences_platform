/**
 * Cambios de partidas enviados a Stripe contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y
 * borrada aquí, con las migraciones del CRM hasta la 0018): un pedido, un cambio; idempotente; como mucho un
 * cambio pendiente por suscripción (también con inserciones simultáneas); solo se sale de `pending` una vez;
 * filas de otro modo invisibles; ida y vuelta de la migración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlCrmStore } from "../crm/mysqlStore";
import { CrmService } from "../crm/service";
import { MysqlOrderStore } from "../orchestrator/store";
import { MysqlSubscriptionChangeStore, SubscriptionChangeError, type NewSubscriptionChange } from "./changes";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_changes_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const actor = "operator:cambios";

describe.skipIf(!URL_)("cambios de partidas de Stripe con MySQL real (CRM 0018)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlSubscriptionChangeStore;
  const orderIds: number[] = [];
  let companyId = 0;
  const clock = Date.UTC(2026, 9, 20, 9);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0018_stripe_subscription_changes");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
    const crm = new CrmService({ store: new MysqlCrmStore(pool), now: () => clock });
    companyId = (await crm.createCompany({ name: "Cambios SL" }, actor)).id;
    const orders = new MysqlOrderStore(pool);
    for (let i = 0; i < 4; i++) {
      // Un pedido de alta abierto por empresa: una empresa por pedido
      const cid = i === 0 ? companyId : (await crm.createCompany({ name: `Cambios ${i} SL` }, actor)).id;
      const { order } = await orders.insert({
        idempotencyKey: `cambio-de-prueba-${i}-xxxxxxxx`,
        payloadHash: "h",
        kind: "new",
        state: "requested",
        companyId: cid,
        leadRequestId: null,
        trialId: null,
        previousOrderId: null,
        request: { plan: "essential", interval: "month", items: [] },
        quote: null,
        contractId: null,
        subscriptionId: null,
        tenantId: null,
        confirmation: null,
        graceEndsAt: null,
        attempts: 0,
        lastError: null,
        createdAt: clock,
        createdBy: actor,
      });
      orderIds.push(order.id);
    }
    store = new MysqlSubscriptionChangeStore(pool, "test");
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const draft = (i: number, sub = "sub_test_1"): NewSubscriptionChange => ({
    orderId: orderIds[i],
    companyId,
    stripeSubscriptionId: sub,
    idempotencyKey: `es-local-order-${orderIds[i]}-items-v1`,
    items: [{ priceId: "price_mod", quantity: 1 }],
    expectedItems: [
      { priceId: "price_plan", quantity: 1 },
      { priceId: "price_mod", quantity: 1 },
    ],
    createdBy: actor,
    createdAt: clock,
  });

  it("un pedido, un cambio (idempotente); un solo pendiente por suscripción, también a la vez", async () => {
    const a = await store.insert(draft(0));
    expect(a.created).toBe(true);
    expect(a.change).toMatchObject({ status: "pending", expectedItems: draft(0).expectedItems, stripeInvoiceId: null });
    expect(await store.insert(draft(0))).toMatchObject({ created: false, change: { id: a.change.id } });
    await expect(store.insert(draft(1))).rejects.toBeInstanceOf(SubscriptionChangeError);
    // Otra suscripción sí admite su propio pendiente; simultáneos sobre la misma: solo uno gana
    const r = await Promise.allSettled([store.insert(draft(2, "sub_test_2")), store.insert(draft(3, "sub_test_2"))]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason.code)).toEqual(["pending_exists"]);
  });

  it("factura del cambio; solo se resuelve una vez; resuelto, la suscripción admite otro pendiente", async () => {
    const c = (await store.byOrder(orderIds[0]))!;
    const withInv = await store.setInvoice(c.id, { stripeInvoiceId: "in_test_1", amountDueCents: 950, expiresAt: clock + 23 * 3600_000 }, clock + 1);
    expect(withInv).toMatchObject({ stripeInvoiceId: "in_test_1", amountDueCents: 950, status: "pending" });
    expect((await store.pending(10)).map((x) => x.id)).toContain(c.id);
    expect(await store.resolve(c.id, "expired", "caducó", clock + 2)).toBe(true);
    expect(await store.resolve(c.id, "applied", null, clock + 3)).toBe(false);
    expect((await store.byOrder(orderIds[0]))!.status).toBe("expired");
    expect((await store.insert(draft(1))).created).toBe(true);
    expect((await store.ofSubscription("sub_test_1")).map((x) => x.orderId)).toEqual([orderIds[1], orderIds[0]]);
  });

  it("las filas de otro modo no se ven; la migración se revierte y se vuelve a aplicar", async () => {
    const live = new MysqlSubscriptionChangeStore(pool, "live");
    expect(await live.byOrder(orderIds[0])).toBeNull();
    expect(await live.ofSubscription("sub_test_1")).toEqual([]);
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0018_stripe_subscription_changes")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'stripe_subscription_changes'");
    expect(t).toHaveLength(0);
    for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await store.pending(10)).toEqual([]);
  });
});
