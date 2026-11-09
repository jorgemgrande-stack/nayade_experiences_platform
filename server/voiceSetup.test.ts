/**
 * Elephant Voice · puesta en marcha del asistente de Vapi: cálculo de los pasos, clave validada contra Vapi antes de
 * guardarla (cifrada, nunca devuelta), listado sin secretos, conexión del webhook con una clave de verificación de al
 * menos 24 caracteres (sin relajar el mínimo del Core), confirmación al quitar la dirección de un tercero, comprobación
 * de solo lectura, desconexión, periodo de prueba, límite de ritmo y licencia `voice-ai` (403 y solo lectura).
 * Vapi SIMULADO: ninguna llamada sale a Internet.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { voiceSetup, testCallReceived, VOICE_SETUP_PATH, VOICE_CALLS_PATH, VOICE_WEBHOOK_PATH, type VoiceSetupFacts } from "../shared/voiceSetup";
import { IntegrationVault, MemoryCredentialStore, encryptValue, keyringFromEnv } from "./_core/credentials/vault";
import { getProvider } from "./_core/credentials/catalog";
import { fieldProblems } from "./_core/credentials/presentation";
import { createRateLimiter } from "./financeSyncSetup";
import { MIN_WEBHOOK_SECRET_LENGTH, checkWebhookSecret } from "./_core/webhookSecret";
import { TRPC_ROUTER_CAPABILITIES, capabilityRouteGuard } from "./_core/capabilities/routeGuard";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { runWithTenant } from "./_core/tenant";
import { TASK_NAV, routeCapabilities } from "../shared/adminNav";
import { RECEPTION_TOOLS_PATH, VAPI_WEBHOOK_PATH } from "./receptionAi/runtime";
import {
  SETUP_FIELDS,
  VoiceSetupError,
  connectVoice,
  disconnectVoice,
  generateWebhookSecret,
  getVoiceSetup,
  listVoiceResources,
  saveVoiceKey,
  verifyVoice,
  type VoiceSetupDeps,
} from "./voiceSetup";

// Valores de prueba construidos en ejecución (no parecen claves reales)
const run = crypto.randomBytes(3).toString("hex");
const KEY = ["prueba", "privada", run, "0000-1111-2222"].join("-");
const OTHER_KEY = ["prueba", "otra", run, "3333-4444-5555"].join("-");
const THIRD_SECRET = ["secreto", "de", "un", "tercero", run].join("-");
const WEBHOOK = "https://acme.elephantsource.es/api/vapi/webhook";
const A1 = "a1a1a1a1-0000-4000-8000-000000000001";
const A2 = "a2a2a2a2-0000-4000-8000-000000000002";
const P1 = "p1p1p1p1-0000-4000-8000-000000000001";
const P2 = "p2p2p2p2-0000-4000-8000-000000000002";

const ring = keyringFromEnv({ INTEGRATION_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, INTEGRATION_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv)!;

/** Vapi simulado: asistentes y números en memoria, con registro de cada petición. */
function fakeVapi() {
  const state = {
    assistants: new Map<string, any>([
      [A1, { id: A1, name: "Recepción Acme", server: { url: "https://crm.tercero.example/hooks/vapi?token=abc", secret: THIRD_SECRET, headers: { Authorization: "Bearer cabecera-de-un-tercero" } }, serverMessages: ["conversation-update", "end-of-call-report"] }],
      [A2, { id: A2, name: "Ventas", model: { messages: [{ role: "system", content: "x" }] } }],
    ]),
    phones: new Map<string, any>([
      [P1, { id: P1, number: "+34910000001", name: "Centralita", provider: "vapi", assistantId: A2 }],
      [P2, { id: P2, number: "+34910000002", provider: "twilio", assistantId: null }],
    ]),
    calls: [] as Array<{ method: string; path: string; body: any; auth: string }>,
    down: false,
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    if (state.down) throw new Error("ECONNRESET");
    const u = new URL(url);
    expect(u.origin).toBe("https://api.vapi.ai");
    const method = init.method ?? "GET";
    const auth = String((init.headers as Record<string, string>).Authorization ?? "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path: u.pathname, body, auth });
    if (auth !== `Bearer ${KEY}` && auth !== `Bearer ${OTHER_KEY}`) return reply(401, { message: "Invalid Key. Hot tip, you may be using the public key instead of the private key." });
    const [, kind, id] = u.pathname.split("/");
    const coll = kind === "assistant" ? state.assistants : kind === "phone-number" ? state.phones : null;
    if (!coll) return reply(404, {});
    if (!id) return method === "GET" ? reply(200, Array.from(coll.values())) : reply(405, {});
    const item = coll.get(id);
    if (!item) return reply(404, { message: "Not Found" });
    if (method === "GET") return reply(200, item);
    if (method === "PATCH") {
      Object.assign(item, body);
      return reply(200, item);
    }
    return reply(405, {});
  };
  return { state, fetch };
}

function makeDeps(o: { multi?: boolean; trialBlocked?: boolean; allow?: (k: string) => boolean; tenant?: string; store?: MemoryCredentialStore } = {}) {
  const store = o.store ?? new MemoryCredentialStore();
  const tenant = o.tenant ?? "acme";
  const vault = new IntegrationVault(store, () => tenant, () => ring);
  const vapi = fakeVapi();
  const checks: Array<{ outcome: string; message: string; at: string }> = [];
  let lastOkSyncAt: string | null = null;
  let clock = Date.parse("2026-11-09T10:00:00Z");
  const deps: VoiceSetupDeps = {
    multi: () => o.multi ?? true,
    tenantId: () => tenant,
    webhookUrl: () => WEBHOOK,
    vault: () => vault,
    health: async () => [{ provider: "vapi", lastCheck: checks.length ? { at: checks[checks.length - 1].at, outcome: checks[checks.length - 1].outcome as any, message: checks[checks.length - 1].message } : null, lastOkSyncAt }],
    recordCheck: async (outcome, message) => {
      checks.push({ outcome, message, at: new Date(Date.now() + 1000).toISOString() });
    },
    // Mismo probador de la bóveda (listado de un asistente), con el Vapi simulado
    checkKey: async (apiKey) => {
      const r = await vapi.fetch("https://api.vapi.ai/assistant?limit=1", { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } });
      return r.ok ? { ok: true, message: "Conexión correcta", outcome: "connected" } : { ok: false, message: "Credenciales rechazadas por el proveedor", outcome: r.status === 401 ? "rejected" : "error" };
    },
    vapiFetch: vapi.fetch,
    beforeVapi: async () => {
      if (o.trialBlocked) throw new VoiceSetupError("PRECONDITION_FAILED", "Durante la prueba gratuita Vapi no está disponible.");
    },
    lastCall: async () => null,
    allow: o.allow ?? (() => true),
    newSecret: generateWebhookSecret,
    now: () => new Date(clock),
  };
  return {
    deps,
    store,
    vault,
    vapi,
    checks,
    event: (iso: string) => (lastOkSyncAt = iso),
    tick: (ms: number) => (clock += ms),
  };
}

