/**
 * Acceso heredado (legacyDb / legacyPool) en multiempresa con la APLICACIÓN REAL (MySQL, opt-in).
 *
 * Dos empresas aprovisionadas con la baseline completa (mismo montaje que
 * multiTenantApp.mysql.test.ts), middleware real de tenant (con precarga y arriendo del pool) y
 * procedimientos tRPC REALES de routers que usan el acceso heredado síncrono:
 *
 *   CRM (crm.clients), descuentos (discounts), proveedores (suppliers), numeración de documentos
 *   (documentNumbers → documentNumbers.ts), hotel (hotel → hotelDb + reviewsDb), caja
 *   (cashRegister) y TPV (tpv).
 *
 * Cada prueba crea datos en la empresa A y comprueba que la B no los ve, y viceversa.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:3306/registry_test \
 *     pnpm vitest run server/tenantLegacyAccess.mysql.test.ts
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
const A = `leg-a-${run}`;
const B = `leg-b-${run}`;
const PASS: Record<string, string> = { [A]: "clave-de-A-" + run, [B]: "clave-de-B-" + run };
const YEAR = madridYear(); // el año de la numeración (Madrid)

describe.skipIf(!URL_)("acceso heredado en multiempresa (routers reales)", () => {
  let admin: mysql.Pool;
  let server: http.Server;
  let port: number;
  let closeAll: () => Promise<void>;
  const host = (id: string) => `${id}.elephantsource.es`;
  const cookies: Record<string, string> = {};

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
      expect(r.status).toBe("completed");
      // Módulo sectorial de hotel licenciado en ambas (para probar hotelDb)
      await entitlements.grant(id, "hotel", op);
      const c = await mysql.createConnection({ uri: (await svc.getActiveDsn(id))! });
      await c.query("UPDATE users SET passwordHash = ? WHERE email = ?", [await bcrypt.hash(PASS[id], 4), `admin@${id}.example`]);
      // Flags de módulo propios de cada empresa; sin correos del TPV
      for (const [key, on] of [
        ["hotel_module_enabled", 1],
        ["cash_register_module_enabled", 1],
        ["suppliers_module_enabled", 1],
        ["tpv_email_notifications_enabled", 0],
      ] as const) {
        await c.query(
          "INSERT INTO feature_flags (`key`, name, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)",
          [key, key, on],
        );
      }
      // Misma serie en ambas: el cambio de prefijo en una no debe afectar a la otra
      await c.query("INSERT INTO document_counters (document_type, year, current_number, prefix) VALUES ('factura', ?, 7, 'FAC')", [YEAR]);
      await c.query("INSERT INTO cash_registers (name, isActive, createdAt) VALUES (?, 1, ?)", [`Caja ${id}`, Date.now()]);
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

  it("CRM (crm.clients): cada empresa ve solo sus clientes", async () => {
    await m(A, "crm.clients.create", { name: `Cliente de A ${run}`, email: `a-${run}@cliente.example` });
    expect((await q(A, "crm.clients.list", {})).items.map((c: any) => c.email)).toEqual([`a-${run}@cliente.example`]);
    expect((await q(B, "crm.clients.list", {})).items).toEqual([]);

    await m(B, "crm.clients.create", { name: `Cliente de B ${run}`, email: `b-${run}@cliente.example` });
    expect((await q(B, "crm.clients.list", {})).items.map((c: any) => c.email)).toEqual([`b-${run}@cliente.example`]);
    expect((await q(A, "crm.clients.list", {})).items.map((c: any) => c.email)).toEqual([`a-${run}@cliente.example`]);
  });

  it("descuentos (discounts): los códigos de una empresa no existen en la otra", async () => {
    const created = await m(A, "discounts.create", { code: `SOLOA${run}`, name: "Solo A", discountPercent: 10 });
    expect(created.code).toBe(`SOLOA${run}`.toUpperCase());
    expect((await q(A, "discounts.list", {})).items.map((d: any) => d.code)).toEqual([`SOLOA${run}`.toUpperCase()]);
    expect((await q(B, "discounts.list", {})).total).toBe(0);
    // El mismo código puede crearse en B (unicidad por empresa, no global)
    await m(B, "discounts.create", { code: `SOLOA${run}`, name: "También en B", discountPercent: 20 });
    const inB = (await q(B, "discounts.list", {})).items;
    expect(inB.map((d: any) => d.name)).toEqual(["También en B"]);
    expect((await q(A, "discounts.list", {})).items.map((d: any) => d.name)).toEqual(["Solo A"]);
    // Ni por id: el id de A no lleva a datos de A desde B
    const r = await call(host(B), "GET", `/api/trpc/discounts.getById?input=${encodeURIComponent(JSON.stringify({ json: { id: created.id } }))}`, { cookie: cookies[B] });
    if (r.status === 200) expect(r.json.result.data.json.name).not.toBe("Solo A");
  });

  it("proveedores (suppliers): aislados", async () => {
    await m(A, "suppliers.create", { fiscalName: `Proveedor A ${run}` });
    expect((await q(A, "suppliers.list")).map((s: any) => s.fiscalName)).toEqual([`Proveedor A ${run}`]);
    expect(await q(B, "suppliers.list")).toEqual([]);
    await m(B, "suppliers.create", { fiscalName: `Proveedor B ${run}` });
    expect((await q(A, "suppliers.list")).map((s: any) => s.fiscalName)).toEqual([`Proveedor A ${run}`]);
    expect((await q(B, "suppliers.list")).map((s: any) => s.fiscalName)).toEqual([`Proveedor B ${run}`]);
  });

  it("numeración de documentos (documentNumbers.ts): el prefijo de A no cambia el de B", async () => {
    await m(A, "documentNumbers.updatePrefix", { documentType: "factura", year: YEAR, newPrefix: "AAA" });
    const prefix = async (id: string) => (await q(id, "documentNumbers.getCounters")).find((c: any) => c.documentType === "factura" && c.year === YEAR)?.prefix;
    expect(await prefix(A)).toBe("AAA");
    expect(await prefix(B)).toBe("FAC");
    await m(B, "documentNumbers.updatePrefix", { documentType: "factura", year: YEAR, newPrefix: "BBB" });
    expect(await prefix(A)).toBe("AAA");
    expect(await prefix(B)).toBe("BBB");
  });

  it("hotel (hotelDb + reviewsDb): las habitaciones de A no aparecen en B, ni en el panel ni en la web", async () => {
    await m(A, "hotel.adminCreateRoomType", { slug: `suite-a-${run}`, name: "Suite A", basePrice: "120.00" });
    expect((await q(A, "hotel.adminGetRoomTypes")).map((r: any) => r.slug)).toEqual([`suite-a-${run}`]);
    expect(await q(B, "hotel.adminGetRoomTypes")).toEqual([]);
    expect((await q(A, "hotel.getRoomTypes")).map((r: any) => r.slug)).toEqual([`suite-a-${run}`]);
    expect(await q(B, "hotel.getRoomTypes")).toEqual([]);
    await m(B, "hotel.adminCreateRoomType", { slug: `suite-b-${run}`, name: "Suite B", basePrice: "90.00" });
    expect((await q(A, "hotel.getRoomTypes")).map((r: any) => r.slug)).toEqual([`suite-a-${run}`]);
    expect((await q(B, "hotel.getRoomTypes")).map((r: any) => r.slug)).toEqual([`suite-b-${run}`]);
  });

  it("caja (cashRegister, legacyPool + legacyDb): cuentas aisladas", async () => {
    await m(A, "cashRegister.createAccount", { name: `Caja principal A ${run}` });
    expect((await q(A, "cashRegister.listAccounts")).map((x: any) => x.name)).toEqual([`Caja principal A ${run}`]);
    expect(await q(B, "cashRegister.listAccounts")).toEqual([]);
  });

  it("TPV (tpv): la sesión abierta en A no existe en B", async () => {
    const regA = (await q(A, "tpv.getRegisters"))[0];
    const regB = (await q(B, "tpv.getRegisters"))[0];
    expect(regA.name).toBe(`Caja ${A}`);
    expect(regB.name).toBe(`Caja ${B}`);
    const s = await m(A, "tpv.openSession", { registerId: regA.id, openingAmount: 50 });
    expect(s.status).toBe("open");
    expect((await q(A, "tpv.getActiveSession", { registerId: regA.id }))?.id).toBe(s.id);
    // Mismo id de caja en B (ambas empiezan en 1): sin sesión abierta
    expect(await q(B, "tpv.getActiveSession", { registerId: regA.id })).toBeNull();
  });

  it("peticiones concurrentes alternando empresas: nunca se mezclan", async () => {
    const order = Array.from({ length: 30 }, (_, i) => (i % 2 ? B : A));
    const out = await Promise.all(order.map(async (id) => [id, await q(id, "suppliers.list")] as const));
    for (const [id, rows] of out) {
      expect((rows as any[]).map((s) => s.fiscalName)).toEqual([`Proveedor ${id === A ? "A" : "B"} ${run}`]);
    }
  });

  it("la sesión de A en el host de B no opera sobre ningún dato heredado", async () => {
    const r = await call(host(B), "GET", "/api/trpc/suppliers.list", { cookie: cookies[A] });
    expect(r.status).toBeGreaterThanOrEqual(401);
  });

  it("jobs / tareas internas: withTenantDb da al código heredado la BD de cada empresa", async () => {
    const { withTenantDb } = await import("./_core/dbRegistry");
    const { getAllCounters } = await import("./documentNumbers");
    const prefixIn = async (id: string) =>
      withTenantDb(id, async () => (await getAllCounters()).find((c) => c.documentType === "factura")?.prefix);
    const [pa, pb] = await Promise.all([prefixIn(A), prefixIn(B)]);
    expect(pa).toBe("AAA");
    expect(pb).toBe("BBB");
    // Fuera de contexto: falla cerrado
    await expect(getAllCounters()).rejects.toThrow(/tenant/);
  });
});
