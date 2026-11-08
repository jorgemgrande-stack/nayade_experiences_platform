/**
 * Postmark propio por empresa sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL) con DOS empresas en bases separadas.
 * Datos sintéticos (.example); Postmark es siempre un `fetch` falso y la plataforma un proveedor en memoria: no sale nada.
 *  - Sin credencial → envío de plataforma, como hoy. Con la suya → Postmark con SU token, SU remitente y su flujo.
 *  - Aislamiento: el token de una empresa nunca se usa para otra; una comercial no pasa por Postmark.
 *  - Webhook del Core: el token de otra empresa se rechaza; el propio aplica el rebote y suprime SOLO en su base; repetido
 *    no se aplica dos veces; una referencia de otra empresa se ignora. Ficha del cliente: estado y supresión, sin los
 *    correos de usuarios del panel.
 *  - Cuenta de Postmark rechazada al enviar: ese correo sale por la plataforma una sola vez y los siguientes ya no la usan.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const DB = { a: `pm_a_${run}`, b: `pm_b_${run}` };

const settings = vi.hoisted(() => ({ byTenant: {} as Record<string, Record<string, string>> }));
vi.mock("../config", async () => {
  const { getTenantIdOrDefault } = await import("../_core/tenant");
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
const dsn = (db: string) => {
  const u = new URL(URL_!);
  u.pathname = `/${db}`;
  return u.toString();
};
const APP_UP = path.resolve(__dirname, "../../db/migrations/0010_mail_outbox.sql");

// Tokens ficticios construidos en ejecución
const TOKEN_A = ["servidor", "a".repeat(8), "1".repeat(12)].join("-");
const HOOK_A = "h".repeat(43);
const HOOK_B = "k".repeat(43);
const CLIENT = "cliente@pruebas.example";

describe.skipIf(!URL_)("Postmark por empresa sobre MySQL (dos empresas)", () => {
  let admin: mysql.Pool;
  const pools: Record<string, mysql.Pool> = {};
  const saved = { ...process.env };
  const calls: Array<{ token: string; body: any }> = [];
  let postmarkStatus: { status: number; body: unknown } | null = null;
  const failures: string[] = [];
  let mem: ReturnType<typeof import("./providers").memoryProvider>;
  const creds: Record<string, Record<string, Record<string, string>>> = {};
  // Medición del ERM: consumo de la plataforma (`email.sent`) frente al de la cuenta propia (`email.own.sent`)
  let sink: import("../_core/metering").InMemoryMeterSink;
  const mailEvents = () => sink.events.filter((e) => e.metric.startsWith("email.")).map((e) => [e.tenantId, e.metric, e.meta?.route]);

  /** Fija la bóveda e identidad precargadas de la empresa (como el borde de cada petición) y ejecuta `fn`. */
  async function inTenant<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
    const { runWithTenant } = await import("../_core/tenant");
    const { setResolvedCredentials } = await import("../_core/credentials/cache");
    const { warmTenantIdentity } = await import("../_core/tenantIdentity");
    return runWithTenant(tenant, async () => {
      setResolvedCredentials(creds[tenant] ?? {});
      await warmTenantIdentity();
      return fn();
    });
  }
  const send = (tenant: string, p: Record<string, unknown>) =>
    inTenant(tenant, async () => {
      const { sendEmail } = await import("../mailer");
      return sendEmail({ subject: "Confirmación de tu pedido", html: "<p>Gracias por tu compra</p>", to: CLIENT, ...p } as any);
    });
  const rows = async (pool: mysql.Pool, category: string) => ((await pool.query("SELECT * FROM mail_outbox WHERE category = ? ORDER BY id", [category])) as any)[0];

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 4 });
    for (const db of Object.values(DB)) await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4`);
    for (const [k, db] of Object.entries(DB)) {
      pools[k] = mysql.createPool({ uri: dsn(db), connectionLimit: 6 });
      for (const s of statements(APP_UP)) await pools[k].query(s);
    }
    process.env.TENANT_MODE = "multi";
    process.env.MAIL_MODE = "sandbox";
    process.env.MAIL_SANDBOX_ALLOWLIST = "pruebas.example";
    process.env.MAIL_SENDING_DOMAIN = "envios.example";
    delete process.env.BREVO_API_KEY;
    delete process.env.POSTMARK_SERVER_TOKEN;
    settings.byTenant = { acme: { brand_name: "Acme Ejemplo SL", email_reply_to: "hola@empresa-a.example" }, beta: { brand_name: "Beta Ejemplo SL" } };
    const { setConnectionResolver } = await import("../_core/dbRegistry");
    setConnectionResolver((id) => (id === "acme" ? dsn(DB.a) : id === "beta" ? dsn(DB.b) : null));
    const { configureTenantIdentity } = await import("../_core/tenantIdentity");
    const identity = (tenantId: string, domain: string) => ({ tenantId, displayName: tenantId, publicHost: `${tenantId}.plataforma.example`, publicHostKind: "platform" as const, customDomains: [{ domain, state: "verified" as const, isPrimary: true }], fiscal: null });
    configureTenantIdentity({ load: async (id) => (id === "acme" ? identity("acme", "empresa-a.example") : id === "beta" ? identity("beta", "empresa-b.example") : null) });
    const { memoryProvider } = await import("./providers");
    const tm = await import("./tenantMail");
    mem = memoryProvider();
    tm.setTenantMailProviderForTests(mem);
    tm.setTenantPostmarkFetchForTests(async (_url, init) => {
      calls.push({ token: init.headers["X-Postmark-Server-Token"], body: JSON.parse(init.body ?? "{}") });
      if (postmarkStatus) {
        const r = postmarkStatus;
        return { status: r.status, ok: false, json: async () => r.body, text: async () => "" };
      }
      return { status: 200, ok: true, json: async () => ({ ErrorCode: 0, MessageID: `pm-${calls.length}` }), text: async () => "" };
    });
    // Como markPostmarkUnhealthy, sin bóveda real: se borra la marca de comprobación de la empresa en curso
    tm.setTenantPostmarkFailureHookForTests(async (e) => {
      failures.push(e.code);
      const { getTenantIdOrDefault } = await import("../_core/tenant");
      delete creds[getTenantIdOrDefault()].postmark.verifiedFor;
    });
    // Solo acme tiene su Postmark; beta tiene token de webhook (para probar el rechazo cruzado) pero no servidor
    const { postmarkFingerprint } = await import("./tenantPostmark");
    creds.acme = { postmark: { serverToken: TOKEN_A, fromEmail: "reservas@empresa-a.example", messageStream: "outbound", webhookToken: HOOK_A, verifiedFor: postmarkFingerprint(TOKEN_A, "outbound") } };
    creds.beta = { postmark: { webhookToken: HOOK_B } };
    const metering = await import("../_core/metering");
    sink = new metering.InMemoryMeterSink();
    metering.setMeterSink(sink);
  });

  afterAll(async () => {
    process.env = saved;
    (await import("../_core/metering")).setMeterSink(null);
    const tm = await import("./tenantMail");
    tm.setTenantMailProviderForTests(undefined);
    tm.setTenantPostmarkFetchForTests(undefined);
    tm.setTenantPostmarkFailureHookForTests(undefined);
    const { setConnectionResolver } = await import("../_core/dbRegistry");
    setConnectionResolver(null);
    const { configureTenantIdentity } = await import("../_core/tenantIdentity");
    configureTenantIdentity(null);
    for (const p of Object.values(pools)) await p.end().catch(() => undefined);
    for (const db of Object.values(DB)) await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.end();
  });

  it("sin credencial → envío de plataforma como hoy; con la suya → Postmark con su token, su remitente y sin seguimiento", async () => {
    expect(await send("beta", { category: "payment_confirmed" })).toBe(true);
    expect(await send("acme", { category: "payment_confirmed" })).toBe(true);
    const [b] = await rows(pools.b, "payment_confirmed");
    const [a] = await rows(pools.a, "payment_confirmed");
    expect(b).toMatchObject({ tenant_id: "beta", status: "accepted", provider: "memory", sender_email: "no-reply@envios.example" });
    expect(a).toMatchObject({ tenant_id: "acme", status: "accepted", provider: "postmark_tenant", provider_message_id: "pm-1", sender_email: "reservas@empresa-a.example" });
    expect(mem.sent).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].token).toBe(TOKEN_A);
    expect(calls[0].body).toMatchObject({ To: CLIENT, MessageStream: "outbound", TrackOpens: false, TrackLinks: "None", Tag: "payment_confirmed" });
    expect(calls[0].body.From).toContain("<reservas@empresa-a.example>");
    // ERM: el de beta es consumo de la plataforma; el de acme, de su cuenta propia (sin coste ni cuota de la plataforma)
    expect(mailEvents()).toEqual([
      ["beta", "email.sent", "platform"],
      ["acme", "email.own.sent", "own_postmark"],
    ]);
  });

  it("aislamiento e idempotencia: el token de acme nunca sirve a beta; el mismo aviso con la misma clave sale una vez", async () => {
    expect(await send("beta", { category: "operational", idempotencyKey: "pedido-1" })).toBe(true);
    expect(await send("acme", { category: "operational", idempotencyKey: "pedido-1" })).toBe(true);
    expect(await send("acme", { category: "operational", idempotencyKey: "pedido-1" })).toBe(true);
    expect(calls.every((c) => c.token === TOKEN_A)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(await rows(pools.a, "operational")).toHaveLength(1);
    expect((await rows(pools.b, "operational"))[0]).toMatchObject({ provider: "memory" });
  });

  it("separación: una comercial de acme no pasa por Postmark (sale con la identidad de la plataforma)", async () => {
    const before = calls.length;
    expect(await send("acme", { category: "marketing" })).toBe(true);
    expect(calls.length).toBe(before);
    expect((await rows(pools.a, "marketing"))[0]).toMatchObject({ provider: "memory", sender_email: "no-reply@envios.example" });
  });

  it("webhook: token de otra empresa → 401; el propio aplica el rebote y suprime SOLO en acme; repetido → duplicado", async () => {
    const { tenantPostmarkWebhookHandler } = await import("./tenantPostmarkWebhook");
    const { WEBHOOK_TOKEN_HEADER } = await import("./webhook");
    const { postmarkRefMetadata } = await import("./providers");
    const { mailRef } = await import("./service");
    const post = (tenant: string, body: unknown, token: string | null) =>
      inTenant(tenant, async () => {
        let status = 200;
        let json: any = null;
        const res: any = { status: (s: number) => ((status = s), res), json: (j: unknown) => ((json = j), res) };
        await tenantPostmarkWebhookHandler({ log: () => undefined })({ headers: token ? { [WEBHOOK_TOKEN_HEADER]: token } : {}, body } as any, res);
        return { status, json };
      });
    const [a] = await rows(pools.a, "payment_confirmed");
    const bounce = { RecordType: "Bounce", Type: "HardBounce", ID: 99, Email: CLIENT, MessageID: a.provider_message_id, BouncedAt: "2026-11-08T10:00:00Z", Description: "Unknown user", Metadata: postmarkRefMetadata(mailRef("tenant", "acme", Number(a.id))) };
    // El token de beta (o ninguno) en el dominio de acme: nada cambia
    expect((await post("acme", bounce, HOOK_B)).status).toBe(401);
    expect((await post("acme", bounce, null)).status).toBe(401);
    expect((await rows(pools.a, "payment_confirmed"))[0].status).toBe("accepted");
    // Y el de acme en el dominio de beta, tampoco
    expect((await post("beta", bounce, HOOK_A)).status).toBe(401);
    // Referencia de beta en el dominio de acme: se ignora
    expect((await post("acme", { ...bounce, Metadata: postmarkRefMetadata(mailRef("tenant", "beta", Number(a.id))) }, HOOK_A)).json).toMatchObject({ applied: 0, ignored: 1 });
    expect((await post("acme", bounce, HOOK_A)).json).toMatchObject({ applied: 1 });
    expect((await post("acme", bounce, HOOK_A)).json).toMatchObject({ duplicate: 1 });
    expect((await rows(pools.a, "payment_confirmed"))[0].status).toBe("bounced");
    const sup = async (pool: mysql.Pool) => ((await pool.query("SELECT tenant_id, reason FROM mail_suppressions")) as any)[0];
    expect(await sup(pools.a)).toEqual([{ tenant_id: "acme", reason: "hard_bounce" }]);
    expect(await sup(pools.b)).toEqual([]);
    // Suprimido en acme: el siguiente no sale; beta le sigue escribiendo
    const before = calls.length;
    expect(await send("acme", { category: "invoice_available" })).toBe(false);
    expect(calls.length).toBe(before);
    expect((await rows(pools.a, "invoice_available"))[0]).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect(await send("beta", { category: "invoice_available" })).toBe(true);
  });

  it("ficha del cliente: estado de cada envío y aviso de supresión, cada empresa con lo suyo; sin correos del panel", async () => {
    const { clientMailDelivery, providerDeliveryStats } = await import("./deliveryDb");
    // Un restablecimiento de contraseña a la misma dirección (usuario del panel) no aparece en la ficha del cliente
    await send("beta", { category: "password_reset" });
    expect(await rows(pools.b, "password_reset")).toHaveLength(1);
    const a = await inTenant("acme", () => clientMailDelivery(CLIENT.toUpperCase()));
    expect(a.available).toBe(true);
    expect(a.suppressed).toMatchObject({ reason: "hard_bounce" });
    expect(a.sends.find((s) => s.category === "payment_confirmed")).toMatchObject({ status: "bounced", provider: "postmark_tenant", lastEvent: { kind: "hard_bounce", detail: "Unknown user" } });
    expect(a.sends.find((s) => s.category === "invoice_available")).toMatchObject({ status: "skipped", reason: "suppressed" });
    const b = await inTenant("beta", () => clientMailDelivery(CLIENT));
    expect(b.suppressed).toBeNull();
    expect(b.sends.every((s) => s.status === "accepted")).toBe(true);
    expect(b.sends.some((s) => s.category === "password_reset")).toBe(false);
    expect(await inTenant("acme", () => providerDeliveryStats("postmark_tenant", 0))).toEqual({ bounced: 1, accepted: 1 });
    expect(await inTenant("beta", () => providerDeliveryStats("postmark_tenant", 0))).toEqual({});
  });

  it("cuenta de Postmark rechazada (token revocado): el correo sale por la plataforma una vez y los siguientes ya no usan Postmark", async () => {
    const TO = "otra@pruebas.example";
    postmarkStatus = { status: 401, body: { ErrorCode: 10, Message: "Bad or missing server token" } };
    const pmBefore = calls.length;
    const memBefore = mem.sent.length;
    sink.events.length = 0;
    expect(await send("acme", { category: "refund_recorded", to: TO })).toBe(true);
    // El envío alternativo sale por la plataforma: se mide como consumo de la plataforma, no de la cuenta propia
    expect(mailEvents()).toEqual([["acme", "email.sent", "platform"]]);
    expect(calls.length).toBe(pmBefore + 1);
    expect(failures).toEqual(["postmark_10"]);
    expect(mem.sent.length).toBe(memBefore + 1);
    expect(mem.sent.at(-1)!.from.email).toBe("no-reply@envios.example");
    const [r] = await rows(pools.a, "refund_recorded");
    expect(r).toMatchObject({ status: "accepted", provider: "memory" });
    expect(await rows(pools.a, "refund_recorded")).toHaveLength(1);
    // La integración ya no está verificada: el siguiente ni siquiera intenta Postmark y sale con la identidad de la plataforma
    postmarkStatus = null;
    expect(await send("acme", { category: "invoice_available", to: TO })).toBe(true);
    expect(calls.length).toBe(pmBefore + 1);
    const inv = (await rows(pools.a, "invoice_available")).find((x: any) => x.recipient_masked.startsWith("o"));
    expect(inv).toMatchObject({ provider: "memory", sender_email: "no-reply@envios.example" });
  });
});
