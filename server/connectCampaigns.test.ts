/**
 * Elephant Connect · Campaigns: reglas puras (segmento ∩ consentimiento, bloques seguros, programación), HTML de la
 * campaña con la marca (escapado y sin etiquetas de plantilla coladas) y servicio completo contra un Brevo SIMULADO
 * (ninguna llamada real): remitentes, prueba, preparación de la lista con solo los contactos con consentimiento,
 * envío ya o programado, idempotencia (dos peticiones, reintentos, job), estados, estadísticas y bajas que no vuelven.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { FetchLike } from "./brevoMarketing/client";
import { MemoryBrevoMarketingStore } from "./brevoMarketing/store";
import { buildCampaignHtml } from "./emailTemplates";
import { checkBlocks, missingForSend } from "../shared/connectCampaigns";
import { UNSUB_TAG, checkSchedule, importsState, planAudience } from "./connectCampaigns/plan";
import { CampaignError, CampaignService } from "./connectCampaigns/service";
import { MemoryCampaignStore } from "./connectCampaigns/store";
import { TRPC_ROUTER_CAPABILITIES, capabilityForProcedure } from "./_core/capabilities/routeGuard";

const FAKE_PREFIX = ["xkey", "sib-"].join("");

/** Brevo simulado: remitentes, carpetas, listas, importaciones (procesos), campañas y registro de llamadas. */
class FakeBrevo {
  calls: string[] = [];
  key = FAKE_PREFIX + "clave-de-pruebas-campanas-0000";
  folders: Array<{ id: number; name: string }> = [];
  lists = new Map<number, Map<string, { blacklisted: boolean; unsub: boolean; attrs: Record<string, string> }>>();
  processes = new Map<number, string>();
  campaigns = new Map<number, { body: any; status: string; sendNow: number; scheduledAt: string | null; tests: string[][] }>();
  processStatus = "completed";
  failOn: Record<string, number> = {};
  attributeExists = false;
  blacklisted = new Set<string>();
  private seq = 100;
  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace("/v3", "");
    const key = `${init.method} ${path.replace(/\/\d+/g, "/:id")}`;
    this.calls.push(`${init.method} ${path}`);
    const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });
    if (init.headers["api-key"] !== this.key) return reply(401);
    if (this.failOn[key]) return reply(this.failOn[key], { code: "invalid_parameter", message: "no" });
    const body = init.body ? JSON.parse(init.body) : {};
    if (key === "GET /senders") return reply(200, { senders: [{ id: 1, name: "Marketing", email: "hola@empresa.test", active: true }, { id: 2, name: "Sin verificar", email: "x@empresa.test", active: false }] });
    if (key === "GET /contacts/folders") {
      const off = Number(u.searchParams.get("offset"));
      return reply(200, { folders: this.folders.slice(off, off + 50), count: this.folders.length });
    }
    if (key === "POST /contacts/folders") {
      const id = ++this.seq;
      this.folders.push({ id, name: body.name });
      return reply(201, { id });
    }
    if (key === "POST /contacts/lists") {
      const id = ++this.seq;
      this.lists.set(id, new Map());
      return reply(201, { id });
    }
    if (key === "POST /contacts/attributes/normal/BAJA_URL") {
      if (this.attributeExists) return reply(400, { code: "invalid_parameter" });
      this.attributeExists = true;
      return reply(201);
    }
    if (key === "POST /contacts/import") {
      const l = this.lists.get(body.listIds[0])!;
      for (const c of body.jsonBody) l.set(c.email, { blacklisted: false, unsub: false, attrs: c.attributes });
      const id = ++this.seq;
      this.processes.set(id, "queued");
      return reply(202, { processId: id });
    }
    if (key === "GET /processes/:id") return reply(200, { id: 1, name: "IMPORTUSER", status: this.processStatus });
    if (key === "POST /emailCampaigns") {
      const id = ++this.seq;
      this.campaigns.set(id, { body, status: "draft", sendNow: 0, scheduledAt: null, tests: [] });
      return reply(201, { id });
    }
    const cid = Number(/\/emailCampaigns\/(\d+)/.exec(path)?.[1]);
    const camp = this.campaigns.get(cid);
    if (key === "PUT /emailCampaigns/:id") {
      if (!camp) return reply(404);
      if (body.scheduledAt) camp.scheduledAt = body.scheduledAt;
      else camp.body = { ...camp.body, ...body };
      return reply(204);
    }
    if (key === "POST /emailCampaigns/:id/sendNow") {
      camp!.sendNow++;
      camp!.status = "sent";
      return reply(204);
    }
    if (key === "POST /emailCampaigns/:id/sendTest") {
      if (body.emailTo[0].startsWith("desconocido")) return reply(400, { code: "invalid_parameter", message: "x", unexistingEmails: body.emailTo });
      camp!.tests.push(body.emailTo);
      return reply(204);
    }
    if (key === "GET /emailCampaigns/:id")
      return reply(200, {
        id: cid,
        status: camp!.status,
        sentDate: camp!.status === "sent" ? "2026-11-08T10:00:00.000Z" : undefined,
        statistics: { globalStats: { sent: 3, delivered: 3, uniqueViews: 2, uniqueClicks: 1, unsubscriptions: 1, hardBounces: 0, softBounces: 0, complaints: 0 } },
      });
    const rm = /^\/contacts\/lists\/(\d+)\/contacts\/remove$/.exec(path);
    if (rm) {
      for (const e of body.emails) this.lists.get(Number(rm[1]))!.delete(e);
      return reply(201, { contacts: { success: body.emails } });
    }
    const ct = /^\/contacts\/([^/]+@[^/]+)$/.exec(decodeURIComponent(path));
    if (ct && init.method === "PUT") {
      for (const l of body.unlinkListIds ?? []) this.lists.get(l)?.delete(ct[1]);
      if (body.emailBlacklisted) this.blacklisted.add(ct[1]);
      return reply(204);
    }
    const lc = /^\/contacts\/lists\/(\d+)\/contacts$/.exec(path);
    if (lc) {
      const all = Array.from(this.lists.get(Number(lc[1]))!.entries());
      const off = Number(u.searchParams.get("offset"));
      return reply(200, { contacts: all.slice(off, off + 500).map(([email, c]) => ({ email, emailBlacklisted: c.blacklisted, listUnsubscribed: c.unsub ? [Number(lc[1])] : [] })), count: all.length });
    }
    return reply(404);
  };
}

