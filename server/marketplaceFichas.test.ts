/**
 * Marketplace del panel (Elephant Connect y Net), parte del catálogo central: campos nuevos de la ficha comercial
 * (opcionales y sin valor por defecto), sus comprobaciones, la ficha publicada que recibe el panel (`card`) y las
 * solicitudes «Solicitar información» / «Me interesa» como solicitudes del CRM. Datos sintéticos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { productDraft, type ProductDraft } from "./web/schemas";
import { commercialChecks } from "./catalog/commercial/checks";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { receivePanelRequest, PANEL_REQUEST_SOURCE } from "./commerce/panelRequests";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import type { LeadRequest } from "./crm/types";

const NOW = Date.UTC(2026, 10, 1, 12);
/** El aviso al equipo sale sin esperar (setImmediate): se deja correr antes de comprobarlo. */
const flush = () => new Promise((r) => setImmediate(r));
let site: SiteDocument;
let webStore: MemoryWebStore;

beforeAll(async () => {
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  site = await web.site("published");
});

const EXTRA = {
  valueProposition: "Tu equipo organizado desde el mismo panel.",
  coreIntegration: ["Usa los usuarios y permisos de tu Core"],
  terms: { commitment: "Sin permanencia.", cancellation: "Baja al final del periodo.", activation: "La activa nuestro equipo contigo." },
  faq: [{ q: "¿Calcula nóminas?", a: "No: registra y consulta las nóminas." }],
  related: ["connect-tax"],
  media: { screenshots: [{ src: "https://media.example/people.png", alt: "Fichajes del equipo", caption: "Control horario" }] },
};

