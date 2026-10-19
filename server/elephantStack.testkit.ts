/**
 * Pila completa de Elephant Source para pruebas de punta a punta y de rendimiento (solo pruebas, opt-in
 * con REGISTRY_TEST_DATABASE_URL). Dos servidores HTTP reales sobre MySQL:
 *
 *  - Plano de control: catálogo oficial publicado (lectura pública y cotizador), CRM comercial, prueba
 *    gratuita pública con aprovisionamiento REAL de la BD de cada empresa, suscripciones, licencias por
 *    capacidad (registro), orquestador comercial y proveedor de pagos de PRUEBAS (eventos firmados).
 *  - Aplicación multiempresa montada como el arranque real (`installTenantResolution` +
 *    `installTenantBinding`), con CAPABILITY_ENFORCEMENT=on, autenticación local, Redsys (notificación
 *    firmada) y vista de facturas.
 *
 * Reloj común controlable (`stack.clock`) para simular vencimientos sin esperar. Correos: el plano de
 * control usa un buzón en memoria; la aplicación, el `vi.mock("./mailer")` del fichero de prueba y un
 * `fetch` bloqueado (ninguna salida de red real). Solo datos sintéticos (dominios `.example`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";

export const PLATFORM = "elephant.test";
export const WEB = "https://web.example";
export const DAY = 86_400_000;

export interface Res {
  status: number;
  json: any;
  raw: string;
  cookie?: string;
  headers: http.IncomingHttpHeaders;
}

export interface ReqOpts {
  host?: string;
  token?: string;
  cookie?: string;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
}

export interface ElephantStack {
  run: string;
  /** Reloj común del plano de control y de las decisiones de licencia. */
  clock: { now: number };
  admin: mysql.Pool;
  regPool: mysql.Pool;
  crmPool: mysql.Pool;
  trialOutbox: Array<{ to: string; subject: string; text: string; tag: string }>;
  /** Correos que la aplicación intentó enviar por la API HTTP del proveedor (bloqueados). */
  blockedFetches: string[];
  adminToken: string;
  cpPort: number;
  appPort: number;
  request(port: number, method: string, p: string, o?: ReqOpts): Promise<Res>;
  cp(method: string, p: string, o?: ReqOpts): Promise<Res>;
  hostOf(tenantId: string): string;
  q(tenantId: string, proc: string, input: unknown, cookie?: string): Promise<Res>;
  m(tenantId: string, proc: string, input: unknown, cookie?: string): Promise<Res>;
  app(tenantId: string, method: string, p: string, o?: ReqOpts): Promise<Res>;
  /** Firma un evento del proveedor de pagos de PRUEBAS (nunca un cobro real). */
  signPayment(body: string): string;
  tenantConn(tenantId: string): Promise<mysql.Connection>;
  verificationLink(to: string): { id: number; token: string };
  welcomeLink(to: string): { host: string; token: string } | null;
  /** Empresas creadas en la prueba: sus BD se borran al cerrar. */
  tenants: string[];
  close(): Promise<void>;
}

export const data = (r: Res) => r.json?.result?.data?.json;
export const errCode = (r: Res) => r.json?.error?.json?.data?.code;

