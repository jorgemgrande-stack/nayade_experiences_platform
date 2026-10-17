/**
 * Banco de pruebas de las capacidades de Essential con la APLICACIÓN REAL sobre MySQL (solo pruebas,
 * opt-in con REGISTRY_TEST_DATABASE_URL). Lo usan los ficheros `server/essential.*.mysql.test.ts`.
 *
 *  - Dos empresas NUEVAS aprovisionadas desde la baseline (sin datos de ninguna instalación previa).
 *  - Licencias por capacidad en el registro: las 29 de Essential activas en ambas.
 *  - Montaje como el arranque real en multi: resolución y ligado de tenant, autenticación local,
 *    licencias de módulo y de capacidad (CAPABILITY_ENFORCEMENT=on), guardián de sesión y tRPC.
 *  - Usuarios por rol legado (admin, agente, controler, user): las pruebas usan el rol mínimo.
 */
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import express from "express";
import mysql from "mysql2/promise";
import { capabilitiesOfTier } from "./catalog/capabilities";

export type Co = "a" | "b";
export type Role = "admin" | "agente" | "controler" | "user";
export const ESSENTIAL = capabilitiesOfTier("essential");
const OP = { type: "operator" as const, id: "prueba-essential" };
const ROLES: Role[] = ["admin", "agente", "controler", "user"];

export interface Res {
  status: number;
  json: any;
  text: string;
  cookie?: string;
}

/** Correo capturado por el proveedor falso (cuerpo de la API de envío). */
export interface Mail {
  sender: { email: string; name?: string };
  replyTo?: { email: string };
  to: Array<{ email: string }>;
  subject: string;
  htmlContent: string;
}