describe("ficha comercial: campos del marketplace", () => {
  it("son opcionales y sin valor por defecto: una ficha anterior se reconstruye idéntica", async () => {
    const e = (await webStore.listEntries()).find((x) => x.kind === "product" && x.key === "connect-people")!;
    const parsed = productDraft.parse(e.draft) as ProductDraft;
    for (const k of Object.keys(EXTRA)) expect(parsed.commercial && k in parsed.commercial).toBeFalsy();
    expect(productDraft.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("aceptan contenido válido y rechazan imágenes que no son https", async () => {
    const e = (await webStore.listEntries()).find((x) => x.kind === "product" && x.key === "connect-people")!;
    const base = productDraft.parse(e.draft) as ProductDraft;
    const ok = productDraft.parse({ ...base, commercial: { ...(base.commercial ?? {}), ...EXTRA } }) as ProductDraft;
    expect(ok.commercial).toMatchObject(EXTRA);
    expect(() => productDraft.parse({ ...base, commercial: { ...(base.commercial ?? {}), media: { cover: { src: "http://inseguro.example/a.png", alt: "x" } } } })).toThrow();
    expect(() => productDraft.parse({ ...base, commercial: { ...(base.commercial ?? {}), faq: Array.from({ length: 11 }, () => ({ q: "¿Pregunta?", a: "Respuesta" })) } })).toThrow();
  });

  it("relacionados que no existen, internos o el propio producto bloquean la publicación; los textos nuevos pasan las reglas públicas", async () => {
    const entries = (await webStore.listEntries()).filter((x) => x.kind === "product").map((x) => ({ key: x.key, family: x.family, publication: x.publication, draft: productDraft.parse(x.draft) as ProductDraft }));
    const people = entries.find((x) => x.key === "connect-people")!;
    const internal = { ...entries.find((x) => x.key === "connect-voice")!, key: "interno-prueba" };
    internal.draft = { ...internal.draft, catalog: { ...internal.draft.catalog, internalOnly: true } };
    const all = [...entries, internal];
    const withCommercial = (c: Partial<NonNullable<ProductDraft["commercial"]>>) => ({ ...people, draft: { ...people.draft, commercial: { ...(people.draft.commercial ?? productDraft.parse({ ...people.draft, commercial: {} }).commercial!), ...c } } }) as typeof people;
    const blocking = (c: Partial<NonNullable<ProductDraft["commercial"]>>) => commercialChecks(withCommercial(c), all).blocking;
    expect(blocking({ related: ["no-existe"] })).toContain("el producto relacionado «no-existe» no existe");
    expect(blocking({ related: ["interno-prueba"] })).toContain("el producto relacionado «interno-prueba» es interno");
    expect(blocking({ related: ["connect-people"] })).toContain("se relaciona consigo mismo");
    expect(blocking({ related: ["connect-tax"] }).filter((b) => /relacionado/.test(b))).toEqual([]);
    expect(blocking({ faq: [{ q: "¿Hay soporte?", a: "Soporte 24/7 garantizado." }] }).some((b) => /^la ficha/.test(b))).toBe(true);
  });
});

describe("ficha publicada en el catálogo del panel (card)", () => {
  const withFicha = (): SiteDocument => {
    const s: SiteDocument = JSON.parse(JSON.stringify(site));
    const p = s.catalog.products.find((x) => x.key === "connect-people") as Record<string, unknown>;
    p.commercial = { ...((p.commercial as object) ?? {}), ...EXTRA, related: ["connect-tax", "no-visible"], compatibleExtensions: ["connect-tax", "no-visible"] };
    return s;
  };

  it("lleva el contenido publicado, los precios aprobados y nada interno", () => {
    const s = withFicha();
    const cat = panelCatalog(quoteCatalogFromSite(s).products, { version: "v", purchasesEnabled: false, site: s });
    const people = cat.items.find((i) => i.key === "connect-people")!;
    expect(people.card).not.toBeNull();
    expect(people.card!.commercial).toMatchObject({ valueProposition: EXTRA.valueProposition, coreIntegration: EXTRA.coreIntegration, terms: EXTRA.terms, faq: EXTRA.faq });
    expect(people.card!.commercial!.media.screenshots).toEqual(EXTRA.media.screenshots);
    // Relacionados y compatibles solo entre productos que la empresa ve
    expect(people.card!.commercial!.related).toEqual(["connect-tax"]);
    expect(people.card!.commercial!.compatibleExtensions).toEqual(["connect-tax"]);
    expect(people.card!.prices).toEqual([expect.objectContaining({ kind: "monthly", amountCents: 1900, currency: "EUR" })]);
    expect(JSON.stringify(cat)).not.toMatch(/"internal"|costCents|evidence|marginNote/);
  });

  it("sin ficha comercial publicada, commercial va vacío y el resto de la ficha sigue llegando; sin sitio, card es null", () => {
    const s = withFicha();
    const p = s.catalog.products.find((x) => x.key === "connect-voice") as Record<string, unknown>;
    delete p.commercial;
    const voice = panelCatalog(quoteCatalogFromSite(s).products, { version: "v", purchasesEnabled: false, site: s }).items.find((i) => i.key === "connect-voice")!;
    expect(voice.card!.commercial).toBeNull();
    expect(voice.card!.tagline).not.toBe("");
    expect(panelCatalog(quoteCatalogFromSite(s).products, { version: "v", purchasesEnabled: false }).items.every((i) => i.card === null)).toBe(true);
  });
});

describe("solicitudes del marketplace del panel", () => {
  const setup = async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const created: LeadRequest[] = [];
    const requests = new WebRequestService({ store, crm, now: () => NOW, onCreated: (r) => void created.push(r) });
    const c = await crm.createCompany({ name: "Escuela Demo", legalName: "Escuela Demo SL" }, "operator:test");
    await store.update("companies", c.id, { tenantId: "t9-demo" });
    return { store, requests, created, d: { site, internal: false, requests, crm: store } };
  };
  const body = (over: Record<string, unknown> = {}) => ({ type: "info" as const, interest: "connect-people", requester: { name: "Laura Demo", email: "laura@demo.example" }, idempotencyKey: "clave-panel-0001", ...over });

  it("«Solicitar información» crea una solicitud del CRM con la empresa, el producto y el aviso al equipo; repetir no duplica", async () => {
    const t = await setup();
    const r = await receivePanelRequest(t.d, "t9-demo", body({ message: "Somos 12 personas" }));
    expect(r).toMatchObject({ outcome: "created", status: "pending" });
    await flush();
    expect(t.created).toHaveLength(1);
    expect(t.created[0]).toMatchObject({ type: "extension_info", interest: "connect-people", sourcePage: `${PANEL_REQUEST_SOURCE}/connect-people`, marketingConsent: false });
    expect(t.created[0].message).toMatch(/Elephant People[\s\S]*Escuela Demo \(t9-demo\)[\s\S]*Somos 12 personas/);
    const lead = (await t.store.list("leads", {}, {}))[0];
    expect(lead).toMatchObject({ email: "laura@demo.example", companyName: "Escuela Demo" });
    expect((await receivePanelRequest(t.d, "t9-demo", body({ message: "Somos 12 personas" }))).outcome).toBe("replayed");
    expect(t.created).toHaveLength(1);
  });

  it("«Me interesa» solo para lo que aún no existe; Elephant Net va como módulo sectorial", async () => {
    const t = await setup();
    await expect(receivePanelRequest(t.d, "t9-demo", body({ type: "waitlist" }))).rejects.toMatchObject({ status: 409 });
    await expect(receivePanelRequest(t.d, "t9-demo", body({ interest: "connect-reception-ai" }))).rejects.toMatchObject({ status: 409 });
    const w = await receivePanelRequest(t.d, "t9-demo", body({ type: "waitlist", interest: "ski-net-school", idempotencyKey: "clave-panel-0002" }));
    expect(w.outcome).toBe("created");
    await flush();
    expect(t.created[0]).toMatchObject({ type: "module_info", interest: "ski-net-school", sourcePage: `${PANEL_REQUEST_SOURCE}/ski-net-school#me-interesa` });
    expect(t.created[0].message).toMatch(/^Me interesa Ski Net · Escuela/);
  });

  it("productos fuera del catálogo de la empresa, planes o internos: no se registran", async () => {
    const t = await setup();
    await expect(receivePanelRequest(t.d, "t9-demo", body({ interest: "no-existe" }))).rejects.toMatchObject({ status: 404 });
    await expect(receivePanelRequest(t.d, "t9-demo", body({ interest: "business" }))).rejects.toMatchObject({ status: 404 });
    const s: SiteDocument = JSON.parse(JSON.stringify(site));
    const p = s.catalog.products.find((x) => x.key === "connect-voice") as Record<string, unknown> & { catalog: Record<string, unknown> };
    p.catalog = { ...p.catalog, internalOnly: true };
    await expect(receivePanelRequest({ ...t.d, site: s }, "t9-demo", body({ interest: "connect-voice" }))).rejects.toMatchObject({ status: 404 });
    await flush();
    expect(t.created).toHaveLength(0);
  });

  it("la clave de idempotencia se aísla por empresa", async () => {
    const t = await setup();
    await receivePanelRequest(t.d, "t9-demo", body());
    const other = await receivePanelRequest(t.d, "t8-otra", body({ requester: { name: "Ana Otra", email: "ana@otra.example" } }));
    expect(other.outcome).toBe("created");
    await flush();
    expect(t.created).toHaveLength(2);
  });
});
