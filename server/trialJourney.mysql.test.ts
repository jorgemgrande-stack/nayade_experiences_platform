/**
 * Recorrido completo de la prueba gratuita de Essential por HTTP con MySQL real (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos servidores reales: el plano de control (registro, verificación,
 * aprovisionamiento REAL de la BD de la empresa, suscripción, licencias, vencimiento y conversión) y la
 * aplicación multiempresa (login del propietario en su host, «Primeros pasos», límites del plan y solo
 * lectura con CAPABILITY_ENFORCEMENT=on). Correos: buzones en memoria (no se envía nada real).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3414/registry_test \
 *     pnpm vitest run server/trialJourney.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";

// Correos de la aplicación (invitaciones y recuperación de contraseña): a un buzón en memoria
const appMail = vi.hoisted(() => [] as Array<{ to: string | string[]; subject: string; html: string; text?: string }>);
vi.mock("./mailer", async (orig) => ({
  ...(await orig<typeof import("./mailer")>()),
  sendEmail: async (p: { to: string | string[]; subject: string; html: string; text?: string }) => {
    appMail.push(p);
    return true;
  },
}));

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const REG_DB = `onb_reg_${run}`;
const CRM_DB = `onb_crm_${run}`;
const PLATFORM = "elephant.test";
const ADMIN = "trial-journey-admin-token-aaaaaaaaaaaaaa";
const DAY = 86_400_000;
const OWNER = `propietaria-${run}@ferreteria.example`;
const COMPANY = `Ferretería Prueba ${run}`;
const PASS = `clave-propietaria-${run}`;

type Res = { status: number; json: any; raw: string; cookie?: string };

describe.skipIf(!URL_)("prueba gratuita de Essential de punta a punta (MySQL real)", () => {
  let admin: mysql.Pool;
  let regPool: mysql.Pool;
  let crmPool: mysql.Pool;
  let cp: http.Server;
  let app: http.Server;
  let cpPort = 0;
  let appPort = 0;
  let clock = Date.now();
  let failBranding = 0;
  let closeApp: () => Promise<void> = async () => undefined;
  let dropTenant: (id: string) => Promise<void> = async () => undefined;
  const tenants: string[] = [];
  let trialOutbox: Array<{ to: string; subject: string; text: string; tag: string }> = [];

  function request(port: number, method: string, p: string, o: { host?: string; token?: string; cookie?: string; body?: unknown } = {}) {
    return new Promise<Res>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: p,
          method,
          headers: {
            ...(o.host ? { host: o.host } : {}),
            ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
            ...(o.cookie ? { cookie: o.cookie } : {}),
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
            resolve({ status: res.statusCode ?? 0, json, raw: b, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }
  const cpCall = (method: string, p: string, o: { token?: string; body?: unknown } = {}) => request(cpPort, method, `/cp/v1${p}`, o);
  const hostOf = (tenantId: string) => `${tenantId}.${PLATFORM}`;
  const q = (tenantId: string, proc: string, input: unknown, cookie?: string) =>
    request(appPort, "GET", `/api/trpc/${proc}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`, { host: hostOf(tenantId), cookie });
  const m = (tenantId: string, proc: string, input: unknown, cookie?: string) => request(appPort, "POST", `/api/trpc/${proc}`, { host: hostOf(tenantId), cookie, body: { json: input } });
  const data = (r: Res) => r.json?.result?.data?.json;
  const linkOf = (text: string, re: RegExp) => {
    const u = new URL(text.match(re)![0]);
    return u;
  };
  const verificationLink = (to: string) => {
    const mail = trialOutbox.filter((x) => x.tag === "trial_verification" && x.to === to).at(-1)!;
    const u = linkOf(mail.text, /https:\/\/web\.example\/prueba\/verificar\?\S+/);
    return { id: Number(u.searchParams.get("id")), token: u.searchParams.get("token")! };
  };
  const welcomeLink = (to: string) => {
    const mail = trialOutbox.filter((x) => x.tag === "trial_welcome" && x.to === to).at(-1);
    if (!mail) return null;
    const u = linkOf(mail.text, /https:\/\/\S+\/establecer-contrasena\?token=\S+/);
    return { host: u.host, token: u.searchParams.get("token")! };
  };
  const tenantConn = async (tenantId: string) => {
    const u = new URL(URL_!);
    u.pathname = `/es_${tenantId.replace(/-/g, "_")}`;
    return mysql.createConnection({ uri: u.toString() });
  };
  async function ownerLogin(tenantId: string, email: string, password: string) {
    const link = welcomeLink(email)!;
    expect(link.host).toBe(hostOf(tenantId));
    const set = await m(tenantId, "public.setPassword", { token: link.token, password });
    expect(set.status).toBe(200);
    const login = await request(appPort, "POST", "/api/auth/login", { host: hostOf(tenantId), body: { email, password } });
    expect(login.status).toBe(200);
    return login.cookie!;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    const at = (db: string) => {
      const x = new URL(URL_!);
      x.pathname = `/${db}`;
      return x.toString();
    };
    process.env.TENANT_MODE = "multi";
    process.env.CAPABILITY_ENFORCEMENT = "on";
    process.env.REGISTRY_DATABASE_URL = at(REG_DB);
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
    process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run + "-0000000000000000";
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";

    admin = mysql.createPool({ uri: URL_!, connectionLimit: 4 });
    for (const db of [REG_DB, CRM_DB]) {
      await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
      await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4`);
    }
    regPool = mysql.createPool({ uri: at(REG_DB), connectionLimit: 10, multipleStatements: true });
    crmPool = mysql.createPool({ uri: at(CRM_DB), connectionLimit: 10 });

    // Registro de tenants (migrador real) y BD comercial (CRM + catálogo + suscripciones + pruebas)
    const { migrateRegistry } = await import("./_core/tenantRegistry/migrate");
    await migrateRegistry(regPool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    const { loadMigrations, splitStatements } = await import("../scripts/db/migrationLib");
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await crmPool.query(s);
    for (const mig of loadMigrations(path.resolve(__dirname, "../db/crm/migrations")).migrations) for (const s of splitStatements(mig.up)) await crmPool.query(s);

    // ── Plano de control ─────────────────────────────────────────────────────
    const { MysqlTenantRegistryStore } = await import("./_core/tenantRegistry/mysqlStore");
    const { TenantRegistryService } = await import("./_core/tenantRegistry/service");
    const { keyringFromEnv } = await import("./_core/tenantRegistry/crypto");
    const { ProvisioningService } = await import("./_core/provisioning/service");
    const prov = await import("./_core/provisioning/mysqlAdapters");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const { QuotaAdmin } = await import("./_core/erm/mysqlQuotas");
    const { MysqlCapabilityStore } = await import("./_core/capabilities/store");
    const { createControlPlaneApp } = await import("./controlPlane/api");
    const { hashToken } = await import("./controlPlane/auth");
    const { CrmService } = await import("./crm/service");
    const { MysqlCrmStore } = await import("./crm/mysqlStore");
    const { WebAdminService } = await import("./web/service");
    const { MysqlWebStore } = await import("./web/store");
    const { MysqlSubscriptionStore } = await import("./subscriptions/store");
    const { MysqlTrialStore } = await import("./trials/store");
    const { createEmailTrialNotifier, memoryEmailPort } = await import("./trials/emailNotifier");
    const { seedElephantSource } = await import("./catalog/seed");
    const { BUILTIN_MODULES } = await import("./_core/modules/builtin");

    const store = new MysqlTenantRegistryStore(regPool);
    const ring = keyringFromEnv(process.env);
    const registry = new TenantRegistryService(store, () => ring);
    const databases = new prov.MysqlDatabaseProvisioner(regPool, { host: u.hostname, port: Number(u.port || 3306), alias: "test-server", userHost: "%" });
    const seeder = new prov.MysqlTenantSeeder();
    const flakySeeder = Object.assign(Object.create(Object.getPrototypeOf(seeder)), seeder, {
      // Fallo simulado DESPUÉS de crear al administrador: la invitación de esa ejecución se pierde
      seedBranding: async (dsn: string, s: Record<string, string>) => {
        if (failBranding > 0) {
          failBranding--;
          throw new Error("servidor de BD no disponible");
        }
        return seeder.seedBranding(dsn, s);
      },
    });
    const provisioning = new ProvisioningService({
      registry,
      reader: store,
      databases,
      schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
      seeder: flakySeeder,
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      store: new prov.MysqlProvisioningStore(regPool),
      maxAttemptsPerStep: 1,
      sleep: async () => undefined,
    });
    dropTenant = (id) => databases.dropDatabase(id);
    const webStore = new MysqlWebStore(crmPool);
    await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((x) => x.id), planIds: () => null }, now: () => clock }), webStore);
    const crmStore = new MysqlCrmStore(crmPool);
    const port = memoryEmailPort();
    trialOutbox = port.sent as typeof trialOutbox;
    const cpApp = createControlPlaneApp({
      tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: ["tenants:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write"] }],
      registry,
      reader: store,
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      platformTarget: "edge.example.com",
      provisioning,
      platformDomain: PLATFORM,
      crm: { service: new CrmService({ store: crmStore }), store: crmStore },
      web: { store: webStore },
      subscriptions: { store: new MysqlSubscriptionStore(crmPool), now: () => clock },
      capabilities: new MysqlCapabilityStore(regPool),
      trials: {
        store: new MysqlTrialStore(crmPool),
        publicEnabled: true,
        autoProvision: true,
        limits: { perIp24h: 100, concurrentProvisioning: 10 },
        notify: createEmailTrialNotifier({ mode: "live", port, verifyUrl: "https://web.example/prueba/verificar", pricingUrl: "https://web.example/precios", log: () => undefined }),
      },
    });
    cp = http.createServer(cpApp);
    await new Promise<void>((r) => cp.listen(0, "127.0.0.1", r));
    cpPort = (cp.address() as AddressInfo).port;

    // ── Aplicación multiempresa (la misma composición que el arranque real) ──
    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { createLocalAuthRouter } = await import("./localAuth");
    const { createPasswordResetRouter } = await import("./passwordReset");
    const { createAuthGuardMiddleware } = await import("./authGuard");
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const { appRouter } = await import("./routers");
    const { createLocalContext } = await import("./_core/context.local");
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    const { configureModuleAccess, getModuleAccess } = await import("./_core/modules/runtime");
    const { registerBuiltinModules } = await import("./_core/modules/builtin");
    const { moduleRouteGuard } = await import("./_core/modules/routeGuard");
    const { configureCapabilityAccess, getCapabilityAccess } = await import("./_core/capabilities/access");
    const { capabilityRouteGuard } = await import("./_core/capabilities/routeGuard");
    const { configureTenantIdentity } = await import("./_core/tenantIdentity");
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    registerBuiltinModules();
    configureModuleAccess(rt.entitlements);
    configureTenantIdentity(rt.identity);
    // Sin caché y con el reloj de la prueba: el vencimiento se simula sin esperar 15 días
    configureCapabilityAccess(rt.capabilities, { now: () => clock, ttlMs: 0 });
    const a = express();
    a.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    a.use(express.json());
    a.use(bindTenantMiddleware());
    // Como installTenantBinding: ajustes, credenciales e identidad del tenant precargados
    const { warmConfigCache } = await import("./config");
    const { warmIntegrationCreds } = await import("./_core/credentials/runtime");
    const { warmTenantIdentity } = await import("./_core/tenantIdentity");
    a.use((_req, _res, next) => void Promise.all([warmConfigCache(), warmIntegrationCreds(), warmTenantIdentity()]).then(() => next(), () => next()));
    a.use(createLocalAuthRouter());
    a.use(createPasswordResetRouter());
    a.use("/api/trpc", moduleRouteGuard(getModuleAccess));
    a.use("/api/trpc", capabilityRouteGuard(getCapabilityAccess));
    a.use("/api/trpc", createAuthGuardMiddleware(true));
    a.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext }));
    app = http.createServer(a);
    await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
    appPort = (app.address() as AddressInfo).port;
    closeApp = async () => {
      app.closeAllConnections();
      await new Promise<void>((r) => app.close(() => r()));
      await closeAllDatabases();
      await rt.close();
    };
  }, 120_000);

  afterAll(async () => {
    await closeApp().catch(() => undefined);
    if (cp) {
      cp.closeAllConnections();
      await new Promise<void>((r) => cp.close(() => r()));
    }
    for (const t of tenants) await dropTenant(t).catch(() => undefined);
    await regPool?.end();
    await crmPool?.end();
    for (const db of [REG_DB, CRM_DB]) await admin?.query(`DROP DATABASE IF EXISTS \`${db}\``).catch(() => undefined);
    await admin?.end();
    delete process.env.TENANT_MODE;
    delete process.env.CAPABILITY_ENFORCEMENT;
  });

  let trialId = 0;
  let tenantId = "";
  let cookie = "";

  it("registro: respuesta genérica, enlace de verificación solo por correo", async () => {
    const r = await cpCall("POST", "/public/trial", { body: { email: OWNER, companyName: COMPANY, idempotencyKey: crypto.randomBytes(12).toString("hex") } });
    expect(r.status).toBe(202);
    expect(r.raw).not.toMatch(/token/i);
    const link = verificationLink(OWNER);
    expect(link.token.length).toBeGreaterThan(20);
    trialId = link.id;
    const bad = await cpCall("POST", "/public/trial/verify", { body: { id: trialId, token: "x".repeat(43) } });
    expect(bad.status).toBe(403);
  });

  it("verificación con fallo del aprovisionamiento: nada a medias visible, reintento idempotente y acceso del propietario recuperado", async () => {
    failBranding = 1;
    const v = await cpCall("POST", "/public/trial/verify", { body: verificationLink(OWNER) });
    expect(v.status).toBe(202);
    expect(v.json).toMatchObject({ state: "verified", activationPending: true });
    expect(v.raw).not.toMatch(/servidor de BD/);
    expect(trialOutbox.some((x) => x.tag === "trial_welcome")).toBe(false);

    const retry = await cpCall("POST", `/trials/${trialId}/activate`, { token: ADMIN });
    expect(retry.status).toBe(200);
    expect(retry.json.trial.state).toBe("active");
    tenantId = retry.json.tenantId;
    tenants.push(tenantId);
    expect(retry.json.trial.endsAt).toBe(clock + 15 * DAY);
    // Una sola BD para el tenant, sin restos de la ejecución fallida
    const [dbs] = await regPool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM tenant_databases WHERE tenant_id = ?", [tenantId]);
    expect(Number(dbs[0].n)).toBe(1);
    // El correo de bienvenida lleva una invitación válida aunque la original se perdiera
    expect(welcomeLink(OWNER)?.host).toBe(hostOf(tenantId));
  }, 240_000);

  it("empresa nueva sin datos heredados: solo su propietaria (administradora)", async () => {
    const c = await tenantConn(tenantId);
    try {
      const [u] = await c.query<mysql.RowDataPacket[]>("SELECT email, role, inviteAccepted FROM users");
      expect(u).toEqual([{ email: OWNER, role: "admin", inviteAccepted: 0 }]);
      for (const t of ["clients", "experiences", "quotes", "reservations", "invoices", "leads"]) {
        const [n] = await c.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
        expect([t, Number(n[0].n)]).toEqual([t, 0]);
      }
    } finally {
      await c.end();
    }
  });

  it("la propietaria define su contraseña con la invitación y entra en SU host con sesión válida", async () => {
    const token = welcomeLink(OWNER)!.token;
    cookie = await ownerLogin(tenantId, OWNER, PASS);
    const me = await q(tenantId, "auth.me", undefined, cookie);
    expect(data(me)).toMatchObject({ email: OWNER, role: "admin" });
    // La invitación ya no sirve otra vez
    expect((await m(tenantId, "public.setPassword", { token, password: "otra-clave-123" })).status).toBe(404);
    // Reenviar el acceso ya no emite invitación: tiene contraseña
    expect((await cpCall("POST", `/trials/${trialId}/resend-access`, { token: ADMIN })).json).toEqual({ sent: false, reason: "already_accepted" });
    // Recuperación de contraseña: correo por el puerto de la aplicación (memoria)
    const forgot = await request(appPort, "POST", "/api/auth/forgot-password", { host: hostOf(tenantId), body: { email: OWNER } });
    expect(forgot.status).toBe(200);
    const reset = appMail.find((x) => x.to === OWNER && /contraseña/i.test(x.subject));
    const resetUrl = reset?.html.match(/https?:\/\/[^"'\s<]+(nueva-contrasena|reset)[^"'\s<]*/)?.[0];
    expect(resetUrl).toContain(`${hostOf(tenantId)}`);
  });

  it("Primeros pasos: estado de la prueba, empresa, actividad, cliente, producto y progreso guardado", async () => {
    const st = data(await q(tenantId, "setupWizard.status", undefined, cookie));
    expect(st.licence).toMatchObject({ plan: "essential", userLimit: 3, daysLeft: 15, readOnly: false });
    expect(st.seats).toEqual({ used: 1, limit: 3 });
    expect(st.nextStep).toBe("company");

    const bad = await m(tenantId, "setupWizard.saveCompany", { tradeName: "", legalName: "x", taxId: "1", address: "", country: "XX", currency: "EUR", timezone: "Europe/Madrid" }, cookie);
    expect(bad.status).toBe(400);
    const company = { tradeName: "Ferretería Sol", legalName: "Ferretería Sol, S.L.", taxId: "B12345678", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "ES", currency: "EUR", timezone: "Europe/Madrid" };
    expect((await m(tenantId, "setupWizard.saveCompany", company, cookie)).status).toBe(200);
    expect((await m(tenantId, "setupWizard.saveActivity", { activity: "comercio" }, cookie)).status).toBe(200);

    // Primer cliente y primer producto con los procedimientos existentes
    expect((await m(tenantId, "crm.clients.create", { name: "Cliente Uno", email: "cliente@uno.example" }, cookie)).status).toBe(200);
    expect((await m(tenantId, "setupWizard.setStep", { step: "client", status: "done" }, cookie)).status).toBe(200);
    const cat = data(await m(tenantId, "products.createCategory", { slug: "general", name: "General" }, cookie));
    const loc = data(await m(tenantId, "products.createLocation", { slug: "principal", name: "Principal" }, cookie));
    const prod = await m(tenantId, "products.create", { slug: "martillo", title: "Martillo", categoryId: cat.id, locationId: loc.id, basePrice: "12.50", taxRate: "21", pricingType: "per_unit" }, cookie);
    expect(prod.status).toBe(200);
    expect((await m(tenantId, "setupWizard.setStep", { step: "product", status: "done" }, cookie)).status).toBe(200);
    // Primera operación: borrador de presupuesto con el primer cliente y producto (sin enviar)
    const quote = await m(tenantId, "crm.quotes.createDirect", { clientName: "Cliente Uno", clientEmail: "cliente@uno.example", title: "Presupuesto para Cliente Uno", items: [{ description: "Martillo", quantity: 1, unitPrice: 12.5, total: 12.5, taxRate: 21 }], subtotal: 12.5, taxRate: 21, total: 15.13, sendNow: false }, cookie);
    expect(quote.status).toBe(200);
    expect(data(quote)).toMatchObject({ success: true, sent: false });
    expect(appMail.some((x) => x.to === "cliente@uno.example")).toBe(false);
    expect((await m(tenantId, "setupWizard.setStep", { step: "operation", status: "done" }, cookie)).status).toBe(200);
    expect((await m(tenantId, "setupWizard.setStep", { step: "finish", status: "skipped" }, cookie)).status).toBe(400);

    // Continuar más tarde: otra sesión ve el mismo progreso y los datos guardados en sus ajustes
    const again = data(await q(tenantId, "setupWizard.status", undefined, cookie));
    expect(again.nextStep).toBe("users");
    expect(again.company).toMatchObject({ tradeName: "Ferretería Sol", legalName: "Ferretería Sol, S.L.", taxId: "B12345678", currency: "EUR", timezone: "Europe/Madrid", country: "ES" });
    expect(again.activity).toBe("comercio");
    const c = await tenantConn(tenantId);
    try {
      const [s] = await c.query<mysql.RowDataPacket[]>("SELECT `key`, value FROM system_settings WHERE `key` IN ('brand_name','brand_nif','site_legal_name')");
      expect(Object.fromEntries(s.map((r) => [r.key, r.value]))).toEqual({ brand_name: "Ferretería Sol", brand_nif: "B12345678", site_legal_name: "Ferretería Sol, S.L." });
      const [e] = await c.query<mysql.RowDataPacket[]>("SELECT title, basePrice, taxRate FROM experiences");
      expect(e).toHaveLength(1);
      expect(Number(e[0].taxRate)).toBe(21);
    } finally {
      await c.end();
    }
  });

  it("usuarios: invitaciones hasta el límite de Essential (3) comprobado en el servidor", async () => {
    for (const n of [1, 2]) {
      const r = await m(tenantId, "admin.createUser", { name: `Empleado ${n}`, email: `empleado${n}-${run}@ferreteria.example`, role: "user" }, cookie);
      expect(r.status).toBe(200);
      expect(appMail.some((x) => x.to === `empleado${n}-${run}@ferreteria.example`)).toBe(true);
    }
    const over = await m(tenantId, "admin.createUser", { name: "Empleado 3", email: `empleado3-${run}@ferreteria.example`, role: "user" }, cookie);
    expect(over.status).toBe(403);
    expect(over.raw).toMatch(/Essential incluye 3 usuarios/);
    expect(appMail.some((x) => x.to === `empleado3-${run}@ferreteria.example`)).toBe(false);
    // Desactivar libera una plaza; reactivar la vuelve a ocupar (y sin plaza se rechaza)
    const users = data(await q(tenantId, "admin.getUsers", undefined, cookie)) as Array<{ id: number; email: string }>;
    const e1 = users.find((x) => x.email.startsWith("empleado1"))!;
    expect((await m(tenantId, "admin.toggleUserActive", { userId: e1.id }, cookie)).status).toBe(200);
    expect((await m(tenantId, "admin.createUser", { name: "Empleado 3", email: `empleado3-${run}@ferreteria.example`, role: "user" }, cookie)).status).toBe(200);
    expect((await m(tenantId, "admin.toggleUserActive", { userId: e1.id }, cookie)).status).toBe(403);
    expect(data(await q(tenantId, "setupWizard.seats", undefined, cookie))).toMatchObject({ used: 3, limit: 3, available: 0, plan: "essential" });
  });

  let otherTenant = "";
  it("registros simultáneos: mismo correo → una sola prueba; misma empresa con dos correos → dos plataformas distintas", async () => {
    const same = await Promise.all(
      Array.from({ length: 5 }, () => cpCall("POST", "/public/trial", { body: { email: `carrera-${run}@taller.example`, companyName: "Taller Carrera", idempotencyKey: crypto.randomBytes(12).toString("hex") } })),
    );
    expect(same.every((r) => r.status === 202)).toBe(true);
    const [n] = await crmPool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM trial_requests WHERE email = ?", [`carrera-${run}@taller.example`]);
    expect(Number(n[0].n)).toBe(1);
    expect(trialOutbox.filter((x) => x.tag === "trial_verification" && x.to === `carrera-${run}@taller.example`)).toHaveLength(1);

    const emails = [`ana-${run}@gemelas.example`, `eva-${run}@gemelas2.example`];
    await Promise.all(emails.map((email) => cpCall("POST", "/public/trial", { body: { email, companyName: `Empresa Gemela ${run}`, idempotencyKey: crypto.randomBytes(12).toString("hex") } })));
    const a = verificationLink(emails[0]);
    const b = verificationLink(emails[1]);
    // Verificación doble y simultánea del mismo enlace (doble clic) + la otra empresa a la vez
    const [a1, a2, b1] = await Promise.all([
      cpCall("POST", "/public/trial/verify", { body: a }),
      cpCall("POST", "/public/trial/verify", { body: a }),
      cpCall("POST", "/public/trial/verify", { body: b }),
    ]);
    // Una activa la prueba; la otra recibe el estado en curso (carrera) o el enlace ya usado
    const [win, lose] = a1.status === 200 ? [a1, a2] : [a2, a1];
    expect(win.status).toBe(200);
    expect([202, 403]).toContain(lose.status);
    expect(lose.raw).not.toMatch(/recarga|version/i);
    expect(b1.status).toBe(200);
    const ta = win.json.domain as string;
    const tb = b1.json.domain as string;
    expect(ta).not.toBe(tb);
    const [ida, idb] = [ta.split(".")[0], tb.split(".")[0]];
    tenants.push(ida, idb);
    otherTenant = ida;
    for (const id of [ida, idb]) {
      const [dbs] = await regPool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM tenant_databases WHERE tenant_id = ?", [id]);
      expect(Number(dbs[0].n)).toBe(1);
    }
    // Dos empresas en el CRM aunque se llamen igual (la segunda, distinguida por su plataforma)
    const [cos] = await crmPool.query<mysql.RowDataPacket[]>("SELECT name, tenant_id FROM crm_companies WHERE tenant_id IN (?, ?)", [ida, idb]);
    expect(cos).toHaveLength(2);
    expect(cos.some((c) => c.name === `Empresa Gemela ${run}`)).toBe(true);
    // Una bienvenida por empresa, sin duplicados
    expect(trialOutbox.filter((x) => x.tag === "trial_welcome" && x.to === emails[0])).toHaveLength(1);
  }, 300_000);

  it("progreso aislado por empresa: la otra empresa empieza de cero y no ve nada de la primera", async () => {
    const other = await ownerLogin(otherTenant, `ana-${run}@gemelas.example`, PASS);
    const st = data(await q(otherTenant, "setupWizard.status", undefined, other));
    expect(st.nextStep).toBe("company");
    expect(st.percent).toBe(0);
    expect(st.company.taxId).toBe("");
    expect(st.seats.used).toBe(1);
    expect(data(await q(otherTenant, "crm.clients.list", { limit: 10, offset: 0 }, other)).total).toBe(0);
    // La sesión de la primera empresa no sirve en la otra
    expect((await q(otherTenant, "setupWizard.status", undefined, cookie)).status).toBeGreaterThanOrEqual(401);
    // Avanzar aquí no cambia el progreso de la primera
    await m(otherTenant, "setupWizard.setStep", { step: "client", status: "skipped" }, other);
    expect(data(await q(tenantId, "setupWizard.status", undefined, cookie)).nextStep).toBe("users");
  });

  it("avisos de vencimiento por el puerto de correo (solo por acción explícita)", async () => {
    clock += 14 * DAY;
    const review = await cpCall("GET", "/trials/review", { token: ADMIN });
    expect(review.json.noticesDue.map((x: any) => x.id)).toContain(trialId);
    expect((await cpCall("POST", "/trials/notices/send", { token: ADMIN })).status).toBe(200);
    const notice = trialOutbox.find((x) => x.tag === "trial_expiry" && x.to === OWNER);
    expect(notice?.subject).toMatch(/termina mañana/);
    expect(data(await q(tenantId, "setupWizard.status", undefined, cookie)).licence.daysLeft).toBe(1);
  });

  it("vencimiento: solo lectura en el servidor (lecturas sí, mutaciones no) y datos intactos", async () => {
    clock += 2 * DAY;
    expect((await cpCall("POST", `/trials/${trialId}/expire`, { token: ADMIN })).json.trial.state).toBe("expired");
    const list = await q(tenantId, "crm.clients.list", { limit: 10, offset: 0 }, cookie);
    expect(list.status).toBe(200);
    expect(data(list).total).toBe(1);
    const st = data(await q(tenantId, "setupWizard.status", undefined, cookie));
    expect(st.licence).toMatchObject({ readOnly: true, daysLeft: 0 });
    for (const [proc, input] of [
      ["crm.clients.create", { name: "Cliente Dos", email: "cliente@dos.example" }],
      ["admin.createUser", { name: "Empleado 4", email: `empleado4-${run}@ferreteria.example`, role: "user" }],
      ["setupWizard.saveActivity", { activity: "servicios" }],
      ["products.createCategory", { slug: "otra", name: "Otra" }],
    ] as const) {
      const r = await m(tenantId, proc, input, cookie);
      // Lo rechaza el motor de licencias (caducada: solo lectura), no otra regla
      expect([proc, r.status, r.json?.error?.json?.data?.status]).toEqual([proc, 403, "expired"]);
    }
    const c = await tenantConn(tenantId);
    try {
      const [n] = await c.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM clients) AS clients, (SELECT COUNT(*) FROM experiences) AS products, (SELECT COUNT(*) FROM users) AS users");
      expect({ clients: Number(n[0].clients), products: Number(n[0].products), users: Number(n[0].users) }).toEqual({ clients: 1, products: 1, users: 4 });
    } finally {
      await c.end();
    }
  });

  it("conversión: suscripción activa y escritura recuperada", async () => {
    const r = await cpCall("POST", `/trials/${trialId}/convert`, { token: ADMIN, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.trial.state).toBe("converted");
    expect((await m(tenantId, "crm.clients.create", { name: "Cliente Dos", email: "cliente@dos.example" }, cookie)).status).toBe(200);
    const st = data(await q(tenantId, "setupWizard.status", undefined, cookie));
    expect(st.licence).toMatchObject({ plan: "essential", readOnly: false, endsAt: null });
    expect(data(await q(tenantId, "crm.clients.list", { limit: 10, offset: 0 }, cookie)).total).toBe(2);
  });
});
