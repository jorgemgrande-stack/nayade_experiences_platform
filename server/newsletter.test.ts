/**
 * Newsletter: alta, duplicados, correo no válido, confirmación (con caducidad), reenvío, bienvenida una sola vez, baja,
 * reactivación con consentimiento, consentimiento en el CRM, permisos de la exportación y aislamiento entre empresas.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { CONFIRM_COOLDOWN_MS, CONFIRM_TTL_MS, normalizeEmail, renderMail, resolveTemplate, safeCell, sha256, toCsv, toXlsx, unsubscribeToken, verifyUnsubscribeToken, DEFAULT_WELCOME, type ExportRow, type Locale } from "./newsletter/core";
import { NewsletterError, NewsletterService, type CrmPort, type ListFilters, type ListQuery, type MailLogEntry, type MailPort, type NewsletterStore, type Settings, type Subscriber, type SubscriberEvent } from "./newsletter/service";

class MemoryStore implements NewsletterStore {
  settingsRow: Settings = { enabled: true, publicEnabled: true, templates: {} };
  subs: Subscriber[] = [];
  evs: Array<SubscriberEvent & { subscriberId: number }> = [];
  mailRows: Array<MailLogEntry & { subscriberId: number; key: string }> = [];
  exports: unknown[] = [];
  private seq = 0;
  async settings() { return { ...this.settingsRow }; }
  async saveSettings(p: Partial<Settings>) { this.settingsRow = { ...this.settingsRow, ...p }; }
  async byEmail(e: string) { return this.subs.find((s) => s.email === e) ?? null; }
  async byId(id: number) { return this.subs.find((s) => s.id === id) ?? null; }
  private tokens = new Map<number, string>();
  async byTokenHash(h: string) { for (const [id, t] of this.tokens) if (t === h) return this.subs.find((s) => s.id === id) ?? null; return null; }
  async insert(x: Parameters<NewsletterStore["insert"]>[0]) {
    if (this.subs.some((s) => s.email === x.email)) return null;
    const id = ++this.seq;
    this.subs.push({ id, email: x.email, status: "pending", locale: x.locale, source: x.source, page: x.page, clientId: null, consentText: x.consentText, consentVersion: x.consentVersion, consentAt: x.now, confirmExpiresAt: x.expiresAt, confirmSentCount: 0, lastConfirmSentAt: null, confirmedAt: null, unsubscribedAt: null, unsubscribedBy: null, welcomeSentAt: null, crmSyncError: null, createdAt: x.now, updatedAt: x.now });
    this.tokens.set(id, x.tokenHash);
    return id;
  }
  async restart(id: number, x: Parameters<NewsletterStore["restart"]>[1]) {
    const s = this.subs.find((r) => r.id === id)!;
    Object.assign(s, { status: "pending", locale: x.locale, source: x.source, consentText: x.consentText, consentVersion: x.consentVersion, consentAt: x.now, confirmExpiresAt: x.expiresAt, confirmSentCount: 0, lastConfirmSentAt: null, confirmedAt: null, unsubscribedAt: null, unsubscribedBy: null, welcomeSentAt: null });
    this.tokens.set(id, x.tokenHash);
  }
  async refreshToken(id: number, h: string, exp: number) { this.tokens.set(id, h); this.subs.find((s) => s.id === id)!.confirmExpiresAt = exp; }
  async touchConfirm(id: number, now: number) { const s = this.subs.find((r) => r.id === id)!; s.confirmSentCount++; s.lastConfirmSentAt = now; }
  async activate(id: number, now: number) { const s = this.subs.find((r) => r.id === id)!; if (s.status !== "pending") return false; s.status = "active"; s.confirmedAt = now; this.tokens.delete(id); return true; }
  async deactivate(id: number, by: string, now: number) { const s = this.subs.find((r) => r.id === id)!; if (s.status === "unsubscribed") return false; s.status = "unsubscribed"; s.unsubscribedAt = now; s.unsubscribedBy = by; this.tokens.delete(id); return true; }
  async patch(id: number, p: { locale?: Locale; clientId?: number | null; welcomeSentAt?: number | null; crmSyncError?: string | null }) { Object.assign(this.subs.find((r) => r.id === id)!, p); }
  async addEvent(id: number, e: { action: string; consentText?: string | null; consentVersion?: string | null; actor: string; detail?: string | null }, now: number) { this.evs.push({ id: this.evs.length + 1, subscriberId: id, action: e.action, consentText: e.consentText ?? null, consentVersion: e.consentVersion ?? null, actor: e.actor, detail: e.detail ?? null, at: now }); }
  async events(id: number) { return this.evs.filter((e) => e.subscriberId === id); }
  async reserveMail(id: number, kind: "confirm" | "welcome", key: string, now: number) {
    if (this.mailRows.some((m) => m.key === key)) return false;
    this.mailRows.push({ id: this.mailRows.length + 1, subscriberId: id, key, kind, status: "sending", error: null, at: now, finishedAt: null });
    return true;
  }
  async finishMail(key: string, status: "sent" | "failed", error: string | null, now: number) { const m = this.mailRows.find((r) => r.key === key)!; m.status = status; m.error = error; m.finishedAt = now; }
  async mails(id: number) { return this.mailRows.filter((m) => m.subscriberId === id); }
  private match(f: ListFilters, s: Subscriber) {
    return (!f.q || s.email.includes(f.q.toLowerCase())) && (!f.status || s.status === f.status) && (!f.locale || s.locale === f.locale) && (!f.source || s.source === f.source);
  }
  async list(q: ListQuery) { const rows = this.subs.filter((s) => this.match(q, s)); return { rows: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length }; }
  async all(f: ListFilters, limit: number) { return this.subs.filter((s) => this.match(f, s)).slice(0, limit); }
  async stats() { const c = (st: string) => this.subs.filter((s) => s.status === st).length; return { active: c("active"), pending: c("pending"), unsubscribed: c("unsubscribed"), total: this.subs.length, joined7d: 0, joined30d: 0, left30d: 0 }; }
  async facets() { return { locales: [...new Set(this.subs.map((s) => s.locale))], sources: [...new Set(this.subs.map((s) => s.source))] }; }
  async recentSignups(since: number) { return this.subs.filter((s) => s.createdAt >= since).length; }
  async recordExport(e: unknown) { this.exports.push(e); }
}

class FakeCrm implements CrmPort {
  clients = new Map<string, number>();
  consent = new Map<number, "granted" | "withdrawn">();
  fail = false;
  async grant(email: string) {
    if (this.fail) throw new Error("crm caído");
    let id = this.clients.get(email);
    if (!id) { id = this.clients.size + 1; this.clients.set(email, id); }
    this.consent.set(id, "granted");
    return id;
  }
  async withdraw(clientId: number) { this.consent.set(clientId, "withdrawn"); }
}
class FakeMail implements MailPort {
  sent: Array<{ to: string; subject: string; html: string; text: string; idempotencyKey: string; category: string }> = [];
  ok = true;
  async send(m: { to: string; subject: string; html: string; text: string; idempotencyKey: string; category: "operational" }) {
    if (!this.ok) return { ok: false, error: "buzón rechazado" };
    this.sent.push(m);
    return { ok: true };
  }
}

const SECRET = "s".repeat(40);
const CONSENT = "Quiero recibir la newsletter y acepto la política de privacidad.";
let now = 1_800_000_000_000;
function make(tenantId = "t12-quantum-soulrise", store = new MemoryStore(), crm = new FakeCrm(), mail = new FakeMail()) {
  const svc = new NewsletterService({ store, crm, mail, tenantId, now: () => now, secrets: () => [SECRET], baseUrl: () => "https://quantum.example", identity: () => ({ brand: "Quantum Soulrise", legalLine: "Quantum Soulrise S.L. · CIF B123" }) });
  return { svc, store, crm, mail };
}
const input = (email: unknown, o: Partial<{ consent: unknown; locale: string }> = {}) => ({ email, consent: o.consent ?? true, locale: o.locale ?? "es", source: "web:inicio", page: "/", consentText: CONSENT, ipHash: "h" });
/** Token del enlace del último correo de confirmación enviado. */
const tokenIn = (mail: FakeMail) => /\/newsletter\/confirmar\/([A-Za-z0-9_-]{43})/.exec(mail.sent.filter((m) => m.idempotencyKey.startsWith("nl:confirm")).at(-1)!.text)![1];

