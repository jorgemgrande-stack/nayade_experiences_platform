/**
 * Newsletter · listas por idioma, contacto único, importación histórica y audiencias de Campaigns (migración 0099).
 * Política de idioma (ruta → traducción servida → pista → principal; nunca país/IP), idioma de alta inmutable, reglas de
 * re-inscripción por estado, cambio de idioma desde el panel, importación sin correos ni consentimientos, exportación por
 * lista, audiencia por segmento, baja propagada desde el CRM, aislamiento entre empresas y permisos del router.
 * Datos sintéticos (dominios .invalid / example.com); ningún correo real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as XLSX from "xlsx";
import { TRPCError } from "@trpc/server";
import { listLabel, listLocales, localeOfSegment, pathLocale, resolveSignupLocale, segmentIdFor } from "../shared/newsletterLocalePolicy";
import { NEWSLETTER_IMPORT_MAX_ROWS, parseNewsletterImport } from "../shared/newsletterImport";
import { templateLocale } from "./newsletter/core";
import { NewsletterService, type CrmPort, type MailPort, type TenantLocales } from "./newsletter/service";
import { MemoryNewsletterStore } from "./newsletter/memoryStore";
import { NewsletterImporter, planNewsletterImport } from "./newsletter/import";
import { MemoryCampaignStore } from "./connectCampaigns/store";
import { planAudience } from "./connectCampaigns/plan";

vi.mock("./_core/rbac", () => ({
  checkRbacOrLegacy: async (_id: number, role: string) => role === "admin",
  getUserPermissions: async () => [],
}));
vi.mock("./newsletter/runtime", () => ({
  newsletterService: () => ({ lists: async () => [] }),
  newsletterImporter: () => ({ apply: async () => ({ importId: 1 }), preview: async () => ({}) }),
  unsubscribeSecrets: () => ["s"],
  ipSecret: () => "x".repeat(40),
  identity: () => ({ brand: "Q", legalLine: "" }),
  tenantLocales: async () => ({ tenantLocales: ["de", "es"], defaultLocale: "de" }),
}));

class FakeCrm implements CrmPort {
  clients = new Map<string, number>();
  consent = new Map<number, "granted" | "withdrawn">();
  async grant(email: string) {
    let id = this.clients.get(email);
    if (!id) {
      id = this.clients.size + 1;
      this.clients.set(email, id);
    }
    this.consent.set(id, "granted");
    return id;
  }
  async withdraw(clientId: number) {
    this.consent.set(clientId, "withdrawn");
  }
}
class FakeMail implements MailPort {
  sent: Array<{ to: string; subject: string; html: string; text: string; idempotencyKey: string }> = [];
  async send(m: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
    this.sent.push(m);
    return { ok: true };
  }
}
const QUANTUM: TenantLocales = { tenantLocales: ["de", "es"], defaultLocale: "de" };
const CONSENT = "Ich möchte den Newsletter erhalten und stimme der Datenschutzerklärung zu.";
let now = 1_800_000_000_000;
function make(tenant: TenantLocales = QUANTUM, tenantId = "quantum") {
  const store = new MemoryNewsletterStore();
  const crm = new FakeCrm();
  const mail = new FakeMail();
  const svc = new NewsletterService({ store, crm, mail, tenantId, now: () => now, secrets: () => ["s".repeat(40)], baseUrl: () => "https://q.invalid", identity: () => ({ brand: "Quantum", legalLine: "Quantum S.L." }), locales: async () => tenant });
  const importer = new NewsletterImporter(store, async () => tenant, () => now);
  return { svc, store, crm, mail, importer };
}
const alta = (email: string, o: { page?: string; locale?: string; blockLocale?: string | null } = {}) => ({ email, consent: true, locale: o.locale ?? "de", blockLocale: o.blockLocale ?? null, page: o.page ?? "/", source: "web:inicio", consentText: CONSENT, ipHash: null });
const tokenIn = (mail: FakeMail) => /\/newsletter\/confirmar\/([A-Za-z0-9_-]{43})/.exec(mail.sent.filter((m) => m.idempotencyKey.startsWith("nl:confirm")).at(-1)!.text)![1];
const csv = (rows: string[]) => rows.join("\r\n") + "\r\n";

beforeEach(() => {
  now = 1_800_000_000_000;
});

describe("política de idioma (pura)", () => {
  const t = { tenantLocales: ["de", "es"], defaultLocale: "de" };
  it("prefijo de ruta → traducción del bloque → pista → principal; nunca otra cosa", () => {
    expect(resolveSignupLocale({ pagePath: "/es/inicio", hint: "en", ...t })).toEqual({ locale: "es", basis: "path" });
    expect(resolveSignupLocale({ pagePath: "/", blockLocale: "es", hint: "de", ...t })).toEqual({ locale: "es", basis: "block" });
    expect(resolveSignupLocale({ pagePath: "/", hint: "es", ...t })).toEqual({ locale: "es", basis: "hint" });
    expect(resolveSignupLocale({ pagePath: "/", hint: "en", ...t })).toEqual({ locale: "de", basis: "default" }); // «en» no es público: cae al principal
    expect(resolveSignupLocale({ pagePath: "/en/start", hint: "en", ...t })).toEqual({ locale: "de", basis: "default" });
    expect(resolveSignupLocale({ pagePath: "/ES/", hint: undefined, ...t })).toEqual({ locale: "es", basis: "path" });
    expect(resolveSignupLocale({ pagePath: "/escuela", hint: "de", ...t })).toEqual({ locale: "de", basis: "hint" }); // «escuela» no es un prefijo de idioma
    expect(resolveSignupLocale({ pagePath: null, hint: { country: "ES" }, ...t })).toEqual({ locale: "de", basis: "default" });
  });
  it("instalación sin multidioma: solo el principal", () => {
    expect(resolveSignupLocale({ pagePath: "/de/x", hint: "de", tenantLocales: ["es"], defaultLocale: "es" })).toEqual({ locale: "es", basis: "default" });
  });
  it("segmentos, etiquetas y unión de idiomas", () => {
    expect(pathLocale("/pt-br/x")).toBe("pt-br");
    expect(pathLocale("/")).toBeNull();
    expect(segmentIdFor("de")).toBe("newsletter-de");
    expect(localeOfSegment("newsletter-es")).toBe("es");
    expect(localeOfSegment("newsletter-")).toBeNull();
    expect(localeOfSegment("otra-es")).toBeNull();
    expect(listLabel("de", "es")).toBe("Newsletter Alemán");
    expect(listLabel("es", "de")).toBe("Newsletter Spanisch");
    expect(listLocales(["de", "es"], ["en", "es"], "de")).toEqual(["de", "es", "en"]);
  });
  it("plantilla: idioma propio, si no el principal de la empresa, si no alemán", () => {
    expect(templateLocale("es")).toBe("es");
    expect(templateLocale("pt", "es")).toBe("es");
    expect(templateLocale("pt", "fr")).toBe("de");
  });
});

describe("alta desde la web por idioma", () => {
  it("(1) web alemana → lista newsletter-de con idioma de alta de", async () => {
    const { svc, store } = make();
    await svc.subscribe(alta("anna@example.com", { page: "/", locale: "de" }));
    const s = store.subs[0];
    expect(s).toMatchObject({ locale: "de", signupLocale: "de", localeSource: "web", status: "pending" });
    expect((await store.events(s.id))[0].detail).toContain("newsletter-de");
  });
  it("(2) web española (ruta /es/) → newsletter-es", async () => {
    const { svc, store } = make();
    await svc.subscribe(alta("ana@example.com", { page: "/es/inicio", locale: "es" }));
    expect(store.subs[0]).toMatchObject({ locale: "es", signupLocale: "es" });
  });
  it("(3) pista manipulada: locale «en» con ruta /es/ → gana la ruta; sin ruta ni traducción, «en» cae al principal", async () => {
    const { svc, store } = make();
    await svc.subscribe(alta("x1@example.com", { page: "/es/", locale: "en" }));
    await svc.subscribe(alta("x2@example.com", { page: "/", locale: "en" }));
    await svc.subscribe(alta("x3@example.com", { page: "/", locale: "de", blockLocale: "es" }));
    expect(store.subs.map((s) => s.locale)).toEqual(["es", "de", "es"]);
  });
  it("(4) confirmación y bienvenida en el idioma del suscriptor (es) y en el principal cuando el idioma no tiene plantilla", async () => {
    const { svc, store, mail } = make({ tenantLocales: ["de", "es", "pt"], defaultLocale: "de" });
    await svc.subscribe(alta("ana@example.com", { page: "/es/", locale: "es" }));
    expect(mail.sent[0].subject).toBe("Confirma tu inscripción a la newsletter");
    expect(await svc.confirm(tokenIn(mail))).toEqual({ state: "confirmed", locale: "es" });
    expect(mail.sent.at(-1)!.subject).toBe("Bienvenida a Quantum Soulrise ✨");
    expect(store.subs[0].status).toBe("active");
    await svc.subscribe(alta("pt@example.com", { page: "/pt/", locale: "pt" }));
    expect(store.subs[1].locale).toBe("pt");
    expect(mail.sent.at(-1)!.subject).toBe("Bitte bestätige deine Anmeldung zum Newsletter"); // sin plantilla pt → principal (de)
  });
});

describe("(5) contacto único por correo", () => {
  it("activo que vuelve a inscribirse desde otra web: sin cambios de idioma ni consentimiento, sin correo, con evento", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" }));
    await svc.confirm(tokenIn(mail));
    const before = { mails: mail.sent.length, version: store.subs[0].consentVersion };
    await svc.subscribe({ ...alta("ANA@example.com", { page: "/es/", locale: "es" }), consentText: "Otro texto legal distinto para la prueba." });
    expect(store.subs).toHaveLength(1);
    expect(store.subs[0]).toMatchObject({ locale: "de", signupLocale: "de", consentVersion: before.version, status: "active" });
    expect(mail.sent).toHaveLength(before.mails);
    const ev = (await store.events(1)).find((e) => e.action === "resignup_ignored")!;
    expect(ev.detail).toContain("pedido es");
  });
  it("pendiente que se inscribe desde otro idioma: cambia de lista (origen «subscriber»), conserva el idioma de alta y reenvía", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" }));
    now += 3 * 60_000;
    await svc.subscribe(alta("ana@example.com", { page: "/es/", locale: "es" }));
    expect(store.subs[0]).toMatchObject({ status: "pending", locale: "es", signupLocale: "de", localeSource: "subscriber" });
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1].subject).toBe("Confirma tu inscripción a la newsletter");
    expect((await store.events(1)).some((e) => e.action === "updated" && e.detail?.includes("de → es"))).toBe(true);
  });
  it("baja que vuelve: nuevo ciclo pendiente con el idioma nuevo; el idioma de alta no cambia; nunca se reactiva sin confirmar", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" }));
    await svc.confirm(tokenIn(mail));
    await svc.adminUnsubscribe(1, "prueba", "user:1");
    now += 86_400_000;
    await svc.subscribe(alta("ana@example.com", { page: "/es/", locale: "es" }));
    expect(store.subs[0]).toMatchObject({ status: "pending", locale: "es", signupLocale: "de" });
  });
  it("histórico (imported) que se inscribe: pasa a pendiente con el consentimiento de la petición, conserva nombre, lote e historial, y recibe la confirmación", async () => {
    const { svc, store, mail, importer } = make();
    await importer.apply({ format: "csv", fileName: "h.csv", content: csv(["email;nombre", "ana@example.com;Ana Pérez"]), label: "lote-2024", defaultLocale: "es", fingerprint: (await importer.preview({ format: "csv", fileName: "h.csv", content: csv(["email;nombre", "ana@example.com;Ana Pérez"]), label: "lote-2024", defaultLocale: "es" })).fingerprint }, "user:1");
    expect(store.subs[0]).toMatchObject({ status: "imported", name: "Ana Pérez", importId: 1, locale: "es", signupLocale: null });
    expect(mail.sent).toHaveLength(0);
    await svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" }));
    expect(store.subs).toHaveLength(1);
    expect(store.subs[0]).toMatchObject({ status: "pending", locale: "de", signupLocale: "de", name: "Ana Pérez", importId: 1, consentText: CONSENT });
    expect(mail.sent).toHaveLength(1);
    expect((await store.events(1)).map((e) => e.action)).toEqual(["imported", "requested"]);
    await svc.confirm(tokenIn(mail));
    expect(store.subs[0].status).toBe("active");
  });
});

describe("(6) cambio de idioma desde el panel", () => {
  it("solo a un idioma público de la empresa; queda locale_source = admin y el idioma de alta intacto", async () => {
    const { svc, store } = make();
    await svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" }));
    await svc.updateLocale(1, "es", "user:7");
    expect(store.subs[0]).toMatchObject({ locale: "es", signupLocale: "de", localeSource: "admin" });
    expect((await store.events(1)).at(-1)).toMatchObject({ action: "updated", actor: "user:7" });
    await expect(svc.updateLocale(1, "en", "user:7")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updateLocale(1, "xx-yy", "user:7")).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("listas: una por idioma público ∪ idiomas presentes, con recuentos", async () => {
    const { svc, store } = make();
    await svc.subscribe(alta("a@example.com", { page: "/", locale: "de" }));
    await svc.subscribe(alta("b@example.com", { page: "/es/", locale: "es" }));
    store.subs.push({ ...store.subs[0], id: 99, email: "viejo@example.com", locale: "en", status: "unsubscribed" });
    const lists = await svc.lists();
    expect(lists.map((l) => l.id)).toEqual(["newsletter-de", "newsletter-es", "newsletter-en"]);
    expect(lists[0]).toMatchObject({ locale: "de", label: "Newsletter Alemán", labelDe: "Newsletter Deutsch", isDefault: true, isPublic: true, pending: 1, total: 1 });
    expect(lists[2]).toMatchObject({ isPublic: false, unsubscribed: 1 });
  });
});

describe("importación histórica (preparada, sin correos)", () => {
  const T = { defaultLocale: "de", tenantLocales: ["de", "es"] };
  it("lee CSV con alias de cabecera, nombre compuesto, idioma solo si es de la empresa, duplicados y correos no válidos", () => {
    const p = parseNewsletterImport({ format: "csv", text: csv(["E-Mail;Vorname;Nachname;Sprache;Telefon", "Anna@Example.com;Anna;Müller;de;123", "ana@example.com;Ana;;es;", "ANNA@example.com;Otra;;de;", "noesuncorreo;X;;;", "eng@example.com;E;;en;", "'=1+1@example.com;;;;"]) }, T);
    expect(p.rows.map((r) => [r.email, r.name, r.locale])).toEqual([
      ["anna@example.com", "Anna Müller", "de"],
      ["ana@example.com", "Ana", "es"],
      ["eng@example.com", "E", "de"], // «en» no es de la empresa → idioma del lote
      ["=1+1@example.com", null, "de"],
    ]);
    expect(p.rejected.map((r) => r.reason)).toEqual(["duplicate", "invalid_email"]);
    expect(p.columns).toEqual(["E-Mail", "Vorname", "Nachname", "Sprache"]);
    expect(p.ignored).toEqual(["Telefon"]);
  });
  it("lee Excel (.xlsx) en base64 y exige una columna de correo; respeta el tope de filas", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Correo", "Nombre"], ["uno@example.com", "Uno"], ["", ""], ["dos@example.com", "Dos"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    const b64 = (XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");
    const p = parseNewsletterImport({ format: "xlsx", base64: b64 }, T);
    expect(p.rows.map((r) => r.email)).toEqual(["uno@example.com", "dos@example.com"]);
    expect(() => parseNewsletterImport({ format: "csv", text: csv(["nombre", "Ana"]) }, T)).toThrow(/columna de correo/);
    const many = csv(["email", ...Array.from({ length: NEWSLETTER_IMPORT_MAX_ROWS + 1 }, (_, i) => `u${i}@example.com`)]);
    expect(() => parseNewsletterImport({ format: "csv", text: many }, T)).toThrow(/máximo por lote/);
  });
  it("(9) histórico sin consentimiento → imported: sin cliente nuevo, sin consentimiento, sin correo, con evento y lote", async () => {
    const { store, crm, mail, importer } = make();
    store.crmClients.set("cliente@example.com", 42); // ya era cliente del CRM: se enlaza, no se crea
    const input = { format: "csv" as const, fileName: "historico.csv", content: csv(["email;nombre", "nuevo@example.com;Nuevo", "cliente@example.com;Cliente"]), label: "Histórico DE", defaultLocale: "de" };
    const pre = await importer.preview(input);
    expect(pre.plan.counts).toMatchObject({ create: 2, total: 2 });
    const r = await importer.apply({ ...input, fingerprint: pre.fingerprint }, "user:1");
    expect(r).toMatchObject({ importId: 1, created: 2, matched: 0, rejected: 0, sendMails: false });
    expect(store.subs.map((s) => [s.email, s.status, s.locale, s.localeSource, s.source, s.clientId])).toEqual([
      ["nuevo@example.com", "imported", "de", "import", "import:Histórico DE", null],
      ["cliente@example.com", "imported", "de", "import", "import:Histórico DE", 42],
    ]);
    expect(crm.clients.size).toBe(0);
    expect(crm.consent.size).toBe(0);
    expect(mail.sent).toHaveLength(0);
    expect((await store.events(1)).map((e) => e.action)).toEqual(["imported"]);
    expect((await store.imports(10))[0]).toMatchObject({ label: "Histórico DE", createdCount: 2, rowCount: 2, sendMails: false });
    expect((await store.stats()).imported).toBe(2);
  });
  it("(7) el mismo contacto en dos ficheros (ES y DE) → una sola fila; el segundo lote lo registra como match_imported y solo rellena el nombre vacío", async () => {
    const { store, importer } = make();
    const es = { format: "csv" as const, fileName: "es.csv", content: csv(["email", "ana@example.com"]), label: "lote-es", defaultLocale: "es" };
    await importer.apply({ ...es, fingerprint: (await importer.preview(es)).fingerprint }, "user:1");
    const de = { format: "csv" as const, fileName: "de.csv", content: csv(["email;name", "ana@example.com;Ana", "neu@example.com;Neu"]), label: "lote-de", defaultLocale: "de" };
    const pre = await importer.preview(de);
    expect(pre.plan.counts).toMatchObject({ create: 1, match_imported: 1 });
    expect(pre.sample.match_imported[0].reason).toContain("se añade el nombre");
    await importer.apply({ ...de, fingerprint: pre.fingerprint }, "user:1");
    expect(store.subs.filter((s) => s.email === "ana@example.com")).toHaveLength(1);
    expect(store.subs[0]).toMatchObject({ locale: "es", name: "Ana", importId: 1 }); // conserva su lista y su lote
    expect(store.batches[1]).toMatchObject({ createdCount: 1, matchedCount: 1 });
  });
  it("(8) repetir el mismo fichero → 0 creados, todo coincidencias; la huella ata vista previa y aplicación; sendMails=true se rechaza", async () => {
    const { store, importer } = make();
    const i = { format: "csv" as const, fileName: "h.csv", content: csv(["email", "a@example.com", "b@example.com"]), label: "hist", defaultLocale: "de" };
    const pre = await importer.preview(i);
    await importer.apply({ ...i, fingerprint: pre.fingerprint }, "user:1");
    const again = await importer.apply({ ...i, fingerprint: pre.fingerprint }, "user:1");
    expect(again).toMatchObject({ created: 0, matched: 2 });
    expect(store.subs).toHaveLength(2);
    await expect(importer.apply({ ...i, defaultLocale: "es", fingerprint: pre.fingerprint }, "user:1")).rejects.toMatchObject({ code: "conflict" });
    await expect(importer.apply({ ...i, fingerprint: pre.fingerprint, sendMails: true }, "user:1")).rejects.toThrow(/no está autorizado en esta fase/);
    await expect(importer.preview({ ...i, defaultLocale: "en" })).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("(10) una baja anterior a la importación prevalece; un activo y un pendiente no se tocan", async () => {
    const { svc, store, mail, importer } = make();
    await svc.subscribe(alta("baja@example.com"));
    await svc.confirm(tokenIn(mail));
    await svc.adminUnsubscribe(1, "no quiere", "user:1");
    await svc.subscribe(alta("activo@example.com", { page: "/es/" }));
    await svc.confirm(tokenIn(mail));
    await svc.subscribe(alta("pend@example.com"));
    const i = { format: "csv" as const, fileName: "h.csv", content: csv(["email;nombre", "baja@example.com;B", "activo@example.com;A", "pend@example.com;P"]), label: "hist", defaultLocale: "de" };
    const pre = await importer.preview(i);
    expect(pre.plan.counts).toMatchObject({ create: 0, match_unsubscribed: 1, match_active: 1, match_pending: 1 });
    const sent = mail.sent.length;
    await importer.apply({ ...i, fingerprint: pre.fingerprint }, "user:1");
    expect(store.subs.map((s) => s.status)).toEqual(["unsubscribed", "active", "pending"]);
    expect(store.subs[1].locale).toBe("es");
    expect(store.subs.map((s) => s.name)).toEqual(["B", "A", "P"]);
    expect(mail.sent).toHaveLength(sent);
  });
  it("planNewsletterImport es puro: rechazados primero y recuentos", () => {
    const parsed = parseNewsletterImport({ format: "csv", text: csv(["email", "x", "a@example.com"]) }, T);
    const plan = planNewsletterImport(parsed, new Map(), { defaultLocale: "de", label: "l" });
    expect(plan.rows.map((r) => r.action)).toEqual(["reject", "create"]);
    expect(plan.counts).toMatchObject({ reject: 1, create: 1, total: 2 });
  });
});

describe("(11) exportación por lista", () => {
  it("dos listas → dos ficheros con filas distintas; `filters` registra lo que se pidió (list)", async () => {
    const { svc, store } = make();
    await svc.subscribe(alta("a@example.com", { page: "/", locale: "de" }));
    await svc.subscribe(alta("b@example.com", { page: "/es/", locale: "es" }));
    await svc.subscribe(alta("c@example.com", { page: "/es/x", locale: "es" }));
    const de = await svc.exportRows({ list: "newsletter-de" }, "csv", { id: 1, name: "Admin" });
    const es = await svc.exportRows({ list: "newsletter-es" }, "xlsx", { id: 1, name: "Admin" });
    expect(de.map((r) => r.email)).toEqual(["a@example.com"]);
    expect(es.map((r) => r.email).sort()).toEqual(["b@example.com", "c@example.com"]);
    expect(de[0]).toMatchObject({ locale: "de", signupLocale: "de", name: null });
    expect(store.exports).toEqual([
      { actorId: 1, actor: "Admin", format: "csv", rows: 1, filters: '{"list":"newsletter-de"}' },
      { actorId: 1, actor: "Admin", format: "xlsx", rows: 2, filters: '{"list":"newsletter-es"}' },
    ]);
  });
});

describe("(12) audiencia de Campaigns por lista de la newsletter", () => {
  it("confirmados DE, ES o todos; fuera bajas, pendientes, históricos y consentimientos retirados; las campañas por etiquetas siguen igual", async () => {
    const s = new MemoryCampaignStore();
    const add = (id: number, email: string, consent: "granted" | "withdrawn", nl?: { status: "pending" | "active" | "unsubscribed" | "imported"; locale: string }) => {
      s.clients.push({ id, email, name: null });
      s.consents.set(id, consent);
      if (nl) s.newsletter.push({ email, ...nl });
    };
    add(1, "de1@example.com", "granted", { status: "active", locale: "de" });
    add(2, "de2@example.com", "granted", { status: "active", locale: "de" });
    add(3, "es1@example.com", "granted", { status: "active", locale: "es" });
    add(4, "pend@example.com", "granted", { status: "pending", locale: "de" });
    add(5, "baja@example.com", "granted", { status: "unsubscribed", locale: "de" });
    add(6, "hist@example.com", "granted", { status: "imported", locale: "de" });
    add(7, "retirado@example.com", "withdrawn", { status: "active", locale: "es" });
    add(8, "soloCrm@example.com", "granted");
    const aud = async (locale: string | null) => planAudience(await s.audience([], "any", { kind: "newsletter", newsletterLocale: locale }), await s.withdrawnEmails());
    expect((await aud("de")).recipients.map((r) => r.email)).toEqual(["de1@example.com", "de2@example.com"]);
    expect((await aud("es")).recipients.map((r) => r.email)).toEqual(["es1@example.com"]);
    expect((await aud(null)).recipients.map((r) => r.email)).toEqual(["de1@example.com", "de2@example.com", "es1@example.com"]);
    expect(planAudience(await s.audience([], "any"), await s.withdrawnEmails()).recipients).toHaveLength(7); // por etiquetas: todos los que tienen consentimiento
  });
});

describe("baja propagada desde el CRM (Brevo marketing / enlace público)", () => {
  it("al retirarse el consentimiento del cliente, el suscriptor activo queda de baja con `crm:withdrawn`; sin suscriptor no pasa nada", async () => {
    const { svc, store, mail } = make();
    await svc.subscribe(alta("ana@example.com"));
    await svc.confirm(tokenIn(mail));
    const clientId = store.subs[0].clientId!;
    expect(await svc.onCrmWithdrawn(clientId, "Ana@Example.com")).toEqual({ unsubscribed: 1 });
    expect(store.subs[0]).toMatchObject({ status: "unsubscribed", unsubscribedBy: "crm:withdrawn" });
    expect((await store.events(1)).at(-1)).toMatchObject({ action: "unsubscribed", actor: "crm:withdrawn" });
    expect(await svc.onCrmWithdrawn(clientId, null)).toEqual({ unsubscribed: 0 });
    expect(await svc.onCrmWithdrawn(999, "nadie@example.com")).toEqual({ unsubscribed: 0 });
  });
  it("el gancho de Brevo marketing avisa a la newsletter con import diferido", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./brevoMarketing/runtime.ts", import.meta.url), "utf8");
    expect(src).toContain('import("../newsletter/runtime")');
    expect(src).toContain("onCrmConsentWithdrawn");
  });
});

describe("(13) aislamiento entre empresas", () => {
  it("cada empresa tiene sus listas: la misma dirección en dos empresas no se mezcla ni comparte recuentos", async () => {
    const a = make({ tenantLocales: ["de", "es"], defaultLocale: "de" }, "empresa-a");
    const b = make({ tenantLocales: ["es"], defaultLocale: "es" }, "empresa-b");
    await a.svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" }));
    await b.svc.subscribe(alta("ana@example.com", { page: "/", locale: "de" })); // en B no existe el alemán: cae al principal (es)
    expect((await a.svc.lists()).map((l) => [l.id, l.total])).toEqual([["newsletter-de", 1], ["newsletter-es", 0]]);
    expect((await b.svc.lists()).map((l) => [l.id, l.total])).toEqual([["newsletter-es", 1]]);
    expect(b.store.subs[0].locale).toBe("es");
  });
});

describe("(14) permisos del router", () => {
  const ctx = (role: string | null) => ({ user: role ? ({ id: 5, role, name: "P", email: "p@example.invalid" } as never) : null, req: { protocol: "https", headers: {}, socket: {} } as never, res: { clearCookie: () => {}, cookie: () => {} } as never });
  it("lists, importPreview, importApply e imports exigen rol de administrador (FORBIDDEN para otro rol, UNAUTHORIZED sin sesión)", async () => {
    const { newsletterRouter } = await import("./newsletter/router");
    const caller = newsletterRouter.createCaller(ctx("employee"));
    const body = { format: "csv" as const, fileName: "h.csv", content: "email\r\na@example.com\r\n", label: "lote", defaultLocale: "de" };
    for (const p of [() => caller.lists(), () => caller.imports(), () => caller.importPreview(body), () => caller.importApply({ ...body, fingerprint: "x".repeat(32) })]) {
      await expect(p()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(newsletterRouter.createCaller(ctx(null)).lists()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const admin = newsletterRouter.createCaller(ctx("admin"));
    expect(await admin.lists()).toEqual([]);
    await expect(admin.importApply({ ...body, fingerprint: "x".repeat(32), sendMails: true as never })).rejects.toBeInstanceOf(TRPCError); // el esquema solo admite false
  });
});
