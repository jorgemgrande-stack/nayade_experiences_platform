/**
 * Webhook de Brevo: autenticidad por cabecera propia (mecanismo oficial «headers» del webhook), eventos
 * válidos e inválidos, lotes y ausencia de cambios sin validación.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { mailPolicyFromEnv, recipientHash } from "./policy";
import { memoryProvider } from "./providers";
import { MailService, mailRef } from "./service";
import { MemoryMailStore } from "./store";
import { WEBHOOK_TOKEN_HEADER, createBrevoWebhookRouter, parseBrevoEvent, webhookTokenValid } from "./webhook";

const TOKEN = "token-de-webhook-ficticio-solo-pruebas-000000"; // gitleaks:allow
const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv);

async function setup(token: string | null = TOKEN) {
  const store = new MemoryMailStore();
  const svc = new MailService({ lane: "tenant", store, provider: memoryProvider(), policy, tenantId: "acme" });
  const r = await svc.send({ tenantId: "acme", idempotencyKey: "k1", category: "operational", to: "cliente@pruebas.example", subject: "s", html: "<p>h</p>", sender: { lane: "tenant", brandName: "Acme", replyTo: null } });
  const app = express();
  app.use(createBrevoWebhookRouter({ token, resolve: async (lane, tenantId) => (lane === "tenant" && tenantId === "acme" ? svc : null), log: () => undefined }));
  const server = http.createServer(app);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/brevo`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { store, svc, id: r.id!, post, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

const event = (id: number, over: Record<string, unknown> = {}) => ({
  event: "hard_bounce",
  email: "cliente@pruebas.example",
  "message-id": "<mem-1@memory.example>",
  ts_epoch: 1_800_000_000_123,
  "X-Mailin-custom": mailRef("tenant", "acme", id),
  reason: "550 5.1.1 <cliente@pruebas.example>: user unknown",
  ...over,
});

describe("webhook de Brevo", () => {
  afterAll(() => s?.close());
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    await s?.close();
    s = await setup();
  });

  it("sin la cabecera o con un token distinto: 401 y ningún cambio", async () => {
    expect((await s.post(event(s.id))).status).toBe(401);
    expect((await s.post(event(s.id), { [WEBHOOK_TOKEN_HEADER]: TOKEN + "x" })).status).toBe(401);
    expect((await s.post(event(s.id), { authorization: `Bearer ${TOKEN}` })).status).toBe(401);
    expect(s.store.rows[0].status).toBe("accepted");
    expect(s.store.suppressions.size).toBe(0);
  });

  it("sin token configurado (o corto): 503 y ningún cambio", async () => {
    for (const t of [null, "corto"]) {
      const x = await setup(t);
      expect((await x.post(event(x.id), { [WEBHOOK_TOKEN_HEADER]: t ?? "" })).status).toBe(503);
      expect(x.store.rows[0].status).toBe("accepted");
      await x.close();
    }
  });

  it("válido: rebote duro → «bounced» y destinatario suprimido; repetido → duplicado", async () => {
    const r = await s.post(event(s.id), { [WEBHOOK_TOKEN_HEADER]: TOKEN });
    expect(r).toMatchObject({ status: 200, json: { applied: 1 } });
    expect(s.store.rows[0].status).toBe("bounced");
    expect(s.store.suppressions.get(`acme:${recipientHash("cliente@pruebas.example")}`)).toBe("hard_bounce");
    expect((await s.post(event(s.id), { [WEBHOOK_TOKEN_HEADER]: TOKEN })).json).toMatchObject({ duplicate: 1, applied: 0 });
    // El motivo se guarda sin la dirección
    expect(JSON.stringify(s.store.events)).not.toMatch(/cliente@pruebas/);
  });

  it("lote con eventos ajenos, de otra empresa o sin referencia: se ignoran", async () => {
    const r = await s.post(
      [
        { event: "opened", "X-Mailin-custom": mailRef("tenant", "acme", s.id) },
        event(s.id, { event: "delivered" }),
        event(999, { "X-Mailin-custom": mailRef("tenant", "beta", 1) }),
        { event: "delivered", "message-id": "<sin-ref@x.example>" },
      ],
      { [WEBHOOK_TOKEN_HEADER]: TOKEN },
    );
    expect(r.json).toEqual({ received: 4, applied: 1, duplicate: 0, ignored: 3 });
    expect(s.store.rows[0].status).toBe("delivered");
  });

  it("baja: suprime sin cambiar el estado de entrega", async () => {
    await s.post(event(s.id, { event: "unsubscribed" }), { [WEBHOOK_TOKEN_HEADER]: TOKEN });
    expect(s.store.rows[0].status).toBe("accepted");
    expect(s.store.suppressions.size).toBe(1);
  });

  it("traducción de eventos y comparación del token", () => {
    expect(parseBrevoEvent({ event: "soft_bounce" })?.kind).toBe("soft_bounce");
    expect(parseBrevoEvent({ event: "spam" })?.kind).toBe("spam");
    expect(parseBrevoEvent({ event: "blocked" })?.kind).toBe("blocked");
    expect(parseBrevoEvent({ event: "invalid_email" })?.kind).toBe("invalid");
    expect(parseBrevoEvent({ event: "click" })).toBeNull();
    expect(parseBrevoEvent("x")).toBeNull();
    expect(parseBrevoEvent(event(1))?.reason).not.toMatch(/cliente@pruebas/);
    expect(webhookTokenValid(TOKEN, TOKEN)).toBe(true);
    expect(webhookTokenValid(TOKEN, undefined)).toBe(false);
    expect(webhookTokenValid("corto", "corto")).toBe(false);
  });
});
