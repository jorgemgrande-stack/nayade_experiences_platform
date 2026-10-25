/**
 * Avisos internos de las solicitudes de la web: la solicitud se guarda primero y el aviso va después, a los
 * operadores elegidos por tipo; sin duplicados por reintentos; un fallo del correo no pierde la solicitud;
 * reintentos de fallos temporales; política de correo por encima (destinatarios autorizados y ámbito);
 * interruptores; barrido de recuperación; historial y recuperación de ajustes; enlace al CRM sin secretos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService, type WebRequestInput } from "./crm/webRequests";
import { LeadNoticeService, MemorySettingsStore, crmUrlFromEnv, defaultSettings, summarize, type LeadNoticeSettings, type NoticeOperator } from "./crm/leadNotices";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { PlatformMailer } from "./mail/platform";
import { MailProviderError } from "./mail/types";

const T0 = Date.UTC(2026, 9, 25, 9, 30);
const OPS: NoticeOperator[] = [
  { id: 1, email: "comercial@equipo.example", displayName: "Comercial", role: "sales", status: "active" },
  { id: 2, email: "direccion@equipo.example", displayName: "Dirección", role: "admin", status: "active" },
  { id: 3, email: "soporte@equipo.example", displayName: "Soporte", role: "support", status: "active" },
  { id: 4, email: "baja@equipo.example", displayName: "De baja", role: "sales", status: "disabled" },
  { id: 5, email: null, displayName: "Sin correo", role: "sales", status: "active" },
  { id: 6, email: "fuera@otro.example", displayName: "Fuera de la lista", role: "sales", status: "active" },
];
const input = (over: Partial<WebRequestInput> = {}): WebRequestInput => ({
  type: "contact",
  name: "Marta Prueba",
  email: "marta@cliente.example",
  phone: "+34 600 111 222",
  company: "Hotel Demo",
  sector: "Alojamiento",
  message: "Queremos ver la plataforma",
  configuration: null,
  interest: "demo",
  preferredTime: null,
  sourcePage: "/solicitar-demostracion",
  utm: null,
  marketingConsent: false,
  privacyVersion: "2026-10-25",
  ...over,
});
const on = (types: Partial<Record<string, number[]>>, enabled = true): LeadNoticeSettings => {
  const s = defaultSettings();
  s.enabled = enabled;
  for (const [t, r] of Object.entries(types)) s.rules[t as keyof LeadNoticeSettings["rules"]] = { enabled: true, recipients: r! };
  return s;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function make(env: Record<string, string> = {}, o: { killSwitch?: boolean; noMailer?: boolean } = {}) {
  let now = T0;
  const clock = { set: (t: number) => (now = t), get: () => now };
  const store = new MemoryCrmStore();
  const crm = new CrmService({ store, now: () => now });
  const mailStore = new MemoryMailStore();
  const provider = memoryProvider();
  const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.example", MAIL_SANDBOX_ALLOWLIST: "equipo.example", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice", ...env } as NodeJS.ProcessEnv);
  const service = new MailService({ lane: "platform", store: mailStore, provider, policy, now: () => now });
  const mailer = new PlatformMailer(service, policy);
  const settings = new MemorySettingsStore();
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  const notices = new LeadNoticeService({
    settings,
    store,
    crm,
    mailer: o.noMailer ? null : mailer,
    ledger: mailStore,
    operators: async () => OPS,
    crmUrl: "https://admin.bigelephant.example",
    killSwitch: o.killSwitch,
    now: () => now,
    log: (event, data) => logs.push({ event, data }),
  });
  const web = new WebRequestService({ store, crm, now: () => now, onCreated: (r) => notices.onCreated(r) });
  return { store, crm, mailStore, provider, service, notices, web, settings, logs, clock };
}

describe("avisos internos de solicitudes web", () => {
  let k: ReturnType<typeof make>;
  beforeEach(() => {
    k = make();
  });

  it("sin configurar no avisa a nadie, pero la solicitud queda registrada y anotada", async () => {
    const r = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await flush();
    expect(r.outcome).toBe("created");
    expect(await k.store.get("leadRequests", r.request.id)).not.toBeNull();
    expect(k.provider.sent).toHaveLength(0);
    const notes = await k.store.list("activities", { entityType: "lead", entityId: r.request.leadId });
    expect(notes.some((a) => a.summary.includes("no enviado: avisos desactivados en el CRM"))).toBe(true);
  });

  it("tras registrar, avisa a los destinatarios del tipo con los datos del formulario y el enlace al CRM", async () => {
    await k.notices.save(on({ contact: [1, 2] }), 0, "operator:1");
    const r = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await flush();
    await flush();
    expect(k.provider.sent.map((m) => m.to).sort()).toEqual(["comercial@equipo.example", "direccion@equipo.example"]);
    const m = k.provider.sent[0];
    expect(m.tag).toBe("lead_request_notice");
    expect(m.subject).toContain(r.request.reference);
    expect(m.subject).toContain("Hotel Demo");
    expect(m.html).toContain("Marta Prueba");
    expect(m.html).toContain("marta@cliente.example");
    expect(m.html).toContain("hora de Madrid");
    expect(m.html).toContain("Responsable: sin asignar");
    expect(m.html).toContain(`https://admin.bigelephant.example/#/comercial/leads/${r.request.leadId}`);
    expect(m.html).toContain("big-elephant-logo.png");
    // Nada interno: ni la clave de idempotencia, ni la huella, ni el seudónimo de IP
    expect(m.html).not.toMatch(/idempotency|payloadHash|ipHash|token/i);
    // Solo es un aviso interno: el cliente no recibe nada
    expect(k.provider.sent.some((x) => x.to === "marta@cliente.example")).toBe(false);
    const view = await k.notices.notices(r.request.id);
    expect(view.map((v) => v.status)).toEqual(["accepted", "accepted"]);
    expect(view[0].recipient).not.toContain("comercial@");
  });

  it("los reintentos del formulario y el barrido nunca duplican el aviso", async () => {
    await k.notices.save(on({ contact: [1] }), 0, "operator:1");
    const key = crypto.randomUUID();
    const a = await k.web.receive(input(), { idempotencyKey: key, ipHash: null });
    await flush();
    const b = await k.web.receive(input(), { idempotencyKey: key, ipHash: null });
    const c = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await flush();
    expect(b.outcome).toBe("replayed");
    expect(c.outcome).toBe("duplicate");
    await k.notices.notify(a.request.id, "receive");
    k.clock.set(T0 + 5 * 60_000);
    await k.notices.sweep();
    expect(k.provider.sent).toHaveLength(1);
  });

  it("un fallo temporal de Postmark se reintenta con espera; la solicitud nunca se pierde", async () => {
    await k.notices.save(on({ contact: [1] }), 0, "operator:1");
    k.provider.failWith = new MailProviderError("http_503", true, 503);
    const r = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await flush();
    await flush();
    expect(await k.store.get("leadRequests", r.request.id)).not.toBeNull();
    let view = await k.notices.notices(r.request.id);
    expect(view[0].status).toBe("pending");
    expect(view[0].lastError).toBe("http_503");
    expect(summarize(view).state).toBe("pending");
    k.provider.failWith = null;
    k.clock.set(T0 + 2 * 60_000);
    await k.service.drain(10);
    view = await k.notices.notices(r.request.id);
    expect(view[0].status).toBe("accepted");
    expect(k.provider.sent).toHaveLength(1);
  });

  it("un rechazo definitivo queda como fallo visible y se puede reenviar con una clave nueva", async () => {
    await k.notices.save(on({ contact: [1] }), 0, "operator:1");
    k.provider.failWith = new MailProviderError("http_422", false, 422);
    const r = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await flush();
    await flush();
    expect(summarize(await k.notices.notices(r.request.id)).state).toBe("failed");
    k.provider.failWith = null;
    const out = await k.notices.notify(r.request.id, "resend", "operator:2");
    expect(out.status).toBe("sent");
    const view = await k.notices.notices(r.request.id);
    expect(view.filter((v) => v.resend)).toHaveLength(1);
    expect(k.provider.sent).toHaveLength(1);
  });

  it("solo operadores activos, con correo y rol comercial o de administración pueden configurarse", async () => {
    await expect(k.notices.save(on({ contact: [3] }), 0, "operator:1")).rejects.toThrow(/operadores activos/);
    await expect(k.notices.save(on({ contact: [4] }), 0, "operator:1")).rejects.toThrow(/operadores activos/);
    await expect(k.notices.save(on({ contact: [5] }), 0, "operator:1")).rejects.toThrow(/operadores activos/);
    await expect(k.notices.save({ ...on({}), extra: 1 }, 0, "operator:1")).rejects.toThrow(/no válidos/);
    expect((await k.notices.candidates()).map((c) => c.id)).toEqual([1, 2, 6]);
  });

  it("la política de correo manda: un destinatario fuera de la lista autorizada no recibe nada", async () => {
    await k.notices.save(on({ contact: [6] }), 0, "operator:1");
    const r = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await flush();
    await flush();
    expect(k.provider.sent).toHaveLength(0);
    const view = await k.notices.notices(r.request.id);
    expect(view[0]).toMatchObject({ status: "skipped", reason: "sandbox_recipient_not_allowed" });
  });

  it("el ámbito del correo de production deja fuera cualquier otra categoría de la plataforma", async () => {
    const kk = make({ MAIL_SCOPE_CATEGORIES: "lead_request_notice" });
    const mailer = new PlatformMailer(kk.service, mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.example", MAIL_SANDBOX_ALLOWLIST: "equipo.example", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice" } as NodeJS.ProcessEnv));
    const r = await mailer.send(null, "ops:otra", "operational", "comercial@equipo.example", { subject: "x", html: "<p>x</p>" });
    expect(r).toMatchObject({ status: "skipped", reason: "scope_not_allowed" });
  });

  it("interruptores: por tipo, global, de entorno y sin correo; apagar no detiene la captación", async () => {
    await k.notices.save(on({ trial: [1] }), 0, "operator:1");
    const r1 = await k.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    expect((await k.notices.notify(r1.request.id, "receive")).status).toBe("disabled");
    await k.notices.save(on({ contact: [1] }, false), 1, "operator:1");
    expect(await k.notices.notify(r1.request.id, "receive")).toMatchObject({ status: "disabled", reason: "notices_disabled" });
    const off = make({}, { killSwitch: true });
    await off.notices.save(on({ contact: [1] }), 0, "operator:1");
    const r2 = await off.web.receive(input(), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    expect(r2.outcome).toBe("created");
    expect(await off.notices.notify(r2.request.id, "receive")).toMatchObject({ status: "unavailable", reason: "disabled_by_environment" });
    const none = make({}, { noMailer: true });
    expect(none.notices.status()).toMatchObject({ available: false, reason: "mail_not_configured" });
    expect(k.provider.sent).toHaveLength(0);
  });

  it("el barrido recupera solicitudes recientes sin aviso, y no reenvía el histórico", async () => {
    // Solicitudes registradas con los avisos apagados (p. ej. un proceso reiniciado antes de avisar)
    const kk = make();
    const store = kk.store;
    const plain = new WebRequestService({ store, crm: kk.crm, now: () => kk.clock.get() });
    const old = await plain.receive(input({ email: "antigua@cliente.example" }), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    kk.clock.set(T0 + 3 * 60 * 60_000);
    const recent = await plain.receive(input({ email: "reciente@cliente.example" }), { idempotencyKey: crypto.randomUUID(), ipHash: null });
    await kk.notices.save(on({ contact: [1] }), 0, "operator:1");
    kk.clock.set(T0 + 3 * 60 * 60_000 + 30_000);
    expect((await kk.notices.sweep()).notified).toBe(0); // margen para el aviso inmediato
    kk.clock.set(T0 + 3 * 60 * 60_000 + 5 * 60_000);
    expect((await kk.notices.sweep()).notified).toBe(1);
    expect(await kk.notices.notices(recent.request.id)).toHaveLength(1);
    expect(await kk.notices.notices(old.request.id)).toHaveLength(0);
    expect((await kk.notices.sweep()).notified).toBe(0);
  });

  it("historial de ajustes: versión optimista, recuperación como versión nueva y sin operadores ya inválidos", async () => {
    await k.notices.save(on({ contact: [1, 2] }), 0, "operator:1");
    await k.notices.save(on({ contact: [2] }), 1, "operator:2");
    await expect(k.notices.save(on({}), 1, "operator:1")).rejects.toThrow(/Otra persona/);
    const restored = await k.notices.restore(1, 2, "operator:1");
    expect(restored.version).toBe(3);
    expect(restored.settings.rules.contact.recipients).toEqual([1, 2]);
    const h = await k.notices.history();
    expect(h.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(h[0].note).toBe("Recuperada la versión 1");
    expect(h[1].updatedBy).toBe("operator:2");
  });

  it("aviso de prueba: sin crear solicitudes ni oportunidades y marcado como prueba", async () => {
    await k.notices.save(on({ onboarding: [1] }), 0, "operator:1");
    const out = await k.notices.test("onboarding", "operator:1");
    expect(out.status).toBe("sent");
    expect(k.provider.sent[0].subject).toMatch(/^\[PRUEBA\]/);
    expect(await k.store.list("leadRequests", {})).toHaveLength(0);
    expect(await k.store.list("opportunities", {})).toHaveLength(0);
  });

  it("enlace al CRM: solo https; CP_CRM_URL o, si falta, el origen de CP_RESET_URL", () => {
    expect(crmUrlFromEnv({ CP_CRM_URL: "https://admin.bigelephant.es/" } as NodeJS.ProcessEnv)).toBe("https://admin.bigelephant.es");
    expect(crmUrlFromEnv({ CP_RESET_URL: "https://admin.bigelephant.es/#/restablecer" } as NodeJS.ProcessEnv)).toBe("https://admin.bigelephant.es");
    expect(crmUrlFromEnv({ CP_CRM_URL: "http://inseguro.example" } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("activación de los avisos en production (plan del despliegue)", () => {
  it("solo el plano de control, en sandbox, solo la categoría de avisos y con el token de production de core", async () => {
    const { leadNoticesMailPlan } = await import("../scripts/deploy/esRailwayLib");
    const vars = { controlplane: { MAIL_MODE: "off" }, core: { POSTMARK_SERVER_TOKEN: "tok", MAIL_MODE: "live", MAIL_SCOPE_TENANTS: "t5-skibox" }, crm: {} };
    const plan = leadNoticesMailPlan("production", vars, { action: "activar", recipients: ["jgrande@bigelephant.es"] });
    expect(plan.problems).toEqual([]);
    expect(plan.changes.every((c) => c.service === "controlplane")).toBe(true);
    const v = Object.fromEntries(plan.changes.map((c) => [c.name, c.value ?? (c.copyFrom ? `copia:${c.copyFrom}` : "generado")]));
    expect(v).toMatchObject({ MAIL_MODE: "sandbox", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice", MAIL_SANDBOX_ALLOWLIST: "jgrande@bigelephant.es", POSTMARK_SERVER_TOKEN: "copia:core", CP_CRM_URL: "https://admin.bigelephant.es" });
    expect(plan.changes.at(-1)!.name).toBe("MAIL_MODE");
    expect(plan.changes.some((c) => c.name === "MAIL_LIVE_AUTHORIZED")).toBe(false);
  });
  it("nunca en live, nunca sin buzones, nunca sobre un correo live autorizado; desactivar solo apaga el plano de control", async () => {
    const { leadNoticesMailPlan } = await import("../scripts/deploy/esRailwayLib");
    expect(leadNoticesMailPlan("live", { controlplane: {}, core: { POSTMARK_SERVER_TOKEN: "t" } }, { action: "activar", recipients: ["a@b.es"] }).problems.length).toBeGreaterThan(0);
    expect(leadNoticesMailPlan("production", { controlplane: {}, core: { POSTMARK_SERVER_TOKEN: "t" } }, { action: "activar", recipients: [] }).problems.length).toBeGreaterThan(0);
    expect(leadNoticesMailPlan("production", { controlplane: { MAIL_LIVE_AUTHORIZED: "1" }, core: { POSTMARK_SERVER_TOKEN: "t" } }, { action: "activar", recipients: ["a@b.es"] }).problems.length).toBeGreaterThan(0);
    expect(leadNoticesMailPlan("production", { controlplane: { MAIL_MODE: "sandbox" }, core: { MAIL_MODE: "live" } }, { action: "desactivar", recipients: [] }).changes).toEqual([{ service: "controlplane", name: "MAIL_MODE", value: "off" }]);
  });
});

describe("límite por hora: los avisos de solicitudes se retienen, nunca se pierden", () => {
  it("al superar el límite el aviso queda retenido, sale solo en la siguiente franja y se escalona", async () => {
    const k = make({ MAIL_RATE_RECIPIENT_PER_HOUR: "2" });
    await k.notices.save(on({ contact: [1] }), 0, "operator:1");
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await k.web.receive(input({ email: `c${i}@cliente.example` }), { idempotencyKey: crypto.randomUUID(), ipHash: null })).request.id);
    await flush();
    await flush();
    await flush();
    // 2 enviados; 3 retenidos (ninguno descartado)
    expect(k.provider.sent).toHaveLength(2);
    const states = await Promise.all(ids.map(async (id) => summarize(await k.notices.notices(id)).state));
    expect(states.filter((s) => s === "deferred")).toHaveLength(3);
    expect(states).not.toContain("skipped");
    expect((await k.notices.deferred()).count).toBe(3);
    // Siguiente franja: salen como mucho 2; la siguiente, el resto
    k.clock.set(T0 + 61 * 60_000);
    await k.service.drain(50);
    expect(k.provider.sent.length).toBeGreaterThanOrEqual(3);
    expect(k.provider.sent.length).toBeLessThanOrEqual(4);
    k.clock.set(T0 + 3 * 60 * 60_000);
    await k.service.drain(50);
    expect(k.provider.sent).toHaveLength(5);
    expect((await k.notices.deferred()).count).toBe(0);
  });

  it("el resto de correos de la plataforma sigue descartándose al superar el límite (sin cambios de política)", async () => {
    const k = make({ MAIL_RATE_RECIPIENT_PER_HOUR: "1", MAIL_SCOPE_CATEGORIES: "lead_request_notice,operational" });
    const mailer = new PlatformMailer(k.service, mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.example", MAIL_SANDBOX_ALLOWLIST: "equipo.example", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice,operational", MAIL_RATE_RECIPIENT_PER_HOUR: "1" } as NodeJS.ProcessEnv));
    await mailer.send(null, "ops:a", "operational", "comercial@equipo.example", { subject: "a", html: "<p>a</p>" });
    expect(await mailer.send(null, "ops:b", "operational", "comercial@equipo.example", { subject: "b", html: "<p>b</p>" })).toMatchObject({ status: "skipped", reason: "rate_limited_recipient" });
  });
});
