/**
 * Elephant Reception AI sin base de datos, sin Vapi y sin IA (todo con dobles): lógica pura compartida (teléfono,
 * horario de atención humana, prompt, asistente de Vapi, disponibilidad orientativa y resultado de una llamada),
 * servicio (configuración, conocimiento, sincronización con Vapi, herramientas de voz, informe de llamada, chat con su
 * máximo diario y su formulario de datos, registro) y la página pública del chat sobre el router de server/netPublic.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  RECEPTION_LIMITS,
  VAPI_TOOL_NAMES,
  buildSystemPrompt,
  buildVapiAssistant,
  describeAvailability,
  describeHours,
  hoursProblem,
  isHumanHoursNow,
  matchCatalog,
  normalizePhone,
  outcomeFromCallReport,
  parseHours,
  settingsProblem,
  type CatalogEntry,
  type ReceptionSettings,
  type SettingsInput,
} from "../shared/receptionAi";
import { MemoryReceptionStore } from "./receptionAi/store";
import { LEADS_FULL_MESSAGE, ReceptionService, unavailableToolResults, type LeadInput, type LlmMessage } from "./receptionAi/service";
import { NET_PUBLIC_PATH, createNetPublicRouter } from "./netPublic/router";
import { TASK_NAV } from "../shared/adminNav";
import { TRPC_ROUTER_CAPABILITIES } from "./_core/capabilities/routeGuard";
import { PROVIDERS } from "./_core/credentials/catalog";

// Martes 10 de noviembre de 2026, 11:00 en Madrid (10:00 UTC)
const NOW = new Date("2026-11-10T10:00:00Z");
const CATALOG: CatalogEntry[] = [
  { id: 7, title: "Bautismo de buceo", priceFrom: 59, currency: "EUR", duration: "3 horas", summary: "Primera inmersión con instructor.", minPersons: 1, maxPersons: 6 },
  { id: 8, title: "Ruta en kayak", priceFrom: 25.5, currency: "EUR", duration: null, summary: null, minPersons: 2, maxPersons: null },
];
const SECRET = "secreto-de-pruebas-sin-formato-real-000";
const settings = (over: Partial<ReceptionSettings> = {}): ReceptionSettings => ({ ...DEFAULT_SETTINGS, humanHours: [], ...over });
const input = (over: Partial<SettingsInput> = {}): SettingsInput => {
  const { chatKeyVersion: _a, vapiAssistantId: _b, vapiSyncedAt: _c, vapiSyncedHash: _d, updatedAt: _e, ...s } = settings();
  return { ...s, enabled: true, ...over };
};

describe("lógica pura de la recepcionista", () => {
  it("teléfono en formato internacional", () => {
    expect(normalizePhone("600 11 22 33")).toBe("+34600112233");
    expect(normalizePhone("0034 600-11-22-33")).toBe("+34600112233");
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
    for (const bad of ["", "123", "abc", null, "+0600112233"]) expect(normalizePhone(bad)).toBeNull();
  });

  it("horario de atención humana: validación, descripción y «¿hay alguien ahora?» en la zona horaria", () => {
    expect(hoursProblem([{ day: 2, from: "09:00", to: "14:00" }, { day: 2, from: "16:00", to: "19:00" }])).toBeNull();
    expect(hoursProblem([{ day: 2, from: "14:00", to: "09:00" }])).toMatch(/posterior/);
    expect(hoursProblem([{ day: 2, from: "09:00", to: "14:00" }, { day: 2, from: "13:00", to: "15:00" }])).toMatch(/solapan/);
    expect(hoursProblem([{ day: 1, from: "9:00", to: "14:00" }])).toMatch(/HH:MM/);
    const h = [{ day: 2 as const, from: "09:00", to: "14:00" }, { day: 1 as const, from: "16:00", to: "19:00" }];
    expect(describeHours(h)).toBe("lunes: 16:00–19:00; martes: 09:00–14:00");
    expect(isHumanHoursNow(h, NOW, "Europe/Madrid")).toBe(true); // martes 11:00 en Madrid
    expect(isHumanHoursNow(h, new Date("2026-11-10T13:30:00Z"), "Europe/Madrid")).toBe(false); // 14:30
    expect(isHumanHoursNow([], NOW)).toBe(false);
    expect(parseHours('[{"day":2,"from":"09:00","to":"14:00"},{"day":9,"from":"x","to":"y"}]')).toEqual([{ day: 2, from: "09:00", to: "14:00" }]);
    expect(parseHours("no es json")).toEqual([]);
  });

  it("configuración: nombre, teléfono para pasar llamadas y máximo diario del chat", () => {
    expect(settingsProblem(input())).toBeNull();
    expect(settingsProblem(input({ assistantName: " " }))).toMatch(/nombre/);
    expect(settingsProblem(input({ transferEnabled: true, transferNumber: "123" }))).toMatch(/teléfono válido/);
    expect(settingsProblem(input({ chatDailyLimit: 0 }))).toMatch(/máximo diario/);
    expect(settingsProblem(input({ chatDailyLimit: RECEPTION_LIMITS.chatDailyMax + 1 }))).toMatch(/máximo diario/);
    expect(settingsProblem(input({ timezone: "Marte/Olympus" }))).toMatch(/Zona horaria/);
  });

  it("prompt: solo su conocimiento, su catálogo con precios publicados, idioma y reglas por canal", () => {
    const s = settings({ language: "en", businessSummary: "Centro de buceo", address: "Puerto 1", transferEnabled: true, transferNumber: "+34600112233", humanHours: [{ day: 2, from: "09:00", to: "14:00" }] });
    const items = [{ id: 1, kind: "faq" as const, question: "¿Hay parking?", answer: "Sí, gratuito.", sortOrder: 0, archived: false }, { id: 2, kind: "faq" as const, question: "Archivada", answer: "No debe salir", sortOrder: 1, archived: true }];
    const voice = buildSystemPrompt({ channel: "voice", companyName: "Buceo QA", settings: s, items, catalog: CATALOG });
    expect(voice).toContain("Responde siempre en inglés");
    expect(voice).toContain("¿Hay parking?: Sí, gratuito.");
    expect(voice).not.toContain("No debe salir");
    expect(voice).toContain("Bautismo de buceo (desde 59");
    expect(voice).toContain(VAPI_TOOL_NAMES.availability);
    expect(voice).toContain(VAPI_TOOL_NAMES.humans);
    expect(voice).toMatch(/nunca inventes precios/);
    const chat = buildSystemPrompt({ channel: "chat", companyName: "Buceo QA", settings: { ...s, includeCatalog: false }, items, catalog: CATALOG, humansNow: true });
    expect(chat).not.toContain("Bautismo");
    expect(chat).toContain("Déjanos tus datos");
    expect(chat).toContain("+34600112233");
    expect(chat).not.toContain(VAPI_TOOL_NAMES.request);
  });

  it("asistente de Vapi: herramientas servidas por el Core con el secreto; transferencia solo con número", () => {
    const base = { companyName: "Buceo QA", systemPrompt: "P", toolsUrl: "https://qa.example/api/vapi/reception/tools", webhookUrl: "https://qa.example/api/vapi/webhook", secret: SECRET };
    const a = buildVapiAssistant({ ...base, settings: settings() }) as any;
    const names = a.model.tools.map((t: any) => t.function?.name ?? t.type);
    expect(names).toEqual([VAPI_TOOL_NAMES.availability, VAPI_TOOL_NAMES.request]);
    expect(a.model.tools[0].server).toEqual({ url: base.toolsUrl, secret: SECRET });
    expect(a.server).toEqual({ url: base.webhookUrl, secret: SECRET });
    expect(a.transcriber.language).toBe("es");
    expect(a.voice).toBeUndefined(); // la voz se elige en Vapi
    expect(a.firstMessage).toContain("Buceo QA");
    const t = buildVapiAssistant({ ...base, settings: settings({ transferEnabled: true, transferNumber: "+34600112233", leadEnabled: false, callbackEnabled: false }) }) as any;
    expect(t.model.tools.map((x: any) => x.function?.name ?? x.type)).toEqual([VAPI_TOOL_NAMES.availability, VAPI_TOOL_NAMES.humans, "transferCall"]);
    expect(t.model.tools[2].destinations[0].number).toBe("+34600112233");
  });

  it("resultado de una llamada con su informe final", () => {
    expect(outcomeFromCallReport("lead_created", "customer-ended-call", 120)).toBe("lead_created");
    expect(outcomeFromCallReport("open", "assistant-forwarded-call", 60)).toBe("derived");
    expect(outcomeFromCallReport("open", "pipeline-error-openai", 30)).toBe("unresolved");
    expect(outcomeFromCallReport("open", "customer-ended-call", 4)).toBe("unresolved");
    expect(outcomeFromCallReport("open", "customer-ended-call", 95)).toBe("resolved");
  });

  it("disponibilidad orientativa: servicio del catálogo, horarios del día, aforo menos reservas", () => {
    expect(matchCatalog(CATALOG, "bautismo buceo")?.id).toBe(7);
    expect(matchCatalog(CATALOG, "kayak")?.id).toBe(8);
    expect(matchCatalog(CATALOG, "paracaidismo")).toBeNull();
    const slots = [{ id: 1, label: "Mañana", startTime: "10:00", daysOfWeek: "6,0", capacity: 8 }, { id: 2, label: "Tarde", startTime: "16:00", daysOfWeek: "6", capacity: 4 }];
    const today = "2026-11-10";
    // Sábado 14: 8 - 6 = 2 libres por la mañana, 4 por la tarde
    const sat = describeAvailability({ entry: CATALOG[0], date: "2026-11-14", people: 3, slots, bookedBySlot: new Map([[1, 6]]), today });
    expect(sat.status).toBe("available");
    expect(sat.text).toContain("Tarde (4 libres)");
    expect(sat.text).not.toContain("Mañana");
    expect(describeAvailability({ entry: CATALOG[0], date: "2026-11-14", people: 5, slots, bookedBySlot: new Map([[1, 6]]), today }).status).toBe("full");
    expect(describeAvailability({ entry: CATALOG[0], date: "2026-11-11", people: 2, slots, bookedBySlot: new Map(), today }).status).toBe("closed");
    expect(describeAvailability({ entry: CATALOG[0], date: "2026-11-01", people: 2, slots, bookedBySlot: new Map(), today }).status).toBe("past");
    expect(describeAvailability({ entry: CATALOG[0], date: "2026-11-14", people: 9, slots, bookedBySlot: new Map(), today }).status).toBe("too_many");
    // Sin aforo publicado no se afirma que haya plazas
    const unknown = describeAvailability({ entry: CATALOG[1], date: "2026-11-14", people: 2, slots: [], bookedBySlot: new Map(), today });
    expect(unknown.status).toBe("unknown");
    expect(unknown.text).toMatch(/no puedo confirmar plazas/);
  });
});

// ─── Servicio con dobles ──────────────────────────────────────────────────────

interface World {
  store: MemoryReceptionStore;
  svc: ReceptionService;
  leads: LeadInput[];
  llmCalls: LlmMessage[][];
  fetches: Array<{ url: string; method: string; body: any; auth: string }>;
  responses: Array<{ status: number; body?: unknown }>;
  creds: { apiKey: string | null; webhookSecret: string | null };
  llm: { reply: string | null; fail: boolean };
}

function world(): World {
  const store = new MemoryReceptionStore();
  store.clock = () => NOW.getTime();
  const w: World = { store, leads: [], llmCalls: [], fetches: [], responses: [], creds: { apiKey: "clave-de-pruebas-vapi", webhookSecret: SECRET }, llm: { reply: "Abrimos de 9 a 14.", fail: false } } as World;
  w.svc = new ReceptionService({
    store,
    companyName: () => "Buceo QA",
    catalog: async () => CATALOG,
    slots: async () => ({ slots: [{ id: 1, label: "Mañana", startTime: "10:00", daysOfWeek: null, capacity: 8 }], bookedBySlot: new Map([[1, 2]]) }),
    createLead: async (l) => {
      w.leads.push(l);
      return 100 + w.leads.length;
    },
    llm: async (m) => {
      w.llmCalls.push(m);
      if (w.llm.fail) throw new Error("cuota agotada");
      return w.llm.reply ?? "";
    },
    vapi: {
      credentials: async () => w.creds,
      fetch: async (url, init) => {
        w.fetches.push({ url, method: String(init.method), body: JSON.parse(String(init.body)), auth: String((init.headers as any).Authorization) });
        const r = w.responses.shift() ?? { status: 201, body: { id: "asst_qa_1" } };
        return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
      },
    },
    urls: { tools: () => "https://qa.example/api/vapi/reception/tools", webhook: () => "https://qa.example/api/vapi/webhook", chat: (k) => `https://qa.example/recepcion/${k}` },
    chatKeys: { sign: (v) => `clave-chat-${String(v).padStart(21, "0")}`, verify: (k, v) => k === `clave-chat-${String(v).padStart(21, "0")}` },
    now: () => NOW,
  });
  return w;
}

const toolPayload = (name: string, args: unknown, over: Record<string, unknown> = {}) => ({
  message: { type: "tool-calls", call: { id: "call-qa-1", assistantId: "asst_qa_1", customer: { number: "+34611000000" }, ...over }, toolCallList: [{ id: "tc1", type: "function", function: { name, arguments: args } }] },
});

describe("servicio: configuración, conocimiento y voz", () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it("guarda la configuración normalizada y rechaza la no válida", async () => {
    const s = await w.svc.saveSettings(input({ assistantName: "  Lucía  ", transferEnabled: true, transferNumber: "600 11 22 33", humanHours: [{ day: 5, from: "10:00", to: "12:00" }, { day: 1, from: "09:00", to: "14:00" }] }), 1);
    expect(s).toMatchObject({ assistantName: "Lucía", transferNumber: "+34600112233" });
    expect(s.humanHours.map((h) => h.day)).toEqual([1, 5]);
    await expect(w.svc.saveSettings(input({ transferEnabled: true, transferNumber: "abc" }), 1)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("conocimiento: alta, edición, archivo y máximo de contenidos activos", async () => {
    const id = await w.svc.addKnowledge({ kind: "faq", question: "¿Hay parking?", answer: "Sí." }, 1);
    await w.svc.updateKnowledge(id, { kind: "faq", question: "¿Hay aparcamiento?", answer: "Sí, gratis." });
    expect((await w.store.knowledge(false))[0]).toMatchObject({ question: "¿Hay aparcamiento?", answer: "Sí, gratis." });
    await w.svc.archiveKnowledge(id, true);
    expect(await w.store.knowledge(false)).toHaveLength(0);
    await expect(w.svc.addKnowledge({ kind: "faq", question: "", answer: "x" }, 1)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(w.svc.updateKnowledge(999, { kind: "faq", question: "a", answer: "b" })).rejects.toMatchObject({ code: "not_found" });
    for (let i = 0; i < RECEPTION_LIMITS.knowledgeMax; i++) await w.store.addKnowledge({ kind: "faq", question: `P${i}`, answer: "R", sortOrder: i }, 1);
    await expect(w.svc.addKnowledge({ kind: "faq", question: "Una más", answer: "R" }, 1)).rejects.toThrow(/Como mucho/);
  });

  it("sin la credencial de Vapi de la empresa no se sincroniza y el estado lo explica", async () => {
    await w.svc.saveSettings(input(), 1);
    w.creds = { apiKey: null, webhookSecret: "corto" };
    const st = await w.svc.voiceStatus();
    expect(st).toMatchObject({ hasApiKey: false, hasWebhookSecret: false, ready: false, assistantId: null, inSync: null });
    expect(st.problems.join(" ")).toMatch(/clave de acceso/);
    await expect(w.svc.syncVoice()).rejects.toMatchObject({ code: "not_configured" });
    expect(w.fetches).toHaveLength(0);
  });

  it("sincroniza con la cuenta de Vapi de la empresa: crea, actualiza, recrea si se borró y detecta cambios", async () => {
    await w.svc.saveSettings(input({ enabled: false }), 1);
    await expect(w.svc.syncVoice()).rejects.toThrow(/Activa la recepcionista/);
    await w.svc.saveSettings(input(), 1);
    expect(await w.svc.syncVoice()).toEqual({ assistantId: "asst_qa_1", created: true });
    expect(w.fetches[0]).toMatchObject({ url: "https://api.vapi.ai/assistant", method: "POST", auth: "Bearer clave-de-pruebas-vapi" });
    expect(w.fetches[0].body.model.tools[0].server.url).toBe("https://qa.example/api/vapi/reception/tools");
    expect((await w.svc.voiceStatus()).inSync).toBe(true);

    await w.svc.addKnowledge({ kind: "info", question: "Nuevo", answer: "Dato" }, 1);
    expect((await w.svc.voiceStatus()).inSync).toBe(false);
    w.responses.push({ status: 200, body: { id: "asst_qa_1" } });
    expect(await w.svc.syncVoice()).toEqual({ assistantId: "asst_qa_1", created: false });
    expect(w.fetches[1]).toMatchObject({ url: "https://api.vapi.ai/assistant/asst_qa_1", method: "PATCH" });
    expect(JSON.stringify(w.fetches[1].body)).toContain("Nuevo: Dato");

    w.responses.push({ status: 404, body: { message: "not found" } }, { status: 201, body: { id: "asst_qa_2" } });
    expect(await w.svc.syncVoice()).toEqual({ assistantId: "asst_qa_2", created: true });
    expect(w.fetches.slice(2).map((f) => f.method)).toEqual(["PATCH", "POST"]);

    w.responses.push({ status: 401, body: {} });
    await expect(w.svc.syncVoice()).rejects.toThrow(/rechazado la clave/);
    w.responses.push({ status: 400, body: { message: ["x"] } });
    await expect(w.svc.syncVoice()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("herramientas de voz: solo del asistente de la empresa y con la recepcionista activa", async () => {
    expect(await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.availability, { servicio: "buceo", fecha: "2026-11-14" }))).toEqual(unavailableToolResults(toolPayload("x", {})));
    await w.svc.saveSettings(input(), 1);
    await w.svc.syncVoice();
    const other = await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.availability, { servicio: "buceo", fecha: "2026-11-14" }, { assistantId: "asst_de_otra_empresa" }));
    expect(other.results[0].result).toMatch(/no está disponible/);
    expect(w.store.convs).toHaveLength(0);
  });

  it("herramientas de voz: disponibilidad, ¿hay alguien del equipo? y solicitud (una por llamada)", async () => {
    await w.svc.saveSettings(input({ transferEnabled: true, transferNumber: "+34600112233", humanHours: [{ day: 2, from: "09:00", to: "14:00" }] }), 1);
    await w.svc.syncVoice();
    const av = await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.availability, JSON.stringify({ servicio: "Bautismo de buceo", fecha: "2026-11-14", personas: 2 })));
    expect(av.results).toEqual([{ toolCallId: "tc1", result: expect.stringContaining("Mañana (6 libres)") }]);
    expect((await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.availability, { servicio: "Bautismo", fecha: "sábado" }))).results[0].result).toMatch(/AAAA-MM-DD/);
    expect((await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.availability, { servicio: "paracaídas", fecha: "2026-11-14" }))).results[0].result).toMatch(/Servicios publicados: Bautismo de buceo, Ruta en kayak/);
    expect((await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.humans, {}))).results[0].result).toMatch(/^Sí/);

    const miss = await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.request, { tipo: "reserva", nombre: "Ana" }));
    expect(miss.results[0].result).toMatch(/Faltan datos/);
    const req = await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.request, { tipo: "llamada", nombre: "Ana Prueba", telefono: "611 00 00 00", motivo: "Grupo de 8 el sábado", personas: 8 }));
    expect(req.results[0].result).toContain("Solicitud registrada");
    expect(w.leads).toHaveLength(1);
    expect(w.leads[0]).toMatchObject({ name: "Ana Prueba", phone: "+34611000000", source: "recepcion_ia_voz", numberOfPersons: 8 });
    expect(w.leads[0].email).toMatch(/@sin-email\.invalid$/);
    expect(w.leads[0].message).toContain("Devolver la llamada: Grupo de 8 el sábado");
    expect((await w.svc.handleToolCalls(toolPayload(VAPI_TOOL_NAMES.request, { tipo: "reserva", nombre: "Ana", telefono: "611000000", motivo: "otra" }))).results[0].result).toMatch(/ya está registrada/);
    expect(w.leads).toHaveLength(1);
    const conv = w.store.convs[0];
    expect(conv).toMatchObject({ channel: "voice", externalRef: "call-qa-1", outcome: "callback", leadId: 101, customerName: "Ana Prueba" });
    expect(w.store.msgs.filter((m) => m.role === "tool").length).toBeGreaterThan(3);
  });

  it("informe final de la llamada: duración, resumen y resultado; el resultado fijado por el equipo se respeta", async () => {
    await w.svc.saveSettings(input(), 1);
    await w.svc.syncVoice();
    const report = (over: Record<string, unknown> = {}) => ({ message: { type: "end-of-call-report", endedReason: "assistant-forwarded-call", durationSeconds: 75, analysis: { summary: "Preguntó por precios" }, call: { id: "call-qa-9", assistantId: "asst_qa_1", customer: { number: "+34622000000" } }, ...over } });
    expect(await w.svc.recordCallReport({ message: { type: "status-update" } })).toBe(false);
    expect(await w.svc.recordCallReport(report({ call: { id: "x", assistantId: "asst_de_otra_empresa" } }))).toBe(false);
    expect(await w.svc.recordCallReport(report())).toBe(true);
    expect(w.store.convs[0]).toMatchObject({ outcome: "derived", durationSeconds: 75, summary: "Preguntó por precios", customerPhone: "+34622000000" });
    await w.svc.setOutcome(w.store.convs[0].id, "resolved");
    await w.svc.recordCallReport(report({ endedReason: "pipeline-error" }));
    expect(w.store.convs[0]).toMatchObject({ outcome: "resolved", outcomeSource: "manual" });
    await expect(w.svc.setOutcome(999, "resolved")).rejects.toMatchObject({ code: "not_found" });
    await expect(w.svc.setOutcome(w.store.convs[0].id, "open")).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("servicio: chat de la web", () => {
  let w: World;
  const T = "a".repeat(32);
  beforeEach(async () => {
    w = world();
    await w.svc.saveSettings(input({ chatEnabled: true, chatDailyLimit: 3 }), 1);
  });

  it("el enlace solo vale con el chat activo y en su versión vigente", async () => {
    const key = "clave-chat-000000000000000000001";
    expect(await w.svc.chatGate(key)).not.toBeNull();
    const { chatUrl } = await w.svc.regenerateChatKey();
    expect(chatUrl).toContain("000000000000000000002");
    expect(await w.svc.chatGate(key)).toBeNull();
    await w.svc.saveSettings(input({ chatEnabled: false }), 1);
    expect(await w.svc.chatGate("clave-chat-000000000000000000002")).toBeNull();
  });

  it("responde con la IA, el conocimiento y el historial; guarda la conversación como resuelta", async () => {
    await w.svc.addKnowledge({ kind: "faq", question: "¿Horario?", answer: "De 9 a 14." }, 1);
    const s = await w.store.settings();
    expect(await w.svc.chatSend(s, T, "¿Qué horario tenéis?")).toEqual({ origin: "ai" });
    await w.svc.chatSend(s, T, "¿Y el sábado?");
    const last = w.llmCalls[1];
    expect(last[0].role).toBe("system");
    expect(last[0].content).toContain("¿Horario?: De 9 a 14.");
    expect(last.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    const view = await w.svc.chatView(s, T);
    expect(view.messages.map((m) => m.content)).toEqual(["¿Qué horario tenéis?", "Abrimos de 9 a 14.", "¿Y el sábado?", "Abrimos de 9 a 14."]);
    expect(w.store.convs[0]).toMatchObject({ channel: "chat", outcome: "resolved", aiReplies: 2, summary: "¿Qué horario tenéis?" });
    expect(w.store.convs[0].externalRef).not.toContain(T); // solo la huella del identificador
    await expect(w.svc.chatSend(s, T, "   ")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("sin IA o al llegar al máximo diario, respuesta fija sin llamar a la IA", async () => {
    const s = await w.store.settings();
    w.llm.fail = true;
    expect(await w.svc.chatSend(s, T, "Hola")).toEqual({ origin: "fallback" });
    expect(w.store.convs[0].outcome).toBe("open");
    w.llm.fail = false;
    for (let i = 0; i < 3; i++) expect((await w.svc.chatSend(s, "b".repeat(32), `Pregunta ${i}`)).origin).toBe("ai");
    const calls = w.llmCalls.length;
    expect(await w.svc.chatSend(s, "c".repeat(32), "Otra")).toEqual({ origin: "fallback" });
    expect(w.llmCalls.length).toBe(calls);
    expect((await w.svc.chatView(s, "c".repeat(32))).messages[1].content).toMatch(/déjanos tus datos|Si nos dejas tus datos/i);
  });

  it("máximo diario atómico: con mensajes simultáneos la IA responde como mucho el máximo, por día de la empresa", async () => {
    const s = { ...(await w.store.settings()), chatDailyLimit: 2 };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const llm = (w.svc as unknown as { d: { llm: (m: LlmMessage[]) => Promise<string> } }).d;
    const real = llm.llm;
    llm.llm = async (m) => {
      await gate; // todas las peticiones llegan antes de que responda ninguna
      return real(m);
    };
    const sends = Array.from({ length: 5 }, (_, i) => w.svc.chatSend(s, String.fromCharCode(100 + i).repeat(32), `Pregunta ${i}`));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const origins = (await Promise.all(sends)).map((r) => r.origin);
    expect(origins.filter((o) => o === "ai")).toHaveLength(2);
    expect(w.llmCalls).toHaveLength(2);
    // Clave del cupo: la fecha del día en la zona de la empresa (Europe/Madrid)
    expect(w.store.quotas.get("2026-11-10:chat_reply")).toBe(2);
  });

  it("si la IA falla, el turno reservado vuelve al cupo", async () => {
    const s = { ...(await w.store.settings()), chatDailyLimit: 1 };
    w.llm.fail = true;
    expect((await w.svc.chatSend(s, T, "Hola")).origin).toBe("fallback");
    expect(w.store.quotas.get("2026-11-10:chat_reply")).toBe(0);
    w.llm.fail = false;
    expect((await w.svc.chatSend(s, T, "Otra vez")).origin).toBe("ai");
  });

  it("tope diario de solicitudes del chat por empresa: al superarlo, mensaje amable y sin crear nada en el CRM", async () => {
    const s = await w.store.settings();
    const base = { kind: "info" as const, name: "Ana Prueba", phone: "", email: "ana@cliente.example", note: "", consent: true };
    w.store.quotas.set("2026-11-10:chat_lead", RECEPTION_LIMITS.chatLeadsPerDay - 2);
    const tries = await Promise.allSettled(["e", "f", "g"].map((c) => w.svc.chatLead(s, c.repeat(32), base)));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(2);
    const rejected = tries.find((t) => t.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "invalid_input", message: LEADS_FULL_MESSAGE });
    expect(w.leads).toHaveLength(2);
    await expect(w.svc.chatLead(s, "h".repeat(32), base)).rejects.toThrow(LEADS_FULL_MESSAGE);
    expect(w.leads).toHaveLength(2);
    expect(w.store.convs.filter((c) => c.leadId)).toHaveLength(2);
  });

  it("si el CRM falla al crear la solicitud, la plaza vuelve al cupo", async () => {
    const s = await w.store.settings();
    const d = (w.svc as unknown as { d: { createLead: (l: LeadInput) => Promise<number> } }).d;
    d.createLead = async () => {
      throw new Error("CRM no disponible");
    };
    await expect(w.svc.chatLead(s, T, { kind: "info", name: "Ana", phone: "", email: "ana@cliente.example", note: "", consent: true })).rejects.toThrow(/CRM/);
    expect(w.store.quotas.get("2026-11-10:chat_lead")).toBe(0);
  });

  it("si falla la lectura de la conversación antes de crear la solicitud, no se consume plaza", async () => {
    const s = await w.store.settings();
    const realMessages = w.store.messages.bind(w.store);
    w.store.messages = async () => {
      throw new Error("BD no disponible");
    };
    await expect(w.svc.chatLead(s, T, { kind: "info", name: "Ana", phone: "", email: "ana@cliente.example", note: "", consent: true })).rejects.toThrow(/BD/);
    expect(w.store.quotas.get("2026-11-10:chat_lead") ?? 0).toBe(0);
    expect(w.leads).toHaveLength(0);
    w.store.messages = realMessages;
    expect((await w.svc.chatLead(s, T, { kind: "info", name: "Ana", phone: "", email: "ana@cliente.example", note: "", consent: true })).already).toBe(false);
    expect(w.store.quotas.get("2026-11-10:chat_lead")).toBe(1);
  });

  it("como mucho 20 mensajes del cliente por conversación", async () => {
    const s = { ...(await w.store.settings()), chatDailyLimit: 1000 };
    for (let i = 0; i < RECEPTION_LIMITS.chatTurnsMax; i++) await w.svc.chatSend(s, T, `M${i}`);
    expect((await w.svc.chatView(s, T)).turnsLeft).toBe(0);
    const before = w.store.msgs.length;
    await w.svc.chatSend(s, T, "Uno más");
    expect(w.store.msgs.length).toBe(before);
  });

  it("«Déjanos tus datos»: consentimiento, contacto y una solicitud por conversación", async () => {
    const s = await w.store.settings();
    await w.svc.chatSend(s, T, "Quiero reservar buceo para 4");
    const base = { kind: "info" as const, name: "Luis Prueba", phone: "", email: "luis@cliente.example", note: "Para el sábado", consent: true };
    await expect(w.svc.chatLead(s, T, { ...base, consent: false })).rejects.toThrow(/aceptes/);
    await expect(w.svc.chatLead(s, T, { ...base, email: "" })).rejects.toThrow(/teléfono o un correo/);
    await expect(w.svc.chatLead(s, T, { ...base, email: "no-es-correo" })).rejects.toThrow(/no es válido/);
    await expect(w.svc.chatLead(s, T, { ...base, kind: "callback" })).rejects.toThrow(/teléfono/);
    expect(await w.svc.chatLead(s, T, base)).toEqual({ leadId: 101, already: false });
    expect(w.leads[0]).toMatchObject({ name: "Luis Prueba", email: "luis@cliente.example", source: "recepcion_ia_chat" });
    expect(w.leads[0].message).toContain("Cliente: Quiero reservar buceo para 4");
    expect(await w.svc.chatLead(s, T, base)).toEqual({ leadId: 101, already: true });
    expect(w.leads).toHaveLength(1);
    expect(w.store.convs[0]).toMatchObject({ outcome: "lead_created", leadId: 101 });
    expect((await w.svc.chatView(s, T)).leadDone).toBe(true);
    const off = { ...s, leadEnabled: false };
    await expect(w.svc.chatLead(off, "d".repeat(32), base)).rejects.toThrow(/no está disponible/);
  });

  it("registro y estadísticas", async () => {
    const s = await w.store.settings();
    await w.svc.chatSend(s, T, "Hola");
    await w.svc.chatLead(s, T, { kind: "callback", name: "Eva", phone: "622000000", email: "", note: "", consent: true });
    const st = await w.svc.stats(30);
    expect(st).toMatchObject({ total: 1, chat: 1, voice: 0, aiRepliesLast24h: 1 });
    expect(st.outcomes.callback).toBe(1);
    const list = await w.svc.conversations({ days: 30, limit: 10, offset: 0, search: "eva" });
    expect(list.total).toBe(1);
    const d = await w.svc.conversation(list.rows[0].id);
    expect(d.messages).toHaveLength(2);
  });
});

// ─── Página pública del chat sobre el router de server/netPublic ──────────────

describe("página pública /recepcion/<clave>", () => {
  let server: http.Server;
  let base = "";
  let w: World;
  let licensed = true;
  const KEY = "clave-chat-000000000000000000001";

  beforeAll(async () => {
    w = world();
    await w.svc.saveSettings(input({ chatEnabled: true, transferEnabled: true, transferNumber: "+34600112233", humanHours: [{ day: 2, from: "09:00", to: "14:00" }] }), 1);
    const app = express();
    app.use(createNetPublicRouter({ receptionChat: { service: () => w.svc, licensed: async () => licensed } }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  const post = (path: string, form: Record<string, string>) =>
    fetch(`${base}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });

  it("la ruta es pública fuera de /api/trpc, con el lector de 8 KB", () => {
    expect(NET_PUBLIC_PATH.test(`/recepcion/${KEY}`)).toBe(true);
    expect(NET_PUBLIC_PATH.test("/recepciones/x")).toBe(false);
  });

  it("clave no válida, sin licencia: la misma respuesta genérica", async () => {
    expect((await fetch(`${base}/recepcion/otra-clave-que-no-vale-0000000000`)).status).toBe(404);
    licensed = false;
    const r = await fetch(`${base}/recepcion/${KEY}`);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain("no está disponible");
    licensed = true;
  });

  it("conversación completa: saludo, mensaje, respuesta de la IA y datos del cliente al CRM", async () => {
    const g = await fetch(`${base}/recepcion/${KEY}`);
    expect(g.status).toBe(200);
    expect(g.headers.get("x-frame-options")).toBe("DENY");
    const html = await g.text();
    expect(html).toContain("Hola, bienvenido a Buceo QA");
    expect(html).toContain("asistente con inteligencia artificial");
    expect(html).toContain("tel:+34600112233"); // martes 11:00: el equipo atiende
    const conv = /name="c" value="([a-f0-9]{32})"/.exec(html)![1];

    const p = await post(`/recepcion/${KEY}`, { a: "msg", c: conv, m: "¿Abrís el sábado?" });
    expect(p.status).toBe(303);
    expect(p.headers.get("location")).toBe(`/recepcion/${KEY}?c=${conv}`);
    const after = await (await fetch(`${base}${p.headers.get("location")}`)).text();
    expect(after).toContain("¿Abrís el sábado?");
    expect(after).toContain("Abrimos de 9 a 14.");

    const bad = await post(`/recepcion/${KEY}`, { a: "lead", c: conv, kind: "info", name: "Rosa", email: "rosa@cliente.example" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("aceptes");
    const ok = await post(`/recepcion/${KEY}`, { a: "lead", c: conv, kind: "info", name: "Rosa", email: "rosa@cliente.example", consent: "1" });
    expect(ok.status).toBe(303);
    expect(await (await fetch(`${base}${ok.headers.get("location")}`)).text()).toContain("Ya tenemos tu solicitud");
    expect(w.leads.at(-1)).toMatchObject({ name: "Rosa", source: "recepcion_ia_chat" });
  });

  it("identificador de conversación y cuerpo no válidos", async () => {
    expect((await post(`/recepcion/${KEY}`, { a: "msg", c: "../../x", m: "hola" })).status).toBe(400);
    const big = await fetch(`${base}/recepcion/${KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ m: "x" }) });
    expect(big.status).toBe(415);
  });
});

describe("integración en el Core", () => {
  it("licencia, menú y credencial de Vapi", () => {
    expect(TRPC_ROUTER_CAPABILITIES.receptionAi).toBe("reception-ai");
    const item = TASK_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/atencion-comercial/recepcionista");
    expect(item?.capabilities).toEqual(["reception-ai"]);
    const vapi = PROVIDERS.find((p) => p.id === "vapi");
    expect(vapi?.panel?.requires).toEqual(["voice-ai", "reception-ai"]);
  });
});
