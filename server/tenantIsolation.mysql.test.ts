/**
 * Aislamiento de datos entre tenants con MySQL real (opt-in).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/tenantIsolation.mysql.test.ts
 *
 * Usa el usuario indicado para crear las bases `iso_a` e `iso_b` y el registro de pruebas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

function request(base: string, host: string, p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: p, headers: { host } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(!URL_)("aislamiento con MySQL real", () => {
  let admin: mysql.Pool;
  let server: http.Server;
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const u = new URL(URL_!);
    const mk = (db: string) => `mysql://${u.username}:${decodeURIComponent(u.password)}@${u.host}/${db}`;

    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 3 });
    for (const d of ["iso_a", "iso_b"]) {
      await admin.query(`DROP DATABASE IF EXISTS ${d}`);
      await admin.query(`CREATE DATABASE ${d}`);
      await admin.query(`CREATE TABLE ${d}.items (id INT PRIMARY KEY, name VARCHAR(50))`);
      await admin.query(`INSERT INTO ${d}.items VALUES (1, ?)`, [`dato-de-${d}`]);
    }
    // Registro limpio
    await admin.query("DROP TABLE IF EXISTS tenant_events, tenant_databases, tenant_domains, tenants, registry_meta");
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/registry/0000_registry.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const stmt of ddl.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) await admin.query(stmt);

    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = URL_;
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.DATABASE_URL = mk("no_debe_usarse");

    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { getTenantDatabase, closeAllDatabases } = await import("./_core/dbRegistry");
    const { getTenantId } = await import("./_core/tenant");

    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    for (const [id, host, db] of [
      ["iso-a", "a.iso.test", "iso_a"],
      ["iso-b", "b.iso.test", "iso_b"],
    ] as const) {
      const op = { type: "operator", id: "test" } as const;
      await rt.service.createTenant({ id, displayName: id }, op);
      await rt.service.setStatus(id, "trial", op);
      await rt.service.addDomain(id, host, "platform_subdomain", op);
      await rt.service.activateDomain(host, op);
      const ref = await rt.service.registerDatabase(id, mk(db), op);
      await rt.service.activateDatabase(id, ref.id, op);
    }

    const app = express();
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(bindTenantMiddleware());
    app.get("/items", async (_req, res) => {
      const db = (await getTenantDatabase())!;
      const [rows] = (await db.execute(sql`SELECT name, DATABASE() AS db FROM items`)) as unknown as [Array<{ name: string; db: string }>];
      res.json({ tenant: getTenantId(), rows });
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await closeAllDatabases();
      await rt.close();
    };
  });

  afterAll(async () => {
    await close?.();
    await admin?.query("DROP DATABASE IF EXISTS iso_a");
    await admin?.query("DROP DATABASE IF EXISTS iso_b");
    await admin?.end();
    delete process.env.TENANT_MODE;
  });

  it("cada host solo ve los datos de su propia base de datos", async () => {
    const a = JSON.parse((await request(base, "a.iso.test", "/items")).body);
    const b = JSON.parse((await request(base, "b.iso.test", "/items")).body);
    expect(a).toEqual({ tenant: "iso-a", rows: [{ name: "dato-de-iso_a", db: "iso_a" }] });
    expect(b).toEqual({ tenant: "iso-b", rows: [{ name: "dato-de-iso_b", db: "iso_b" }] });
  });

  it("peticiones intercaladas nunca cruzan datos", async () => {
    const hosts = Array.from({ length: 30 }, (_, i) => (i % 2 ? "b" : "a") + ".iso.test");
    const out = await Promise.all(hosts.map((h) => request(base, h, "/items").then((r) => [h, JSON.parse(r.body)])));
    for (const [h, j] of out as Array<[string, { rows: Array<{ db: string }> }]>) {
      expect(j.rows[0].db).toBe(h.startsWith("a.") ? "iso_a" : "iso_b");
    }
  });

  it("un dominio desconocido no llega a ninguna base de datos (ni a DATABASE_URL)", async () => {
    const r = await request(base, "otro.iso.test", "/items");
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("dato-de");
  });
});
