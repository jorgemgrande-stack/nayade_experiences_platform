/**
 * Centro de envíos y consentimiento comercial: enlaces firmados (y manipulados), consentimiento por finalidad con
 * historial inmutable, baja por token, elegibilidad con motivo, idempotencia de la confirmación, comerciales sin
 * consentimiento que no salen, pie con baja y List-Unsubscribe, encuesta de soporte y permisos de la API.
 */
import { describe, it, expect, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { mailPolicyFromEnv, recipientHash } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { PlatformMailer } from "./mail/platform";
import { allTestEmails, PENDING_REASON } from "./mail/testCatalog";
import { LinkSigner } from "./communications/links";
import { ConsentService, MemoryConsentStore, consentAllows } from "./communications/consent";
import { COMMS_TENANT, CommunicationsService, countersFrom, renderSend, type SurveyTicket } from "./communications/service";
import { MemorySendStore } from "./communications/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, type ServiceToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const T0 = Date.UTC(2026, 9, 30, 9);
const SECRET = "ci-only-placeholder-not-a-secret-centro-de-envios";
const ORIGIN = "https://admin.bigelephant.example";
const GRANT = { status: "granted" as const, source: "Formulario web 2026-10-01", evidence: "Casilla «Quiero recibir novedades» (versión 3) aceptada" };
const NEWS = { url: "https://www.bigelephant.example/novedades" };

async function make() {
  let now = T0;
  const store = new MemoryCrmStore();
  const crm = new CrmService({ store, now: () => now });
  const mailStore = new MemoryMailStore();
  const provider = memoryProvider();
  const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.example", MAIL_SANDBOX_ALLOWLIST: "cliente.example" } as NodeJS.ProcessEnv);
  const mailService = new MailService({ lane: "platform", store: mailStore, provider, policy, now: () => now });
  const mailer = new PlatformMailer(mailService, policy);
  const consents = new ConsentService({ store: new MemoryConsentStore(), contactExists: async (id) => !!(await store.get("contacts", id)), now: () => now });
  const sends = new MemorySendStore((id) => mailStore.rows.find((r) => r.id === id)?.status ?? null);
  const tickets: SurveyTicket[] = [];
  const mailCalls: string[] = [];
  const hooks: { beforeSend: ((to: string) => Promise<void>) | null } = { beforeSend: null };
  const svc = new CommunicationsService({
    store: sends,
    crm: store,
    consents,
    signer: new LinkSigner(SECRET),
    publicOrigin: ORIGIN,
    mailer: {
      send: async (t, k, c, to, content, o) => {
        mailCalls.push(k);
        await hooks.beforeSend?.(to);
        return mailer.send(t, k, c, to, content, o);
      },
      status: (id) => mailService.status(id),
    },
    suppressed: (t, h) => mailStore.isSuppressed(t, h),
    tickets: { resolved: async (since) => tickets.filter((t) => (t.status === "resolved" || t.status === "closed") && (t.resolvedAt ?? 0) >= since), get: async (id) => tickets.find((t) => t.id === id) ?? null },
    planOf: async (t) => (t === "t-uno" ? "business" : "starter"),
    now: () => now,
  });
  mailService.setHeaderResolver((row) => svc.headersFor(row));
  const a = await crm.createCompany({ name: "Cliente Uno" }, "op");
  await store.update("companies", a.id, { tenantId: "t-uno", billingEmail: "facturas@cliente.example" });
  const b = await crm.createCompany({ name: "Cliente Dos" }, "op");
  await store.update("companies", b.id, { tenantId: "t-dos", billingEmail: "ana@cliente.example" });
  const p = await crm.createCompany({ name: "Prospecto" }, "op");
  const k = {
    ana: await crm.createContact(a.id, { firstName: "Ana", email: "ana@cliente.example" }, "op"),
    bea: await crm.createContact(a.id, { firstName: "Bea", email: "bea@cliente.example" }, "op"),
    sin: await crm.createContact(b.id, { firstName: "Sin correo" }, "op"),
    rep: await crm.createContact(b.id, { firstName: "Repetida", email: "ANA@cliente.example" }, "op"),
    off: await crm.createContact(b.id, { firstName: "Inactiva", email: "off@cliente.example" }, "op"),
    pro: await crm.createContact(p.id, { firstName: "Pablo", email: "pablo@cliente.example" }, "op"),
  };
  await store.update("contacts", k.off.id, { status: "inactive" });
  return { store, crm, mailStore, provider, consents, sends, svc, tickets, mailCalls, hooks, companies: { a, b, p }, k, clock: { set: (t: number) => (now = t) } };
}
type Ctx = Awaited<ReturnType<typeof make>>;
const draft = (templateId: string, content: unknown, audience: Record<string, unknown> = { source: "contacts" }) => ({ templateId, title: `Prueba ${templateId}`, content, audience });

async function confirmAll(x: Ctx, id: number) {
  const s = await x.sends.get(id);
  const e = await x.svc.eligibility(id);
  const r = await x.svc.confirm(id, { expectedEligible: e.eligible, expectedVersion: s!.version }, "operator:1");
  await x.svc.idle(id);
  return { e, r };
}

describe("enlaces firmados", () => {
  const s = new LinkSigner(SECRET);
  it("la baja solo vale para su contacto y su finalidad; un token manipulado no abre nada", () => {
    const t = s.unsubscribeToken(42, "newsletter");
    expect(s.verifyUnsubscribe(t)).toEqual({ contactId: 42, scope: "newsletter" });
    expect(s.verifyUnsubscribe(t.replace(/^42\./, "43."))).toBeNull();
    expect(s.verifyUnsubscribe(t.replace(".newsletter.", ".promotions."))).toBeNull();
    expect(s.verifyUnsubscribe(t.replace(".newsletter.", ".all."))).toBeNull();
    expect(s.verifyUnsubscribe(`${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(new LinkSigner(`${SECRET}-otro`).verifyUnsubscribe(t)).toBeNull();
    expect(s.verifyUnsubscribe(s.unsubscribeToken(7, "all"))).toEqual({ contactId: 7, scope: "all" });
    for (const bad of ["", "42", "42.newsletter", "42.otra.abc", null, 42]) expect(s.verifyUnsubscribe(bad)).toBeNull();
  });
  it("la encuesta va por ticket y no sirve como baja (ni al revés)", () => {
    const t = s.surveyToken(9);
    expect(s.verifySurvey(t)).toBe(9);
    expect(s.verifyUnsubscribe(t)).toBeNull();
    expect(s.verifySurvey(s.unsubscribeToken(9, "all"))).toBeNull();
    expect(s.verifySurvey(t.replace(/^9\./, "8."))).toBeNull();
    expect(() => new LinkSigner("corto")).toThrow();
  });
});

describe("consentimiento por finalidad", () => {
  it("sin registro no hay consentimiento; conceder exige origen y evidencia; retirar fecha la baja", async () => {
    const { consents, k } = await make();
    expect(consentAllows(await consents.records(k.ana.id), "newsletter")).toBe(false);
    await expect(consents.record(k.ana.id, { ...GRANT, purpose: "newsletter", source: "" }, "operator:1")).rejects.toThrow(/origen/);
    await expect(consents.record(k.ana.id, { ...GRANT, purpose: "newsletter", evidence: "no" }, "operator:1")).rejects.toThrow(/evidencia/);
    await expect(consents.record(9999, { ...GRANT, purpose: "newsletter" }, "operator:1")).rejects.toThrow(/no encontrado/);
    const v = await consents.record(k.ana.id, { ...GRANT, purpose: "newsletter" }, "operator:1");
    expect(v.purposes.newsletter).toMatchObject({ status: "granted", source: GRANT.source, evidence: GRANT.evidence, grantedAt: T0, withdrawnAt: null });
    expect(v.purposes.promotions).toBeNull();
    expect(consentAllows(await consents.records(k.ana.id), "newsletter")).toBe(true);
    expect(consentAllows(await consents.records(k.ana.id), "promotions")).toBe(false);
    const w = await consents.record(k.ana.id, { purpose: "newsletter", status: "withdrawn" }, "operator:2");
    expect(w.purposes.newsletter).toMatchObject({ status: "withdrawn", withdrawnAt: T0, grantedAt: T0, source: GRANT.source });
    expect(consentAllows(await consents.records(k.ana.id), "newsletter")).toBe(false);
    await expect(consents.record(k.ana.id, { purpose: "newsletter", status: "withdrawn" }, "operator:2")).rejects.toThrow(/ya está retirada/);
  });
  it("el historial es inmutable: cada cambio añade una fila y las anteriores no cambian", async () => {
    const { consents, k } = await make();
    await consents.record(k.ana.id, { ...GRANT, purpose: "promotions" }, "operator:1");
    const first = (await consents.view(k.ana.id)).events;
    await consents.record(k.ana.id, { purpose: "promotions", status: "withdrawn", source: "Llamada del cliente" }, "operator:1");
    await consents.record(k.ana.id, { ...GRANT, purpose: "promotions", source: "Formulario de la web", evidence: "Nueva aceptación firmada" }, "operator:1");
    const ev = (await consents.view(k.ana.id)).events;
    expect(ev.map((e) => e.action)).toEqual(["granted", "withdrawn", "granted"]);
    expect(ev[2]).toEqual(first[0]);
    expect(ev[1]).toMatchObject({ source: "Llamada del cliente", actor: "operator:1" });
  });
  it("la baja pública es idempotente y puede abarcar todas las finalidades", async () => {
    const { consents, k } = await make();
    await consents.record(k.ana.id, { ...GRANT, purpose: "newsletter" }, "operator:1");
    expect(await consents.unsubscribe(k.ana.id, ["newsletter"], { channel: "link", ipHash: "abcd" })).toEqual({ changed: ["newsletter"] });
    expect(await consents.unsubscribe(k.ana.id, ["newsletter"], { channel: "one_click", ipHash: null })).toEqual({ changed: [] });
    expect(await consents.unsubscribe(k.ana.id, ["newsletter", "recommendations", "promotions"], { channel: "link", ipHash: null })).toEqual({ changed: ["recommendations", "promotions"] });
    const v = await consents.view(k.ana.id);
    expect(v.purposes.newsletter).toMatchObject({ status: "withdrawn", withdrawnAt: T0 });
    expect(v.events.filter((e) => e.action === "unsubscribed")).toHaveLength(3);
    expect(v.events.find((e) => e.ipHash === "abcd")).toMatchObject({ actor: "public:link", purpose: "newsletter" });
  });
});

describe("plantillas: pie con baja", () => {
  it("las comerciales llevan el enlace personal de baja en el pie (HTML y texto); las de servicio no", () => {
    const url = `${ORIGIN}/cp/v1/public/comunicaciones/baja?t=42.newsletter.${"A".repeat(32)}`;
    const c = renderSend("marketing.news", NEWS, { unsubscribeUrl: url });
    expect(c.html).toContain(url);
    expect(c.text).toContain(`Baja de comunicaciones comerciales: ${url}`);
    const s = renderSend("ops.customer_incident", { title: "Correo restablecido", detail: "Algunos correos salieron con retraso." }, {});
    expect(s.html).not.toContain("Darte de baja");
    expect(s.text).toContain("No es publicidad");
    for (const id of ["marketing.recommendation", "marketing.campaign"] as const) {
      const r = renderSend(id, id === "marketing.campaign" ? { title: "Lanzamiento", text: "Descubre la nueva versión de Big Elephant.", url: NEWS.url } : { module: "Reservas", reason: "Ahorra horas de gestión cada semana.", url: NEWS.url }, { unsubscribeUrl: url });
      expect(r.html, id).toContain(url);
    }
  });
});

describe("elegibilidad", () => {
  it("de servicio: cada no elegible lleva su motivo (sin correo, inactivo, duplicado, suprimido)", async () => {
    const x = await make();
    await x.mailStore.suppress(COMMS_TENANT, recipientHash("bea@cliente.example"), "hard_bounce", T0);
    const e = await x.svc.eligibilityOf(draft("ops.maintenance", { start: T0 + 86_400_000, minutes: 30 }));
    const by = Object.fromEntries(e.rows.map((r) => [r.label, r.reason]));
    expect(by).toMatchObject({ Ana: null, Bea: "suppressed", "Sin correo": "no_email", Repetida: "duplicate", Inactiva: "inactive_contact", Pablo: null });
    expect(e).toMatchObject({ total: 6, eligible: 2, ineligible: { suppressed: 1, no_email: 1, duplicate: 1, inactive_contact: 1 } });
    expect(e.rows.every((r) => !r.email || r.email.includes("*"))).toBe(true);
  });
  it("filtros por empresa, plataforma, plan y selección explícita; facturación por empresa", async () => {
    const x = await make();
    const m = { start: T0 + 86_400_000, minutes: 30 };
    expect((await x.svc.eligibilityOf(draft("ops.maintenance", m, { source: "contacts", tenantsOnly: true }))).total).toBe(5);
    expect((await x.svc.eligibilityOf(draft("ops.maintenance", m, { source: "contacts", plans: ["business"] }))).rows.map((r) => r.label)).toEqual(["Ana", "Bea"]);
    expect((await x.svc.eligibilityOf(draft("ops.maintenance", m, { source: "contacts", companyIds: [x.companies.p.id] }))).rows.map((r) => r.label)).toEqual(["Pablo"]);
    expect((await x.svc.eligibilityOf(draft("ops.maintenance", m, { source: "contacts", contactIds: [x.k.bea.id] }))).rows.map((r) => r.label)).toEqual(["Bea"]);
    const bill = await x.svc.eligibilityOf(draft("ops.maintenance", m, { source: "billing" }));
    expect(bill.rows.map((r) => [r.label, r.reason])).toEqual(expect.arrayContaining([["Facturación de Cliente Uno", null], ["Facturación de Cliente Dos", null], ["Facturación de Prospecto", "no_email"]]));
  });
  it("comerciales: solo con consentimiento vigente para la finalidad; la facturación usa el consentimiento del contacto con ese correo", async () => {
    const x = await make();
    await x.consents.record(x.k.ana.id, { ...GRANT, purpose: "newsletter" }, "operator:1");
    await x.consents.record(x.k.bea.id, { ...GRANT, purpose: "promotions" }, "operator:1");
    await x.consents.record(x.k.pro.id, { ...GRANT, purpose: "newsletter" }, "operator:1");
    await x.consents.unsubscribe(x.k.pro.id, ["newsletter"], { channel: "link", ipHash: null });
    const e = await x.svc.eligibilityOf(draft("marketing.news", NEWS));
    const by = Object.fromEntries(e.rows.map((r) => [r.label, r.reason]));
    expect(by).toMatchObject({ Ana: null, Bea: "no_consent", Pablo: "unsubscribed", Repetida: "duplicate" });
    expect(e.eligible).toBe(1);
    const bill = await x.svc.eligibilityOf(draft("marketing.news", NEWS, { source: "billing" }));
    expect(Object.fromEntries(bill.rows.map((r) => [r.label, r.reason]))).toMatchObject({ "Facturación de Cliente Dos": null, "Facturación de Cliente Uno": "no_consent" });
  });
  it("la encuesta solo admite solicitantes de tickets resueltos", async () => {
    const x = await make();
    await expect(x.svc.create(draft("support.survey", {}, { source: "contacts" }), "operator:1")).rejects.toThrow(/tickets resueltos/);
    await expect(x.svc.create(draft("marketing.news", NEWS, { source: "tickets" }), "operator:1")).rejects.toThrow(/origen/);
  });
});

describe("envío", () => {
  it("confirmar exige el número exacto; repetir la confirmación no duplica ningún correo", async () => {
    const x = await make();
    const s = await x.svc.create(draft("ops.maintenance", { start: T0 + 86_400_000, minutes: 30 }), "operator:1");
    await expect(x.svc.confirm(s.id, { expectedEligible: 5, expectedVersion: 1 }, "operator:1")).rejects.toThrow(/ha cambiado: ahora son 3/);
    const { r } = await confirmAll(x, s.id);
    expect(r.alreadyConfirmed).toBe(false);
    expect(x.provider.sent.map((m) => m.to).sort()).toEqual(["ana@cliente.example", "bea@cliente.example", "pablo@cliente.example"]);
    const again = await x.svc.confirm(s.id, { expectedEligible: 3, expectedVersion: 1 }, "operator:2");
    await x.svc.idle(s.id);
    expect(again.alreadyConfirmed).toBe(true);
    expect(x.provider.sent).toHaveLength(3);
    expect(x.mailStore.rows).toHaveLength(3);
    expect(x.mailStore.rows.every((m) => m.tenantId === COMMS_TENANT && m.category === "service_notice" && /^comm:\d+:r\d+$/.test(m.idempotencyKey))).toBe(true);
    const d = await x.svc.detail(s.id);
    expect(d.send.status).toBe("sent");
    expect(d.counters).toMatchObject({ total: 6, ineligible: 3, sent: 3, pending: 0, error: 0 });
    // Reenviar a la bandeja con las mismas claves tampoco duplica (idempotencia de la bandeja)
    const recs = await x.sends.recipients(s.id, { status: "queued", limit: 10 });
    for (const rec of recs) await x.sends.setRecipient(rec.id, { status: "pending", reason: null, outboxId: null }, T0);
    await x.sends.update(s.id, (await x.sends.get(s.id))!.version, { status: "sending" }, T0);
    await x.svc.confirm(s.id, { expectedEligible: 3, expectedVersion: 1 }, "operator:1");
    await x.svc.idle(s.id);
    expect(x.provider.sent).toHaveLength(3);
  });
  it("un comercial no sale a quien no tiene consentimiento ni a quien se da de baja después de confirmar", async () => {
    const x = await make();
    await x.consents.record(x.k.ana.id, { ...GRANT, purpose: "newsletter" }, "operator:1");
    await x.consents.record(x.k.pro.id, { ...GRANT, purpose: "newsletter" }, "operator:1");
    const s = await x.svc.create(draft("marketing.news", NEWS), "operator:1");
    const e = await x.svc.eligibility(s.id);
    expect(e.eligible).toBe(2);
    const v = (await x.sends.get(s.id))!.version;
    // Pablo se da de baja cuando el envío ya está en marcha (justo al salir el primer correo)
    x.hooks.beforeSend = async () => void (await x.consents.unsubscribe(x.k.pro.id, ["newsletter"], { channel: "link", ipHash: null }));
    await x.svc.confirm(s.id, { expectedEligible: 2, expectedVersion: v }, "operator:1");
    await x.svc.idle(s.id);
    expect(x.provider.sent.map((m) => m.to)).not.toContain("pablo@cliente.example");
    expect((await x.sends.recipients(s.id, { limit: 20 })).find((r) => r.contactId === x.k.pro.id)).toMatchObject({ status: "skipped", reason: "unsubscribed" });
    const sentTo = x.provider.sent.map((m) => m.to);
    expect(sentTo).toContain("ana@cliente.example");
    expect(sentTo).not.toContain("bea@cliente.example");
    const m = x.provider.sent.find((p) => p.to === "ana@cliente.example")!;
    expect(m.html).toContain(`${ORIGIN}/cp/v1/public/comunicaciones/baja?t=${x.k.ana.id}.newsletter.`);
    expect(m.headers?.["List-Unsubscribe"]).toMatch(new RegExp(`^<${ORIGIN}/cp/v1/public/comunicaciones/baja\\?t=${x.k.ana.id}\\.newsletter\\.`));
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  it("sin nadie elegible no se confirma", async () => {
    const x = await make();
    const s = await x.svc.create(draft("marketing.campaign", { title: "Lanzamiento", text: "Descubre la nueva versión de Big Elephant.", url: NEWS.url }), "operator:1");
    expect((await x.svc.eligibility(s.id)).eligible).toBe(0);
    await expect(x.svc.confirm(s.id, { expectedEligible: 1, expectedVersion: 1 }, "operator:1")).rejects.toThrow(/ningún destinatario/);
    expect(x.provider.sent).toHaveLength(0);
  });
  it("contadores del historial a partir de la bandeja y los webhooks", () => {
    expect(countersFrom([{ recipientStatus: "queued", mailStatus: "delivered", n: 3 }, { recipientStatus: "queued", mailStatus: "bounced", n: 1 }, { recipientStatus: "queued", mailStatus: "pending", n: 2 }, { recipientStatus: "skipped", mailStatus: null, n: 4 }, { recipientStatus: "failed", mailStatus: null, n: 1 }, { recipientStatus: "queued", mailStatus: "accepted", n: 5 }])).toEqual({
      total: 16,
      ineligible: 4,
      pending: 0,
      queued: 2,
      sent: 5,
      delivered: 3,
      bounced: 1,
      error: 1,
      skipped: 0,
    });
  });
});

describe("encuesta de soporte", () => {
  it("se envía a los solicitantes de tickets resueltos una sola vez por ticket y guarda la valoración", async () => {
    const x = await make();
    x.tickets.push(
      { id: 11, tenantId: "t-uno", title: "No puedo entrar", status: "resolved", requester: "ana@cliente.example", resolvedAt: T0 - 86_400_000 },
      { id: 12, tenantId: "t-dos", title: "Factura", status: "closed", requester: "otro@cliente.example", resolvedAt: T0 - 2 * 86_400_000 },
      { id: 13, tenantId: "t-dos", title: "Viejo", status: "resolved", requester: "viejo@cliente.example", resolvedAt: T0 - 90 * 86_400_000 },
      { id: 14, tenantId: "t-dos", title: "Sin correo", status: "resolved", requester: null, resolvedAt: T0 },
    );
    const s = await x.svc.create(draft("support.survey", {}, { source: "tickets", resolvedWithinDays: 30 }), "operator:1");
    const { e } = await confirmAll(x, s.id);
    expect(e).toMatchObject({ total: 3, eligible: 2, ineligible: { no_email: 1 } });
    expect(x.provider.sent).toHaveLength(2);
    const m = x.provider.sent.find((p) => p.to === "ana@cliente.example")!;
    expect(m.html).toContain("T-11");
    const token = /encuesta\?t=([^"&<\s]+)/.exec(m.html)![1];
    expect(await x.svc.surveyView(token)).toEqual({ ticketRef: "T-11", rating: null, comment: null });
    expect(await x.svc.surveyView(token.replace(/^11\./, "12."))).toBeNull();
    await x.svc.surveySubmit(token, { rating: "4", comment: "Rápidos" });
    await x.svc.surveySubmit(token, { rating: "5" });
    expect(await x.svc.responses(null)).toMatchObject({ count: 1, average: 5, items: [{ ticketRef: "T-11", sendId: s.id, company: "Cliente Uno" }] });
    // Un segundo envío no repite la encuesta de los mismos tickets
    const s2 = await x.svc.create(draft("support.survey", {}, { source: "tickets" }), "operator:1");
    const e2 = await x.svc.eligibility(s2.id);
    expect(e2.eligible).toBe(0);
    expect(e2.ineligible.already_surveyed).toBe(2);
  });
});

describe("catálogo maestro", () => {
  it("las 7 plantillas del centro están conectadas con circuito manual y sin motivo pendiente", () => {
    const all = allTestEmails();
    for (const id of ["product.update", "ops.maintenance", "ops.customer_incident", "support.survey", "marketing.news", "marketing.recommendation", "marketing.campaign"]) {
      const t = all.find((x) => x.id === id)!;
      expect(t, id).toMatchObject({ state: "conectada", circuit: "manual" });
      expect(t.event, id).toMatch(/Centro de envíos/);
      expect(PENDING_REASON[id], id).toBeUndefined();
    }
  });
});

describe("API del Centro de envíos", () => {
  const READ = "token-lectura-centro-envios-0000000000000";
  const SALES = "token-comercial-centro-envios-00000000000";
  const OPS = "token-operaciones-centro-envios-000000000";
  const servers: http.Server[] = [];
  afterAll(async () => {
    for (const s of servers) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
  async function start() {
    const x = await make();
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const tokens: ServiceToken[] = [
      { id: "lector", sha256: hashToken(READ), scopes: ["crm:read"] },
      { id: "comercial", sha256: hashToken(SALES), scopes: ["crm:read", "crm:write"] },
      { id: "operaciones", sha256: hashToken(OPS), scopes: ["crm:read", "ops:write"] },
    ];
    const app = createControlPlaneApp({
      tokens,
      registry: new TenantRegistryService(reg, () => ring),
      reader: reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      crm: { service: x.crm, store: x.store },
      communications: x.svc,
    } as unknown as Parameters<typeof createControlPlaneApp>[0]);
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`;
    const call = async (token: string | null, method: string, path: string, body?: unknown, raw?: { type: string; data: string }) => {
      const res = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(raw ? { "content-type": raw.type } : body !== undefined ? { "content-type": "application/json" } : {}) }, body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* HTML */
      }
      return { status: res.status, json, text };
    };
    return { ...x, call };
  }

  it("permisos: leer con crm:read; comerciales con crm:write; servicio y encuesta con ops:write", async () => {
    const x = await start();
    expect((await x.call(null, "GET", "/communications/sends")).status).toBe(401);
    expect((await x.call(READ, "GET", "/communications/center/templates")).json.templates).toHaveLength(7);
    expect((await x.call(READ, "POST", "/communications/sends", draft("marketing.news", NEWS))).status).toBe(403);
    expect((await x.call(OPS, "POST", "/communications/sends", draft("marketing.news", NEWS))).status).toBe(403);
    expect((await x.call(SALES, "POST", "/communications/sends", draft("ops.maintenance", { start: T0 + 86_400_000, minutes: 30 }))).status).toBe(403);
    expect((await x.call(SALES, "POST", "/communications/sends", draft("marketing.news", NEWS))).status).toBe(201);
    expect((await x.call(OPS, "POST", "/communications/sends", draft("ops.maintenance", { start: T0 + 86_400_000, minutes: 30 }))).status).toBe(201);
    expect((await x.call(READ, "POST", `/crm/contacts/${x.k.ana.id}/consent`, { ...GRANT, purpose: "newsletter" })).status).toBe(403);
    const c = await x.call(SALES, "POST", `/crm/contacts/${x.k.ana.id}/consent`, { ...GRANT, purpose: "newsletter" });
    expect(c.status).toBe(200);
    expect(c.json.purposes.newsletter.status).toBe("granted");
    expect((await x.call(READ, "GET", `/crm/contacts/${x.k.ana.id}/consent`)).json.events).toHaveLength(1);
  });

  it("flujo completo: vista previa, elegibilidad, confirmación idempotente, historial y baja pública por token", async () => {
    const x = await start();
    await x.call(SALES, "POST", `/crm/contacts/${x.k.ana.id}/consent`, { ...GRANT, purpose: "newsletter" });
    const pv = await x.call(READ, "POST", "/communications/center/preview", { templateId: "marketing.news", content: NEWS });
    expect(pv.json.preview.subject).toBe("Novedades de Big Elephant");
    const s = (await x.call(SALES, "POST", "/communications/sends", draft("marketing.news", NEWS))).json.send;
    const e = (await x.call(READ, "GET", `/communications/sends/${s.id}/eligibility`)).json;
    expect(e.eligible).toBe(1);
    const c1 = await x.call(SALES, "POST", `/communications/sends/${s.id}/confirm`, { confirm: true, expectedEligible: 1, expectedVersion: s.version });
    expect(c1.status).toBe(202);
    await x.svc.idle(s.id);
    const c2 = await x.call(SALES, "POST", `/communications/sends/${s.id}/confirm`, { confirm: true, expectedEligible: 1, expectedVersion: s.version });
    expect(c2.status).toBe(200);
    expect(c2.json.alreadyConfirmed).toBe(true);
    expect(x.provider.sent).toHaveLength(1);
    const list = (await x.call(READ, "GET", "/communications/sends")).json.sends;
    expect(list[0]).toMatchObject({ id: s.id, status: "sent", counters: { sent: 1 } });
    const recs = (await x.call(READ, "GET", `/communications/sends/${s.id}/recipients`)).json.recipients;
    expect(recs.find((r: any) => r.status === "queued")).toMatchObject({ mailStatus: "accepted", label: "Ana" });

    // Baja pública: token manipulado → 404; válido → página de confirmación y baja registrada
    const link = /baja\?t=([^"&<\s]+)/.exec(x.provider.sent[0].html)![1];
    expect((await x.call(null, "GET", `/public/comunicaciones/baja?t=${link.replace(/^\d+\./, "999.")}`)).status).toBe(404);
    const page = await x.call(null, "GET", `/public/comunicaciones/baja?t=${link}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Confirmar la baja");
    const done = await x.call(null, "POST", `/public/comunicaciones/baja?t=${link}`, undefined, { type: "application/x-www-form-urlencoded", data: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(done.text).toContain("Baja registrada");
    const v = (await x.call(READ, "GET", `/crm/contacts/${x.k.ana.id}/consent`)).json;
    expect(v.purposes.newsletter).toMatchObject({ status: "withdrawn" });
    expect(v.events[0]).toMatchObject({ action: "unsubscribed", actor: "public:one_click" });
    // Tras la baja ya no es elegible
    const s2 = (await x.call(SALES, "POST", "/communications/sends", draft("marketing.news", NEWS))).json.send;
    expect((await x.call(READ, "GET", `/communications/sends/${s2.id}/eligibility`)).json).toMatchObject({ eligible: 0, ineligible: { unsubscribed: 1 } });
  });
});