const admin = { id: 7 };
const facts = (o: Partial<VoiceSetupFacts> = {}): VoiceSetupFacts => ({
  available: true,
  key: { saved: false, check: null, checkMessage: null },
  assistant: { id: null, name: null },
  phoneNumber: { id: null, number: null },
  secretUsable: false,
  secretTooShort: false,
  connectedAt: null,
  lastEventAt: null,
  lastCall: null,
  ...o,
});
const stepOf = (f: VoiceSetupFacts, id: string) => voiceSetup(f).steps.find((s) => s.id === id)!;
const errOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as VoiceSetupError;
  }
  throw new Error("se esperaba un error");
};

describe("pasos de la puesta en marcha", () => {
  it("empresa nueva: cinco pasos, nada hecho; sin clave aceptada, lo demás espera", () => {
    const r = voiceSetup(facts());
    expect(r.steps.map((s) => s.id)).toEqual(["apiKey", "assistant", "phoneNumber", "webhook", "testCall"]);
    expect(r).toMatchObject({ completed: 0, total: 5, ready: false });
    expect(r.missing).toHaveLength(5);
    expect(r.steps.slice(1).map((s) => s.status)).toEqual(["blocked", "blocked", "blocked", "blocked"]);
  });

  it("clave rechazada por Vapi: revisar; clave aceptada: siguiente paso pendiente", () => {
    expect(stepOf(facts({ key: { saved: true, check: "rejected", checkMessage: null } }), "apiKey").status).toBe("attention");
    const ok = facts({ key: { saved: true, check: "connected", checkMessage: null } });
    expect(stepOf(ok, "apiKey").status).toBe("done");
    expect(stepOf(ok, "assistant").status).toBe("todo");
    expect(stepOf(ok, "webhook").status).toBe("blocked");
  });

  it("clave de verificación demasiado corta: el paso del webhook lo explica (se renueva al conectar)", () => {
    const s = stepOf(facts({ key: { saved: true, check: "connected", checkMessage: null }, secretTooShort: true }), "webhook");
    expect(s.status).toBe("attention");
    expect(s.detail).toContain("menos de 24 caracteres");
  });

  it("la llamada de prueba solo cuenta si llega DESPUÉS de conectar; con ella, listo", () => {
    const base = facts({ key: { saved: true, check: "connected", checkMessage: null }, assistant: { id: A1, name: "Recepción" }, phoneNumber: { id: P1, number: "+34910000001" }, secretUsable: true, connectedAt: "2026-11-09T10:00:00.000Z" });
    expect(stepOf(base, "webhook").status).toBe("done");
    expect(voiceSetup({ ...base, lastEventAt: "2026-11-09T09:00:00.000Z" }).ready).toBe(false);
    expect(testCallReceived({ connectedAt: base.connectedAt, lastEventAt: "2026-11-09T09:00:00.000Z" })).toBe(false);
    const r = voiceSetup({ ...base, lastEventAt: "2026-11-09T10:05:00.000Z" });
    expect(r).toMatchObject({ ready: true, completed: 5, missing: [] });
  });

  it("instalación de una sola empresa: lo configura el equipo técnico", async () => {
    const { deps } = makeDeps({ multi: false });
    const v = await getVoiceSetup(deps);
    expect(v.multi).toBe(false);
    expect(v.steps[0].detail).toContain("equipo técnico");
    expect((await errOf(saveVoiceKey(deps, KEY, admin))).code).toBe("PRECONDITION_FAILED");
  });
});

