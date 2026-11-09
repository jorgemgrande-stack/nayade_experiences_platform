/**
 * Ski Net · Cobro idempotente del cargo por daños y de la liquidación de la fianza, con la aplicación REAL sobre MySQL
 * (opt-in, REGISTRY_TEST_DATABASE_URL): routers tRPC reales y el TPV del Core para la venta. Ningún cobro real.
 *
 * Caso de origen (revisión de la PR #736): con un doble clic, el segundo intento agotaba la espera del bloqueo de la
 * venta y devolvía el cargo a «pendiente» mientras el primero ya había creado la venta; el cargo quedaba pendiente con
 * la venta cobrada, y se podía anular o volver a cobrar. Aquí se prueba:
 *  - doble clic y concurrencia (cobros y anulación a la vez): una sola venta y estados coherentes;
 *  - fallo después de crear la venta y antes de finalizar, y corte de red del cliente: el reintento concilia;
 *  - reintento tras agotarse la espera del bloqueo: no libera nada y el primero termina bien;
 *  - recuperación de un cargo que quedó pendiente con la venta ya creada (estado del fallo antiguo);
 *  - fallo del TPV sin venta: el cargo vuelve a «pendiente»; venta anulada en el TPV: el cobro nuevo usa otra clave;
 *  - liquidación de la fianza: fallo tras crear la venta y recuperación de una venta que quedó suelta.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
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
const T = `skii-${run}`;
const PASS = "clave-ski-" + run;

describe.skipIf(!URL_)("Ski Net · cobro idempotente del cargo por daños y de la fianza (routers reales, TPV del Core)", () => {
  let admin: mysql.Pool;
  let tenantDb: mysql.Connection;
  let server: http.Server;
  let port: number;
  let cookie = "";
  let closeAll: () => Promise<void>;
  let license: (status: string, siteId?: string, capabilityId?: string) => Promise<void>;
  let Store: typeof import("./skiRental/depositStore").TenantDbDepositStore;
  let lockWait: { seconds: number };
  const host = `${T}.elephantsource.es`;

  function call(method: string, p: string, body?: unknown, abortAfterMs?: number) {
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
      req.on("error", (e) => (abortAfterMs != null ? resolve({ status: 0, json: null }) : reject(e)));
      if (data) req.write(data);
      req.end();
      // Corte de red del cliente: el servidor sigue con la petición, el cliente no ve la respuesta
      if (abortAfterMs != null) setTimeout(() => req.destroy(), abortAfterMs);
    });
  }
  const mutate = (proc: string, input: unknown, abortAfterMs?: number) => call("POST", `/api/trpc/${proc}`, { json: input }, abortAfterMs);
  const query = (proc: string, input?: unknown) => call("GET", `/api/trpc/${proc}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`);
  const ok = (r: { status: number; json: any }) => {
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  };
  const fail = (r: { status: number; json: any }) => ({ status: r.status, message: String(r.json?.error?.json?.message ?? "") });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    const { MysqlOrganizationStore } = await import("./organization/service");
    const org = new MysqlOrganizationStore(admin);
    await org.insertSite({ tenantId: T, siteId: "pista-norte", name: "pista-norte", fiscalEntityId: null, status: "active", createdAt: 1, createdBy: "test", updatedAt: 1 });
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
    // El mismo módulo que usa el router: los espías sobre su prototipo alcanzan al servicio real
    Store = (await import("./skiRental/depositStore")).TenantDbDepositStore;
    lockWait = (await import("./skiRental/router")).depositLockWait;
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    const app = express();
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    app.use(createLocalAuthRouter());
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext, onError: ({ error, path }) => { if (error.code === "INTERNAL_SERVER_ERROR") console.error("[prueba] error interno", path, (error.cause as Error | undefined)?.message?.slice(0, 120) ?? error.message, String((error.cause as { cause?: unknown } | undefined)?.cause ?? "")); } }));
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

  afterEach(() => {
    vi.restoreAllMocks();
    if (lockWait) lockWait.seconds = 30;
  });

  afterAll(async () => {
    await closeAll?.();
    await tenantDb?.end();
    await admin?.end();
  });

  const NORTE = { siteId: "pista-norte" };
  let storeId = 0;
  let sess = 0;
  let sess2 = 0;
  let delivery = 0;
  const count = async (q: string, p: unknown[] = []) => {
    const [[r]] = (await tenantDb.query<mysql.RowDataPacket[]>(q, p)) as unknown as [[{ n: number }]];
    return Number(r.n);
  };
  const chargeRow = async (id: number) => {
    const [[r]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status, tpv_sale_id, pay_session_id, pay_method FROM ski_deposit_charges WHERE id = ?", [id])) as unknown as [[any]];
    return { status: String(r.status), saleId: r.tpv_sale_id == null ? null : Number(r.tpv_sale_id), sessionId: r.pay_session_id == null ? null : Number(r.pay_session_id), method: r.pay_method as string | null };
  };
  const salesOf = (chargeId: number) => count("SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey LIKE ? AND status_ts = 'paid'", [`skichg-${chargeId}-pay%`]);
  const paidEvents = (chargeId: number) => count("SELECT COUNT(*) AS n FROM ski_deposit_events WHERE charge_id = ? AND kind = 'charge_paid'", [chargeId]);
  /** El cargo y su venta cuentan lo mismo: cobrado ⇔ exactamente una venta cobrada, la anotada en el cargo. */
  const coherent = async (chargeId: number) => {
    const c = await chargeRow(chargeId);
    const sales = await salesOf(chargeId);
    if (c.status === "paid") {
      expect(sales).toBe(1);
      expect(await paidEvents(chargeId)).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM tpv_sales WHERE id = ? AND status_ts = 'paid' AND idempotencyKey LIKE ?", [c.saleId, `skichg-${chargeId}-pay%`])).toBe(1);
    } else {
      expect(sales).toBe(0);
      expect(await paidEvents(chargeId)).toBe(0);
    }
    return c;
  };
  let nCharge = 0;
  const newCharge = async (amountCents = 1500) =>
    ok(await mutate("skiRental.createDamageCharge", { ...NORTE, deliveryId: delivery, amountCents, reason: "Daños de prueba", requestKey: `req-${run}-${++nCharge}` })).charge.id as number;
  const pay = (chargeId: number, sessionId = sess, method = "card", abortAfterMs?: number) => mutate("skiRental.payDamageCharge", { ...NORTE, chargeId, sessionId, method }, abortAfterMs);
  /** Venta del TPV con la clave del cargo hecha a mano: el estado que dejaba el fallo antiguo. */
  const strandedSale = async (key: string, euros: number, sessionId = sess, method = "cash") =>
    ok(
      await mutate("tpv.createSale", {
        sessionId,
        idempotencyKey: key,
        discountAmount: 0,
        items: [{ productType: "extra", productId: 0, productName: "Cargo por daños (alquiler de material)", quantity: 1, unitPrice: euros, discountPercent: 0, participants: 1, isManual: true, forceGeneralVat: true, conceptText: "Cargo por daños" }],
        payments: [{ method, amount: euros }],
      }),
    ).sale as { id: number; ticketNumber: string };

  it("preparación: licencias, material, cajas abiertas y una entrega devuelta", async () => {
    await license("active", "pista-norte");
    await license("active", "", "bill-cash");
    ok(await mutate("skiRental.activateSite", NORTE));
    storeId = ok(await mutate("skiRental.createStore", { ...NORTE, name: "Tienda", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" })).id;
    const model = ok(await mutate("skiRental.createModel", { ...NORTE, assetType: "ski", name: "Allround", size: "160", replacementValueCents: 30000 })).id;
    ok(await mutate("skiRental.createUnits", { ...NORTE, modelId: model, storeId, count: 4 }));
    const now = Date.now();
    for (const name of ["Caja 1", "Caja 2"]) {
      const [reg] = (await tenantDb.query("INSERT INTO cash_registers (name, isActive, createdAt, site_id) VALUES (?, 1, ?, 'pista-norte')", [name, now])) as unknown as [{ insertId: number }];
      const [ses] = (await tenantDb.query("INSERT INTO cash_sessions (registerId, cashierUserId, cashierName, openingAmount, status_cs, openedAt, site_id) VALUES (?, 1, 'Cajero', 0, 'open', ?, 'pista-norte')", [reg.insertId, now])) as unknown as [{ insertId: number }];
      if (!sess) sess = ses.insertId;
      else sess2 = ses.insertId;
    }
    delivery = ok(await mutate("skiRental.createDelivery", { ...NORTE, storeId, customerName: "Cliente Ficticio", startDate: "2026-12-20", expectedReturnDate: "2026-12-21", lines: [{ code: "SKI-00001", requestedType: "ski" }] })).id;
  }, 60_000);

  it("doble clic: dos cobros simultáneos del mismo cargo crean una sola venta y los dos ven el cargo cobrado", async () => {
    const id = await newCharge();
    const [a, b] = await Promise.all([pay(id), pay(id)]);
    const ra = ok(a);
    const rb = ok(b);
    expect([ra.replayed, rb.replayed].sort()).toEqual([false, true]);
    expect(ra.charge).toMatchObject({ status: "paid" });
    expect(rb.charge).toMatchObject({ status: "paid", tpvSaleId: ra.charge.tpvSaleId });
    const c = await coherent(id);
    expect(c).toMatchObject({ status: "paid", sessionId: sess, method: "card" });
    // Ya cobrado: no se anula, y repetirlo no crea nada
    expect(fail(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id, reason: "Error" })).status).toBe(409);
    expect(ok(await pay(id))).toMatchObject({ replayed: true, charge: { status: "paid" } });
    await coherent(id);
  }, 60_000);

  it("concurrencia: varios cobros y una anulación a la vez dejan el cargo y la venta coherentes", async () => {
    for (let round = 0; round < 3; round++) {
      const id = await newCharge(1000 + round);
      const results = await Promise.all([pay(id), pay(id, sess2, "cash"), mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id, reason: "Anulación simultánea" }), pay(id), pay(id)]);
      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      const c = await coherent(id);
      expect(["paid", "cancelled"]).toContain(c.status);
    }
    // Más cargos distintos a la vez que conexiones tiene el pool de la empresa (4): todos se cobran, sin interbloqueo
    const ids = await Promise.all([700, 701, 702, 703, 704, 705].map((c) => newCharge(c)));
    const rs = await Promise.all(ids.map((id) => pay(id)));
    expect(rs.map((r) => r.status)).toEqual(ids.map(() => 200));
    for (const id of ids) expect((await coherent(id)).status).toBe("paid");
    // Y ventas normales del TPV con claves distintas a la vez, mezcladas con un cobro de cargo
    const extra = await newCharge(706);
    const mixed = await Promise.all([
      ...[1, 2, 3, 4, 5].map((i) =>
        mutate("tpv.createSale", {
          sessionId: sess,
          idempotencyKey: `venta-${run}-${i}`,
          discountAmount: 0,
          items: [{ productType: "extra", productId: 0, productName: "Venta suelta", quantity: 1, unitPrice: 5, discountPercent: 0, participants: 1, isManual: true, forceGeneralVat: true, conceptText: "Venta suelta" }],
          payments: [{ method: "cash", amount: 5 }],
        }),
      ),
      pay(extra),
    ]);
    expect(mixed.map((r) => r.status)).toEqual(mixed.map(() => 200));
    await coherent(extra);
  }, 120_000);

  it("fallo tras crear la venta y antes de finalizar: el cargo no vuelve a pendiente y el reintento concilia sin otra venta", async () => {
    const id = await newCharge(2500);
    const spy = vi.spyOn(Store.prototype, "finishCharge").mockRejectedValueOnce(new Error("conexión perdida con la base de datos"));
    const first = await pay(id);
    expect(first.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    // La venta quedó cobrada; el cargo, «cobrándose» (nunca «pendiente»: no se puede anular ni cobrar dos veces)
    expect(await salesOf(id)).toBe(1);
    expect((await chargeRow(id)).status).toBe("paying");
    const retry = ok(await pay(id));
    expect(retry).toMatchObject({ replayed: true, charge: { status: "paid" } });
    expect(retry.ticketNumber).toBeTruthy();
    await coherent(id);

    // Igual, pero el siguiente paso es una anulación: se rechaza y el cargo queda conciliado como cobrado
    const id2 = await newCharge(2600);
    vi.spyOn(Store.prototype, "finishCharge").mockRejectedValueOnce(new Error("conexión perdida con la base de datos"));
    expect((await pay(id2)).status).toBe(500);
    expect(fail(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id2, reason: "Error" })).message).toMatch(/ya está cobrado/);
    expect((await coherent(id2)).status).toBe("paid");
  }, 60_000);

  it("error de red del cliente durante el cobro: el servidor termina y el reintento devuelve el mismo cobro", async () => {
    const id = await newCharge(2700);
    const orig = Store.prototype.finishCharge;
    vi.spyOn(Store.prototype, "finishCharge").mockImplementation(async function (this: InstanceType<typeof Store>, ...args: Parameters<typeof orig>) {
      await sleep(1500);
      return orig.apply(this, args);
    });
    const cut = await pay(id, sess, "card", 300);
    expect(cut.status).toBe(0);
    // El reintento llega mientras el primero sigue: espera al bloqueo y devuelve el cobro del primero
    const retry = ok(await pay(id));
    expect(retry).toMatchObject({ replayed: true, charge: { status: "paid" } });
    await coherent(id);
  }, 60_000);

  it("reintento tras agotarse la espera del bloqueo: no deshace nada y el primer intento termina cobrado (caso de la revisión)", async () => {
    lockWait.seconds = 1;
    const id = await newCharge(2800);
    const orig = Store.prototype.finishCharge;
    vi.spyOn(Store.prototype, "finishCharge").mockImplementation(async function (this: InstanceType<typeof Store>, ...args: Parameters<typeof orig>) {
      await sleep(3000);
      return orig.apply(this, args);
    });
    const first = pay(id);
    await sleep(400);
    const second = await pay(id);
    expect(fail(second)).toMatchObject({ status: 409, message: expect.stringMatching(/ya se está registrando/) });
    // Antes, aquí el cargo volvía a «pendiente» con la venta ya creada
    expect((await chargeRow(id)).status).toBe("paying");
    expect(fail(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id, reason: "Error" })).status).toBe(409);
    expect(ok(await first)).toMatchObject({ replayed: false, charge: { status: "paid" } });
    expect(ok(await pay(id))).toMatchObject({ replayed: true });
    await coherent(id);
  }, 60_000);

  it("recuperación: un cargo que quedó pendiente con la venta ya creada se concilia al cobrar, sin otra venta y con la caja y la forma de la venta", async () => {
    const id = await newCharge(3000);
    const sale = await strandedSale(`skichg-${id}-pay`, 30, sess2, "cash");
    expect((await chargeRow(id)).status).toBe("pending");
    const sales = await count("SELECT COUNT(*) AS n FROM tpv_sales");
    // Se pide con otra caja y otra forma: manda lo que de verdad se cobró
    const r = ok(await pay(id, sess, "card"));
    expect(r).toMatchObject({ replayed: true, ticketNumber: sale.ticketNumber, charge: { status: "paid", tpvSaleId: Number(sale.id), paySessionId: sess2, payMethod: "cash" } });
    expect(await count("SELECT COUNT(*) AS n FROM tpv_sales")).toBe(sales);
    await coherent(id);
    // Totales del día: el cargo cuenta una vez, en efectivo
    const ev = ok(await query("skiRental.depositForDelivery", { ...NORTE, deliveryId: delivery })).events.filter((e: any) => e.chargeId === id && e.kind === "charge_paid");
    expect(ev).toEqual([expect.objectContaining({ method: "cash", cashSessionId: sess2, tpvSaleId: Number(sale.id) })]);

    // El mismo estado, y lo siguiente es una anulación: se rechaza y se concilia
    const id2 = await newCharge(3100);
    await strandedSale(`skichg-${id2}-pay`, 31);
    expect(fail(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id2, reason: "Error" })).message).toMatch(/ya está cobrado/);
    expect((await coherent(id2)).status).toBe("paid");
  }, 60_000);

  it("fallo del TPV sin venta: el cargo vuelve a pendiente y se cobra después; venta anulada en el TPV: el cobro nuevo no la reutiliza", async () => {
    const id = await newCharge(3200);
    // La caja se cierra justo después de reservar el cobro: el TPV lo rechaza sin grabar venta
    const orig = Store.prototype.claimCharge;
    vi.spyOn(Store.prototype, "claimCharge").mockImplementation(async function (this: InstanceType<typeof Store>, ...args: Parameters<typeof orig>) {
      const c = await orig.apply(this, args);
      await tenantDb.query("UPDATE cash_sessions SET status_cs = 'closed' WHERE id = ?", [sess]);
      return c;
    });
    expect(fail(await pay(id))).toMatchObject({ status: 409, message: expect.stringMatching(/caja está cerrada/i) });
    vi.restoreAllMocks();
    await tenantDb.query("UPDATE cash_sessions SET status_cs = 'open' WHERE id = ?", [sess]);
    expect(await coherent(id)).toMatchObject({ status: "pending", sessionId: null });
    expect(ok(await pay(id))).toMatchObject({ replayed: false, charge: { status: "paid" } });
    await coherent(id);

    // Venta del cargo anulada en el TPV con el cargo pendiente: la clave está gastada; el cobro usa la siguiente
    const id2 = await newCharge(3300);
    const old = await strandedSale(`skichg-${id2}-pay`, 33);
    await tenantDb.query("UPDATE tpv_sales SET status_ts = 'cancelled' WHERE id = ?", [old.id]);
    const r = ok(await pay(id2));
    expect(r).toMatchObject({ replayed: false, charge: { status: "paid" } });
    expect(r.charge.tpvSaleId).not.toBe(Number(old.id));
    const [[k]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT idempotencyKey AS k FROM tpv_sales WHERE id = ?", [r.charge.tpvSaleId])) as unknown as [[any]];
    expect(k.k).toBe(`skichg-${id2}-pay-2`);
    await coherent(id2);
    // Sin venta viva, un «cobrándose» interrumpido se puede anular
    const id3 = await newCharge(3400);
    await tenantDb.query("UPDATE ski_deposit_charges SET status = 'paying', pay_session_id = ?, pay_method = 'card' WHERE id = ?", [sess, id3]);
    expect(ok(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id3, reason: "Intento interrumpido" }))).toMatchObject({ status: "cancelled" });
    await coherent(id3);
  }, 60_000);

  it("venta «pendiente» de un proceso caído: reciente, el cobro espera; abandonada (más de 15 min), se anula y el cobro usa otra clave", async () => {
    const id = await newCharge(3500);
    const stuck = await strandedSale(`skichg-${id}-pay`, 35);
    // Estado que deja un proceso caído entre numerar la venta y grabar su núcleo
    await tenantDb.query("UPDATE tpv_sales SET status_ts = 'pending' WHERE id = ?", [stuck.id]);
    expect(fail(await pay(id))).toMatchObject({ status: 409, message: expect.stringMatching(/sigue registrándose/) });
    expect(fail(await mutate("skiRental.cancelDamageCharge", { ...NORTE, chargeId: id, reason: "Error" })).status).toBe(409);
    await tenantDb.query("UPDATE tpv_sales SET createdAt = ? WHERE id = ?", [Date.now() - 20 * 60_000, stuck.id]);
    const r = ok(await pay(id));
    expect(r).toMatchObject({ replayed: false, charge: { status: "paid" } });
    const [[old]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status_ts AS s, idempotencyKey AS k, notes FROM tpv_sales WHERE id = ?", [stuck.id])) as unknown as [[any]];
    expect(old).toMatchObject({ s: "cancelled", k: null });
    expect(String(old.notes)).toMatch(/VENTA NO REGISTRADA/);
    const [[k]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT idempotencyKey AS k FROM tpv_sales WHERE id = ?", [r.charge.tpvSaleId])) as unknown as [[any]];
    // La anulada soltó su clave (como hace el TPV al fallar): el cobro nuevo vuelve a usar la de siempre
    expect(k.k).toBe(`skichg-${id}-pay`);
    await coherent(id);
  }, 60_000);

  it("alta del cargo con triple clic: un solo cargo, sin interbloqueos", async () => {
    const key = `req-${run}-triple`;
    const rs = await Promise.all([1, 2, 3, 4].map(() => mutate("skiRental.createDamageCharge", { ...NORTE, deliveryId: delivery, amountCents: 900, reason: "Triple clic", requestKey: key })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(rs.map((r) => ok(r).charge.id)).size).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM ski_deposit_charges WHERE request_key = ?", [key])).toBe(1);
  }, 60_000);

  const newDeposit = async (amountCents: number) => {
    const code = `SKI-0000${2 + nDep++}`;
    const d = ok(await mutate("skiRental.createDelivery", { ...NORTE, storeId, customerName: "Fianza", startDate: "2026-12-20", expectedReturnDate: "2026-12-21", lines: [{ code, requestedType: "ski" }] })).id;
    const dep = ok(await mutate("skiRental.registerDeposit", { ...NORTE, deliveryId: d, amountCents, method: "cash", sessionId: sess })).deposit;
    const det = ok(await query("skiRental.getDelivery", { ...NORTE, deliveryId: d }));
    ok(await mutate("skiRental.returnLine", { ...NORTE, lineId: det.lines[0].id, condition: "damaged", note: "Golpe" }));
    return { d, depId: dep.id as number };
  };
  let nDep = 0;
  const depSales = (depId: number) => count("SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey LIKE ? AND status_ts = 'paid'", [`skidep-${depId}-%`]);
  const depMoves = (d: number) => count("SELECT COUNT(*) AS n FROM cash_movements WHERE reason LIKE ?", [`%alquiler #${d}`]);

  it("liquidación: doble clic con fallo tras crear la venta; el reintento termina con una venta y la caja cuadrada", async () => {
    const { d, depId } = await newDeposit(5000);
    vi.spyOn(Store.prototype, "finishSettlement").mockRejectedValueOnce(new Error("conexión perdida con la base de datos"));
    const input = { ...NORTE, depositId: depId, damageCents: 2000, reason: "Golpe", sessionId: sess };
    const runs = await Promise.all([mutate("skiRental.settleDeposit", input), mutate("skiRental.settleDeposit", input)]);
    expect(runs.map((r) => r.status).sort()).toEqual([200, 500]);
    const done = ok(runs.find((r) => r.status === 200)!);
    expect(done.deposit).toMatchObject({ status: "retained_partial", retainedCents: 2000, refundedCents: 3000 });
    expect(await depSales(depId)).toBe(1);
    // Entrada 50 · salidas 30 devueltos + 20 aplicados a la venta: tres movimientos, ninguno repetido
    expect(await depMoves(d)).toBe(3);
    expect(ok(await mutate("skiRental.settleDeposit", input)).replayed).toBe(true);
    expect(await depSales(depId)).toBe(1);
  }, 60_000);

  it("liquidación: una venta de daños suelta de un intento anterior (fianza otra vez «cobrada») se reutiliza, sin otra venta", async () => {
    const { d, depId } = await newDeposit(4000);
    const sale = await strandedSale(`skidep-${depId}-r1500`, 15);
    const r = ok(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: depId, damageCents: 1500, reason: "Golpe", sessionId: sess }));
    expect(r.deposit).toMatchObject({ status: "retained_partial", damageSaleId: Number(sale.id), retainedCents: 1500 });
    expect(await depSales(depId)).toBe(1);
    expect(await depMoves(d)).toBe(3);
  }, 60_000);

  it("liquidación: la venta de daños se anuló en el TPV con la fianza «liquidándose»; el reintento cobra con otra clave y la cierra", async () => {
    const { d, depId } = await newDeposit(3000);
    // Liquidación reservada con su plan y su venta anulada después en el TPV, sin llegar a cerrarse
    await tenantDb.query(
      "UPDATE ski_deposits SET status = 'settling', damage_cents = 1000, refunded_cents = 2000, retained_cents = 1000, settle_session_id = ?, settle_reason = 'Golpe', settled_by = 'user:1' WHERE id = ?",
      [sess, depId],
    );
    const voided = await strandedSale(`skidep-${depId}-r1000`, 10);
    await tenantDb.query("UPDATE tpv_sales SET status_ts = 'cancelled' WHERE id = ?", [voided.id]);
    const r = ok(await mutate("skiRental.settleDeposit", { ...NORTE, depositId: depId, damageCents: 1000, reason: "Golpe", sessionId: sess }));
    expect(r.deposit).toMatchObject({ status: "retained_partial", retainedCents: 1000 });
    expect(r.deposit.damageSaleId).not.toBe(Number(voided.id));
    const [[k]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT idempotencyKey AS k, status_ts AS s FROM tpv_sales WHERE id = ?", [r.deposit.damageSaleId])) as unknown as [[any]];
    expect(k).toMatchObject({ k: `skidep-${depId}-r1000-2`, s: "paid" });
    expect(await depSales(depId)).toBe(1);
    expect(await depMoves(d)).toBe(3);
  }, 60_000);
});
