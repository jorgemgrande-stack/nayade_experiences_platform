/**
 * Elephant Reception AI con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0056). Licencia reception-ai (sin ella y en solo
 * lectura), configuración solo para administración y registro también para ventas, conocimiento, catálogo publicado
 * de la empresa, estado de voz sin la credencial de Vapi (sin llamar a Vapi), chat público por el dominio de la empresa
 * (sin proveedor de IA configurado: respuesta fija, sin inventar nada), solicitud en el CRM y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type Co, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "reception-ai";

describe.skipIf(!URL_)("Reception AI · configuración, conocimiento, chat público y registro (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let key = "";

  const m = (proc: string, input: unknown, cookie = adA, co: Co = "a") => ess.m(co, `receptionAi.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: Co = "a") => ess.q(co, `receptionAi.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const form = (co: Co, path: string, f: Record<string, string>) =>
    ess.call(co, "POST", path, { raw: new URLSearchParams(f).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const settings = (over: Record<string, unknown> = {}) => ({
    enabled: true, assistantName: "Lucía", language: "es", tone: "cercano", greeting: null, businessSummary: "Centro de buceo QA", address: "Puerto QA 1",
    openingHours: "De lunes a sábado", humanHours: [{ day: 1, from: "09:00", to: "14:00" }], timezone: "Europe/Madrid", includeCatalog: true,
    transferEnabled: false, transferNumber: null, leadEnabled: true, callbackEnabled: true, extraRules: null, chatEnabled: true, chatDailyLimit: 50, ...over,
  });

  beforeAll(async () => {
    delete process.env.ES_AI_API_KEY;
    delete process.env.ES_AI_API_URL;
    ess = await startEssentialApp(URL_!, "reception");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad reception-ai no responde (403 de licencia) y el chat público no está disponible", async () => {
    expect(isLicenseDenied(await q("overview"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveSettings", settings()), CAP)).toBe(true);
    expect((await ess.call("a", "GET", `/recepcion/${"a".repeat(32)}`)).text).toContain("no está disponible");
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("configuración solo para administración; el registro también para ventas", async () => {
    expect(errCode(await q("overview", undefined, agA))).toBe("FORBIDDEN");
    expect(errCode(await m("saveSettings", settings(), agA))).toBe("FORBIDDEN");
    expect((await ok(q("conversations", undefined, agA))).total).toBe(0);
  });

  it("guarda la configuración, el conocimiento y lee el catálogo publicado de la empresa", async () => {
    await ess.sql("a", "INSERT INTO experiences (slug, title, basePrice, categoryId, locationId, isActive, isPublished, duration) VALUES ('qa-buceo', 'Bautismo de buceo QA', 59, 1, 1, 1, 1, '3 horas')");
    await ess.sql("a", "INSERT INTO experiences (slug, title, basePrice, categoryId, locationId, isActive, isPublished) VALUES ('qa-oculto', 'Producto oculto QA', 10, 1, 1, 1, 0)");
    expect(errCode(await m("saveSettings", settings({ transferEnabled: true, transferNumber: "abc" })))).toBe("BAD_REQUEST");
    const s = await ok(m("saveSettings", settings({ transferEnabled: true, transferNumber: "600 11 22 33" })));
    expect(s).toMatchObject({ enabled: true, assistantName: "Lucía", transferNumber: "+34600112233", chatEnabled: true });
    const k = await ok(m("addKnowledge", { kind: "faq", question: "¿Hay parking?", answer: "Sí, gratuito junto al puerto." }));
    expect(k.id).toBeGreaterThan(0);
    const o = await ok(q("overview"));
    expect(o.knowledge.map((x: any) => x.question)).toEqual(["¿Hay parking?"]);
    expect(o.catalog.map((c: any) => c.title)).toEqual(["Bautismo de buceo QA"]);
    expect(o.chatUrl).toMatch(/\/recepcion\/[A-Za-z0-9_-]{32}$/);
    key = /\/recepcion\/([A-Za-z0-9_-]{32})$/.exec(o.chatUrl)![1];
    const prompt = (await ok(q("previewPrompt", { channel: "voice" }))).prompt as string;
    expect(prompt).toContain("¿Hay parking?: Sí, gratuito junto al puerto.");
    expect(prompt).toContain("Bautismo de buceo QA (desde 59");
    expect(prompt).not.toContain("Producto oculto QA");
    // La empresa B no ve nada de A
    const ob = await ok(q("overview", undefined, adB, "b"));
    expect(ob.knowledge).toEqual([]);
    expect(ob.settings.enabled).toBe(false);
  });

  it("voz sin la credencial de Vapi de la empresa: el estado lo explica y no se sincroniza", async () => {
    const st = await ok(q("voiceStatus"));
    expect(st).toMatchObject({ hasApiKey: false, hasWebhookSecret: false, ready: false, assistantId: null });
    expect(st.toolsUrl).toMatch(/\/api\/vapi\/reception\/tools$/);
    expect(errCode(await m("syncVoice", undefined))).toBe("PRECONDITION_FAILED");
  });

  it("chat público por el dominio de la empresa: respuesta fija sin IA configurada y solicitud en el CRM", async () => {
    const g = await ess.call("a", "GET", `/recepcion/${key}`);
    expect(g.status).toBe(200);
    expect(g.text).toContain("Hola, bienvenido a");
    const conv = /name="c" value="([a-f0-9]{32})"/.exec(g.text)![1];
    expect((await form("a", `/recepcion/${key}`, { a: "msg", c: conv, m: "¿Hay parking?" })).status).toBe(303);
    const after = await ess.call("a", "GET", `/recepcion/${key}?c=${conv}`);
    expect(after.text).toContain("¿Hay parking?");
    expect(after.text).toContain("Si nos dejas tus datos");
    expect((await form("a", `/recepcion/${key}`, { a: "lead", c: conv, kind: "callback", name: "Ana QA", phone: "611 00 00 00", consent: "1" })).status).toBe(303);
    const leads = await ess.sql("a", "SELECT name, phone, source FROM leads WHERE source = 'recepcion_ia_chat'");
    expect(leads).toEqual([{ name: "Ana QA", phone: "+34611000000", source: "recepcion_ia_chat" }]);
    // La clave de A no vale en el dominio de B
    expect((await ess.call("b", "GET", `/recepcion/${key}`)).status).toBe(404);
  });

  it("registro: la conversación con su resultado; el equipo lo corrige; aislado por empresa", async () => {
    const list = await ok(q("conversations", { days: 30 }, agA));
    expect(list.total).toBe(1);
    const c = list.rows[0];
    expect(c).toMatchObject({ channel: "chat", outcome: "callback", customerName: "Ana QA" });
    expect(c.leadId).toBeGreaterThan(0);
    const d = await ok(q("conversation", { id: c.id }, agA));
    expect(d.messages.map((x: any) => x.origin)).toEqual(["customer", "fallback"]);
    await ok(m("setOutcome", { id: c.id, outcome: "resolved" }, agA));
    expect((await ok(q("stats", { days: 30 }))).outcomes.resolved).toBe(1);
    expect((await ok(q("conversations", undefined, adB, "b"))).total).toBe(0);
    expect(errCode(await q("conversation", { id: c.id }, adB, "b"))).toBe("NOT_FOUND");
  });

  it("enlace nuevo: el anterior deja de valer", async () => {
    const r = await ok(m("regenerateChatLink", undefined));
    expect(r.chatUrl).not.toContain(key);
    expect((await ess.call("a", "GET", `/recepcion/${key}`)).status).toBe(404);
  });

  it("en solo lectura se consulta pero no se cambia", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await ok(q("conversations"))).total).toBe(1);
    expect(isLicenseDenied(await m("addKnowledge", { kind: "faq", question: "X", answer: "Y" }), CAP)).toBe(true);
    expect((await ess.call("a", "GET", `/recepcion/${"a".repeat(32)}`)).text).toContain("no está disponible");
  });
});
