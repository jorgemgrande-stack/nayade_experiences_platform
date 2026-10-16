/**
 * Ski Rental con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): una empresa
 * aprovisionada desde la baseline + `db/migrations` (incluida 0003_ski_rental), login de administrador,
 * llamadas tRPC reales y licencias por capacidad leídas del registro (tenant_capabilities) con sedes de
 * Elephant Control (tenant_sites).
 *  - Sin licencia → [module_not_licensed]; solo lectura → consulta sí, opera no.
 *  - Licencia y activación por sede; desactivar no borra datos.
 *  - Reservas simultáneas del mismo material: nunca más unidades que las existentes.
 *  - Independencia: el Core y otro módulo responden igual con Ski Rental sin licencia o sin instalar
 *    (migración 0003 revertida con su .down.sql y vuelta a aplicar).
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
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const T = `ski-${run}`;
const PASS = "clave-ski-" + run;

describe.skipIf(!URL_)("Ski Rental (routers reales, licencia por capacidad)", () => {
  let admin: mysql.Pool;
  let tenantDb: mysql.Connection;
  let server: http.Server;
  let port: number;
  let cookie = "";
  let closeAll: () => Promise<void>;
  let license: (status: string, siteId?: string) => Promise<void>;
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
  const query = (proc: string, input?: unknown) => call("GET", `/api/trpc/${proc}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`);
  const ok = (r: { status: number; json: any }) => {
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  };
  const fail = (r: { status: number; json: any }) => ({ status: r.status, message: String(r.json?.error?.json?.message ?? "") });

  /**
   * Revierte o vuelve a aplicar 0003 con las sentencias reales del carril y su registro. (El ejecutor
   * `scripts/db/migrate.ts` se niega en una BD aprovisionada porque ve `0000_baseline` registrada fuera
   * del carril: es una limitación previa, ajena a este módulo.)
   */
  async function migration0003(direction: "down" | "up") {
    const m = loadMigrations(path.resolve(__dirname, "../db/migrations")).migrations.find((x) => x.id === "0003_ski_rental")!;
    for (const st of splitStatements(direction === "down" ? m.down! : m.up)) await tenantDb.query(st);
    if (direction === "down") await tenantDb.query("DELETE FROM __elephant_migrations WHERE id = ?", [m.id]);
    else await tenantDb.query("INSERT INTO __elephant_migrations (id, checksum) VALUES (?, ?)", [m.id, m.checksum]);
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
    const files = (t as unknown[]).length ? [] : ["0000_registry", "0001_entitlements", "0002_quotas", "0003_provisioning", "0004_support"];
    // Licencias por capacidad (0008) y sedes (0009): idempotentes (IF NOT EXISTS)
    for (const f of [...files, "0008_tenant_capabilities", "0009_sites_fiscal_entities"]) {
      const ddl = fs.readFileSync(path.resolve(__dirname, `../db/registry/${f}.sql`), "utf8").replace(/^--.*$/gm, "");
      for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await admin.query(s).catch(() => undefined);
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
    // Otro módulo (hotel) activo en la empresa, para comprobar que sigue funcionando sin Ski Rental
    await tenantDb.query("INSERT INTO feature_flags (`key`, name, module, enabled) VALUES ('hotel_module_enabled', 'Hotel', 'hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");

    // Sedes de la empresa en el registro (Elephant Control): dos activas y una archivada
    const { MysqlOrganizationStore } = await import("./organization/service");
    const org = new MysqlOrganizationStore(admin);
    for (const [siteId, status] of [["pista-norte", "active"], ["pista-sur", "active"], ["antigua", "archived"]] as const) {
      await org.insertSite({ tenantId: T, siteId, name: siteId, fiscalEntityId: null, status, createdAt: 1, createdBy: "test", updatedAt: 1 });
    }
    // Licencias reales leídas del registro; sin caché para ver cada cambio al momento
    const { MysqlCapabilityStore } = await import("./_core/capabilities/store");
    const { configureCapabilityAccess } = await import("./_core/capabilities/access");
    const { configureSiteDirectory, siteDirectoryFrom } = await import("./sdk");
    const caps = new MysqlCapabilityStore(admin);
    configureCapabilityAccess(caps, { enforce: true, ttlMs: 0 });
    configureSiteDirectory(siteDirectoryFrom(org));
    let n = 0;
    license = async (status, siteId = "") => {
      await caps.apply(T, [{ capabilityId: "ski-rental", siteId, status: status as never, validUntil: null, source: "operator" }], { actor: "operator:test", reason: "prueba", now: Date.now() + ++n });
    };

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
      configureSiteDirectory(null);
    };
    expect((await call("POST", "/api/auth/login", { email: `admin@${T}.example`, password: PASS })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await closeAll?.();
    await tenantDb?.end();
    // El contenedor de pruebas es desechable: la BD del tenant de prueba (id aleatorio) no se reutiliza
    await admin?.end();
  });

  const NORTE = { siteId: "pista-norte" };
  const SUR = { siteId: "pista-sur" };

  it("la migración 0003 creó las tablas del módulo en la empresa aprovisionada", async () => {
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'ski_rental_%'");
    expect(rows.map((r) => Object.values(r)[0]).sort()).toEqual(["ski_rental_items", "ski_rental_rentals", "ski_rental_sites"]);
  });

  it("sin licencia: error tipado en consultas y operaciones; el Core y otro módulo siguen funcionando", async () => {
    expect(fail(await query("skiRental.listItems", NORTE))).toMatchObject({ status: 403, message: expect.stringMatching(/^\[module_not_licensed\]/) });
    expect(fail(await mutate("skiRental.activateSite", NORTE))).toMatchObject({ status: 403, message: expect.stringMatching(/^\[module_not_licensed\]/) });
    expect(ok(await query("skiRental.status", NORTE))).toMatchObject({ license: { read: false, write: false, code: "module_not_licensed" }, active: false });
    expect((await query("products.getAll")).status).toBe(200);
    expect((await query("hotel.adminGetRoomTypes")).status).toBe(200);
  });

  it("sede inexistente o archivada: rechazada aunque haya licencia de empresa", async () => {
    await license("active");
    expect(fail(await query("skiRental.listItems", { siteId: "antigua" }))).toMatchObject({ status: 400, message: expect.stringMatching(/^\[site_unknown\]/) });
    expect(fail(await query("skiRental.listItems", { siteId: "no-existe" }))).toMatchObject({ status: 400 });
    await license("cancelled");
  });

  it("licencia por sede y activación por sede; reservas y devolución reales", async () => {
    await license("active", "pista-norte");
    // Licencia solo en norte
    expect(fail(await mutate("skiRental.activateSite", SUR)).message).toMatch(/^\[module_not_licensed\]/);
    // Con licencia pero sin activar: no opera
    expect(fail(await mutate("skiRental.createItem", { ...NORTE, category: "ski", name: "Ski Allround", size: "160", quantity: 2 }))).toMatchObject({ status: 412, message: expect.stringMatching(/^\[module_not_active\]/) });
    ok(await mutate("skiRental.activateSite", NORTE));
    const item = ok(await mutate("skiRental.createItem", { ...NORTE, category: "ski", name: "Ski Allround", size: "160", quantity: 2 }));
    expect(fail(await mutate("skiRental.createItem", { ...NORTE, category: "ski", name: "Ski Allround", size: "160", quantity: 5 })).status).toBe(409);
    const r1 = ok(await mutate("skiRental.createRental", { ...NORTE, itemId: item.id, quantity: 1, customerName: "Cliente Uno", startDate: "2026-12-20", endDate: "2026-12-22" }));
    expect(r1).toMatchObject({ status: "reserved", startDate: "2026-12-20", endDate: "2026-12-22" });
    expect(ok(await query("skiRental.availability", { ...NORTE, from: "2026-12-21", to: "2026-12-21" }))[0]).toMatchObject({ stock: 2, available: 1 });
    expect(ok(await mutate("skiRental.pickUp", { ...NORTE, rentalId: r1.id })).status).toBe("out");
    expect(ok(await mutate("skiRental.returnRental", { ...NORTE, rentalId: r1.id })).status).toBe("returned");
    expect(ok(await query("skiRental.availability", { ...NORTE, from: "2026-12-21", to: "2026-12-21" }))[0].available).toBe(2);
    const [[row]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status, picked_up_at IS NOT NULL AS p, returned_at IS NOT NULL AS r, created_by FROM ski_rental_rentals WHERE id = ?", [r1.id])) as unknown as [[any]];
    expect(row).toMatchObject({ status: "returned", p: 1, r: 1, created_by: expect.stringMatching(/^user:\d+$/) });
  });

  it("reservas simultáneas del mismo material: nunca más unidades que las existentes", async () => {
    const item = ok(await mutate("skiRental.createItem", { ...NORTE, category: "boots", name: "Botas", size: "42", quantity: 3 }));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => mutate("skiRental.createRental", { ...NORTE, itemId: item.id, quantity: 1, customerName: `Cliente ${i}`, startDate: "2026-12-24", endDate: "2026-12-26" })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const [[sum]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT SUM(quantity) AS q FROM ski_rental_rentals WHERE item_id = ? AND status IN ('reserved','out')", [item.id])) as unknown as [[{ q: string }]];
    expect(Number(sum.q)).toBe(3);
  });

  it("solo lectura: consulta sí, operar no", async () => {
    await license("read_only", "pista-norte");
    expect(ok(await query("skiRental.listItems", NORTE)).length).toBe(2);
    expect(ok(await query("skiRental.listRentals", NORTE)).length).toBe(4);
    expect(fail(await mutate("skiRental.createItem", { ...NORTE, category: "helmet", name: "Casco", size: "M", quantity: 1 }))).toMatchObject({ status: 403, message: expect.stringMatching(/^\[module_read_only\]/) });
    expect(ok(await query("skiRental.status", NORTE))).toMatchObject({ license: { read: true, write: false, code: "module_read_only" }, active: true });
    await license("active", "pista-norte");
  });

  it("desactivar no borra datos; cancelar la licencia tampoco; reactivar los recupera", async () => {
    const [[before]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM ski_rental_items) AS i, (SELECT COUNT(*) FROM ski_rental_rentals) AS r")) as unknown as [[any]];
    ok(await mutate("skiRental.deactivateSite", NORTE));
    expect(fail(await mutate("skiRental.createItem", { ...NORTE, category: "poles", name: "Bastones", size: "120", quantity: 1 })).message).toMatch(/^\[module_not_active\]/);
    expect(ok(await query("skiRental.listItems", NORTE))).toHaveLength(2);
    await license("cancelled", "pista-norte");
    expect(fail(await query("skiRental.listItems", NORTE)).message).toMatch(/^\[module_not_licensed\]/);
    const [[after]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM ski_rental_items) AS i, (SELECT COUNT(*) FROM ski_rental_rentals) AS r")) as unknown as [[any]];
    expect(after).toEqual(before);
    await license("active", "pista-norte");
    ok(await mutate("skiRental.activateSite", NORTE));
    expect(ok(await query("skiRental.listRentals", NORTE))).toHaveLength(Number(before.r));
    // El historial de licencias queda en el registro
    const [ev] = await admin.query<mysql.RowDataPacket[]>("SELECT to_status FROM tenant_capability_events WHERE tenant_id = ? AND capability_id = 'ski-rental' ORDER BY id", [T]);
    expect(ev.map((e) => e.to_status)).toEqual(expect.arrayContaining(["read_only", "cancelled", "active"]));
  });

  it("sin instalar (migración 0003 revertida): error tipado y el Core intacto; se vuelve a aplicar", async () => {
    await migration0003("down");
    const [gone] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'ski_rental_%'");
    expect(gone).toHaveLength(0);
    expect(fail(await query("skiRental.listItems", NORTE))).toMatchObject({ status: 412, message: expect.stringMatching(/^\[module_not_installed\]/) });
    expect((await query("products.getAll")).status).toBe(200);
    expect((await query("hotel.adminGetRoomTypes")).status).toBe(200);
    await migration0003("up");
    expect(ok(await query("skiRental.listItems", NORTE))).toEqual([]);
  }, 60_000);
});
