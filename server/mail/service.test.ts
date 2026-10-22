/**
 * Servicio de correo centralizado (unitarias, sin red ni base de datos): modos, sandbox, idempotencia,
 * reintentos con espera, límites, supresiones, aislamiento por empresa, remitente y registros sin datos
 * personales. Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setLogSink } from "../_core/ops/log";
import { mailPolicyFromEnv, recipientHash } from "./policy";
import { brevoProvider, memoryProvider } from "./providers";
import { MailService, contentKey, mailRef, parseMailRef, type SendInput } from "./service";
import { MemoryMailStore } from "./store";
import { MailProviderError } from "./types";

const BASE_ENV = { MAIL_SENDING_DOMAIN: "envios.example", MAIL_SANDBOX_ALLOWLIST: "permitido@pruebas.example,equipo.example" };
let clock = 1_800_000_000_000;
const now = () => clock;

function make(env: Record<string, string> = {}, o: { tenantId?: string; failWith?: MailProviderError | null } = {}) {
  const store = new MemoryMailStore();
  const provider = memoryProvider({ failWith: o.failWith ?? null });
  const policy = mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "sandbox", ...env } as NodeJS.ProcessEnv);
  const svc = new MailService({ lane: "tenant", store, provider, policy, tenantId: o.tenantId ?? "acme", now });
  return { store, provider, svc, policy };
}

const msg = (over: Partial<SendInput> = {}): SendInput => ({
  tenantId: "acme",
  idempotencyKey: "reset:1",
  category: "password_reset",
  to: "permitido@pruebas.example",
  subject: "Recuperar contraseña — Acme Ejemplo",
  html: '<p>Hola</p><a href="https://acme.elephantsource.example/nueva-contrasena?token=tok_SECRETO_123456789">Cambiar</a>',
  text: "Enlace: https://acme.elephantsource.example/nueva-contrasena?token=tok_SECRETO_123456789",
  sender: { lane: "tenant", brandName: "Acme Ejemplo", replyTo: "hola@acme.example" },
  ...over,
});

let lines: string[] = [];
beforeEach(() => {
  clock = 1_800_000_000_000;
  lines = [];
  setLogSink((_l, line) => void lines.push(line));
});
afterEach(() => setLogSink(null));

describe("modo de envío", () => {
  it("por defecto off: no sale nada y no se guarda el cuerpo", async () => {
    const store = new MemoryMailStore();
    const provider = memoryProvider();
    const svc = new MailService({ lane: "tenant", store, provider, policy: mailPolicyFromEnv({ MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv), tenantId: "acme", now });
    const r = await svc.send(msg());
    expect(r).toMatchObject({ status: "skipped", reason: "mode_off" });
    expect(provider.sent).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ html: null, text: null, toEmail: null, status: "skipped" });
  });

  it("live sin autorización expresa queda en off", () => {
    expect(mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "live" } as NodeJS.ProcessEnv)).toMatchObject({ mode: "off", degradedReason: "live_not_authorized" });
    expect(mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "live", MAIL_LIVE_AUTHORIZED: "1" } as NodeJS.ProcessEnv).mode).toBe("live");
  });

  it("sandbox sin lista o sin dominio de envío queda en off; modo desconocido, off", () => {
    expect(mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv)).toMatchObject({ mode: "off", degradedReason: "sandbox_without_allowlist" });
    expect(mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "equipo.example" } as NodeJS.ProcessEnv)).toMatchObject({ mode: "off", degradedReason: "sending_domain_missing" });
    expect(mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "LIVEE" } as NodeJS.ProcessEnv)).toMatchObject({ mode: "off", degradedReason: "unknown_mode" });
  });

  it("sandbox: solo direcciones o dominios autorizados (no subdominios ni parecidos)", async () => {
    const { svc, provider } = make();
    expect((await svc.send(msg({ idempotencyKey: "a" }))).status).toBe("accepted");
    expect((await svc.send(msg({ idempotencyKey: "b", to: "Alguien@Equipo.example" }))).status).toBe("accepted");
    for (const [k, to] of [["c", "otro@pruebas.example"], ["d", "x@sub.equipo.example"], ["e", "x@equipo.example.evil.example"], ["f", "cliente@real.example"]] as const) {
      expect(await svc.send(msg({ idempotencyKey: k, to }))).toMatchObject({ status: "skipped", reason: "sandbox_recipient_not_allowed" });
    }
    expect(provider.sent.map((m) => m.to)).toEqual(["permitido@pruebas.example", "alguien@equipo.example"]);
  });

  it("sandbox: las copias no autorizadas se descartan (no reciben nada)", async () => {
    const { svc, provider } = make();
    await svc.send(msg({ cc: ["copia@equipo.example", "jefe@real.example"] }));
    expect(provider.sent[0].cc).toEqual(["copia@equipo.example"]);
  });

  it("si el modo pasa a off con mensajes pendientes, el reintento no sale", async () => {
    const { svc, provider, store, policy } = make({}, { failWith: new MailProviderError("http_503", true, 503) });
    await svc.send(msg());
    expect(store.rows[0].status).toBe("pending");
    (policy as { mode: string }).mode = "off";
    provider.failWith = null;
    clock += 3_600_000;
    await svc.drain();
    expect(provider.sent).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: "skipped", reason: "mode_off", html: null });
  });
});

describe("idempotencia", () => {
  it("misma clave: un solo envío aunque se repita (doble clic o reintento del llamante)", async () => {
    const { svc, provider, store } = make();
    const [a, b] = await Promise.all([svc.send(msg()), svc.send(msg())]);
    const c = await svc.send(msg());
    expect(provider.sent).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(c).toMatchObject({ duplicate: true, status: "accepted" });
  });

  it("sin clave: el mismo contenido en la misma ventana es un duplicado; otro contenido no", async () => {
    const { svc, provider } = make();
    await svc.send(msg({ idempotencyKey: "" }));
    await svc.send(msg({ idempotencyKey: "" }));
    await svc.send(msg({ idempotencyKey: "", subject: "Otro asunto" }));
    expect(provider.sent).toHaveLength(2);
    expect(contentKey("x", "A@B.example", "s", "h", 0)).toBe(contentKey("x", "a@b.example", "s", "h", 1000));
  });
});

describe("reintentos y fallos del proveedor", () => {
  it("Brevo no disponible: reintento con espera creciente y «failed» al agotar los intentos", async () => {
    const { svc, provider, store, policy } = make({ MAIL_MAX_ATTEMPTS: "3" }, { failWith: new MailProviderError("http_503", true, 503) });
    const r = await svc.send(msg());
    expect(r.status).toBe("pending");
    const first = store.rows[0];
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt).toBe(clock + policy.retry.baseMs);
    expect(first.lastError).toBe("http_503");
    // Antes de tiempo no se reintenta
    expect(await svc.drain()).toBe(0);
    clock += policy.retry.baseMs;
    await svc.drain();
    expect(store.rows[0]).toMatchObject({ attempts: 2, status: "pending", nextAttemptAt: clock + 2 * policy.retry.baseMs });
    clock += 2 * policy.retry.baseMs;
    await svc.drain();
    expect(store.rows[0]).toMatchObject({ attempts: 3, status: "failed", reason: "http_503", html: null, toEmail: null });
    clock += 10 * policy.retry.capMs;
    expect(await svc.drain()).toBe(0);
    expect(provider.sent).toHaveLength(0);
  });

  it("se recupera si el proveedor vuelve antes de agotar los intentos", async () => {
    const { svc, provider, store, policy } = make({}, { failWith: new MailProviderError("timeout", true) });
    await svc.send(msg());
    provider.failWith = null;
    clock += policy.retry.baseMs;
    await svc.drain();
    expect(store.rows[0]).toMatchObject({ status: "accepted", attempts: 2, providerMessageId: "<mem-1@memory.example>" });
  });

  it("rechazo definitivo (4xx) no se reintenta", async () => {
    const { svc, store } = make({}, { failWith: new MailProviderError("invalid_parameter", false, 400) });
    expect((await svc.send(msg())).status).toBe("failed");
    expect(store.rows[0]).toMatchObject({ attempts: 1, reason: "invalid_parameter" });
  });

  it("con el adaptador Brevo real y la API caída (503 / red) el mensaje queda pendiente, sin romper el flujo", async () => {
    const store = new MemoryMailStore();
    let calls = 0;
    const provider = brevoProvider({
      apiKey: "xkeysib-ficticia-solo-pruebas", // gitleaks:allow
      fetch: async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return { status: 503, ok: false, json: async () => ({}), text: async () => "" };
      },
    });
    const svc = new MailService({ lane: "tenant", store, provider, policy: mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "sandbox" } as NodeJS.ProcessEnv), tenantId: "acme", now });
    expect((await svc.send(msg())).status).toBe("pending");
    expect(store.rows[0].lastError).toBe("network_error");
    clock += 60_000;
    await svc.drain();
    expect(store.rows[0]).toMatchObject({ status: "pending", lastError: "http_503", attempts: 2 });
  });

  it("sin proveedor configurado: «failed» controlado (no_provider)", async () => {
    const store = new MemoryMailStore();
    const svc = new MailService({ lane: "tenant", store, provider: null, policy: mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "sandbox" } as NodeJS.ProcessEnv), tenantId: "acme", now });
    expect(await svc.send(msg())).toMatchObject({ status: "failed", reason: "no_provider" });
    expect(store.rows[0].html).toBeNull();
  });

  it("una reserva caducada (proceso caído a mitad) se puede retomar", async () => {
    const { svc, store, provider, policy } = make();
    const { row } = await store.insert({ ...store.rows[0], tenantId: "acme", idempotencyKey: "manual", category: "operational", status: "pending", reason: null, recipientHash: recipientHash("permitido@pruebas.example"), recipientMasked: "p***@pruebas.example", toEmail: "permitido@pruebas.example", cc: [], senderName: "Acme", senderEmail: "no-reply@envios.example", replyTo: null, subject: "s", html: "<p>h</p>", text: null, attachments: [], nextAttemptAt: clock, createdAt: clock });
    await store.claim(row.id, clock, policy.retry.lockMs);
    expect(await svc.drain()).toBe(0);
    clock += policy.retry.lockMs + 1;
    await svc.drain();
    expect(provider.sent).toHaveLength(1);
  });
});

describe("límites de frecuencia", () => {
  it("por destinatario y por empresa (ventana de una hora)", async () => {
    const { svc, provider } = make({ MAIL_RATE_RECIPIENT_PER_HOUR: "2", MAIL_RATE_TENANT_PER_HOUR: "3" });
    expect((await svc.send(msg({ idempotencyKey: "1" }))).status).toBe("accepted");
    expect((await svc.send(msg({ idempotencyKey: "2" }))).status).toBe("accepted");
    expect(await svc.send(msg({ idempotencyKey: "3" }))).toMatchObject({ status: "skipped", reason: "rate_limited_recipient" });
    expect((await svc.send(msg({ idempotencyKey: "4", to: "a@equipo.example" }))).status).toBe("accepted");
    expect(await svc.send(msg({ idempotencyKey: "5", to: "b@equipo.example" }))).toMatchObject({ status: "skipped", reason: "rate_limited_tenant" });
    clock += 3_600_001;
    expect((await svc.send(msg({ idempotencyKey: "6" }))).status).toBe("accepted");
    expect(provider.sent).toHaveLength(4);
  });
});

describe("separación por empresa e identidad del remitente", () => {
  it("From de plataforma con el nombre comercial y Reply-To de la empresa; la empresa no elige el From", async () => {
    const { svc, provider } = make();
    await svc.send(msg({ sender: { lane: "tenant", brandName: 'Acme <soporte@banco.example>\r\nBcc: x@y.example', replyTo: "hola@acme.example" } }));
    expect(provider.sent[0].from.email).toBe("no-reply@envios.example");
    expect(provider.sent[0].from.name).not.toMatch(/[<>@\r\n]/);
    expect(provider.sent[0].replyTo).toBe("hola@acme.example");
  });

  it("sin nombre comercial no se envía (sender_unavailable)", async () => {
    const { svc, provider } = make();
    expect(await svc.send(msg({ sender: { lane: "tenant", brandName: "  ", replyTo: null } }))).toMatchObject({ status: "skipped", reason: "sender_unavailable" });
    expect(provider.sent).toHaveLength(0);
  });

  it("un servicio de una empresa no acepta ni despacha mensajes de otra, ni aplica sus eventos", async () => {
    const shared = new MemoryMailStore();
    const provider = memoryProvider();
    const policy = mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "sandbox" } as NodeJS.ProcessEnv);
    const acme = new MailService({ lane: "tenant", store: shared, provider, policy, tenantId: "acme", now });
    const beta = new MailService({ lane: "tenant", store: shared, provider, policy, tenantId: "beta", now });
    await expect(acme.send(msg({ tenantId: "beta" }))).rejects.toThrow(/otra empresa/);
    provider.failWith = new MailProviderError("http_503", true, 503);
    await beta.send(msg({ tenantId: "beta" }));
    provider.failWith = null;
    clock += 3_600_000;
    expect(await acme.drain()).toBe(0);
    expect(await acme.dispatch(shared.rows[0].id)).toBeNull();
    expect(provider.sent).toHaveLength(0);
    expect(await acme.applyEvent({ kind: "hard_bounce", ref: mailRef("tenant", "beta", shared.rows[0].id), messageId: null, email: null, eventId: "e1", reason: null })).toBe("ignored");
  });

  it("las supresiones son por empresa: un rebote duro en una no bloquea a otra", async () => {
    const store = new MemoryMailStore();
    const provider = memoryProvider();
    const policy = mailPolicyFromEnv({ ...BASE_ENV, MAIL_MODE: "sandbox" } as NodeJS.ProcessEnv);
    const acme = new MailService({ lane: "tenant", store, provider, policy, tenantId: "acme", now });
    const beta = new MailService({ lane: "tenant", store, provider, policy, tenantId: "beta", now });
    const r = await acme.send(msg());
    await acme.applyEvent({ kind: "hard_bounce", ref: mailRef("tenant", "acme", r.id!), messageId: "<mem-1@memory.example>", email: "permitido@pruebas.example", eventId: "ev-1", reason: null });
    expect(await acme.send(msg({ idempotencyKey: "otra" }))).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect((await beta.send(msg({ tenantId: "beta", idempotencyKey: "otra" }))).status).toBe("accepted");
  });
});

describe("eventos del proveedor", () => {
  it("entregado, queja con supresión, sin retroceder y sin aplicar dos veces", async () => {
    const { svc, store } = make();
    const r = await svc.send(msg());
    const ref = mailRef("tenant", "acme", r.id!);
    const ev = (kind: "delivered" | "spam", eventId: string) => ({ kind, ref, messageId: "<mem-1@memory.example>", email: "permitido@pruebas.example", eventId, reason: null });
    expect(await svc.applyEvent(ev("delivered", "d1"))).toBe("applied");
    expect(store.rows[0].status).toBe("delivered");
    expect(await svc.applyEvent(ev("delivered", "d1"))).toBe("duplicate");
    expect(await svc.applyEvent(ev("spam", "s1"))).toBe("applied");
    expect(store.rows[0].status).toBe("complained");
    expect(await svc.applyEvent(ev("delivered", "d2"))).toBe("applied");
    expect(store.rows[0].status).toBe("complained");
    expect(store.suppressions.get(`acme:${recipientHash("permitido@pruebas.example")}`)).toBe("complaint");
  });

  it("referencia con un messageId distinto del guardado: se ignora", async () => {
    const { svc, store } = make();
    const r = await svc.send(msg());
    expect(await svc.applyEvent({ kind: "hard_bounce", ref: mailRef("tenant", "acme", r.id!), messageId: "<otro@x.example>", email: null, eventId: "x", reason: null })).toBe("ignored");
    expect(store.rows[0].status).toBe("accepted");
  });

  it("referencia opaca: ida y vuelta, y rechaza formatos raros", () => {
    expect(parseMailRef(mailRef("platform", "platform", 42))).toEqual({ lane: "platform", tenantId: "platform", id: 42 });
    expect(parseMailRef("es1.t.ACME.1")).toBeNull();
    expect(parseMailRef("es1.t.acme.1;DROP")).toBeNull();
    expect(parseMailRef(null)).toBeNull();
  });
});

describe("privacidad", () => {
  it("los registros no contienen direcciones, asuntos, enlaces ni tokens; el cuerpo se borra al enviarse", async () => {
    const { svc, store } = make({}, { failWith: new MailProviderError("http_503", true, 503) });
    await svc.send(msg());
    clock += 60_000;
    await svc.drain();
    await svc.send(msg({ idempotencyKey: "z", to: "cliente@real.example" }));
    const all = lines.join("\n");
    expect(all).not.toMatch(/permitido@|cliente@|pruebas\.example|real\.example|tok_SECRETO|Recuperar contraseña|nueva-contrasena/);
    expect(all).toMatch(/retry_scheduled/);
    const ok = make();
    await ok.svc.send(msg());
    expect(ok.store.rows[0]).toMatchObject({ status: "accepted", html: null, text: null, toEmail: null, recipientMasked: "p***@pruebas.example" });
    expect(JSON.stringify(ok.store.events)).not.toMatch(/tok_SECRETO|permitido@/);
    void store;
  });
});