beforeEach(() => { now = 1_800_000_000_000; });

describe("alta pública", () => {
  it("crea una suscripción PENDIENTE y manda el correo de confirmación con enlace individual", async () => {
    const { svc, store, mail } = make();
    expect(await svc.subscribe(input("  Ana@Example.COM "))).toEqual({ ok: true });
    const s = (await store.byEmail("ana@example.com"))!;
    expect(s.status).toBe("pending");
    expect(s.consentText).toBe(CONSENT);
    expect(s.consentVersion).toHaveLength(12);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("ana@example.com");
    expect(mail.sent[0].category).toBe("operational");
    expect(mail.sent[0].html).toContain("https://quantum.example/newsletter/confirmar/");
    expect((await store.events(s.id)).map((e) => e.action)).toEqual(["requested"]);
  });
  it("correo no válido o sin consentimiento: se rechaza y no se guarda nada", async () => {
    const { svc, store, mail } = make();
    for (const bad of ["", "ana", "ana@", "ana@x", "a b@x.com", "ana@@x.com", "ana..b@x.com", 5, null]) await expect(svc.subscribe(input(bad))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.subscribe(input("ana@example.com", { consent: false }))).rejects.toMatchObject({ code: "no_consent" });
    await expect(svc.subscribe(input("ana@example.com", { consent: "true" }))).rejects.toMatchObject({ code: "no_consent" });
    expect(store.subs).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
  });
  it("sin el módulo activado o con la inscripción pública apagada no se admite ninguna alta", async () => {
    const { svc, store } = make();
    store.settingsRow = { ...store.settingsRow, enabled: false };
    await expect(svc.subscribe(input("ana@example.com"))).rejects.toMatchObject({ code: "unavailable" });
    store.settingsRow = { enabled: true, publicEnabled: false, templates: {} };
    await expect(svc.subscribe(input("ana@example.com"))).rejects.toMatchObject({ code: "unavailable" });
  });
  it("correo duplicado: una sola fila y, ya activo, la misma respuesta sin correo (no revela quién está suscrito)", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    await svc.confirm(tokenIn(mail));
    const before = mail.sent.length;
    expect(await svc.subscribe(input("ANA@example.com"))).toEqual({ ok: true });
    expect(store.subs).toHaveLength(1);
    expect(mail.sent).toHaveLength(before);
  });
  it("freno a las altas masivas por hora", async () => {
    const { svc, store } = make();
    for (let i = 0; i < 200; i++) store.subs.push({ ...(await (async () => { await store.insert({ email: `x${i}@e.com`, locale: "es", source: "w", page: null, consentText: "t", consentVersion: "v", ipHash: null, tokenHash: `h${i}`, expiresAt: now + 1, now }); return store.subs.pop()!; })()), id: 1000 + i });
    await expect(svc.subscribe(input("otra@example.com"))).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("confirmación y reenvío", () => {
  it("confirmar activa, enlaza con el CRM con consentimiento y manda UNA bienvenida", async () => {
    const { svc, store, mail, crm } = make();
    await svc.subscribe(input("ana@example.com"));
    const t = tokenIn(mail);
    expect(await svc.confirm(t)).toEqual({ state: "confirmed", locale: "es" });
    const s = (await store.byEmail("ana@example.com"))!;
    expect(s.status).toBe("active");
    expect(s.confirmedAt).toBe(now);
    expect(s.clientId).toBe(1);
    expect(crm.consent.get(1)).toBe("granted");
    const welcome = mail.sent.filter((m) => m.idempotencyKey.startsWith("nl:welcome"));
    expect(welcome).toHaveLength(1);
    expect(welcome[0].subject).toBe("Bienvenida a Quantum Soulrise ✨");
    expect(welcome[0].html).toContain("/newsletter/baja/");
    expect(welcome[0].html).toContain("Quantum Soulrise S.L. · CIF B123");
    // Repetir el enlace (o abrirlo dos veces) no duplica nada
    expect(await svc.confirm(t)).toMatchObject({ state: "invalid" });
    expect(mail.sent.filter((m) => m.idempotencyKey.startsWith("nl:welcome"))).toHaveLength(1);
    expect((await store.byId(s.id))!.welcomeSentAt).toBe(now);
  });
  it("sendWelcome repetido (reintento o segunda réplica) no duplica la bienvenida", async () => {
    const { svc, mail, store } = make();
    await svc.subscribe(input("ana@example.com"));
    await svc.confirm(tokenIn(mail));
    const id = store.subs[0].id;
    expect(await svc.sendWelcome(id, "auto")).toMatchObject({ sent: false, reason: "already_sent" });
    expect(await svc.sendWelcome(id, "manual", "user:1")).toMatchObject({ sent: false, reason: "already_sent" });
    expect(mail.sent.filter((m) => m.idempotencyKey.startsWith("nl:welcome"))).toHaveLength(1);
  });
  it("un enlace caducado no confirma; uno inventado tampoco", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    const t = tokenIn(mail);
    now += CONFIRM_TTL_MS + 1;
    expect(await svc.confirm(t)).toMatchObject({ state: "expired" });
    expect((await store.byEmail("ana@example.com"))!.status).toBe("pending");
    expect(await svc.confirm("x".repeat(43))).toMatchObject({ state: "invalid" });
    expect(await svc.confirm(undefined)).toMatchObject({ state: "invalid" });
  });
  it("mirar el enlace no lo consume (los escáneres de enlaces no confirman)", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    expect((await svc.peekConfirm(tokenIn(mail))).state).toBe("valid");
    expect((await store.byEmail("ana@example.com"))!.status).toBe("pending");
  });
  it("reenvío: respeta la espera, cambia el enlace (el anterior deja de valer) y no duplica la fila", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    const first = tokenIn(mail);
    await svc.subscribe(input("ana@example.com")); // dentro de la espera: sin correo nuevo
    expect(mail.sent).toHaveLength(1);
    now += CONFIRM_COOLDOWN_MS + 1;
    await svc.subscribe(input("ana@example.com"));
    expect(mail.sent).toHaveLength(2);
    expect(store.subs).toHaveLength(1);
    const second = tokenIn(mail);
    expect(second).not.toBe(first);
    expect(await svc.confirm(first)).toMatchObject({ state: "invalid" });
    expect(await svc.confirm(second)).toMatchObject({ state: "confirmed" });
  });
  it("reenvío desde administración: solo pendientes y con tope", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    const id = store.subs[0].id;
    await expect(svc.resendConfirmation(id, "user:1")).rejects.toMatchObject({ code: "rate_limited" });
    now += CONFIRM_COOLDOWN_MS + 1;
    expect(await svc.resendConfirmation(id, "user:1")).toEqual({ sent: true });
    await svc.confirm(tokenIn(mail));
    await expect(svc.resendConfirmation(id, "user:1")).rejects.toMatchObject({ code: "conflict" });
  });
  it("si el correo no sale, la confirmación queda registrada como fallida (con motivo) y no se pierde la suscripción", async () => {
    const { svc, store, mail } = make();
    mail.ok = false;
    await svc.subscribe(input("ana@example.com"));
    expect(store.subs).toHaveLength(1);
    expect(store.mailRows[0]).toMatchObject({ kind: "confirm", status: "failed", error: "buzón rechazado" });
  });
  it("si falla el CRM, la suscripción se activa igualmente y el fallo queda visible para reintentarlo", async () => {
    const { svc, store, mail, crm } = make();
    crm.fail = true;
    await svc.subscribe(input("ana@example.com"));
    await svc.confirm(tokenIn(mail));
    const s = store.subs[0];
    expect(s.status).toBe("active");
    expect(s.crmSyncError).toContain("crm caído");
    crm.fail = false;
    await svc.retryCrm(s.id, "user:1");
    expect(store.subs[0]).toMatchObject({ crmSyncError: null, clientId: 1 });
  });
  it("bienvenida fallida: el reintento manual la reenvía una sola vez y la clave no se repite", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    const t = tokenIn(mail);
    mail.ok = false;
    await svc.confirm(t);
    const id = store.subs[0].id;
    expect(store.subs[0].welcomeSentAt).toBeNull();
    expect(store.mailRows.filter((m) => m.kind === "welcome")).toHaveLength(1);
    expect(await svc.sendWelcome(id, "auto")).toMatchObject({ sent: false, reason: "already_attempted" });
    mail.ok = true;
    expect(await svc.sendWelcome(id, "manual", "user:1")).toEqual({ sent: true, reason: undefined });
    expect(await svc.sendWelcome(id, "manual", "user:1")).toMatchObject({ sent: false, reason: "already_sent" });
    expect(new Set(store.mailRows.map((m) => m.key)).size).toBe(store.mailRows.length);
  });
});

