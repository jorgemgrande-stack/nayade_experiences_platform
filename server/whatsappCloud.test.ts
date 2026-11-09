/**
 * Elephant WhatsApp AI — pruebas puras (sin BD, sin Meta y sin IA reales: la Graph API y la IA se simulan).
 * Firma del webhook, token de verificación, idempotencia por wamid, estados de entrega, ventana de 24 h, plantillas
 * aprobadas, sugerencias y respuesta automática con horario, tope diario atómico y traspaso, sin fuga del token, 403 sin
 * licencia y solo lectura.
 */
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("./_core/tenant", async (orig) => ({ ...(await orig<object>()), isMultiTenant: () => true }));

const { signatureValid, verifyChallenge, parseWebhook } = await import("./whatsappCloud/webhook");
const { WhatsappService, HANDOFF_REPLY, WhatsappError } = await import("./whatsappCloud/service");
const { MemoryWhatsappStore } = await import("./whatsappCloud/store");
const { whatsappEventsHandler, whatsappVerifyHandler } = await import("./whatsappCloud/httpRoute");
const { testProvider } = await import("./_core/credentials/testers");
const { PROVIDERS } = await import("./_core/credentials/catalog");
const { TRPC_ROUTER_CAPABILITIES } = await import("./_core/capabilities/routeGuard");
const { TASK_NAV, routeCapabilities } = await import("../shared/adminNav");
const { DEFAULT_WHATSAPP_SETTINGS, nextStatus, templateParamCount, wantsHuman, whatsappSettingsProblem, windowOpen } = await import("../shared/whatsappCloud");

// Martes 10 de noviembre de 2026, 22:00 en Madrid (21:00 UTC)
const NOW = new Date("2026-11-10T21:00:00Z");
const TOKEN = "EAAGtoken-de-prueba-whatsapp-0123456789";
// Valores ficticios de prueba (no son claves)
const APP_SECRET = "s".repeat(32);
const VERIFY = "verificacion-de-prueba-0123456789";
const PHONE = "1098765432101";
const CREDS = { phoneNumberId: PHONE, wabaId: "2098765432102", accessToken: TOKEN, appSecret: APP_SECRET, verifyToken: VERIFY };

type Call = { url: string; method: string; headers: Record<string, string>; body?: any };
function fakeGraph(o: { fail?: { status: number; message: string }; templates?: any[] } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const res = (status: number, json: unknown) => ({ ok: status < 300, status, json: async () => json });
    if (o.fail) return res(o.fail.status, { error: { message: o.fail.message, code: o.fail.status === 401 ? 190 : 100 } });
    if (url.includes("/messages") && init.method === "POST") return res(200, { messages: [{ id: `wamid.OUT${++n}` }] });
    if (url.includes("/message_templates")) return res(200, { data: o.templates ?? [] });
    if (url.includes(`/${PHONE}?`)) return res(200, { display_phone_number: "+34 600 00 00 00", verified_name: "Empresa QA", quality_rating: "GREEN" });
    return res(200, { name: "Cuenta QA" });
  };
  return { calls, fetch };
}

function setup(o: { creds?: Record<string, string>; graph?: ReturnType<typeof fakeGraph>; llm?: (m: any[]) => Promise<string>; quota?: number; now?: Date } = {}) {
  const now = o.now ?? NOW;
  const store = new MemoryWhatsappStore(() => now.getTime());
  const graph = o.graph ?? fakeGraph();
  const used = new Map<string, number>();
  const llmCalls: any[][] = [];
  const svc = new WhatsappService({
    store,
    credentials: async () => o.creds ?? CREDS,
    fetch: graph.fetch,
    llm: async (m) => {
      llmCalls.push(m);
      return o.llm ? o.llm(m) : "Sí, tenemos parking gratuito junto al puerto.";
    },
    knowledge: async () => "# Negocio\nNombre: Empresa QA\n- ¿Hay parking?: Sí, gratuito junto al puerto.",
    companyName: () => "Empresa QA",
    quota: {
      reserve: async (day, limit) => {
        const u = used.get(day) ?? 0;
        if (u >= limit) return false;
        used.set(day, u + 1);
        return true;
      },
      release: async (day) => void used.set(day, Math.max(0, (used.get(day) ?? 0) - 1)),
    },
    webhookUrl: () => "https://empresa-a.elephantsource.es/api/whatsapp/webhook",
    now: () => now,
  });
  return { svc, store, graph, used, llmCalls };
}

