/**
 * Postmark como proveedor alternativo: forma de la petición (sin seguimiento, referencia en Metadata), errores
 * (definitivos y reintentables), elección del proveedor por entorno y webhook de eventos (autenticado por cabecera
 * propia, con los mismos efectos en la bandeja que Brevo: entregado, rebote con supresión, queja, duplicado).
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { mailPolicyFromEnv } from "./policy";
import { mailProviderConfig, memoryProvider, postmarkProvider, postmarkRefFromMetadata, postmarkRefMetadata, type FetchLike } from "./providers";
import { MailService, mailRef } from "./service";
import { MemoryMailStore } from "./store";
import { MailProviderError, type ProviderMessage } from "./types";
import { WEBHOOK_TOKEN_HEADER, parsePostmarkEvent, postmarkWebhookHandler } from "./webhook";
import { FailureAlerts, configureFailureAlerts } from "../_core/ops/failureAlerts";

const SERVER_TOKEN = "postmark-servidor-ficticio-solo-pruebas"; // gitleaks:allow
const HOOK_TOKEN = "token-webhook-postmark-ficticio-solo-pruebas-0000"; // gitleaks:allow
const msg = (over: Partial<ProviderMessage> = {}): ProviderMessage =>
  ({ from: { name: 'Elephant "Source"', email: "no-reply@bigelephant.es" }, to: "ana@example.com", replyTo: "soporte@bigelephant.es", subject: "Asunto", html: "<p>h</p>", text: "h", tag: "operational", ref: mailRef("tenant", "una-empresa-con-un-identificador-bastante-largo-para-probar-el-corte", 123456789), idempotencyKey: "k", ...over }) as ProviderMessage;

const fakeFetch = (status: number, body: unknown, calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = []): FetchLike =>
  async (url, init) => {
    calls.push({ url, init });
    return { status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) };
  };

describe("proveedor Postmark", () => {
  it("envía por /email con el token de servidor, flujo outbound, sin seguimiento y la referencia en Metadata (en trozos de 80)", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const p = postmarkProvider({ serverToken: SERVER_TOKEN, fetch: fakeFetch(200, { ErrorCode: 0, MessageID: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817" }, calls) });
    const m = msg();
    expect(await p.send(m)).toEqual({ messageId: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817" });
    expect(calls[0].url).toBe("https://api.postmarkapp.com/email");
    expect(calls[0].init.headers["X-Postmark-Server-Token"]).toBe(SERVER_TOKEN);
    const body = JSON.parse(calls[0].init.body!);
    expect(body).toMatchObject({ From: '"Elephant Source" <no-reply@bigelephant.es>', To: "ana@example.com", ReplyTo: "soporte@bigelephant.es", MessageStream: "outbound", TrackOpens: false, TrackLinks: "None", Tag: "operational" });
    expect(m.ref.length).toBeGreaterThan(80);
    expect(Object.values(body.Metadata).every((v) => (v as string).length <= 80)).toBe(true);
    expect(postmarkRefFromMetadata(body.Metadata)).toBe(m.ref);
  });

  it.each([
    ["destinatario inactivo (422, 406)", 422, { ErrorCode: 406, Message: "ana@example.com inactive" }, "postmark_406", false],
    ["dirección no válida (422, 300)", 422, { ErrorCode: 300 }, "postmark_300", false],
    ["token no válido (401, 10)", 401, { ErrorCode: 10 }, "postmark_10", false],
    ["límite (429)", 429, { ErrorCode: 429 }, "postmark_429", true],
    ["error del servidor (500)", 500, null, "http_500", true],
  ])("%s → %s (reintentable: %s), sin repetir el mensaje de Postmark", async (_n, status, body, code, retryable) => {
    const e = await postmarkProvider({ serverToken: SERVER_TOKEN, fetch: fakeFetch(status, body) }).send(msg()).catch((x) => x);
    expect(e).toBeInstanceOf(MailProviderError);
    expect(e).toMatchObject({ code, retryable });
    expect(JSON.stringify(e)).not.toContain("ana@example.com");
  });

  it("red caída o tiempo agotado: reintentable; adjunto por URL: definitivo (Postmark no lo admite)", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(postmarkProvider({ serverToken: SERVER_TOKEN, fetch: down }).send(msg())).rejects.toMatchObject({ code: "network_error", retryable: true });
    await expect(postmarkProvider({ serverToken: SERVER_TOKEN, fetch: fakeFetch(200, {}) }).send(msg({ attachments: [{ name: "a.pdf", url: "https://x/a.pdf" }] as never }))).rejects.toMatchObject({ code: "attachment_url_unsupported", retryable: false });
  });

  it("referencia en Metadata: ida y vuelta, y sin metadatos no hay referencia", () => {
    expect(postmarkRefFromMetadata(postmarkRefMetadata("es1.p.platform.7"))).toBe("es1.p.platform.7");
    expect(postmarkRefFromMetadata({})).toBeNull();
    expect(postmarkRefFromMetadata(null)).toBeNull();
  });
});

describe("elección del proveedor por entorno", () => {
  it("MAIL_PROVIDER manda; sin sus credenciales no hay proveedor (nunca otro en silencio); sin él, el orden de siempre", () => {
    expect(mailProviderConfig({ MAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: SERVER_TOKEN, BREVO_API_KEY: "b" }).provider?.name).toBe("postmark");
    expect(mailProviderConfig({ MAIL_PROVIDER: "postmark", BREVO_API_KEY: "b" })).toEqual({ provider: null, problem: "credentials_missing:postmark" });
    expect(mailProviderConfig({ MAIL_PROVIDER: "mailgun" }).problem).toBe("mail_provider_unknown:mailgun");
    expect(mailProviderConfig({ BREVO_API_KEY: "b", POSTMARK_SERVER_TOKEN: SERVER_TOKEN }).provider?.name).toBe("brevo");
    expect(mailProviderConfig({ POSTMARK_SERVER_TOKEN: SERVER_TOKEN }).provider?.name).toBe("postmark");
    expect(mailProviderConfig({})).toEqual({ provider: null, problem: "no_provider" });
  });
});

describe("webhook de Postmark", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => void (await close?.()));
  const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv);
  async function setup(token: string | null = HOOK_TOKEN) {
    const store = new MemoryMailStore();
    const svc = new MailService({ lane: "tenant", store, provider: memoryProvider(), policy, tenantId: "acme" });
    const r = await svc.send({ tenantId: "acme", idempotencyKey: "k1", category: "operational", to: "cliente@pruebas.example", subject: "s", html: "<p>h</p>", sender: { lane: "tenant", brandName: "Acme", replyTo: null } });
    const app = express();
    app.post("/hook", express.json(), (req, res, next) => void postmarkWebhookHandler({ token, resolve: async (lane, t) => (lane === "tenant" && t === "acme" ? svc : null), log: () => undefined })(req, res).catch(next));
    const server = http.createServer(app);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    close = () => new Promise<void>((ok) => server.close(() => ok()));
    const post = async (body: unknown, headers: Record<string, string> = { [WEBHOOK_TOKEN_HEADER]: HOOK_TOKEN }) => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as Record<string, number> };
    };
    return { store, svc, id: r.id!, post };
  }
  const bounce = (id: number, over: Record<string, unknown> = {}) => ({ RecordType: "Bounce", Type: "HardBounce", ID: 42, Email: "cliente@pruebas.example", MessageID: "<mem-1@memory.example>", BouncedAt: "2026-10-22T10:00:00Z", Description: "The server was unable to deliver your message", Metadata: postmarkRefMetadata(mailRef("tenant", "acme", id)), ...over });

  it("sin cabecera o con otro token: 401; sin token configurado: 503; nada cambia", async () => {
    const s = await setup();
    expect((await s.post(bounce(s.id), {})).status).toBe(401);
    expect((await s.post(bounce(s.id), { [WEBHOOK_TOKEN_HEADER]: `${HOOK_TOKEN}x` })).status).toBe(401);
    expect(s.store.rows[0].status).toBe("accepted");
    await close!();
    const t = await setup(null);
    expect((await t.post(bounce(t.id))).status).toBe(503);
  });

  it("rebote duro → «bounced» y destinatario suprimido; repetido → duplicado; entrega y queja también; aperturas se ignoran", async () => {
    const s = await setup();
    expect((await s.post(bounce(s.id))).json).toMatchObject({ applied: 1 });
    expect(s.store.rows[0].status).toBe("bounced");
    expect(s.store.suppressions.size).toBe(1);
    expect((await s.post(bounce(s.id))).json).toMatchObject({ duplicate: 1 });
    expect((await s.post([{ RecordType: "Open", Metadata: postmarkRefMetadata(mailRef("tenant", "acme", s.id)) }])).json).toMatchObject({ ignored: 1 });
  });

  it("queja → «complained» y dirección suprimida; aviso al equipo una sola vez aunque se repita; el siguiente envío no sale", async () => {
    const raised: string[] = [];
    configureFailureAlerts(new FailureAlerts({ incidents: { raise: async (i: { kind: string }) => void raised.push(i.kind) } as never }));
    try {
      const s = await setup();
      const spam = { RecordType: "SpamComplaint", ID: 43, Email: "cliente@pruebas.example", MessageID: "<mem-1@memory.example>", BouncedAt: "2026-10-22T11:00:00Z", Metadata: postmarkRefMetadata(mailRef("tenant", "acme", s.id)) };
      expect((await s.post(spam)).json).toMatchObject({ applied: 1 });
      expect((await s.post(spam)).json).toMatchObject({ duplicate: 1 });
      await new Promise((ok) => setTimeout(ok, 0));
      expect(raised).toEqual(["rate.mail.complaint"]);
      expect(s.store.rows[0].status).toBe("complained");
      const again = await s.svc.send({ tenantId: "acme", idempotencyKey: "k2", category: "operational", to: "cliente@pruebas.example", subject: "s", html: "<p>h</p>", sender: { lane: "tenant", brandName: "Acme", replyTo: null } });
      expect(again).toMatchObject({ status: "skipped", reason: "suppressed" });
    } finally {
      configureFailureAlerts(new FailureAlerts());
    }
  });

  it("baja (Subscription Change con SuppressSending) → dirección suprimida sin cambiar el estado del mensaje", async () => {
    const s = await setup();
    const change = { RecordType: "SubscriptionChange", SuppressSending: true, Recipient: "cliente@pruebas.example", MessageID: "<mem-1@memory.example>", ChangedAt: "2026-10-22T12:00:00Z", Metadata: postmarkRefMetadata(mailRef("tenant", "acme", s.id)) };
    expect((await s.post(change)).json).toMatchObject({ applied: 1 });
    expect(s.store.rows[0].status).toBe("accepted");
    expect(s.store.suppressions.size).toBe(1);
    // Reactivación en Postmark (SuppressSending=false): no es una baja, se ignora
    expect((await s.post({ ...change, SuppressSending: false, ChangedAt: "2026-10-22T13:00:00Z" })).json).toMatchObject({ ignored: 1 });
  });

  it("traducción de tipos: entrega, rebote temporal, dirección no válida, bloqueo, queja y baja", () => {
    const meta = postmarkRefMetadata("es1.t.acme.1");
    expect(parsePostmarkEvent({ RecordType: "Delivery", Recipient: "a@b.example", MessageID: "m", DeliveredAt: "x", Metadata: meta })).toMatchObject({ kind: "delivered", ref: "es1.t.acme.1", email: "a@b.example" });
    expect(parsePostmarkEvent({ RecordType: "Bounce", Type: "SoftBounce", Metadata: meta })?.kind).toBe("soft_bounce");
    expect(parsePostmarkEvent({ RecordType: "Bounce", Type: "BadEmailAddress", Metadata: meta })?.kind).toBe("invalid");
    expect(parsePostmarkEvent({ RecordType: "Bounce", Type: "ManuallyDeactivated", Metadata: meta })?.kind).toBe("blocked");
    expect(parsePostmarkEvent({ RecordType: "SpamComplaint", Metadata: meta })?.kind).toBe("spam");
    expect(parsePostmarkEvent({ RecordType: "SubscriptionChange", SuppressSending: true, Metadata: meta })?.kind).toBe("unsubscribed");
    expect(parsePostmarkEvent({ RecordType: "SubscriptionChange", SuppressSending: false, Metadata: meta })).toBeNull();
    expect(parsePostmarkEvent({ RecordType: "Click", Metadata: meta })).toBeNull();
  });
});
