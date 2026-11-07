/**
 * Elephant Connect · Brevo marketing con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL) y un
 * Brevo SIMULADO detrás de `fetch` (ninguna llamada sale a Internet): licencia email-campaigns, clave en la bóveda
 * desde Integraciones (cifrada), prueba de conexión, lista, consentimiento con prueba, sincronización con bajas, una
 * ejecución a la vez, clave revocada sin reintento, desconexión, job sin configurar y migración revertida.
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

// Prefijo de claves de Brevo construido en ejecución: los valores de prueba no deben parecer claves reales (gitleaks)
const FAKE_PREFIX = ["xkey", "sib-"].join("");

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const T = `brevo-${run}`;
const MIGRATIONS_DIR = process.env.SKI_TEST_MIGRATIONS_DIR ?? path.resolve(__dirname, "../db/migrations");
const PASS = "clave-ski-" + run;

describe.skipIf(!URL_)("Brevo marketing (routers reales, Brevo simulado)", () => {
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
      await caps.apply(T, [{ capabilityId: "email-campaigns", siteId, status: status as never, validUntil: null, source: "operator" }], { actor: "operator:test", reason: "prueba", now: Date.now() + ++n });
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

  const KEY = FAKE_PREFIX + "clave-de-pruebas-" + run + "-0000000000";
  /** Brevo simulado detrás de `fetch` (ninguna llamada sale a Internet). */
  const brevo = { list: new Map<string, { unsub: boolean }>(), calls: [] as string[] };
  const realFetch = globalThis.fetch;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.brevo.com/")) return realFetch(input as never, init);
    const u = new URL(url);
    const path = u.pathname.replace("/v3", "");
    brevo.calls.push(`${init?.method ?? "GET"} ${path}`);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (headers["api-key"] !== KEY) return reply(401);
    if (path === "/account") return reply(200, { companyName: "Empresa de pruebas" });
    if (path === "/contacts/lists") return reply(200, { lists: [{ id: 7, name: "Clientes", totalSubscribers: brevo.list.size }], count: 1 });
    if (path === "/contacts/lists/7") return reply(200, { id: 7, name: "Clientes" });
    if (path === "/contacts/lists/7/contacts") {
      const all = Array.from(brevo.list.entries());
      return reply(200, { contacts: all.map(([email, c]) => ({ email, emailBlacklisted: false, listUnsubscribed: c.unsub ? [7] : [] })), count: all.length });
    }
    if (path === "/contacts/import") {
      for (const c of JSON.parse(String(init!.body)).jsonBody) if (!brevo.list.has(c.email)) brevo.list.set(c.email, { unsub: false });
      return reply(202, { processId: 1 });
    }
    if (path === "/contacts/lists/7/contacts/remove") {
      for (const e of JSON.parse(String(init!.body)).emails) brevo.list.delete(e);
      return reply(201, {});
    }
    return reply(404);
  };
  let ids: number[] = [];

  /** Revierte o vuelve a aplicar la migración de Brevo con las sentencias reales del carril y su registro. */
  async function brevoMigration(direction: "down" | "up") {
    const m = loadMigrations(MIGRATIONS_DIR).migrations.find((x) => x.id.endsWith("_brevo_marketing"))!;
    for (const st of splitStatements(direction === "down" ? m.down! : m.up)) await tenantDb.query(st);
    if (direction === "down") await tenantDb.query("DELETE FROM __elephant_migrations WHERE id = ?", [m.id]);
    else await tenantDb.query("INSERT INTO __elephant_migrations (id, checksum) VALUES (?, ?)", [m.id, m.checksum]);
  }

  beforeAll(() => {
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("la migración creó sus tablas; sin licencia email-campaigns, 403", async () => {
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES");
    const names = rows.map((r) => String(Object.values(r)[0]));
    expect(names).toEqual(expect.arrayContaining(["brevo_contact_sync", "brevo_marketing_settings", "brevo_sync_runs", "customer_marketing_consent_log", "customer_marketing_consents"]));
    expect((await query("brevoMarketing.status")).status).toBe(403);
  });

  it("clave en la bóveda desde Integraciones, prueba de conexión y lista; separada del correo de la plataforma", async () => {
    await license("active");
    ok(await query("brevoMarketing.status"));
    expect(fail(await query("brevoMarketing.lists"))).toMatchObject({ status: 412 });
    ok(await mutate("integrations.save", { provider: "brevo_marketing", values: { apiKey: KEY } }));
    const t = ok(await mutate("integrations.test", { provider: "brevo_marketing" }));
    expect(t).toMatchObject({ ok: true });
    const [[stored]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT is_secret, value FROM integration_credentials WHERE provider = 'brevo_marketing' AND field = 'apiKey'")) as unknown as [[any]];
    expect(stored.is_secret).toBe(1);
    expect(String(stored.value)).not.toContain(KEY);
    expect(ok(await query("brevoMarketing.lists")).map((l: { name: string }) => l.name)).toEqual(["Clientes"]);
    expect(ok(await mutate("brevoMarketing.chooseList", { listId: 7 })).listName).toBe("Clientes");
  });

  it("solo los clientes con consentimiento salen; bajas de Brevo respetadas; una ejecución a la vez", async () => {
    for (const [i, n] of ["Ana", "Bea", "Carla"].entries()) {
      const [r] = await tenantDb.query("INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [`${n} Ficticia`, `${n.toLowerCase()}-${run}@cliente.example`]);
      ids[i] = (r as { insertId: number }).insertId;
    }
    expect(fail(await mutate("brevoMarketing.grantConsent", { clientId: ids[0], source: "form", evidence: "" })).status).toBe(400);
    ok(await mutate("brevoMarketing.grantConsent", { clientId: ids[0], source: "form", evidence: "Casilla del formulario de reserva" }));
    ok(await mutate("brevoMarketing.grantConsent", { clientId: ids[1], source: "in_person", evidence: "Hoja firmada en tienda" }));
    // Una ejecución a la vez (la BD lo garantiza); una «en curso» de hace más de 30 minutos se da por caída
    const [stale] = await tenantDb.query("INSERT INTO brevo_sync_runs (trigger_kind, list_id, actor) VALUES ('manual', 7, 'test')");
    expect(fail(await mutate("brevoMarketing.sync", {})).status).toBe(409);
    await tenantDb.query("UPDATE brevo_sync_runs SET started_at = NOW(3) - INTERVAL 31 MINUTE WHERE id = ?", [(stale as { insertId: number }).insertId]);
    const r1 = ok(await mutate("brevoMarketing.sync", {}));
    expect(r1).toMatchObject({ status: "completed", exported: 2 });
    expect(Array.from(brevo.list.keys()).sort()).toEqual([`ana-${run}@cliente.example`, `bea-${run}@cliente.example`]);
    // Baja en Brevo y retirada en el CRM
    brevo.list.set(`bea-${run}@cliente.example`, { unsub: true });
    ok(await mutate("brevoMarketing.withdrawConsent", { clientId: ids[0], reason: "Lo pidió" }));
    const r2 = ok(await mutate("brevoMarketing.sync", {}));
    expect(r2).toMatchObject({ status: "completed", removed: 1, unsubscribed: 1 });
    const [log] = await tenantDb.query<mysql.RowDataPacket[]>("SELECT client_id, new_status, source FROM customer_marketing_consent_log ORDER BY id");
    expect(log.map((l) => `${l.new_status}:${l.source}`)).toEqual(["granted:form", "granted:in_person", "withdrawn:manual", "withdrawn:brevo_unsubscribe"]);
    expect(brevo.calls.some((c) => c.includes("/smtp/"))).toBe(false);
  });

  it("clave revocada: ejecución fallida sin reintento; desconectar borra la clave y conserva el historial", async () => {
    ok(await mutate("integrations.save", { provider: "brevo_marketing", values: { apiKey: FAKE_PREFIX + "revocada-00000000000000000000" } }));
    const bad = ok(await mutate("brevoMarketing.sync", {}));
    expect(bad).toMatchObject({ status: "failed", errorMessage: "Brevo rechaza la clave API" });
    expect(fail(await mutate("brevoMarketing.retry", { runId: bad.id })).status).toBe(412);
    ok(await mutate("brevoMarketing.disconnect", {}));
    const [cred] = await tenantDb.query<mysql.RowDataPacket[]>("SELECT 1 FROM integration_credentials WHERE provider = 'brevo_marketing'");
    expect(cred).toHaveLength(0);
    expect(ok(await query("brevoMarketing.runs")).length).toBe(4);
    expect(ok(await query("brevoMarketing.status"))).toMatchObject({ connected: false, autoSync: false, listId: null });
  });

  it("job: con la empresa sin clave o sin sincronización automática no hace nada; sin instalar, error claro", async () => {
    const { brevoMarketingService } = await import("./brevoMarketing/runtime");
    const { runWithTenant } = await import("./_core/tenant");
    const { withTenantDb } = await import("./_core/dbRegistry");
    expect(await runWithTenant(T, () => withTenantDb(T, () => brevoMarketingService().runScheduled()))).toEqual({ skipped: "auto_sync_off" });
    await brevoMigration("down");
    expect(fail(await query("brevoMarketing.status"))).toMatchObject({ status: 412 });
    expect((await query("products.getAll")).status).toBe(200);
    await brevoMigration("up");
    ok(await query("brevoMarketing.status"));
  }, 60_000);
});
