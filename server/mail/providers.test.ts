/**
 * Adaptador de Brevo (API HTTP v3) y diagnóstico de cuenta con un `fetch` inyectado: nunca sale a la red.
 */
import { describe, it, expect } from "vitest";
import { brevoDiagnostics, brevoProvider, mailProviderFromEnv } from "./providers";
import { MailProviderError, type ProviderMessage } from "./types";

const KEY = "xkeysib-ficticia-solo-pruebas-0000"; // gitleaks:allow

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function fakeFetch(responses: Record<string, { status: number; body?: unknown }> | ((url: string) => { status: number; body?: unknown })) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const path = new URL(url).pathname;
    const r = typeof responses === "function" ? responses(url) : (responses[path] ?? { status: 404 });
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
  };
  return { calls, fetch };
}

const m: ProviderMessage = {
  from: { name: "Acme Ejemplo", email: "no-reply@envios.example" },
  replyTo: "hola@acme.example",
  to: "cliente@pruebas.example",
  cc: ["copia@pruebas.example"],
  subject: "Asunto",
  html: "<p>x</p>",
  text: "x",
  tag: "password_reset",
  ref: "es1.t.acme.7",
  idempotencyKey: "acme:reset:1",
};

describe("Brevo: envío transaccional", () => {
  it("petición oficial: POST /v3/smtp/email con api-key, remitente, Reply-To, etiqueta y referencia", async () => {
    const f = fakeFetch({ "/v3/smtp/email": { status: 201, body: { messageId: "<abc@smtp-relay.example>" } } });
    const r = await brevoProvider({ apiKey: KEY, fetch: f.fetch, baseUrl: "https://api.brevo.example" }).send(m);
    expect(r.messageId).toBe("<abc@smtp-relay.example>");
    const c = f.calls[0];
    expect(c.url).toBe("https://api.brevo.example/v3/smtp/email");
    expect(c.method).toBe("POST");
    expect(c.headers["api-key"]).toBe(KEY);
    expect(c.body).toMatchObject({
      sender: { name: "Acme Ejemplo", email: "no-reply@envios.example" },
      replyTo: { email: "hola@acme.example" },
      to: [{ email: "cliente@pruebas.example" }],
      cc: [{ email: "copia@pruebas.example" }],
      tags: ["password_reset"],
      headers: { "X-Mailin-custom": "es1.t.acme.7", "X-Mailin-no-track": "1" },
    });
  });

  it("adjuntos: por URL pública o con el contenido (fichero privado del almacenamiento), nunca la URL privada", async () => {
    const f = fakeFetch({ "/v3/smtp/email": { status: 201, body: { messageId: "<a@x.example>" } } });
    await brevoProvider({ apiKey: KEY, fetch: f.fetch }).send({
      ...m,
      attachments: [
        { name: "factura.pdf", url: "https://cdn.example/f.pdf" },
        { name: "presupuesto.pdf", url: "https://acme.example/api/files/obj_1", content: Buffer.from("%PDF").toString("base64") },
      ],
    });
    expect(f.calls[0].body.attachment).toEqual([
      { url: "https://cdn.example/f.pdf", name: "factura.pdf" },
      { content: "JVBERg==", name: "presupuesto.pdf" },
    ]);
  });

  it("errores: 400 definitivo con el código documentado; 429/5xx/red reintentables; el mensaje del proveedor no se conserva", async () => {
    const cases: Array<[number, unknown, string, boolean]> = [
      [400, { code: "invalid_parameter", message: "email cliente@pruebas.example no válido" }, "invalid_parameter", false],
      [401, { code: "unauthorized" }, "unauthorized", false],
      [429, {}, "http_429", true],
      [503, { code: "Texto raro con espacios" }, "http_503", true],
    ];
    for (const [status, body, code, retryable] of cases) {
      const f = fakeFetch(() => ({ status, body }));
      const e = (await brevoProvider({ apiKey: KEY, fetch: f.fetch }).send(m).catch((x) => x)) as MailProviderError;
      expect(e).toBeInstanceOf(MailProviderError);
      expect([e.code, e.retryable]).toEqual([code, retryable]);
      expect(e.message).not.toMatch(/pruebas\.example/);
    }
    const net = await brevoProvider({ apiKey: KEY, fetch: async () => { throw new TypeError("fetch failed"); } }).send(m).catch((x) => x);
    expect([net.code, net.retryable]).toEqual(["network_error", true]);
  });

  it("proveedor desde el entorno: Brevo con clave, SMTP como alternativa, ninguno sin configuración", () => {
    expect(mailProviderFromEnv({ BREVO_API_KEY: KEY } as NodeJS.ProcessEnv)?.name).toBe("brevo");
    expect(mailProviderFromEnv({ SMTP_HOST: "smtp.example", SMTP_USER: "u", SMTP_PASS: "p" } as NodeJS.ProcessEnv)?.name).toBe("smtp");
    expect(mailProviderFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("Brevo: diagnóstico de cuenta (sin enviar)", () => {
  const ok = {
    "/v3/account": { status: 200, body: { email: "propietario@privado.example", companyName: "Big Elephant", plan: [{ type: "free", credits: 300, creditsType: "sendLimit" }], relay: { enabled: true, data: { userName: "login@privado.example", relay: "smtp-relay.example", port: 587 } } } },
    "/v3/senders": { status: 200, body: { senders: [{ id: 1, name: "Elephant", email: "no-reply@envios.example", active: true, ips: [] }] } },
    "/v3/senders/domains": { status: 200, body: { domains: [{ id: "1", domain_name: "envios.example", authenticated: false, verified: true, ip: null }] } },
    "/v3/senders/domains/envios.example": { status: 200, body: { domain: "envios.example", verified: true, authenticated: false, dns_records: { brevo_code: { type: "TXT", value: "brevo-code:ficticio", host_name: "@", status: true }, dkim_record: { type: "TXT", value: "k=rsa;p=FICTICIO", host_name: "mail._domainkey", status: false }, dmarc_record: { type: "TXT", value: "v=DMARC1; p=none", host_name: "_dmarc", status: false } } } },
  };

  it("solo GET a endpoints oficiales; resume dominio y registros sin valores ni el correo de acceso", async () => {
    const f = fakeFetch(ok);
    const r = await brevoDiagnostics({ apiKey: KEY, sendingDomain: "envios.example", fetch: f.fetch });
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
    expect(f.calls.map((c) => new URL(c.url).pathname).sort()).toEqual(["/v3/account", "/v3/senders", "/v3/senders/domains", "/v3/senders/domains/envios.example"]);
    expect(r.ok).toBe(false);
    expect(r.account).toMatchObject({ companyName: "Big Elephant", transactionalEnabled: true });
    expect(r.sendingDomain).toMatchObject({ found: true, authenticated: false, records: { brevo_code: { ok: true }, dkim_record: { ok: false, hostName: "mail._domainkey" } } });
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/privado\.example|FICTICIO|brevo-code:ficticio/);
    expect(r.verdict.join(" ")).toMatch(/SIN autenticar/);
  });

  it("clave no válida y dominio no dado de alta", async () => {
    const f = fakeFetch({ "/v3/account": { status: 401 }, "/v3/senders": { status: 401 }, "/v3/senders/domains": { status: 200, body: { domains: [] } } });
    const r = await brevoDiagnostics({ apiKey: KEY, sendingDomain: "envios.example", fetch: f.fetch });
    expect(r.ok).toBe(false);
    expect(r.errors.account).toBe("http_401");
    expect(r.verdict.join(" ")).toMatch(/401/);
    expect(r.verdict.join(" ")).toMatch(/no está dado de alta/);
  });
});