describe("baja y reactivación", () => {
  async function active() {
    const ctx = make();
    await ctx.svc.subscribe(input("ana@example.com"));
    await ctx.svc.confirm(tokenIn(ctx.mail));
    return ctx;
  }
  it("la baja por enlace retira la suscripción y el consentimiento de marketing, y es idempotente", async () => {
    const { svc, store, crm } = await active();
    const id = store.subs[0].id;
    const tok = unsubscribeToken(id, "t12-quantum-soulrise", SECRET);
    expect(await svc.unsubscribeByToken(tok, [SECRET], verifyUnsubscribeToken)).toBe(true);
    expect(store.subs[0]).toMatchObject({ status: "unsubscribed", unsubscribedAt: now });
    expect(crm.consent.get(1)).toBe("withdrawn");
    expect(await svc.unsubscribeByToken(tok, [SECRET], verifyUnsubscribeToken)).toBe(true);
    expect((await store.events(id)).filter((e) => e.action === "unsubscribed")).toHaveLength(1);
  });
  it("un enlace de baja de otra empresa, manipulado o sin firma no vale", async () => {
    const { svc, store } = await active();
    const id = store.subs[0].id;
    expect(await svc.unsubscribeByToken(unsubscribeToken(id, "otra-empresa", SECRET), [SECRET], verifyUnsubscribeToken)).toBe(false);
    expect(await svc.unsubscribeByToken(`${id}.${"A".repeat(32)}`, [SECRET], verifyUnsubscribeToken)).toBe(false);
    expect(await svc.unsubscribeByToken(`${id + 1}.${unsubscribeToken(id, "t12-quantum-soulrise", SECRET).split(".")[1]}`, [SECRET], verifyUnsubscribeToken)).toBe(false);
    expect(await svc.unsubscribeByToken(undefined, [SECRET], verifyUnsubscribeToken)).toBe(false);
    expect(store.subs[0].status).toBe("active");
  });
  it("baja administrativa con motivo y trazabilidad", async () => {
    const { svc, store } = await active();
    await svc.adminUnsubscribe(store.subs[0].id, "A petición por teléfono", "user:7");
    expect(store.subs[0]).toMatchObject({ status: "unsubscribed", unsubscribedBy: "user:7" });
    const ev = (await store.events(store.subs[0].id)).find((e) => e.action === "admin_unsubscribed")!;
    expect(ev).toMatchObject({ actor: "user:7" });
    expect(ev.detail).toContain("A petición por teléfono");
  });
  it("reactivar exige consentimiento nuevo + confirmación: no hay forma de activar sin ello", async () => {
    const { svc, store, mail, crm } = await active();
    await svc.adminUnsubscribe(store.subs[0].id, "prueba", "user:1");
    await expect(svc.subscribe(input("ana@example.com", { consent: false }))).rejects.toMatchObject({ code: "no_consent" });
    expect(store.subs[0].status).toBe("unsubscribed");
    now += 86_400_000; // la reactivación llega otro día
    await svc.subscribe(input("ana@example.com"));
    expect(store.subs[0].status).toBe("pending"); // no activa hasta confirmar
    expect(crm.consent.get(1)).toBe("withdrawn");
    await svc.confirm(tokenIn(mail));
    expect(store.subs[0].status).toBe("active");
    expect(crm.consent.get(1)).toBe("granted");
    expect(mail.sent.filter((m) => m.idempotencyKey.startsWith("nl:welcome"))).toHaveLength(2); // una bienvenida por ciclo confirmado
  });
  it("no existe ninguna operación de activación para el personal", () => {
    const proto = Object.getOwnPropertyNames(NewsletterService.prototype);
    expect(proto.filter((n) => /activ|reactiv/i.test(n))).toEqual([]);
  });
});

