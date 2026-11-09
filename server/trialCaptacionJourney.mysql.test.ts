/**
 * Captación y activación de la prueba gratuita de punta a punta con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL),
 * encargo de Jorge del 09/11/2026: lo que en production no se puede recorrer sin un buzón real.
 *  - Contador anónimo de la página, alta con el formulario nuevo (responsable, sector, teléfono, país, condiciones con
 *    su versión, consentimiento comercial y procedencia) y sin condiciones (400 legible, nada creado).
 *  - Verificación por el enlace del correo → aprovisionamiento REAL de la BD de la empresa → empresa del CRM con sus
 *    datos y su propietaria como contacto principal, consentimiento comercial registrado.
 *  - Primera sesión de la propietaria en SU host: «Primeros pasos» comunica el primer acceso al plano de control por el
 *    canal de comercio real del Core (CP_COMMERCE_URL); su primer cliente, la primera acción útil.
 *  - Embudo por canal y marca de prueba técnica (sale del embudo sin borrar nada).
 *  - Recordatorios de la tarea programada (MySQL): correo sin verificar → enlace nuevo; sin entrar en el panel →
 *    «Tu espacio te está esperando»; una sola vez; nada a registros técnicos. CP_TRIALS_SCHEDULER_ENABLED la enciende.
 * Correos: buzones en memoria (no se envía nada real).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3414/registry_test \
 *     pnpm vitest run server/trialCaptacionJourney.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import { MysqlOrderStore } from "./orchestrator/store";

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
const REG_DB = `cap_reg_${run}`;
const CRM_DB = `cap_crm_${run}`;
const PLATFORM = "elephant.test";
const ADMIN = "trial-journey-admin-token-aaaaaaaaaaaaaa";
const DAY = 86_400_000;
const OWNER = `responsable-${run}@estudio.example`;
const COMPANY = `Estudio Captación ${run}`;
const CORE = "trial-captacion-core-token-bbbbbbbbbbbbbbb";
const PASS = `clave-propietaria-${run}`;

type Res = { status: number; json: any; raw: string; cookie?: string };

describe.skipIf(!URL_)("captación y activación de la prueba gratuita de punta a punta (MySQL real)", () => {
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
  let trialStore: import("./trials/store").MysqlTrialStore;
  let crmStoreRef: import("./crm/mysqlStore").MysqlCrmStore;
  const consents: Array<{ contactId: number; evidence: string }> = [];

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

  const envBefore = { ...process.env };
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
    const crmStore = (crmStoreRef = new MysqlCrmStore(crmPool));
    const port = memoryEmailPort();
    trialOutbox = port.sent as typeof trialOutbox;
    const cpApp = createControlPlaneApp({
      tokens: [{ id: "core", sha256: hashToken(CORE), scopes: ["commerce:support"] }, { id: "admin", sha256: hashToken(ADMIN), scopes: ["tenants:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "orders:read", "orders:write", "orders:approve"] }],
      registry,
      reader: store,
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      platformTarget: "edge.example.com",
      provisioning,
      platformDomain: PLATFORM,
      // La plataforma ya existe (la prueba): activar el contrato solo devuelve su tenant
      crm: { service: new CrmService({ store: crmStore, activation: { activate: async (i: { company: { tenantId: string | null } }) => ({ tenantId: i.company.tenantId! }) } }), store: crmStore },
      web: { store: webStore },
      subscriptions: { store: new MysqlSubscriptionStore(crmPool), now: () => clock },
      capabilities: new MysqlCapabilityStore(regPool),
      // Pedidos (CRM 0010): la conversión de la prueba siempre es un pedido (aquí, por excepción tipificada)
      orders: { store: new MysqlOrderStore(crmPool) },
      trials: {
        store: (trialStore = new MysqlTrialStore(crmPool)),
        funnel: new (await import("./trials/funnel")).MysqlTrialFunnelCounter(crmPool),
        marketingConsent: async (contactId: number, evidence: string) => void consents.push({ contactId, evidence }),
        publicEnabled: true,
        autoProvision: true,
        limits: { perIp24h: 100, concurrentProvisioning: 10 },
        notify: createEmailTrialNotifier({ mode: "live", port, verifyUrl: "https://web.example/prueba/verificar", pricingUrl: "https://web.example/precios", log: () => undefined }),
      },
    });
    cp = http.createServer(cpApp);
    await new Promise<void>((r) => cp.listen(0, "127.0.0.1", r));
    cpPort = (cp.address() as AddressInfo).port;
    // El Core habla con el plano de control por el canal de comercio real (hitos de la prueba)
    process.env.CP_COMMERCE_URL = `http://127.0.0.1:${cpPort}`;
    process.env.CP_COMMERCE_TOKEN = CORE;

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
  }, 240_000);

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
    // El entorno vuelve a como estaba (las variables de esta suite no se quedan para otras)
    for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
    Object.assign(process.env, envBefore);
  }, 120_000);

  let trialId = 0;
  let tenantId = "";
  let cookie = "";
  const FORM = {
    fullName: "Lucía Martín Ruiz",
    sector: "servicios-profesionales",
    phone: "+34 600 111 222",
    country: "ES",
    termsAccepted: true,
    termsVersion: "2026-10-21",
    marketingConsent: true,
    attribution: { source: "verificacion-e2e", medium: "prueba", campaign: "captacion", landingPath: "/prueba-gratuita", adClick: "google" },
  };
  const key = () => crypto.randomBytes(12).toString("hex");
  const day = () => new Date(clock).toISOString().slice(0, 10);
  const events = async (id: number) => (await trialStore.events(id)).map((e) => e.action as string);
  async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("página: el contador anónimo cuenta visita e inicio del formulario por canal", async () => {
    for (const step of ["visit", "form_start"]) expect((await cpCall("POST", "/public/trial/funnel", { body: { step, attribution: FORM.attribution } })).json).toEqual({ counted: true });
    const f = (await cpCall("GET", `/trials/funnel?from=${day()}&to=${day()}`, { token: ADMIN })).json;
    expect(f.landing.channels).toEqual([{ channel: "verificacion-e2e", visit: 1, form_start: 1 }]);
  });

  it("alta: sin condiciones, 400 legible y nada creado; con el formulario nuevo, respuesta genérica y enlace solo por correo", async () => {
    const bad = await cpCall("POST", "/public/trial", { body: { email: OWNER, companyName: COMPANY, idempotencyKey: key() } });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe("Hay que aceptar la política de privacidad y las condiciones de la prueba");
    expect((await trialStore.list({})).length).toBe(0);
    const r = await cpCall("POST", "/public/trial", { body: { email: OWNER, companyName: COMPANY, ...FORM, idempotencyKey: key() } });
    expect(r.status).toBe(202);
    // Respuesta genérica: ni el id de la prueba ni el token (el enlace solo va por correo)
    expect(Object.keys(r.json).sort()).toEqual(["message", "status"]);
    ({ id: trialId } = verificationLink(OWNER));
    const t = (await trialStore.get(trialId))!;
    expect(t.configuration.terms).toEqual({ acceptedAt: expect.any(Number), version: "2026-10-21" });
    expect(t.configuration.profile).toMatchObject({ fullName: "Lucía Martín Ruiz", sector: "servicios-profesionales", marketingConsent: true });
    expect(t.configuration.attribution).toMatchObject({ source: "verificacion-e2e", adClick: "google" });
  });

  it("verificación: plataforma real, empresa del CRM con sus datos y la responsable como propietaria con su consentimiento", async () => {
    const { id, token } = verificationLink(OWNER);
    const v = await cpCall("POST", "/public/trial/verify", { body: { id, token } });
    expect(v.status).toBe(200);
    const t = (await trialStore.get(trialId))!;
    if (t.tenantId) tenants.push(t.tenantId);
    expect(t.state).toBe("active");
    tenantId = t.tenantId!;
    expect(welcomeLink(OWNER)?.host).toBe(hostOf(tenantId));
    const company = (await crmStoreRef.list("companies", { tenantId }))[0];
    expect(company).toMatchObject({ name: COMPANY, sector: "Servicios profesionales", country: "ES", phone: "+34 600 111 222" });
    const contacts = await crmStoreRef.list("contacts", { companyId: company.id });
    expect(contacts).toEqual([expect.objectContaining({ name: "Lucía Martín Ruiz", isPrimary: true, role: "Propietario (prueba gratuita)" })]);
    expect(consents).toEqual([{ contactId: contacts[0].id, evidence: expect.stringContaining("casilla no premarcada") }]);
  }, 120_000);

  it("primera sesión: entra en SU host; «Primeros pasos» comunica el primer acceso y su primer cliente la primera acción útil", async () => {
    cookie = await ownerLogin(tenantId, OWNER, PASS);
    const st = data(await q(tenantId, "setupWizard.status", undefined, cookie));
    expect(st.facts.clients).toBe(0);
    expect(await eventually(() => events(trialId), (a) => a.includes("first_access"), 15_000)).toContain("first_access");
    expect((await m(tenantId, "crm.clients.create", { name: "Primer cliente", email: `cliente-${run}@cliente.example` }, cookie)).status).toBe(200);
    expect(data(await q(tenantId, "setupWizard.status", undefined, cookie)).facts.clients).toBe(1);
    const acts = await eventually(() => events(trialId), (a) => a.includes("first_action"), 15_000);
    expect(acts.filter((a) => a === "first_access")).toHaveLength(1);
    expect(acts).toContain("first_action");
  }, 60_000);

  it("embudo: todas las etapas en su canal; marcada como prueba técnica sale del embudo sin borrar nada", async () => {
    const f = (await cpCall("GET", `/trials/funnel?from=${day()}&to=${day()}`, { token: ADMIN })).json;
    expect(f.rows).toEqual([{ channel: "verificacion-e2e", sector: "servicios-profesionales", stages: expect.objectContaining({ submitted: 1, verified: 1, provisioned: 1, first_access: 1, first_action: 1 }) }]);
    expect((await cpCall("POST", `/trials/${trialId}/mark-test`, { token: ADMIN, body: { reason: "Recorrido técnico de punta a punta" } })).status).toBe(200);
    expect((await cpCall("POST", "/trials/funnel/test-channels", { token: ADMIN, body: { channel: "verificacion-e2e", reason: "Visitas del recorrido técnico" } })).status).toBe(201);
    const g = (await cpCall("GET", `/trials/funnel?from=${day()}&to=${day()}`, { token: ADMIN })).json;
    expect(g.rows).toEqual([]);
    expect(g.landing.channels).toEqual([]);
    expect(g.excluded).toEqual({ trials: 1, channels: ["verificacion-e2e"] });
    expect((await trialStore.get(trialId))!.state).toBe("active");
  });

  it("recordatorios con MySQL: enlace nuevo al correo sin verificar; «entra en tu panel» a quien no entró; una vez; nada a técnicas", async () => {
    const { TrialScheduler, mysqlAdvisoryLock, startTrialScheduler } = await import("./trials/scheduler");
    const { trialEmails } = await import("./trials/emailNotifier");
    const reminders: Array<{ to: string; kind: string; key: string; domain: string | null; optOutUrl: string | null }> = [];
    const pendingEmail = `pendiente-${run}@verificar.example`;
    const idleEmail = `sin-entrar-${run}@panel.example`;
    expect((await cpCall("POST", "/public/trial", { body: { email: pendingEmail, companyName: `Pendiente ${run}`, ...FORM, attribution: { source: "recordatorios-e2e" }, idempotencyKey: key() } })).status).toBe(202);
    expect((await cpCall("POST", "/public/trial", { body: { email: idleEmail, companyName: `Sin entrar ${run}`, ...FORM, attribution: { source: "recordatorios-e2e" }, idempotencyKey: key() } })).status).toBe(202);
    const techEmail = `tecnica-sin-entrar-${run}@panel.example`;
    expect((await cpCall("POST", "/public/trial", { body: { email: techEmail, companyName: `Técnica ${run}`, ...FORM, attribution: { source: "recordatorios-e2e" }, idempotencyKey: key() } })).status).toBe(202);
    const idle = verificationLink(idleEmail);
    const tech = verificationLink(techEmail);
    for (const v of [idle, tech]) {
      const res = await cpCall("POST", "/public/trial/verify", { body: v });
      const tid = (await trialStore.get(v.id))?.tenantId;
      if (tid) tenants.push(tid);
      expect(res.status).toBe(200);
    }
    expect((await cpCall("POST", `/trials/${tech.id}/mark-test`, { token: ADMIN, body: { reason: "Prueba técnica sin entrar en el panel" } })).status).toBe(200);
    const pendingId = verificationLink(pendingEmail).id;
    const tpl = trialEmails({ verifyUrl: "https://web.example/prueba/verificar" });
    const scheduler = new TrialScheduler({
      store: trialStore,
      lock: mysqlAdvisoryLock(crmPool),
      now: () => clock,
      exempt: new Set(),
      log: () => undefined,
      notify: {
        expiryNotice: async () => undefined,
        verification: async (to, l) => void trialOutbox.push(tpl.verification(to, l) as never),
        reminder: async (to, i) => void reminders.push({ to, kind: i.kind, key: i.key, domain: i.domain, optOutUrl: i.optOutUrl }),
      },
      reminders: { platformDomain: PLATFORM, optOutUrl: (id) => `https://crm.example/cp/v1/public/trial/recordatorios?t=${id}.firma` },
    });
    // La tarea solo arranca con CP_TRIALS_SCHEDULER_ENABLED=1
    const off = startTrialScheduler({ scheduler, env: {}, log: () => undefined });
    expect(off.enabled).toBe(false);
    const on = startTrialScheduler({ scheduler, env: { CP_TRIALS_SCHEDULER_ENABLED: "1" }, log: () => undefined });
    expect(on.enabled).toBe(true);
    on.stop();

    const start = clock;
    try {
    const before = trialOutbox.filter((x) => x.to === pendingEmail).length;
    clock = start + 21 * 3_600_000;
    expect((await scheduler.tick()).remindersQueued).toBe(1);
    expect(trialOutbox.filter((x) => x.to === pendingEmail).length).toBe(before + 1);
    expect(await events(pendingId)).toContain("resend_verification");
    clock = start + 49 * 3_600_000;
    await scheduler.tick();
    await scheduler.tick();
    expect(reminders).toEqual([expect.objectContaining({ to: idleEmail, kind: "setup", key: `trial:${idle.id}:reminder:setup:1`, domain: expect.stringContaining(PLATFORM) })]);
    // La técnica sin entrar en el panel no lo recibe (la otra, igual que ella, sí); la del recorrido tampoco
    expect(reminders.some((r) => r.to === techEmail)).toBe(false);
    expect(reminders.some((r) => r.to === OWNER)).toBe(false);
    expect((await scheduler.tick()).remindersQueued).toBe(0);
    } finally {
      clock = start;
    }
  }, 180_000);
});
