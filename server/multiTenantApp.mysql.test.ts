/**
 * Validación multi-tenant con la APLICACIÓN REAL (MySQL, opt-in): dos empresas aprovisionadas
 * con baseline completo, middleware de tenant, autenticación local y routers tRPC reales.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/multiTenantApp.mysql.test.ts
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

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const A = `app-a-${run}`;
const B = `app-b-${run}`;
const PASS_A = "clave-de-A-" + run;
const PASS_B = "clave-de-B-" + run;

describe.skipIf(!URL_)("aplicación real en multiempresa", () => {
  let admin: mysql.Pool;
  let server: http.Server;
  let port: number;
  let closeAll: () => Promise<void>;
  const hostA = `${A}.elephantsource.es`;
  const hostB = `${B}.elephantsource.es`;

  function call(host: string, method: string, p: string, opts: { cookie?: string; body?: unknown } = {}) {
    return new Promise<{ status: number; json: any; cookie?: string }>((resolve, reject) => {
      const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: p,
          method,
          headers: {
            host,
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

  beforeAll(async () => {
    const u = new URL(URL_!);
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = URL_!;
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
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

    // Aprovisionamiento real de dos tenants
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
    const p = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema: new prov.MysqlSchemaApplier({
        baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"),
        migrationsDir: path.resolve(__dirname, "../db/migrations"),
      }),
      seeder: new prov.MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(admin),
      quotas: new QuotaAdmin(admin),
      store: new prov.MysqlProvisioningStore(admin),
    });
    const op = { type: "operator", id: "test" } as const;
    for (const [id, pass] of [
      [A, PASS_A],
      [B, PASS_B],
    ] as const) {
      const r = await p.run({ tenantId: id, displayName: id, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.es" }, op);
      expect(r.status).toBe("completed");
      // Datos propios de cada empresa
      const dsn = (await svc.getActiveDsn(id))!;
      const c = await mysql.createConnection({ uri: dsn });
      await c.query("INSERT INTO categories (slug, name, isActive) VALUES (?, ?, 1)", [`cat-${id}`, `Categoría de ${id}`]);
      await c.query("UPDATE users SET passwordHash = ? WHERE email = ?", [await bcrypt.hash(pass, 4), `admin@${id}.example`]);
      await c.end();
    }

    // La aplicación real
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
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    closeAll = async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await closeAllDatabases();
      await rt.close();
    };
  }, 240_000);

  afterAll(async () => {
    await closeAll?.();
    for (const id of [A, B]) await admin?.query(`DROP DATABASE IF EXISTS \`es_${id.replace(/-/g, "_")}\``).catch(() => undefined);
    await admin?.end();
    delete process.env.TENANT_MODE;
  });

  const trpc = (p: string) => `/api/trpc/${p}`;
  const data = (r: { json: any }) => r.json?.result?.data?.json;

  it("cada empresa lee solo sus propios datos con el router real", async () => {
    const a = await call(hostA, "GET", trpc("public.getCategories"));
    const b = await call(hostB, "GET", trpc("public.getCategories"));
    expect(a.status).toBe(200);
    expect((data(a) as any[]).map((c) => c.slug)).toEqual([`cat-${A}`]);
    expect((data(b) as any[]).map((c) => c.slug)).toEqual([`cat-${B}`]);
  });

  it("dominio desconocido: 404 y ningún dato", async () => {
    const r = await call("desconocido.elephantsource.es", "GET", trpc("public.getCategories"));
    expect(r.status).toBe(404);
  });

  it("login por empresa; la sesión de A no autentica en B (tid)", async () => {
    const la = await call(hostA, "POST", "/api/auth/login", { body: { email: `admin@${A}.example`, password: PASS_A } });
    expect(la.status).toBe(200);
    expect(la.cookie).toMatch(/^nayade_session=/);
    const payload = JSON.parse(Buffer.from(la.cookie!.split("=")[1].split(".")[1], "base64url").toString());
    expect(payload.tid).toBe(A);

    const meA = await call(hostA, "GET", trpc("auth.me"), { cookie: la.cookie });
    expect(data(meA)?.email).toBe(`admin@${A}.example`);

    const meB = await call(hostB, "GET", trpc("auth.me"), { cookie: la.cookie });
    expect(data(meB) ?? null).toBeNull();

    // credenciales de A no valen en B
    const cross = await call(hostB, "POST", "/api/auth/login", { body: { email: `admin@${A}.example`, password: PASS_A } });
    expect(cross.status).toBe(401);
    const lb = await call(hostB, "POST", "/api/auth/login", { body: { email: `admin@${B}.example`, password: PASS_B } });
    expect(lb.status).toBe(200);
  });

  it("un procedimiento de administración con la sesión de A no opera sobre B", async () => {
    const la = await call(hostA, "POST", "/api/auth/login", { body: { email: `admin@${A}.example`, password: PASS_A } });
    const ok = await call(hostA, "GET", trpc("cms.getSiteSettings"), { cookie: la.cookie });
    expect(ok.status).toBe(200);
    // Admin de A (cookie) llamando en el host de B: sin identidad → procedimiento protegido rechazado
    const denied = await call(hostB, "GET", trpc("admin.getCategories"), { cookie: la.cookie });
    expect(denied.status).toBeGreaterThanOrEqual(401);
  });
});
