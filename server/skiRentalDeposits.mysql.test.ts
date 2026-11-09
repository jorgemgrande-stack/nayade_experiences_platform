/**
 * Ski Net · Fianzas del alquiler con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): empresa
 * aprovisionada desde la baseline + `db/migrations` (incluida 0052_ski_net_fianzas), login de administrador, llamadas
 * tRPC reales, licencias por capacidad del registro con sedes y el TPV del Core para la venta de daños. Ningún cobro
 * real: el efectivo y el datáfono solo se anotan.
 *  - Fianza por contrato en efectivo: entrada en la caja de la sede; doble clic sin duplicar; caja de otra sede, no.
 *  - Liquidación: antes de devolver, no; retención con motivo; venta «Cargo por daños» en el TPV una sola vez; salida de
 *    caja por lo aplicado; lo no cubierto como cargo pendiente, cobrado en el TPV sin duplicar.
 *  - Tarjeta: devolución total sin efectivo ni venta. Totales del día. Aislamiento por sede.
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
const T = `skid-${run}`;
const PASS = "clave-ski-" + run;

// Tiempo máximo explícito en cada prueba (60 s): con varias suites MySQL a la vez, 5 s no bastan
describe.skipIf(!URL_)("Ski Net · fianzas del alquiler (routers reales, TPV del Core)", () => {
  let admin: mysql.Pool;
  let tenantDb: mysql.Connection;
  let server: http.Server;
  let port: number;
  let cookie = "";
  let closeAll: () => Promise<void>;
  let license: (status: string, siteId?: string, capabilityId?: string) => Promise<void>;
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
    license = async (status, siteId = "", capabilityId = "ski-rental") => {
      await caps.apply(T, [{ capabilityId, siteId, status: status as never, validUntil: null, source: "operator" }], { actor: "operator:test", reason: "prueba", now: Date.now() + ++n });
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
    await admin?.end();
  });

  const NORTE = { siteId: "pista-norte" };
  const SUR = { siteId: "pista-sur" };
  let storeId = 0;
  let skiModel = 0;
  let bootModel = 0;
  let sessNorte = 0;
  let sessSur = 0;
  let d1 = 0;
  let dep1 = 0;
  const count = async (q: string, p: unknown[] = []) => {
    const [[r]] = (await tenantDb.query<mysql.RowDataPacket[]>(q, p)) as unknown as [[{ n: number }]];
    return Number(r.n);
  };

  it("la migración 0052 creó las tablas de fianzas", async () => {
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'ski_deposit%'");
    expect(rows.map((r) => Object.values(r)[0]).sort()).toEqual(["ski_deposit_attachments", "ski_deposit_charges", "ski_deposit_events", "ski_deposit_rules", "ski_deposits"]);
  }, 60_000);

  it("preparación: licencias, material, importes de fianza y cajas abiertas por sede", async () => {
    expect(fail(await query("skiRental.depositRules", NORTE)).message).toMatch(/^\[module_not_licensed\]/);
    await license("active", "pista-norte");
    await license("active", "pista-sur");
    await license("active", "", "bill-cash");
    ok(await mutate("skiRental.activateSite", NORTE));
    ok(await mutate("skiRental.activateSite", SUR));
    storeId = ok(await mutate("skiRental.createStore", { ...NORTE, name: "Tienda", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" })).id;
    skiModel = ok(await mutate("skiRental.createModel", { ...NORTE, assetType: "ski", name: "Allround", size: "160", replacementValueCents: 30000 })).id;
    bootModel = ok(await mutate("skiRental.createModel", { ...NORTE, assetType: "boots", name: "Comfort", size: "42" })).id;
    ok(await mutate("skiRental.createUnits", { ...NORTE, modelId: skiModel, storeId, count: 3 }));
    ok(await mutate("skiRental.createUnits", { ...NORTE, modelId: bootModel, storeId, count: 3 }));
    ok(await mutate("skiRental.setDepositRule", { ...NORTE, assetType: "ski", amountCents: 5000 }));
    ok(await mutate("skiRental.setDepositRule", { ...NORTE, assetType: "boots", amountCents: 3000 }));
    const rules = ok(await mutate("skiRental.setDepositRule", { ...NORTE, modelId: skiModel, amountCents: 10000 }));
    expect(rules.map((r: any) => [r.ruleKey, r.amountCents]).sort()).toEqual([[`model:${skiModel}`, 10000], ["type:boots", 3000], ["type:ski", 5000]]);
    // Las reglas de una sede no se ven desde otra, ni se pueden poner sobre un modelo ajeno
    expect(ok(await query("skiRental.depositRules", SUR))).toEqual([]);
    expect(fail(await mutate("skiRental.setDepositRule", { ...SUR, modelId: skiModel, amountCents: 100 })).status).toBe(404);

    // Cajas del TPV: una por sede con su sesión abierta
    const now = Date.now();
    for (const [site, name] of [
      ["pista-norte", "Caja norte"],
      ["pista-sur", "Caja sur"],
    ] as const) {
      const [reg] = (await tenantDb.query("INSERT INTO cash_registers (name, isActive, createdAt, site_id) VALUES (?, 1, ?, ?)", [name, now, site])) as unknown as [{ insertId: number }];
      const [ses] = (await tenantDb.query("INSERT INTO cash_sessions (registerId, cashierUserId, cashierName, openingAmount, status_cs, openedAt, site_id) VALUES (?, 1, 'Cajero', 0, 'open', ?, ?)", [reg.insertId, now, site])) as unknown as [{ insertId: number }];
      if (site === "pista-norte") sessNorte = ses.insertId;
      else sessSur = ses.insertId;
    }
    expect(ok(await query("skiRental.depositCashSessions", NORTE)).map((s: any) => s.id)).toEqual([sessNorte]);
  }, 60_000);

  it("fianza en efectivo al entregar: sugerida por modelo y tipo, entrada en caja y sin duplicar con doble clic", async () => {
    d1 = ok(
      await mutate("skiRental.createDelivery", {
        ...NORTE,
        storeId,
        customerName: "Cliente Ficticio",
        startDate: "2026-12-20",
        expectedReturnDate: "2026-12-21",
        lines: [
          { code: "SKI-00001", requestedType: "ski" },
          { code: "BOOT-00004", requestedType: "boots" },
        ],
      }),
    ).id;
    expect(ok(await query("skiRental.depositForDelivery", { ...NORTE, deliveryId: d1 }))).toMatchObject({ deposit: null, suggestedCents: 13000 });
    // Efectivo sin caja, o con la caja de otra sede: no
    expect(fail(await mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d1, amountCents: 13000, method: "cash" })).status).toBe(400);
    expect(fail(await mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d1, amountCents: 13000, method: "cash", sessionId: sessSur })).message).toMatch(/otra sede/);
    // Desde otra sede la entrega no existe
    expect(fail(await mutate("skiRental.registerDeposit", { ...SUR, deliveryId: d1, amountCents: 13000, method: "cash", sessionId: sessSur })).status).toBe(404);
    const all = await Promise.all([1, 2, 3].map(() => mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d1, amountCents: 13000, method: "cash", sessionId: sessNorte })));
    const deps = all.map((r) => ok(r).deposit);
    expect(new Set(deps.map((x: any) => x.id)).size).toBe(1);
    dep1 = deps[0].id;
    expect(deps[0]).toMatchObject({ status: "held", amountCents: 13000, method: "cash", collectSessionId: sessNorte });
    expect(await count("SELECT COUNT(*) AS n FROM cash_movements WHERE sessionId = ? AND type_cm = 'in' AND amount = 130.00", [sessNorte])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM ski_deposits WHERE delivery_id = ?", [d1])).toBe(1);
  }, 60_000);

  it("liquidación: retención con motivo, venta de daños única en el TPV, salida de caja y cargo pendiente por lo no cubierto", async () => {
    expect(fail(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep1, damageCents: 0, sessionId: sessNorte })).message).toMatch(/devolución de todo el material/);
    const det = ok(await query("skiRental.getDelivery", { ...NORTE, deliveryId: d1 }));
    ok(await mutate("skiRental.returnLine", { ...NORTE, lineId: det.lines[0].id, condition: "lost", note: "No lo devuelve" }));
    ok(await mutate("skiRental.returnLine", { ...NORTE, lineId: det.lines[1].id, condition: "ok" }));
    expect(ok(await query("skiRental.depositForDelivery", { ...NORTE, deliveryId: d1 })).suggestedDamageCents).toBe(30000);
    expect(fail(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep1, damageCents: 30000, sessionId: sessNorte })).message).toMatch(/motivo/);
    expect(fail(await mutate("skiRental.settleDeposit", { ...SUR, depositId: dep1, damageCents: 0, sessionId: sessSur })).status).toBe(404);
    const salesBefore = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    const runs = await Promise.all([1, 2].map(() => mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep1, damageCents: 30000, reason: "Esquí perdido", note: "Se avisa al cliente", sessionId: sessNorte })));
    expect(runs.some((r) => r.status === 200)).toBe(true);
    const again = ok(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep1, damageCents: 30000, reason: "Esquí perdido", sessionId: sessNorte }));
    expect(again.replayed).toBe(true);
    expect(again.deposit).toMatchObject({ status: "retained_total", refundedCents: 0, retainedCents: 13000, damageCents: 30000 });
    // Una sola venta «Cargo por daños» de 130 € en la caja de la sede
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(salesBefore + 1);
    const [[sale]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT total, sessionId, fiscalSummary, taxAmount, reavMargin FROM tpv_sales WHERE id = ?", [again.deposit.damageSaleId])) as unknown as [[any]];
    expect(Number(sale.sessionId)).toBe(sessNorte);
    expect(Number(sale.total)).toBe(130);
    // IVA general de la empresa, nunca REAV (pendiente del asesor fiscal: art. 78.Tres.1º LIVA)
    expect(sale.fiscalSummary).toBe("iva_only");
    expect(Number(sale.taxAmount)).toBeGreaterThan(0);
    expect(Number(sale.reavMargin)).toBe(0);
    // Salida de caja por lo aplicado a la venta (sale de la custodia) y ninguna devolución
    expect(await count("SELECT COUNT(*) AS n FROM cash_movements WHERE sessionId = ? AND type_cm = 'out' AND amount = 130.00", [sessNorte])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM cash_movements WHERE sessionId = ? AND type_cm = 'out'", [sessNorte])).toBe(1);
    // Lo no cubierto: un cargo pendiente de 170 €
    const charges = ok(await query("skiRental.depositForDelivery", { ...NORTE, deliveryId: d1 })).charges;
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ amountCents: 17000, status: "pending", depositId: dep1 });

    // Cobro del cargo en el TPV con tarjeta: una sola venta aunque se pulse dos veces
    const pays = await Promise.all([1, 2].map(() => mutate("skiRental.payDamageCharge", { ...NORTE, chargeId: charges[0].id, sessionId: sessNorte, method: "card" })));
    expect(pays.some((r) => r.status === 200)).toBe(true);
    const paid = ok(await mutate("skiRental.payDamageCharge", { ...NORTE, chargeId: charges[0].id, sessionId: sessNorte, method: "card" }));
    expect(paid).toMatchObject({ replayed: true, charge: { status: "paid", payMethod: "card" } });
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(salesBefore + 2);
    expect(fail(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: charges[0].id, reason: "Error" })).status).toBe(409);
  }, 60_000);

  it("tarjeta: devolución total sin efectivo ni venta; cargo manual sin duplicar y anulado con motivo", async () => {
    const d2 = ok(await mutate("skiRental.createDelivery", { ...NORTE, storeId, customerName: "Otra clienta", startDate: "2026-12-20", expectedReturnDate: "2026-12-21", lines: [{ code: "BOOT-00005", requestedType: "boots" }] })).id;
    const dep = ok(await mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d2, amountCents: 3000, method: "card" })).deposit;
    const det = ok(await query("skiRental.getDelivery", { ...NORTE, deliveryId: d2 }));
    ok(await mutate("skiRental.returnLine", { ...NORTE, lineId: det.lines[0].id, condition: "ok" }));
    const moves = await count("SELECT COUNT(*) AS n FROM cash_movements");
    const sales = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    const r = ok(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep.id, damageCents: 0 }));
    expect(r.deposit).toMatchObject({ status: "refunded", refundedCents: 3000, retainedCents: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM cash_movements")).toBe(moves);
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(sales);

    const key = `req-${run}-abc`;
    const a = ok(await mutate("skiRental.createDamageCharge", { ...NORTE, deliveryId: d2, amountCents: 1500, reason: "Hebilla rota detectada después", requestKey: key }));
    const b = ok(await mutate("skiRental.createDamageCharge", { ...NORTE, deliveryId: d2, amountCents: 1500, reason: "Hebilla rota detectada después", requestKey: key }));
    expect(b).toMatchObject({ replayed: true, charge: { id: a.charge.id } });
    expect(ok(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: a.charge.id, reason: "Era de antes" }))).toMatchObject({ status: "cancelled", cancelReason: "Era de antes" });
  }, 60_000);

  it("listado de fianzas abiertas, totales del día, justificante y aislamiento por sede", async () => {
    const d3 = ok(await mutate("skiRental.createDelivery", { ...NORTE, storeId, customerName: "Tercer cliente", startDate: "2026-12-20", expectedReturnDate: "2026-12-21", lines: [{ code: "SKI-00002", requestedType: "ski" }] })).id;
    ok(await mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d3, amountCents: 10000, method: "external", externalRef: "PREAUT-1234" }));
    expect(ok(await query("skiRental.listDeposits", { ...NORTE, status: "open" })).deposits.map((x: any) => x.deliveryId)).toEqual([d3]);
    expect(ok(await query("skiRental.listDeposits", { ...NORTE, status: "closed" })).deposits).toHaveLength(2);
    expect(ok(await query("skiRental.listDeposits", { ...SUR, status: "open" })).deposits).toEqual([]);
    const t = ok(await query("skiRental.depositTotals", NORTE));
    expect(t.collected).toMatchObject({ cash: 13000, card: 3000, external: 10000, count: 3 });
    expect(t.refunded).toMatchObject({ card: 3000, total: 3000 });
    expect(t.retained).toMatchObject({ cash: 13000, total: 13000 });
    expect(t.open).toMatchObject({ external: 10000, count: 1 });
    expect(t.chargesPaid).toMatchObject({ count: 1, total: 17000 });
    expect(t.netCashCents).toBe(0);
    expect(ok(await query("skiRental.depositTotals", SUR)).collected.count).toBe(0);
    const ev = ok(await query("skiRental.depositForDelivery", { ...NORTE, deliveryId: d1 })).events.map((e: any) => e.kind);
    expect(ev).toEqual(["collected", "retained", "charge_created", "charge_paid"]);
  }, 60_000);

  it("liquidación a medias con la caja cerrada: se reasigna a otra caja abierta de la sede, sin duplicar la venta y con la caja cuadrada", async () => {
    const d4 = ok(await mutate("skiRental.createDelivery", { ...NORTE, storeId, customerName: "Cuarto cliente", startDate: "2026-12-20", expectedReturnDate: "2026-12-21", lines: [{ code: "SKI-00003", requestedType: "ski" }] })).id;
    const dep = ok(await mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d4, amountCents: 6000, method: "cash", sessionId: sessNorte })).deposit;
    const det = ok(await query("skiRental.getDelivery", { ...NORTE, deliveryId: d4 }));
    ok(await mutate("skiRental.returnLine", { ...NORTE, lineId: det.lines[0].id, condition: "damaged", note: "Fijación rota" }));
    // Otra caja de la sede donde empezó la liquidación: la venta de daños llegó a crearse y la caja se cerró antes del cierre
    const now = Date.now();
    const [reg] = (await tenantDb.query("INSERT INTO cash_registers (name, isActive, createdAt, site_id) VALUES ('Caja norte 2', 1, ?, 'pista-norte')", [now])) as unknown as [{ insertId: number }];
    const [ses] = (await tenantDb.query("INSERT INTO cash_sessions (registerId, cashierUserId, cashierName, openingAmount, status_cs, openedAt, site_id) VALUES (?, 1, 'Cajero', 0, 'open', ?, 'pista-norte')", [reg.insertId, now])) as unknown as [{ insertId: number }];
    const sessA = ses.insertId;
    await tenantDb.query(
      "UPDATE ski_deposits SET status = 'settling', damage_cents = 2000, refunded_cents = 4000, retained_cents = 2000, settle_session_id = ?, settle_reason = 'Fijación rota', settled_by = 'user:1' WHERE id = ?",
      [sessA, dep.id],
    );
    const key = `skidep-${dep.id}-r2000`;
    const sale = ok(
      await mutate("tpv.createSale", {
        sessionId: sessA,
        idempotencyKey: key,
        discountAmount: 0,
        items: [{ productType: "extra", productId: 0, productName: "Cargo por daños (alquiler de material)", quantity: 1, unitPrice: 20, discountPercent: 0, participants: 1, isManual: true, forceGeneralVat: true, conceptText: "Cargo por daños" }],
        payments: [{ method: "cash", amount: 20 }],
      }),
    ).sale;
    await tenantDb.query("UPDATE cash_sessions SET status_cs = 'closed', closedAt = ? WHERE id = ?", [Date.now(), sessA]);

    // Repetir sin caja, o con la de otra sede: no; queda «liquidándose» (no se libera: la venta ya existe)
    expect(fail(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep.id, damageCents: 2000, reason: "Fijación rota" })).message).toMatch(/ya está cerrada/);
    expect(fail(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep.id, damageCents: 2000, reason: "Fijación rota", sessionId: sessSur })).message).toMatch(/otra sede/);
    const [[st]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status FROM ski_deposits WHERE id = ?", [dep.id])) as unknown as [[any]];
    expect(st.status).toBe("settling");

    const salesBefore = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    const r = ok(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep.id, damageCents: 2000, reason: "Fijación rota", sessionId: sessNorte }));
    expect(r.deposit).toMatchObject({ status: "retained_partial", refundedCents: 4000, retainedCents: 2000, settleSessionId: sessNorte, damageSaleId: Number(sale.id) });
    // La venta del intento anterior se recupera por su clave: ninguna nueva
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(salesBefore);
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey = ?", [key])).toBe(1);
    // Caja cuadrada: entrada 60 − devolución 40 − aplicado 20 (en la caja abierta) + venta 20 (en la cerrada) = 20 retenidos
    const [[mv]] = (await tenantDb.query<mysql.RowDataPacket[]>(
      "SELECT COALESCE(SUM(CASE WHEN type_cm = 'in' THEN amount ELSE -amount END), 0) AS net, SUM(sessionId = ?) AS inA FROM cash_movements WHERE reason LIKE ?",
      [sessA, `%alquiler #${d4}`],
    )) as unknown as [[any]];
    expect(Number(mv.net)).toBe(0);
    expect(Number(mv.inA)).toBe(0);
    const [[sv]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT total FROM tpv_sales WHERE id = ?", [sale.id])) as unknown as [[any]];
    expect(Number(mv.net) + Number(sv.total)).toBe(20);
    // Repetir ya cerrada: no cambia nada
    expect(ok(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: dep.id, damageCents: 2000, reason: "Fijación rota", sessionId: sessNorte })).replayed).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM cash_movements WHERE reason LIKE ?", [`%alquiler #${d4}`])).toBe(3);
  }, 60_000);

  it("contabilidad general: las fianzas en efectivo, contra fianzas recibidas (560); su cobro y su devolución se saldan y no tocan el 555 ni el 430", async () => {
    // Cada movimiento de fianza guardó su tipo en la misma transacción
    expect(await count("SELECT COUNT(*) AS n FROM cash_movements m LEFT JOIN acc_cash_movement_kinds k ON k.movement_id = m.id WHERE m.reason LIKE '%fianza%' AND (k.kind IS NULL OR k.kind <> 'fianza')")).toBe(0);
    await license("active", "", "accounting-general");
    const s = ok(await mutate("accountingGeneral.sync", undefined));
    expect(s.errors).toEqual([]);
    const sum = async (code: string) => {
      const [[r]] = (await tenantDb.query<mysql.RowDataPacket[]>(
        "SELECT COALESCE(SUM(CAST(l.debit_cents AS SIGNED) - CAST(l.credit_cents AS SIGNED)), 0) AS n FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id WHERE e.source_key LIKE 'cajamov:%' AND l.account_code = ?",
        [code],
      )) as unknown as [[{ n: number }]];
      return Number(r.n);
    };
    // Fianzas cobradas en efectivo (130 + 60), todas liquidadas: devueltas o aplicadas a la venta de daños
    expect(await sum("560")).toBe(0);
    expect(await sum("555")).toBe(0);
    expect(await sum("430")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id WHERE e.source_key LIKE 'cajamov:%' AND l.account_code = '560'")).toBeGreaterThan(0);
    // La devolución de una fianza no se toma por una devolución a un cliente ni queda para revisar
    expect(s.review.filter((r: any) => String(r.key).startsWith("cajamov:"))).toEqual([]);
  }, 60_000);
});