describe("clave privada: validada contra Vapi y guardada cifrada", () => {
  it("formato inválido o vacía: no se llama a Vapi", async () => {
    const t = makeDeps();
    expect((await errOf(saveVoiceKey(t.deps, "   ", admin))).code).toBe("BAD_REQUEST");
    expect((await errOf(saveVoiceKey(t.deps, "con espacios dentro", admin))).code).toBe("BAD_REQUEST");
    expect(t.vapi.state.calls).toHaveLength(0);
  });

  it("clave rechazada (p. ej. la pública): no se guarda nada", async () => {
    const t = makeDeps();
    const e = await errOf(saveVoiceKey(t.deps, "clave-publica-que-no-sirve-0000", admin));
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.message).toContain("Private Key");
    expect(await t.store.list("vapi")).toHaveLength(0);
  });

  it("Vapi caído: error de pasarela, sin guardar", async () => {
    const t = makeDeps();
    t.vapi.state.down = true;
    t.deps.checkKey = async () => {
      throw new Error("red");
    };
    expect((await errOf(saveVoiceKey(t.deps, KEY, admin))).code).toBe("BAD_GATEWAY");
    expect(await t.store.list("vapi")).toHaveLength(0);
  });

  it("aceptada: cifrada en la bóveda, comprobación registrada y en el estado solo la máscara", async () => {
    const t = makeDeps();
    expect(await saveVoiceKey(t.deps, `  ${KEY}  `, admin)).toEqual({ saved: true, selectionReset: false });
    const [row] = await t.store.list("vapi");
    expect(row).toMatchObject({ field: "apiKey", secret: true });
    expect(row.value).not.toContain(KEY);
    expect(t.checks.at(-1)?.outcome).toBe("connected");
    // Solo lectura en Vapi
    expect(t.vapi.state.calls.every((c) => c.method === "GET")).toBe(true);
    const v = await getVoiceSetup(t.deps);
    expect(v.keyMasked).toBe(`••••${KEY.slice(-4)}`);
    expect(v.steps[0].status).toBe("done");
    expect(JSON.stringify(v)).not.toContain(KEY);
  });

  it("una clave de otra cuenta olvida la elección de asistente y número", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    await connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: false }, admin);
    expect((await t.vault.resolve("vapi")).setupAssistantId).toBe(A2);
    expect(await saveVoiceKey(t.deps, OTHER_KEY, admin)).toEqual({ saved: true, selectionReset: true });
    const after = await t.vault.resolve("vapi");
    for (const k of SETUP_FIELDS) expect(after[k]).toBeUndefined();
    // La clave de verificación (de la empresa) se conserva
    expect(after.webhookSecret).toBeTruthy();
  });

  it("periodo de prueba sin Vapi: no se llama a Vapi", async () => {
    const t = makeDeps({ trialBlocked: true });
    expect((await errOf(saveVoiceKey(t.deps, KEY, admin))).code).toBe("PRECONDITION_FAILED");
    expect(t.vapi.state.calls).toHaveLength(0);
  });
});

