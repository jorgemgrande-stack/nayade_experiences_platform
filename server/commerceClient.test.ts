/**
 * Cliente del Core hacia la compra de módulos: sin configuración no existe; solo https en producción; el tenant
 * va en la ruta (el de la sesión) y el cuerpo solo lleva QUÉ se compra; errores del plano de control traducidos;
 * una caída es un 503 sin detalles.
 */
import { describe, it, expect } from "vitest";
import { CommerceError, commerceClientFromEnv } from "./commerceClient";

const env = (over: Record<string, string> = {}) => ({ CP_COMMERCE_URL: "https://cp.example/", CP_COMMERCE_TOKEN: "t".repeat(40), NODE_ENV: "production", ...over }) as NodeJS.ProcessEnv;

describe("cliente de compras del Core", () => {
  it("sin URL o token no hay cliente; http solo en localhost fuera de producción", () => {
    expect(commerceClientFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(commerceClientFromEnv(env({ CP_COMMERCE_TOKEN: "" }))).toBeNull();
    expect(() => commerceClientFromEnv(env({ CP_COMMERCE_URL: "http://cp.example" }))).toThrow(/https/);
    expect(() => commerceClientFromEnv(env({ CP_COMMERCE_URL: "http://127.0.0.1:4000" }))).toThrow(/https/);
    expect(commerceClientFromEnv(env({ CP_COMMERCE_URL: "http://127.0.0.1:4000", NODE_ENV: "development" }))).not.toBeNull();
  });

  it("red privada de Railway: solo http://<servicio>.railway.internal:<puerto>, sin ruta ni otros dominios", async () => {
    const seen: string[] = [];
    const c = commerceClientFromEnv(env({ CP_COMMERCE_URL: "http://controlplane.railway.internal:4100/" }), async (url) => {
      seen.push(url);
      return { status: 200, json: async () => ({ withdrawal: { available: false } }) };
    })!;
    await c.withdrawalStatus("acme-01");
    expect(seen).toEqual(["http://controlplane.railway.internal:4100/cp/v1/commerce/tenants/acme-01/withdrawal"]);
    for (const bad of ["http://controlplane.railway.internal", "http://controlplane.railway.internal.evil.com:4100", "http://evil.com/x.railway.internal:4100", "http://user@controlplane.railway.internal:4100", "http://controlplane.railway.internal:4100/otra"]) {
      expect(() => commerceClientFromEnv(env({ CP_COMMERCE_URL: bad })), bad).toThrow(/https/);
    }
  });

  it("ruta con el tenant de la sesión, token de servicio y solo lo que se compra", async () => {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const c = commerceClientFromEnv(env(), async (url, init) => {
      seen.push({ url, ...init });
      return { status: 201, json: async () => ({ purchase: { status: "applied", orderId: 9 } }) };
    })!;
    expect(await c.purchase("acme-01", { add: ["connect-people"] }, { idempotencyKey: "k".repeat(20), buyer: "user:7" })).toEqual({ status: "applied", orderId: 9 });
    expect(seen[0]).toMatchObject({ url: "https://cp.example/cp/v1/commerce/tenants/acme-01/purchases", method: "POST" });
    expect(seen[0].headers.authorization).toBe(`Bearer ${"t".repeat(40)}`);
    expect(JSON.parse(seen[0].body!)).toEqual({ add: ["connect-people"], idempotencyKey: "k".repeat(20), buyer: "user:7" });
    await c.status("acme-01", 9);
    expect(seen[1]).toMatchObject({ url: "https://cp.example/cp/v1/commerce/tenants/acme-01/purchases/9", method: "GET" });
    expect(seen[1].body).toBeUndefined();
  });

  it("desistimiento: consulta y solicitud con el tenant de la sesión; devuelve el justificante", async () => {
    const seen: Array<{ url: string; method: string; body?: string }> = [];
    const c = commerceClientFromEnv(env(), async (url, init) => {
      seen.push({ url, ...init });
      return init.method === "GET" ? { status: 200, json: async () => ({ withdrawal: { available: true } }) } : { status: 201, json: async () => ({ created: true, receipt: { reference: "DS-20261022-ABCDEF" } }) };
    })!;
    expect(await c.withdrawalStatus("particular-ana")).toEqual({ available: true });
    expect(await c.withdraw("particular-ana", { idempotencyKey: "k".repeat(20), requestedBy: "user:5", contactEmail: "ana@example.com" })).toEqual({ created: true, receipt: { reference: "DS-20261022-ABCDEF" } });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET https://cp.example/cp/v1/commerce/tenants/particular-ana/withdrawal", "POST https://cp.example/cp/v1/commerce/tenants/particular-ana/withdrawal"]);
    expect(JSON.parse(seen[1].body!)).toEqual({ idempotencyKey: "k".repeat(20), requestedBy: "user:5", contactEmail: "ana@example.com" });
  });

  it("contratación desde la prueba: estado, presupuesto y pago con el tenant de la sesión y el usuario que contrata", async () => {
    const seen: Array<{ url: string; method: string; body?: string }> = [];
    const c = commerceClientFromEnv(env(), async (url, init) => {
      seen.push({ url, ...init });
      if (url.endsWith("/conversion/status")) return { status: 200, json: async () => ({ enabled: false, reasons: ["terms_unpublished"] }) };
      if (url.endsWith("/preview")) return { status: 200, json: async () => ({ preview: { plan: "essential" } }) };
      return { status: 200, json: async () => ({ sessionId: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1", expiresAt: 1 }) };
    })!;
    expect(await c.conversionStatus()).toEqual({ enabled: false, reasons: ["terms_unpublished"] });
    expect(await c.conversionPreview("t7-acme", { plan: "essential", interval: "month" })).toEqual({ plan: "essential" });
    const r = await c.conversionStart("t7-acme", { plan: "essential", interval: "year", add: ["crm"], idempotencyKey: "u", buyer: { type: "business" }, consents: { terms: true }, user: "user:3" });
    expect(r.url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(seen.map((x) => `${x.method} ${x.url}`)).toEqual([
      "GET https://cp.example/cp/v1/commerce/conversion/status",
      "POST https://cp.example/cp/v1/commerce/tenants/t7-acme/conversion/preview",
      "POST https://cp.example/cp/v1/commerce/tenants/t7-acme/conversion",
    ]);
    expect(JSON.parse(seen[2].body!)).toMatchObject({ plan: "essential", interval: "year", add: ["crm"], user: "user:3" });
  });

  it("errores del plano de control con su código; una caída es 503 sin detalles", async () => {
    const c = commerceClientFromEnv(env(), async () => ({ status: 409, json: async () => ({ error: "async_payment_method", message: "Tu método de pago no permite comprar en línea" }) }))!;
    await expect(c.preview("acme-01", { users: 5 })).rejects.toMatchObject({ status: 409, code: "async_payment_method" });
    const down = commerceClientFromEnv(env(), async () => {
      throw new Error("ECONNREFUSED 10.0.0.1");
    })!;
    const e = await down.preview("acme-01", {}).catch((x) => x);
    expect(e).toBeInstanceOf(CommerceError);
    expect(e).toMatchObject({ status: 503, code: "unreachable" });
    expect(e.message).not.toMatch(/10\.0\.0\.1/);
  });
});
