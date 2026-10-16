/**
 * Pulido del recorrido Essential con la APLICACIÓN REAL en una empresa recién aprovisionada (MySQL,
 * opt-in): baseline + migraciones del carril de la app, middleware de tenant, autenticación local y
 * routers reales. Solo datos sintéticos (.example).
 *
 *  - RBAC: la baseline no trae las tablas `rbac_*`; el panel no ofrece RBAC granular y el servidor
 *    responde un error claro (412), nunca un error interno. Alta de usuarios sin romperse.
 *  - Solo lectura: entra en el panel (resumen de suscripción) y consulta; no modifica.
 *  - TPV: una empresa nueva no tiene cajas; se crea la primera y aparece en la lista.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:3306/registry_test \
 *     pnpm vitest run server/pulidoEssential.mysql.test.ts
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
const T = `pul-${run}`;
const PASS = "clave-propietario-" + run;
const STAFF_PASS = "clave-equipo-" + run;

type Res = { status: number; json: any; text: string; cookies: string[] };

describe.skipIf(!URL_)("pulido Essential en una empresa nueva (aplicación real)", () => {
  let admin: mysql.Pool;
  let server: http.Server;
  let port: number;
  let closeAll: () => Promise<void>;
  let dsn = "";
  let owner = "";
  const host = `${T}.elephantsource.es`;

  function call(method: string, p: string, opts: { cookie?: string; body?: unknown } = {}) {
    return new Promise<Res>((resolve, reject) => {
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
            resolve({ status: res.statusCode ?? 0, json, text: b, cookies: (res.headers["set-cookie"] as string[] | undefined) ?? [] });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }
  const sessionOf = (r: Res) => r.cookies.find((c) => c.startsWith("nayade_session="))?.split(";")[0];
  const qs = (input: unknown) => (input === undefined ? "" : "?input=" + encodeURIComponent(JSON.stringify({ json: input })));
  const q = (proc: string, input?: unknown, cookie = owner) => call("GET", `/api/trpc/${proc}${qs(input)}`, { cookie });
  const m = (proc: string, input: unknown, cookie = owner) => call("POST", `/api/trpc/${proc}`, { cookie, body: { json: input } });
  const data = (r: Res) => {
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  };
  const errOf = (r: Res) => r.json?.error?.json as { message: string; data?: { code?: string } } | undefined;

  async function sql<R = any>(query: string, params: unknown[] = []): Promise<R> {
    const c = await mysql.createConnection({ uri: dsn });
    try {
      const [rows] = await c.query(query, params);
      return rows as R;
    } finally {
      await c.end();
    }
  }
  async function addUser(email: string, role: string) {
    await sql(
      "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, ?, ?, 'local', ?, 1, ?, 1)",
      [`local_${crypto.randomBytes(8).toString("hex")}`, email, email, role, await bcrypt.hash(STAFF_PASS, 4)],
    );
  }
  const login = (email: string, password: string) => call("POST", "/api/auth/login", { body: { email, password } });

  beforeAll(async () => {
    const u = new URL(URL_!);
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = URL_!;
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run + "-000000000000";
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
    // Nada de correo real: sin credenciales globales
    for (const k of ["BREVO_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "GLOBAL_CC_EMAIL"]) delete process.env[k];

    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 4 });
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
    const r = await p.run({ tenantId: T, displayName: "Empresa Pulido", adminEmail: `admin@${T}.example`, platformDomain: "elephantsource.es" }, { type: "operator", id: "test" });
    expect(r.status).toBe("completed");
    dsn = (await svc.getActiveDsn(T))!;
    await sql("UPDATE users SET passwordHash = ?, inviteToken = NULL, inviteAccepted = 1 WHERE email = ?", [await bcrypt.hash(PASS, 4), `admin@${T}.example`]);

    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { createLocalAuthRouter } = await import("./localAuth");
    const { createAuthGuardMiddleware } = await import("./authGuard");
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
    app.use("/api/trpc", createAuthGuardMiddleware(true));
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
    const l = await login(`admin@${T}.example`, PASS);
    expect(l.status).toBe(200);
    owner = sessionOf(l)!;
  }, 300_000);

  afterAll(async () => {
    await closeAll?.();
    await admin?.query(`DROP DATABASE IF EXISTS \`es_${T.replace(/-/g, "_")}\``).catch(() => undefined);
    await admin?.end();
    delete process.env.TENANT_MODE;
  });

  describe("RBAC granular en una empresa sin tablas RBAC", () => {
    it("la baseline no trae las tablas: el panel no lo ofrece", async () => {
      const tables = await sql<any[]>("SHOW TABLES LIKE 'rbac\\_%'");
      expect(tables).toHaveLength(0);
      expect(data(await q("admin.getRbacStatus"))).toEqual({ available: false });
      // Las consultas de apoyo siguen respondiendo vacío (no 500)
      expect(data(await q("admin.getRbacUsersData"))).toEqual({});
      expect(data(await q("admin.getRbacRolePermissions"))).toEqual({});
    });

    it("asignar o quitar un rol RBAC: error claro (412), nunca un error interno", async () => {
      const ownerId = (await sql<any[]>("SELECT id FROM users WHERE email = ?", [`admin@${T}.example`]))[0].id;
      for (const proc of ["admin.assignRbacRole", "admin.removeRbacRole"]) {
        const r = await m(proc, { userId: ownerId, roleKey: "commercial_agent" });
        expect(r.status, proc).toBe(412);
        expect(errOf(r)?.data?.code).toBe("PRECONDITION_FAILED");
        expect(errOf(r)?.message).toMatch(/no están disponibles en esta empresa/);
        expect(r.text).not.toMatch(/rbac_|Failed query|ER_NO_SUCH_TABLE/);
      }
    });

    it("alta de usuario con roles RBAC sugeridos: se crea igual (sin RBAC)", async () => {
      const r = await m("admin.createUser", { name: "Invitada", email: `invitada-${run}@empresa.example`, role: "readonly", rbacRoleKeys: ["commercial_agent"] });
      expect(r.status).toBe(200);
      const [u] = await sql<any[]>("SELECT role FROM users WHERE email = ?", [`invitada-${run}@empresa.example`]);
      expect(u.role).toBe("readonly");
    });
  });

  describe("solo lectura", () => {
    let lectura = "";
    beforeAll(async () => {
      await addUser(`lectura-${run}@empresa.example`, "readonly");
      lectura = sessionOf(await login(`lectura-${run}@empresa.example`, STAFF_PASS))!;
      expect(lectura).toBeTruthy();
    });

    it("entra en el panel: resumen de suscripción y consultas del equipo", async () => {
      expect((await q("subscription.overview", undefined, lectura)).status).toBe(200);
      expect((await q("crm.clients.list", {}, lectura)).status).toBe(200);
    });

    it("no modifica nada (tampoco crear una caja)", async () => {
      const r = await m("crm.clients.create", { name: "No debe crearse", email: `no-${run}@cliente.example` }, lectura);
      expect(r.status).toBe(403);
      expect((await m("tpv.createRegister", { name: "Caja intrusa" }, lectura)).status).toBe(403);
    });
  });

  describe("TPV en una empresa nueva", () => {
    it("sin cajas al empezar; se crea la primera y aparece en la lista", async () => {
      expect(data(await q("tpv.getRegisters"))).toEqual([]);
      const created = data(await m("tpv.createRegister", { name: "Caja recepción", location: "Planta baja" }));
      expect(created).toMatchObject({ name: "Caja recepción", location: "Planta baja", isActive: true });
      const list = data(await q("tpv.getRegisters"));
      expect(list.map((r: any) => r.name)).toEqual(["Caja recepción"]);
      // Validación del servidor: nombre vacío rechazado con 400
      expect((await m("tpv.createRegister", { name: "   " })).status).toBe(400);
    });
  });
});
