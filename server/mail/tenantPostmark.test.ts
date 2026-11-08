/**
 * Postmark propio de cada empresa (correo transaccional): configuración desde la bóveda con remitente de dominio
 * verificado, reparto transaccional/comercial, comprobación de solo lectura de la cuenta, campo del webhook oculto en el
 * formulario general y webhook del Core con el token PROPIO de la empresa. Ninguna llamada real: `fetch` falso.
 */
import { describe, it, expect, afterEach } from "vitest";
import { invalidateCredentials, setResolvedCredentials } from "../_core/credentials/cache";
import { getProvider, validateFields } from "../_core/credentials/catalog";
import { panelIntegrations } from "../_core/credentials/presentation";
import { testProvider } from "../_core/credentials/testers";
import { runWithTenant } from "../_core/tenant";
import { mailPolicyFromEnv } from "./policy";
import { memoryProvider, postmarkProvider, postmarkRefMetadata, type FetchLike } from "./providers";
import { MailService, mailRef } from "./service";
import { MemoryMailStore } from "./store";
import { MailProviderError, type ProviderMessage } from "./types";
import { WEBHOOK_TOKEN_HEADER } from "./webhook";
import { postmarkConfigFrom, postmarkServerInfo, tenantPostmark, tenantPostmarkWebhookToken, transactionalRouter } from "./tenantPostmark";
import { tenantPostmarkWebhookHandler } from "./tenantPostmarkWebhook";

// Valores ficticios construidos en ejecución (sin formato de clave real en el código)
const SERVER_TOKEN = ["prueba", "x".repeat(8), "y".repeat(12)].join("-");
const HOOK_A = "a".repeat(43);
const HOOK_B = "b".repeat(43);
const verifiedA = { customDomains: [{ domain: "empresa-a.example", state: "verified" as const, isPrimary: true }] };
const pendingA = { customDomains: [{ domain: "empresa-a.example", state: "pending" as const, isPrimary: true }] };

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
  it("sin datos → desactivada; incompleta; remitente no válido; dominio sin verificar; completa con flujo «outbound» por defecto", () => {
    expect(postmarkConfigFrom({}, verifiedA)).toMatchObject({ config: null, problem: "not_configured" });
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN }, verifiedA)).toMatchObject({ config: null, problem: "incomplete" });
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN, fromEmail: "no es correo" }, verifiedA)).toMatchObject({ config: null, problem: "sender_invalid" });
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN, fromEmail: "reservas@empresa-a.example" }, pendingA)).toMatchObject({ config: null, problem: "domain_not_verified", domain: "empresa-a.example" });
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN, fromEmail: "reservas@otra.example" }, verifiedA).problem).toBe("domain_not_verified");
    expect(postmarkConfigFrom({ serverToken: SERVER_TOKEN, fromEmail: "Reservas@Empresa-A.example", webhookToken: "corto" }, verifiedA)).toEqual({
      config: { serverToken: SERVER_TOKEN, messageStream: "outbound", fromEmail: "reservas@empresa-a.example", domain: "empresa-a.example", webhookToken: null },
      problem: null,
      domain: "empresa-a.example",
    });
  });

  it("aislamiento: cada empresa lee SU bóveda; en monoempresa nunca se usa", async () => {
    process.env.TENANT_MODE = "multi";
    await runWithTenant("empresa-a", async () => setResolvedCredentials({ postmark: { serverToken: SERVER_TOKEN, fromEmail: "reservas@empresa-a.example", webhookToken: HOOK_A } }));
    await runWithTenant("empresa-b", async () => setResolvedCredentials({}));
    expect(await runWithTenant("empresa-a", async () => tenantPostmark(verifiedA)?.fromEmail)).toBe("reservas@empresa-a.example");
    expect(await runWithTenant("empresa-a", async () => tenantPostmarkWebhookToken())).toBe(HOOK_A);
    expect(await runWithTenant("empresa-b", async () => tenantPostmark(verifiedA))).toBeNull();
    expect(await runWithTenant("empresa-b", async () => tenantPostmarkWebhookToken())).toBeNull();
    delete process.env.TENANT_MODE;
    expect(await runWithTenant("empresa-a", async () => tenantPostmark(verifiedA))).toBeNull();
  });

  it("catálogo: token, flujo y remitente validados; el token del webhook no aparece en el formulario general", () => {
    const p = getProvider("postmark")!;
    expect(p.panel.requires).toEqual(["comms-email"]);
    expect(validateFields(p, { serverToken: SERVER_TOKEN, messageStream: "outbound", fromEmail: "a@b.example" })).toEqual([]);
    expect(validateFields(p, { serverToken: "con espacios no", messageStream: "Broad Cast" })).toHaveLength(2);
    expect(validateFields(p, { webhookToken: "corto" })).toHaveLength(1);
    const status = { id: "postmark", name: p.name, description: p.description, configured: false, fields: p.fields.map((f) => ({ key: f.key, label: f.label, secret: f.secret, required: !!f.required, set: false, display: null, updatedAt: null })) };
    const [panel] = panelIntegrations([status], { licensed: true, can: (c) => c === "comms-email" });
    expect(panel.id).toBe("postmark");
    expect(panel.fields.map((f) => f.key)).toEqual(["serverToken", "messageStream", "fromEmail"]);
    expect(panelIntegrations([status], { licensed: true, can: () => false })).toEqual([]);
  });
});

