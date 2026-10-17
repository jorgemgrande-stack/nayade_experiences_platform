import { describe, it, expect } from "vitest";
import { STRIPE_API_VERSION, StripeConfigError, assertTestObject, describeStripeConfig, looksLive, stripeConfigFromEnv } from "./config";

// Valores ficticios construidos en tiempo de ejecución (no son credenciales y no deben parecerlo en el código)
const key = (kind: string, mode: string) => [kind, mode, "x".repeat(24)].join("_");
const whsec = () => ["whsec", "y".repeat(32)].join("_");
const base = () => ({ CP_STRIPE_MODE: "test", CP_STRIPE_API_KEY: key("rk", "test"), CP_STRIPE_WEBHOOK_SECRET: whsec() });

describe("configuración de Stripe Billing (solo pruebas)", () => {
  it("apagada sin CP_STRIPE_MODE ni credenciales", () => {
    expect(stripeConfigFromEnv({})).toBeNull();
    expect(describeStripeConfig(null)).toEqual({ enabled: false });
  });

  it("clave restringida de pruebas con la versión fijada por defecto", () => {
    const c = stripeConfigFromEnv(base())!;
    expect(c).toMatchObject({ mode: "test", keyKind: "restricted", apiVersion: STRIPE_API_VERSION });
    expect(describeStripeConfig(c)).toEqual({ enabled: true, mode: "test", keyKind: "restricted", apiVersion: STRIPE_API_VERSION });
    expect(JSON.stringify(describeStripeConfig(c))).not.toContain(c.apiKey);
  });

  it("acepta una clave secreta de pruebas (desarrollo local) y la identifica como tal", () => {
    expect(stripeConfigFromEnv({ ...base(), CP_STRIPE_API_KEY: key("sk", "test") })!.keyKind).toBe("secret");
  });

  it.each([
    ["clave secreta live", { CP_STRIPE_API_KEY: key("sk", "live") }],
    ["clave restringida live", { CP_STRIPE_API_KEY: key("rk", "live") }],
    ["clave publicable", { CP_STRIPE_API_KEY: key("pk", "test") }],
    ["modo live", { CP_STRIPE_MODE: "live" }],
    ["sin clave", { CP_STRIPE_API_KEY: "" }],
    ["sin secreto de webhooks", { CP_STRIPE_WEBHOOK_SECRET: "" }],
    ["secreto mal formado", { CP_STRIPE_WEBHOOK_SECRET: "secreto" }],
    ["versión mal formada", { CP_STRIPE_API_VERSION: "latest" }],
    ["motor antiguo con Stripe", { BILLING_PROVIDER: "stripe" }],
    ["variable de autorización live", { CP_STRIPE_LIVE_AUTHORIZED: "1" }],
  ])("no arranca con %s", (_, over) => {
    expect(() => stripeConfigFromEnv({ ...base(), ...over })).toThrow(StripeConfigError);
  });

  it("credenciales sin CP_STRIPE_MODE: no arranca (evita activarla a medias)", () => {
    expect(() => stripeConfigFromEnv({ CP_STRIPE_API_KEY: key("rk", "test") })).toThrow(/CP_STRIPE_MODE/);
  });

  it("una clave live se rechaza aunque la integración esté apagada", () => {
    expect(() => stripeConfigFromEnv({ CP_STRIPE_API_KEY: key("rk", "live") })).toThrow(/live/);
  });

  it("los mensajes de error no revelan la clave", () => {
    const k = key("sk", "live");
    try {
      stripeConfigFromEnv({ ...base(), CP_STRIPE_API_KEY: k });
      throw new Error("debía fallar");
    } catch (e) {
      expect((e as Error).message).not.toContain(k);
    }
  });

  it("detecta credenciales live", () => {
    expect(looksLive(key("sk", "live"))).toBe(true);
    expect(looksLive(key("rk", "test"))).toBe(false);
  });

  it("solo acepta objetos y eventos de pruebas", () => {
    expect(() => assertTestObject({ livemode: false })).not.toThrow();
    for (const o of [{ livemode: true }, {}, null, { livemode: "false" }]) expect(() => assertTestObject(o as never)).toThrow(StripeConfigError);
  });
});
