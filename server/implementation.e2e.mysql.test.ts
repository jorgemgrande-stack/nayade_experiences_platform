/**
 * Implantación asistida de punta a punta por HTTP con la aplicación REAL del plano de control sobre MySQL desechable
 * (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada con todas las migraciones del CRM, creada y borrada aquí). Datos
 * sintéticos; el correo va a un proveedor en memoria (nada sale a la red) y la suscripción es en modo sombra.
 *
 *   web → solicitud de una solución asistida → lead, empresa, contacto, oportunidad y expediente en la cola
 *   → responsable → propuesta (contrato en borrador con condiciones y plazo) → firma → orden con hitos → preparada
 *   → habilitada (plataforma creada, sin bienvenida) → comunicada (un correo) → prueba de 15 días desde la
 *   comunicación con sus licencias y el contrato activo. Repetir cada paso no duplica nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { WebAdminService } from "./web/service";
import { MysqlWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { createContractActivation } from "./crm/activation";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MysqlSubscriptionStore } from "./subscriptions/store";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService } from "./mail/service";
import { MysqlMailStore } from "./mail/store";
import { PlatformMailer } from "./mail/platform";
import { MysqlImplementationStore, implementationTablesReady } from "./implementation/store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "implantacion_asistida_e2e";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const TOKEN = "implantacion-operador-token-aaaaaaaaaaaaaaa";
const WEB = "https://web.example";
const SECRET = "secreto-de-formulario-implantacion-0123456789abcdef";
const SOLUTION = "connect-people";
const DAY = 86_400_000;

describe.skipIf(!URL_)("implantación asistida de punta a punta (MySQL real)", { timeout: 60_000 }, () => {
  let clock = Date.UTC(2026, 9, 20, 9);
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let server: http.Server;
  let offServer: http.Server;
  let port = 0;
  let offPort = 0;
  let crmStore: MysqlCrmStore;
  let crm: CrmService;
  const caps = new MemoryCapabilityStore();
  const provider = memoryProvider();
  let seedAdminCalls = 0;

  type Res = { status: number; json: any };
  const call = (method: string, p: string, o: { body?: unknown; auth?: boolean; headers?: Record<string, string>; port?: number } = {}) =>
    new Promise<Res>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        { host: "127.0.0.1", port: o.port ?? port, path: `/cp/v1${p}`, method, headers: { ...(o.auth === false ? { origin: WEB } : { authorization: `Bearer ${TOKEN}` }), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
    const r = await p;
    if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const count = async (sql: string, args: unknown[] = []) => Number(((await pool.query(sql, args)) as unknown as [Array<{ n: number }>])[0][0].n);
  const until = async (fn: () => Promise<boolean>) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("no llegó al estado esperado");
  };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 10 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    for (const m of loadMigrations(DIR).migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await implementationTablesReady(pool)).toBe(true);

    const webStore = new MysqlWebStore(pool);
    await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
    crmStore = new MysqlCrmStore(pool);
    const registry = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const reg = new TenantRegistryService(registry, () => ring);
    const provisioning = new ProvisioningService({
      registry: reg,
      reader: registry,
      databases: { ensureDatabase: async (id) => ({ dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
      schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
      seeder: { seedAdmin: async () => (seedAdminCalls++, { created: true, inviteToken: crypto.randomBytes(8).toString("hex") }), seedBranding: async () => undefined },
      entitlements: { grant: async () => undefined },
      quotas: { set: async () => undefined },
      store: new MemoryProvisioningStore(),
      now: () => clock,
      sleep: async () => undefined,
    });
    crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "e2e" } }), now: () => clock });
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "example" } as NodeJS.ProcessEnv);
    const mailer = new PlatformMailer(new MailService({ lane: "platform", store: new MysqlMailStore(pool), provider, policy, now: () => clock }), policy);
    const base = {
      tokens: [{ id: "operador", sha256: hashToken(TOKEN), scopes: ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read"] as const }].map((t) => ({ ...t, scopes: [...t.scopes] })),
      registry: reg,
      reader: registry,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      provisioning,
      platformDomain: "elephant.test",
      crm: { service: crm, store: crmStore },
      web: { store: webStore },
      subscriptions: { store: new MysqlSubscriptionStore(pool), now: () => clock },
      capabilities: caps,
      publicIntake: { origins: [WEB], secret: SECRET, now: () => clock, perIp: 100 },
      mail: { platform: mailer },
    };
    server = http.createServer(createControlPlaneApp({ ...base, implementation: { store: new MysqlImplementationStore(pool), assignees: async () => [{ id: "laura", name: "Laura Demo" }] } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    // Mismo plano de control con el interruptor apagado (sin `implementation`): nada se monta
    offServer = http.createServer(createControlPlaneApp(base));
    await new Promise<void>((r) => offServer.listen(0, "127.0.0.1", r));
    offPort = (offServer.address() as AddressInfo).port;
  }, 180_000);

  afterAll(async () => {
    for (const s of [server, offServer]) {
      s?.closeAllConnections();
      await new Promise<void>((r) => (s ? s.close(() => r()) : r()));
    }
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const st: { id?: number; companyId?: number; contractId?: number; tenantId?: string; leadRequestId?: number; communicatedAt?: number } = {};

  it("con el interruptor apagado no hay rutas ni apertura automática", async () => {
    expect((await call("GET", "/implementations", { port: offPort })).status).toBe(404);
  });

  it("1-5: la solicitud de la web abre el expediente (contacto, oportunidad y cola) una sola vez", async () => {
    const ticket = (await ok(call("GET", "/public/form-ticket", { auth: false }))).ticket as string;
    clock += 5000;
    await ok(
      call("POST", "/public/requests", {
        auth: false,
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { type: "extension_info", name: "Ana Ensayo", email: "ana@implantacion.example", company: "Implantación Ejemplo SL", interest: SOLUTION, consents: { privacy: true, marketing: false }, privacyVersion: "2026-10-borrador", ticket, website: "" },
      }),
      [200, 201],
    );
    await until(async () => (await count("SELECT COUNT(*) AS n FROM implementation_orders")) === 1);
    const list = await ok(call("GET", "/implementations?open=1"));
    expect(list.implementations).toHaveLength(1);
    const o = list.implementations[0];
    expect(o).toMatchObject({ status: "requested", solutionKey: SOLUTION, queue: "implantacion" });
    st.id = o.id;
    st.companyId = o.companyId;
    st.leadRequestId = o.leadRequestId;
    expect(await count("SELECT COUNT(*) AS n FROM crm_contacts WHERE company_id = ? AND email = ?", [o.companyId, "ana@implantacion.example"])).toBe(1);
    expect(o.opportunityId).toBeTruthy();
    // Abrirlo a mano otra vez devuelve el mismo
    const again = await ok(call("POST", "/implementations", { body: { leadRequestId: st.leadRequestId } }));
    expect(again).toMatchObject({ created: false, order: { id: st.id } });
    await ok(call("POST", `/implementations/${st.id}/assignee`, { body: { assigneeId: "laura" } }));
    expect((await call("POST", `/implementations/${st.id}/assignee`, { body: { assigneeId: "otro" } })).status).toBe(400);
  });

  it("6-9: propuesta con condiciones y plazo; la firma del contrato abre la orden de implantación", async () => {
    expect((await call("POST", `/implementations/${st.id}/proposal`, { body: { conditions: "corto", timeline: "x", startMode: "trial" } })).status).toBe(400);
    const p = await ok(call("POST", `/implementations/${st.id}/proposal`, { body: { conditions: "Implantación acompañada en tres sesiones, sin cargos durante la prueba.", timeline: "Tres semanas desde la reunión de arranque", startMode: "trial", planId: "essential" } }));
    st.contractId = p.implementation.contractId;
    expect(p.implementation).toMatchObject({ status: "proposal", startMode: "trial", targetDate: null });
    expect((await ok(call("POST", `/implementations/${st.id}/acceptance`))).accepted).toBe(false);
    await crm.setContractStatus(st.contractId!, "sent", "operator:e2e");
    await crm.setContractStatus(st.contractId!, "signed", "operator:e2e", { signatureRef: "firma-ensayo" });
    await Promise.all([call("POST", `/implementations/${st.id}/acceptance`), call("POST", `/implementations/${st.id}/acceptance`)]);
    const d = await ok(call("GET", `/implementations/${st.id}`));
    expect(d.order.status).toBe("accepted");
    expect(d.milestones).toHaveLength(5);
    expect(d.contract).toMatchObject({ id: st.contractId, status: "signed" });
    expect(await count("SELECT COUNT(*) AS n FROM implementation_events WHERE order_id = ? AND type = 'accepted'", [st.id])).toBe(1);
  });

  it("10-12: hitos y pendientes; preparada dos veces no duplica", async () => {
    const m = await ok(call("POST", `/implementations/${st.id}/milestones`, { body: { title: "Acceso al sistema anterior del cliente", kind: "pending", required: true } }), 201);
    expect((await call("POST", `/implementations/${st.id}/ready`, { body: {} })).status).toBe(409);
    const d = await ok(call("GET", `/implementations/${st.id}`));
    for (const x of d.milestones) await ok(call("POST", `/implementations/${st.id}/milestones/${x.id}/done`, { body: { done: true } }));
    await ok(call("PATCH", `/implementations/${st.id}/milestones/${m.milestone.id}`, { body: { note: "Credenciales recibidas por el canal seguro" } }));
    const [a, b] = await Promise.all([call("POST", `/implementations/${st.id}/ready`, { body: {} }), call("POST", `/implementations/${st.id}/ready`, { body: {} })]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    expect(await count("SELECT COUNT(*) AS n FROM implementation_events WHERE order_id = ? AND type = 'ready'", [st.id])).toBe(1);
  });

  it("13-15: habilitar sin bienvenida; comunicar inicia la prueba de 15 días con licencias; repetir no duplica", async () => {
    const e = await ok(call("POST", `/implementations/${st.id}/enable`));
    st.tenantId = e.implementation.tenantId;
    expect(st.tenantId).toBeTruthy();
    await ok(call("POST", `/implementations/${st.id}/enable`));
    expect(seedAdminCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM mail_outbox")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?", [st.companyId])).toBe(0);
    clock += 6 * DAY;
    st.communicatedAt = clock;
    const [c1, c2] = await Promise.all([call("POST", `/implementations/${st.id}/communicate`), call("POST", `/implementations/${st.id}/communicate`)]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    const d = await ok(call("GET", `/implementations/${st.id}`));
    expect(d.order).toMatchObject({ status: "started", communicatedAt: st.communicatedAt, trialEndsAt: st.communicatedAt + 15 * DAY });
    expect(d.next).toBeNull();
    const [subs] = (await pool.query("SELECT id, status, trial_end, contract_id FROM subscriptions WHERE company_id = ?", [st.companyId])) as unknown as [Array<{ id: number; status: string; trial_end: number; contract_id: number }>];
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ status: "trialing", contract_id: st.contractId });
    expect(Number(subs[0].trial_end)).toBe(st.communicatedAt + 15 * DAY);
    const [items] = (await pool.query("SELECT product_key FROM subscription_items WHERE subscription_id = ?", [subs[0].id])) as unknown as [Array<{ product_key: string }>];
    expect(items.map((i) => i.product_key).sort()).toEqual([SOLUTION, "essential"].sort());
    expect((await caps.list(st.tenantId!)).filter((g) => g.status === "active").length).toBeGreaterThan(0);
    expect((await crmStore.get("contracts", st.contractId!))!.status).toBe("active");
    const [mail] = (await pool.query("SELECT category FROM mail_outbox")) as unknown as [Array<{ category: string }>];
    expect(mail.map((m) => m.category)).toEqual(["tenant_welcome"]);
    // Repetir comunicar o iniciar no duplica correo, suscripción ni eventos
    await ok(call("POST", `/implementations/${st.id}/communicate`));
    await ok(call("POST", `/implementations/${st.id}/start`));
    expect(await count("SELECT COUNT(*) AS n FROM mail_outbox")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?", [st.companyId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM implementation_events WHERE order_id = ? AND type IN ('communicated','started')", [st.id])).toBe(2);
    expect(seedAdminCalls).toBe(1);
  });

  it("la BD impide dos expedientes abiertos de la misma empresa y solución", async () => {
    const store = new MysqlImplementationStore(pool);
    const opp = await crm.createOpportunity({ companyId: st.companyId!, title: "Otra solución" }, "operator:e2e");
    const a = await ok(call("POST", "/implementations", { body: { opportunityId: opp.id, solutionKey: "connect-voice" } }), 201);
    expect((await ok(call("POST", "/implementations", { body: { opportunityId: opp.id, solutionKey: "connect-voice" } }))).order.id).toBe(a.order.id);
    await expect(store.create({ companyId: st.companyId!, opportunityId: opp.id, leadRequestId: null, solutionKey: "connect-voice", solutionName: "x", requestSnapshot: null, assigneeId: null, assigneeName: null, queue: null, createdBy: "t", createdAt: clock })).rejects.toThrow(/duplicado/);
    await ok(call("POST", `/implementations/${a.order.id}/cancel`, { body: { reason: "Prueba de cierre" } }));
    expect((await ok(call("POST", "/implementations", { body: { opportunityId: opp.id, solutionKey: "connect-voice" } }), 201)).created).toBe(true);
  });
});