describe("reparto transaccional / comercial", () => {
  const msg = (over: Partial<ProviderMessage> = {}): ProviderMessage => ({ from: { name: "Empresa A", email: "reservas@empresa-a.example" }, to: "c@pruebas.example", subject: "s", html: "<p>h</p>", tag: "operational", ref: "es1.t.empresa-a.1", idempotencyKey: "k", ...over });

  it("transaccional con el remitente de Postmark → Postmark; comercial o con otra identidad → envío de siempre", async () => {
    const primary = memoryProvider();
    const fallback = memoryProvider();
    const pm = { ...primary, name: "postmark" };
    const r = transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback });
    expect(await r.send(msg())).toMatchObject({ provider: "postmark" });
    expect(await r.send(msg({ tag: "marketing" }))).toMatchObject({ provider: "memory" });
    expect(await r.send(msg({ tag: "survey" }))).toMatchObject({ provider: "memory" });
    expect(await r.send(msg({ from: { name: "x", email: "no-reply@plataforma.example" } }))).toMatchObject({ provider: "memory" });
    expect(primary.sent).toHaveLength(1);
    expect(fallback.sent).toHaveLength(3);
    const lone = transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback: null });
    await expect(lone.send(msg({ tag: "marketing" }))).rejects.toMatchObject({ code: "no_provider", retryable: false });
  });

  it("la bandeja guarda el proveedor que envió de verdad y Postmark va sin seguimiento por el flujo de la empresa", async () => {
    const calls: Call[] = [];
    const pm = postmarkProvider({ serverToken: SERVER_TOKEN, messageStream: "transaccional-a", fetch: routes({ "/email": [200, { ErrorCode: 0, MessageID: "id-1" }] }, calls) });
    const store = new MemoryMailStore();
    const svc = new MailService({
      lane: "tenant",
      store,
      provider: transactionalRouter({ primary: pm, primaryDomain: "empresa-a.example", fallback: memoryProvider() }),
      policy: mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "empresa-a.example" } as NodeJS.ProcessEnv),
      tenantId: "empresa-a",
      log: () => undefined,
    });
    const r = await svc.send({ tenantId: "empresa-a", idempotencyKey: "k1", category: "payment_confirmed", to: "c@pruebas.example", subject: "Pago", html: "<p>h</p>", sender: { lane: "tenant", brandName: "Empresa A", replyTo: null, fromEmail: "reservas@empresa-a.example" } });
    expect(r.status).toBe("accepted");
    expect(store.rows[0]).toMatchObject({ provider: "postmark", providerMessageId: "id-1", senderEmail: "reservas@empresa-a.example" });
    const body = JSON.parse(calls[0].init.body!);
    expect(body).toMatchObject({ MessageStream: "transaccional-a", TrackOpens: false, TrackLinks: "None" });
    // Mismo aviso otra vez: idempotente, no sale otro
    expect((await svc.send({ tenantId: "empresa-a", idempotencyKey: "k1", category: "payment_confirmed", to: "c@pruebas.example", subject: "Pago", html: "<p>h</p>", sender: { lane: "tenant", brandName: "Empresa A", replyTo: null, fromEmail: "reservas@empresa-a.example" } })).duplicate).toBe(true);
    expect(calls).toHaveLength(1);
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

  it("token rechazado; flujo de difusión; flujo inexistente; Sandbox avisa; red caída", async () => {
    expect(await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes({ "/server": [401, { ErrorCode: 10 }] }) })).toMatchObject({ ok: false, outcome: "rejected" });
    const broadcast = await postmarkServerInfo({ serverToken: SERVER_TOKEN, messageStream: "boletin", fetch: routes({ ...ok, "/message-streams/boletin": [200, { MessageStreamType: "Broadcasts" }] }) });
    expect(broadcast).toMatchObject({ ok: false, outcome: "error", stream: { type: "Broadcasts" } });
    expect(broadcast.message).toMatch(/transaccional/);
    expect(await postmarkServerInfo({ serverToken: SERVER_TOKEN, messageStream: "no-existe", fetch: routes(ok) })).toMatchObject({ ok: false, outcome: "error" });
    const sandbox = await postmarkServerInfo({ serverToken: SERVER_TOKEN, fetch: routes({ ...ok, "/server": [200, { Name: "A", DeliveryType: "Sandbox", TrackOpens: true }] }) });
    expect(sandbox.ok).toBe(true);
    expect(sandbox.warnings).toHaveLength(2);
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
  const bounce = (tenant: string, id: number) => ({ RecordType: "Bounce", Type: "HardBounce", ID: 7, Email: "c@pruebas.example", MessageID: "<mem-1@memory.example>", BouncedAt: "2026-11-08T10:00:00Z", Metadata: postmarkRefMetadata(mailRef("tenant", tenant, id)) });

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
    void MailProviderError;
  });
});