const inboundPayload = (o: { wamid?: string; from?: string; text?: string; phone?: string; ts?: number } = {}) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "2098765432102",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "34600000000", phone_number_id: o.phone ?? PHONE },
            contacts: [{ wa_id: o.from ?? "34611222333", profile: { name: "Ana QA" } }],
            messages: [{ id: o.wamid ?? "wamid.IN1", from: o.from ?? "34611222333", timestamp: String(o.ts ?? Math.floor(NOW.getTime() / 1000) - 60), type: "text", text: { body: o.text ?? "¿Hay parking?" } }],
          },
        },
      ],
    },
  ],
});
const statusPayload = (wamid: string, status: string, extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE }, statuses: [{ id: wamid, status, timestamp: String(Math.floor(NOW.getTime() / 1000)), recipient_id: "34611222333", ...extra }] } }] }],
});
const sign = (raw: Buffer, secret = APP_SECRET) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("firma del webhook y token de verificación", () => {
  const raw = Buffer.from(JSON.stringify(inboundPayload()));
  it("firma válida con el App Secret de la empresa; inválida con otro secreto, otro cuerpo o sin secreto", () => {
    expect(signatureValid(raw, sign(raw), APP_SECRET)).toBe(true);
    expect(signatureValid(raw, sign(raw).toUpperCase().replace("SHA256=", "sha256="), APP_SECRET)).toBe(true);
    expect(signatureValid(raw, sign(raw, "otrosecretodeotraempresa0000000"), APP_SECRET)).toBe(false);
    expect(signatureValid(Buffer.from(raw.toString() + " "), sign(raw), APP_SECRET)).toBe(false);
    expect(signatureValid(raw, sign(raw), "")).toBe(false);
    expect(signatureValid(raw, undefined, APP_SECRET)).toBe(false);
    expect(signatureValid(raw, "sha256=zz", APP_SECRET)).toBe(false);
  });
  it("verify token: solo con el de la empresa (≥ 24 caracteres), modo subscribe y reto numérico", () => {
    const q = (o: Record<string, string> = {}) => ({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444", ...o });
    expect(verifyChallenge(q(), VERIFY)).toBe("1158201444");
    expect(verifyChallenge(q({ "hub.verify_token": "otro-token-de-otra-empresa-000" }), VERIFY)).toBeNull();
    expect(verifyChallenge(q({ "hub.mode": "unsubscribe" }), VERIFY)).toBeNull();
    expect(verifyChallenge(q({ "hub.challenge": "<script>" }), VERIFY)).toBeNull();
    expect(verifyChallenge(q({ "hub.verify_token": "corto" }), "corto")).toBeNull();
    expect(verifyChallenge(q(), "")).toBeNull();
  });
  it("solo los cambios del número de la empresa: los de otro número se descartan", () => {
    const p = parseWebhook(inboundPayload({ phone: "999999999999" }), PHONE);
    expect(p).toMatchObject({ messages: [], statuses: [], foreign: 1 });
    expect(parseWebhook(inboundPayload(), PHONE).messages).toEqual([expect.objectContaining({ wamid: "wamid.IN1", from: "34611222333", name: "Ana QA", text: "¿Hay parking?", kind: "text" })]);
  });
});

describe("webhook: idempotencia y estados de entrega", () => {
  it("el mismo mensaje repetido no se duplica ni vuelve a contar", async () => {
    const { svc, store } = setup();
    const a = await svc.handleWebhook(inboundPayload());
    expect(a).toMatchObject({ duplicates: 0, statuses: 0 });
    expect(a.inbound).toHaveLength(1);
    const b = await svc.handleWebhook(inboundPayload());
    expect(b).toMatchObject({ inbound: [], duplicates: 1 });
    expect(store.msgs).toHaveLength(1);
    expect(store.convs[0]).toMatchObject({ waId: "34611222333", customerName: "Ana QA", unreadCount: 1 });
  });
  it("estados: avanzan (enviado → entregado → leído) y nunca vuelven atrás; el fallo guarda su motivo", async () => {
    const { svc, store } = setup();
    await svc.handleWebhook(inboundPayload());
    const m = await svc.reply(1, "Hola Ana", 7);
    expect(m).toMatchObject({ status: "sent", wamid: "wamid.OUT1", origin: "agent", sentBy: 7 });
    expect((await svc.handleWebhook(statusPayload("wamid.OUT1", "read"))).statuses).toBe(1);
    expect((await svc.handleWebhook(statusPayload("wamid.OUT1", "delivered"))).statuses).toBe(0);
    expect((await store.message(m.id))!.status).toBe("read");
    const m2 = await svc.reply(1, "Otro", 7);
    await svc.handleWebhook(statusPayload(m2.wamid!, "failed", { errors: [{ code: 131047, title: "Re-engagement message" }] }));
    expect(await store.message(m2.id)).toMatchObject({ status: "failed", errorCode: "131047", errorTitle: "Re-engagement message" });
    expect(nextStatus("delivered", "sent")).toBe("delivered");
  });
});

describe("ventana de 24 h y plantillas aprobadas", () => {
  it("texto libre solo dentro de las 24 h desde el último mensaje del cliente", async () => {
    const old = Math.floor(NOW.getTime() / 1000) - 25 * 3600;
    const { svc, graph } = setup();
    await svc.handleWebhook(inboundPayload({ ts: old }));
    await expect(svc.reply(1, "Hola", 1)).rejects.toMatchObject({ code: "outside_window" });
    expect(graph.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(windowOpen(new Date(NOW.getTime() - 23 * 3600_000).toISOString(), NOW)).toBe(true);
    expect(windowOpen(null, NOW)).toBe(false);
  });
  it("fuera de la ventana, solo una plantilla APROBADA de la WABA con todas sus variables", async () => {
    const templates = [
      { name: "recordatorio_reserva", status: "APPROVED", language: "es", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, te recordamos tu reserva del {{2}}." }] },
      { name: "promo_pendiente", status: "PENDING", language: "es", category: "MARKETING", components: [{ type: "BODY", text: "Oferta" }] },
    ];
    const graph = fakeGraph({ templates });
    const { svc } = setup({ graph });
    await svc.handleWebhook(inboundPayload({ ts: Math.floor(NOW.getTime() / 1000) - 30 * 3600 }));
    expect((await svc.templates()).map((t) => t.name)).toEqual(["recordatorio_reserva"]);
    await expect(svc.sendTemplate(1, { name: "promo_pendiente", language: "es", params: [] }, 1)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.sendTemplate(1, { name: "recordatorio_reserva", language: "es", params: ["Ana"] }, 1)).rejects.toMatchObject({ code: "invalid_input" });
    const m = await svc.sendTemplate(1, { name: "recordatorio_reserva", language: "es", params: ["Ana", "sábado"] }, 1);
    expect(m).toMatchObject({ kind: "template", body: "Hola Ana, te recordamos tu reserva del sábado.", status: "sent" });
    const post = graph.calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ messaging_product: "whatsapp", to: "34611222333", type: "template", template: { name: "recordatorio_reserva", language: { code: "es" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "sábado" }] }] } });
    expect(templateParamCount("{{1}} y {{3}}")).toBe(3);
  });
});