export interface EssentialApp {
  ids: Record<Co, string>;
  /** Puerto local de la aplicación (peticiones con cuerpo binario). */
  port: number;
  /** Correos que la aplicación intentó enviar (nunca salen). */
  mails: Mail[];
  /** Registro (plano de control) para operaciones de operador: dominios, etc. */
  registry: { service: any; store: any };
  /** Olvida en caché la identidad y el enrutado de una empresa (lo haría el sondeo del registro). */
  refreshTenant(co: Co, domains?: string[]): void;
  /** Petición HTTP con un Host arbitrario (dominio propio). */
  callHost(host: string, method: string, p: string): Promise<Res>;
  host(co: Co): string;
  /** Petición HTTP cruda contra la aplicación. */
  call(co: Co, method: string, p: string, o?: { cookie?: string; body?: unknown; raw?: string; headers?: Record<string, string> }): Promise<Res>;
  /** Consulta tRPC (GET). */
  q(co: Co, proc: string, input?: unknown, cookie?: string): Promise<Res>;
  /** Mutación tRPC (POST). */
  m(co: Co, proc: string, input?: unknown, cookie?: string): Promise<Res>;
  /** Cookie de sesión de un usuario con ese rol en esa empresa. */
  login(co: Co, role: Role): Promise<string>;
  userId(co: Co, role: Role): Promise<number>;
  /** Cambia la licencia de una capacidad (null = no contratada). */
  setCapability(co: Co, cap: string, status: "active" | "read_only" | "suspended" | null): Promise<void>;
  /** SQL directo en la BD de una empresa (verificación de persistencia). */
  sql<T = any>(co: Co, q: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export const data = (r: Res) => r.json?.result?.data?.json;
export const errCode = (r: Res) => r.json?.error?.json?.data?.code;

export async function startEssentialApp(url: string, label: string): Promise<EssentialApp> {
  const run = crypto.randomBytes(3).toString("hex");
  const ids: Record<Co, string> = { a: `${label}-a-${run}`, b: `${label}-b-${run}` };
  const regDb = `ess_reg_${label.replace(/[^a-z0-9]/g, "")}_${run}`;
  const u = new URL(url);
  const regUrl = new URL(url);
  regUrl.pathname = `/${regDb}`;

  process.env.TENANT_MODE = "multi";
  process.env.CAPABILITY_ENFORCEMENT = "on";
  process.env.REGISTRY_DATABASE_URL = regUrl.toString();
  process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
  process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
  process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
  process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
  process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run;
  process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
  process.env.APP_URL = "https://instalacion-unica.example";
  delete process.env.SUPPORT_JWT_SECRET;
  // Sin envíos reales: sin SMTP configurado el adaptador no envía
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "REDSYS_MERCHANT_KEY", "REDSYS_MERCHANT_CODE", "ADMIN_EMAIL", "S3_ENDPOINT", "BUILT_IN_FORGE_API_URL"]) delete process.env[k];
  // Correo: proveedor FALSO que solo registra (ninguna salida de red real)
  process.env.BREVO_API_KEY = "ci-only-proveedor-falso";
  // Servicio de correo centralizado: «live» autorizado SOLO porque el proveedor es falso (fetch interceptado)
  process.env.MAIL_MODE = "live";
  process.env.MAIL_LIVE_AUTHORIZED = "1";
  process.env.MAIL_SENDING_DOMAIN = "envios.example";
  const mails: Mail[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const target = String(input instanceof URL ? input.href : typeof input === "string" ? input : (input as { url: string }).url);
    if (target.startsWith("https://api.brevo.com/")) {
      mails.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ messageId: "prueba" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Salida de red bloqueada en pruebas: ${target}`);
  }) as typeof fetch;

  const admin = mysql.createPool({ uri: url, multipleStatements: true, connectionLimit: 6 });
  await admin.query(`CREATE DATABASE ${regDb} CHARACTER SET utf8mb4`);
  const regPool = mysql.createPool({ uri: regUrl.toString(), multipleStatements: true, connectionLimit: 6 });
  const { migrateRegistry } = await import("./_core/tenantRegistry/migrate");
  await migrateRegistry(regPool, path.resolve(__dirname, "../db/registry"), { dryRun: false });

  const { MysqlTenantRegistryStore } = await import("./_core/tenantRegistry/mysqlStore");
  const { TenantRegistryService } = await import("./_core/tenantRegistry/service");
  const { keyringFromEnv } = await import("./_core/tenantRegistry/crypto");
  const { ProvisioningService } = await import("./_core/provisioning/service");
  const prov = await import("./_core/provisioning/mysqlAdapters");
  const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
  const { QuotaAdmin } = await import("./_core/erm/mysqlQuotas");
  const { MysqlCapabilityStore } = await import("./_core/capabilities/store");
  const { MysqlOrganizationStore } = await import("./organization/service");
  const store = new MysqlTenantRegistryStore(regPool);
  const svc = new TenantRegistryService(store, () => keyringFromEnv(process.env));
  const p = new ProvisioningService({
    registry: svc,
    reader: store,
    databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
    schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
    seeder: new prov.MysqlTenantSeeder(),
    entitlements: new EntitlementAdmin(regPool),
    quotas: new QuotaAdmin(regPool),
    store: new prov.MysqlProvisioningStore(regPool),
  });
  const caps = new MysqlCapabilityStore(regPool);
  const org = new MysqlOrganizationStore(regPool);
  const dsn: Record<Co, string> = { a: "", b: "" };
  const pass = (co: Co, role: Role) => `clave-${role}-${co}-${run}`;
  const email = (co: Co, role: Role) => `${role}@${ids[co]}.example`;
  const now = Date.now();
  for (const co of ["a", "b"] as Co[]) {
    const id = ids[co];
    const r = await p.run({ tenantId: id, displayName: `Empresa ${co.toUpperCase()} Ejemplo SL`, adminEmail: email(co, "admin"), platformDomain: "elephantsource.es" }, OP);
    if (r.status !== "completed") throw new Error(`Aprovisionamiento de ${id}: ${r.status}`);
    await org.insertFiscalEntity({ tenantId: id, entityId: "principal", legalName: `Empresa ${co.toUpperCase()} Ejemplo SL`, taxId: co === "a" ? "B00000011" : "B00000022", country: "ES", address: `Calle Prueba ${co}, 00000 Ejemplo`, isDefault: true, status: "active", createdAt: now, createdBy: "prueba", updatedAt: now });
    await caps.apply(id, ESSENTIAL.map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "trial:prueba" })), { actor: "operator:prueba", reason: "Prueba Essential", now });
    dsn[co] = (await svc.getActiveDsn(id))!;
    const c = await mysql.createConnection({ uri: dsn[co] });
    for (const role of ROLES) {
      const hash = await bcrypt.hash(pass(co, role), 4);
      if (role === "admin") {
        await c.query("UPDATE users SET passwordHash = ?, inviteAccepted = 1 WHERE email = ?", [hash, email(co, role)]);
      } else {
        await c.query("INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, ?, ?, 'local', ?, 1, ?, 1)", [`local_${role}_${co}_${run}`, `Usuario ${role}`, email(co, role), role, hash]);
      }
    }
    await c.end();
  }

  const { installTenantResolution, installTenantBinding } = await import("./_core/tenantRegistry/install");
  const { createLocalAuthRouter } = await import("./localAuth");
  const { createPasswordResetRouter } = await import("./passwordReset");
  const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
  const { appRouter } = await import("./routers");
  const { createLocalContext } = await import("./_core/context.local");
  const { closeAllDatabases } = await import("./_core/dbRegistry");
  const { registerBuiltinModules } = await import("./_core/modules/builtin");
  const { getModuleAccess } = await import("./_core/modules/runtime");
  const { moduleRouteGuard } = await import("./_core/modules/routeGuard");
  const { capabilityRouteGuard } = await import("./_core/capabilities/routeGuard");
  const { getCapabilityAccess } = await import("./_core/capabilities/access");
  const { createAuthGuardMiddleware } = await import("./authGuard");
  const { sitemapRouter } = await import("./sitemapRouter");
  const invoicePreviewRouter = (await import("./invoicePreviewRouter")).default;
  const redsysRouter = (await import("./redsysRoutes")).default;
  const uploadRouter = (await import("./uploadRoutes")).default;
  const fileRouter = (await import("./fileRoutes")).default;

  const app = express();
  const rt = installTenantResolution(app, process.env)!;
  app.use(express.json({ limit: "5mb" }));
  installTenantBinding(app);
  app.use(createLocalAuthRouter());
  app.use(createPasswordResetRouter());
  registerBuiltinModules();
  app.use("/api/trpc", moduleRouteGuard(getModuleAccess));
  app.use("/api/trpc", capabilityRouteGuard(getCapabilityAccess));
  app.use("/api/trpc", createAuthGuardMiddleware(true));
  app.use(redsysRouter);
  app.use(uploadRouter);
  app.use(fileRouter);
  app.use(invoicePreviewRouter);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext, onError: () => undefined }));
  app.use(sitemapRouter);
  const server = http.createServer(app);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as AddressInfo).port;
  const host = (co: Co) => `${ids[co]}.elephantsource.es`;

  const call: EssentialApp["call"] = (co, method, p, o = {}) =>
    new Promise((resolve, reject) => {
      const body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: p,
          method,
          headers: {
            host: host(co),
            ...(o.cookie ? { cookie: o.cookie } : {}),
            ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
            ...(o.headers ?? {}),
          },
        },
        (res) => {
          let b = "";
          res.on("data", (ch) => (b += ch));
          res.on("end", () => {
            let json: any = null;
            try {
              json = JSON.parse(b);
            } catch {
              /* texto */
            }
            resolve({ status: res.statusCode ?? 0, json, text: b, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });

  const cookies = new Map<string, string>();
  const { invalidateTenantIdentity } = await import("./_core/tenantIdentity");
  const ess: EssentialApp = {
    ids,
    port,
    mails,
    registry: { service: svc, store },
    refreshTenant(co, domains = []) {
      invalidateTenantIdentity(ids[co]);
      rt.resolver.invalidateTenant(ids[co]);
      for (const d of domains) rt.resolver.invalidateDomain(d);
    },
    callHost: (h, method, p) =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: h } }, (res) => {
          let b = "";
          res.on("data", (ch) => (b += ch));
          res.on("end", () => {
            let json: any = null;
            try {
              json = JSON.parse(b);
            } catch {
              /* texto */
            }
            resolve({ status: res.statusCode ?? 0, json, text: b });
          });
        });
        req.on("error", reject);
        req.end();
      }),
    host,
    call,
    q: (co, proc, input, cookie) => call(co, "GET", `/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`), { cookie }),
    m: (co, proc, input, cookie) => call(co, "POST", `/api/trpc/${proc}`, { cookie, body: { json: input ?? null } }),
    async login(co, role) {
      const k = `${co}:${role}`;
      if (cookies.has(k)) return cookies.get(k)!;
      const r = await call(co, "POST", "/api/auth/login", { body: { email: email(co, role), password: pass(co, role) } });
      if (r.status !== 200 || !r.cookie) throw new Error(`login ${k}: ${r.status} ${r.text}`);
      cookies.set(k, r.cookie);
      return r.cookie;
    },
    async userId(co, role) {
      const [row] = await ess.sql(co, "SELECT id FROM users WHERE email = ?", [email(co, role)]);
      return Number(row.id);
    },
    async setCapability(co, cap, status) {
      if (status === null) await regPool.query("DELETE FROM tenant_capabilities WHERE tenant_id = ? AND capability_id = ?", [ids[co], cap]);
      else await caps.apply(ids[co], [{ capabilityId: cap, siteId: "", status, validUntil: null, source: "trial:prueba" }], { actor: "operator:prueba", reason: "prueba", now: Date.now() });
      getCapabilityAccess().invalidate(ids[co]);
    },
    async sql(co, q, params = []) {
      const c = await mysql.createConnection({ uri: dsn[co] });
      try {
        const [rows] = await c.query(q, params);
        return rows as any[];
      } finally {
        await c.end();
      }
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
      await closeAllDatabases();
      await rt.close();
      await regPool.end();
      await admin.end();
      globalThis.fetch = realFetch;
    },
  };
  return ess;
}

/**
 * Comprueba el guardián de licencia de un procedimiento: con la capacidad activa no se rechaza por
 * licencia; en solo lectura, las consultas pasan y las mutaciones dan 403; sin contratar, 403 en ambas.
 * Devuelve las respuestas para que la prueba compruebe además la operación.
 */
export async function licenseMatrix(
  ess: EssentialApp,
  cap: string,
  probe: { query?: () => Promise<Res>; mutation?: () => Promise<Res> },
): Promise<{ readOnlyQuery?: Res; readOnlyMutation?: Res; noneQuery?: Res; noneMutation?: Res }> {
  const out: { readOnlyQuery?: Res; readOnlyMutation?: Res; noneQuery?: Res; noneMutation?: Res } = {};
  try {
    await ess.setCapability("a", cap, "read_only");
    if (probe.query) out.readOnlyQuery = await probe.query();
    if (probe.mutation) out.readOnlyMutation = await probe.mutation();
    await ess.setCapability("a", cap, null);
    if (probe.query) out.noneQuery = await probe.query();
    if (probe.mutation) out.noneMutation = await probe.mutation();
  } finally {
    await ess.setCapability("a", cap, "active");
  }
  return out;
}

/** Rechazo por licencia de capacidad (no por permisos ni por validación). */
export const isLicenseDenied = (r: Res | undefined, cap: string) => r?.status === 403 && r.json?.error?.json?.data?.capability === cap;
