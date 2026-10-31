/**
 * Integridad fiscal con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): una empresa
 * aprovisionada desde la baseline, login de administrador y llamadas tRPC reales.
 *  - Una factura emitida no se borra (FORBIDDEN) y sigue existiendo.
 *  - Los abonos siguen en la serie vigente ABO-AAAA-MM-nnnn (sin cambio de serie fiscal), sin duplicados con
 *    concurrencia y continuando tras los números ya emitidos, que no se tocan.
 *  - El total abonado nunca supera lo facturado, tampoco con abonos simultáneos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import express from "express";
import mysql from "mysql2/promise";
import { madridMonth, madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const T = `fis-${run}`;
const PASS = "clave-fiscal-" + run;
// Año y mes de Madrid, como la numeración (en la CI, en UTC, la medianoche de Madrid cae en otro mes)
const YEAR = madridYear();
const ABO = `ABO-${YEAR}-${String(madridMonth()).padStart(2, "0")}-`;
const ABO_RE = new RegExp(`^${ABO}\\d{4}$`);

describe.skipIf(!URL_)("integridad fiscal (routers reales)", () => {
  let admin: mysql.Pool;
  let tenantDb: mysql.Connection;
  let server: http.Server;
  let port: number;
  let cookie = "";
  let closeAll: () => Promise<void>;
  const host = `${T}.elephantsource.es`;

  function call(method: string, p: string, body?: unknown) {
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port, path: p, method, headers: { host, ...(cookie ? { cookie } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => {
            let json: any = null;
            try {
              json = JSON.parse(b);
            } catch {
              /* texto */
            }
            if (res.headers["set-cookie"]?.[0] && p === "/api/auth/login") cookie = res.headers["set-cookie"][0].split(";")[0];
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }
  const mutate = (proc: string, input: unknown) => call("POST", `/api/trpc/${proc}`, { json: input });
  const ok = (r: { status: number; json: any }) => {
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  };
  async function invoice(number: string, total: number) {
    const [res] = await tenantDb.query<mysql.ResultSetHeader>(
      "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, invoiceType, isAutomatic, issuedAt, createdAt, updatedAt) VALUES (?, 'Cliente Prueba', 'cliente@prueba.example', ?, ?, '21', ?, ?, 'cobrada', 'factura', 0, NOW(), NOW(), NOW())",
      [number, JSON.stringify([{ description: "Servicio", quantity: 1, unitPrice: total, total }]), (total / 1.21).toFixed(2), (total - total / 1.21).toFixed(2), total.toFixed(2)],
    );
    return res.insertId;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = URL_!;
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
    process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run;
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";

    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 6 });
    const [t] = await admin.query("SHOW TABLES LIKE 'tenant_provisioning'");
    if (!(t as unknown[]).length) {
      for (const f of ["0000_registry", "0001_entitlements", "0002_quotas", "0003_provisioning", "0004_support"]) {
        const ddl = fs.readFileSync(path.resolve(__dirname, `../db/registry/${f}.sql`), "utf8").replace(/^--.*$/gm, "");
        for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await admin.query(s).catch(() => undefined);
      }
    }
    const { MysqlTenantRegistryStore } = await import("./_core/tenantRegistry/mysqlStore");
    const { TenantRegistryService } = await import("./_core/tenantRegistry/service");
    const { keyringFromEnv } = await import("./_core/tenantRegistry/crypto");
    const { ProvisioningService } = await import("./_core/provisioning/service");
    const prov = await import("./_core/provisioning/mysqlAdapters");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const { QuotaAdmin } = await import("./_core/erm/mysqlQuotas");
    const store = new MysqlTenantRegistryStore(admin);
    const svc = new TenantRegistryService(store, () => keyringFromEnv(process.env));
    const p = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
      seeder: new prov.MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(admin),
      quotas: new QuotaAdmin(admin),
      store: new prov.MysqlProvisioningStore(admin),
    });
    const r = await p.run({ tenantId: T, displayName: T, adminEmail: `admin@${T}.example`, platformDomain: "elephantsource.es" }, { type: "operator", id: "test" });
    expect(r.status).toBe("completed");
    tenantDb = await mysql.createConnection({ uri: (await svc.getActiveDsn(T))! });
    await tenantDb.query("UPDATE users SET passwordHash = ? WHERE email = ?", [await bcrypt.hash(PASS, 4), `admin@${T}.example`]);

    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { createLocalAuthRouter } = await import("./localAuth");
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const { appRouter } = await import("./routers");
    const { createLocalContext } = await import("./_core/context.local");
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    const app = express();
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    app.use(createLocalAuthRouter());
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext }));
    server = http.createServer(app);
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    port = (server.address() as AddressInfo).port;
    closeAll = async () => {
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
      await closeAllDatabases();
      await rt.close();
    };
    expect((await call("POST", "/api/auth/login", { email: `admin@${T}.example`, password: PASS })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await closeAll?.();
    await tenantDb?.end();
    // El contenedor de pruebas es desechable: la BD del tenant de prueba (id aleatorio) no se reutiliza
    await admin?.end();
  });

  it("una factura emitida no se borra: FORBIDDEN y sigue existiendo", async () => {
    const id = await invoice(`FAC-${YEAR}-9001`, 121);
    const r = await mutate("crm.invoices.delete", { invoiceId: id });
    expect(r.status).toBe(403);
    expect(r.json.error.json.message).toMatch(/no se pueden borrar/);
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SELECT id FROM invoices WHERE id = ?", [id]);
    expect(rows).toHaveLength(1);
  });

  it("abonos simultáneos: numeración ABO sin duplicados y nunca más de lo facturado", async () => {
    const id = await invoice(`FAC-${YEAR}-9002`, 121);
    // Cuatro abonos de 50 a la vez sobre 121: como mucho caben dos
    const results = await Promise.all([1, 2, 3, 4].map(() => mutate("crm.invoices.createCreditNote", { invoiceId: id, reason: "Abono parcial", partialAmount: 50 })));
    const okNumbers = results.filter((r) => r.status === 200).map((r) => r.json.result.data.json.creditNoteNumber as string);
    expect(okNumbers).toHaveLength(2);
    expect(new Set(okNumbers).size).toBe(2);
    for (const n of okNumbers) expect(n).toMatch(ABO_RE);
    const [[sum]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT SUM(ABS(total)) AS s FROM invoices WHERE creditNoteForId = ?", [id])) as unknown as [[{ s: string }]];
    expect(Number(sum.s)).toBe(100);
    // Lo pendiente (21) cierra la factura; después ya no se puede abonar
    ok(await mutate("crm.invoices.createCreditNote", { invoiceId: id, reason: "Resto" }));
    const [[st]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status FROM invoices WHERE id = ?", [id])) as unknown as [[{ status: string }]];
    expect(st.status).toBe("abonada");
    expect((await mutate("crm.invoices.createCreditNote", { invoiceId: id, reason: "Otra vez", partialAmount: 1 })).status).toBe(400);
  });

  it("importes no válidos: cero, negativo o por encima de lo pendiente", async () => {
    const id = await invoice(`FAC-${YEAR}-9003`, 50);
    for (const partialAmount of [0, -10, 60]) expect((await mutate("crm.invoices.createCreditNote", { invoiceId: id, reason: "x", partialAmount })).status, String(partialAmount)).toBe(400);
  });

  it("abono total: cubre todo lo facturado y cierra la factura", async () => {
    const id = await invoice(`FAC-${YEAR}-9004`, 242);
    const r = ok(await mutate("crm.invoices.createCreditNote", { invoiceId: id, reason: "Abono total" }));
    expect(r.creditNoteNumber).toMatch(ABO_RE);
    const [[cn]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT total FROM invoices WHERE id = ?", [r.creditNoteId])) as unknown as [[{ total: string }]];
    expect(Number(cn.total)).toBe(-242);
    const [[st]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status FROM invoices WHERE id = ?", [id])) as unknown as [[{ status: string }]];
    expect(st.status).toBe("abonada");
  });

  it("los abonos ya emitidos se conservan y la serie continúa tras el mayor (también con huecos)", async () => {
    // Un abono antiguo con un número alto (hueco en la serie): el siguiente es ese + 1, no un recuento
    const legacyId = await invoice(`${ABO}0500`, 10);
    await tenantDb.query("UPDATE invoices SET invoiceType = 'abono', total = '-10.00' WHERE id = ?", [legacyId]);
    const [before] = await tenantDb.query<mysql.RowDataPacket[]>("SELECT id, invoiceNumber, total, status FROM invoices WHERE invoiceType = 'abono' ORDER BY id");
    const id = await invoice(`FAC-${YEAR}-9005`, 30);
    const r = ok(await mutate("crm.invoices.createCreditNote", { invoiceId: id, reason: "Tras hueco", partialAmount: 5 }));
    expect(r.creditNoteNumber).toBe(`${ABO}0501`);
    const [after] = await tenantDb.query<mysql.RowDataPacket[]>("SELECT id, invoiceNumber, total, status FROM invoices WHERE invoiceType = 'abono' AND id <> ? ORDER BY id", [r.creditNoteId]);
    expect(after).toEqual(before);
  });

  it("abonos simultáneos de facturas distintas: ningún número duplicado (reintento por índice único)", async () => {
    const ids = await Promise.all([9006, 9007, 9008, 9009, 9010, 9011].map((n) => invoice(`FAC-${YEAR}-${n}`, 100)));
    const results = await Promise.all(ids.map((invoiceId) => mutate("crm.invoices.createCreditNote", { invoiceId, reason: "Simultáneo", partialAmount: 10 })));
    const numbers = results.map((r) => ok(r).creditNoteNumber as string);
    expect(new Set(numbers).size).toBe(ids.length);
    for (const n of numbers) expect(n).toMatch(ABO_RE);
    const [dups] = await tenantDb.query<mysql.RowDataPacket[]>("SELECT invoiceNumber FROM invoices GROUP BY invoiceNumber HAVING COUNT(*) > 1");
    expect(dups).toHaveLength(0);
  });
});