describe("sin fuga del token de Meta", () => {
  it("siempre en Authorization; nunca en la URL, en el estado ni en los errores", async () => {
    const graph = fakeGraph({ fail: { status: 401, message: `Invalid OAuth access token ${TOKEN} access_token=${TOKEN}` } });
    const { svc } = setup({ graph });
    const st = await svc.status();
    expect(JSON.stringify(st)).not.toContain(TOKEN);
    expect(JSON.stringify(st)).not.toContain(APP_SECRET);
    expect(JSON.stringify(st)).not.toContain(VERIFY);
    const err = await svc.verify().catch((e) => e);
    expect(err).toBeInstanceOf(WhatsappError);
    expect(err.code).toBe("not_configured");
    expect(err.message).not.toContain(TOKEN);
    for (const c of graph.calls) {
      expect(c.url.startsWith("https://graph.facebook.com/v21.0/")).toBe(true);
      expect(c.url).not.toContain(TOKEN);
      expect(c.url).not.toContain("access_token");
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
    // Un envío fallido queda registrado sin el token
    const ok = setup({ graph: fakeGraph() });
    await ok.svc.handleWebhook(inboundPayload());
    const bad = setup({ graph });
    await bad.svc.handleWebhook(inboundPayload());
    await expect(bad.svc.reply(1, "Hola", 1)).rejects.toBeInstanceOf(WhatsappError);
    expect(JSON.stringify(bad.store.msgs)).not.toContain(TOKEN);
    expect(bad.store.msgs[1]).toMatchObject({ status: "failed" });
  });
  it("probador de la integración: lectura del número con el token en la cabecera", async () => {
    const graph = fakeGraph();
    const r = await testProvider("whatsapp_cloud", CREDS, graph.fetch as any);
    expect(r).toMatchObject({ ok: true, outcome: "connected" });
    expect(r.message).toContain("+34 600 00 00 00");
    expect(graph.calls.every((c) => c.method === "GET" && !c.url.includes(TOKEN) && c.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    const rej = await testProvider("whatsapp_cloud", CREDS, fakeGraph({ fail: { status: 401, message: `bad ${TOKEN}` } }).fetch as any);
    expect(rej).toMatchObject({ ok: false, outcome: "rejected" });
    expect(JSON.stringify(rej)).not.toContain(TOKEN);
    const p = PROVIDERS.find((x) => x.id === "whatsapp_cloud")!;
    expect(p.fields.filter((f) => f.secret).map((f) => f.key)).toEqual(["accessToken", "appSecret", "verifyToken"]);
    expect(p.panel.requires).toEqual(["whatsapp-ai"]);
  });
});

describe("IA: apagada por defecto, sugerencias y respuesta automática", () => {
  const auto = { ...DEFAULT_WHATSAPP_SETTINGS, aiMode: "auto" as const, autoHours: [{ day: 2 as const, from: "20:00", to: "23:59" }], autoDailyLimit: 1 };

  it("apagada por defecto: ni sugerencias ni respuestas automáticas, sin llamar a la IA", async () => {
    const { svc, llmCalls, graph } = setup();
    expect((await svc.settings()).aiMode).toBe("off");
    const r = await svc.handleWebhook(inboundPayload());
    expect(await svc.autoReply(r.inbound[0].conversationId, r.inbound[0].messageId)).toBe("off");
    await expect(svc.suggest(1, 1)).rejects.toMatchObject({ code: "not_configured" });
    expect(llmCalls).toHaveLength(0);
    expect(graph.calls).toHaveLength(0);
  });

  it("sugerencia con la base de conocimiento de la empresa: no se envía, queda registrada y el agente la envía revisada", async () => {
    const { svc, store, llmCalls } = setup();
    await svc.saveSettings({ ...DEFAULT_WHATSAPP_SETTINGS, aiMode: "suggest" }, 1);
    await svc.handleWebhook(inboundPayload());
    const s = await svc.suggest(1, 5);
    expect(s).toEqual({ reply: "Sí, tenemos parking gratuito junto al puerto.", handoff: false });
    expect(llmCalls[0][0].content).toContain("¿Hay parking?: Sí, gratuito junto al puerto.");
    expect(llmCalls[0].at(-1)).toEqual({ role: "user", content: "¿Hay parking?" });
    expect(store.msgs.filter((m) => m.direction === "out")).toHaveLength(0);
    expect(store.logs).toEqual([expect.objectContaining({ mode: "suggest", outcome: "suggested", actor: 5 })]);
    const m = await svc.reply(1, s.reply, 5, true);
    expect(m.origin).toBe("ai_suggested");
  });

  it("automática: en su horario y con tope diario atómico; al agotarlo pasa a una persona", async () => {
    const { svc, store, used } = setup();
    await svc.saveSettings(auto, 1);
    const a = await svc.handleWebhook(inboundPayload({ wamid: "wamid.A", from: "34611000001" }));
    expect(await svc.autoReply(a.inbound[0].conversationId, a.inbound[0].messageId)).toBe("sent");
    expect(store.msgs.find((m) => m.origin === "ai_auto")).toMatchObject({ body: "Sí, tenemos parking gratuito junto al puerto.", status: "sent" });
    const b = await svc.handleWebhook(inboundPayload({ wamid: "wamid.B", from: "34611000002" }));
    expect(await svc.autoReply(b.inbound[0].conversationId, b.inbound[0].messageId)).toBe("skipped_quota");
    expect(used.get("2026-11-10")).toBe(1);
    expect((await store.conversation(b.inbound[0].conversationId))!.needsHuman).toBe(true);
    expect(store.logs.map((l) => l.outcome)).toEqual(["sent", "skipped_quota"]);
  });

  it("cupo atómico: dos mensajes a la vez con tope 1 → una sola respuesta", async () => {
    const { svc, store } = setup();
    await svc.saveSettings(auto, 1);
    const a = await svc.handleWebhook(inboundPayload({ wamid: "wamid.A", from: "34611000001" }));
    const b = await svc.handleWebhook(inboundPayload({ wamid: "wamid.B", from: "34611000002" }));
    const r = await Promise.all([svc.autoReply(a.inbound[0].conversationId, a.inbound[0].messageId), svc.autoReply(b.inbound[0].conversationId, b.inbound[0].messageId)]);
    expect(r.sort()).toEqual(["sent", "skipped_quota"]);
    expect(store.msgs.filter((m) => m.origin === "ai_auto")).toHaveLength(1);
  });

  it("fuera de su horario no responde; si la IA falla, el cupo vuelve", async () => {
    const off = setup({ now: new Date("2026-11-10T09:00:00Z") });
    await off.svc.saveSettings(auto, 1);
    const r = await off.svc.handleWebhook(inboundPayload({ ts: Math.floor(Date.parse("2026-11-10T08:59:00Z") / 1000) }));
    expect(await off.svc.autoReply(r.inbound[0].conversationId, r.inbound[0].messageId)).toBe("skipped_hours");
    expect(off.llmCalls).toHaveLength(0);
    const fail = setup({ llm: async () => Promise.reject(new Error("cuota de IA agotada")) });
    await fail.svc.saveSettings(auto, 1);
    const f = await fail.svc.handleWebhook(inboundPayload());
    expect(await fail.svc.autoReply(f.inbound[0].conversationId, f.inbound[0].messageId)).toBe("error");
    expect(fail.used.get("2026-11-10")).toBe(0);
  });

  it("traspaso a una persona: por palabra clave, por decisión de la IA y después la IA no vuelve a responder", async () => {
    const { svc, store, llmCalls } = setup();
    await svc.saveSettings({ ...auto, autoDailyLimit: 10 }, 1);
    const a = await svc.handleWebhook(inboundPayload({ wamid: "wamid.K", text: "Quiero hablar con una PERSONA, por favor" }));
    expect(await svc.autoReply(a.inbound[0].conversationId, a.inbound[0].messageId)).toBe("handoff");
    expect(llmCalls).toHaveLength(0);
    expect(store.msgs.find((m) => m.origin === "ai_auto")!.body).toBe(HANDOFF_REPLY);
    const again = await svc.handleWebhook(inboundPayload({ wamid: "wamid.K2", text: "¿Hola?" }));
    expect(await svc.autoReply(again.inbound[0].conversationId, again.inbound[0].messageId)).toBe("needs_human");
    const ia = setup({ llm: async () => "[PERSONA]" });
    await ia.svc.saveSettings({ ...auto, autoDailyLimit: 10 }, 1);
    const b = await ia.svc.handleWebhook(inboundPayload({ text: "¿Hacéis bodas?" }));
    expect(await ia.svc.autoReply(b.inbound[0].conversationId, b.inbound[0].messageId)).toBe("handoff");
    expect(ia.used.get("2026-11-10")).toBe(0);
    expect(wantsHuman("hablar con alguien ya", "hablar con alguien")).toBe(true);
    expect(wantsHuman("personalizado", "persona")).toBe(false);
  });

  it("configuración: el modo automático exige horario y un tope válido", () => {
    expect(whatsappSettingsProblem({ ...auto, autoHours: [] })).toMatch(/horario/);
    expect(whatsappSettingsProblem({ ...auto, autoDailyLimit: 0 })).toMatch(/máximo/);
    expect(whatsappSettingsProblem(auto)).toBeNull();
  });
});

describe("rutas públicas del webhook: licencia y firma", () => {
  function res() {
    const r: any = { statusCode: 0, body: undefined as unknown };
    r.status = (c: number) => ((r.statusCode = c), r);
    r.type = () => r;
    r.send = (b: unknown) => ((r.body = b), r);
    r.json = (b: unknown) => ((r.body = b), r);
    return r;
  }
  it("GET: reto solo con el token de la empresa y licencia activa (403 sin licencia)", async () => {
    const q = { "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "42" };
    const ok = res();
    await whatsappVerifyHandler({ credentials: async () => CREDS, licensed: async () => true })({ query: q } as any, ok);
    expect([ok.statusCode, ok.body]).toEqual([200, "42"]);
    const noLic = res();
    await whatsappVerifyHandler({ credentials: async () => CREDS, licensed: async () => false })({ query: q } as any, noLic);
    expect(noLic.statusCode).toBe(403);
  });
  it("POST: 401 con firma de otra empresa; sin licencia 200 sin guardar; con licencia guarda y responde después", async () => {
    const { svc, store } = setup();
    const raw = Buffer.from(JSON.stringify(inboundPayload()));
    const deps = (licensed: boolean, deferred: Array<() => Promise<unknown>>) => ({ credentials: async () => CREDS, licensed: async () => licensed, service: () => svc, defer: (fn: () => Promise<unknown>) => void deferred.push(fn) });
    const forged = res();
    await whatsappEventsHandler(deps(true, []))({ body: raw, headers: { "x-hub-signature-256": sign(raw, "secretodeotraempresa000000000000") } } as any, forged);
    expect(forged.statusCode).toBe(401);
    const noLic = res();
    await whatsappEventsHandler(deps(false, []))({ body: raw, headers: { "x-hub-signature-256": sign(raw) } } as any, noLic);
    expect([noLic.statusCode, noLic.body]).toEqual([200, { ok: true, ignored: "not_licensed" }]);
    expect(store.msgs).toHaveLength(0);
    const later: Array<() => Promise<unknown>> = [];
    const ok = res();
    await whatsappEventsHandler(deps(true, later))({ body: raw, headers: { "x-hub-signature-256": sign(raw) } } as any, ok);
    expect(ok.body).toMatchObject({ ok: true, received: 1, duplicates: 0 });
    expect(later).toHaveLength(1);
    await later[0]();
    expect(store.msgs).toHaveLength(1);
  });
});

describe("licencia whatsapp-ai en el panel", () => {
  it("API, menú y rutas con la capacidad whatsapp-ai (sin ella, 403; en solo lectura, solo consultas)", () => {
    expect(TRPC_ROUTER_CAPABILITIES.whatsappCloud).toBe("whatsapp-ai");
    const item = TASK_NAV.flatMap((s) => s.items).find((i) => i.key === "x-whatsapp")!;
    expect(item.capabilities).toEqual(["whatsapp-ai"]);
    expect(item.children?.map((c) => c.href)).toEqual(["/admin/atencion-comercial/whatsapp-business", "/admin/atencion-comercial/whatsapp"]);
    expect(routeCapabilities("/admin/atencion-comercial/whatsapp-business")).toEqual(["whatsapp-ai"]);
  });
});

describe("migración de WhatsApp AI", () => {
  it("es la 0061 (con su reversión), solo CREATE TABLE, y los avisos la nombran así", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../db/migrations");
    const up = fs.readFileSync(path.join(dir, "0061_connect_whatsapp_ai.sql"), "utf8");
    expect(fs.existsSync(path.join(dir, "0061_connect_whatsapp_ai.down.sql"))).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.includes("whatsapp") && !f.startsWith("0061_"))).toBe(false);
    expect(up.match(/^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/gim)?.every((s) => /CREATE/i.test(s))).toBe(true);
    const { WhatsappNotInstalled } = await import("./whatsappCloud/store");
    expect(new WhatsappNotInstalled().message).toContain("0061_connect_whatsapp_ai");
  });
});

const AUTO_ALL = { ...DEFAULT_WHATSAPP_SETTINGS, aiMode: "auto" as const, autoHours: [{ day: 2 as const, from: "00:00", to: "23:59" }], autoDailyLimit: 100 };
const lastIn = async (svc: InstanceType<typeof WhatsappService>, o: Parameters<typeof inboundPayload>[0]) => (await svc.handleWebhook(inboundPayload(o))).inbound.at(-1)!;

describe("revisión: devolver la conversación a la IA", () => {
  it("setNeedsHuman(false) reinicia el contador de respuestas automáticas y la IA vuelve a responder", async () => {
    const { svc, store } = setup();
    await svc.saveSettings(AUTO_ALL, 1);
    for (let i = 0; i < 5; i++) {
      const m = await lastIn(svc, { wamid: `wamid.R${i}`, text: `pregunta ${i}` });
      expect(await svc.autoReply(m.conversationId, m.messageId)).toBe("sent");
    }
    const sixth = await lastIn(svc, { wamid: "wamid.R5", text: "otra" });
    expect(await svc.autoReply(sixth.conversationId, sixth.messageId)).toBe("handoff");
    expect(await store.conversation(1)).toMatchObject({ needsHuman: true, aiAutoReplies: 5 });
    await svc.setNeedsHuman(1, false);
    expect(await store.conversation(1)).toMatchObject({ needsHuman: false, aiAutoReplies: 0 });
    const again = await lastIn(svc, { wamid: "wamid.R6", text: "¿y el parking?" });
    expect(await svc.autoReply(again.conversationId, again.messageId)).toBe("sent");
  });
});

describe("revisión: palabras de traspaso por defecto", () => {
  it("no saltan con «persona» suelta (precio por persona, 4 personas) y sí con las frases de traspaso", () => {
    const k = DEFAULT_WHATSAPP_SETTINGS.handoffKeywords;
    expect(k).toBe("hablar con una persona, persona real, humano, agente, reclamación, queja");
    for (const t of ["¿Cuánto cuesta por persona?", "Somos 4 personas el sábado", "¿Una persona sola puede ir?"]) expect(wantsHuman(t, k), t).toBe(false);
    for (const t of ["Quiero hablar con una persona", "¿Eres una persona real?", "Pásame con un humano", "Quiero poner una reclamación", "Tengo una QUEJA"]) expect(wantsHuman(t, k), t).toBe(true);
  });
});

describe("revisión: respuesta automática diferida en la empresa del webhook", () => {
  it("fija la empresa al recibir y ejecuta con withTenantDb(empresa, tarea) después de responder", async () => {
    const { tenantDeferral } = await import("./whatsappCloud/httpRoute");
    const ran: string[] = [];
    let scheduled: (() => void) | null = null;
    let current = "empresa-a";
    const defer = tenantDeferral({ tenantId: () => current, run: async (t, fn) => (ran.push(t), fn()), schedule: (cb) => void (scheduled = cb) });
    let done = false;
    defer(async () => void (done = true));
    current = "empresa-b"; // el contexto cambia después: la tarea sigue siendo de A
    expect(done).toBe(false);
    scheduled!();
    await new Promise((r) => setImmediate(r));
    expect(ran).toEqual(["empresa-a"]);
    expect(done).toBe(true);
  });
});

describe("revisión: reacciones, avisos y tipos no admitidos", () => {
  const withMessages = (messages: any[]) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE }, contacts: [{ wa_id: "34611222333", profile: { name: "Ana QA" } }], messages } }] }],
  });
  const ts = String(Math.floor(NOW.getTime() / 1000) - 30);
  it("las reacciones no se guardan; avisos y no admitidos se guardan sin no leídos, sin ventana y sin IA", async () => {
    const { svc, store } = setup();
    await svc.saveSettings(AUTO_ALL, 1);
    const r = await svc.handleWebhook(
      withMessages([
        { id: "wamid.RX", from: "34611222333", timestamp: ts, type: "reaction", reaction: { message_id: "wamid.OUT1", emoji: "👍" } },
        { id: "wamid.SY", from: "34611222333", timestamp: ts, type: "system", system: { body: "El cliente ha cambiado de número" } },
        { id: "wamid.UN", from: "34611222333", timestamp: ts, type: "unsupported" },
      ]),
    );
    expect(r.inbound).toEqual([]);
    expect(store.msgs.map((m) => [m.wamid, m.kind])).toEqual([["wamid.SY", "system"], ["wamid.UN", "unsupported"]]);
    expect(store.convs[0]).toMatchObject({ unreadCount: 0, lastInboundAt: null });
    expect(await svc.autoReply(1, 2)).toBe("ignored");
    expect(store.msgs.some((m) => m.direction === "out")).toBe(false);
  });
});

