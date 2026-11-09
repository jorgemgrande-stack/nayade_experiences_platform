/**
 * Elephant WhatsApp AI con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0062). Licencia whatsapp-ai (sin ella, 403; en solo
 * lectura, solo consultas), credencial `whatsapp_cloud` de cada empresa en su bóveda, webhook público por el dominio de
 * cada empresa (token de verificación, firma con su App Secret, idempotencia por wamid y estados de entrega), bandeja
 * con la ventana de 24 h, IA sin proveedor configurado (no inventa nada: registra el fallo y el cupo vuelve) y
 * aislamiento entre empresas. La Graph API de Meta se simula: ninguna llamada sale a la red.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type Co, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "whatsapp-ai";
const PATH = "/api/whatsapp/webhook";

const CREDS: Record<Co, { phoneNumberId: string; wabaId: string; accessToken: string; appSecret: string; verifyToken: string }> = {
  a: { phoneNumberId: "1110000000001", wabaId: "2110000000001", accessToken: "EAAG-token-de-prueba-empresa-a-0001", appSecret: "secretoappempresaa0000000000000001", verifyToken: "verificacion-empresa-a-000000000001" },
  b: { phoneNumberId: "1110000000002", wabaId: "2110000000002", accessToken: "EAAG-token-de-prueba-empresa-b-0002", appSecret: "secretoappempresab0000000000000002", verifyToken: "verificacion-empresa-b-000000000002" },
};

describe.skipIf(!URL_)("WhatsApp AI · conexión, webhook, bandeja e IA (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const graphCalls: Array<{ url: string; method: string; auth: string | null; body: any }> = [];
  let prevFetch: typeof fetch;
  let out = 0;

  const m = (proc: string, input: unknown, cookie = adA, co: Co = "a") => ess.m(co, `whatsappCloud.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: Co = "a") => ess.q(co, `whatsappCloud.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const payload = (phone: string, o: { wamid?: string; from?: string; text?: string; ts?: number; statuses?: any[] } = {}) =>
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: phone },
                ...(o.statuses
                  ? { statuses: o.statuses }
                  : {
                      contacts: [{ wa_id: o.from ?? "34611222333", profile: { name: "Ana QA" } }],
                      messages: [{ id: o.wamid ?? "wamid.QA1", from: o.from ?? "34611222333", timestamp: String(o.ts ?? Math.floor(Date.now() / 1000)), type: "text", text: { body: o.text ?? "¿Hay parking?" } }],
                    }),
              },
            },
          ],
        },
      ],
    });
  const sign = (raw: string, secret: string) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const post = (co: Co, raw: string, secret: string) => ess.call(co, "POST", PATH, { raw, headers: { "x-hub-signature-256": sign(raw, secret) } });

  beforeAll(async () => {
    delete process.env.ES_AI_API_KEY;
    delete process.env.ES_AI_API_URL;
    ess = await startEssentialApp(URL_!, "whatsapp");
    // Meta simulada (la del kit bloquea cualquier otra salida de red)
    prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://graph.facebook.com/")) return prevFetch(input as any, init);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      graphCalls.push({ url, method: String(init?.method ?? "GET"), auth: headers.Authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null });
      const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.includes("/messages")) return j(200, { messages: [{ id: `wamid.OUT${++out}` }] });
      if (url.includes("/message_templates")) return j(200, { data: [{ name: "seguimiento", status: "APPROVED", language: "es", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, ¿seguimos con tu reserva?" }] }] });
      if (url.includes(`/${CREDS.a.phoneNumberId}?`)) return j(200, { display_phone_number: "+34 600 00 00 01", verified_name: "Empresa A QA", quality_rating: "GREEN" });
      return j(200, { name: "Cuenta QA" });
    }) as typeof fetch;
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    if (prevFetch) globalThis.fetch = prevFetch;
    await ess?.close();
  });

  it("sin la capacidad whatsapp-ai: 403 de licencia y el webhook no verifica ni guarda", async () => {
    expect(isLicenseDenied(await q("status"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveSettings", { aiMode: "off", autoHours: [], autoDailyLimit: 10, timezone: "Europe/Madrid" }), CAP)).toBe(true);
    for (const co of ["a", "b"] as Co[]) {
      await ess.setCapability(co, CAP, "active");
      await ok(ess.m(co, "integrations.save", { provider: "whatsapp_cloud", values: CREDS[co] }, co === "a" ? adA : adB));
      await ess.setCapability(co, CAP, null);
    }
    expect((await ess.call("a", "GET", `${PATH}?hub.mode=subscribe&hub.verify_token=${CREDS.a.verifyToken}&hub.challenge=123`)).status).toBe(403);
    const r = await post("a", payload(CREDS.a.phoneNumberId), CREDS.a.appSecret);
    expect(r.json).toEqual({ ok: true, ignored: "not_licensed" });
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM whatsapp_messages")).toEqual([{ n: 0 }]);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("estado y verificación contra Meta (solo lectura) sin devolver credenciales; token solo en Authorization", async () => {
    const st = await ok(q("status", undefined, agA));
    expect(st).toMatchObject({ ready: true, webhookReady: true, phoneNumberId: CREDS.a.phoneNumberId });
    expect(st.webhookUrl).toMatch(/\/api\/whatsapp\/webhook$/);
    expect(JSON.stringify(st)).not.toContain(CREDS.a.accessToken);
    expect(errCode(await m("verify", undefined, agA))).toBe("FORBIDDEN");
    const v = await ok(m("verify", undefined));
    expect(v).toMatchObject({ displayPhoneNumber: "+34 600 00 00 01", verifiedName: "Empresa A QA", accountName: "Cuenta QA" });
    for (const c of graphCalls) {
      expect(c.url).not.toContain(CREDS.a.accessToken);
      expect(c.auth).toBe(`Bearer ${CREDS.a.accessToken}`);
    }
  });

  it("webhook por el dominio de cada empresa: su token, su firma y solo su número", async () => {
    expect((await ess.call("a", "GET", `${PATH}?hub.mode=subscribe&hub.verify_token=${CREDS.a.verifyToken}&hub.challenge=987654`)).text).toBe("987654");
    expect((await ess.call("a", "GET", `${PATH}?hub.mode=subscribe&hub.verify_token=${CREDS.b.verifyToken}&hub.challenge=987654`)).status).toBe(403);
    const raw = payload(CREDS.a.phoneNumberId);
    // Firma de A en el dominio de B: rechazada
    expect((await post("b", raw, CREDS.a.appSecret)).status).toBe(401);
    // Firmado con el secreto de B pero de otro número: se descarta
    expect((await post("b", raw, CREDS.b.appSecret)).json).toMatchObject({ ok: true, received: 0 });
    const r = await post("a", raw, CREDS.a.appSecret);
    expect(r.json).toMatchObject({ ok: true, received: 1, duplicates: 0 });
    // Reintento de Meta: idempotente
    expect((await post("a", raw, CREDS.a.appSecret)).json).toMatchObject({ ok: true, received: 0, duplicates: 1 });
    expect(await ess.sql("a", "SELECT wamid, direction, body FROM whatsapp_messages")).toEqual([{ wamid: "wamid.QA1", direction: "in", body: "¿Hay parking?" }]);
    expect(await ess.sql("b", "SELECT COUNT(*) AS n FROM whatsapp_messages")).toEqual([{ n: 0 }]);
  });

  it("bandeja (también ventas): responder en la ventana de 24 h, estados de entrega y aislamiento", async () => {
    const list = await ok(q("conversations", undefined, agA));
    expect(list.total).toBe(1);
    const c = list.rows[0];
    expect(c).toMatchObject({ waId: "34611222333", customerName: "Ana QA", unreadCount: 1, windowOpen: true });
    const sent = await ok(m("reply", { id: c.id, text: "Sí, gratuito junto al puerto." }, agA));
    expect(sent).toMatchObject({ status: "sent", origin: "agent", wamid: expect.stringMatching(/^wamid\.OUT/) });
    const send = graphCalls.find((x) => x.method === "POST")!;
    expect(send.url).toBe(`https://graph.facebook.com/v21.0/${CREDS.a.phoneNumberId}/messages`);
    expect(send.body).toMatchObject({ messaging_product: "whatsapp", to: "34611222333", type: "text", text: { body: "Sí, gratuito junto al puerto." } });
    const st = payload(CREDS.a.phoneNumberId, { statuses: [{ id: sent.wamid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "34611222333" }] });
    expect((await post("a", st, CREDS.a.appSecret)).json).toMatchObject({ statuses: 1 });
    // El estado solo avanza (en SQL): «enviado» repetido después de «entregado» no lo hace retroceder
    const back = payload(CREDS.a.phoneNumberId, { statuses: [{ id: sent.wamid, status: "sent", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "34611222333" }] });
    expect((await post("a", back, CREDS.a.appSecret)).json).toMatchObject({ statuses: 0 });
    const d = await ok(q("conversation", { id: c.id }, agA));
    expect(d.messages.map((x: any) => [x.direction, x.status])).toEqual([["in", "received"], ["out", "delivered"]]);
    // B no ve nada de A
    expect((await ok(q("conversations", undefined, adB, "b"))).total).toBe(0);
    expect(errCode(await q("conversation", { id: c.id }, adB, "b"))).toBe("NOT_FOUND");
  });

  it("fuera de la ventana de 24 h solo plantillas aprobadas", async () => {
    const [c] = await ess.sql("a", "SELECT id FROM whatsapp_conversations");
    await ess.sql("a", "UPDATE whatsapp_conversations SET last_inbound_at = NOW(3) - INTERVAL 25 HOUR WHERE id = ?", [c.id]);
    expect(errCode(await m("reply", { id: c.id, text: "Hola" }, agA))).toBe("PRECONDITION_FAILED");
    expect((await ok(q("templates", undefined, agA))).map((t: any) => t.name)).toEqual(["seguimiento"]);
    expect(errCode(await m("sendTemplate", { id: c.id, name: "seguimiento", language: "es", params: [] }, agA))).toBe("BAD_REQUEST");
    const t = await ok(m("sendTemplate", { id: c.id, name: "seguimiento", language: "es", params: ["Ana"] }, agA));
    expect(t).toMatchObject({ kind: "template", body: "Hola Ana, ¿seguimos con tu reserva?", status: "sent" });
  });

  it("IA apagada por defecto; sin proveedor de IA no inventa: registra el fallo y el cupo diario vuelve", async () => {
    expect((await ok(q("settings"))).aiMode).toBe("off");
    const [c] = await ess.sql("a", "SELECT id FROM whatsapp_conversations");
    expect(errCode(await m("suggest", { id: c.id }, agA))).toBe("PRECONDITION_FAILED");
    expect(errCode(await m("saveSettings", { aiMode: "auto", autoHours: [], autoDailyLimit: 1, timezone: "Europe/Madrid" }))).toBe("BAD_REQUEST");
    const allDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, from: "00:00", to: "23:59" }));
    expect(errCode(await m("saveSettings", { aiMode: "auto", autoHours: allDay, autoDailyLimit: 1, timezone: "Europe/Madrid" }, agA))).toBe("FORBIDDEN");
    await ok(m("saveSettings", { aiMode: "auto", autoHours: allDay, autoDailyLimit: 1, timezone: "Europe/Madrid" }));
    expect(errCode(await m("suggest", { id: c.id }, agA))).toBe("BAD_GATEWAY");
    // Mensaje nuevo de otro cliente: respuesta automática tras responder a Meta (sin IA: no responde y pasa a una persona)
    await post("a", payload(CREDS.a.phoneNumberId, { wamid: "wamid.QA2", from: "34622000000", text: "¿Abrís el domingo?" }), CREDS.a.appSecret);
    let log: any[] = [];
    for (let i = 0; i < 50 && !log.some((l) => l.mode === "auto"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      log = await ok(q("aiLog", { limit: 10 }));
    }
    expect(log.find((l) => l.mode === "auto")).toMatchObject({ outcome: "error" });
    expect(await ess.sql("a", "SELECT usados FROM reception_ai_cupos WHERE tipo = 'whatsapp_auto'")).toEqual([{ usados: 0 }]);
    expect(await ess.sql("a", "SELECT needs_human FROM whatsapp_conversations WHERE wa_id = '34622000000'")).toEqual([{ needs_human: 1 }]);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM whatsapp_messages WHERE origin = 'ai_auto'")).toEqual([{ n: 0 }]);
    // B sigue apagada
    expect((await ok(q("settings", undefined, adB, "b"))).aiMode).toBe("off");
  });

  it("en solo lectura se consulta pero no se responde ni se configura", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await ok(q("conversations", undefined, agA))).total).toBe(2);
    const [c] = await ess.sql("a", "SELECT id FROM whatsapp_conversations ORDER BY id LIMIT 1");
    expect(isLicenseDenied(await m("reply", { id: c.id, text: "Hola" }, agA), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveSettings", { aiMode: "off", autoHours: [], autoDailyLimit: 10, timezone: "Europe/Madrid" }), CAP)).toBe(true);
    // El webhook tampoco guarda en solo lectura
    expect((await post("a", payload(CREDS.a.phoneNumberId, { wamid: "wamid.QA3" }), CREDS.a.appSecret)).json).toEqual({ ok: true, ignored: "not_licensed" });
  });
});
