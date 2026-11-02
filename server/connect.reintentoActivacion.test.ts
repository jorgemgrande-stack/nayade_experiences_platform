/**
 * «Reintentar» la activación desde el panel (connect.retryActivation): el Core llama al canal comercial con el tenant
 * de la SESIÓN y solo la clave del producto; solo la administración puede reintentar; cada respuesta del canal (200,
 * 202, 409, 429, 404) llega como un mensaje claro en español; sin canal no se promete nada. Nunca hay cobro: el canal
 * solo repite pasos idempotentes de la activación.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { CommerceClient } from "./commerceClient";

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ tenantId: string; key: string }>,
  reply: { kind: "ok" as "ok" | "error", outcome: "active" as "active" | "resumed" | "in_progress", status: 0 },
  channel: true,
}));

vi.mock("./commerceClient", async (orig) => {
  const real = await orig<typeof import("./commerceClient")>();
  const client: Partial<CommerceClient> = {
    retryActivation: async (tenantId, key) => {
      fake.calls.push({ tenantId, key });
      if (fake.reply.kind === "error") throw new real.CommerceError(fake.reply.status, "error", "texto técnico del servicio");
      return { outcome: fake.reply.outcome };
    },
  };
  return { ...real, commerceClientFromEnv: () => (fake.channel ? (client as CommerceClient) : null) };
});

import { router } from "./_core/trpc";
import { connectRouter, RETRY_MESSAGES } from "./routers/connectRouter";
import { runWithTenant } from "./_core/tenant";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";

const app = router({ connect: connectRouter });
const ctxFor = (role: string): TrpcContext => ({
  user: { id: 3, openId: "o", email: "ana@empresa.example", name: "Ana", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});
const retry = (role = "admin", key = "connect-people", tenant = "empresa-a") => runWithTenant(tenant, () => app.createCaller(ctxFor(role)).connect.retryActivation({ key }));
const env = { ...process.env };

beforeAll(() => {
  process.env.TENANT_MODE = "multi";
  configureCapabilityAccess(new MemoryCapabilityStore(), { now: () => Date.now(), enforce: true, ttlMs: 30_000 });
});
afterAll(() => {
  process.env = env;
  _resetCapabilityAccessForTests();
});
beforeEach(() => {
  fake.calls.length = 0;
  fake.reply = { kind: "ok", outcome: "active", status: 0 };
  fake.channel = true;
});

describe("reintento de la activación desde el panel", () => {
  it("200 → activo; 202 → reanudada o ya en marcha; con el tenant de la sesión y solo la clave", async () => {
    expect(await retry()).toEqual({ outcome: "active", message: RETRY_MESSAGES.active });
    fake.reply.outcome = "resumed";
    expect(await retry("admin", "connect-people", "empresa-b")).toEqual({ outcome: "resumed", message: RETRY_MESSAGES.resumed });
    fake.reply.outcome = "in_progress";
    expect((await retry()).message).toBe(RETRY_MESSAGES.in_progress);
    expect(fake.calls).toEqual([
      { tenantId: "empresa-a", key: "connect-people" },
      { tenantId: "empresa-b", key: "connect-people" },
      { tenantId: "empresa-a", key: "connect-people" },
    ]);
  });

  it("409, 429 y 404: mensaje claro en español (nunca el texto técnico del servicio)", async () => {
    const cases = [
      [409, "CONFLICT", /nada que reintentar/],
      [429, "TOO_MANY_REQUESTS", /Espera unos minutos/],
      [404, "NOT_FOUND", /No encontramos ninguna activación/],
    ] as const;
    for (const [status, code, message] of cases) {
      fake.reply = { kind: "error", outcome: "active", status };
      const e = await retry().catch((x) => x);
      expect(e).toMatchObject({ code });
      expect(e.message).toMatch(message);
      expect(e.message).not.toMatch(/técnico/);
    }
  });

  it("solo la administración reintenta; los demás roles no llegan al canal", async () => {
    for (const role of ["agente", "user"]) await expect(retry(role)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fake.calls).toHaveLength(0);
  });

  it("sin canal con el plano de control: no disponible, sin llamar a nada; clave con forma rara → rechazada", async () => {
    fake.channel = false;
    await expect(retry()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    fake.channel = true;
    await expect(retry("admin", "../otra")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fake.calls).toHaveLength(0);
  });
});
