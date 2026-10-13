/**
 * Almacén de facturación con MySQL real (opt-in): correlativo atómico bajo concurrencia,
 * deduplicación de eventos, un único contrato por tenant y ciclo completo con el motor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlBillingStore } from "./_core/billing/mysqlStore";
import { SubscriptionService } from "./_core/billing/service";
import { FakeProvider, RecordingEffects } from "./_core/billing/memory";
import type { Catalog } from "./_core/billing/types";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("facturación con MySQL real", () => {
  let pool: mysql.Pool;
  let store: MysqlBillingStore;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: URL_!, connectionLimit: 10 });
    await pool.query("DROP TABLE IF EXISTS billing_subscriptions, billing_invoices, billing_counters, billing_events");
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/billing/0000_billing.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    store = new MysqlBillingStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("numeración correlativa sin duplicados con 30 emisiones concurrentes", async () => {
    const nums = await Promise.all(Array.from({ length: 30 }, () => store.nextInvoiceNumber(2026)));
    expect(new Set(nums).size).toBe(30);
    expect(nums.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("deduplica eventos del proveedor", async () => {
    expect(await store.recordEvent("evt_a", Date.now())).toBe(true);
    expect(await store.recordEvent("evt_a", Date.now())).toBe(false);
  });

  it("ciclo completo con el motor sobre MySQL", async () => {
    const catalog: Catalog = {
      trialDays: 15,
      graceDays: 7,
      trial: { maxCustomDomains: 0, integrations: [], quotas: [] },
      plans: [{ id: "base", name: "Base", kind: "base", interval: "month", priceCents: 1000, currency: "EUR", includedModules: ["cms"], maxCustomDomains: 1, quotas: [] }],
      modules: [],
    };
    let i = 0;
    const svc = new SubscriptionService({
      catalog,
      store,
      provider: new FakeProvider(),
      effects: new RecordingEffects(),
      id: () => `m${++i}_${Date.now()}`,
    });
    await svc.startTrial({ tenantId: "mysql-a", planId: "base" });
    await expect(svc.startTrial({ tenantId: "mysql-a", planId: "base" })).rejects.toMatchObject({ code: "duplicate" });
    const r = await svc.subscribe("mysql-a");
    expect(r.paid).toBe(true);
    expect((await store.getSubscriptionByTenant("mysql-a"))!.status).toBe("active");
    expect((await store.listInvoices("mysql-a"))[0].status).toBe("paid");
  });
});