const TEXT = [{ type: "heading", text: "Novedades" }, { type: "text", text: "Hola" }];

describe("reglas puras", () => {
  it("segmento ∩ consentimiento: correo válido, sin duplicados y sin correos con la baja en otra ficha", () => {
    const a = planAudience(
      [
        { clientId: 3, email: "Ana@Cliente.test ", name: "Ana López" },
        { clientId: 1, email: "ana@cliente.test", name: "Ana" },
        { clientId: 2, email: "no-es-correo", name: "X" },
        { clientId: 4, email: "baja@cliente.test", name: "B" },
      ],
      new Set(["baja@cliente.test"]),
    );
    expect(a.recipients).toEqual([{ clientId: 1, email: "ana@cliente.test", firstName: "Ana" }]);
    expect(a).toMatchObject({ skipped: 2, withdrawn: 1 });
  });

  it("bloques: solo enlaces http(s), imágenes https, tipos conocidos; lo que falta para enviar", () => {
    expect(() => checkBlocks([{ type: "button", label: "Ver", url: "javascript:alert(1)" }])).toThrow(/https/);
    expect(() => checkBlocks([{ type: "image", url: "http://x.test/a.png", alt: "" }])).toThrow(/https/);
    expect(() => checkBlocks([{ type: "script", text: "x" }])).toThrow(/Tipo/);
    expect(checkBlocks([{ type: "text", text: "  " }, { type: "divider" }])).toEqual([{ type: "divider" }]);
    expect(missingForSend({ subject: "", senderId: null, blocks: [] })).toEqual(["el asunto", "el remitente", "el contenido"]);
  });

  it("programación: como pronto en 15 minutos y como tarde a 180 días; importación lista cuando todo termina", () => {
    const now = new Date("2026-11-08T10:00:00Z");
    expect(() => checkSchedule(new Date("2026-11-08T10:05:00Z"), now)).toThrow(/15 minutos/);
    expect(() => checkSchedule(new Date("2027-11-08T10:05:00Z"), now)).toThrow(/180/);
    expect(() => checkSchedule(new Date("2026-11-08T12:00:00Z"), now)).not.toThrow();
    expect(importsState(["completed", "completed"])).toBe("ready");
    expect(importsState(["completed", "in_process"])).toBe("wait");
    expect(importsState(["completed", "failed"])).toBe("failed");
  });

  it("HTML seguro: todo escapado, sin llaves de plantilla del usuario; solo el enlace de baja lleva la etiqueta", () => {
    const html = buildCampaignHtml({
      title: "Oferta {{ contact.EMAIL }}",
      previewText: "<b>pre</b>",
      blocks: checkBlocks([
        { type: "heading", text: "<script>alert(1)</script>" },
        { type: "text", text: "Hola {{ contact.FIRSTNAME }}\n\"comillas\" & 'simples'" },
        { type: "button", label: "Ver <b>", url: "https://x.test/?a=1&b={{x}}" },
        { type: "image", url: "https://x.test/i.png", alt: "\"><img onerror=1>" },
      ]),
      unsubscribeHref: UNSUB_TAG,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).not.toMatch(/onerror=1>/);
    expect(html).toContain("&lt;script&gt;");
    expect(html.split("{{").length - 1).toBe(1);
    expect(html).toContain(`href="${UNSUB_TAG}"`);
    expect(html).toContain("https://x.test/?a=1&amp;b=%7B%7Bx%7D%7D");
    expect(html).toContain("Darse de baja");
  });

  it("licencia doble: las campañas cuelgan de brevoMarketing (guardián email-campaigns)", () => {
    expect(TRPC_ROUTER_CAPABILITIES.brevoMarketing).toBe("email-campaigns");
    expect(capabilityForProcedure("brevoMarketing.campaigns.launch")).toBe("email-campaigns");
  });
});

describe("servicio de campañas con Brevo simulado", () => {
  let brevo: FakeBrevo;
  let store: MemoryCampaignStore;
  let consents: MemoryBrevoMarketingStore;
  let key: string | null;
  let now: Date;
  let licensed: boolean;
  const svc = (o: { pollAttempts?: number } = {}) =>
    new CampaignService({
      store,
      consents,
      credentials: { apiKey: async () => key },
      render: (d) => `<html>${d.title}|${d.blocks.length}|${d.unsubscribeHref}</html>`,
      unsubscribeUrl: (id) => `https://empresa.test/baja/${id}.firma`,
      licensed: async () => licensed,
      fetch: brevo.fetch,
      now: () => now,
      sleep: async () => undefined,
      pollAttempts: o.pollAttempts ?? 1,
    });
  const draft = (over: Record<string, unknown> = {}) => ({ name: "Otoño", subject: "Novedades de otoño", previewText: "Lo nuevo", senderId: 1, replyTo: null, blocks: TEXT, tagIds: [10], tagMode: "any" as const, ...over });

  beforeEach(() => {
    brevo = new FakeBrevo();
    store = new MemoryCampaignStore();
    consents = new MemoryBrevoMarketingStore();
    key = brevo.key;
    now = new Date("2026-11-08T10:00:00Z");
    licensed = true;
    store.clients = [
      { id: 1, email: "ana@cliente.test", name: "Ana López" },
      { id: 2, email: "bea@cliente.test", name: "Bea" },
      { id: 3, email: "carla@cliente.test", name: "Carla" },
      { id: 4, email: "dani@cliente.test", name: "Dani" },
    ];
    // Ana y Bea con consentimiento y la etiqueta; Carla con la etiqueta sin consentimiento; Dani con consentimiento sin etiqueta
    store.consents = new Map([
      [1, "granted"],
      [2, "granted"],
      [3, "withdrawn"],
      [4, "granted"],
    ]);
    store.tagRows = [{ id: 10, name: "Clientes VIP" }];
    store.tagLinks = [
      { tagId: 10, clientId: 1 },
      { tagId: 10, clientId: 2 },
      { tagId: 10, clientId: 3 },
    ];
  });

  it("sin cuenta conectada: estado desconectado y ninguna llamada a Brevo", async () => {
    key = null;
    expect(await svc().status()).toEqual({ connected: false });
    await expect(svc().senders()).rejects.toMatchObject({ code: "not_configured" });
    expect(brevo.calls).toEqual([]);
  });

  it("remitentes: solo los activos; un remitente no verificado no se acepta", async () => {
    expect(await svc().senders()).toEqual([{ id: 1, name: "Marketing", email: "hola@empresa.test" }]);
    await expect(svc().create(draft({ senderId: 2 }), "user:1")).rejects.toThrow(/verificado/);
    const c = await svc().create(draft(), "user:1");
    expect(c).toMatchObject({ status: "draft", senderEmail: "hola@empresa.test", tagIds: [10] });
    expect(await svc().audience([10], "any")).toMatchObject({ recipients: 2 });
    expect(await svc().audience([], "any")).toMatchObject({ recipients: 3 });
  });

  it("prueba a un buzón: campaña de pruebas aparte en Brevo y error claro si el buzón no es contacto", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    await svc().sendTest(c.id, "yo@empresa.test", "user:1");
    await svc().sendTest(c.id, "yo@empresa.test", "user:1");
    const tests = Array.from(brevo.campaigns.values());
    expect(tests).toHaveLength(1);
    expect(tests[0].body.recipients).toBeUndefined();
    expect(tests[0].body.name).toMatch(/^\[Prueba\]/);
    expect(tests[0].tests).toEqual([["yo@empresa.test"], ["yo@empresa.test"]]);
    await expect(svc().sendTest(c.id, "desconocido@empresa.test", "user:1")).rejects.toThrow(/no es un contacto/);
    expect((await store.get(c.id))!.brevoCampaignId).toBeNull();
  });

  it("enviar ya: lista propia con solo los contactos con consentimiento (y su enlace de baja), campaña con esa lista y envío", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    const r = (await svc().launch(c.id, { at: null }, "user:1"))!;
    expect(r).toMatchObject({ status: "sent", recipients: 2 });
    const [list] = Array.from(brevo.lists.values());
    expect(Array.from(list.keys()).sort()).toEqual(["ana@cliente.test", "bea@cliente.test"]);
    expect(list.get("ana@cliente.test")!.attrs).toEqual({ BAJA_URL: "https://empresa.test/baja/1.firma", FIRSTNAME: "Ana" });
    const camp = brevo.campaigns.get(r.brevoCampaignId!)!;
    expect(camp.body.recipients).toEqual({ listIds: [r.brevoListId] });
    expect(camp.body.sender).toEqual({ id: 1 });
    expect(camp.body.htmlContent).toContain(UNSUB_TAG);
    expect(camp.sendNow).toBe(1);
    expect(brevo.folders.map((f) => f.name)).toEqual(["Elephant Campaigns"]);
    expect(brevo.calls.some((x) => x.includes("/smtp/"))).toBe(false);
  });

  it("idempotencia: dos envíos a la vez, repetir, refrescar y el job no envían dos veces", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    const results = await Promise.allSettled([svc().launch(c.id, { at: null }, "user:1"), svc().launch(c.id, { at: null }, "user:2")]);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    await expect(svc().launch(c.id, { at: null }, "user:1")).rejects.toBeInstanceOf(CampaignError);
    await svc().refresh(c.id);
    await svc().advance(c.id);
    await svc().tick();
    const sends = Array.from(brevo.campaigns.values()).reduce((n, x) => n + x.sendNow, 0);
    expect(sends).toBe(1);
    expect(brevo.calls.filter((x) => x === "POST /contacts/lists")).toHaveLength(1);
  });

  it("importación en curso: queda preparando; el job la termina cuando Brevo acaba (una sola vez)", async () => {
    brevo.processStatus = "in_process";
    const c = (await svc().create(draft(), "user:1"))!;
    expect(await svc().launch(c.id, { at: null }, "user:1")).toMatchObject({ status: "preparing" });
    expect(await svc().tick()).toEqual({ checked: 1 });
    expect((await store.get(c.id))!.status).toBe("preparing");
    brevo.processStatus = "completed";
    await Promise.all([svc().tick(), svc().refresh(c.id)]);
    expect((await store.get(c.id))!.status).toBe("sent");
    expect(Array.from(brevo.campaigns.values()).reduce((n, x) => n + x.sendNow, 0)).toBe(1);
    // Sin licencia, el job no hace nada
    licensed = false;
    expect(await svc().tick()).toEqual({ skipped: "not_licensed" });
  });

  it("programar: fecha válida, campaña programada en Brevo y enviada cuando Brevo la da por enviada", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    await expect(svc().launch(c.id, { at: new Date("2026-11-08T10:05:00Z") }, "user:1")).rejects.toThrow(/15 minutos/);
    const at = new Date("2026-11-09T09:00:00Z");
    const r = (await svc().launch(c.id, { at }, "user:1"))!;
    expect(r).toMatchObject({ status: "scheduled", scheduledAt: at.toISOString() });
    const camp = brevo.campaigns.get(r.brevoCampaignId!)!;
    expect(camp).toMatchObject({ scheduledAt: at.toISOString(), sendNow: 0 });
    camp.status = "sent";
    expect(await svc().refresh(c.id)).toMatchObject({ status: "sent", sentAt: "2026-11-08T10:00:00.000Z", stats: { sent: 3, opens: 2, clicks: 1, unsubscribed: 1 } });
  });

  it("estados: fallo antes de pedir el envío se puede reintentar; fallo al pedirlo queda bloqueado", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    brevo.failOn["POST /emailCampaigns"] = 400;
    expect(await svc().launch(c.id, { at: null }, "user:1")).toMatchObject({ status: "failed", sendClaimedAt: null });
    delete brevo.failOn["POST /emailCampaigns"];
    brevo.failOn["POST /emailCampaigns/:id/sendNow"] = 500;
    const r = (await svc().launch(c.id, { at: null }, "user:1"))!;
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toMatch(/Compruébalo en Brevo/);
    delete brevo.failOn["POST /emailCampaigns/:id/sendNow"];
    await expect(svc().launch(c.id, { at: null }, "user:1")).rejects.toThrow(/duplícala/);
    await expect(svc().update(c.id, draft(), "user:1")).rejects.toThrow(/borrador/);
    const copy = (await svc().duplicate(c.id, "user:1"))!;
    expect(copy).toMatchObject({ status: "draft", name: "Otoño (copia)", brevoCampaignId: null });
  });

  it("segmento sin nadie con consentimiento: no se crea nada en Brevo", async () => {
    store.consents.set(1, "withdrawn");
    store.consents.set(2, "withdrawn");
    const c = (await svc().create(draft(), "user:1"))!;
    await expect(svc().launch(c.id, { at: null }, "user:1")).rejects.toThrow(/consentimiento/);
    expect(brevo.calls.filter((x) => x.startsWith("POST"))).toEqual([]);
    expect((await store.get(c.id))!.status).toBe("draft");
  });

  it("bajas: la baja leída de la lista de la campaña retira el consentimiento y no entra en la siguiente", async () => {
    consents.clientRows = store.clients.map((c) => ({ id: c.id, name: c.name!, email: c.email! }));
    const c = (await svc().create(draft(), "user:1"))!;
    const r = (await svc().launch(c.id, { at: null }, "user:1"))!;
    brevo.lists.get(r.brevoListId!)!.get("bea@cliente.test")!.unsub = true;
    await svc().refresh(c.id);
    expect((await consents.consent(2))!).toMatchObject({ status: "withdrawn", source: "brevo_unsubscribe" });
    // El CRM de campañas ve la baja (mismo almacén de consentimientos en producción)
    store.consents.set(2, "withdrawn");
    const c2 = (await svc().create(draft(), "user:1"))!;
    const r2 = (await svc().launch(c2.id, { at: null }, "user:1"))!;
    expect(Array.from(brevo.lists.get(r2.brevoListId!)!.keys())).toEqual(["ana@cliente.test"]);
  });

  it("vista previa con enlace de baja de ejemplo; editar solo en borrador", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    expect((await svc().preview(c.id)).html).toBe("<html>Novedades de otoño|2|#enlace-de-baja</html>");
    expect(await svc().update(c.id, draft({ subject: "Otro asunto" }), "user:1")).toMatchObject({ subject: "Otro asunto" });
    await expect(svc().create(draft({ blocks: [{ type: "button", label: "x", url: "ftp://x" }] }), "user:1")).rejects.toThrow(/https/);
  });

  it("bloqueante: programada → retira el consentimiento → sale al momento de la lista que se enviará (y en la cuenta, si es una baja)", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    const r = (await svc().launch(c.id, { at: new Date("2026-11-20T09:00:00Z") }, "user:1"))!;
    expect(r).toMatchObject({ status: "scheduled", recipients: 2 });
    const list = brevo.lists.get(r.brevoListId!)!;
    expect(list.has("bea@cliente.test")).toBe(true);
    // Retirada en el CRM (o enlace de baja): Brevo marketing avisa a las campañas
    store.consents.set(2, "withdrawn");
    expect(await svc().onWithdrawn(2, { blacklist: true })).toEqual({ removed: 1 });
    expect(list.has("bea@cliente.test")).toBe(false);
    expect(brevo.blacklisted.has("bea@cliente.test")).toBe(true);
    expect((await store.get(c.id))!.recipients).toBe(1);
    // Repetirlo no hace nada (ya no está pendiente en ninguna campaña)
    expect(await svc().onWithdrawn(2, { blacklist: true })).toEqual({ removed: 0 });
  });

  it("si avisar a Brevo falla, la comprobación de la programada (job o «Actualizar») la saca antes de que se envíe", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    const r = (await svc().launch(c.id, { at: new Date("2026-11-20T09:00:00Z") }, "user:1"))!;
    store.consents.set(1, "withdrawn");
    brevo.failOn["PUT /contacts/ana%40cliente.test"] = 500;
    expect(await svc().onWithdrawn(1, { blacklist: false })).toEqual({ removed: 0 });
    expect(brevo.lists.get(r.brevoListId!)!.has("ana@cliente.test")).toBe(true);
    await svc().tick();
    expect(Array.from(brevo.lists.get(r.brevoListId!)!.keys())).toEqual(["bea@cliente.test"]);
    expect((await store.get(c.id))!).toMatchObject({ status: "scheduled", recipients: 1 });
  });

  it("preparando: quien retira el consentimiento antes de reservar el envío no está en la lista enviada; sin nadie, no se envía", async () => {
    brevo.processStatus = "in_process";
    const c = (await svc().create(draft(), "user:1"))!;
    const r = (await svc().launch(c.id, { at: null }, "user:1"))!;
    expect(r.status).toBe("preparing");
    store.consents.set(1, "withdrawn");
    brevo.processStatus = "completed";
    expect(await svc().refresh(c.id)).toMatchObject({ status: "sent", recipients: 1 });
    expect(Array.from(brevo.lists.get(r.brevoListId!)!.keys())).toEqual(["bea@cliente.test"]);
    // Otra campaña en la que nadie conserva el consentimiento al llegar el momento: fallida, sin envío
    brevo.processStatus = "in_process";
    const c2 = (await svc().create(draft(), "user:1"))!;
    await svc().launch(c2.id, { at: null }, "user:1");
    store.consents.set(2, "withdrawn");
    brevo.processStatus = "completed";
    expect(await svc().advance(c2.id)).toMatchObject({ status: "failed", sendClaimedAt: null });
    expect(Array.from(brevo.campaigns.values()).reduce((n, x) => n + x.sendNow, 0)).toBe(1);
  });

  it("preparación interrumpida sin lista: pasado el plazo, fallida con su motivo; un fallo tardío no pisa una enviada", async () => {
    const c = (await svc().create(draft(), "user:1"))!;
    expect(await store.claimLaunch(c.id, null, "user:1")).toBe(true);
    expect(await svc().advance(c.id)).toMatchObject({ status: "preparing" });
    now = new Date(now.getTime() + 31 * 60_000);
    store.rows[0].launchedAt = new Date(now.getTime() - 31 * 60_000).toISOString();
    expect(await svc().advance(c.id)).toMatchObject({ status: "failed" });
    expect((await store.get(c.id))!.errorMessage).toMatch(/no terminó/);
    // Reservado el envío, un fallo «antes de reservar» de otra petición no cambia nada
    const d = (await svc().create(draft(), "user:1"))!;
    await store.claimLaunch(d.id, null, "user:1");
    await store.claimSend(d.id);
    expect(await store.failUnclaimed(d.id, "x")).toBe(false);
    expect((await store.get(d.id))!.status).toBe("preparing");
  });

  it("job: las abiertas no dejan sin estadísticas a las enviadas (cupos separados); carpetas paginadas sin duplicar", async () => {
    for (let i = 0; i < 12; i++) await store.create(draft(), "user:1");
    for (const r of store.rows.slice(0, 11)) Object.assign(r, { status: "scheduled" });
    Object.assign(store.rows[11], { status: "sent" });
    const due = await store.due(10, 3600_000);
    expect(due).toHaveLength(11);
    expect(due).toContain(12);
    brevo.folders = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: i === 55 ? "Elephant Campaigns" : `Carpeta ${i}` }));
    const c = (await svc().create(draft(), "user:1"))!;
    await svc().launch(c.id, { at: null }, "user:1");
    expect(brevo.calls.filter((x) => x === "POST /contacts/folders")).toEqual([]);
    expect(await store.settings()).toMatchObject({ folderId: 56 });
  });
});

describe("Brevo marketing avisa a las campañas al retirar un consentimiento", () => {
  it("retirada en el CRM (sin lista negra), enlace público (con lista negra) y baja leída en la sincronización", async () => {
    const { BrevoMarketingService } = await import("./brevoMarketing/service");
    const st = new MemoryBrevoMarketingStore();
    st.clientRows = [{ id: 1, name: "Ana", email: "ana@cliente.test" }];
    const seen: string[] = [];
    const s = new BrevoMarketingService({
      store: st,
      credentials: { apiKey: async () => null, clear: async () => undefined },
      onWithdrawn: async (id, o) => {
        seen.push(`${id}:${o.blacklist}`);
        throw new Error("Brevo caído");
      },
    });
    await s.grantConsent(1, "form", "Casilla del formulario", "user:1");
    expect(await s.withdrawConsent(1, "", "user:1")).toMatchObject({ status: "withdrawn" });
    expect(await s.publicUnsubscribe(1)).toMatchObject({ changed: false });
    expect(seen).toEqual(["1:false", "1:true"]);
  });
});
