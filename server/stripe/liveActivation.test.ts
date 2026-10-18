import { describe, expect, it } from "vitest";
import { LIVE_PRICE_IDS, LIVE_WEBHOOK_EVENTS, canActivate, checkLiveStripe, checkLiveVariables, type FetchLike } from "./liveActivation";

const KEY = "rk_live_" + "A1b2C3d4E5f6G7h8I9j0K1l2";
const SECRET = "whsec_" + "Z9y8X7w6V5u4T3s2R1q0";
const URL_WEBHOOK = "https://elephant-source-crm-live.up.railway.app/cp/v1/stripe/webhook";

const base = (over: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  CP_STRIPE_NAMESPACE: "live",
  CP_STRIPE_SUCCESS_URL: "https://elephant-source-web-live.up.railway.app/contratacion/estado",
  CP_STRIPE_CANCEL_URL: "https://elephant-source-web-live.up.railway.app/contratacion/cancelada",
  CP_STRIPE_PORTAL_RETURN_URL: "https://elephant-source-web-live.up.railway.app/contratacion/estado",
  CP_STRIPE_API_KEY: KEY,
  CP_STRIPE_WEBHOOK_SECRET: SECRET,
  ...over,
});
const byId = (checks: ReturnType<typeof checkLiveVariables>) => Object.fromEntries(checks.map((c) => [c.id, c]));
const noSecrets = (s: string) => {
  expect(s).not.toContain(KEY);
  expect(s).not.toContain(SECRET);
  expect(s).not.toContain("A1b2C3d4");
};

describe("activación de Stripe live: variables", () => {
  it("con la clave, el secreto y el resto preparado se puede activar; la política fiscal solo informa", () => {
    const checks = checkLiveVariables(base());
    expect(canActivate(checks)).toBe(true);
    const c = byId(checks);
    expect(c.configuracion.ok).toBe(true);
    expect(c.configuracion.detail).toContain('"mode":"live"');
    expect(c.politica_fiscal).toMatchObject({ ok: false, blocking: false });
    expect(c.politica_fiscal.detail).toContain("tax_policy_pending");
    noSecrets(JSON.stringify(checks));
  });

  it("sin clave ni secreto (estado de hoy) no se puede activar y dice qué falta", () => {
    const checks = checkLiveVariables(base({ CP_STRIPE_API_KEY: undefined, CP_STRIPE_WEBHOOK_SECRET: undefined }));
    expect(canActivate(checks)).toBe(false);
    const c = byId(checks);
    expect(c.clave.ok).toBe(false);
    expect(c.secreto_webhook.ok).toBe(false);
    expect(c.modo.ok).toBe(true);
  });

  it("rechaza claves de pruebas, claves secretas, NODE_ENV distinto y prefijo distinto sin mostrar el valor", () => {
    for (const over of [
      { CP_STRIPE_API_KEY: "rk_test_" + "A1b2C3d4E5f6G7h8I9j0K1l2" },
      { CP_STRIPE_API_KEY: "sk_live_" + "A1b2C3d4E5f6G7h8I9j0K1l2" },
      { NODE_ENV: "development" },
      { CP_STRIPE_NAMESPACE: "beta" },
      { CP_STRIPE_WEBHOOK_SECRET: "no-es-un-whsec" },
    ]) {
      const checks = checkLiveVariables(base(over));
      expect(canActivate(checks), JSON.stringify(Object.keys(over))).toBe(false);
      expect(byId(checks).configuracion.ok).toBe(false);
      noSecrets(JSON.stringify(checks));
    }
  });

  it("activar Stripe no abre la venta: cualquier interruptor de apertura encendido bloquea", () => {
    for (const k of ["CP_STRIPE_CHECKOUT_ENABLED", "CP_PUBLIC_CHECKOUT_ENABLED", "CP_PUBLIC_SELF_SERVICE_ENABLED"]) {
      const checks = checkLiveVariables(base({ [k]: "1" }));
      expect(canActivate(checks)).toBe(false);
      expect(byId(checks)[`cerrado_${k}`].ok).toBe(false);
    }
  });

  it("los pagos simulados, un modo distinto de live o URL sin https bloquean", () => {
    // Sin NODE_ENV en Railway vale el de la imagen (production); otro valor explícito bloquea
    expect(canActivate(checkLiveVariables(base({ NODE_ENV: undefined })))).toBe(true);
    expect(canActivate(checkLiveVariables(base({ CP_PAYMENTS_PROVIDER: "test" })))).toBe(false);
    expect(canActivate(checkLiveVariables(base({ CP_STRIPE_MODE: "test" })))).toBe(false);
    expect(byId(checkLiveVariables(base({ CP_STRIPE_MODE: "live" }))).modo.ok).toBe(true);
    expect(canActivate(checkLiveVariables(base({ CP_STRIPE_SUCCESS_URL: "http://x.example/estado" })))).toBe(false);
    expect(canActivate(checkLiveVariables(base({ CP_STRIPE_SUCCESS_URL: undefined, CP_STRIPE_CANCEL_URL: undefined, CP_STRIPE_PORTAL_RETURN_URL: undefined })))).toBe(false);
  });
});

