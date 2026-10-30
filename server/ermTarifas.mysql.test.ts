/**
 * Tarifas del Resource Manager con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): registro aislado migrado hasta la
 * 0014, primera versión, cambio con historial, rechazo de una versión vieja (también en paralelo) y lectura.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import mysql from "mysql2/promise";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { CostModelConflict, MysqlCostModelStore } from "./_core/erm/costModelStore";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("tarifas editables con MySQL real (registro 0014)", () => {
  const DB = `es_reg_tarifas_${crypto.randomBytes(4).toString("hex")}`;
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlCostModelStore;
  const MODEL = { rates: [{ metric: "email.sent", label: "Correo", unit: "correo", per: 1, centsPerUnit: 0.2 }], sharedMonthlyCents: 1000, sharedBasis: "http.request" };
  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 5, multipleStatements: true });
    const r = await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(r).toMatchObject({ target: "0016", incomplete: [] });
    store = new MysqlCostModelStore(pool);
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("sin fila no hay tarifas de Admin; la primera versión exige partir de 0", async () => {
    expect(await store.get()).toBeNull();
    await expect(store.save(MODEL, { expectedVersion: 3, reason: "Mal", actor: "operator:a", now: 1 })).rejects.toBeInstanceOf(CostModelConflict);
    expect(await store.save(MODEL, { expectedVersion: 0, reason: "Factura de octubre", actor: "operator:a", now: 10 })).toMatchObject({ version: 1 });
    expect(await store.get()).toMatchObject({ version: 1, updatedBy: "operator:a", model: { sharedMonthlyCents: 1000 } });
  });

  it("dos guardados en paralelo sobre la misma versión: solo uno gana; el historial lo recoge", async () => {
    const res = await Promise.allSettled([
      store.save({ ...MODEL, sharedMonthlyCents: 2000 }, { expectedVersion: 1, reason: "Ajuste A", actor: "operator:a", now: 20 }),
      store.save({ ...MODEL, sharedMonthlyCents: 3000 }, { expectedVersion: 1, reason: "Ajuste B", actor: "operator:b", now: 21 }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((r) => r.status === "rejected" && r.reason instanceof CostModelConflict)).toHaveLength(1);
    const h = await store.history(10);
    expect(h.map((x) => x.version)).toEqual([2, 1]);
    expect((await store.get())!.version).toBe(2);
  });
});
