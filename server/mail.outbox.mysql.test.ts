/**
 * Servicio de correo sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL). Datos sintéticos (.example);
 * el proveedor es siempre en memoria o un `fetch` falso: no sale ningún correo.
 *  - Migraciones 0010 (empresa) y 0011 (CRM comercial): aplicar, revertir y volver a aplicar.
 *  - Idempotencia con envíos concurrentes; una sola reserva por mensaje con dos despachadores a la vez.
 *  - Reintentos con espera y «failed» controlado con Brevo caído; cuerpo y dirección borrados en la base.
 *  - Core en multiempresa con DOS empresas (bases separadas): `sendEmail` real → bandeja de cada empresa,
 *    remitente de plataforma con su nombre y Reply-To, sandbox que bloquea destinatarios no autorizados,
 *    enlaces a Náyade o al host global rechazados, empresa sin migración → no se envía.
 *  - Webhook: eventos de una empresa actualizan SOLO su base (resolución por DSN), los de plataforma la del CRM.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const DB = { a: `mail_a_${run}`, b: `mail_b_${run}`, c: `mail_c_${run}`, crm: `mail_crm_${run}`, rev: `mail_rev_${run}` };

const settings = vi.hoisted(() => ({ byTenant: {} as Record<string, Record<string, string>> }));
vi.mock("./config", async () => {
  const { getTenantIdOrDefault } = await import("./_core/tenant");
  const get = (k: string, fb = "") => settings.byTenant[getTenantIdOrDefault()]?.[k] ?? fb;
  return { getSystemSettingSync: get, getSystemSetting: async (k: string, fb = "") => get(k, fb) };
});

function statements(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
async function apply(pool: mysql.Pool, file: string) {
  for (const s of statements(file)) await pool.query(s);
}
const dsn = (db: string) => {
  const u = new URL(URL_!);
  u.pathname = `/${db}`;
  return u.toString();
};
const APP_UP = path.resolve(__dirname, "../db/migrations/0010_mail_outbox.sql");
const APP_DOWN = path.resolve(__dirname, "../db/migrations/0010_mail_outbox.down.sql");
const CRM_UP = path.resolve(__dirname, "../db/crm/migrations/0011_platform_mail_outbox.sql");

describe.skipIf(!URL_)("correo: bandeja de salida sobre MySQL", () => {
  let admin: mysql.Pool;
  const pools: Record<string, mysql.Pool> = {};
  const saved = { ...process.env };
  let clock = 1_800_000_000_000;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 4 });
    for (const db of Object.values(DB)) await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4`);
    for (const [k, db] of Object.entries(DB)) pools[k] = mysql.createPool({ uri: dsn(db), connectionLimit: 6 });
    await apply(pools.a, APP_UP);
    await apply(pools.b, APP_UP);
    await apply(pools.crm, CRM_UP);
  });

  afterAll(async () => {
    process.env = saved;
    const { setConnectionResolver } = await import("./_core/dbRegistry");
    setConnectionResolver(null);
    for (const p of Object.values(pools)) await p.end().catch(() => undefined);
    for (const db of Object.values(DB)) await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.end();
  });

  it("migraciones aditivas y reversibles (empresa y CRM con el mismo esquema)", async () => {
    await apply(pools.rev, APP_UP);
    const tables = async () => ((await pools.rev.query("SHOW TABLES")) as any)[0].map((r: any) => Object.values(r)[0]).sort();
    expect(await tables()).toEqual(["mail_events", "mail_outbox", "mail_suppressions"]);
    await apply(pools.rev, APP_DOWN);
    expect(await tables()).toEqual([]);
    await apply(pools.rev, APP_UP);
    expect(await tables()).toHaveLength(3);
    const cols = async (p: mysql.Pool) => ((await p.query("SHOW COLUMNS FROM mail_outbox")) as any)[0].map((c: any) => `${c.Field}:${c.Type}`).join(",");
    expect(await cols(pools.crm)).toBe(await cols(pools.a));
  });

  async function svc(pool: mysql.Pool, o: { tenantId?: string; failWith?: import("./mail/types").MailProviderError | null; env?: Record<string, string> } = {}) {
    const { MailService } = await import("./mail/service");
    const { MysqlMailStore } = await import("./mail/store");
    const { memoryProvider } = await import("./mail/providers");
    const { mailPolicyFromEnv } = await import("./mail/policy");
    const provider = memoryProvider({ failWith: o.failWith ?? null });
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "envios.example", ...o.env } as NodeJS.ProcessEnv);
    return { provider, s: new MailService({ lane: "tenant", store: new MysqlMailStore(pool), provider, policy, tenantId: o.tenantId ?? "acme", now: () => clock }) };
  }
  const input = (over: Record<string, unknown> = {}) => ({
    tenantId: "acme",
    idempotencyKey: "k-1",
    category: "operational" as const,
    to: "persona@pruebas.example",
    subject: "Asunto",
    html: "<p>Cuerpo con token tok_SECRETO_0000000000</p>",
    sender: { lane: "tenant" as const, brandName: "Acme Ejemplo", replyTo: "hola@acme.example" },
    ...over,
  });

  it("idempotencia con 8 envíos concurrentes de la misma clave: una fila y un envío", async () => {
    const { s, provider } = await svc(pools.a);
    const rs = await Promise.all(Array.from({ length: 8 }, () => s.send(input({ idempotencyKey: "concurrente" }))));
    expect(provider.sent).toHaveLength(1);
    expect(rs.filter((r) => !r.duplicate)).toHaveLength(1);
    const [rows] = (await pools.a.query("SELECT status, to_email, html_body, text_body, recipient_masked FROM mail_outbox WHERE idempotency_key = 'concurrente'")) as any;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "accepted", to_email: null, html_body: null, text_body: null, recipient_masked: "p***@pruebas.example" });
  });

  it("Brevo caído: pendiente con espera, dos despachadores a la vez → un solo intento; al agotar, «failed» sin cuerpo", async () => {
    const { MailProviderError } = await import("./mail/types");
    const { brevoProvider } = await import("./mail/providers");
    const { MailService } = await import("./mail/service");
    const { MysqlMailStore } = await import("./mail/store");
    const { mailPolicyFromEnv } = await import("./mail/policy");
    let calls = 0;
    const provider = brevoProvider({
      apiKey: "xkeysib-ficticia-solo-pruebas", // gitleaks:allow
      fetch: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return { status: 502, ok: false, json: async () => ({}), text: async () => "" };
      },
    });
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "envios.example", MAIL_MAX_ATTEMPTS: "2" } as NodeJS.ProcessEnv);
    const mk = () => new MailService({ lane: "tenant", store: new MysqlMailStore(pools.a), provider, policy, tenantId: "acme", now: () => clock });
    const r = await mk().send(input({ idempotencyKey: "caido" }));
    expect(r.status).toBe("pending");
    expect(calls).toBe(1);
    clock += 60_000;
    await Promise.all([mk().drain(), mk().drain(), mk().drain()]);
    expect(calls).toBe(2);
    const [rows] = (await pools.a.query("SELECT status, attempts, reason, html_body, to_email FROM mail_outbox WHERE idempotency_key = 'caido'")) as any;
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 2, reason: "http_502", html_body: null, to_email: null });
    void MailProviderError;
  });

  it("límites contados en la base (por destinatario)", async () => {
    const { s } = await svc(pools.a, { env: { MAIL_RATE_RECIPIENT_PER_HOUR: "1" } });
    expect((await s.send(input({ idempotencyKey: "lim-1", to: "limite@pruebas.example" }))).status).toBe("accepted");
    expect(await s.send(input({ idempotencyKey: "lim-2", to: "limite@pruebas.example" }))).toMatchObject({ status: "skipped", reason: "rate_limited_recipient" });
  });

  describe("Core en multiempresa: sendEmail real con dos empresas", () => {
    let mem: ReturnType<typeof import("./mail/providers").memoryProvider>;
    beforeAll(async () => {
      process.env.TENANT_MODE = "multi";
      process.env.MAIL_MODE = "sandbox";
      process.env.MAIL_SANDBOX_ALLOWLIST = "pruebas.example";
      process.env.MAIL_SENDING_DOMAIN = "envios.example";
      process.env.APP_URL = "https://instalacion-unica.example";
      delete process.env.BREVO_API_KEY;
      settings.byTenant = {
        acme: { brand_name: "Acme Ejemplo SL", email_reply_to: "hola@acme.example", email_from_address: "director@banco.example" },
        beta: { brand_name: "Beta Ejemplo SL", email_reservations: "reservas@beta.example" },
        gamma: { brand_name: "Gamma Ejemplo SL" },
      };
      const { setConnectionResolver } = await import("./_core/dbRegistry");
      setConnectionResolver((id) => (id === "acme" ? dsn(DB.a) : id === "beta" ? dsn(DB.b) : id === "gamma" ? dsn(DB.c) : null));
      const { memoryProvider } = await import("./mail/providers");
      const { setTenantMailProviderForTests } = await import("./mail/tenantMail");
      mem = memoryProvider();
      setTenantMailProviderForTests(mem);
    });
    afterAll(async () => {
      const { setTenantMailProviderForTests } = await import("./mail/tenantMail");
      setTenantMailProviderForTests(undefined);
    });
    const send = async (tenant: string, p: Record<string, unknown>) => {
      const { runWithTenant } = await import("./_core/tenant");
      const { sendEmail } = await import("./mailer");
      return runWithTenant(tenant, () => sendEmail({ subject: "Activa tu cuenta", html: '<a href="https://acme.elephantsource.example/establecer-contrasena?token=t">Activar</a>', to: "persona@pruebas.example", ...p } as any));
    };
    const rowsOf = async (pool: mysql.Pool, key?: string) => ((await pool.query(`SELECT * FROM mail_outbox ${key ? "WHERE category = ?" : ""} ORDER BY id`, key ? [key] : [])) as any)[0];

    it("cada empresa en SU base, con su tenant, su nombre y su Reply-To; el From es siempre el de plataforma", async () => {
      expect(await send("acme", { category: "user_invite" })).toBe(true);
      expect(await send("beta", { category: "user_invite" })).toBe(true);
      const [a] = await rowsOf(pools.a, "user_invite");
      const [b] = await rowsOf(pools.b, "user_invite");
      expect(a).toMatchObject({ tenant_id: "acme", sender_name: "Acme Ejemplo SL", sender_email: "no-reply@envios.example", reply_to: "hola@acme.example", status: "accepted" });
      expect(b).toMatchObject({ tenant_id: "beta", sender_name: "Beta Ejemplo SL", sender_email: "no-reply@envios.example", reply_to: "reservas@beta.example", status: "accepted" });
      expect(mem.sent.map((m) => m.from.email)).toEqual(["no-reply@envios.example", "no-reply@envios.example"]);
      expect(JSON.stringify(mem.sent)).not.toMatch(/banco\.example|n[aá]yade/i);
      expect(mem.sent.map((m) => m.ref.split(".").slice(0, 3).join("."))).toEqual(["es1.t.acme", "es1.t.beta"]);
    });

    it("sandbox: un destinatario no autorizado no recibe nada (queda «skipped» sin cuerpo)", async () => {
      const before = mem.sent.length;
      expect(await send("acme", { to: "cliente@real.example", category: "quote_sent" })).toBe(false);
      expect(mem.sent.length).toBe(before);
      const [r] = await rowsOf(pools.a, "quote_sent");
      expect(r).toMatchObject({ status: "skipped", reason: "sandbox_recipient_not_allowed", html_body: null, to_email: null });
    });

    it("enlaces a Náyade o al host global de la instalación: no se envía", async () => {
      const before = mem.sent.length;
      expect(await send("beta", { category: "password_reset", html: '<a href="https://www.nayadeexperiences.es/nueva-contrasena?token=x">x</a>' })).toBe(false);
      expect(await send("beta", { category: "password_reset", html: '<a href="https://instalacion-unica.example/nueva-contrasena?token=y">x</a>' })).toBe(false);
      expect(mem.sent.length).toBe(before);
      expect((await rowsOf(pools.b, "password_reset")).map((r: any) => r.reason)).toEqual(["forbidden_link_host", "forbidden_link_host"]);
    });

    it("empresa sin la migración aplicada: no se envía (falla cerrado)", async () => {
      const before = mem.sent.length;
      expect(await send("gamma", { category: "user_invite" })).toBe(false);
      expect(mem.sent.length).toBe(before);
    });

    it("webhook: el evento de una empresa cambia SOLO su base y suprime en ella; el de plataforma, la del CRM", async () => {
      const { tenantLaneResolver, platformMailFromEnv } = await import("./mail/platform");
      const { brevoWebhookHandler, WEBHOOK_TOKEN_HEADER } = await import("./mail/webhook");
      const { mailRef } = await import("./mail/service");
      const { memoryProvider } = await import("./mail/providers");
      const plat = await platformMailFromEnv(pools.crm, { MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv, { provider: memoryProvider() });
      expect(plat.reason).toBeNull();
      const p = await plat.mailer!.send("acme", "plat-1", "contract_confirmed", "persona@pruebas.example", plat.mailer!.t.contractConfirmed({ companyName: "Acme", reference: "PED-1", host: "acme.example" }));
      expect(p.status).toBe("accepted");
      const resolver = tenantLaneResolver({ dsnOf: async (id) => (id === "acme" ? dsn(DB.a) : id === "beta" ? dsn(DB.b) : null), policy: plat.policy });
      const TOKEN = "token-de-webhook-ficticio-mysql-000000000000"; // gitleaks:allow
      const handler = brevoWebhookHandler({ token: TOKEN, resolve: async (lane, t) => (lane === "platform" ? plat.mailer!.service : resolver(t)), log: () => undefined });
      const invoke = async (body: unknown, token: string | null) => {
        let status = 200;
        let json: any = null;
        const res: any = { status: (s: number) => ((status = s), res), json: (j: unknown) => ((json = j), res) };
        await handler({ headers: token ? { [WEBHOOK_TOKEN_HEADER]: token } : {}, body } as any, res);
        return { status, json };
      };
      const [a] = await rowsOf(pools.a, "user_invite");
      const [b] = await rowsOf(pools.b, "user_invite");
      const bounce = { event: "hard_bounce", email: "persona@pruebas.example", "message-id": a.provider_message_id, ts_epoch: 5, "X-Mailin-custom": mailRef("tenant", "acme", Number(a.id)) };
      // Sin validación: nada cambia
      expect((await invoke(bounce, null)).status).toBe(401);
      expect((await rowsOf(pools.a, "user_invite"))[0].status).toBe("accepted");
      // Una referencia que dice «beta» con el id de la fila de acme no toca nada
      expect((await invoke({ ...bounce, "X-Mailin-custom": mailRef("tenant", "beta", Number(a.id)) }, TOKEN)).json.applied).toBe(0);
      expect((await invoke(bounce, TOKEN)).json).toMatchObject({ applied: 1 });
      expect((await rowsOf(pools.a, "user_invite"))[0].status).toBe("bounced");
      expect((await rowsOf(pools.b, "user_invite"))[0].status).toBe("accepted");
      const sup = async (pool: mysql.Pool) => ((await pool.query("SELECT tenant_id, reason FROM mail_suppressions")) as any)[0];
      expect(await sup(pools.a)).toEqual([{ tenant_id: "acme", reason: "hard_bounce" }]);
      expect(await sup(pools.b)).toEqual([]);
      // La misma persona sigue pudiendo recibir correo de la otra empresa
      expect(await send("beta", { category: "operational" })).toBe(true);
      expect(await send("acme", { category: "operational" })).toBe(false);
      // Evento de plataforma
      const [pr] = ((await pools.crm.query("SELECT id, provider_message_id FROM mail_outbox WHERE idempotency_key = 'plat-1'")) as any)[0];
      expect((await invoke({ event: "delivered", "message-id": pr.provider_message_id, ts_epoch: 9, "X-Mailin-custom": mailRef("platform", "acme", Number(pr.id)) }, TOKEN)).json.applied).toBe(1);
      expect(((await pools.crm.query("SELECT status FROM mail_outbox WHERE id = ?", [pr.id])) as any)[0][0].status).toBe("delivered");
      void b;
      await resolver.close();
    });
  });
});
