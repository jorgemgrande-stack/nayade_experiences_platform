/**
 * Ski Net · Alquiler v1 por unidad con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): empresa
 * aprovisionada desde la baseline + `db/migrations` (incluida 0036_ski_rental_v1), login de administrador, llamadas
 * tRPC reales y licencias por capacidad del registro con sedes de Elephant Control.
 *  - Licencia y activación por sede; solo lectura; error tipado sin instalar (0036 revertida y vuelta a aplicar).
 *  - Correlativo de códigos sin repetir en altas simultáneas; la misma unidad en entregas simultáneas sale una vez.
 *  - Firma por clic con IP, navegador, empleado y huella SHA-256 del contenido; devolución con daño, taller e historial.
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
const T = `skiu-${run}`;
const PASS = "clave-ski-" + run;

describe.skipIf(!URL_)("Ski Rental v1 por unidad (routers reales, licencia por capacidad)", () => {
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
  const V1_TABLES = [
    "ski_rental_contracts",
    "ski_rental_deliveries",
    "ski_rental_delivery_lines",
    "ski_rental_models",
    "ski_rental_settings",
    "ski_rental_stores",
    "ski_rental_unit_events",
    "ski_rental_units",
    "ski_rental_workshop_tickets",
  ];
  let storeId = 0;
  let skiModel = 0;

  /** Revierte o vuelve a aplicar 0036 con las sentencias reales del carril y su registro. */
  async function migration0036(direction: "down" | "up") {
    const m = loadMigrations(path.resolve(__dirname, "../db/migrations")).migrations.find((x) => x.id === "0036_ski_rental_v1")!;
    for (const st of splitStatements(direction === "down" ? m.down! : m.up)) await tenantDb.query(st);
    if (direction === "down") await tenantDb.query("DELETE FROM __elephant_migrations WHERE id = ?", [m.id]);
    else await tenantDb.query("INSERT INTO __elephant_migrations (id, checksum) VALUES (?, ?)", [m.id, m.checksum]);
  }

  it("la migración 0036 creó las tablas de la v1 junto a las de la v0.1", async () => {
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'ski_rental_%'");
    expect(rows.map((r) => Object.values(r)[0])).toEqual(expect.arrayContaining([...V1_TABLES, "ski_rental_items", "ski_rental_rentals", "ski_rental_sites"]));
  });

  it("sin licencia: error tipado en la v1; con licencia en una sede y sin activar: no opera", async () => {
    expect(fail(await query("skiRental.listModels", NORTE))).toMatchObject({ status: 403, message: expect.stringMatching(/^\[module_not_licensed\]/) });
    await license("active", "pista-norte");
    expect(fail(await query("skiRental.listModels", SUR)).message).toMatch(/^\[module_not_licensed\]/);
    expect(fail(await mutate("skiRental.createStore", { ...NORTE, name: "Tienda", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" })).message).toMatch(/^\[module_not_active\]/);
    ok(await mutate("skiRental.activateSite", NORTE));
  });

  it("inventario por unidad con códigos automáticos y correlativo sin repetir en altas simultáneas", async () => {
    storeId = ok(await mutate("skiRental.createStore", { ...NORTE, name: "Tienda pie de pistas", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" })).id;
    skiModel = ok(await mutate("skiRental.createModel", { ...NORTE, assetType: "ski", name: "Allround", size: "160", replacementValueCents: 30000 })).id;
    const batches = await Promise.all([1, 2, 3].map(() => mutate("skiRental.createUnits", { ...NORTE, modelId: skiModel, storeId, count: 2 })));
    const codes = batches.flatMap((b) => ok(b).map((u: { code: string }) => u.code));
    expect(new Set(codes).size).toBe(6);
    expect(codes.sort()[0]).toBe("SKI-00001");
    const models = ok(await query("skiRental.listModels", NORTE));
    expect(models[0]).toMatchObject({ id: skiModel, units: { available: 6, rented: 0 } });
    expect(ok(await query("skiRental.scanUnit", { ...NORTE, code: "ski-00003" })).unit.code).toBe("SKI-00003");
  });

  it("la misma unidad en entregas simultáneas: solo una sale", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mutate("skiRental.createDelivery", { ...NORTE, storeId, customerName: `Cliente ${i}`, startDate: "2026-12-20", expectedReturnDate: "2026-12-21", lines: [{ code: "SKI-00001", requestedType: "ski" }] }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const [[n]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM ski_rental_delivery_lines l JOIN ski_rental_units u ON u.id = l.unit_id WHERE u.code = 'SKI-00001'")) as unknown as [[{ n: number }]];
    expect(Number(n.n)).toBe(1);
  });

  it("entrega, firma por clic con evidencia y huella, devolución con daño, taller e historial", async () => {
    const d = ok(
      await mutate("skiRental.createDelivery", {
        ...NORTE,
        storeId,
        customerName: "Cliente Ficticio",
        startDate: "2026-12-20",
        expectedReturnDate: "2026-12-22",
        lines: [{ code: "SKI-00002", requestedType: "ski", requestedSize: "150", confirmSize: true, reason: "Cliente principiante" }],
      }),
    );
    expect(d.contract.status).toBe("pending");
    expect(fail(await mutate("skiRental.signContract", { ...NORTE, deliveryId: d.id, signerName: "Cliente Ficticio", accepted: false })).status).toBe(400);
    const s = ok(await mutate("skiRental.signContract", { ...NORTE, deliveryId: d.id, signerName: "Cliente Ficticio", accepted: true }));
    expect(s.alreadySigned).toBe(false);
    const [[c]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status, content, content_hash, signed_ip, signed_user_agent, signed_by, signed_at IS NOT NULL AS at FROM ski_rental_contracts WHERE delivery_id = ?", [d.id])) as unknown as [[any]];
    expect(c).toMatchObject({ status: "signed", at: 1, signed_by: expect.stringMatching(/^user:\d+$/) });
    expect(c.signed_ip).toBeTruthy();
    expect(c.content_hash).toBe(crypto.createHash("sha256").update(c.content).digest("hex"));
    expect(JSON.parse(c.content).terms).not.toMatch(/skicenter/i);

    const detail = ok(await query("skiRental.getDelivery", { ...NORTE, deliveryId: d.id }));
    const r = ok(await mutate("skiRental.returnLine", { ...NORTE, lineId: detail.lines[0].id, condition: "damaged", note: "Canto dañado" }));
    expect(r.deliveryClosed).toBe(true);
    const unitId = detail.lines[0].unitId;
    const t = ok(await mutate("skiRental.openTicket", { ...NORTE, unitId, reason: "Reparar canto" }));
    ok(await mutate("skiRental.closeTicket", { ...NORTE, ticketId: t.id, resolution: "available", notes: "Reparado" }));
    const h = ok(await query("skiRental.unitHistory", { ...NORTE, unitId }));
    expect(h.events.map((e: { fromStatus: string | null; toStatus: string }) => `${e.fromStatus}>${e.toStatus}`)).toEqual(["null>available", "available>rented", "rented>incident", "incident>workshop", "workshop>available"]);
    const [[del]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status, closed_at IS NOT NULL AS c FROM ski_rental_deliveries WHERE id = ?", [d.id])) as unknown as [[any]];
    expect(del).toMatchObject({ status: "returned", c: 1 });
  });

  it("solo lectura: consulta sí, operar no", async () => {
    await license("read_only", "pista-norte");
    expect(ok(await query("skiRental.listDeliveries", NORTE)).length).toBe(2);
    expect(fail(await mutate("skiRental.openTicket", { ...NORTE, unitId: 1, reason: "Encerar" })).message).toMatch(/^\[module_read_only\]/);
    await license("active", "pista-norte");
  });

  it("sin instalar la v1 (0036 revertida): error tipado en la v1, la v0.1 y el Core siguen; se vuelve a aplicar", async () => {
    await migration0036("down");
    expect(fail(await query("skiRental.listModels", NORTE))).toMatchObject({ status: 412, message: expect.stringMatching(/^\[module_not_installed\]/) });
    expect((await query("skiRental.listItems", NORTE)).status).toBe(200);
    expect((await query("products.getAll")).status).toBe(200);
    await migration0036("up");
    expect(ok(await query("skiRental.listModels", NORTE))).toEqual([]);
  }, 60_000);
});
