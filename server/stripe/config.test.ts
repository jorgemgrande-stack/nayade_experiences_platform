import { describe, it, expect } from "vitest";
import { STRIPE_API_VERSION, StripeConfigError, assertModeObject, assertTestObject, checkoutBlockedReason, describeStripeConfig, liveStartupProblem, livemodeMatches, looksLive, stripeConfigFromEnv } from "./config";

// Valores ficticios construidos en tiempo de ejecución (no son credenciales y no deben parecerlo en el código)
const key = (kind: string, mode: string) => [kind, mode, "x".repeat(24)].join("_");
const whsec = () => ["whsec", "y".repeat(32)].join("_");
const base = () => ({ CP_STRIPE_MODE: "test", CP_STRIPE_API_KEY: key("rk", "test"), CP_STRIPE_WEBHOOK_SECRET: whsec() });

describe("configuración de Stripe Billing (solo pruebas)", () => {
  it("apagada sin CP_STRIPE_MODE ni credenciales", () => {
    expect(stripeConfigFromEnv({})).toBeNull();
    expect(describeStripeConfig(null)).toEqual({ enabled: false });
  });

  it("B9: prefijo del entorno explícito, derivado de Railway o «local»; en producción sin él no arranca", () => {
    expect(stripeConfigFromEnv({ ...base(), CP_STRIPE_NAMESPACE: "beta01" })!.namespace).toBe("beta01");
    const r1 = stripeConfigFromEnv({ ...base(), RAILWAY_PROJECT_ID: "p1", RAILWAY_ENVIRONMENT_ID: "e1" })!.namespace;
    const r2 = stripeConfigFromEnv({ ...base(), RAILWAY_PROJECT_ID: "p1", RAILWAY_ENVIRONMENT_ID: "e2" })!.namespace;
    expect(r1).toMatch(/^r[0-9a-f]{10}$/);
    expect(r1).not.toBe(r2);
    expect(() => stripeConfigFromEnv({ ...base(), CP_STRIPE_NAMESPACE: "Con-Guion" })).toThrow(StripeConfigError);
    expect(() => stripeConfigFromEnv({ ...base(), NODE_ENV: "production" })).toThrow(/CP_STRIPE_NAMESPACE/);
    expect(() => stripeConfigFromEnv({ ...base(), CP_STRIPE_EVENTS_RETENTION_DAYS: "10" })).toThrow(/35/);
    expect(stripeConfigFromEnv({ ...base(), CP_STRIPE_EVENTS_RETENTION_DAYS: "400" })!.eventsRetentionDays).toBe(400);
  });

  it("clave restringida de pruebas con la versión fijada por defecto", () => {
    const c = stripeConfigFromEnv(base())!;
    expect(c).toMatchObject({ mode: "test", keyKind: "restricted", apiVersion: STRIPE_API_VERSION });
    expect(describeStripeConfig(c)).toEqual({ enabled: true, mode: "test", keyKind: "restricted", apiVersion: STRIPE_API_VERSION, namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" });
    expect(JSON.stringify(describeStripeConfig(c))).not.toContain(c.apiKey);
  });

  it("modo de facturación multipartida: classic por defecto, flexible solo explícito, otro valor no arranca", () => {
    expect(stripeConfigFromEnv(base())!.billingMode).toBe("classic");
    expect(stripeConfigFromEnv({ ...base(), CP_STRIPE_BILLING_MODE: "flexible" })!.billingMode).toBe("flexible");
    expect(() => stripeConfigFromEnv({ ...base(), CP_STRIPE_BILLING_MODE: "auto" })).toThrow(StripeConfigError);
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
    ["clave administrativa en un servicio", { CP_STRIPE_ADMIN_KEY: key("rk", "test") }],
    ["clave secreta (no restringida) en producción", { CP_STRIPE_API_KEY: key("sk", "test"), NODE_ENV: "production" }],
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

  it("un CP_STRIPE_MODE no soportado no se repite en el mensaje (podría ser una credencial pegada por error)", () => {
    const k = key("rk", "live");
    for (const v of [k, "produccion", "LIVE-1"]) {
      try {
        stripeConfigFromEnv({ ...base(), CP_STRIPE_MODE: v });
        throw new Error("debía fallar");
      } catch (e) {
        expect(e).toBeInstanceOf(StripeConfigError);
        expect((e as Error).message).toBe("CP_STRIPE_MODE no está soportado: solo «test» o «live»");
        expect((e as Error).message.toLowerCase()).not.toContain(v.toLowerCase().slice(0, 8));
      }
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

  it("comprobación según el modo: cada modo solo acepta sus objetos", () => {
    expect(() => assertModeObject({ livemode: false }, "test")).not.toThrow();
    expect(() => assertModeObject({ livemode: true }, "live")).not.toThrow();
    for (const o of [{ livemode: false }, {}, null, { livemode: "true" }, { livemode: 1 }]) expect(() => assertModeObject(o as never, "live")).toThrow(StripeConfigError);
    for (const o of [{ livemode: true }, {}, null, { livemode: 0 }]) expect(() => assertModeObject(o as never, "test")).toThrow(StripeConfigError);
    expect([livemodeMatches(true, "live"), livemodeMatches(false, "live"), livemodeMatches(false, "test"), livemodeMatches(undefined, "test")]).toEqual([true, false, true, false]);
  });

  it("en pruebas CP_STRIPE_TAX_POLICY se ignora y Checkout nunca está bloqueado por ella", () => {
    const c = stripeConfigFromEnv({ ...base(), CP_STRIPE_TAX_POLICY: "cualquier_cosa" })!;
    expect(c.taxPolicy).toBe("test_net_no_tax");
    expect(checkoutBlockedReason(c)).toBeNull();
    expect(liveStartupProblem(c, {})).toBeNull();
  });
});

describe("configuración de Stripe Billing en modo live", () => {
  const live = () => ({ CP_STRIPE_MODE: "live", CP_STRIPE_API_KEY: key("rk", "live"), CP_STRIPE_WEBHOOK_SECRET: whsec(), CP_STRIPE_NAMESPACE: "live" });

  it("clave restringida live, espacio de nombres «live» y política fiscal pendiente por defecto", () => {
    const c = stripeConfigFromEnv(live())!;
    expect(c).toMatchObject({ mode: "live", keyKind: "restricted", namespace: "live", taxPolicy: null, apiVersion: STRIPE_API_VERSION });
    expect(checkoutBlockedReason(c)).toBe("tax_policy_pending");
    expect(describeStripeConfig(c)).toEqual({ enabled: true, mode: "live", keyKind: "restricted", apiVersion: STRIPE_API_VERSION, namespace: "live", eventsRetentionDays: 180, taxPolicy: "pending", billingMode: "classic" });
    const text = JSON.stringify(describeStripeConfig(c));
    expect(text).not.toContain(c.apiKey);
    expect(text).not.toContain(c.webhookSecret);
  });

  it("con CP_STRIPE_TAX_POLICY=stripe_tax_exclusive Checkout deja de estar bloqueado", () => {
    const c = stripeConfigFromEnv({ ...live(), CP_STRIPE_TAX_POLICY: "stripe_tax_exclusive" })!;
    expect(c.taxPolicy).toBe("stripe_tax_exclusive");
    expect(checkoutBlockedReason(c)).toBeNull();
    expect(describeStripeConfig(c).taxPolicy).toBe("stripe_tax_exclusive");
  });

  it("el arranque live exige NODE_ENV=production", () => {
    const c = stripeConfigFromEnv(live())!;
    expect(liveStartupProblem(c, {})).toMatch(/NODE_ENV=production/);
    expect(liveStartupProblem(c, { NODE_ENV: "development" })).toMatch(/NODE_ENV=production/);
    expect(liveStartupProblem(c, { NODE_ENV: "production" })).toBeNull();
    expect(liveStartupProblem(null, {})).toBeNull();
  });

  it.each([
    ["clave secreta live (sk_live_)", { CP_STRIPE_API_KEY: key("sk", "live") }, /RESTRINGIDA/],
    ["clave restringida de pruebas", { CP_STRIPE_API_KEY: key("rk", "test") }, /pruebas/],
    ["clave secreta de pruebas", { CP_STRIPE_API_KEY: key("sk", "test") }, /pruebas/],
    ["clave publicable live", { CP_STRIPE_API_KEY: key("pk", "live") }, /rk_live_/],
    ["sin clave", { CP_STRIPE_API_KEY: "" }, /rk_live_/],
    ["sin secreto de webhooks", { CP_STRIPE_WEBHOOK_SECRET: "" }, /whsec_/],
    ["secreto mal formado", { CP_STRIPE_WEBHOOK_SECRET: "secreto_live" }, /whsec_/],
    ["sin espacio de nombres", { CP_STRIPE_NAMESPACE: undefined }, /CP_STRIPE_NAMESPACE=live/],
    ["espacio de nombres distinto de «live»", { CP_STRIPE_NAMESPACE: "prod01" }, /CP_STRIPE_NAMESPACE=live/],
    ["espacio de nombres derivado de Railway", { CP_STRIPE_NAMESPACE: undefined, RAILWAY_PROJECT_ID: "p1", RAILWAY_ENVIRONMENT_ID: "e1" }, /CP_STRIPE_NAMESPACE=live/],
    ["política fiscal desconocida", { CP_STRIPE_TAX_POLICY: "sin_iva" }, /CP_STRIPE_TAX_POLICY/],
    ["política fiscal de pruebas", { CP_STRIPE_TAX_POLICY: "test_net_no_tax" }, /CP_STRIPE_TAX_POLICY/],
    ["variable de autorización live", { CP_STRIPE_LIVE_KEY: key("rk", "live") }, /CP_STRIPE_LIVE_KEY/],
    ["clave administrativa", { CP_STRIPE_ADMIN_KEY: key("rk", "live") }, /CP_STRIPE_ADMIN_KEY/],
    ["motor antiguo con Stripe", { BILLING_PROVIDER: "stripe" }, /motor antiguo/],
  ])("no arranca con %s", (_, over, msg) => {
    const env: Record<string, string | undefined> = { ...live(), ...over };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    expect(() => stripeConfigFromEnv(env as NodeJS.ProcessEnv)).toThrow(StripeConfigError);
    expect(() => stripeConfigFromEnv(env as NodeJS.ProcessEnv)).toThrow(msg);
  });

  it("en pruebas, una clave live o el espacio de nombres «live» siguen prohibidos", () => {
    expect(() => stripeConfigFromEnv({ ...base(), CP_STRIPE_API_KEY: key("rk", "live") })).toThrow(/prohibida en modo pruebas/);
    expect(() => stripeConfigFromEnv({ ...base(), CP_STRIPE_NAMESPACE: "live" })).toThrow(/reservado al modo live/);
  });

  it("los mensajes de error de live no revelan la clave", () => {
    for (const k of [key("sk", "live"), key("rk", "test")]) {
      try {
        stripeConfigFromEnv({ ...live(), CP_STRIPE_API_KEY: k });
        throw new Error("debía fallar");
      } catch (e) {
        expect((e as Error).message).not.toContain(k);
      }
    }
  });
});
