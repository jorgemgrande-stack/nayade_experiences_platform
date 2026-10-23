/**
 * Envío de PRUEBA de las comunicaciones de plataforma (POST /cp/v1/notifications/test-send): por la bandeja real, solo
 * con MAIL_MODE=sandbox (la política entrega únicamente a la lista de autorizados), con ámbito ops:write; en off o live,
 * 409. Una dirección fuera de la lista no recibe nada.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { allPreviews } from "./notifications/preview";
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { PlatformMailer } from "./mail/platform";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const OPS_W = "token-operaciones-escritura-000000000000000";
const OPS_R = "token-operaciones-lectura-0000000000000000";
let server: http.Server | null = null;

async function start(mode: "off" | "sandbox" | "live") {
  const env = { MAIL_MODE: mode, MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "jorge@pruebas.example", MAIL_LIVE_AUTHORIZED: "1" } as NodeJS.ProcessEnv;
  const policy = mailPolicyFromEnv(env);
  const provider = memoryProvider();
  const svc = new MailService({ lane: "platform", store: new MemoryMailStore(), provider, policy });
  const regStore = new MemoryTenantRegistryStore();
  const registry = new TenantRegistryService(regStore, () => keyringFromEnv({ REGISTRY_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv));
  server = http.createServer(
    createControlPlaneApp({
      tokens: [
        { id: "ops-w", sha256: hashToken(OPS_W), scopes: ["ops:read", "ops:write"] },
        { id: "ops-r", sha256: hashToken(OPS_R), scopes: ["ops:read"] },
      ],
      registry,
      reader: regStore,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined as never, setStatus: async () => undefined as never, revoke: async () => undefined as never },
      quotas: { listQuotas: async () => [], set: async () => undefined as never, remove: async () => undefined as never },
      platformTarget: "edge.example.com",
      mail: { platform: new PlatformMailer(svc, policy), ledger: null },
    }),
  );
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`;
  const post = async (body: unknown, token = OPS_W) => {
    const r = await fetch(`${base}/notifications/test-send`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { post, provider };
}

afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

describe("envío de prueba de plataforma", () => {
  it("sandbox: todas las vistas previas al destinatario autorizado, con [Prueba] en el asunto", async () => {
    const { post } = await start("sandbox");
    const r = await post({ to: "jorge@pruebas.example" });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(allPreviews().length);
    expect(r.body.results.every((x: any) => x.status !== "suppressed" && x.status !== "failed")).toBe(true);
  });

  it("un destinatario fuera de la lista no recibe nada (lo bloquea la política del sandbox)", async () => {
    const { post } = await start("sandbox");
    const r = await post({ to: "cliente@real.example", ids: ["trial.reminder"] });
    expect(r.status).toBe(200);
    expect(r.body.results[0].status).not.toMatch(/accepted|delivered|queued/);
  });

  it("off y live: 409 (nunca envía a clientes reales); sin ops:write, 403", async () => {
    for (const mode of ["off", "live"] as const) {
      const { post } = await start(mode);
      expect((await post({ to: "jorge@pruebas.example" })).status, mode).toBe(409);
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    const { post } = await start("sandbox");
    expect((await post({ to: "jorge@pruebas.example" }, OPS_R)).status).toBe(403);
  });
});
