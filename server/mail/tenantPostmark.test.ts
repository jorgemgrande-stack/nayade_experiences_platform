/**
 * Postmark propio de cada empresa (correo transaccional): configuración desde la bóveda con remitente de dominio
 * verificado y comprobación previa, lista explícita de categorías transaccionales, respaldo inmediato si Postmark rechaza
 * la cuenta, comprobación de solo lectura (Live y flujo transaccional), campos ocultos en el formulario general y webhook
 * del Core con el token PROPIO de la empresa (cuerpo limitado, límite por empresa e IP, supresión del destinatario de la
 * fila). Ninguna llamada real: `fetch` falso.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { invalidateCredentials, setResolvedCredentials } from "../_core/credentials/cache";
import { getProvider, validateFields } from "../_core/credentials/catalog";
import { panelIntegrations } from "../_core/credentials/presentation";
import { testProvider } from "../_core/credentials/testers";
import { runWithTenant } from "../_core/tenant";
import { mailPolicyFromEnv, recipientHash } from "./policy";
import { memoryProvider, postmarkProvider, postmarkRefMetadata, type FetchLike } from "./providers";
import { MailService, mailRef } from "./service";
import { MemoryMailStore } from "./store";
import { MailProviderError, type MailProviderPort, type ProviderMessage } from "./types";
import { WEBHOOK_TOKEN_HEADER } from "./webhook";
import {
  isTransactionalCategory,
  postmarkAccountFailure,
  postmarkConfigFrom,
  postmarkFingerprint,
  postmarkServerInfo,
  senderGuard,
  tenantPostmark,
  tenantPostmarkWebhookToken,
  transactionalRouter,
} from "./tenantPostmark";
import { TENANT_POSTMARK_WEBHOOK_MAX_BYTES, tenantPostmarkWebhookBodyParser, tenantPostmarkWebhookHandler, webhookRateKey } from "./tenantPostmarkWebhook";
import { tenantWebhookUrl } from "../routers/postmarkTenant";

// Valores ficticios construidos en ejecución (sin formato de clave real en el código)
const SERVER_TOKEN = ["prueba", "x".repeat(8), "y".repeat(12)].join("-");
const HOOK_A = "a".repeat(43);
const HOOK_B = "b".repeat(43);
const VERIFIED = postmarkFingerprint(SERVER_TOKEN, "outbound");
const verifiedA = { customDomains: [{ domain: "empresa-a.example", state: "verified" as const, isPrimary: true }] };
const pendingA = { customDomains: [{ domain: "empresa-a.example", state: "pending" as const, isPrimary: true }] };
const full = { serverToken: SERVER_TOKEN, fromEmail: "reservas@empresa-a.example", verifiedFor: VERIFIED };

type Call = { url: string; init: Parameters<FetchLike>[1] };
const routes = (map: Record<string, [number, unknown]>, calls: Call[] = []): FetchLike =>
  async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const [status, body] = map[path] ?? [404, { ErrorCode: 1235 }];
    return { status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) };
  };

afterEach(() => {
  delete process.env.TENANT_MODE;
  invalidateCredentials();
});

describe("configuración por empresa", () => {
  it("sin datos → desactivada; incompleta; remitente no válido; dominio sin verificar; sin comprobar; completa", () => {
    expect(postmarkConfigFrom({}, verifiedA)).toMatchObject({ config: null, problem: "not_configured" });
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN }, verifiedA)).toMatchObject({ config: null, problem: "incomplete" });
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN, fromEmail: "no es correo" }, verifiedA)).toMatchObject({ config: null, problem: "sender_invalid" });
    expect(postmarkConfigFrom({ ...full }, pendingA)).toMatchObject({ config: null, problem: "domain_not_verified", domain: "empresa-a.example" });
    expect(postmarkConfigFrom({ ...full, fromEmail: "reservas@otra.example" }, verifiedA).problem).toBe("domain_not_verified");
    // Sin comprobación, o comprobado con otro token u otro flujo: inactiva hasta volver a comprobar
    expect(postmarkConfigFrom({ ...full, verifiedFor: undefined }, verifiedA).problem).toBe("not_verified");
    expect(postmarkConfigFrom({ ...full, serverToken: `${SERVER_TOKEN}z` }, verifiedA).problem).toBe("not_verified");
    expect(postmarkConfigFrom({ ...full, messageStream: "otro" }, verifiedA).problem).toBe("not_verified");
    expect(postmarkConfigFrom({ ...full, fromEmail: "Reservas@Empresa-A.example", webhookToken: "corto" }, verifiedA)).toEqual({
      config: { serverToken: SERVER_TOKEN, messageStream: "outbound", fromEmail: "reservas@empresa-a.example", domain: "empresa-a.example", webhookToken: null },
      problem: null,
      domain: "empresa-a.example",
    });
  });

  it("aislamiento: cada empresa lee SU bóveda; en monoempresa nunca se usa", async () => {
    process.env.TENANT_MODE = "multi";
    await runWithTenant("empresa-a", async () => setResolvedCredentials({ postmark: { ...full, webhookToken: HOOK_A } }));
    await runWithTenant("empresa-b", async () => setResolvedCredentials({}));
    expect(await runWithTenant("empresa-a", async () => tenantPostmark(verifiedA)?.fromEmail)).toBe("reservas@empresa-a.example");
    expect(await runWithTenant("empresa-a", async () => tenantPostmarkWebhookToken())).toBe(HOOK_A);
    expect(await runWithTenant("empresa-b", async () => tenantPostmark(verifiedA))).toBeNull();
    expect(await runWithTenant("empresa-b", async () => tenantPostmarkWebhookToken())).toBeNull();
    delete process.env.TENANT_MODE;
    expect(await runWithTenant("empresa-a", async () => tenantPostmark(verifiedA))).toBeNull();
  });

  it("catálogo: token, flujo y remitente validados; el token del webhook y la marca de comprobación no aparecen en el formulario", () => {
    const p = getProvider("postmark")!;
    expect(p.panel.requires).toEqual(["comms-email"]);
    expect(validateFields(p, { serverToken: SERVER_TOKEN, messageStream: "outbound", fromEmail: "a@b.example" })).toEqual([]);
    expect(validateFields(p, { serverToken: "con espacios no", messageStream: "Broad Cast" })).toHaveLength(2);
    expect(validateFields(p, { webhookToken: "corto", verifiedFor: "no-es-huella" })).toHaveLength(2);
    const status = { id: "postmark", name: p.name, description: p.description, configured: false, fields: p.fields.map((f) => ({ key: f.key, label: f.label, secret: f.secret, required: !!f.required, set: false, display: null, updatedAt: null })) };
    const [panel] = panelIntegrations([status], { licensed: true, can: (c) => c === "comms-email" });
    expect(panel.id).toBe("postmark");
    expect(panel.fields.map((f) => f.key)).toEqual(["serverToken", "messageStream", "fromEmail"]);
    expect(panelIntegrations([status], { licensed: true, can: () => false })).toEqual([]);
  });

  it("URL del webhook: solo con el dominio público de la empresa (nunca la de la plataforma)", () => {
    expect(tenantWebhookUrl(null)).toBeNull();
    expect(tenantWebhookUrl("https://acme.example/")).toBe("https://acme.example/api/mail/postmark/webhook");
  });
});

describe("reparto transaccional / comercial", () => {
  const msg = (over: Partial<ProviderMessage> = {}): ProviderMessage => ({ from: { name: "Empresa A", email: "reservas@empresa-a.example" }, to: "c@pruebas.example", subject: "s", html: "<p>h</p>", tag: "operational", ref: "es1.t.empresa-a.1", idempotencyKey: "k", ...over });
  const failing = (e: MailProviderError): MailProviderPort & { calls: number } => {
    const p = { name: "postmark_tenant", calls: 0, async send() {
      p.calls++;
      throw e;
    } };
    return p;
  };

  it("lista explícita: solo categorías transaccionales; desconocidas, «legacy», comunicados y comerciales → envío de siempre", () => {
    for (const c of ["operational", "payment_confirmed", "invoice_available", "password_reset", "quote_sent"]) expect(isTransactionalCategory(c)).toBe(true);
    for (const c of ["marketing", "survey", "service_notice", "legacy", "lo-que-sea", "", null, undefined]) expect(isTransactionalCategory(c)).toBe(false);
  });

  it("transaccional con el remitente de Postmark → Postmark; el resto → envío de siempre con SU identidad", async () => {
    const primary = memoryProvider();
    const fallback = memoryProvider();
    const pm = { ...primary, name: "postmark_tenant" };
    const r = transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback, fallbackFrom: "no-reply@plataforma.example" });
    expect(await r.send(msg())).toMatchObject({ provider: "postmark_tenant" });
    for (const tag of ["marketing", "survey", "legacy", "service_notice", "desconocida"]) expect(await r.send(msg({ tag }))).toMatchObject({ provider: "memory" });
    expect(await r.send(msg({ from: { name: "x", email: "no-reply@plataforma.example" } }))).toMatchObject({ provider: "memory" });
    expect(primary.sent).toHaveLength(1);
    expect(fallback.sent).toHaveLength(6);
    // Lo que va por el envío de siempre nunca sale con el dominio de la empresa en Postmark
    expect(fallback.sent.every((m) => m.from.email === "no-reply@plataforma.example")).toBe(true);
    const lone = transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback: null });
    await expect(lone.send(msg({ tag: "marketing" }))).rejects.toMatchObject({ code: "no_provider", retryable: false });
  });

  it("Postmark rechaza la cuenta (401, código 10, 412, remitente sin firmar): aviso y ESE mensaje sale por el respaldo una sola vez", async () => {
    const cases = [
      new MailProviderError("postmark_10", false, 401),
      new MailProviderError("postmark_10", false, 422),
      new MailProviderError("postmark_412", false, 422),
      new MailProviderError("http_412", false, 412),
      new MailProviderError("postmark_400", false, 422),
    ];
    for (const e of cases) {
      expect(postmarkAccountFailure(e)).toBe(true);
      const fallback = memoryProvider();
      const failures: string[] = [];
      const pm = failing(e);
      const r = transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback, fallbackFrom: "no-reply@plataforma.example", onAccountFailure: (x) => void failures.push(x.code) });
      expect(await r.send(msg({ tag: "payment_confirmed" }))).toMatchObject({ provider: "memory" });
      expect(pm.calls).toBe(1);
      expect(failures).toEqual([e.code]);
      expect(fallback.sent).toHaveLength(1);
      expect(fallback.sent[0].from.email).toBe("no-reply@plataforma.example");
    }
    // Un fallo del mensaje (dirección inactiva) o temporal no es de la cuenta: no se reenvía por otro lado
    for (const e of [new MailProviderError("postmark_406", false, 422), new MailProviderError("http_500", true, 500)]) {
      expect(postmarkAccountFailure(e)).toBe(false);
      const fallback = memoryProvider();
      const r = transactionalRouter({ primary: failing(e), primaryDomain: "empresa-a.example", fallback });
      await expect(r.send(msg())).rejects.toMatchObject({ code: e.code, provider: "postmark_tenant" });
      expect(fallback.sent).toHaveLength(0);
    }
  });

  it("identidad protegida del envío de siempre: un mensaje encolado con el dominio de la empresa sale con la del respaldo", async () => {
    const mem = memoryProvider();
    const g = senderGuard(mem, { domain: "plataforma.example", from: "no-reply@plataforma.example" })!;
    await g.send(msg());
    await g.send(msg({ from: { name: "P", email: "no-reply@plataforma.example" } }));
    expect(mem.sent.map((m) => m.from.email)).toEqual(["no-reply@plataforma.example", "no-reply@plataforma.example"]);
    expect(senderGuard(null, { domain: "x", from: "y" })).toBeNull();
  });

  it("la bandeja guarda el proveedor real (también al programar un reintento); Postmark sin seguimiento por el flujo de la empresa", async () => {
    const calls: Call[] = [];
    let status = 500;
    const pm = { ...postmarkProvider({ serverToken: SERVER_TOKEN, messageStream: "transaccional-a", fetch: async (url, init) => routes({ "/email": [status, status === 200 ? { ErrorCode: 0, MessageID: "id-1" } : null] }, calls)(url, init) }), name: "postmark_tenant" };
    const store = new MemoryMailStore();
    let clock = 1_000_000;
    const svc = new MailService({
      lane: "tenant",
      store,
      provider: transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback: memoryProvider() }),
      policy: mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "empresa-a.example" } as NodeJS.ProcessEnv),
      tenantId: "empresa-a",
      now: () => clock,
      log: () => undefined,
    });
    const input = { tenantId: "empresa-a", idempotencyKey: "k1", category: "payment_confirmed" as const, to: "c@pruebas.example", subject: "Pago", html: "<p>h</p>", sender: { lane: "tenant" as const, brandName: "Empresa A", replyTo: null, fromEmail: "reservas@empresa-a.example" } };
    expect((await svc.send(input)).status).toBe("pending");
    expect(store.rows[0].provider).toBe("postmark_tenant");
    status = 200;
    clock += 3_600_000;
    await svc.drain();
    expect(store.rows[0]).toMatchObject({ status: "accepted", provider: "postmark_tenant", providerMessageId: "id-1", senderEmail: "reservas@empresa-a.example" });
    expect(JSON.parse(calls[1].init.body!)).toMatchObject({ MessageStream: "transaccional-a", TrackOpens: false, TrackLinks: "None" });
    // Mismo aviso otra vez: idempotente, no sale otro
    expect((await svc.send(input)).duplicate).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("comprobación de la cuenta (solo lectura)", () => {
  const ok = { "/server": [200, { Name: "Empresa A", DeliveryType: "Live", TrackOpens: false, TrackLinks: "None" }], "/message-streams/outbound": [200, { ID: "outbound", Name: "Transactional", MessageStreamType: "Transactional" }] } as Record<string, [number, unknown]>;

  it("correcta: solo GET con el token del servidor; nunca envía ni crea nada", async () => {
    const calls: Call[] = [];
    const r = await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes(ok, calls) });
    expect(r).toMatchObject({ ok: true, outcome: "connected", serverName: "Empresa A", deliveryType: "Live", stream: { id: "outbound", found: true, type: "Transactional" }, warnings: [] });
    expect(calls.map((c) => [c.init.method, new URL(c.url).pathname])).toEqual([["GET", "/server"], ["GET", "/message-streams/outbound"]]);
    expect(calls.every((c) => c.init.headers["X-Postmark-Server-Token"] === SERVER_TOKEN && !c.init.body)).toBe(true);
  });

  it("token rechazado; cuenta pendiente; flujo de difusión; flujo inexistente; servidor Sandbox NO vale; red caída", async () => {
    expect(await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes({ "/server": [401, { ErrorCode: 10 }] }) })).toMatchObject({ ok: false, outcome: "rejected" });
    expect(await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes({ "/server": [422, { ErrorCode: 412 }] }) })).toMatchObject({ ok: false, outcome: "rejected" });
    const broadcast = await postmarkServerInfo({ serverToken: SERVER_TOKEN, messageStream: "boletin", fetch: routes({ ...ok, "/message-streams/boletin": [200, { MessageStreamType: "Broadcasts" }] }) });
    expect(broadcast).toMatchObject({ ok: false, outcome: "error", stream: { type: "Broadcasts" } });
    expect(broadcast.message).toMatch(/transaccional/);
    expect(await postmarkServerInfo({ serverToken: SERVER_TOKEN, messageStream: "no-existe", fetch: routes(ok) })).toMatchObject({ ok: false, outcome: "error" });
    const sandbox = await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes({ ...ok, "/server": [200, { Name: "A", DeliveryType: "Sandbox" }] }) });
    expect(sandbox).toMatchObject({ ok: false, outcome: "error", deliveryType: "Sandbox" });
    const tracking = await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes({ ...ok, "/server": [200, { Name: "A", DeliveryType: "Live", TrackOpens: true }] }) });
    expect(tracking.ok).toBe(true);
    expect(tracking.warnings).toHaveLength(1);
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: down })).toMatchObject({ ok: false, outcome: "error" });
  });

  it("probador del almacén de credenciales", async () => {
    expect(await testProvider("postmark", {}, routes(ok) as never)).toMatchObject({ ok: false });
    expect(await testProvider("postmark", { serverToken: SERVER_TOKEN }, routes(ok) as never)).toMatchObject({ ok: true, outcome: "connected" });
    expect(await testProvider("postmark", { serverToken: SERVER_TOKEN }, routes({ "/server": [401, {}] }) as never)).toMatchObject({ ok: false, outcome: "rejected" });
  });
});

describe("webhook del Core con el token de cada empresa", () => {
  async function setup() {
    const store = new MemoryMailStore();
    const svc = new MailService({ lane: "tenant", store, provider: memoryProvider(), policy: mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "empresa-a.example" } as NodeJS.ProcessEnv), tenantId: "empresa-a", log: () => undefined });
    const r = await svc.send({ tenantId: "empresa-a", idempotencyKey: "w1", category: "operational", to: "c@pruebas.example", subject: "s", html: "<p>h</p>", sender: { lane: "tenant", brandName: "A", replyTo: null } });
    const handler = tenantPostmarkWebhookHandler({ token: () => HOOK_A, resolve: async (lane, t) => (lane === "tenant" && t === "empresa-a" ? svc : null), log: () => undefined });
    const post = async (tenant: string, body: unknown, headers: Record<string, string>) => {
      let status = 200;
      let json: any = null;
      const res: any = { status: (s: number) => ((status = s), res), json: (j: unknown) => ((json = j), res) };
      await runWithTenant(tenant, () => handler({ headers, body } as any, res));
      return { status, json };
    };
    return { store, id: r.id!, post };
  }
  const bounce = (tenant: string, id: number, email = "c@pruebas.example") => ({ RecordType: "Bounce", Type: "HardBounce", ID: 7, Email: email, MessageID: "<mem-1@memory.example>", BouncedAt: "2026-11-08T10:00:00Z", Metadata: postmarkRefMetadata(mailRef("tenant", tenant, id)) });

  it("monoempresa: 404; token de otra empresa: 401 y nada cambia; el suyo: rebote → supresión; repetido: duplicado", async () => {
    const s = await setup();
    expect((await s.post("empresa-a", bounce("empresa-a", s.id), { [WEBHOOK_TOKEN_HEADER]: HOOK_A })).status).toBe(404);
    process.env.TENANT_MODE = "multi";
    expect((await s.post("empresa-a", bounce("empresa-a", s.id), { [WEBHOOK_TOKEN_HEADER]: HOOK_B })).status).toBe(401);
    expect((await s.post("empresa-a", bounce("empresa-a", s.id), {})).status).toBe(401);
    expect(s.store.rows[0].status).toBe("accepted");
    expect((await s.post("empresa-a", bounce("empresa-a", s.id), { [WEBHOOK_TOKEN_HEADER]: HOOK_A })).json).toMatchObject({ applied: 1 });
    expect(s.store.rows[0].status).toBe("bounced");
    expect(s.store.suppressions.size).toBe(1);
    expect((await s.post("empresa-a", bounce("empresa-a", s.id), { [WEBHOOK_TOKEN_HEADER]: HOOK_A })).json).toMatchObject({ duplicate: 1 });
  });

  it("se suprime el destinatario de la FILA, no la dirección que diga el cuerpo del evento", async () => {
    process.env.TENANT_MODE = "multi";
    const s = await setup();
    expect((await s.post("empresa-a", bounce("empresa-a", s.id, "otra-persona@pruebas.example"), { [WEBHOOK_TOKEN_HEADER]: HOOK_A })).json).toMatchObject({ applied: 1 });
    expect(Array.from(s.store.suppressions.keys())).toEqual([`empresa-a:${recipientHash("c@pruebas.example")}`]);
  });

  it("evento con la referencia de otra empresa: ignorado; sin token configurado: 503", async () => {
    process.env.TENANT_MODE = "multi";
    const s = await setup();
    expect((await s.post("empresa-a", bounce("empresa-b", s.id), { [WEBHOOK_TOKEN_HEADER]: HOOK_A })).json).toMatchObject({ applied: 0, ignored: 1 });
    expect(s.store.rows[0].status).toBe("accepted");
    const none = tenantPostmarkWebhookHandler({ token: () => null, log: () => undefined });
    let status = 0;
    const res: any = { status: (x: number) => ((status = x), res), json: () => res };
    await runWithTenant("empresa-a", () => none({ headers: { [WEBHOOK_TOKEN_HEADER]: HOOK_A }, body: {} } as any, res));
    expect(status).toBe(503);
  });

  it("límite de peticiones por empresa e IP: la clave cambia con la empresa del dominio", async () => {
    const req = { ip: "203.0.113.7" } as any;
    const a = await runWithTenant("empresa-a", async () => webhookRateKey(req));
    const b = await runWithTenant("empresa-b", async () => webhookRateKey(req));
    expect(a).toMatch(/^pm-webhook:empresa-a:/);
    expect(b).toMatch(/^pm-webhook:empresa-b:/);
    expect(a).not.toBe(b);
  });

  it("cuerpo: el lector propio (antes del general de 50 MB) admite 256 KB y corta lo que pase con 413", async () => {
    const app = express();
    app.use(tenantPostmarkWebhookBodyParser);
    app.use(express.json({ limit: "50mb" }));
    app.post("/api/mail/postmark/webhook", (req, res) => void res.json({ keys: Object.keys(req.body ?? {}) }));
    app.post("/otra", (req, res) => void res.json({ size: JSON.stringify(req.body).length }));
    const server = await new Promise<http.Server>((ok) => {
      const s = app.listen(0, "127.0.0.1", () => ok(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const post = (path: string, body: string) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
      const small = await post("/api/mail/postmark/webhook", JSON.stringify({ RecordType: "Delivery" }));
      expect(small.status).toBe(200);
      expect(await small.json()).toEqual({ keys: ["RecordType"] });
      const big = JSON.stringify({ pad: "x".repeat(TENANT_POSTMARK_WEBHOOK_MAX_BYTES + 10) });
      expect((await post("/api/mail/postmark/webhook", big)).status).toBe(413);
      expect((await post("/api/mail/postmark/webhook/", big)).status).toBe(413);
      // El resto de rutas sigue con el lector general
      expect((await post("/otra", big)).status).toBe(200);
    } finally {
      await new Promise((ok) => server.close(ok));
    }
  });
});
