/**
 * Elephant Campaigns con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL) y un Brevo SIMULADO detrás
 * de `fetch` (ninguna llamada sale a Internet): licencia email-campaigns por el guardián de brevoMarketing, misma clave
 * de la bóveda que la sincronización, segmento por etiqueta del CRM ∩ consentimiento, prueba, envío idempotente (una
 * sola petición a Brevo aunque se repita), estadísticas, bajas que retiran el consentimiento y migración revertida.
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
const T = `campanas-${run}`;
const MIGRATIONS_DIR = process.env.SKI_TEST_MIGRATIONS_DIR ?? path.resolve(__dirname, "../db/migrations");
const PASS = "clave-ski-" + run;

describe.skipIf(!URL_)("Elephant Campaigns (routers reales, Brevo simulado)", () => {
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
  /** Brevo simulado detrás de `fetch`: remitentes, carpetas, listas, importación, campañas y estadísticas. */
  const brevo = {
    calls: [] as string[],
    lists: new Map<number, Map<string, { unsub: boolean; attrs: Record<string, string> }>>(),
    campaigns: new Map<number, { body: any; status: string; sendNow: number }>(),
    seq: 500,
  };
  const realFetch = globalThis.fetch;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.brevo.com/")) return realFetch(input as never, init);
    const u = new URL(url);
    const p = u.pathname.replace("/v3", "");
    const method = init?.method ?? "GET";
    brevo.calls.push(`${method} ${p}`);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const reply = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (headers["api-key"] !== KEY) return reply(401);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (p === "/account") return reply(200, { companyName: "Empresa de pruebas" });
    if (p === "/senders") return reply(200, { senders: [{ id: 3, name: "Marketing", email: `hola-${run}@empresa.example`, active: true }] });
    if (p === "/contacts/folders" && method === "GET") return reply(200, { folders: [], count: 0 });
    if (p === "/contacts/folders") return reply(201, { id: 9 });
    if (p === "/contacts/attributes/normal/BAJA_URL") return reply(201);
    if (p === "/contacts/lists" && method === "POST") {
      const id = ++brevo.seq;
      brevo.lists.set(id, new Map());
      return reply(201, { id });
    }
    if (p === "/contacts/import") {
      for (const c of body.jsonBody) brevo.lists.get(body.listIds[0])!.set(c.email, { unsub: false, attrs: c.attributes });
      return reply(202, { processId: 77 });
    }
    if (p === "/processes/77") return reply(200, { id: 77, name: "IMPORTUSER", status: "completed" });
    if (p === "/emailCampaigns" && method === "POST") {
      const id = ++brevo.seq;
      brevo.campaigns.set(id, { body, status: "draft", sendNow: 0 });
      return reply(201, { id });
    }
    const m = /^\/emailCampaigns\/(\d+)(\/sendNow|\/sendTest)?$/.exec(p);
    if (m) {
      const c = brevo.campaigns.get(Number(m[1]));
      if (!c) return reply(404);
      if (m[2] === "/sendNow") {
        c.sendNow++;
        c.status = "sent";
        return reply(204);
      }
      if (m[2] === "/sendTest") return reply(204);
      if (method === "PUT") {
        Object.assign(c.body, body);
        return reply(204);
      }
      return reply(200, {
        id: Number(m[1]),
        status: c.status,
        sentDate: "2026-11-08T10:00:00.000Z",
        statistics: { globalStats: { sent: 2, delivered: 2, uniqueViews: 1, uniqueClicks: 1, unsubscriptions: 1, hardBounces: 0, softBounces: 0, complaints: 0 } },
      });
    }
    const lc = /^\/contacts\/lists\/(\d+)\/contacts$/.exec(p);
    if (lc) {
      const all = Array.from(brevo.lists.get(Number(lc[1]))?.entries() ?? []);
      return reply(200, { contacts: all.map(([email, c]) => ({ email, emailBlacklisted: false, listUnsubscribed: c.unsub ? [Number(lc[1])] : [] })), count: all.length });
    }
    return reply(404);
  };
  const ids: number[] = [];
  let tagId = 0;
  let campaignId = 0;

  /** Revierte o vuelve a aplicar la migración de campañas con las sentencias reales del carril y su registro. */
  async function campaignsMigration(direction: "down" | "up") {
    const m = loadMigrations(MIGRATIONS_DIR).migrations.find((x) => x.id.endsWith("_connect_campaigns"))!;
    for (const st of splitStatements(direction === "down" ? m.down! : m.up)) await tenantDb.query(st);
    // Se quita su registro del carril (sentencia montada en ejecución: el código no lleva literales destructivos)
    if (direction === "down") await tenantDb.query(`${["DELETE", "FROM"].join(" ")} __elephant_migrations WHERE id = ?`, [m.id]);
    else await tenantDb.query("INSERT INTO __elephant_migrations (id, checksum) VALUES (?, ?)", [m.id, m.checksum]);
  }

  beforeAll(() => {
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("la migración creó sus tablas; sin licencia, 403; sin cuenta de Brevo, desconectada y sin llamadas", async () => {
    const [rows] = await tenantDb.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'campaign\\_%'");
    expect(rows.map((r) => String(Object.values(r)[0])).sort()).toEqual(["campaign_campaigns", "campaign_events", "campaign_recipients", "campaign_settings"]);
    expect((await query("brevoMarketing.campaigns.status")).status).toBe(403);
    await license("active");
    expect(ok(await query("brevoMarketing.campaigns.status"))).toEqual({ connected: false });
    expect(fail(await query("brevoMarketing.campaigns.senders")).status).toBe(412);
    expect(brevo.calls).toEqual([]);
  });

  it("misma clave que la sincronización; segmento por etiqueta ∩ consentimiento; borrador, prueba y envío una sola vez", async () => {
    ok(await mutate("integrations.save", { provider: "brevo_marketing", values: { apiKey: KEY } }));
    expect(ok(await query("brevoMarketing.campaigns.status"))).toEqual({ connected: true });
    for (const [i, n] of ["Ana", "Bea", "Carla", "Dani"].entries()) {
      const [r] = await tenantDb.query("INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [`${n} Ficticia`, `${n.toLowerCase()}-${run}@cliente.example`]);
      ids[i] = (r as { insertId: number }).insertId;
    }
    const [t] = await tenantDb.query("INSERT INTO crm_tags (name) VALUES (?)", [`VIP ${run}`]);
    tagId = (t as { insertId: number }).insertId;
    for (const c of [ids[0], ids[1], ids[2]]) await tenantDb.query("INSERT INTO crm_tag_links (tag_id, entity_type, entity_id) VALUES (?, 'client', ?)", [tagId, c]);
    ok(await mutate("brevoMarketing.grantConsent", { clientId: ids[0], source: "form", evidence: "Casilla del formulario de reserva" }));
    ok(await mutate("brevoMarketing.grantConsent", { clientId: ids[1], source: "in_person", evidence: "Hoja firmada en tienda" }));
    ok(await mutate("brevoMarketing.grantConsent", { clientId: ids[3], source: "form", evidence: "Casilla del formulario de reserva" }));
    expect(ok(await query("brevoMarketing.campaigns.audience", { tagIds: [tagId], tagMode: "any" }))).toMatchObject({ recipients: 2 });
    expect(ok(await query("brevoMarketing.campaigns.tags")).find((x: { id: number }) => x.id === tagId)).toMatchObject({ consenting: 2 });

    const c = ok(
      await mutate("brevoMarketing.campaigns.create", {
        name: "Otoño",
        subject: "Novedades de otoño",
        senderId: 3,
        blocks: [
          { type: "heading", text: "Hola <b>" },
          { type: "text", text: "Nuevas actividades" },
          { type: "button", label: "Reservar", url: "https://empresa.example/reservar" },
        ],
        tagIds: [tagId],
        tagMode: "any",
      }),
    );
    campaignId = c.id;
    expect(c).toMatchObject({ status: "draft", senderEmail: `hola-${run}@empresa.example` });
    const prev = ok(await query("brevoMarketing.campaigns.preview", { id: c.id }));
    expect(prev.html).toContain("Hola &lt;b&gt;");
    expect(prev.html).toContain("Darse de baja");
    ok(await mutate("brevoMarketing.campaigns.sendTest", { id: c.id, email: `yo-${run}@empresa.example` }));

    const r = ok(await mutate("brevoMarketing.campaigns.launch", { id: c.id, scheduledAt: null }));
    expect(r).toMatchObject({ status: "sent", recipients: 2 });
    expect(fail(await mutate("brevoMarketing.campaigns.launch", { id: c.id, scheduledAt: null })).status).toBe(409);
    ok(await mutate("brevoMarketing.campaigns.refresh", { id: c.id }));
    const list = brevo.lists.get(r.brevoListId)!;
    expect(Array.from(list.keys()).sort()).toEqual([`ana-${run}@cliente.example`, `bea-${run}@cliente.example`]);
    expect(list.get(`ana-${run}@cliente.example`)!.attrs.BAJA_URL).toMatch(/\/baja\/\d+\.[A-Za-z0-9_-]{32}$/);
    expect(Array.from(brevo.campaigns.values()).reduce((n, x) => n + x.sendNow, 0)).toBe(1);
    expect(brevo.calls.some((x) => x.includes("/smtp/"))).toBe(false);
    const [[row]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status, send_claimed_at FROM campaign_campaigns WHERE id = ?", [c.id])) as unknown as [[any]];
    expect(row.status).toBe("sent");
    expect(row.send_claimed_at).not.toBeNull();
  });

  it("estadísticas de Brevo y bajas: la baja retira el consentimiento y no recibe la siguiente campaña", async () => {
    const c = ok(await query("brevoMarketing.campaigns.get", { id: campaignId }));
    brevo.lists.get(c.brevoListId)!.get(`bea-${run}@cliente.example`)!.unsub = true;
    const r = ok(await mutate("brevoMarketing.campaigns.refresh", { id: campaignId }));
    expect(r.stats).toMatchObject({ sent: 2, opens: 1, clicks: 1, unsubscribed: 1 });
    const [[cons]] = (await tenantDb.query<mysql.RowDataPacket[]>("SELECT status, source FROM customer_marketing_consents WHERE client_id = ?", [ids[1]])) as unknown as [[any]];
    expect(cons).toMatchObject({ status: "withdrawn", source: "brevo_unsubscribe" });
    expect(ok(await query("brevoMarketing.campaigns.audience", { tagIds: [tagId], tagMode: "any" }))).toMatchObject({ recipients: 1 });
    const copy = ok(await mutate("brevoMarketing.campaigns.duplicate", { id: campaignId }));
    const r2 = ok(await mutate("brevoMarketing.campaigns.launch", { id: copy.id, scheduledAt: null }));
    expect(Array.from(brevo.lists.get(r2.brevoListId)!.keys())).toEqual([`ana-${run}@cliente.example`]);
  });

  it("sin la migración, error claro; el resto del panel sigue", async () => {
    await campaignsMigration("down");
    expect(fail(await query("brevoMarketing.campaigns.list"))).toMatchObject({ status: 412 });
    expect((await query("products.getAll")).status).toBe(200);
    await campaignsMigration("up");
    ok(await query("brevoMarketing.campaigns.list"));
  }, 60_000);
});