describe("revisión: para recibir basta el número y la clave secreta de la app", () => {
  it("sin clave de acceso ni WABA se reciben mensajes; responder sí las exige", async () => {
    const { svc, store, graph } = setup({ creds: { phoneNumberId: PHONE, appSecret: APP_SECRET, verifyToken: VERIFY } });
    const st = await svc.status();
    expect(st).toMatchObject({ ready: false, webhookReady: true, phoneNumberId: PHONE });
    const r = await svc.handleWebhook(inboundPayload());
    expect(r.inbound).toHaveLength(1);
    expect(store.msgs).toHaveLength(1);
    await expect(svc.reply(1, "Hola", 1)).rejects.toMatchObject({ code: "not_configured" });
    expect(graph.calls).toHaveLength(0);
    // Sin App Secret no hay webhook
    expect((await setup({ creds: { phoneNumberId: PHONE, verifyToken: VERIFY } }).svc.status()).webhookReady).toBe(false);
  });
});

describe("revisión: el estado tras el envío no pisa uno más avanzado", () => {
  it("si «entregado» o «leído» llega antes de guardar el envío, se queda; el wamid sí se guarda", async () => {
    const base = fakeGraph();
    let store: InstanceType<typeof MemoryWhatsappStore> | null = null;
    const graph = {
      calls: base.calls,
      fetch: async (url: string, init: any) => {
        const r = await base.fetch(url, init);
        // Mientras Meta responde, su webhook ya marcó el mensaje como leído
        if (init.method === "POST") await store!.updateMessageStatus(store!.msgs.at(-1)!.id, { status: "read", at: NOW.toISOString() });
        return r;
      },
    };
    const k = setup({ graph: graph as any });
    store = k.store;
    await k.svc.handleWebhook(inboundPayload());
    const m = await k.svc.reply(1, "Hola", 1);
    expect(m).toMatchObject({ status: "read", wamid: "wamid.OUT1" });
    expect(await k.store.updateMessageStatus(m.id, { status: "delivered", at: null })).toBe(false);
    expect(await k.store.updateMessageStatus(m.id, { status: "failed", at: null, errorTitle: "x" })).toBe(false);
    expect((await k.store.message(m.id))!.status).toBe("read");
  });
});

