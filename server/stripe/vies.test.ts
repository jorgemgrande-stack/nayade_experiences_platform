/**
 * VIES: cliente de la API REST (respuestas simuladas y errores de conexión) y verificación con registro,
 * reutilización y caducidad. La inversión del sujeto pasivo nunca se aplica sin una comprobación válida.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStripeStore } from "./store";
import { VatVerifier, viesClient, viesMaxAgeDaysFromEnv, type ViesPort } from "./vies";

type Call = { url: string; body: Record<string, unknown> };
const fakeFetch = (respond: (body: Record<string, unknown>) => Response | Promise<Response>, calls: Call[] = []) =>
  (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    return respond(body);
  }) as unknown as typeof fetch;
const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });

describe("cliente de VIES (API REST)", () => {
  it("válido: devuelve el número de consulta, nombre y dirección; envía el prefijo EL de Grecia y el emisor como solicitante", async () => {
    const calls: Call[] = [];
    const vies = viesClient({ fetch: fakeFetch(() => json(200, { countryCode: "EL", vatNumber: "123456789", valid: true, requestIdentifier: "WAPIAAAAZx1", name: "ACME AE", address: "ODOS 1\nATHINA", userError: "VALID" }), calls) });
    const r = await vies.check("GR", "123456789");
    expect(r).toMatchObject({ status: "valid", country: "GR", vatNumber: "123456789", consultationNumber: "WAPIAAAAZx1", traderName: "ACME AE", traderAddress: "ODOS 1 ATHINA", detail: null });
    expect(calls[0].body).toEqual({ countryCode: "EL", vatNumber: "123456789", requesterMemberStateCode: "ES", requesterNumber: "B26987875" });
  });

  it("válido sin datos publicados («---»): nombre y dirección null", async () => {
    const r = await viesClient({ fetch: fakeFetch(() => json(200, { valid: true, requestIdentifier: "X1", name: "---", address: "---" })) }).check("DE", "123456789");
    expect(r).toMatchObject({ status: "valid", traderName: null, traderAddress: null });
  });

  it.each([
    ["no válido", { valid: false, userError: "INVALID" }, "invalid", "INVALID"],
    ["entrada no válida", { valid: false, userError: "INVALID_INPUT" }, "invalid", "INVALID_INPUT"],
    ["Estado miembro no disponible", { valid: false, userError: "MS_UNAVAILABLE" }, "unavailable", "MS_UNAVAILABLE"],
    ["demasiadas peticiones", { valid: false, userError: "MS_MAX_CONCURRENT_REQ" }, "unavailable", "MS_MAX_CONCURRENT_REQ"],
    ["error envuelto", { actionSucceed: false, errorWrappers: [{ error: "SERVICE_UNAVAILABLE" }] }, "unavailable", "SERVICE_UNAVAILABLE"],
    ["respuesta inesperada", { foo: 1 }, "unavailable", "unexpected_response"],
  ])("%s → %s", async (_n, body, status, detail) => {
    const r = await viesClient({ fetch: fakeFetch(() => json(200, body)) }).check("FR", "12345678901");
    expect(r).toMatchObject({ status, detail, consultationNumber: null });
  });

  it("errores de conexión: HTTP 500, red caída y tiempo agotado → no disponible (nunca válido)", async () => {
    expect(await viesClient({ fetch: fakeFetch(() => new Response("x", { status: 500 })) }).check("FR", "1")).toMatchObject({ status: "unavailable", detail: "http_500" });
    expect(await viesClient({ fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch }).check("FR", "1")).toMatchObject({ status: "unavailable", detail: "network" });
    const slow = (async (_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as unknown as typeof fetch;
    expect(await viesClient({ fetch: slow, timeoutMs: 20 }).check("FR", "1")).toMatchObject({ status: "unavailable", detail: "TIMEOUT" });
  });

  it("días de validez de una comprobación: 30 por defecto; fuera de 1-365 impide arrancar", () => {
    expect(viesMaxAgeDaysFromEnv({})).toBe(30);
    expect(viesMaxAgeDaysFromEnv({ CP_VIES_MAX_AGE_DAYS: "7" })).toBe(7);
    for (const v of ["0", "400", "x", "1.5"]) expect(() => viesMaxAgeDaysFromEnv({ CP_VIES_MAX_AGE_DAYS: v })).toThrow();
  });
});

describe("verificación con registro y caducidad", () => {
  let clock: number;
  let store: MemoryStripeStore;
  let answers: Array<"valid" | "invalid" | "unavailable">;
  let calls: number;
  const vies: ViesPort = {
    check: async (country, vatNumber) => {
      calls++;
      const status = answers.shift() ?? "valid";
      return { status, country, vatNumber, consultationNumber: status === "valid" ? `C${calls}` : null, traderName: null, traderAddress: null, detail: status === "valid" ? null : status.toUpperCase() };
    },
  };
  const verifier = () => new VatVerifier({ vies, store, now: () => clock, maxAgeDays: 30 });
  beforeEach(() => {
    clock = Date.UTC(2026, 9, 20, 10);
    store = new MemoryStripeStore("live");
    answers = [];
    calls = 0;
  });

  it("forma no válida, país fuera de la UE o NIF español: «no válido» sin consultar VIES", async () => {
    expect(await verifier().verify("FR", "DE123456789")).toMatchObject({ status: "invalid", detail: "format" });
    expect(await verifier().verify("GB", "GB123456789")).toMatchObject({ status: "invalid", detail: "format" });
    expect(await verifier().verify("ES", "B26987875")).toMatchObject({ status: "invalid", detail: "format" });
    expect(calls).toBe(0);
    expect(store.vatChecks).toEqual([]);
  });

  it("válido: se registra con su número de consulta y se REUTILIZA mientras no caduca; caducado, se repite", async () => {
    const v = verifier();
    const a = await v.verify("FR", "FR 12345678901", { orderId: 7 });
    expect(a).toMatchObject({ status: "valid", country: "FR", vatNumber: "12345678901", consultationNumber: "C1", orderId: 7, reused: false });
    clock += 29 * 86_400_000;
    expect(await v.verify("FR", "12345678901")).toMatchObject({ status: "valid", consultationNumber: "C1", reused: true });
    expect(calls).toBe(1);
    clock += 2 * 86_400_000;
    expect(await v.verify("FR", "12345678901", { orderId: 7 })).toMatchObject({ status: "valid", consultationNumber: "C2", reused: false });
    expect(calls).toBe(2);
    expect((await store.vatChecksOfOrder(7)).map((c) => c.consultationNumber)).toEqual(["C2", "C1"]);
  });

  it("no válido e indisponible también se registran (evidencia); una indisponibilidad no reutiliza nada ni da por válido", async () => {
    answers = ["unavailable", "invalid"];
    const v = verifier();
    expect(await v.verify("DE", "123456789", { orderId: 9 })).toMatchObject({ status: "unavailable", detail: "UNAVAILABLE" });
    expect(await v.verify("DE", "123456789", { orderId: 9 })).toMatchObject({ status: "invalid" });
    expect(store.vatChecks.map((c) => c.status)).toEqual(["unavailable", "invalid"]);
    expect(await store.lastValidVatCheck("DE", "123456789")).toBeNull();
  });

  it("revalidación forzada: ignora la comprobación reciente y vuelve a consultar", async () => {
    const v = verifier();
    await v.verify("IT", "12345678901");
    answers = ["invalid"];
    expect(await v.verify("IT", "12345678901", { force: true })).toMatchObject({ status: "invalid", reused: false });
    expect(calls).toBe(2);
  });

  it("sin la tabla de registro (0021): no se consulta y se trata como no disponible (sin evidencia no hay inversión)", async () => {
    store.hasVatCheckTable = async () => false;
    expect(await verifier().verify("FR", "12345678901")).toMatchObject({ status: "unavailable", detail: "storage_missing" });
    expect(calls).toBe(0);
  });
});
