/**
 * Seguridad de lanzamiento en multiempresa con la APLICACIÓN REAL (MySQL, opt-in).
 *
 * Amplía tenantLegacyAccess.mysql.test.ts (CRM, descuentos, proveedores, numeración, hotel, caja,
 * TPV) sin repetirlo: aquí se cubren presupuestos, reservas, facturas (incluidos la vista HTML y
 * los enlaces firmados), productos, usuarios, configuración, exportaciones, ficheros, licencias,
 * webhooks, autenticación (cookies, CSRF, antifuerza bruta, recuperación, invitaciones,
 * revocación) y roles (propietario, administrador, empleado, solo lectura).
 *
 * Dos empresas aprovisionadas con la baseline + migraciones del carril de la app, middleware real
 * de tenant, autenticación local y routers Express/tRPC reales. Solo datos sintéticos (.example).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:3306/registry_test \
 *     pnpm vitest run server/securityLaunch.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import express from "express";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const A = `sec-a-${run}`;
const B = `sec-b-${run}`;
const PASS: Record<string, string> = { [A]: "clave-de-A-" + run, [B]: "clave-de-B-" + run };
const STAFF_PASS = "clave-equipo-" + run;

type Res = { status: number; json: any; text: string; cookies: string[]; location?: string };
const CENTRAL = "app.elephantsource.es";

describe.skipIf(!URL_)("seguridad de lanzamiento en multiempresa (aplicación real)", () => {
  let admin: mysql.Pool;
  let server: http.Server;
  let port: number;
  let closeAll: () => Promise<void>;
  let storageDir: string;
  const dsn: Record<string, string> = {};
  const host = (id: string) => `${id}.elephantsource.es`;
  const cookies: Record<string, string> = {};

  function call(h: string, method: string, p: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return new Promise<Res>((resolve, reject) => {
      const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: p,
          method,
          headers: {
            host: h,
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
            ...(opts.headers ?? {}),
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
            resolve({ status: res.statusCode ?? 0, json, text: b, cookies: (res.headers["set-cookie"] as string[] | undefined) ?? [], location: res.headers.location });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }
  const sessionOf = (r: Res) => r.cookies.find((c) => c.startsWith("nayade_session="))?.split(";")[0];

  const qs = (input: unknown) => (input === undefined ? "" : "?input=" + encodeURIComponent(JSON.stringify({ json: input })));
  /** Consulta tRPC con una cookie concreta (por defecto la del admin de `id`) contra el host de `id`. */
  const q = (id: string, proc: string, input?: unknown, cookie = cookies[id]) => call(host(id), "GET", `/api/trpc/${proc}${qs(input)}`, { cookie });
  const m = (id: string, proc: string, input: unknown, cookie = cookies[id], headers?: Record<string, string>) =>
    call(host(id), "POST", `/api/trpc/${proc}`, { cookie, body: { json: input }, headers });
  const data = (r: Res) => {
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return r.json.result.data.json;
  };
  const errCode = (r: Res) => r.json?.error?.json?.data?.code;

  async function sql<T = any>(id: string, query: string, params: unknown[] = []): Promise<T> {
    const c = await mysql.createConnection({ uri: dsn[id] });
    try {
      const [rows] = await c.query(query, params);
      return rows as T;
    } finally {
      await c.end();
    }
  }
  async function addUser(id: string, email: string, role: string, password = STAFF_PASS) {
    const r: any = await sql(
      id,
      "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, ?, ?, 'local', ?, 1, ?, 1)",
      [`local_${crypto.randomBytes(8).toString("hex")}`, email, email, role, await bcrypt.hash(password, 4)],
    );
    return Number(r.insertId);
  }
  async function login(id: string, email: string, password: string, headers?: Record<string, string>) {
    return call(host(id), "POST", "/api/auth/login", { body: { email, password }, headers });
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = URL_!;
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
    process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run + "-000000000000";
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
    // Nada de correo real: sin credenciales globales (en multi, además, se usan las del tenant)
    for (const k of ["BREVO_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "GLOBAL_CC_EMAIL", "GHL_WEBHOOK_SECRET", "GHL_LEAD_WEBHOOK_SECRET", "VAPI_WEBHOOK_SECRET", "RECOVERY_TOKEN", "PUBLIC_EXPENSE_FORM_TOKEN"]) delete process.env[k];
    // Los tokens globales existen en el entorno: en multi NO deben servir
    process.env.RECOVERY_TOKEN = "token-global-de-recuperacion-" + run;
    process.env.PUBLIC_EXPENSE_FORM_TOKEN = "token-global-de-gastos-" + run;
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "seg-storage-"));
    process.env.LOCAL_STORAGE_PATH = storageDir;

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
    const ring = keyringFromEnv(process.env);
    const svc = new TenantRegistryService(store, () => ring);
    const entitlements = new EntitlementAdmin(admin);
    const p = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema: new prov.MysqlSchemaApplier({
        baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"),
        migrationsDir: path.resolve(__dirname, "../db/migrations"),
      }),
      seeder: new prov.MysqlTenantSeeder(),
      entitlements,
      quotas: new QuotaAdmin(admin),
      store: new prov.MysqlProvisioningStore(admin),
    });
    const op = { type: "operator", id: "test" } as const;
    for (const id of [A, B]) {
      const r = await p.run({ tenantId: id, displayName: id, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.es" }, op);
      expect(r.status).toBe("completed");
      dsn[id] = (await svc.getActiveDsn(id))!;
      await sql(id, "UPDATE users SET passwordHash = ?, inviteToken = NULL, inviteAccepted = 1 WHERE email = ?", [await bcrypt.hash(PASS[id], 4), `admin@${id}.example`]);
    }
    // Licencia de hotel SOLO en A (licencias por empresa)
    await entitlements.grant(A, "hotel", op);
    await sql(A, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled','hotel',1) ON DUPLICATE KEY UPDATE enabled = 1");
    await sql(B, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled','hotel',1) ON DUPLICATE KEY UPDATE enabled = 1");

    // Datos de negocio con los MISMOS números en ambas empresas (los correlativos se repiten)
    for (const id of [A, B]) {
      const tag = id === A ? "A" : "B";
      await sql(id, "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, total) VALUES ('FAC-2026-0001', ?, ?, 100, 121)", [`Cliente factura ${tag}`, `factura-${tag.toLowerCase()}@cliente.example`]);
      await sql(id, "INSERT INTO quotes (quoteNumber, leadId, agentId, title, subtotal, total) VALUES ('PRE-2026-0001', 1, 1, ?, 50, 60.5)", [`Presupuesto ${tag}`]);
      await sql(id, "INSERT INTO reservations (product_id, product_name, booking_date, amount_total, customer_name, merchant_order, created_at, updated_at) VALUES (1, ?, '2026-12-01', 1000, ?, ?, ?, ?)", [`Producto ${tag}`, `Reserva ${tag}`, `ORD${tag}${run}`, Date.now(), Date.now()]);
      await sql(id, "INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [`Cliente CRM ${tag}`, `crm-${tag.toLowerCase()}@cliente.example`]);
    }
    // B tiene una segunda factura (id 2) que A no tiene: IDOR con un id que solo existe en B
    await sql(B, "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, total) VALUES ('FAC-2026-0002', 'Solo de B', 'solo-b@cliente.example', 1, 1)");
    // Ficheros de cada empresa en el almacenamiento local
    for (const id of [A, B]) {
      fs.mkdirSync(path.join(storageDir, "t", id), { recursive: true });
      fs.writeFileSync(path.join(storageDir, "t", id, "doc.txt"), `documento de ${id}`);
    }

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
    const { localStorageTenantGuard } = await import("./_core/tenantStorage");
    const { localStorageSecurityHeaders } = await import("./_core/publicEndpointGuards");
    const invoicePreviewRouter = (await import("./invoicePreviewRouter")).default;
    const settlementExportRouter = (await import("./settlementExportRoutes")).default;
    const ghlWebhookRouter = (await import("./ghlWebhookRouter")).default;
    const ghlInboxRouter = (await import("./routes/ghlInboxRouter")).default;
    const vapiWebhookRouter = (await import("./vapiWebhookRouter")).default;
    const redsysRouter = (await import("./redsysRoutes")).default;
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    registerBuiltinModules();
    configureModuleAccess(rt.entitlements);
    const app = express();
    app.set("trust proxy", 1); // como en producción (server/_core/index.ts): HTTPS por X-Forwarded-Proto
    // Acceso centralizado, montado como en tenantRegistry/install.ts (antes de resolver la empresa)
    process.env.CENTRAL_LOGIN_HOST = CENTRAL;
    const { createCentralAuthRouter, tenantUserFinder } = await import("./_core/centralAuth");
    const { getTenantDatabase } = await import("./_core/dbRegistry");
    const { runWithTenant } = await import("./_core/tenant");
    const { passwordFingerprint, createCentralHandoffRouter } = await import("./localAuth");
    const { requestPasswordReset } = await import("./passwordReset");
    app.use(
      createCentralAuthRouter({
        host: CENTRAL,
        listTenants: () => rt.reader.listTenants(),
        listDomains: (id) => rt.reader.listDomains(id),
        findUser: tenantUserFinder(getTenantDatabase),
        passwordFingerprint,
        requestReset: (id, email) => runWithTenant(id, async () => void (await requestPasswordReset(email))),
        log: () => undefined,
      }),
    );
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    app.use(createLocalAuthRouter());
    app.use(createCentralHandoffRouter()!);
    app.use(createPasswordResetRouter());
    app.use("/api/trpc", moduleRouteGuard(getModuleAccess));
    app.use("/api/trpc", createAuthGuardMiddleware(true));
    app.use("/local-storage", localStorageSecurityHeaders);
    app.use("/local-storage", localStorageTenantGuard());
    app.use("/local-storage", express.static(storageDir));
    app.use(redsysRouter);
    app.use(settlementExportRouter);
    app.use(invoicePreviewRouter);
    app.use(ghlWebhookRouter);
    app.use(ghlInboxRouter);
    app.use(vapiWebhookRouter);
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    closeAll = async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await closeAllDatabases();
      await rt.close();
    };

    for (const id of [A, B]) {
      const l = await login(id, `admin@${id}.example`, PASS[id]);
      expect(l.status).toBe(200);
      cookies[id] = sessionOf(l)!;
    }
  }, 300_000);

  afterAll(async () => {
    await closeAll?.();
    for (const id of [A, B]) await admin?.query(`DROP DATABASE IF EXISTS \`es_${id.replace(/-/g, "_")}\``).catch(() => undefined);
    await admin?.end();
    if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true });
    delete process.env.TENANT_MODE;
  });

  // ─── 1. Aislamiento de datos ────────────────────────────────────────────────

  describe("aislamiento de datos entre empresas", () => {
    it("presupuestos, reservas, facturas y clientes: cada empresa ve solo los suyos (mismos ids)", async () => {
      for (const [id, tag] of [[A, "A"], [B, "B"]] as const) {
        expect(data(await q(id, "crm.quotes.get", { id: 1 })).quote.title).toBe(`Presupuesto ${tag}`);
        expect(data(await q(id, "crm.reservations.get", { id: 1 })).reservation.customerName).toBe(`Reserva ${tag}`);
        expect(data(await q(id, "crm.invoices.get", { id: 1 })).clientName).toBe(`Cliente factura ${tag}`);
        expect(data(await q(id, "crm.invoices.list", {})).map((i: any) => i.clientName)).toContain(`Cliente factura ${tag}`);
        expect(JSON.stringify(data(await q(id, "crm.invoices.list", {})))).not.toContain(tag === "A" ? "Cliente factura B" : "Cliente factura A");
        expect(JSON.stringify(data(await q(id, "crm.clients.list", {})))).toContain(`Cliente CRM ${tag}`);
        expect(JSON.stringify(data(await q(id, "crm.clients.list", {})))).not.toContain(tag === "A" ? "Cliente CRM B" : "Cliente CRM A");
      }
    });

    it("IDOR: un id que solo existe en B, pedido con la sesión de A, no devuelve nada de B", async () => {
      const r = await q(A, "crm.invoices.get", { id: 2 });
      expect(r.status).toBe(404);
      expect(r.text).not.toContain("Solo de B");
      // Y la sesión de A contra el host de B: sin sesión válida
      const cross = await q(B, "crm.invoices.get", { id: 2 }, cookies[A]);
      expect(cross.status).toBe(401);
      expect(cross.text).not.toContain("Solo de B");
    });

    it("la cookie de A no sirve en el host de B (tRPC, REST, exportaciones y vista de factura)", async () => {
      for (const proc of ["crm.clients.list", "crm.quotes.list", "crm.reservations.list", "admin.getUsers", "config.listSystemSettings", "products.getAll", "modules.active"]) {
        const r = await q(B, proc, proc.endsWith(".list") ? {} : undefined, cookies[A]);
        expect(r.status, proc).toBe(401);
      }
      expect((await call(host(B), "GET", "/api/auth/me", { cookie: cookies[A] })).status).toBe(401);
      expect((await call(host(B), "GET", "/api/settlements/1/export-excel", { cookie: cookies[A] })).status).toBe(401);
      const prev = await call(host(B), "GET", "/api/invoices/preview?n=FAC-2026-0001", { cookie: cookies[A] });
      expect(prev.status).toBe(401);
      expect(prev.text).not.toContain("Cliente factura B");
      // Mutación con la cookie de A en B: rechazada y sin efecto
      const mut = await m(B, "crm.clients.create", { name: "Intruso", email: `intruso-${run}@cliente.example` }, cookies[A]);
      expect(mut.status).toBe(401);
      expect(JSON.stringify(data(await q(B, "crm.clients.list", {})))).not.toContain("Intruso");
    });

    it("enlace firmado de factura: el de A no abre la factura homónima de B (corrección)", async () => {
      const { invoicePreviewPath } = await import("./_core/signedLinks");
      const { runWithTenant } = await import("./_core/tenant");
      const linkA = runWithTenant(A, () => invoicePreviewPath("FAC-2026-0001"));
      const own = await call(host(A), "GET", linkA);
      expect(own.status).toBe(200);
      expect(own.text).toContain("Cliente factura A");
      const other = await call(host(B), "GET", linkA);
      expect(other.status).toBe(401);
      expect(other.text).not.toContain("Cliente factura B");
    });

    it("productos, usuarios y configuración: cada panel ve solo su empresa", async () => {
      const usersA = data(await q(A, "admin.getUsers")).map((u: any) => u.email);
      const usersB = data(await q(B, "admin.getUsers")).map((u: any) => u.email);
      expect(usersA).toContain(`admin@${A}.example`);
      expect(usersA).not.toContain(`admin@${B}.example`);
      expect(usersB).not.toContain(`admin@${A}.example`);
      // Ningún usuario expone hash ni token de invitación
      expect(JSON.stringify(data(await q(A, "admin.getUsers")))).not.toMatch(/passwordHash|inviteToken"\s*:\s*"/);
      await sql(A, "INSERT INTO system_settings (`key`, value, category, label) VALUES ('brand_name', 'Marca de A', 'theme', 'Marca')  ON DUPLICATE KEY UPDATE value = 'Marca de A'");
      const settingsB = JSON.stringify(data(await q(B, "config.listSystemSettings")));
      expect(settingsB).not.toContain("Marca de A");
      expect(Array.isArray(data(await q(A, "products.getAll")))).toBe(true);
    });

    it("licencias: el módulo licenciado en A no se habilita en B", async () => {
      expect((await q(A, "hotel.adminGetRoomTypes")).status).toBe(200);
      const r = await q(B, "hotel.adminGetRoomTypes");
      expect(r.status).toBe(403);
    });

    it("ficheros: los de A no se sirven en el host de B", async () => {
      expect((await call(host(A), "GET", `/local-storage/t/${A}/doc.txt`)).text).toBe(`documento de ${A}`);
      expect((await call(host(B), "GET", `/local-storage/t/${A}/doc.txt`)).status).toBe(404);
      expect((await call(host(B), "GET", `/local-storage/t/${B}/..%2F${A}%2Fdoc.txt`)).status).toBe(404);
    });

    it("peticiones concurrentes intercaladas A/B en varios routers: nunca se mezclan", async () => {
      const procs = ["crm.invoices.get", "crm.quotes.get"] as const;
      const order = Array.from({ length: 40 }, (_, i) => ({ id: i % 2 ? B : A, proc: procs[i % 4 < 2 ? 0 : 1] }));
      const out = await Promise.all(order.map(async (o) => ({ ...o, r: data(await q(o.id, o.proc, { id: 1 })) })));
      for (const o of out) {
        const tag = o.id === A ? "A" : "B";
        if (o.proc === "crm.invoices.get") expect(o.r.clientName).toBe(`Cliente factura ${tag}`);
        else expect(o.r.quote.title).toBe(`Presupuesto ${tag}`);
      }
    });

    it("tokens globales de entorno (recuperación, formulario de gastos) no abren nada en multi", async () => {
      const rec = await call(host(A), "GET", `/api/admin/diagnose-order/ORDA${run}`, { headers: { "x-recovery-token": process.env.RECOVERY_TOKEN! } });
      expect(rec.status).toBe(401);
      const exp = await q(A, "publicExpenses.categories", { token: process.env.PUBLIC_EXPENSE_FORM_TOKEN }, undefined);
      expect(exp.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── 2. Webhooks ───────────────────────────────────────────────────────────

  describe("webhooks en multiempresa", () => {
    it("sin secreto configurado: GHL (leads), VAPI e inbox GHL rechazan y no escriben nada", async () => {
      const before = await sql<any[]>(A, "SELECT COUNT(*) AS n FROM leads");
      expect((await call(host(A), "POST", "/api/ghl/webhook", { body: { type: "contact_created", email: `ghl-${run}@lead.example`, firstName: "X" } })).status).toBe(401);
      expect((await call(host(A), "POST", "/api/vapi/webhook", { body: { name: "VAPI", email: `vapi-${run}@lead.example` } })).status).toBe(401);
      const inbox = await call(host(A), "POST", "/api/ghl/inbox/webhook", { body: { type: "InboundMessage", id: `evt-${run}` } });
      expect(inbox.status).toBe(200);
      expect(inbox.json).toMatchObject({ ignored: true });
      const after = await sql<any[]>(A, "SELECT COUNT(*) AS n FROM leads");
      expect(Number(after[0].n)).toBe(Number(before[0].n));
      expect(Number((await sql<any[]>(A, "SELECT COUNT(*) AS n FROM ghl_webhook_events"))[0].n)).toBe(0);
    });
  });

  // ─── 3. Autenticación ──────────────────────────────────────────────────────

  describe("autenticación", () => {
    it("cookie de sesión: HttpOnly, SameSite=Lax, Path=/; Secure en producción", async () => {
      const l = await login(A, `admin@${A}.example`, PASS[A]);
      const c = l.cookies.find((x) => x.startsWith("nayade_session="))!;
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Lax/i);
      expect(c).toMatch(/Path=\//);
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const p = await login(A, `admin@${A}.example`, PASS[A]);
        expect(p.cookies.find((x) => x.startsWith("nayade_session="))).toMatch(/;\s*Secure/i);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    it("logout borra la cookie", async () => {
      const r = await call(host(A), "POST", "/api/auth/logout", { cookie: cookies[A] });
      expect(r.status).toBe(200);
      expect(r.cookies.join(";")).toMatch(/nayade_session=;/);
    });

    it("MEDIO-8: por HTTPS la sesión va en __Host-nayade_session y en multiempresa la cookie sin prefijo no vale", async () => {
      const https = { "x-forwarded-proto": "https" };
      const l = await login(A, `admin@${A}.example`, PASS[A], https);
      expect(l.status).toBe(200);
      const c = l.cookies.find((x) => x.startsWith("__Host-nayade_session="))!;
      expect(c).toMatch(/;\s*Secure/i);
      expect(c).toMatch(/;\s*Path=\/(;|$)/);
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Lax/i);
      expect(c).not.toMatch(/Domain=/i);
      expect(l.cookies.some((x) => /^nayade_session=;/.test(x))).toBe(true); // se borra la antigua
      const token = c.split(";")[0].slice("__Host-nayade_session=".length);

      // Con __Host-: autenticado (contexto tRPC y authGuard)
      expect((await call(host(A), "GET", "/api/auth/me", { cookie: `__Host-nayade_session=${token}`, headers: https })).status).toBe(200);
      expect((await call(host(A), "GET", `/api/trpc/admin.getUsers${qs(undefined)}`, { cookie: `__Host-nayade_session=${token}`, headers: https })).status).toBe(200);
      // El mismo token con el nombre sin prefijo (el que otra empresa podría fijar con Domain=<dominio padre>): no vale
      expect((await call(host(A), "GET", "/api/auth/me", { cookie: `nayade_session=${token}`, headers: https })).status).toBe(401);
      expect((await call(host(A), "GET", `/api/trpc/admin.getUsers${qs(undefined)}`, { cookie: `nayade_session=${token}`, headers: https })).status).toBe(401);
      // Y sigue sin autenticar en otra empresa
      expect((await call(host(B), "GET", "/api/auth/me", { cookie: `__Host-nayade_session=${token}`, headers: https })).status).toBe(401);

      // Logout: borra las dos
      const out = await call(host(A), "POST", "/api/auth/logout", { cookie: `__Host-nayade_session=${token}`, headers: https });
      expect(out.cookies.join("\n")).toMatch(/^__Host-nayade_session=;.*Secure/im);
      expect(out.cookies.join("\n")).toMatch(/^nayade_session=;/m);
    });

    it("CSRF: una mutación con cookie válida enviada desde otro origen (otra empresa) no se ejecuta", async () => {
      const evil = { origin: `https://${host(B)}` };
      const r = await m(A, "crm.clients.create", { name: "CSRF", email: `csrf-${run}@cliente.example` }, cookies[A], evil);
      expect(r.status).toBe(401);
      expect(JSON.stringify(data(await q(A, "crm.clients.list", {})))).not.toContain("CSRF");
      // Mismo origen: funciona
      const ok = await m(A, "crm.clients.create", { name: "Mismo origen", email: `same-${run}@cliente.example` }, cookies[A], { origin: `https://${host(A)}` });
      expect(ok.status).toBe(200);
      // Login desde otro origen: rechazado
      expect((await login(A, `admin@${A}.example`, PASS[A], evil)).status).toBe(403);
    });

    it("antifuerza bruta por cuenta: tras 10 fallos se bloquea aunque la contraseña sea correcta; la misma cuenta en otra empresa no se ve afectada", async () => {
      const email = `victima-${run}@empresa.example`;
      await addUser(A, email, "agente");
      await addUser(B, email, "agente");
      for (let i = 0; i < 10; i++) expect((await login(A, email, "incorrecta-" + i)).status).toBe(401);
      const locked = await login(A, email, STAFF_PASS);
      expect(locked.status).toBe(429);
      expect(sessionOf(locked)).toBeUndefined();
      expect((await login(B, email, STAFF_PASS)).status).toBe(200);
      // Un email inexistente responde igual que uno existente (sin enumeración)
      expect((await login(A, `no-existe-${run}@empresa.example`, "x")).json).toEqual((await login(A, `admin@${A}.example`, "x")).json);
    });

    it("recuperación de contraseña: un solo uso (también en paralelo), caducidad y revocación de sesiones", async () => {
      const email = `reset-${run}@empresa.example`;
      const uid = await addUser(A, email, "agente");
      const s = sessionOf(await login(A, email, STAFF_PASS))!;
      expect((await q(A, "crm.clients.list", {}, s)).status).toBe(200);
      const token = crypto.randomBytes(48).toString("hex");
      await sql(A, "INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [uid, token]);
      // El token de A no existe en B
      expect((await call(host(B), "POST", "/api/auth/reset-password", { body: { token, password: "nueva-clave-B-123" } })).status).toBe(400);
      const [r1, r2] = await Promise.all([
        call(host(A), "POST", "/api/auth/reset-password", { body: { token, password: "nueva-clave-1-123" } }),
        call(host(A), "POST", "/api/auth/reset-password", { body: { token, password: "nueva-clave-2-123" } }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 400]);
      expect((await call(host(A), "POST", "/api/auth/reset-password", { body: { token, password: "otra-vez-123" } })).status).toBe(400);
      // La sesión abierta con la contraseña anterior queda revocada
      expect((await q(A, "crm.clients.list", {}, s)).status).toBe(401);
      const winner = r1.status === 200 ? "nueva-clave-1-123" : "nueva-clave-2-123";
      expect((await login(A, email, winner)).status).toBe(200);
      // Token caducado
      const old = crypto.randomBytes(48).toString("hex");
      await sql(A, "INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 1 MINUTE))", [uid, old]);
      expect((await call(host(A), "POST", "/api/auth/reset-password", { body: { token: old, password: "caducada-123" } })).status).toBe(400);
    });

    it("invitaciones: token de un solo uso, con caducidad, y válido solo en su empresa", async () => {
      const inv = data(await m(A, "admin.createUser", { name: "Invitado", email: `invitado-${run}@empresa.example`, role: "agente" }));
      expect(typeof inv.token).toBe("string");
      expect((await m(B, "public.setPassword", { token: inv.token, password: "clave-invitado-1" }, undefined)).status).toBe(404);
      const [s1, s2] = await Promise.all([
        m(A, "public.setPassword", { token: inv.token, password: "clave-invitado-1" }, undefined),
        m(A, "public.setPassword", { token: inv.token, password: "clave-invitado-2" }, undefined),
      ]);
      expect([s1.status, s2.status].sort()).toEqual([200, 404]);
      expect((await m(A, "public.setPassword", { token: inv.token, password: "clave-invitado-3" }, undefined)).status).toBe(404);
      // Caducada
      const inv2 = data(await m(A, "admin.createUser", { name: "Invitado 2", email: `invitado2-${run}@empresa.example`, role: "agente" }));
      await sql(A, "UPDATE users SET inviteTokenExpiry = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE email = ?", [`invitado2-${run}@empresa.example`]);
      expect((await m(A, "public.setPassword", { token: inv2.token, password: "clave-invitado-9" }, undefined)).status).toBe(400);
    });

    it("un restablecimiento deja sin efecto la invitación pendiente (no puede volver a cambiar la contraseña)", async () => {
      const email = `inv-reset-${run}@empresa.example`;
      const inv = data(await m(A, "admin.createUser", { name: "Invitado R", email, role: "agente" }));
      const [row] = await sql<any[]>(A, "SELECT id FROM users WHERE email = ?", [email]);
      const token = crypto.randomBytes(48).toString("hex");
      await sql(A, "INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [row.id, token]);
      expect((await call(host(A), "POST", "/api/auth/reset-password", { body: { token, password: "clave-restablecida-1" } })).status).toBe(200);
      expect((await m(A, "public.setPassword", { token: inv.token, password: "clave-por-invitacion" }, undefined)).status).toBe(404);
      const [after] = await sql<any[]>(A, "SELECT inviteToken, inviteAccepted FROM users WHERE id = ?", [row.id]);
      expect(after).toMatchObject({ inviteToken: null });
      expect(Boolean(after.inviteAccepted)).toBe(true);
      expect((await login(A, email, "clave-restablecida-1")).status).toBe(200);
    });

    it("cambio de contraseña por un administrador: revoca las sesiones del usuario", async () => {
      const email = `revocar-${run}@empresa.example`;
      const uid = await addUser(A, email, "agente");
      const s = sessionOf(await login(A, email, STAFF_PASS))!;
      expect((await q(A, "crm.clients.list", {}, s)).status).toBe(200);
      expect((await m(A, "admin.setUserPassword", { userId: uid, password: "nueva-por-admin-1" })).status).toBe(200);
      expect((await q(A, "crm.clients.list", {}, s)).status).toBe(401);
      // Desactivar también corta el acceso
      const s2 = sessionOf(await login(A, email, "nueva-por-admin-1"))!;
      expect((await m(A, "admin.toggleUserActive", { userId: uid })).status).toBe(200);
      expect((await q(A, "crm.clients.list", {}, s2)).status).toBe(401);
    });

    it("errores sin trazas internas", async () => {
      const r = await m(A, "crm.clients.create", { name: "Duplicado", email: `crm-a@cliente.example` });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.text).not.toMatch(/at \w+ \(|node_modules|Failed query/);
    });
  });

  // ─── 4. Roles ──────────────────────────────────────────────────────────────

  describe("roles: propietario, administrador, empleado y solo lectura", () => {
    let agente: string;
    let lectura: string;
    let admin2: string;
    let admin2Id: number;
    let ownerId: number;

    beforeAll(async () => {
      await addUser(A, `empleado-${run}@empresa.example`, "agente");
      await addUser(A, `lectura-${run}@empresa.example`, "readonly");
      admin2Id = await addUser(A, `admin2-${run}@empresa.example`, "admin");
      agente = sessionOf(await login(A, `empleado-${run}@empresa.example`, STAFF_PASS))!;
      lectura = sessionOf(await login(A, `lectura-${run}@empresa.example`, STAFF_PASS))!;
      admin2 = sessionOf(await login(A, `admin2-${run}@empresa.example`, STAFF_PASS))!;
      ownerId = (await sql<any[]>(A, "SELECT id FROM users WHERE email = ?", [`admin@${A}.example`]))[0].id;
      expect(agente && lectura && admin2).toBeTruthy();
    });

    it("empleado (agente): trabaja con el CRM pero no administra", async () => {
      expect((await q(A, "crm.clients.list", {}, agente)).status).toBe(200);
      expect((await m(A, "crm.clients.create", { name: "Del empleado", email: `emp-${run}@cliente.example` }, agente)).status).toBe(200);
      for (const [proc, input] of [
        ["admin.createUser", { name: "Escalada", email: `esc-${run}@empresa.example`, role: "admin" }],
        ["admin.changeUserRole", { userId: ownerId, role: "agente" }],
        ["config.updateSystemSetting", { key: "brand_name", value: "Hackeada" }],
        ["emailCommunications.sendTestEmail", { templateKey: "x", to: "a@b.example" }],
        ["emailCommunications.upsertTemplateConfig", { templateKey: "x", adminCopyEmail: "fuera@otro.example" }],
      ] as const) {
        const r = await m(A, proc, input, agente);
        expect([400, 403], proc).toContain(r.status);
        if (r.status === 400) expect(errCode(r)).toBe("BAD_REQUEST");
      }
      expect((await q(A, "admin.getUsers", undefined, agente)).status).toBe(403);
    });

    it("usuario sin rol de equipo (`user`): sin acceso a comunicaciones, seguimiento comercial ni órdenes del día (corrección)", async () => {
      await addUser(A, `basico-${run}@empresa.example`, "user");
      const basico = sessionOf(await login(A, `basico-${run}@empresa.example`, STAFF_PASS))!;
      for (const [proc, input] of [
        ["emailCommunications.listCommLog", {}],
        ["commercialFollowup.getDashboard", undefined],
        ["operations.dailyOrders.getForDate", { date: "2026-12-01" }],
        ["legoPacks.getSnapshot", { operationId: 1, operationType: "reservation" }],
      ] as const) {
        expect((await q(A, proc, input, basico)).status, proc).toBe(403);
      }
      expect((await m(A, "commercialFollowup.addNote", { quoteId: 1, note: "x" }, basico)).status).toBe(403);
    });

    it("solo lectura: consulta, pero ninguna mutación (ni de equipo ni de administración)", async () => {
      expect((await q(A, "crm.clients.list", {}, lectura)).status).toBe(200);
      expect((await q(A, "crm.invoices.get", { id: 1 }, lectura)).status).toBe(200);
      for (const [proc, input] of [
        ["crm.clients.create", { name: "Lectura", email: `lect-${run}@cliente.example` }],
        ["crm.clients.delete", { id: 1 }],
        ["discounts.create", { code: `RO${run}`, name: "RO", discountPercent: 5 }],
        ["admin.createUser", { name: "RO", email: `ro-${run}@empresa.example`, role: "admin" }],
      ] as const) {
        const r = await m(A, proc, input, lectura);
        expect(r.status, proc).toBe(403);
      }
      expect(JSON.stringify(data(await q(A, "crm.clients.list", {})))).not.toContain("Lectura");
      expect((await m(A, "auth.logout", {}, lectura)).status).toBe(200);
    });

    it("propietario: otro administrador no puede degradarlo, desactivarlo, borrarlo ni cambiar su contraseña", async () => {
      expect((await m(A, "admin.changeUserRole", { userId: ownerId, role: "agente" }, admin2)).status).toBe(403);
      expect((await m(A, "admin.toggleUserActive", { userId: ownerId }, admin2)).status).toBe(403);
      expect((await m(A, "admin.deleteUser", { userId: ownerId }, admin2)).status).toBe(403);
      expect((await m(A, "admin.setUserPassword", { userId: ownerId, password: "tomada-por-otro" }, admin2)).status).toBe(403);
      // El propietario sigue siendo admin activo y entra con su contraseña
      expect((await login(A, `admin@${A}.example`, PASS[A])).status).toBe(200);
      // El ajuste de propietario no se puede cambiar desde el panel
      expect((await m(A, "config.updateSystemSetting", { key: "company_owner_email", value: `admin2-${run}@empresa.example` }, admin2)).status).toBe(403);
      // El propietario sí gestiona a los demás administradores
      expect((await m(A, "admin.changeUserRole", { userId: admin2Id, role: "agente" })).status).toBe(200);
    });

    it("último administrador: nadie puede dejar la empresa sin administradores activos", async () => {
      // En B el único admin es el propietario; un segundo admin no propietario de B sin otros admins
      const lone = await addUser(B, `unico-${run}@empresa.example`, "admin");
      await sql(B, "DELETE FROM system_settings WHERE `key` = 'company_owner_email'");
      await sql(B, "UPDATE users SET role = 'agente' WHERE email = ?", [`admin@${B}.example`]);
      const s = sessionOf(await login(B, `unico-${run}@empresa.example`, STAFF_PASS))!;
      const other = await addUser(B, `otro-${run}@empresa.example`, "agente");
      expect(other).toBeGreaterThan(0);
      // No puede degradarse/desactivarse a sí mismo siendo el último admin
      const r = await m(B, "admin.changeUserRole", { userId: lone, role: "agente" }, s);
      expect(r.status).toBe(400);
      expect((await m(B, "admin.toggleUserActive", { userId: lone }, s)).status).toBe(400);
    });
  });

  // ─── Acceso centralizado (app.<dominio>) ────────────────────────────────────

  describe("acceso centralizado", () => {
    const origin = { origin: `https://${CENTRAL}` };
    const https = { "x-forwarded-proto": "https" };
    const central = (email: string, password: string, headers: Record<string, string> = origin) =>
      call(CENTRAL, "POST", "/api/central/login", { body: { email, password }, headers });
    const handoff = (h: string, token: string, headers: Record<string, string> = { ...origin, ...https }) =>
      call(h, "POST", "/api/auth/handoff", { body: { token }, headers });
    const sessionCookie = (r: Res) => r.cookies.find((c) => c.startsWith("__Host-nayade_session="))?.split(";")[0];
    const SHARED = `compartida-${run}@ambas.example`;
    const SHARED_PASS = "clave-compartida-" + run;

    it("solo desde la página central y con respuesta genérica: no revela qué correos existen", async () => {
      expect((await central(`admin@${A}.example`, PASS[A], { origin: "https://evil.example" })).status).toBe(403);
      const wrong = await central(`admin@${A}.example`, "incorrecta-" + run);
      const unknown = await central(`nadie-${run}@ningun.example`, "incorrecta-" + run);
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.json).toEqual(unknown.json);
      // Las rutas centrales no existen en el host de una empresa
      expect((await call(host(A), "POST", "/api/central/login", { body: { email: `admin@${A}.example`, password: PASS[A] }, headers: { origin: `https://${host(A)}` } })).status).not.toBe(200);
    });

    it("una empresa: devuelve solo esa, con su host; el pase abre la sesión __Host- de esa empresa", async () => {
      const r = await central(`admin@${A}.example`, PASS[A]);
      expect(r.status).toBe(200);
      expect(r.json.companies.map((c: any) => c.id)).toEqual([A]);
      const c = r.json.companies[0];
      expect(c).toMatchObject({ host: host(A), handoffUrl: `https://${host(A)}/api/auth/handoff` });
      const h = await handoff(host(A), c.token);
      expect(h.status).toBe(303);
      expect(h.location).toBe("/admin");
      const cookie = sessionCookie(h)!;
      expect(cookie).toBeTruthy();
      const me = await call(host(A), "GET", "/api/auth/me", { cookie, headers: https });
      expect(me.status).toBe(200);
      expect(me.json.email).toBe(`admin@${A}.example`);
      // Un solo uso
      const again = await handoff(host(A), c.token);
      expect(again.location).toContain("acceso=caducado");
      expect(sessionCookie(again)).toBeUndefined();
    });

    it("el pase no sirve en otra empresa, ni desde otro origen, ni tras cambiar la contraseña", async () => {
      const t1 = (await central(`admin@${A}.example`, PASS[A])).json.companies[0].token;
      const other = await handoff(host(B), t1);
      expect(other.location).toContain("acceso=caducado");
      expect(sessionCookie(other)).toBeUndefined();
      const t2 = (await central(`admin@${A}.example`, PASS[A])).json.companies[0].token;
      const foreign = await handoff(host(A), t2, { origin: "https://evil.example", ...https });
      expect(foreign.location).toContain("acceso=caducado");
      // Cambio de contraseña después de emitir el pase: el pase deja de valer
      const t3 = (await central(`admin@${A}.example`, PASS[A])).json.companies[0].token;
      const [[row]] = await Promise.all([sql<any[]>(A, "SELECT passwordHash FROM users WHERE email = ?", [`admin@${A}.example`])]);
      await sql(A, "UPDATE users SET passwordHash = ? WHERE email = ?", [await bcrypt.hash("otra-clave-" + run, 4), `admin@${A}.example`]);
      const stale = await handoff(host(A), t3);
      await sql(A, "UPDATE users SET passwordHash = ? WHERE email = ?", [row.passwordHash, `admin@${A}.example`]);
      expect(stale.location).toContain("acceso=caducado");
    });

    it("varias empresas: selector con ambas; una cuenta desactivada en una de ellas no aparece", async () => {
      const hash = await bcrypt.hash(SHARED_PASS, 4);
      for (const id of [A, B]) {
        await sql(id, "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, 'Compartida', ?, 'local', 'admin', 1, ?, 1)", [`central-${id}-${run}`, SHARED, hash]);
      }
      const both = await central(SHARED, SHARED_PASS);
      expect(both.status).toBe(200);
      expect(both.json.companies.map((c: any) => c.id).sort()).toEqual([A, B].sort());
      for (const c of both.json.companies) {
        const h = await handoff(c.host, c.token);
        expect(h.status).toBe(303);
        const me = await call(c.host, "GET", "/api/auth/me", { cookie: sessionCookie(h)!, headers: https });
        expect(me.json.email).toBe(SHARED);
      }
      await sql(B, "UPDATE users SET isActive = 0 WHERE email = ?", [SHARED]);
      expect((await central(SHARED, SHARED_PASS)).json.companies.map((c: any) => c.id)).toEqual([A]);
    });

    it("recuperación central: misma respuesta exista o no el correo", async () => {
      const a = await call(CENTRAL, "POST", "/api/central/forgot", { body: { email: SHARED }, headers: origin });
      const b = await call(CENTRAL, "POST", "/api/central/forgot", { body: { email: `nadie-${run}@ningun.example` }, headers: origin });
      expect(a.status).toBe(200);
      expect(a.json).toEqual(b.json);
      expect((await call(CENTRAL, "POST", "/api/central/forgot", { body: { email: SHARED }, headers: { origin: "https://evil.example" } })).status).toBe(403);
    });
  });
});
