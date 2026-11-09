/**
 * Elephant Voice · puesta en marcha del asistente de Vapi con la aplicación REAL sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (sin migración nueva:
 * el estado va en la bóveda existente). Licencia voice-ai (sin ella 403; en solo lectura, solo consultas), solo
 * administración, periodo de prueba sin Vapi, clave validada y cifrada en la bóveda de la empresa, asistente y número
 * elegidos, webhook configurado con el dominio de ESA empresa y una clave de 24+ caracteres, llamada de prueba por el
 * webhook real y aislamiento: la clave de una empresa no abre el webhook de la otra ni la otra ve nada.
 * Vapi SIMULADO detrás de `fetch`: ninguna llamada sale a Internet.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "voice-ai";
const run = crypto.randomBytes(3).toString("hex");
// Claves de prueba sin formato real
const KEY_A = ["prueba", "vapi", "a", run, "0000-0000"].join("-");
const KEY_B = ["prueba", "vapi", "b", run, "1111-1111"].join("-");
const AS = "a5a5a5a5-0000-4000-8000-00000000000a";
const PH = "b6b6b6b6-0000-4000-8000-00000000000b";

describe.skipIf(!URL_)("Voice · asistente de alta de Vapi (aplicación real, dos empresas, Vapi simulado)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const realFetch = globalThis.fetch;
  /** Cuenta de Vapi simulada por clave (cada empresa con la suya). */
  const accounts = new Map<string, { assistants: Map<string, any>; phones: Map<string, any> }>();
  const vapiCalls: Array<{ method: string; path: string; key: string }> = [];

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `voiceSetup.${proc}`, input, cookie);
  const q = (proc: string, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `voiceSetup.${proc}`, undefined, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "voicesetup", { vapiWebhook: true });
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    for (const k of [KEY_A, KEY_B]) {
      accounts.set(k, {
        assistants: new Map([[AS, { id: AS, name: k === KEY_A ? "Recepción A" : "Recepción B" }]]),
        phones: new Map([[PH, { id: PH, number: k === KEY_A ? "+34910000001" : "+34910000002", provider: "vapi", assistantId: null }]]),
      });
    }
    const appFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.vapi.ai/")) return appFetch(input as never, init);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const key = String(headers.Authorization ?? "").replace(/^Bearer /, "");
      const u = new URL(url);
      vapiCalls.push({ method: init?.method ?? "GET", path: u.pathname, key });
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const acc = accounts.get(key);
      if (!acc) return reply(401, { message: "Invalid Key" });
      const [, kind, id] = u.pathname.split("/");
      const coll = kind === "assistant" ? acc.assistants : kind === "phone-number" ? acc.phones : null;
      if (!coll) return reply(404, {});
      if (!id) return reply(200, Array.from(coll.values()));
      const item = coll.get(id);
      if (!item) return reply(404, {});
      if ((init?.method ?? "GET") === "PATCH") Object.assign(item, JSON.parse(String(init!.body)));
      return reply(200, item);
    }) as typeof fetch;
  }, 600_000);
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await ess?.close();
  });

  it("sin la capacidad voice-ai no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("status"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveKey", { apiKey: KEY_A }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración", async () => {
    expect(errCode(await q("status", agA))).toBe("FORBIDDEN");
    expect(errCode(await m("saveKey", { apiKey: KEY_A }, agA))).toBe("FORBIDDEN");
  });

  it("empresa nueva: cinco pasos pendientes; en la prueba gratuita no se llama a Vapi", async () => {
    const s = await ok(q("status"));
    expect(s).toMatchObject({ multi: true, completed: 0, total: 5, ready: false, keyMasked: null });
    expect(s.webhookUrl).toBe(`https://${ess.host("a")}/api/vapi/webhook`);
    const r = await m("saveKey", { apiKey: KEY_A });
    expect(r.status).toBe(403);
    expect(vapiCalls).toHaveLength(0);
    await ess.markPaid("a");
    await ess.markPaid("b");
  });

  it("clave rechazada no se guarda; aceptada, cifrada en la bóveda de ESA empresa y solo su máscara", async () => {
    expect(errCode(await m("saveKey", { apiKey: "clave-publica-que-no-sirve-0000" }))).toBe("BAD_REQUEST");
    expect(await ess.sql("a", "SELECT field FROM integration_credentials WHERE provider = 'vapi'")).toHaveLength(0);
    await ok(m("saveKey", { apiKey: KEY_A }));
    const rows = await ess.sql("a", "SELECT field, is_secret, value FROM integration_credentials WHERE provider = 'vapi'");
    expect(rows.map((r) => [r.field, r.is_secret])).toEqual([["apiKey", 1]]);
    expect(String(rows[0].value)).not.toContain(KEY_A);
    expect(await ess.sql("b", "SELECT field FROM integration_credentials WHERE provider = 'vapi'")).toHaveLength(0);
    const s = await ok(q("status"));
    expect(s.keyMasked).toBe(`••••${KEY_A.slice(-4)}`);
    expect(s.steps[0].status).toBe("done");
    const raw = (await q("status")).text;
    expect(raw).not.toContain(KEY_A);
  });

  it("lista asistentes y números de SU cuenta y conecta: webhook del dominio de la empresa con clave de 24+", async () => {
    const res = await ok(q("resources"));
    expect(res.assistants).toEqual([{ id: AS, name: "Recepción A", serverTarget: "none", otherHost: null }]);
    expect(res.phoneNumbers[0]).toMatchObject({ id: PH, number: "+34910000001" });
    expect(vapiCalls.filter((c) => c.method !== "GET")).toHaveLength(0);
    const r = await ok(m("connect", { assistantId: AS, phoneNumberId: PH }));
    expect(r).toMatchObject({ assistantName: "Recepción A", secretGenerated: "missing", webhookUrl: `https://${ess.host("a")}/api/vapi/webhook` });
    const assistant = accounts.get(KEY_A)!.assistants.get(AS);
    expect(assistant.server.url).toBe(`https://${ess.host("a")}/api/vapi/webhook`);
    expect(assistant.server.secret.length).toBeGreaterThanOrEqual(24);
    expect(assistant.serverMessages).toEqual(["end-of-call-report"]);
    expect(accounts.get(KEY_A)!.phones.get(PH).assistantId).toBe(AS);
    // La cuenta de Vapi de B no se ha tocado
    expect(accounts.get(KEY_B)!.assistants.get(AS).server).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain(assistant.server.secret);
    const s = await ok(q("status"));
    expect(s.steps.map((x: any) => x.status)).toEqual(["done", "done", "done", "done", "todo"]);
    expect((await q("status")).text).not.toContain(assistant.server.secret);
    expect(await ok(q("verify"))).toEqual({ ok: true, problems: [] });
  });

  it("llamada de prueba por el webhook real: entra en A; la clave de A no abre el webhook de B", async () => {
    const secret = accounts.get(KEY_A)!.assistants.get(AS).server.secret as string;
    const report = { message: { type: "end-of-call-report", call: { id: `call-${run}`, assistantId: AS, customer: { number: "+34600000000" } }, durationSeconds: 42, endedReason: "customer-ended-call" } };
    // A la otra empresa, con la clave de A: rechazado (B no tiene clave: su webhook está inactivo)
    expect((await ess.call("b", "POST", "/api/vapi/webhook", { body: report, headers: { "x-vapi-secret": secret } })).status).toBe(401);
    // Sin clave o con otra: rechazado
    expect((await ess.call("a", "POST", "/api/vapi/webhook", { body: report, headers: { "x-vapi-secret": "x".repeat(32) } })).status).toBe(401);
    expect((await ess.call("a", "POST", "/api/vapi/webhook", { body: report })).status).toBe(401);
    const okr = await ess.call("a", "POST", "/api/vapi/webhook", { body: report, headers: { "x-vapi-secret": secret } });
    expect(okr.status).toBe(200);
    expect(await ess.sql("a", "SELECT vapiCallId FROM vapi_calls")).toEqual([{ vapiCallId: `call-${run}` }]);
    expect(await ess.sql("b", "SELECT vapiCallId FROM vapi_calls")).toEqual([]);
    const s = await ok(q("status"));
    expect(s.ready).toBe(true);
    expect(s.lastEventAt).toBeTruthy();
    expect(s.lastCall).toMatchObject({ durationSeconds: 42 });
    // B no ve nada de A
    const sb = await ok(q("status", adB, "b"));
    expect(sb).toMatchObject({ completed: 0, keyMasked: null, lastEventAt: null, lastCall: null });
  });

  it("en solo lectura se ve el estado pero no se cambia nada", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await q("status")).status).toBe(200);
    expect(isLicenseDenied(await m("disconnect", null), CAP)).toBe(true);
    expect(isLicenseDenied(await m("connect", { assistantId: AS, phoneNumberId: PH }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
  });

  it("desconectar: borra clave, clave de verificación y elección; el webhook vuelve a rechazar; el historial se conserva", async () => {
    const secret = accounts.get(KEY_A)!.assistants.get(AS).server.secret as string;
    const before = vapiCalls.length;
    await ok(m("disconnect", null));
    expect(vapiCalls.length).toBe(before);
    expect(await ess.sql("a", "SELECT field FROM integration_credentials WHERE provider = 'vapi'")).toHaveLength(0);
    const report = { message: { type: "end-of-call-report", call: { id: `call2-${run}` } } };
    expect((await ess.call("a", "POST", "/api/vapi/webhook", { body: report, headers: { "x-vapi-secret": secret } })).status).toBe(401);
    expect(await ess.sql("a", "SELECT vapiCallId FROM vapi_calls")).toHaveLength(1);
    expect(await ok(q("status"))).toMatchObject({ completed: 0, keyMasked: null });
  });
});