describe("revisión: base de conocimiento editable con whatsapp-ai", () => {
  it("el router de WhatsApp expone la base de conocimiento (la de Reception AI) bajo su propia licencia", async () => {
    const { whatsappCloudRouter } = await import("./whatsappCloud/router");
    const procs = Object.keys((whatsappCloudRouter as any)._def.procedures);
    for (const p of ["knowledge", "addKnowledge", "updateKnowledge", "archiveKnowledge"]) expect(procs, p).toContain(p);
    const page = (await import("node:fs")).readFileSync(new URL("../client/src/pages/admin/commercial/WhatsAppCloud.tsx", import.meta.url), "utf8");
    expect(page).toContain("trpc.whatsappCloud.addKnowledge");
    expect(page).toContain("compartida con la Recepcionista IA");
  });
});

describe("revisión: solo se escribe desde el número de la conversación", () => {
  it("si la empresa cambió de número, las conversaciones del anterior no se responden ni con plantilla ni con la IA", async () => {
    const templates = [{ name: "seguimiento", status: "APPROVED", language: "es", category: "UTILITY", components: [{ type: "BODY", text: "Hola" }] }];
    const creds: Record<string, string> = { ...CREDS };
    const graph = fakeGraph({ templates });
    const { svc, store } = setup({ creds, graph });
    await svc.saveSettings(AUTO_ALL, 1);
    const m = await lastIn(svc, {});
    creds.phoneNumberId = "1098765432199"; // número nuevo
    await expect(svc.reply(1, "Hola", 1)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.sendTemplate(1, { name: "seguimiento", language: "es", params: [] }, 1)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await svc.autoReply(m.conversationId, m.messageId)).toBe("other_number");
    expect(graph.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(store.msgs.filter((x) => x.direction === "out")).toHaveLength(0);
  });
});

describe("revisión: reserva atómica por conversación", () => {
  it("con 4 respuestas ya enviadas, dos mensajes a la vez de la misma conversación: una respuesta y un traspaso", async () => {
    const { svc, store } = setup();
    await svc.saveSettings(AUTO_ALL, 1);
    const a = await lastIn(svc, { wamid: "wamid.C1", text: "uno" });
    store.convs[0].aiAutoReplies = 4;
    const b = await lastIn(svc, { wamid: "wamid.C2", text: "dos" });
    const r = await Promise.all([svc.autoReply(a.conversationId, a.messageId), svc.autoReply(b.conversationId, b.messageId)]);
    expect(r.sort()).toEqual(["handoff", "sent"]);
    expect(store.msgs.filter((m) => m.origin === "ai_auto" && m.body !== HANDOFF_REPLY)).toHaveLength(1);
    expect(await store.conversation(1)).toMatchObject({ aiAutoReplies: 5, needsHuman: true });
  });
  it("si la IA falla, la reserva de la conversación vuelve; fuera de horario ni siquiera la palabra clave hace nada", async () => {
    const fail = setup({ llm: async () => Promise.reject(new Error("sin IA")) });
    await fail.svc.saveSettings(AUTO_ALL, 1);
    const m = await lastIn(fail.svc, {});
    expect(await fail.svc.autoReply(m.conversationId, m.messageId)).toBe("error");
    expect((await fail.store.conversation(1))!.aiAutoReplies).toBe(0);
    const off = setup({ now: new Date("2026-11-10T09:00:00Z") });
    await off.svc.saveSettings({ ...AUTO_ALL, autoHours: [{ day: 2, from: "20:00", to: "23:59" }] }, 1);
    const k = await lastIn(off.svc, { text: "Quiero hablar con una persona", ts: Math.floor(Date.parse("2026-11-10T08:59:00Z") / 1000) });
    expect(await off.svc.autoReply(k.conversationId, k.messageId)).toBe("skipped_hours");
    expect((await off.store.conversation(1))!.needsHuman).toBe(false);
  });
});

describe("revisión: el registro de errores del webhook no lleva el mensaje", () => {
  it("webhook_error solo con el nombre y el código del error", async () => {
    const { errorInfo } = await import("./whatsappCloud/httpRoute");
    const raw = Buffer.from(JSON.stringify(inboundPayload()));
    const secretLike = `Duplicate entry '34611222333' token=${TOKEN}`;
    const err = Object.assign(new Error(secretLike), { code: "ER_DUP_ENTRY" });
    const svc = { handleWebhook: async () => Promise.reject(err) } as any;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r: any = { status: (c: number) => ((r.code = c), r), json: () => r };
    await whatsappEventsHandler({ credentials: async () => CREDS, licensed: async () => true, service: () => svc })({ body: raw, headers: { "x-hub-signature-256": sign(raw) } } as any, r);
    expect(r.code).toBe(500);
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    warn.mockRestore();
    expect(logged).toContain('"event":"webhook_error"');
    expect(logged).toContain('"code":"ER_DUP_ENTRY"');
    expect(logged).not.toContain("34611222333");
    expect(logged).not.toContain(TOKEN);
    expect(errorInfo(err)).toEqual({ error: "Error", code: "ER_DUP_ENTRY" });
  });
});

describe("revisión: una respuesta automática por conversación y lote", () => {
  it("si llegan varios mensajes del mismo cliente en un webhook, la IA responde solo al último", async () => {
    const { svc, store, llmCalls } = setup();
    await svc.saveSettings(AUTO_ALL, 1);
    const ts = String(Math.floor(NOW.getTime() / 1000) - 10);
    const batch = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE }, contacts: [{ wa_id: "34611222333", profile: { name: "Ana" } }, { wa_id: "34622000000", profile: { name: "Luis" } }], messages: [
        { id: "wamid.L1", from: "34611222333", timestamp: ts, type: "text", text: { body: "Hola" } },
        { id: "wamid.L2", from: "34611222333", timestamp: ts, type: "text", text: { body: "¿Hay parking?" } },
        { id: "wamid.L3", from: "34622000000", timestamp: ts, type: "text", text: { body: "¿Abrís hoy?" } },
      ] } }] }],
    };
    const raw = Buffer.from(JSON.stringify(batch));
    const later: Array<() => Promise<unknown>> = [];
    const r: any = { status: () => r, json: () => r };
    await whatsappEventsHandler({ credentials: async () => CREDS, licensed: async () => true, service: () => svc, defer: (fn) => void later.push(fn) })({ body: raw, headers: { "x-hub-signature-256": sign(raw) } } as any, r);
    await later[0]();
    expect(llmCalls).toHaveLength(2);
    expect(llmCalls[0].at(-1)).toEqual({ role: "user", content: "¿Hay parking?" });
    expect(store.msgs.filter((m) => m.origin === "ai_auto")).toHaveLength(2);
  });
});

