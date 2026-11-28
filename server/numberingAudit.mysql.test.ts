/**
 * Auditoría de numeración de SOLO LECTURA (documentNumbers.auditSeries) con la APLICACIÓN REAL (MySQL, opt-in).
 *
 * Dos empresas aprovisionadas con la baseline completa. Comprueba: resultado correcto y determinista sobre datos sembrados
 * (DEV históricos, contadores, facturas), aislamiento entre empresas, solo lectura (ninguna tabla cambia), rechazo sin sesión y
 * con rol no administrador, y ausencia de datos personales en la salida.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:3306/registry_test \
 *     pnpm vitest run server/numberingAudit.mysql.test.ts
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
import { madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const A = `num-a-${run}`;
const B = `num-b-${run}`;
const PASS: Record<string, string> = { [A]: "clave-de-A-" + run, [B]: "clave-de-B-" + run };
const AGENT_PASS = "clave-agente-" + run;
const YEAR = madridYear();
const PII = `Persona Privada ${run}`;
const PII_MAIL = `privado-${run}@cliente.example`;

describe.skipIf(!URL_)("auditoría de numeración (solo lectura, por empresa)", () => {
  let admin: mysql.Pool;
  let server: http.Server;
  let port: number;
  let closeAll: () => Promise<void>;
  const host = (id: string) => `${id}.elephantsource.es`;
  const cookies: Record<string, string> = {};
  const dsn: Record<string, string> = {};

  function call(h: string, method: string, p: string, opts: { cookie?: string; body?: unknown } = {}) {
    return new Promise<{ status: number; json: any; cookie?: string }>((resolve, reject) => {
      const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: p,
          method,
          headers: {
            host: h,
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          },
        },
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
            resolve({ status: res.statusCode ?? 0, json, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  /** Consulta tRPC como el admin de la empresa `id`; devuelve el dato o lanza con el error. */
  async function q(id: string, proc: string, input?: unknown) {
    const qs = input === undefined ? "" : "?input=" + encodeURIComponent(JSON.stringify({ json: input }));
    const r = await call(host(id), "GET", `/api/trpc/${proc}${qs}`, { cookie: cookies[id] });
    if (r.status !== 200) throw new Error(`${proc} en ${id}: ${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  }
  async function m(id: string, proc: string, input: unknown) {
    const r = await call(host(id), "POST", `/api/trpc/${proc}`, { cookie: cookies[id], body: { json: input } });
    if (r.status !== 200) throw new Error(`${proc} en ${id}: ${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
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
    // Cualquier uso de la BD «global» fallaría: no existe
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
    const ring = keyringFromEnv(process.env);
    const svc = new TenantRegistryService(store, () => ring);
    const entitlements = new EntitlementAdmin(admin);
    const p = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema: new prov.MysqlSchemaApplier({
        baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"),
        migrationsDir: path.resolve(__dirname, "../db/migrations"),
      }),
      seeder: new prov.MysqlTenantSeeder(),
      entitlements,
      quotas: new QuotaAdmin(admin),
      store: new prov.MysqlProvisioningStore(admin),
    });
    const op = { type: "operator", id: "test" } as const;
    for (const id of [A, B]) {
      const r = await p.run({ tenantId: id, displayName: id, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.es" }, op);
      const c = await mysql.createConnection({ uri: (await svc.getActiveDsn(id))! });
      dsn[id] = (await svc.getActiveDsn(id))!;
      await c.query("UPDATE users SET passwordHash = ? WHERE email = ?", [await bcrypt.hash(PASS[id], 4), `admin@${id}.example`]);
      // Misma serie de facturas en ambas; solo A tiene DEV históricos (y un PII que NUNCA debe salir en la auditoría)
      await c.query("INSERT INTO document_counters (document_type, year, current_number, prefix) VALUES ('factura', ?, 7, 'FAC')", [YEAR]);
      if (id === A) {
        for (const num of [`DEV-${YEAR}-0001`, `DEV-${YEAR}-0002`, `DEV-${YEAR}-0005`, "DEV-raro"]) {
          await c.query("INSERT INTO transactions (transactionNumber, type, amount, currency, description) VALUES (?, 'reembolso', -10.00, 'EUR', ?)", [num, `Devolución de ${PII} ${PII_MAIL}`]);
        }
        for (const num of [`FAC-${YEAR}-0001`, `FAC-${YEAR}-0002`, `FAC-${YEAR}-0004`]) {
          await c.query("INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, total) VALUES (?, ?, ?, 10, 10)", [num, PII, PII_MAIL]);
        }
        await c.query("INSERT INTO document_number_logs (document_type, document_number, year, sequence, context) VALUES ('factura', ?, ?, 3, 'cancellations:refundTransaction:9')", [`FAC-${YEAR}-0003`, YEAR]);
        await c.query("INSERT INTO document_counters (document_type, year, current_number, prefix) VALUES ('devolucion', ?, 1, 'DEV')", [YEAR]);
      }
      await c.end();
    }
    // Usuario no administrador (rol agente) en A
    {
      const c = await mysql.createConnection({ uri: dsn[A] });
      await c.query(
        "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, 'Agente', ?, 'local', 'agente', 1, ?, 1)",
        [`local_agente_${run}`, `agente@${A}.example`, await bcrypt.hash(AGENT_PASS, 4)],
      );
      await c.end();
    }

    // La aplicación real, con el middleware real (precarga + arriendo del pool)
    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { createLocalAuthRouter } = await import("./localAuth");
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const { appRouter } = await import("./routers");
    const { createLocalContext } = await import("./_core/context.local");
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    const { configureModuleAccess, getModuleAccess } = await import("./_core/modules/runtime");
    const { registerBuiltinModules } = await import("./_core/modules/builtin");
    const { moduleRouteGuard } = await import("./_core/modules/routeGuard");
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    registerBuiltinModules();
    configureModuleAccess(rt.entitlements);
    const app = express();
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    app.use(createLocalAuthRouter());
    app.use("/api/trpc", moduleRouteGuard(getModuleAccess));
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    closeAll = async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await closeAllDatabases();
      await rt.close();
    };

    for (const id of [A, B]) {
      const l = await call(host(id), "POST", "/api/auth/login", { body: { email: `admin@${id}.example`, password: PASS[id] } });
      expect(l.status).toBe(200);
      cookies[id] = l.cookie!;
    }
  }, 240_000);

  afterAll(async () => {
    await closeAll?.();
    for (const id of [A, B]) await admin?.query(`DROP DATABASE IF EXISTS \`es_${id.replace(/-/g, "_")}\``).catch(() => undefined);
    await admin?.end();
    delete process.env.TENANT_MODE;
  });

  const TABLES = ["document_counters", "document_number_logs", "transactions", "invoices"];
  async function snapshot(id: string) {
    const c = await mysql.createConnection({ uri: dsn[id] });
    const out: Record<string, unknown> = {};
    for (const t of TABLES) {
      const [rows] = await c.query(`SELECT * FROM \`${t}\` ORDER BY 1`);
      out[t] = JSON.stringify(rows);
    }
    await c.end();
    return out;
  }

  it("devuelve agregados correctos de la empresa A (DEV históricos, huecos, contador, facturas consumidas)", async () => {
    const r = await q(A, "documentNumbers.auditSeries");
    expect(r.version).toBe(1);
    expect(r.devTransactions).toEqual([{ year: YEAR, count: 3, min: 1, max: 5, distinct: 3, gaps: 2 }]);
    expect(r.devNonConforming).toBe(1);
    expect(r.invoiceSeries).toEqual([{ prefix: "FAC", year: YEAR, count: 3, min: 1, max: 4, gaps: 1 }]);
    expect(r.invoiceNonConforming).toBe(0);
    expect(r.facturaNumbersConsumedByRefunds).toEqual([{ year: YEAR, count: 1 }]);
    expect(r.counters).toEqual([
      { documentType: "devolucion", year: YEAR, prefix: "DEV", currentNumber: 1, rows: 1 },
      { documentType: "factura", year: YEAR, prefix: "FAC", currentNumber: 7, rows: 1 },
    ]);
    expect(r.assessment).toEqual([{ year: YEAR, devCounter: 1, devMaxEmitted: 5, needsAdvance: true, duplicateCounterRows: false, duplicateDev: false }]);
  });

  it("salida determinista: dos ejecuciones seguidas dan exactamente lo mismo", async () => {
    expect(await q(A, "documentNumbers.auditSeries")).toEqual(await q(A, "documentNumbers.auditSeries"));
  });

  it("aislamiento: la empresa B no ve nada de A y viceversa", async () => {
    const b = await q(B, "documentNumbers.auditSeries");
    expect(b.devTransactions).toEqual([]);
    expect(b.devNonConforming).toBe(0);
    expect(b.invoiceSeries).toEqual([]);
    expect(b.assessment).toEqual([]);
    expect(b.counters).toEqual([{ documentType: "factura", year: YEAR, prefix: "FAC", currentNumber: 7, rows: 1 }]);
    expect((await q(A, "documentNumbers.auditSeries")).devTransactions.length).toBe(1);
  });

  it("solo lectura: ninguna tabla de numeración o documentos cambia tras ejecutarla", async () => {
    const before = [await snapshot(A), await snapshot(B)];
    await q(A, "documentNumbers.auditSeries");
    await q(B, "documentNumbers.auditSeries");
    expect([await snapshot(A), await snapshot(B)]).toEqual(before);
  });

  it("solo lectura (estático): el código de la auditoría no contiene sentencias de escritura y usa transacción READ ONLY", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "numberingAudit.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/START TRANSACTION READ ONLY/);
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE)\b/);
  });

  it("rechaza sin sesión (401) y con rol no administrador (403)", async () => {
    const anon = await call(host(A), "GET", "/api/trpc/documentNumbers.auditSeries");
    expect(anon.status).toBe(401);
    const l = await call(host(A), "POST", "/api/auth/login", { body: { email: `agente@${A}.example`, password: AGENT_PASS } });
    expect(l.status).toBe(200);
    const agent = await call(host(A), "GET", "/api/trpc/documentNumbers.auditSeries", { cookie: l.cookie });
    expect(agent.status).toBe(403);
    // La sesión de A en el host de B no sirve
    const cross = await call(host(B), "GET", "/api/trpc/documentNumbers.auditSeries", { cookie: cookies[A] });
    expect(cross.status).toBeGreaterThanOrEqual(401);
  });

  it("sin datos personales: ni nombres ni correos sembrados; solo números y nombres de serie", async () => {
    const r = await q(A, "documentNumbers.auditSeries");
    const text = JSON.stringify(r);
    expect(text).not.toContain(PII);
    expect(text).not.toContain(PII_MAIL);
    expect(text).not.toContain("@");
    const leaves: unknown[] = [];
    (function walk(v: unknown) {
      if (v && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(v);
    })(r);
    for (const v of leaves) {
      if (typeof v === "string") expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
      else expect(["number", "boolean"]).toContain(typeof v);
    }
  });
});