type Resp = { status: number; body: unknown };
const fakeFetch = (routes: (url: string) => Resp) => {
  const seen: Array<{ url: string; auth: string }> = [];
  const f: FetchLike = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    const r = routes(url);
    return { status: r.status, json: async () => r.body };
  };
  return { f, seen };
};
const price = { livemode: true, active: true };
const endpoint = (over: Record<string, unknown> = {}) => ({ url: URL_WEBHOOK, status: "enabled", enabled_events: [...LIVE_WEBHOOK_EVENTS], api_version: "2026-09-30.endive", livemode: true, ...over });

describe("activación de Stripe live: lecturas en la cuenta real", () => {
  it("los cuatro precios live y activos y un único destino activo con los 18 eventos", async () => {
    const { f, seen } = fakeFetch((u) => (u.includes("/v1/prices/") ? { status: 200, body: price } : { status: 200, body: { data: [endpoint()] } }));
    const checks = await checkLiveStripe(KEY, URL_WEBHOOK, f);
    expect(canActivate(checks)).toBe(true);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(seen.filter((s) => s.url.includes("/v1/prices/")).map((s) => s.url.split("/").pop())).toEqual([...LIVE_PRICE_IDS]);
    expect(seen.every((s) => s.url.startsWith("https://api.stripe.com/") && s.auth === `Bearer ${KEY}`)).toBe(true);
    noSecrets(JSON.stringify(checks));
  });

  it("un precio de pruebas o inactivo bloquea; el mensaje de error de Stripe nunca se muestra", async () => {
    const { f } = fakeFetch((u) =>
      u.endsWith(LIVE_PRICE_IDS[0])
        ? { status: 200, body: { livemode: false, active: true } }
        : u.endsWith(LIVE_PRICE_IDS[1])
          ? { status: 401, body: { error: { type: "invalid_request_error", message: `Invalid API Key provided: ${KEY}` } } }
          : u.includes("/v1/prices/")
            ? { status: 200, body: price }
            : { status: 200, body: { data: [endpoint()] } },
    );
    const checks = await checkLiveStripe(KEY, URL_WEBHOOK, f);
    expect(canActivate(checks)).toBe(false);
    expect(checks.filter((c) => !c.ok).map((c) => c.id)).toEqual([`precio_${LIVE_PRICE_IDS[0]}`, `precio_${LIVE_PRICE_IDS[1]}`]);
    expect(JSON.stringify(checks)).toContain("401 invalid_request_error");
    noSecrets(JSON.stringify(checks));
  });

  it("destino ausente, duplicado, desactivado o con otros eventos bloquea", async () => {
    const run = (data: unknown[]) => checkLiveStripe(KEY, URL_WEBHOOK, fakeFetch((u) => (u.includes("/v1/prices/") ? { status: 200, body: price } : { status: 200, body: { data } })).f);
    expect(canActivate(await run([]))).toBe(false);
    expect(canActivate(await run([endpoint({ url: "https://otro.example/cp/v1/stripe/webhook" })]))).toBe(false);
    expect(canActivate(await run([endpoint(), endpoint()]))).toBe(false);
    expect(canActivate(await run([endpoint({ status: "disabled" })]))).toBe(false);
    const fewer = await run([endpoint({ enabled_events: LIVE_WEBHOOK_EVENTS.slice(1) })]);
    expect(canActivate(fewer)).toBe(false);
    expect(fewer.find((c) => c.id === "webhook_eventos")?.detail).toContain("checkout.session.completed");
    expect(canActivate(await run([endpoint({ enabled_events: [...LIVE_WEBHOOK_EVENTS, "customer.created"] })]))).toBe(false);
    // Otra versión de la API solo se informa
    expect(canActivate(await run([endpoint({ api_version: "2025-01-01.acacia" })]))).toBe(true);
  });

  it("si la clave restringida no puede leer los destinos del webhook, se informa sin bloquear", async () => {
    const { f } = fakeFetch((u) => (u.includes("/v1/prices/") ? { status: 200, body: price } : { status: 403, body: { error: { type: "invalid_request_error" } } }));
    const checks = await checkLiveStripe(KEY, URL_WEBHOOK, f);
    expect(canActivate(checks)).toBe(true);
    expect(checks.find((c) => c.id === "webhook")).toMatchObject({ ok: false, blocking: false });
  });
});