describe("asistentes y números de la cuenta de Vapi (solo lectura, sin secretos)", () => {
  it("sin clave guardada: hay que guardarla antes", async () => {
    const t = makeDeps();
    expect((await errOf(listVoiceResources(t.deps))).code).toBe("PRECONDITION_FAILED");
  });

  it("lista sin claves, cabeceras ni direcciones de terceros (solo el dominio)", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    const r = await listVoiceResources(t.deps);
    expect(r.assistants).toEqual([
      { id: A1, name: "Recepción Acme", serverTarget: "other", otherHost: "crm.tercero.example" },
      { id: A2, name: "Ventas", serverTarget: "none", otherHost: null },
    ]);
    expect(r.phoneNumbers.map((p) => [p.id, p.number, p.assistantId])).toEqual([
      [P1, "+34910000001", A2],
      [P2, "+34910000002", null],
    ]);
    const json = JSON.stringify(r);
    for (const leak of [THIRD_SECRET, "token=abc", "cabecera-de-un-tercero", KEY]) expect(json).not.toContain(leak);
    expect(t.vapi.state.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("límite de ritmo por empresa", async () => {
    const limiter = createRateLimiter(2, 60_000);
    const t = makeDeps({ allow: limiter });
    await saveVoiceKey(t.deps, KEY, admin);
    await listVoiceResources(t.deps);
    expect((await errOf(listVoiceResources(t.deps))).code).toBe("TOO_MANY_REQUESTS");
  });

  it("Vapi revoca la clave: lo dice sin reenviar su respuesta", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    t.deps.vapiFetch = async () => new Response(JSON.stringify({ message: "Invalid Key. Hot tip" }), { status: 401 });
    const e = await errOf(listVoiceResources(t.deps));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).not.toContain("Hot tip");
  });
});