describe("revisión: plantillas con variables fuera del cuerpo", () => {
  it("se descartan las de cabecera multimedia o con variables y las de botones con variables o código", async () => {
    const body = { type: "BODY", text: "Hola {{1}}" };
    const templates = [
      { name: "solo_cuerpo", status: "APPROVED", language: "es", components: [{ type: "HEADER", format: "TEXT", text: "Aviso" }, body, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }, { type: "URL", text: "Ver", url: "https://ejemplo.es/reservas" }] }] },
      { name: "cabecera_imagen", status: "APPROVED", language: "es", components: [{ type: "HEADER", format: "IMAGE" }, body] },
      { name: "cabecera_variable", status: "APPROVED", language: "es", components: [{ type: "HEADER", format: "TEXT", text: "Hola {{1}}" }, body] },
      { name: "boton_url_variable", status: "APPROVED", language: "es", components: [body, { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://ejemplo.es/r/{{1}}" }] }] },
      { name: "codigo", status: "APPROVED", language: "es", components: [body, { type: "BUTTONS", buttons: [{ type: "OTP", text: "Copiar" }] }] },
    ];
    const { svc } = setup({ graph: fakeGraph({ templates }) });
    expect((await svc.templates()).map((t) => t.name)).toEqual(["solo_cuerpo"]);
  });
});

describe("revisión: fechas del panel en la zona horaria de la empresa", () => {
  it("formatInZone usa la zona de la empresa y, si no vale, Europe/Madrid", async () => {
    const { formatInZone } = await import("../shared/whatsappCloud");
    expect(formatInZone("2026-11-10T21:00:00Z", "Europe/Madrid")).toBe("10/11/26, 22:00");
    expect(formatInZone("2026-11-10T21:00:00Z", "Atlantic/Canary")).toBe("10/11/26, 21:00");
    expect(formatInZone("2026-11-10T21:00:00Z", "Zona/Inventada")).toBe("10/11/26, 22:00");
    expect(formatInZone(null, "Europe/Madrid")).toBe("—");
    const page = (await import("node:fs")).readFileSync(new URL("../client/src/pages/admin/commercial/WhatsAppCloud.tsx", import.meta.url), "utf8");
    expect(page).toContain("formatInZone(iso, tz)");
    expect(page).not.toContain('timeZone: "Europe/Madrid"');
  });
});