describe("aislamiento entre empresas", () => {
  it("cada empresa tiene su almacén: la misma dirección no se mezcla, y el enlace de baja de una no vale en otra", async () => {
    const a = make("empresa-a");
    const b = make("empresa-b");
    await a.svc.subscribe(input("ana@example.com"));
    expect(a.store.subs).toHaveLength(1);
    expect(b.store.subs).toHaveLength(0);
    await a.svc.confirm(tokenIn(a.mail));
    const tokA = unsubscribeToken(a.store.subs[0].id, "empresa-a", SECRET);
    await b.svc.subscribe(input("ana@example.com"));
    await b.svc.confirm(tokenIn(b.mail));
    expect(await b.svc.unsubscribeByToken(tokA, [SECRET], verifyUnsubscribeToken)).toBe(false);
    expect(b.store.subs[0].status).toBe("active");
  });
});

describe("correos", () => {
  it("escapan el HTML de la configuración y llevan baja + datos de identificación", () => {
    const t = resolveTemplate("welcome", "es", { welcome: { es: { subject: "Hola <b>", body: "Línea <script>alert(1)</script>\n\nSegundo & último" } } });
    const m = renderMail(t, "es", { brand: "Quantum <X>", legalLine: "S.L. · CIF B1" }, { unsubscribeUrl: "https://q.example/newsletter/baja/1.abc" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Quantum &lt;X&gt;");
    expect(m.html).toContain("https://q.example/newsletter/baja/1.abc");
    expect(m.html).toContain("CIF B1");
    expect(m.text).toContain("Darme de baja");
  });
  it("la plantilla guardada manda sobre la de fábrica, campo a campo, y hay textos en de/es/en", () => {
    expect(resolveTemplate("welcome", "es", {}).subject).toBe("Bienvenida a Quantum Soulrise ✨");
    expect(resolveTemplate("welcome", "es", { welcome: { es: { subject: "Otro asunto" } } })).toMatchObject({ subject: "Otro asunto", body: DEFAULT_WELCOME.es.body });
    for (const l of ["de", "es", "en"] as const) expect(resolveTemplate("confirm", l, {}).body.length).toBeGreaterThan(30);
  });
  it("normalizeEmail", () => {
    expect(normalizeEmail(" Ana.B+x@Sub.Example.es ")).toBe("ana.b+x@sub.example.es");
    expect(normalizeEmail("a@b.c")).toBeNull();
    expect(normalizeEmail("x".repeat(250) + "@a.es")).toBeNull();
  });
});

describe("exportación", () => {
  const rows: ExportRow[] = [
    { email: "ana@example.com", status: "active", source: "web:inicio", locale: "es", createdAt: Date.UTC(2026, 10, 1, 10, 0, 0), confirmedAt: Date.UTC(2026, 10, 1, 10, 5, 0), unsubscribedAt: null, consentVersion: "abc123def456" },
    { email: "=HYPERLINK(\"http://x\")@evil.com", status: "pending", source: "+cmd", locale: "de", createdAt: Date.UTC(2026, 10, 2), confirmedAt: null, unsubscribedAt: null, consentVersion: null },
    { email: "mártir@ñandú.es", status: "unsubscribed", source: "@web", locale: "es", createdAt: Date.UTC(2026, 10, 3), confirmedAt: Date.UTC(2026, 10, 3), unsubscribedAt: Date.UTC(2026, 10, 4), consentVersion: "z" },
  ];
  it("CSV: BOM UTF-8, separador «;», acentos intactos y fórmulas neutralizadas", () => {
    const csv = toCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Email";"Estado";"Origen";"Idioma"');
    expect(csv).toContain('"mártir@ñandú.es"');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")@evil.com"`);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).toContain(`"'@web"`);
    expect(csv).toContain('"2026-11-01 10:00:00"');
    expect(csv).not.toMatch(/token|hash|secret/i);
  });
  it("Excel: libro válido, todo texto (sin fórmulas), acentos y neutralización", () => {
    const wb = XLSX.read(toXlsx(rows), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(data[0]).toEqual(["Email", "Estado", "Origen", "Idioma", "Fecha de inscripción", "Fecha de confirmación", "Fecha de baja", "Versión del texto aceptado"]);
    expect(data[1][0]).toBe("ana@example.com");
    expect(data[2][0]).toBe(`'=HYPERLINK("http://x")@evil.com`);
    expect(data[3][0]).toBe("mártir@ñandú.es");
    for (const addr of Object.keys(ws).filter((k) => k[0] !== "!")) {
      expect((ws[addr] as XLSX.CellObject).f).toBeUndefined();
      expect((ws[addr] as XLSX.CellObject).t).toBe("s");
    }
  });
  it("safeCell neutraliza = + - @ tabulador y retorno", () => {
    for (const v of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) expect(safeCell(v)).toBe(`'${v}`);
    expect(safeCell("normal")).toBe("normal");
  });
  it("exportar deja constancia de quién, cuándo y con qué filtros, y exporta TODO el filtro (no una página)", async () => {
    const { svc, store, mail } = make();
    for (let i = 0; i < 30; i++) {
      await svc.subscribe({ ...input(`u${i}@example.com`), locale: i % 2 ? "de" : "es" });
      now += 1;
    }
    void mail;
    const out = await svc.exportRows({ locale: "de" }, "csv", { id: 5, name: "Admin" });
    expect(out).toHaveLength(15);
    expect(out.every((r) => r.locale === "de")).toBe(true);
    expect(store.exports).toEqual([{ actorId: 5, actor: "Admin", format: "csv", rows: 15, filters: '{"locale":"de"}' }]);
    expect(Object.keys(out[0]).sort()).toEqual(["confirmedAt", "consentVersion", "createdAt", "email", "locale", "source", "status", "unsubscribedAt"]);
  });
});

describe("huella y versión del texto", () => {
  it("la versión cambia con el texto y la huella del enlace no es el enlace", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(input("ana@example.com"));
    const t = tokenIn(mail);
    expect(sha256(t)).toHaveLength(64);
    expect(JSON.stringify(store.subs[0])).not.toContain(t);
    const v1 = store.subs[0].consentVersion;
    const { svc: svc2, store: s2 } = make();
    await svc2.subscribe({ ...input("ana@example.com"), consentText: CONSENT + " (v2)" });
    expect(s2.subs[0].consentVersion).not.toBe(v1);
  });
});

void NewsletterError;
