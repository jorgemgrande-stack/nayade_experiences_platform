/**
 * Perfil fiscal del comprador (migración CRM 0014) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD
 * aislada creada y borrada aquí): versiones con historial, escrituras simultáneas, separación de modos,
 * restricción de la BD (empresa sin identificador fiscal) y reversión.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlStripeStore, StripeStoreError } from "./store";
import { buildConsent, toBuyerProfile, type ConsentVersions } from "./buyerProfile";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_buyer_profile_test";
const now = Date.UTC(2026, 9, 19, 9);
const V: ConsentVersions = { terms: "c1", privacy: null, precontract: null, withdrawal: "pending" };

describe.skipIf(!URL_)("perfil fiscal del comprador con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let orderId = 0;
  let order2 = 0;
  const migrationsDir = path.resolve(__dirname, "../../db/crm/migrations");

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(migrationsDir);
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    // Una empresa por pedido: solo puede haber un pedido de alta abierto por empresa
    for (const k of ["clave-comprador-0000001", "clave-comprador-0000002"]) {
      const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES (?, ?)`, [`Comprador ${k}`, now])) as unknown as [{ insertId: number }];
      const [o] = (await pool.query(`INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, request_json, created_at, created_by) VALUES (?, REPEAT('c', 64), 'new', 'contracted', ?, '{}', ?, 't')`, [k, c.insertId, now])) as unknown as [{ insertId: number }];
      if (!orderId) orderId = o.insertId;
      else order2 = o.insertId;
    }
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const business = (id: number, legalName = "Comprador SL") =>
    toBuyerProfile(id, { type: "business", legalName, taxId: "B12345678", country: "ES", postalCode: "28002" }, buildConsent(id, "business", { terms: true, termsVersion: "c1" }, V, "operator", now), now);

  it("guarda la versión 1, la relee igual y una corrección pasa a la versión 2 con historial", async () => {
    const store = new MysqlStripeStore(pool, "test");
    expect(await store.buyerProfile(orderId)).toBeNull();
    const v1 = await store.saveBuyerProfile(business(orderId), "operator:ana");
    expect(v1).toMatchObject({ version: 1, scenario: "business:es_mainland", taxIdStatus: "unverified" });
    expect(await store.buyerProfile(orderId)).toEqual(v1);
    const v2 = await store.saveBuyerProfile({ ...business(orderId, "Comprador Renombrado SL"), now: now + 1000 }, "operator:luis");
    expect(v2).toMatchObject({ version: 2, displayName: "Comprador Renombrado SL", createdAt: v1.createdAt, updatedAt: now + 1000 });
    const [h] = await pool.query<mysql.RowDataPacket[]>("SELECT version, actor, JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, '$.displayName')) AS n FROM stripe_buyer_profile_events WHERE order_id = ? ORDER BY version", [orderId]);
    expect(h.map((r) => [r.version, r.actor, r.n])).toEqual([
      [1, "operator:ana", "Comprador SL"],
      [2, "operator:luis", "Comprador Renombrado SL"],
    ]);
  });

  it("dos correcciones simultáneas no pisan versiones (bloqueo de fila)", async () => {
    const store = new MysqlStripeStore(pool, "test");
    const r = await Promise.all([store.saveBuyerProfile(business(orderId, "A SL"), "a"), store.saveBuyerProfile(business(orderId, "B SL"), "b")]);
    expect(r.map((x) => x.version).sort()).toEqual([3, 4]);
    const [h] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM stripe_buyer_profile_events WHERE order_id = ?", [orderId]);
    expect(Number(h[0].n)).toBe(4);
  });

  it("cada modo solo ve sus perfiles; escribir el de otro modo se rechaza", async () => {
    const live = new MysqlStripeStore(pool, "live");
    expect(await live.buyerProfile(orderId)).toBeNull();
    await expect(live.saveBuyerProfile(business(orderId), "x")).rejects.toThrow(StripeStoreError);
    const p = await live.saveBuyerProfile(business(order2), "live:op");
    expect(p.version).toBe(1);
    expect(await new MysqlStripeStore(pool, "test").buyerProfile(order2)).toBeNull();
  });

  it("la BD rechaza una empresa sin identificador fiscal aunque falle la validación del código", async () => {
    await expect(
      pool.query("INSERT INTO stripe_buyer_profiles (order_id, livemode, buyer_type, territory, scenario, country, display_name, tax_id, consent_json, created_at, updated_at) VALUES (?, 0, 'business', 'es_mainland', 'business:es_mainland', 'ES', 'Sin NIF', NULL, '{}', ?, ?)", [order2 + 1000, now, now]),
    ).rejects.toThrow();
  });

  it("domicilio de facturación (0020): se guarda y se relee; sin la columna, el perfil se guarda igual y sin dirección", async () => {
    const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES ('Comprador domicilio', ?)`, [now])) as unknown as [{ insertId: number }];
    const [o] = (await pool.query(`INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, request_json, created_at, created_by) VALUES ('clave-comprador-0000003', REPEAT('c', 64), 'new', 'contracted', ?, '{}', ?, 't')`, [c.insertId, now])) as unknown as [{ insertId: number }];
    const order3 = o.insertId;
    const withAddress = toBuyerProfile(order3, { type: "consumer", firstName: "Ana", lastName: "Domicilio", country: "ES", postalCode: "07001", line1: "Carrer de Sant Miquel, 3", city: "Palma", state: "Illes Balears" }, buildConsent(order3, "business", { terms: true, termsVersion: "c1" }, V, "operator", now), now);
    const store = new MysqlStripeStore(pool, "test");
    const saved = await store.saveBuyerProfile(withAddress, "operator:ana");
    expect(saved.billingAddress).toEqual({ line1: "Carrer de Sant Miquel, 3", line2: null, city: "Palma", state: "Illes Balears" });
    expect((await store.buyerProfile(order3))?.billingAddress).toEqual(saved.billingAddress);
    // Reversión de la 0020: el código sigue funcionando (sin dirección) y el historial conserva la que hubo
    for (const s of splitStatements(fs.readFileSync(path.join(migrationsDir, "0020_buyer_billing_address.down.sql"), "utf8"))) await pool.query(s);
    const legacy = new MysqlStripeStore(pool, "test");
    expect(await legacy.hasBuyerAddressColumn()).toBe(false);
    const v = await legacy.saveBuyerProfile({ ...withAddress, now: now + 1 }, "operator:ana");
    expect(v.billingAddress).toBeNull();
    expect((await legacy.buyerProfile(order3))?.billingAddress).toBeNull();
    const [h] = await pool.query<mysql.RowDataPacket[]>("SELECT JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, '$.billingAddress.city')) AS c FROM stripe_buyer_profile_events WHERE order_id = ? ORDER BY version LIMIT 1", [order3]);
    expect(h[0].c).toBe("Palma");
    for (const s of splitStatements(fs.readFileSync(path.join(migrationsDir, "0020_buyer_billing_address.sql"), "utf8"))) await pool.query(s);
    // Limpieza: el pedido de esta prueba no cuenta en las siguientes
    await pool.query("DELETE FROM stripe_buyer_profile_events WHERE order_id = ?", [order3]);
    await pool.query("DELETE FROM stripe_buyer_profiles WHERE order_id = ?", [order3]);
    await pool.query("DELETE FROM commercial_orders WHERE id = ?", [order3]);
    await pool.query("DELETE FROM crm_companies WHERE id = ?", [c.insertId]);
  });

  it("reversión: borra solo las tablas del perfil; sin la tabla, la lectura devuelve null (no rompe)", async () => {
    const down = fs.readFileSync(path.join(migrationsDir, "0014_stripe_buyer_profiles.down.sql"), "utf8");
    for (const s of splitStatements(down)) await pool.query(s);
    expect(await new MysqlStripeStore(pool, "test").buyerProfile(orderId)).toBeNull();
    const [o] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM commercial_orders");
    expect(Number(o[0].n)).toBe(2);
  });
});