describe("conectar: webhook de ESTA empresa con clave de al menos 24 caracteres", () => {
  it("si el asistente envía a otra dirección o el número tiene otro asistente, pide confirmación sin tocar Vapi", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    const e = await errOf(connectVoice(t.deps, { assistantId: A1, phoneNumberId: P1, replaceExisting: false }, admin));
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toContain("crm.tercero.example");
    expect(e.message).toContain("+34910000001");
    expect(e.message).not.toContain(THIRD_SECRET);
    expect(t.vapi.state.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect((await t.vault.resolve("vapi")).webhookSecret).toBeUndefined();
  });

  it("confirmado: configura servidor + clave + solo el informe final, asigna el número y guarda la elección", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    const r = await connectVoice(t.deps, { assistantId: A1, phoneNumberId: P1, replaceExisting: true }, admin);
    expect(r).toEqual({ assistantName: "Recepción Acme", phoneNumber: "+34910000001", secretGenerated: "missing", webhookUrl: WEBHOOK });
    const saved = await t.vault.resolve("vapi");
    const secret = saved.webhookSecret;
    expect(secret.length).toBeGreaterThanOrEqual(MIN_WEBHOOK_SECRET_LENGTH);
    // El secreto nunca va en la respuesta
    expect(JSON.stringify(r)).not.toContain(secret);
    const patches = t.vapi.state.calls.filter((c) => c.method === "PATCH");
    expect(patches.map((c) => c.path)).toEqual([`/assistant/${A1}`, `/phone-number/${P1}`]);
    // Sin cabeceras del tercero; con la dirección de la empresa y su clave
    expect(patches[0].body).toEqual({ server: { url: WEBHOOK, secret }, serverMessages: ["end-of-call-report"] });
    expect(patches[1].body).toEqual({ assistantId: A1 });
    expect(t.vapi.state.phones.get(P1).assistantId).toBe(A1);
    expect(saved).toMatchObject({ setupAssistantId: A1, setupAssistantName: "Recepción Acme", setupPhoneNumberId: P1, setupPhoneNumber: "+34910000001", setupConnectedAt: "2026-11-09T10:00:00.000Z" });
    // El webhook del Core acepta exactamente lo que Vapi enviará
    expect(checkWebhookSecret(t.vapi.state.assistants.get(A1).server.secret, secret)).toBe("ok");
    // Estado: conectado, falta la llamada de prueba
    const v = await getVoiceSetup(t.deps);
    expect(v.steps.find((s) => s.id === "webhook")?.status).toBe("done");
    expect(v.steps.find((s) => s.id === "testCall")?.status).toBe("todo");
    expect(v.secret).toEqual({ set: true, usable: true, tooShort: false });
    expect(JSON.stringify(v)).not.toContain(secret);
    expect(JSON.stringify(v)).not.toContain(KEY);
    // Llega el informe de la llamada de prueba (recordSync del webhook) → listo
    // (con el mismo reloj que la fila de la bóveda: la base de datos; aquí, el del proceso)
    const eventAt = new Date(Date.now() + 60_000).toISOString();
    t.event(eventAt);
    const ready = await getVoiceSetup(t.deps);
    expect(ready.ready).toBe(true);
    expect(ready.lastEventAt).toBe(eventAt);
  });

  it("reutiliza la clave de verificación utilizable ya guardada (la Recepcionista IA sigue igual)", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    const existing = "clave-de-verificacion-ya-guardada-" + run;
    await t.vault.save("vapi", { webhookSecret: existing }, "u");
    const r = await connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: false }, admin);
    expect(r.secretGenerated).toBeNull();
    expect(t.vapi.state.assistants.get(A2).server).toEqual({ url: WEBHOOK, secret: existing });
    // El número ya tenía el asistente: no se vuelve a asignar
    t.vapi.state.calls.length = 0;
    await connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: false }, admin);
    expect(t.vapi.state.calls.filter((c) => c.method === "PATCH").map((c) => c.path)).toEqual([`/assistant/${A2}`]);
  });

  it("clave de verificación de 8 caracteres (antigua): NO se acepta; se genera una conforme y se explica", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    // La validación del Core ya no admite guardarla así...
    expect(fieldProblems(getProvider("vapi")!, { webhookSecret: "corta123" })[0]).toContain("24 caracteres");
    await expect(t.vault.save("vapi", { webhookSecret: "corta123" }, "u")).rejects.toThrow();
    // ...pero puede existir de antes: se simula una fila heredada
    const enc = encryptValue("corta123", "acme", "vapi", "webhookSecret", ring);
    await t.store.upsert({ provider: "vapi", field: "webhookSecret", secret: true, value: enc.cipher, keyId: enc.keyId });
    expect((await getVoiceSetup(t.deps)).secret).toEqual({ set: true, usable: false, tooShort: true });
    const r = await connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: false }, admin);
    expect(r.secretGenerated).toBe("too_short");
    const secret = (await t.vault.resolve("vapi")).webhookSecret;
    expect(secret).not.toBe("corta123");
    expect(secret.length).toBeGreaterThanOrEqual(24);
    expect(checkWebhookSecret("corta123", "corta123")).toBe("inactive");
  });

  it("asistente o número que ya no existen: no se escribe nada", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    const e = await errOf(connectVoice(t.deps, { assistantId: "ffffffff-0000-4000-8000-00000000dead", phoneNumberId: P2, replaceExisting: true }, admin));
    expect(e.code).toBe("NOT_FOUND");
    expect(t.vapi.state.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect((await errOf(connectVoice(t.deps, { assistantId: "../x", phoneNumberId: P2, replaceExisting: true }, admin))).code).toBe("BAD_REQUEST");
  });

  it("sin dirección pública https no se conecta", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    t.deps.webhookUrl = () => "";
    expect((await errOf(connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: true }, admin))).code).toBe("PRECONDITION_FAILED");
  });
});

