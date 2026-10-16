/**
 * Suscripciones v1 y facturación sombra contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL;
 * BD aislada creada y borrada aquí): migración 0006, transacciones, concurrencia entre conexiones,
 * idempotencia por claves únicas, fallos a medias y webhooks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { ShadowPaymentService, SimulatedProvider } from "./subscriptions/shadowPayments";
import { MysqlSubscriptionStore } from "./subscriptions/store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "subs_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const A = "operator:ana";
const T0 = Date.UTC(2026, 9, 1, 9);

async function migrate(pool: mysql.Pool, direction: "up" | "down", only?: string) {
  const { migrations, errors } = loadMigrations(DIR);
  if (errors.length) throw new Error(errors.join("; "));
  const list = (direction === "up" ? migrations : [...migrations].reverse()).filter((m) => !only || m.id === only);
  for (const m of list) for (const s of splitStatements(direction === "up" ? m.up : m.down!)) await pool.query(s);
}

describe.skipIf(!URL_)("suscripciones con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlSubscriptionStore;
  let subs: SubscriptionService;
  let shadow: ShadowBillingService;
  let web: WebAdminService;
  let clock = T0;
  const P: Record<string, number> = {};

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    await migrate(pool, "up");
    await pool.query("INSERT INTO crm_companies (id, name, created_at) VALUES (1, 'Acme', 1)");
    await pool.query("INSERT INTO crm_contracts (id, company_id, modules, status, amount_cents, currency, created_at, billing_interval) VALUES (10, 1, '[]', 'signed', 9900, 'EUR', 1, 'month'), (12, 1, '[]', 'signed', 9900, 'EUR', 1, 'month')");
    const webStore = new MysqlWebStore(pool);
    web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
    for (const [key, family, act, model] of [
      ["business", "core_plan", { kind: "plan", ref: "business" }, "subscription"],
      ["telefonia", "extension", { kind: "feature", ref: null }, "recurring_addon"],
    ] as const) {
      await web.create({ kind: "product", key, family, draft: { name: key, technicalStatus: "available", activation: act, billingModel: model } }, A);
      await web.publish("product", key, 1, A);
    }
    for (const [name, key, amount] of [["busM", "business", 9900], ["telM", "telefonia", 2000]] as const) {
      const p = await web.addPrice(key, { kind: "monthly", amountCents: amount, taxRateBp: 2100 }, A);
      await web.approvePrice(p.id, A);
      P[name] = p.id;
    }
    store = new MysqlSubscriptionStore(pool);
    const crm = crmFromStore(new MysqlCrmStore(pool));
    subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
    shadow = new ShadowBillingService({ store, crm, now: () => clock });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const create = (contractId: number | null = null) =>
    subs.create({ companyId: 1, contractId, interval: "month", plan: { productKey: "business", priceId: P.busM } }, A);

  it("alta transaccional con referencia, instantánea y evento; un contrato, una suscripción viva", async () => {
    const s = await create(10);
    expect(s.reference).toMatch(/^SUB-2026-\d{6}$/);
    const [items] = await pool.query<mysql.RowDataPacket[]>("SELECT price_id, unit_amount_cents FROM subscription_items WHERE subscription_id = ?", [s.id]);
    expect(items.map((r) => [Number(r.price_id), Number(r.unit_amount_cents)])).toEqual([[P.busM, 9900]]);
    await expect(create(10)).rejects.toMatchObject({ code: "conflict" });
    // La BD también lo impide aunque se salte el servicio
    await expect(
      pool.query("INSERT INTO subscriptions (company_id, contract_id, status, currency, billing_interval, started_at, anchor_day, current_period_start, current_period_end, created_at, created_by) VALUES (1, 10, 'active', 'EUR', 'month', 1, 1, 1, 2, 1, 'x')"),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("dos operadores en conexiones distintas con la misma versión: uno gana y el historial no se pisa", async () => {
    const s = await create();
    const r = await Promise.allSettled([
      subs.addItem(s.id, { item: { productKey: "telefonia", priceId: P.telM } }, 1, A),
      subs.scheduleCancel(s.id, { reason: "Baja" }, 1, "operator:bea"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({ reason: { code: "version_conflict" } });
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT version FROM subscription_events WHERE subscription_id = ? ORDER BY id", [s.id]);
    expect(ev.map((e) => Number(e.version))).toEqual([1, 2]);
  });

  it("un fallo a mitad de una mutación no deja nada: ni partidas, ni versión, ni evento", async () => {
    const s = await create();
    await expect(
      store.mutate(s.id, 1, A, clock, async (tx) => {
        await tx.insertItem({ ...(await tx.items())[0], productKey: "fantasma", effectiveFrom: clock, effectiveTo: null });
        throw new Error("fallo simulado tras insertar");
      }),
    ).rejects.toThrow(/fallo simulado/);
    const [it] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM subscription_items WHERE subscription_id = ? AND product_key = 'fantasma'", [s.id]);
    expect(Number(it[0].n)).toBe(0);
    expect((await store.get(s.id))!.version).toBe(1);
    expect(await store.events(s.id)).toHaveLength(1);
  });

  it("simulaciones simultáneas del mismo periodo: una sola factura sombra", async () => {
    const s = await create(12);
    const runs = await Promise.all(Array.from({ length: 6 }, () => shadow.simulateCurrent(s.id, A)));
    expect(runs.flatMap((r) => r.results).filter((x) => x.created)).toHaveLength(1);
    const ids = new Set(runs.map((r) => r.results[0].invoice.id));
    expect(ids.size).toBe(1);
    const [n] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM shadow_invoices WHERE subscription_id = ?", [s.id]);
    expect(Number(n[0].n)).toBe(1);
    expect(runs[0].results[0].invoice).toMatchObject({ subtotalCents: 9900, taxCents: 2079, totalCents: 11979, contractAmountCents: 9900, contractDiffCents: 0 });
  });

  it("cambio retroactivo de precio en el catálogo: la factura del periodo siguiente sigue el contrato", async () => {
    const s = await create();
    const p = await web.addPrice("business", { kind: "monthly", amountCents: 19900, taxRateBp: 2100 }, A);
    await web.approvePrice(p.id, A); // retira el precio contratado
    clock = s.currentPeriodEnd;
    await subs.applyRenewals(s.id, "system");
    const sim = await shadow.simulateCurrent(s.id, A);
    expect(sim.results[0].invoice.subtotalCents).toBe(9900);
    clock = T0;
    // La versión de precio aceptada sigue enlazada (FK) y no se puede borrar
    await expect(pool.query("DELETE FROM web_prices WHERE id = ?", [P.busM])).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    P.busM = p.id;
  });

  it("cobros simulados: intentos simultáneos → un intento y un cargo; red caída → misma clave", async () => {
    const s = await create();
    const inv = (await shadow.simulateCurrent(s.id, A)).results[0].invoice;
    const provider = new SimulatedProvider().next("network_error_after");
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    await Promise.all([pay.attempt(inv.id), pay.attempt(inv.id), pay.attempt(inv.id)]);
    const [ch] = await pool.query<mysql.RowDataPacket[]>("SELECT attempt, idempotency_key, status FROM shadow_charges WHERE invoice_id = ?", [inv.id]);
    expect(ch).toHaveLength(1);
    await pay.attempt(inv.id);
    expect(provider.executed).toHaveLength(1);
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("paid");
  });

  it("webhook: si el efecto falla, el evento queda «failed» y se reprocesa; duplicado procesado sin efecto", async () => {
    const s = await create();
    const inv = (await shadow.simulateCurrent(s.id, A)).results[0].invoice;
    const provider = new SimulatedProvider().next("processing");
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    await pay.attempt(inv.id);
    const key = `inv:${inv.id}:a1`;
    // Efecto que falla tras empezar: nada se aplica y el evento queda failed
    await expect(
      store.webhookTx("evt_fail", clock, async (l) => {
        const f = await l.byKey(key);
        await f!.tx.setPaymentStatus("paid");
        throw new Error("fallo a mitad del efecto");
      }),
    ).rejects.toThrow(/fallo a mitad/);
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT status FROM shadow_webhook_events WHERE provider_event_id = 'evt_fail'");
    expect(ev[0].status).toBe("failed");
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("pending");
    // El proveedor reintenta el mismo evento: ahora se procesa
    expect((await pay.webhook({ id: "evt_fail", key, status: "succeeded", ref: "sim" })).status).toBe("processed");
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("paid");
    expect((await pay.webhook({ id: "evt_fail", key, status: "failed", ref: "sim" })).status).toBe("duplicate");
  });

  it("intervalos mixtos (plan anual + complemento mensual): una renovación por periodo propio, sin duplicar entre conexiones", async () => {
    const y = await web.addPrice("business", { kind: "yearly", amountCents: 99000, taxRateBp: 2100 }, A);
    await web.approvePrice(y.id, A);
    const s = await subs.create({ companyId: 1, interval: "year", plan: { productKey: "business", priceId: y.id }, addons: [{ productKey: "telefonia", priceId: P.telM }] }, A);
    clock = T0 + 40 * 86_400_000; // segundo mes empezado
    const runs = await Promise.all(Array.from({ length: 4 }, () => shadow.simulateCurrent(s.id, A)));
    expect(runs.flatMap((r) => r.results).filter((x) => x.created)).toHaveLength(3);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT kind, dedupe_key, period_start, period_end, subtotal_cents FROM shadow_invoices WHERE subscription_id = ? ORDER BY period_start, dedupe_key", [s.id]);
    expect(rows.map((r) => [r.kind, r.dedupe_key, Number(r.subtotal_cents)])).toEqual([
      ["renewal", "", 99000],
      ["renewal", "interval:month", 2000],
      ["renewal", "interval:month", 2000],
    ]);
    expect(Number(rows[0].period_end)).toBe(s.currentPeriodEnd);
    expect(Number(rows[2].period_start)).toBe(Number(rows[1].period_end));
    clock = T0;
  });

  it("consumos idempotentes por clave única en la BD", async () => {
    const [r] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM subscription_items LIMIT 1");
    const rec = { itemId: Number(r[0].id), periodStart: 1, quantity: 5, source: "erm", idempotencyKey: "erm:k:0001", createdAt: 1 };
    const a = await store.addUsage(rec);
    const b = await store.addUsage(rec);
    expect([a.created, b.created]).toEqual([true, false]);
    expect(await store.usageTotal(rec.itemId, 1)).toBe(5);
  });

  it("la migración 0006 se revierte y se vuelve a aplicar", async () => {
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");
    await migrate(pool, "down", "0006_subscriptions");
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'subscription%'");
    expect(t).toHaveLength(0);
    await migrate(pool, "up", "0006_subscriptions");
    const [t2] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES WHERE Tables_in_subs_test LIKE 'subscription%' OR Tables_in_subs_test LIKE 'shadow%'");
    expect(t2).toHaveLength(7);
  });
});
