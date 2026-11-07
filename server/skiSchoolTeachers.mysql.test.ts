/**
 * Ski Net · Profesores con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): empresa aprovisionada
 * desde la baseline + `db/migrations` (incluida la de profesores), login real, licencias por capacidad del registro y
 * sedes de Elephant Control.
 *  - Pasar lista una sola vez (dos a la vez: una sale) y la sesión queda impartida.
 *  - Control de horas; cuatro cierres simultáneos de la misma liquidación dan uno; importes congelados; anular libera.
 *  - Portal del empleado: el usuario vinculado ve «Mis clases y horas» y no entra en la administración.
 *  - Solo lectura y migración revertida: errores tipados; la escuela sigue funcionando.
 * SKI_TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se fusionan las anteriores.
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
const T = `skip-${run}`;
const MIGRATIONS_DIR = process.env.SKI_TEST_MIGRATIONS_DIR ?? path.resolve(__dirname, "../db/migrations");
const PASS = "clave-ski-" + run;

describe.skipIf(!URL_)("Ski Net · Profesores (routers reales, licencia por capacidad)", () => {
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
      schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: MIGRATIONS_DIR }),
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
      await caps.apply(T, [{ capabilityId: "ski-school", siteId, status: status as never, validUntil: null, source: "operator" }], { actor: "operator:test", reason: "prueba", now: Date.now() + ++n });
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
  const MON = "2026-12-07";
  const TABLES = ["ski_school_attendance", "ski_school_instructor_profiles", "ski_school_session_closures", "ski_school_settlement_lines", "ski_school_settlements"];
  let ana = 0;
  let s1 = 0;
  let s2 = 0;

  /** Revierte o vuelve a aplicar la migración de profesores con las sentencias reales del carril y su registro. */
  async function teachersMigration(direction: "down" | "up") {
    const m = loadMigrations(MIGRATIONS_DIR).migrations.find((x) => x.id.endsWith("_ski_profesores"))!;
    for (const st of splitStatements(direction === "down" ? m.down! : m.up)) await tenantDb.query(st);
    if (direction === "down") await tenantDb.query("DELETE FROM __elephant_migrations WHERE id = ?", [m.id]);
    else await tenantDb.query("INSERT INTO __elephant_migrations (id, checksum) VALUES (?, ?)", [m.id, m.checksum]);
  }

  it("la migración de profesores creó sus tablas", async () => {
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'ski_school_%'");
    expect(rows.map((r) => Object.values(r)[0])).toEqual(expect.arrayContaining(TABLES));
  });

  it("sin licencia: error tipado; con licencia: escuela, sesiones con alumnos y pasar lista una sola vez", async () => {
    expect(fail(await query("skiSchool.hoursSummary", { ...NORTE, from: MON, to: MON })).message).toMatch(/^\[module_not_licensed\]/);
    await license("active", "pista-norte");
    ok(await mutate("skiSchool.activateSite", NORTE));
    ana = ok(await mutate("skiSchool.createInstructor", { ...NORTE, fullName: "Ana Ficticia" })).id;
    const p = ok(await mutate("skiSchool.createProduct", { ...NORTE, name: "Cursillo", kind: "group", durationMinutes: 120, capacity: 6 })).id;
    s1 = ok(await mutate("skiSchool.createSession", { ...NORTE, productId: p, date: MON, startTime: "09:00" })).id;
    s2 = ok(await mutate("skiSchool.createSession", { ...NORTE, productId: p, date: MON, startTime: "11:00", endTime: "12:30" })).id;
    for (const s of [s1, s2]) ok(await mutate("skiSchool.assignInstructor", { ...NORTE, sessionId: s, instructorId: ana }));
    const a = ok(await mutate("skiSchool.addParticipant", { ...NORTE, sessionId: s1, name: "Alumno A", age: 9 })).id;
    const entries = [{ participantId: a, status: "present" }];
    const both = await Promise.all([mutate("skiSchool.recordAttendance", { ...NORTE, sessionId: s1, entries }), mutate("skiSchool.recordAttendance", { ...NORTE, sessionId: s1, entries })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const [[st]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status FROM ski_school_sessions WHERE id = ?", [s1])) as unknown as [[any]];
    expect(st.status).toBe("completed");
    ok(await mutate("skiSchool.completeSession", { ...NORTE, sessionId: s2 }));
  });

  it("control de horas y liquidación: cierres simultáneos dan una sola, importes congelados, anular libera", async () => {
    ok(await mutate("skiSchool.updateTerms", { ...NORTE, instructorId: ana, payMode: "hourly", hourlyRateCents: 2000, requiredMinutesWeek: 1200 }));
    const [h] = ok(await query("skiSchool.hoursSummary", { ...NORTE, from: "2026-12-07", to: "2026-12-13" }));
    expect(h).toMatchObject({ scheduled: 210, taught: 210, requiredMinutes: 1200 });
    const preview = ok(await query("skiSchool.previewSettlement", { ...NORTE, instructorId: ana, from: "2026-12-01", to: "2026-12-31" }));
    expect(preview).toMatchObject({ totalCents: 7000, sessions: 2, overlapping: false });
    const results = await Promise.all(Array.from({ length: 4 }, () => mutate("skiSchool.closeSettlement", { ...NORTE, instructorId: ana, from: "2026-12-01", to: "2026-12-31" })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const closed = ok(results.find((r) => r.status === 200)!);
    ok(await mutate("skiSchool.updateTerms", { ...NORTE, instructorId: ana, payMode: "hourly", hourlyRateCents: 9900 }));
    expect(ok(await query("skiSchool.getSettlement", { ...NORTE, settlementId: closed.id })).totalCents).toBe(7000);
    const csv = ok(await query("skiSchool.exportSettlementCsv", { ...NORTE, settlementId: closed.id }));
    expect(csv.content).toContain("Total;;3,50;;70,00");
    ok(await mutate("skiSchool.voidSettlement", { ...NORTE, settlementId: closed.id, reason: "Tarifa equivocada" }));
    const again = ok(await mutate("skiSchool.closeSettlement", { ...NORTE, instructorId: ana, from: "2026-12-01", to: "2026-12-31" }));
    expect(again.totalCents).toBe(34650);
    const [[n]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM ski_school_settlement_lines WHERE open_session_id IS NOT NULL")) as unknown as [[any]];
    expect(Number(n.n)).toBe(2);
  });

  it("portal del empleado: «Mis clases y horas» del profesor vinculado a su usuario", async () => {
    const pass = "clave-profe-" + run;
    await tenantDb.query("INSERT INTO users (openId, name, email, loginMethod, role, isActive, inviteAccepted, passwordHash) VALUES (?, 'Ana', ?, 'local', 'employee', 1, 1, ?)", [`local_profe_${run}`, `ana@${T}.example`, await bcrypt.hash(pass, 4)]);
    ok(await mutate("skiSchool.linkUser", { ...NORTE, instructorId: ana, email: `ANA@${T}.example` }));
    const adminCookie = cookie;
    cookie = "";
    try {
      expect((await call("POST", "/api/auth/login", { email: `ana@${T}.example`, password: pass })).status).toBe(200);
      const mine = await query("skiSchool.myClasses");
      // Sus próximas clases dependen de la fecha real; aquí basta con que el portal responda con su ficha
      expect(ok(mine)).toMatchObject({ fullName: "Ana Ficticia", month: { scheduled: expect.any(Number) } });
      // Un empleado no entra en la administración de la escuela
      expect((await query("skiSchool.listInstructors", NORTE)).status).toBe(403);
    } finally {
      cookie = adminCookie;
    }
  });

  it("solo lectura y sin instalar (migración revertida): errores tipados; la escuela sigue; se vuelve a aplicar", async () => {
    await license("read_only", "pista-norte");
    expect(fail(await mutate("skiSchool.updateTerms", { ...NORTE, instructorId: ana, payMode: null })).message).toMatch(/^\[module_read_only\]/);
    await license("active", "pista-norte");
    await teachersMigration("down");
    expect(fail(await query("skiSchool.hoursSummary", { ...NORTE, from: MON, to: MON }))).toMatchObject({ status: 412, message: expect.stringMatching(/^\[module_not_installed\]/) });
    expect(ok(await query("skiSchool.listInstructors", NORTE))).toHaveLength(1);
    await teachersMigration("up");
    expect(ok(await query("skiSchool.listSettlements", NORTE))).toEqual([]);
  }, 60_000);
});