describe("comprobar en Vapi (solo lectura) y desconectar", () => {
  it("comprobación: solo GET; detecta que el asistente ya no apunta al panel", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    expect(await verifyVoice(t.deps)).toEqual({ ok: false, problems: ["Aún no has conectado ningún asistente."] });
    await connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: false }, admin);
    t.vapi.state.calls.length = 0;
    expect(await verifyVoice(t.deps)).toEqual({ ok: true, problems: [] });
    t.vapi.state.assistants.get(A2).server = { url: "https://otro.example/hook" };
    const r = await verifyVoice(t.deps);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("otro.example");
    expect(t.vapi.state.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("desconectar borra clave, clave de verificación y elección de la bóveda (sin tocar Vapi)", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    await connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: false }, admin);
    t.vapi.state.calls.length = 0;
    expect(await disconnectVoice(t.deps, admin)).toEqual({ disconnected: true });
    expect(await t.store.list("vapi")).toHaveLength(0);
    expect(t.vapi.state.calls).toHaveLength(0);
    const v = await getVoiceSetup(t.deps);
    expect(v).toMatchObject({ keyMasked: null, completed: 0, secret: { set: false, usable: false, tooShort: false } });
  });

  it("cada empresa con su bóveda: lo cifrado por una no lo lee otra", async () => {
    const store = new MemoryCredentialStore();
    const a = makeDeps({ store, tenant: "acme" });
    await saveVoiceKey(a.deps, KEY, admin);
    const b = makeDeps({ store, tenant: "otra" });
    expect((await b.vault.resolve("vapi")).apiKey).toBeUndefined();
  });
});

