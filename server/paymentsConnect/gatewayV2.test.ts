/**
 * Alta de cuenta conectada con Accounts v2 (Stripe rechaza POST /v1/accounts en integraciones Connect nuevas).
 * Servidor Stripe simulado en local: se comprueba la ruta, el cuerpo, la clave de idempotencia y el enlace de alta.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { stripeConnectGateway, ConnectGatewayError } from "./gateway";

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };

describe("pasarela Connect — Accounts v2", () => {
  let server: http.Server;
  let port = 0;
  const seen: Seen[] = [];
  let failAccounts = false;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/v2/core/accounts") && req.method === "POST") {
          if (failAccounts) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "no" } }));
            return;
          }
          res.end(JSON.stringify({ id: "acct_v2test", object: "v2.core.account" }));
          return;
        }
        if (req.url?.startsWith("/v2/core/account_links")) {
          res.end(JSON.stringify({ object: "v2.core.account_link", account: "acct_v2test", url: "https://connect.stripe.test/setup/x", expires_at: "2026-11-20T10:00:00.000Z", use_case: { type: "account_onboarding" } }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "ruta inesperada" } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const gateway = () => stripeConnectGateway({ mode: "test", apiKey: ["rk", "test", "a1b2c3d4e5f6g7h8"].join("_"), webhookSecret: ["whsec", "x"].join("_") }, { host: "127.0.0.1", port, protocol: "http", maxNetworkRetries: 0 });

  it("crea la cuenta por /v2/core/accounts con panel completo, comisiones a cargo de la empresa y clave de idempotencia", async () => {
    const r = await gateway().createAccount({ tenantId: "t12-quantum-soulrise", email: "x@example.invalid", country: "ES", idempotencyKey: "connect-acct-v2-t12-quantum-soulrise-test" });
    expect(r.accountId).toBe("acct_v2test");
    const call = seen.find((s) => s.url.startsWith("/v2/core/accounts"))!;
    expect(call.method).toBe("POST");
    expect(seen.some((s) => s.url.startsWith("/v1/accounts"))).toBe(false);
    expect(call.headers["idempotency-key"]).toBe("connect-acct-v2-t12-quantum-soulrise-test");
    const b = JSON.parse(call.body);
    expect(b.dashboard).toBe("full");
    expect(b.defaults.responsibilities).toEqual({ fees_collector: "stripe", losses_collector: "stripe" });
    expect(b.configuration.merchant.capabilities.card_payments.requested).toBe(true);
    expect(b.identity.country).toBe("es");
    expect(b.contact_email).toBe("x@example.invalid");
    expect(b.metadata).toEqual({ tenant_id: "t12-quantum-soulrise" });
  });

  it("el enlace de alta usa el caso account_onboarding con las direcciones de retorno y de refresco", async () => {
    const l = await gateway().createAccountLink({ accountId: "acct_v2test", returnUrl: "https://t.example/volver", refreshUrl: "https://t.example/refrescar" });
    expect(l.url).toBe("https://connect.stripe.test/setup/x");
    expect(l.expiresAt).toBe(Date.parse("2026-11-20T10:00:00.000Z"));
    const call = seen.filter((s) => s.url.startsWith("/v2/core/account_links")).pop()!;
    const b = JSON.parse(call.body);
    expect(b.account).toBe("acct_v2test");
    expect(b.use_case.type).toBe("account_onboarding");
    expect(b.use_case.account_onboarding).toEqual({ return_url: "https://t.example/volver", refresh_url: "https://t.example/refrescar" });
  });

  it("un rechazo de Stripe se traduce a un error de pasarela sin detalles ni claves", async () => {
    failAccounts = true;
    await expect(gateway().createAccount({ tenantId: "t", country: "ES", idempotencyKey: "k-v2-fallo" })).rejects.toBeInstanceOf(ConnectGatewayError);
  });
});