export async function startElephantStack(url: string, o: { label: string; perMinute?: number } = { label: "e2e" }): Promise<ElephantStack> {
  const run = crypto.randomBytes(3).toString("hex");
  const REG_DB = `${o.label}_reg_${run}`;
  const CRM_DB = `${o.label}_crm_${run}`;
  const ADMIN = `stack-admin-${run}-${crypto.randomBytes(12).toString("hex")}`;
  const PAY_SECRET = `secreto-pagos-de-pruebas-${crypto.randomBytes(16).toString("hex")}`;
  const clock = { now: Date.now() };
  const u = new URL(url);
  const at = (db: string) => {
    const x = new URL(url);
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
  process.env.JWT_SECRET = `jwt-secret-de-prueba-${run}-${crypto.randomBytes(12).toString("hex")}`;
  process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
  delete process.env.SUPPORT_JWT_SECRET;
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "REDSYS_MERCHANT_KEY", "REDSYS_MERCHANT_CODE", "ADMIN_EMAIL", "S3_ENDPOINT", "BUILT_IN_FORGE_API_URL", "BREVO_API_KEY", "ERM_DATABASE_URL"]) delete process.env[k];
  // Ninguna salida de red real desde la aplicación
  const blockedFetches: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const target = String(input instanceof URL ? input.href : typeof input === "string" ? input : (input as { url: string }).url);
    blockedFetches.push(target);
    throw new Error(`Salida de red bloqueada en pruebas: ${target}`);
  }) as typeof fetch;

  const admin = mysql.createPool({ uri: url, connectionLimit: 4 });
  for (const db of [REG_DB, CRM_DB]) {
    await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4`);
  }
  const regPool = mysql.createPool({ uri: at(REG_DB), connectionLimit: 10, multipleStatements: true });
  const crmPool = mysql.createPool({ uri: at(CRM_DB), connectionLimit: 10 });

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
  const { MysqlTenantLimitStore } = await import("./_core/limits/store");
  const { configureLimitAccess } = await import("./_core/limits/access");
  const { createControlPlaneApp } = await import("./controlPlane/api");
  const { hashToken } = await import("./controlPlane/auth");
  const { CrmService } = await import("./crm/service");
  const { createContractActivation } = await import("./crm/activation");
  const { MysqlCrmStore } = await import("./crm/mysqlStore");
  const { WebAdminService } = await import("./web/service");
  const { MysqlWebStore } = await import("./web/store");
  const { MysqlSubscriptionStore } = await import("./subscriptions/store");
  const { MysqlTrialStore } = await import("./trials/store");
  const { createEmailTrialNotifier, memoryEmailPort } = await import("./trials/emailNotifier");
  const { seedElephantSource } = await import("./catalog/seed");
  const { BUILTIN_MODULES } = await import("./_core/modules/builtin");
  const { MysqlOrderStore } = await import("./orchestrator/store");
  const { SignedTestProvider } = await import("./orchestrator/payments");

  const store = new MysqlTenantRegistryStore(regPool);
  const ring = keyringFromEnv(process.env);
  const registry = new TenantRegistryService(store, () => ring);
  const databases = new prov.MysqlDatabaseProvisioner(regPool, { host: u.hostname, port: Number(u.port || 3306), alias: "test-server", userHost: "%" });
  const provisioning = new ProvisioningService({
    registry,
    reader: store,
    databases,
    schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
    seeder: new prov.MysqlTenantSeeder(),
    entitlements: new EntitlementAdmin(regPool),
    quotas: new QuotaAdmin(regPool),
    store: new prov.MysqlProvisioningStore(regPool),
    maxAttemptsPerStep: 1,
    sleep: async () => undefined,
  });
  // Catálogo oficial publicado por el flujo normal (borrador → publicar → precio aprobado)
  const webStore = new MysqlWebStore(crmPool);
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((x) => x.id), planIds: () => null }, now: () => clock.now }), webStore);
  const crmStore = new MysqlCrmStore(crmPool);
  const port = memoryEmailPort();
  const provider = new SignedTestProvider({ webhookSecret: PAY_SECRET });
  const scopes = ["tenants:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "crm:read", "crm:write", "web:read", "orders:read", "orders:write", "orders:approve", "billing:write"] as const;
  const cpApp = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: [...scopes] }],
    registry,
    reader: store,
    entitlements: new EntitlementAdmin(regPool),
    quotas: new QuotaAdmin(regPool),
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: PLATFORM,
    perMinute: o.perMinute,
    perIpMinute: o.perMinute,
    // Como el arranque real (controlPlane/main.ts): el CRM activa contratos con el aprovisionamiento
    crm: { service: new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: PLATFORM, actor: { type: "crm", id: "crm-contracts" } }), now: () => clock.now }), store: crmStore },
    web: { store: webStore },
    subscriptions: { store: new MysqlSubscriptionStore(crmPool), now: () => clock.now },
    capabilities: new MysqlCapabilityStore(regPool),
    limits: new MysqlTenantLimitStore(regPool),
    trials: {
      store: new MysqlTrialStore(crmPool),
      publicEnabled: true,
      autoProvision: true,
      limits: { perIp24h: 1000, perDomain30d: 1000, concurrentProvisioning: 20 },
      notify: createEmailTrialNotifier({ mode: "live", port, verifyUrl: `${WEB}/prueba/verificar`, pricingUrl: `${WEB}/precios`, log: () => undefined }),
    },
    orders: { store: new MysqlOrderStore(crmPool), payments: provider },
    publicIntake: { origins: [WEB], secret: `secreto-formulario-${crypto.randomBytes(16).toString("hex")}`, now: () => clock.now, perIp: 1000 },
  });
  const cpServer = http.createServer(cpApp);
  await new Promise<void>((r) => cpServer.listen(0, "127.0.0.1", r));
  const cpPort = (cpServer.address() as AddressInfo).port;

  // ── Aplicación multiempresa (composición del arranque real) ──────────────
  const { installTenantResolution, installTenantBinding } = await import("./_core/tenantRegistry/install");
  const { createLocalAuthRouter } = await import("./localAuth");
  const { createPasswordResetRouter } = await import("./passwordReset");
  const { createAuthGuardMiddleware } = await import("./authGuard");
  const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
  const { appRouter } = await import("./routers");
  const { createLocalContext } = await import("./_core/context.local");
  const { closeAllDatabases } = await import("./_core/dbRegistry");
  const { getModuleAccess } = await import("./_core/modules/runtime");
  const { registerBuiltinModules } = await import("./_core/modules/builtin");
  const { moduleRouteGuard } = await import("./_core/modules/routeGuard");
  const { configureCapabilityAccess, getCapabilityAccess } = await import("./_core/capabilities/access");
  const { capabilityRouteGuard } = await import("./_core/capabilities/routeGuard");
  const invoicePreviewRouter = (await import("./invoicePreviewRouter")).default;
  const redsysRouter = (await import("./redsysRoutes")).default;
  const a = express();
  const rt = installTenantResolution(a, process.env)!;
  // Mismo lector del registro, sin caché y con el reloj de la prueba (vencimientos sin esperar)
  configureCapabilityAccess(rt.capabilities, { now: () => clock.now, ttlMs: 0 });
  configureLimitAccess(rt.limits, { now: () => clock.now, ttlMs: 0 });
  a.use(express.json({ limit: "5mb" }));
  installTenantBinding(a);
  a.use(createLocalAuthRouter());
  a.use(createPasswordResetRouter());
  registerBuiltinModules();
  a.use("/api/trpc", moduleRouteGuard(getModuleAccess));
  a.use("/api/trpc", capabilityRouteGuard(getCapabilityAccess));
  a.use("/api/trpc", createAuthGuardMiddleware(true));
  a.use(redsysRouter);
  a.use(invoicePreviewRouter);
  a.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext, onError: () => undefined }));
  const appServer = http.createServer(a);
  await new Promise<void>((r) => appServer.listen(0, "127.0.0.1", r));
  const appPort = (appServer.address() as AddressInfo).port;

  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  const request = (p0: number, method: string, p: string, ro: ReqOpts = {}) =>
    new Promise<Res>((resolve, reject) => {
      const body = ro.raw ?? (ro.body === undefined ? undefined : JSON.stringify(ro.body));
      const req = http.request(
        {
          host: "127.0.0.1",
          port: p0,
          path: p,
          method,
          agent,
          headers: {
            ...(ro.host ? { host: ro.host } : {}),
            ...(ro.token ? { authorization: `Bearer ${ro.token}` } : {}),
            ...(ro.cookie ? { cookie: ro.cookie } : {}),
            ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
            ...(ro.headers ?? {}),
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
            resolve({ status: res.statusCode ?? 0, json, raw: b, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0], headers: res.headers });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  const hostOf = (tenantId: string) => `${tenantId}.${PLATFORM}`;
  const outbox = port.sent as ElephantStack["trialOutbox"];
  const tenants: string[] = [];
  const linkOf = (text: string, re: RegExp) => new URL(text.match(re)![0]);

  return {
    run,
    clock,
    admin,
    regPool,
    crmPool,
    trialOutbox: outbox,
    blockedFetches,
    adminToken: ADMIN,
    cpPort,
    appPort,
    request,
    cp: (method, p, ro = {}) => request(cpPort, method, `/cp/v1${p}`, ro),
    hostOf,
    q: (t, proc, input, cookie) => request(appPort, "GET", `/api/trpc/${proc}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`, { host: hostOf(t), cookie }),
    m: (t, proc, input, cookie) => request(appPort, "POST", `/api/trpc/${proc}`, { host: hostOf(t), cookie, body: { json: input ?? null } }),
    app: (t, method, p, ro = {}) => request(appPort, method, p, { ...ro, host: ro.host ?? hostOf(t) }),
    signPayment: (body) => provider.sign(body, Math.floor(clock.now / 1000)),
    tenantConn: (tenantId) => {
      const x = new URL(url);
      x.pathname = `/es_${tenantId.replace(/-/g, "_")}`;
      return mysql.createConnection({ uri: x.toString() });
    },
    verificationLink: (to) => {
      const mail = outbox.filter((x) => x.tag === "trial_verification" && x.to === to).at(-1);
      if (!mail) throw new Error(`Sin correo de verificación para ${to}`);
      const l = linkOf(mail.text, /https:\/\/web\.example\/prueba\/verificar\?\S+/);
      return { id: Number(l.searchParams.get("id")), token: l.searchParams.get("token")! };
    },
    welcomeLink: (to) => {
      const mail = outbox.filter((x) => x.tag === "trial_welcome" && x.to === to).at(-1);
      if (!mail) return null;
      const l = linkOf(mail.text, /https:\/\/\S+\/establecer-contrasena\?token=\S+/);
      return { host: l.host, token: l.searchParams.get("token")! };
    },
    tenants,
    async close() {
      agent.destroy();
      appServer.closeAllConnections();
      await new Promise<void>((r) => appServer.close(() => r()));
      cpServer.closeAllConnections();
      await new Promise<void>((r) => cpServer.close(() => r()));
      await closeAllDatabases();
      await rt.close();
      for (const t of tenants) await databases.dropDatabase(t).catch(() => undefined);
      await regPool.end();
      await crmPool.end();
      for (const db of [REG_DB, CRM_DB]) await admin.query(`DROP DATABASE IF EXISTS \`${db}\``).catch(() => undefined);
      await admin.end();
      globalThis.fetch = realFetch;
      delete process.env.TENANT_MODE;
      delete process.env.CAPABILITY_ENFORCEMENT;
    },
  };
}