describe("licencia voice-ai, rutas y coherencia con el Core", () => {
  async function guarded(status: "active" | "read_only" | null) {
    const caps = new MemoryCapabilityStore();
    if (status) await caps.apply("acme", [{ capabilityId: "voice-ai", siteId: "", status, validUntil: null, source: "operator" }], { actor: "t", reason: null, now: Date.now() });
    const access = new CapabilityAccess(caps, { enforce: true, ttlMs: 0 });
    const app = express();
    app.use((_req, _res, next) => runWithTenant("acme", next));
    app.use("/api/trpc", capabilityRouteGuard(() => access));
    app.use((_req, res) => res.status(200).json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const req = (method: string, proc: string) =>
      new Promise<number>((resolve, reject) => {
        const r = http.request({ host: "127.0.0.1", port, method, path: `/api/trpc/${proc}` }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        r.on("error", reject);
        r.end();
      });
    try {
      return { status: await req("GET", "voiceSetup.status"), resources: await req("GET", "voiceSetup.resources"), connect: await req("POST", "voiceSetup.connect"), saveKey: await req("POST", "voiceSetup.saveKey"), disconnect: await req("POST", "voiceSetup.disconnect") };
    } finally {
      server.close();
    }
  }

  it("sin licencia: 403 en todo; solo lectura: consultas sí, cambios 403; activa: todo", async () => {
    expect(TRPC_ROUTER_CAPABILITIES.voiceSetup).toBe("voice-ai");
    expect(await guarded(null)).toEqual({ status: 403, resources: 403, connect: 403, saveKey: 403, disconnect: 403 });
    expect(await guarded("read_only")).toEqual({ status: 200, resources: 200, connect: 403, saveKey: 403, disconnect: 403 });
    expect(await guarded("active")).toEqual({ status: 200, resources: 200, connect: 200, saveKey: 200, disconnect: 200 });
  });

  it("pantalla bajo «Llamadas IA», solo administración, licenciada con voice-ai", () => {
    const item = TASK_NAV.flatMap((s) => s.items).find((i) => i.key === "x-voz")!;
    expect(item.capabilities).toEqual(["voice-ai"]);
    const child = item.children?.find((c) => c.href === VOICE_SETUP_PATH);
    expect(child).toMatchObject({ label: "Puesta en marcha", roles: ["admin"] });
    expect(item.children?.some((c) => c.href === VOICE_CALLS_PATH)).toBe(true);
    expect(routeCapabilities(VOICE_SETUP_PATH)).toEqual(["voice-ai"]);
  });

  it("misma dirección de webhook que la Recepcionista IA y el router de Vapi; clave del catálogo alineada con el Core", () => {
    expect(VOICE_WEBHOOK_PATH).toBe(VAPI_WEBHOOK_PATH);
    expect(RECEPTION_TOOLS_PATH.startsWith("/api/vapi/")).toBe(true);
    const vapi = getProvider("vapi")!;
    const f = vapi.fields.find((x) => x.key === "webhookSecret")!;
    expect(f.pattern!.test("x".repeat(MIN_WEBHOOK_SECRET_LENGTH - 1))).toBe(false);
    expect(f.pattern!.test("x".repeat(MIN_WEBHOOK_SECRET_LENGTH))).toBe(true);
    expect(f.panel?.formatMessage).toContain("24");
    // La elección no se edita desde «Integraciones y pagos»
    for (const k of SETUP_FIELDS) expect(vapi.fields.find((x) => x.key === k)).toMatchObject({ secret: false, panel: { hidden: true } });
    expect(generateWebhookSecret()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("de dónde salen las claves de Vapi (desconectar debe dejar el webhook inactivo)", () => {
  it("multiempresa: solo la bóveda; ni site_settings ni la clave de GHL", async () => {
    const { configuredVapiWebhookSecret, configuredVapiApiKey } = await import("./vapiCredentialsSource");
    const legacy = "x".repeat(30);
    const ghl = "g".repeat(30);
    expect(configuredVapiWebhookSecret({ multi: true, vault: undefined, legacy, ghl })).toBe("");
    expect(configuredVapiWebhookSecret({ multi: true, vault: "v".repeat(30), legacy, ghl })).toBe("v".repeat(30));
    expect(configuredVapiApiKey({ multi: true, vault: undefined, legacy })).toBe("");
    // Con la bóveda vacía (tras desconectar) el webhook queda inactivo
    expect(checkWebhookSecret(legacy, configuredVapiWebhookSecret({ multi: true, vault: undefined, legacy, ghl }))).toBe("inactive");
  });

  it("instalación única (Náyade): como siempre, entorno, después site_settings y la clave de GHL", async () => {
    const { configuredVapiWebhookSecret, configuredVapiApiKey } = await import("./vapiCredentialsSource");
    expect(configuredVapiWebhookSecret({ multi: false, vault: "env", legacy: "db", ghl: "ghl" })).toBe("env");
    expect(configuredVapiWebhookSecret({ multi: false, vault: undefined, legacy: "db", ghl: "ghl" })).toBe("db");
    expect(configuredVapiWebhookSecret({ multi: false, vault: undefined, legacy: "", ghl: "ghl" })).toBe("ghl");
    expect(configuredVapiApiKey({ multi: false, vault: undefined, legacy: "db" })).toBe("db");
  });
});

describe("dirección del webhook: solo el dominio de la empresa", () => {
  it("con dominio público https, su /api/vapi/webhook; sin él, vacía (y conectar no sigue)", async () => {
    const { voiceWebhookUrl } = await import("./voiceSetup");
    expect(voiceWebhookUrl("https://acme.elephantsource.es")).toBe(WEBHOOK);
    expect(voiceWebhookUrl("https://acme.elephantsource.es/")).toBe(WEBHOOK);
    for (const bad of [null, undefined, "", "http://acme.example", "https://acme.example/otra/ruta"]) expect(voiceWebhookUrl(bad)).toBe("");
    // La dirección de la plataforma (APP_URL) no interviene: la función solo recibe el dominio de la empresa
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://plataforma.example";
    try {
      expect(voiceWebhookUrl(null)).toBe("");
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
    }
  });
});

describe("conectar: nada se escribe en Vapi con datos que no cuadran", () => {
  it("si Vapi devuelve otro identificador (o uno inválido), BAD_GATEWAY sin ningún PATCH", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    t.vapi.state.assistants.get(A2).id = "../../otro";
    const e = await errOf(connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: true }, admin));
    expect(e.code).toBe("BAD_GATEWAY");
    t.vapi.state.assistants.get(A2).id = A1;
    expect((await errOf(connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: true }, admin))).code).toBe("BAD_GATEWAY");
    expect(t.vapi.state.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("si falla el guardado final de la elección, BAD_GATEWAY con un mensaje claro", async () => {
    const t = makeDeps();
    await saveVoiceKey(t.deps, KEY, admin);
    await t.vault.save("vapi", { webhookSecret: "clave-de-verificacion-ya-guardada-" + run }, "u");
    const real = t.deps.vault;
    t.deps.vault = () => {
      const v = real();
      return {
        status: (ids?: string[]) => v.status(ids),
        resolve: (p: string) => v.resolve(p),
        save: async (p: string, values: Record<string, string>, by: string) => {
          if ("setupAssistantId" in values) throw new Error("BD caída");
          return v.save(p, values, by);
        },
      };
    };
    const e = await errOf(connectVoice(t.deps, { assistantId: A2, phoneNumberId: P2, replaceExisting: true }, admin));
    expect(e.code).toBe("BAD_GATEWAY");
    expect(e.message).toContain("Conectar con Vapi");
    expect(e.message).not.toContain("BD caída");
  });
});

describe("«Llamadas IA › Configuración» nunca devuelve credenciales en claro", () => {
  it("clave: solo los 4 últimos; clave de verificación corta: nada; utilizable: los 4 últimos", async () => {
    const { maskedVapiCredentials } = await import("./vapiCredentialsSource");
    const long = "clave-de-verificacion-larga-" + run;
    expect(maskedVapiCredentials(KEY, long)).toEqual({ hasApiKey: true, apiKeyMasked: `••••${KEY.slice(-4)}`, hasWebhookSecret: true, webhookSecret: `••••${long.slice(-4)}` });
    expect(maskedVapiCredentials(KEY, "corta123")).toMatchObject({ hasWebhookSecret: true, webhookSecret: "••••" });
    expect(maskedVapiCredentials("", "")).toEqual({ hasApiKey: false, apiKeyMasked: "", hasWebhookSecret: false, webhookSecret: "" });
    const json = JSON.stringify(maskedVapiCredentials(KEY, "corta123"));
    expect(json).not.toContain(KEY.slice(0, 8));
    expect(json).not.toContain("123");
  });
});

describe("pantalla de llamadas: la dirección del webhook sin la clave", () => {
  it("no muestra «(secret: …)» y no corta la dirección con truncate", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/commercial/VapiAgente.tsx"), "utf8");
    expect(src).not.toContain("(secret:");
    const line = src.split(/\r?\n/).find((l) => l.includes("text-sky-300") && l.includes("<code"))!;
    expect(line).toContain("break-all");
    expect(line).not.toMatch(/\btruncate\b/);
  });
});
