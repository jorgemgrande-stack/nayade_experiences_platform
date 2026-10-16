/**
 * Sobreventa de spa y hotel con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): una
 * empresa aprovisionada desde la baseline + db/migrations, llamadas tRPC reales y notificaciones de Redsys
 * firmadas con una clave ficticia contra el endpoint real.
 *  - Concurrencia: N reservas simultáneas sobre la última plaza (spa) o la última habitación (hotel) → una.
 *  - Pago fallido, cancelación y caducidad liberan la plaza; un pago repetido no descuenta dos veces.
 *  - Un pago tardío sin sitio queda en conflicto (no sobrevende).
 *  - La reconciliación detecta y, solo si se pide, corrige.
 * Datos sintéticos (dominios .example). Sin correo ni integraciones externas: se retiran del entorno.
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
const T = `inv-${run}`;
const PASS = "clave-inventario-" + run;
// Clave de comercio ficticia de 24 bytes (no es una credencial real)
const FAKE_KEY_B64 = Buffer.from("clave-ficticia-24-bytes!").toString("base64");

function referenceSignature(base64Params: string, order: string): string {
  const key = Buffer.from(FAKE_KEY_B64, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(order) / 8) * 8, 0);
  Buffer.from(order).copy(padded);
  const cipher = crypto.createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  cipher.setAutoPadding(false);
  const derived = Buffer.concat([cipher.update(padded), cipher.final()]);
  return crypto.createHmac("sha256", derived).update(base64Params).digest("base64");
}

describe.skipIf(!URL_)("sobreventa de spa y hotel (routers reales)", () => {
  let admin: mysql.Pool;
  let tenantDb: mysql.Connection;
  let server: http.Server;
  let port: number;
  let cookie = "";
  let closeAll: () => Promise<void>;
  let inTenant: <R>(fn: () => Promise<R>) => Promise<R>;
  const host = `${T}.elephantsource.es`;
  let seq = 0;

  function request(method: string, p: string, body: string | undefined, contentType: string) {
    return new Promise<{ status: number; json: any; text: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: p, method, headers: { host, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": contentType, "content-length": Buffer.byteLength(body) } : {}) } },
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
            resolve({ status: res.statusCode ?? 0, json, text: b });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }
  const call = (method: string, p: string, body?: unknown) => request(method, p, body === undefined ? undefined : JSON.stringify(body), "application/json");
  const mutate = (proc: string, input: unknown) => call("POST", `/api/trpc/${proc}`, { json: input });
  const query = (proc: string, input: unknown) => call("GET", `/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const ok = (r: { status: number; json: any }) => {
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  };

  async function q<R = mysql.RowDataPacket>(s: string, params: unknown[] = []): Promise<R[]> {
    const [r] = await tenantDb.query(s, params);
    return r as R[];
  }

  async function spaFixture(capacity: number, date: string) {
    const n = ++seq;
    const [t] = await tenantDb.query<mysql.ResultSetHeader>(
      "INSERT INTO spa_treatments (slug, name, price, maxPersons, isActive) VALUES (?, 'Masaje de prueba', '50.00', 10, 1)", [`masaje-${run}-${n}`]);
    const [s] = await tenantDb.query<mysql.ResultSetHeader>(
      "INSERT INTO spa_slots (treatmentId, date, startTime, endTime, capacity, bookedCount, status) VALUES (?, ?, '10:00', '11:00', ?, 0, 'disponible')",
      [t.insertId, date, capacity]);
    return { treatmentId: t.insertId, slotId: s.insertId, date };
  }

  async function roomFixture(totalUnits: number) {
    const [r] = await tenantDb.query<mysql.ResultSetHeader>(
      "INSERT INTO room_types (slug, name, basePrice, totalUnits, maxAdults, isActive) VALUES (?, 'Habitación de prueba', '100.00', ?, 2, 1)",
      [`habitacion-${run}-${++seq}`, totalUnits]);
    return r.insertId;
  }

  const bookSpa = (f: { treatmentId: number; slotId: number; date: string }, persons: number, i: number) =>
    mutate("spa.createSpaBooking", {
      treatmentId: f.treatmentId, slotId: f.slotId, date: f.date, time: "10:00", persons,
      customerName: `Cliente ${i}`, customerEmail: `cliente${i}@prueba.example`, origin: "https://prueba.example",
    });

  const bookHotel = (roomTypeId: number, checkIn: string, checkOut: string, i: number) =>
    mutate("hotel.createHotelBooking", {
      roomTypeId, checkIn, checkOut, adults: 2, children: 0,
      customerName: `Huésped ${i}`, customerEmail: `huesped${i}@prueba.example`, origin: "https://prueba.example",
    });

  async function ipn(merchantOrder: string, response: "0000" | "0190") {
    const [[r]] = (await tenantDb.query("SELECT SUM(amount_total) AS a FROM reservations WHERE merchant_order = ?", [merchantOrder])) as unknown as [[{ a: string }]];
    const params = Buffer.from(JSON.stringify({ Ds_Order: merchantOrder, Ds_Response: response, Ds_Amount: String(Number(r.a)), Ds_AuthorisationCode: "999999" })).toString("base64");
    const body = new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: params, Ds_Signature: referenceSignature(params, merchantOrder) }).toString();
    const res = await request("POST", "/api/redsys/notification", body, "application/x-www-form-urlencoded");
    expect(res.text).toBe("OK");
  }

  const bookedCount = async (slotId: number) => Number((await q<{ c: number }>("SELECT bookedCount AS c FROM spa_slots WHERE id = ?", [slotId]))[0].c);
  const hold = async (merchantOrder: string) =>
    (await q<{ id: number; status: string; hold_status: string; hold_release_reason: string | null }>(
      "SELECT id, status, hold_status, hold_release_reason FROM reservations WHERE merchant_order = ?", [merchantOrder]))[0];

  async function waitFor(fn: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Tiempo agotado esperando: ${what}`);
  }

  beforeAll(async () => {
    // Ninguna integración externa ni correo real desde esta prueba
    for (const k of Object.keys(process.env)) {
      if (/BREVO|SMTP|GHL|META|CAPI|FORGE|VAPI|SLACK|TWILIO|WHATSAPP|OPENAI|LLM_|S3_|MINIO/i.test(k)) delete process.env[k];
    }
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
    // Cuenta de cobro ficticia (entorno de pruebas de Redsys) y módulos activos para esta empresa
    for (const [key, value] of [["redsys_merchant_key", FAKE_KEY_B64], ["redsys_merchant_code", "999008881"], ["redsys_environment", "test"], ["redsys_merchant_terminal", "1"]]) {
      await tenantDb.query("INSERT INTO system_settings (`key`, value, label) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value, key]);
    }
    for (const flag of ["spa_module_enabled", "hotel_module_enabled", "cancellations_module_enabled"]) {
      await tenantDb.query("INSERT INTO feature_flags (`key`, name, enabled) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE enabled = 1", [flag, flag]);
    }

    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { createLocalAuthRouter } = await import("./localAuth");
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const { appRouter } = await import("./routers");
    const { createLocalContext } = await import("./_core/context.local");
    const { closeAllDatabases, withTenantDb } = await import("./_core/dbRegistry");
    const { warmConfigCache } = await import("./config");
    const { warmIntegrationCreds } = await import("./_core/credentials/runtime");
    const redsysRouter = (await import("./redsysRoutes")).default;
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    const app = express();
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    // Igual que installTenantBinding: ajustes del tenant precargados (Redsys se lee de forma síncrona)
    app.use((_req, _res, next) => {
      Promise.all([warmConfigCache(), warmIntegrationCreds()]).then(() => next(), () => next());
    });
    app.use(createLocalAuthRouter());
    app.use(redsysRouter);
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext }));
    server = http.createServer(app);
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    port = (server.address() as AddressInfo).port;
    inTenant = (fn) => withTenantDb(T, fn);
    closeAll = async () => {
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
      await closeAllDatabases();
      await rt.close();
    };
    expect((await call("POST", "/api/auth/login", { email: `admin@${T}.example`, password: PASS })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    // Espera breve a que terminen los procesos en segundo plano de las notificaciones de Redsys
    await new Promise((r) => setTimeout(r, 500));
    await closeAll?.();
    await tenantDb?.end();
    // El contenedor de pruebas es desechable: la BD del tenant de prueba (id aleatorio) no se reutiliza
    await admin?.end();
  });

  it("spa: 8 reservas simultáneas sobre la última plaza → solo una gana", async () => {
    const f = await spaFixture(3, "2027-03-01");
    ok(await bookSpa(f, 2, 100));
    expect(await bookedCount(f.slotId)).toBe(2);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => bookSpa(f, 1, 101 + i)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(r.json.error.json.message).toMatch(/Solo quedan 0 plazas/);
    expect(await bookedCount(f.slotId)).toBe(3);
    const [live] = await q<{ n: number; u: string }>(
      "SELECT COUNT(*) AS n, SUM(inventory_units) AS u FROM reservations WHERE inventory_kind = 'spa_slot' AND inventory_ref_id = ? AND hold_status = 'retenida'", [f.slotId]);
    expect(Number(live.n)).toBe(2);
    expect(Number(live.u)).toBe(3);
    // Los intentos perdedores no dejan reservas huérfanas
    const [all] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM reservations WHERE inventory_ref_id = ? AND inventory_kind = 'spa_slot'", [f.slotId]);
    expect(Number(all.n)).toBe(2);
    // Y la franja ya no se ofrece
    expect(ok(await query("spa.getAvailableSlots", { treatmentId: f.treatmentId, date: f.date }))).toHaveLength(0);
  });

  it("hotel: 8 reservas simultáneas sobre la última habitación → solo una gana; otras fechas siguen libres", async () => {
    const room = await roomFixture(2);
    ok(await bookHotel(room, "2027-04-10", "2027-04-13", 200));
    // Todas incluyen la noche del 11, en la que solo queda una habitación
    const ranges = [["2027-04-09", "2027-04-12"], ["2027-04-11", "2027-04-14"], ["2027-04-10", "2027-04-13"], ["2027-04-11", "2027-04-12"]];
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => bookHotel(room, ranges[i % 4][0], ranges[i % 4][1], 201 + i)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(r.json.error.json.message).toMatch(/No quedan habitaciones/);
    // Ninguna noche con más de 2 habitaciones ocupadas
    const report = await inTenant(async () => (await import("./inventoryHoldsDb")).reconcileInventory({ kind: "hotel_room", now: Date.now() }));
    expect(report.hotelOverbooked.filter((o) => o.roomTypeId === room)).toEqual([]);
    // Buscador y calendario descuentan las reservas
    const search = ok(await query("hotel.searchAvailability", { checkIn: "2027-04-10", checkOut: "2027-04-13", adults: 2, children: 0 }));
    expect(search.find((s: any) => s.id === room).availableUnits).toBe(0);
    const cal = ok(await query("hotel.getRoomCalendar", { roomTypeId: room, year: 2027, month: 4 }));
    // La noche del 11 es la única que ocupan todas las estancias posibles (la ganadora es cualquiera de las 8)
    expect(cal.find((d: any) => d.date === "2027-04-11").available).toBe(0);
    expect(cal.find((d: any) => d.date === "2027-04-20").available).toBe(2);
    // Una estancia que no solapa sigue disponible
    ok(await bookHotel(room, "2027-04-13", "2027-04-15", 210));
  });

  it("pago fallido libera la plaza (spa y hotel) y la notificación repetida no libera dos veces", async () => {
    const f = await spaFixture(1, "2027-03-02");
    const a = ok(await bookSpa(f, 1, 300));
    expect(await bookedCount(f.slotId)).toBe(1);
    await ipn(a.merchantOrder, "0190");
    await waitFor(async () => (await hold(a.merchantOrder)).hold_status === "liberada", "liberación por pago fallido");
    expect(await hold(a.merchantOrder)).toMatchObject({ status: "failed", hold_status: "liberada", hold_release_reason: "pago_fallido" });
    expect(await bookedCount(f.slotId)).toBe(0);
    // La plaza vuelve a venderse; repetir la notificación fallida no la toca
    const b = ok(await bookSpa(f, 1, 301));
    await ipn(a.merchantOrder, "0190");
    await new Promise((r) => setTimeout(r, 400));
    expect(await bookedCount(f.slotId)).toBe(1);
    expect((await hold(b.merchantOrder)).hold_status).toBe("retenida");

    const room = await roomFixture(1);
    const h = ok(await bookHotel(room, "2027-05-01", "2027-05-03", 302));
    expect((await bookHotel(room, "2027-05-02", "2027-05-04", 303)).status).toBe(400);
    await ipn(h.merchantOrder, "0190");
    await waitFor(async () => (await hold(h.merchantOrder)).hold_status === "liberada", "liberación hotel");
    ok(await bookHotel(room, "2027-05-02", "2027-05-04", 304));
  });

  it("pago confirmado: la retención pasa a confirmada sin mover el contador; IPN repetida idempotente", async () => {
    const f = await spaFixture(2, "2027-03-03");
    const a = ok(await bookSpa(f, 2, 400));
    await ipn(a.merchantOrder, "0000");
    await waitFor(async () => (await hold(a.merchantOrder)).hold_status === "confirmada", "confirmación");
    expect(await bookedCount(f.slotId)).toBe(2);
    await ipn(a.merchantOrder, "0000");
    await ipn(a.merchantOrder, "0000");
    const again = await inTenant(async () => (await import("./inventoryHoldsDb")).applyPaymentToInventoryHolds(a.merchantOrder, true));
    expect(again).toEqual({ confirmed: 0, conflicts: 0, released: 0 });
    await new Promise((r) => setTimeout(r, 400));
    expect(await bookedCount(f.slotId)).toBe(2);
    expect((await hold(a.merchantOrder)).status).toBe("paid");
    // Una notificación fallida posterior (fuera de orden) no libera una plaza pagada
    await ipn(a.merchantOrder, "0190");
    await new Promise((r) => setTimeout(r, 400));
    expect((await hold(a.merchantOrder)).hold_status).toBe("confirmada");
    expect(await bookedCount(f.slotId)).toBe(2);
  });

  it("cancelación libera la plaza de una reserva pagada; repetirla no libera dos veces", async () => {
    const f = await spaFixture(1, "2027-03-04");
    const a = ok(await bookSpa(f, 1, 500));
    await ipn(a.merchantOrder, "0000");
    await waitFor(async () => (await hold(a.merchantOrder)).hold_status === "confirmada", "confirmación");
    ok(await mutate("cancellations.cancelReservationDirect", { reservationId: a.reservationId, reason: "desistimiento", compensationType: "ninguna" }));
    expect(await hold(a.merchantOrder)).toMatchObject({ status: "cancelled", hold_status: "liberada", hold_release_reason: "cancelada" });
    expect(await bookedCount(f.slotId)).toBe(0);
    const twice = await inTenant(async () => (await import("./inventoryHoldsDb")).releaseInventoryHold(a.reservationId, "cancelada"));
    expect(twice).toBe(false);
    expect(await bookedCount(f.slotId)).toBe(0);
    ok(await bookSpa(f, 1, 501));
    expect(await bookedCount(f.slotId)).toBe(1);
  });

  it("caducidad: la retención vencida deja de ocupar, se libera al reservar y el pago tardío queda en conflicto", async () => {
    const f = await spaFixture(1, "2027-03-05");
    const a = ok(await bookSpa(f, 1, 600));
    expect(ok(await query("spa.getAvailableSlots", { treatmentId: f.treatmentId, date: f.date }))).toHaveLength(0);
    await tenantDb.query("UPDATE reservations SET hold_expires_at = ? WHERE merchant_order = ?", [Date.now() - 1000, a.merchantOrder]);
    // La disponibilidad pública ya no la cuenta y la siguiente reserva la libera en su transacción
    expect(ok(await query("spa.getAvailableSlots", { treatmentId: f.treatmentId, date: f.date }))).toHaveLength(1);
    const b = ok(await bookSpa(f, 1, 601));
    expect(await hold(a.merchantOrder)).toMatchObject({ status: "pending_payment", hold_status: "liberada", hold_release_reason: "caducada" });
    expect(await bookedCount(f.slotId)).toBe(1);
    // El cliente A paga tarde: la plaza ya es de B → conflicto, sin sobreventa
    await ipn(a.merchantOrder, "0000");
    await waitFor(async () => (await hold(a.merchantOrder)).hold_status === "conflicto", "conflicto");
    expect(await bookedCount(f.slotId)).toBe(1);
    expect((await hold(b.merchantOrder)).hold_status).toBe("retenida");

    // Hotel: la tarea de sincronización libera la retención caducada y la habitación vuelve a venderse
    const room = await roomFixture(1);
    const h = ok(await bookHotel(room, "2027-06-01", "2027-06-02", 602));
    await tenantDb.query("UPDATE reservations SET hold_expires_at = ? WHERE merchant_order = ?", [Date.now() - 1000, h.merchantOrder]);
    const s = await inTenant(async () => (await import("./inventoryHoldsDb")).syncInventoryHolds());
    expect(s.expired).toBeGreaterThanOrEqual(1);
    expect(await hold(h.merchantOrder)).toMatchObject({ hold_status: "liberada", hold_release_reason: "caducada" });
    ok(await bookHotel(room, "2027-06-01", "2027-06-02", 603));
  });

  it("reconciliación: informa sin tocar nada por defecto y corrige solo con apply", async () => {
    const f = await spaFixture(4, "2027-03-06");
    ok(await bookSpa(f, 1, 700));
    const c = ok(await bookSpa(f, 1, 701));
    // Desajustes: contador corrompido y una reserva anulada por una vía que no libera la plaza
    await tenantDb.query("UPDATE spa_slots SET bookedCount = 4 WHERE id = ?", [f.slotId]);
    const [cr] = await q<{ reservation_number: string }>("SELECT reservation_number FROM reservations WHERE merchant_order = ?", [c.merchantOrder]);
    ok(await mutate("cancellations.batchCancelDirect", { reservationNumbers: [cr.reservation_number] }));

    const report = ok(await mutate("spa.adminReconcileInventory", {}));
    expect(report.applied).toBe(false);
    expect(report.spaDrift).toContainEqual({ slotId: f.slotId, bookedCount: 4, expected: 2, capacity: 4 });
    expect(report.pendingActions.release).toBeGreaterThanOrEqual(1);
    expect(await bookedCount(f.slotId)).toBe(4);
    expect((await hold(c.merchantOrder)).hold_status).toBe("retenida");
    // El resto de franjas de las pruebas anteriores cuadra
    expect(report.spaDrift.filter((d: any) => d.slotId !== f.slotId)).toEqual([]);
    expect(report.conflicts.length).toBeGreaterThanOrEqual(1);

    const fixed = ok(await mutate("spa.adminReconcileInventory", { apply: true }));
    expect(fixed.applied).toBe(true);
    expect(fixed.fixed.spaSlots).toBeGreaterThanOrEqual(1);
    expect(await bookedCount(f.slotId)).toBe(1);
    expect(await hold(c.merchantOrder)).toMatchObject({ hold_status: "liberada", hold_release_reason: "cancelada" });
    const clean = ok(await mutate("spa.adminReconcileInventory", {}));
    expect(clean.spaDrift).toEqual([]);
    expect(clean.pendingActions).toEqual({ release: 0, confirm: 0 });
  });

  it("reconciliación del hotel: detecta noches sobrevendidas (datos heredados) sin inventar correcciones", async () => {
    const room = await roomFixture(1);
    const a = ok(await bookHotel(room, "2027-07-01", "2027-07-03", 800));
    const b = ok(await bookHotel(room, "2027-07-03", "2027-07-04", 801));
    // Simula una sobreventa previa: la segunda reserva movida encima de la primera
    await tenantDb.query("UPDATE reservations SET stay_check_in = '2027-07-02', stay_check_out = '2027-07-03' WHERE merchant_order = ?", [b.merchantOrder]);
    const report = ok(await mutate("hotel.adminReconcileInventory", {}));
    expect(report.hotelOverbooked).toContainEqual({ roomTypeId: room, date: "2027-07-02", occupied: 2, capacity: 1 });
    expect((await hold(a.merchantOrder)).hold_status).toBe("retenida");
  });
});
