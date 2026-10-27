/**
 * Catálogo comercial único: política dentro de los productos, importación de fichas, publicación y cotizador por API.
 *
 *  - Regresión: sin reglas activas, la respuesta de /quote es IDÉNTICA a la del cotizador del catálogo para un barrido
 *    amplio de configuraciones (ningún presupuesto cambia de importe).
 *  - La política construida desde los borradores reproduce la propuesta (mismos importes en las seis simulaciones).
 *  - La importación solo escribe borradores, no publica, retiene los textos con reglas sin aprobar y la semilla no la
 *    borra al repetirse.
 *  - Con la política desactivada (por defecto) nada de la política llega a lo publicado; activada, solo lo aprobado.
 *  - Validaciones de publicación, revisión comercial y simulador con sus permisos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { quote, type QuoteRequest } from "./catalog/quote";
import { quoteCatalogFromSeed } from "./catalog/commercial/seedCatalog";
import { seedElephantSource } from "./catalog/seed";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { commercialQuote, quoteResponse } from "./catalog/commercial/commercialQuote";
import { CATALOG_POLICY, PROPOSED_POLICY } from "./catalog/commercial/policy";
import { isNeutral, policyFromProducts } from "./catalog/commercial/fromCatalog";
import { draftWithSpec, foreignChanges, importCommercialSpecs } from "./catalog/commercial/importSpecs";
import { PLAN_RULE_RE, PROPOSAL_RE } from "./catalog/commercial/checks";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const eur = (n: number) => Math.round(n * 100);

async function seeded(opts: { commercialPolicy?: boolean } = {}) {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, commercialPolicy: opts.commercialPolicy });
  await seedElephantSource(svc, store);
  return { store, svc };
}

/**
 * SEO neutro en planes cuya ficha nombra extensiones con la inclusión aún no aplicada (esa ficha no se publica tal
 * cual; estas pruebas comprueban la proyección de las reglas, no el texto).
 */
async function neutralSeo(svc: WebAdminService, store: MemoryWebStore, keys: string[]) {
  for (const k of keys) {
    const e = (await store.getEntry("product", k))!;
    const d = productDraft.parse(e.draft);
    await svc.save("product", k, { draft: { ...d, commercial: { ...d.commercial!, seo: { ...d.commercial!.seo!, description: `${d.name}, plan de Big Elephant.` } } }, expectedVersion: e.draftVersion }, "operator:test");
  }
}

/** Barrido de configuraciones: cada producto suelto en cada plan y periodicidad, paquetes con componentes, contratado, cupos. */
function sweep(): QuoteRequest[] {
  const plans = ["essential", "business", "enterprise"];
  const keys = PRODUCTS.filter((p) => p.family !== "core_plan" && p.family !== "addon").map((p) => p.key);
  const bundles = PRODUCTS.filter((p) => p.draft.catalog.bundleOf.length);
  const out: QuoteRequest[] = [];
  for (const plan of plans)
    for (const interval of ["month", "year"] as const) {
      out.push({ plan, interval });
      out.push({ plan, interval, users: 30, sites: 4, storageGb: 120, fiscalEntities: 2 });
      for (const key of keys) out.push({ plan, interval, items: [{ key }] });
      for (const b of bundles) {
        out.push({ plan, interval, items: [{ key: b.key }, { key: b.draft.catalog.bundleOf[0] }] });
        out.push({ plan, interval, items: [{ key: b.key }], owned: b.draft.catalog.bundleOf.slice(0, 1) });
        out.push({ plan, interval, items: b.draft.catalog.bundleOf.map((key) => ({ key })) });
      }
      out.push({ plan, interval, items: [{ key: "connect-tax" }], owned: ["connect-tax"] });
      out.push({ plan, interval, items: [{ key: "no-existe" }, { key: plan }] });
    }
  return out;
}

describe("regresión: sin reglas activas, mismos importes que el cotizador del catálogo", () => {
  it("la política publicada del catálogo sembrado es neutra", async () => {
    const { svc } = await seeded();
    const { policy } = await svc.commercialCatalog("published");
    expect(isNeutral(policy)).toBe(true);
  });

  it("respuesta de /quote idéntica a quote() en todo el barrido (salvo el desglose añadido)", async () => {
    const { svc } = await seeded();
    const { catalog, policy } = await svc.commercialCatalog("published");
    const reqs = sweep();
    expect(reqs.length).toBeGreaterThan(300);
    for (const r of reqs) {
      const { commercial, ...legacyShape } = quoteResponse(catalog, policy, r);
      expect(legacyShape, JSON.stringify(r)).toEqual(quote(catalog, r));
      expect(commercial.recurring.monthlyCents).toBe(legacyShape.totals.monthlyCents);
    }
  });

  it("CATALOG_POLICY también es neutra (la referencia de las pruebas)", () => {
    expect(isNeutral(CATALOG_POLICY)).toBe(true);
    expect(isNeutral(PROPOSED_POLICY)).toBe(false);
  });
});

describe("importación de fichas comerciales", () => {
  it("solo escribe borradores: no publica nada y el sitio publicado no cambia", async () => {
    const { store, svc } = await seeded();
    const before = await svc.publicSite("published");
    const dry = await importCommercialSpecs(svc, store);
    expect(dry.dryRun).toBe(true);
    expect(dry.updated).toHaveLength(PRODUCT_SPECS.length);
    expect((await svc.publicSite("published")).version).toBe(before.version);
    const run = await importCommercialSpecs(svc, store, { dryRun: false });
    expect(run.failed).toEqual([]);
    expect(run.missing).toEqual([]);
    expect(run.updated).toHaveLength(PRODUCT_SPECS.length);
    expect((await svc.publicSite("published")).version).toBe(before.version);
    const ess = (await store.getEntry("product", "essential"))!;
    expect(ess.publishedVersion).not.toBe(ess.draftVersion);
    // Idempotente
    expect((await importCommercialSpecs(svc, store, { dryRun: false })).updated).toEqual([]);
  });

  it("barrera: nunca cambia precios, cupos, estado ni nada fuera de la ficha y la política", async () => {
    const { store, svc } = await seeded();
    const dry = await importCommercialSpecs(svc, store);
    for (const [key, fields] of Object.entries(dry.fields)) for (const f of fields) expect(f, key).toMatch(/^(commercial|catalog.(implementationLevel|inclusions|quotaProposals|quoteOnRequest|bundleRule|coreIncluded)|internal.(evidence|functionalGrade|sources|pendingDecisions))$/);
    const biz = productDraft.parse((await store.getEntry("product", "business"))!.draft);
    const touched = { ...biz, catalog: { ...biz.catalog, inclusions: [] }, commercial: { headline: "x" } };
    expect(foreignChanges(biz as unknown as Record<string, unknown>, touched as unknown as Record<string, unknown>)).toEqual([]);
    const pricier = JSON.parse(JSON.stringify(biz));
    pricier.catalog.quotas = [];
    pricier.catalog.commercialStatus = "retired";
    pricier.billingModel = "one_off";
    expect(foreignChanges(biz as unknown as Record<string, unknown>, pricier).sort()).toEqual(["billingModel", "catalog.commercialStatus", "catalog.quotas"]);
  });

  it("borradores guardados sin valores por defecto (como en live): se importan; esos campos solo se normalizan", async () => {
    const { store, svc } = await seeded();
    const e = (await store.getEntry("product", "essential"))!;
    const raw = JSON.parse(JSON.stringify(e.draft));
    delete raw.presentation;
    delete raw.activation.ref;
    for (const q of raw.catalog.quotas) delete q.unit;
    await store.saveDraft(e.id, e.draftVersion, raw, e.sortOrder, "prueba", Date.now());
    const dry = await importCommercialSpecs(svc, store, { keys: ["essential"] });
    expect(dry.failed).toEqual([]);
    expect(dry.updated).toEqual(["essential"]);
    expect(dry.normalized.essential?.sort()).toEqual(["activation", "catalog.quotas", "presentation"]);
    const run = await importCommercialSpecs(svc, store, { dryRun: false, keys: ["essential"] });
    expect(run.failed).toEqual([]);
    const saved = productDraft.parse((await store.getEntry("product", "essential"))!.draft);
    expect(saved.catalog.quotas).toEqual(productDraft.parse(raw).catalog.quotas);
    expect(saved.commercial?.seo).toBeTruthy();
  });

  it("los textos con inclusiones en planes o reglas propuestas no van a la ficha pública: quedan como decisión pendiente", () => {
    for (const p of PRODUCTS) {
      const spec = PRODUCT_SPECS.find((s) => s.key === p.key)!;
      const d = draftWithSpec(productDraft.parse(p.draft), p.family, spec);
      const m = d.commercial!;
      for (const t of [m.headline, m.longDescription, m.problem, ...m.benefits, ...m.excludes, ...m.capacityRules, ...m.integrations, m.seo!.title, m.seo!.description]) {
        expect(PROPOSAL_RE.test(t), `${p.key}: ${t}`).toBe(false);
        expect(PLAN_RULE_RE.test(t), `${p.key}: ${t}`).toBe(false);
      }
    }
    const biz = draftWithSpec(productDraft.parse(PRODUCTS.find((p) => p.key === "business")!.draft), "core_plan", PRODUCT_SPECS.find((s) => s.key === "business")!);
    expect(biz.internal.pendingDecisions?.some((t) => /Texto retenido/.test(t) && /People incluido hasta 15/.test(t))).toBe(true);
    expect(biz.catalog.inclusions?.map((i) => `${i.key}:${i.status}`)).toEqual(["connect-automations:approved", "connect-people:approved", "extra-contracts-esign:approved"]);
    expect(biz.catalog.inclusions?.find((i) => i.key === "connect-people")?.cap).toMatchObject({ base: 15, status: "proposed" });
    const ent = draftWithSpec(productDraft.parse(PRODUCTS.find((p) => p.key === "enterprise")!.draft), "core_plan", PRODUCT_SPECS.find((s) => s.key === "enterprise")!);
    expect(ent.catalog.quotaProposals).toContainEqual({ metric: "users", included: 25 });
    expect(ent.catalog.quoteOnRequest).toEqual({ status: "proposed" });
  });

  it("repetir la semilla no borra la ficha ni la política importadas", async () => {
    const { store, svc } = await seeded();
    await importCommercialSpecs(svc, store, { dryRun: false });
    const before = (await store.getEntry("product", "business"))!;
    const rep = await seedElephantSource(svc, store, { dryRun: true });
    expect(rep.updated).toEqual([]);
    await seedElephantSource(svc, store);
    const after = (await store.getEntry("product", "business"))!;
    expect(productDraft.parse(after.draft).commercial).toEqual(productDraft.parse(before.draft).commercial);
    expect(productDraft.parse(after.draft).catalog.inclusions).toEqual(productDraft.parse(before.draft).catalog.inclusions);
  });
});

describe("política desde los borradores (simulador)", () => {
  it("reproduce la propuesta: las seis simulaciones dan los mismos importes", async () => {
    const { store, svc } = await seeded();
    await importCommercialSpecs(svc, store, { dryRun: false });
    const { catalog, policy } = await svc.commercialCatalog("proposed");
    const reqs = [
      { plan: "essential", interval: "month" as const, items: [{ key: "connect-tax" }] },
      { plan: "business", interval: "month" as const, users: 10, employees: 10, items: [{ key: "connect-pack-finance" }, { key: "connect-people" }, { key: "connect-automations" }, { key: "extra-contracts-esign" }] },
      { plan: "essential", interval: "month" as const, users: 4, items: [{ key: "connect-campaigns" }, { key: "connect-pos" }] },
      { plan: "business", interval: "month" as const, users: 3, employees: 8, items: [{ key: "restaurant-net-bookings" }, { key: "connect-people" }] },
      { plan: "business", interval: "year" as const, users: 10, items: [{ key: "hotel-net-pms" }, { key: "hotel-net-booking-engine" }, { key: "connect-voice" }] },
      { plan: "enterprise", interval: "month" as const, users: 25, sites: 3, employees: 25, items: [{ key: "connect-pos", quantity: 3 }] },
      { plan: "business", interval: "month" as const, items: [{ key: "connect-pack-ai" }] },
    ];
    const expected = [48, 124, 79, 98, null, 274, null];
    reqs.forEach((r, i) => {
      const fromDrafts = commercialQuote(catalog, policy, r);
      const fromSpec = commercialQuote(catalog, PROPOSED_POLICY, r);
      expect(fromDrafts.recurring, JSON.stringify(r)).toEqual(fromSpec.recurring);
      expect(fromDrafts.lines.map((l) => [l.key, l.status, l.amountCents])).toEqual(fromSpec.lines.map((l) => [l.key, l.status, l.amountCents]));
      if (expected[i] !== null) expect(fromDrafts.recurring.monthlyCents).toBe(eur(expected[i]!));
    });
    // Y marca las reglas propuestas que intervienen
    expect(commercialQuote(catalog, policy, reqs[5]).pendingRules).toEqual(expect.arrayContaining(["inclusión enterprise:connect-people", "cupo enterprise:users"]));
  });
});

describe("publicación: lo propuesto nunca sale; lo aprobado solo con la política activa", () => {
  it("política desactivada (por defecto): publicar los planes no publica ninguna regla ni nada interno", async () => {
    const { store, svc } = await seeded();
    await importCommercialSpecs(svc, store, { dryRun: false });
    await neutralSeo(svc, store, ["business", "enterprise"]);
    for (const k of ["essential", "business", "enterprise"]) await svc.publish("product", k, (await store.getEntry("product", k))!.draftVersion, "operator:test");
    const site = await svc.publicSite("published");
    const raw = JSON.stringify(site);
    for (const p of site.catalog.products as Array<{ catalog?: Record<string, unknown> }>) {
      expect(p.catalog?.inclusions).toBeUndefined();
      expect(p.catalog?.quotaProposals).toBeUndefined();
      expect(p.catalog?.quoteOnRequest).toBeUndefined();
      expect(p.catalog?.bundleRule).toBeUndefined();
    }
    expect(raw).not.toMatch(/"internal"|pendingDecisions|functionalGrade|Texto retenido|"sources"/);
    const biz = site.catalog.products.find((p) => p.key === "business") as { commercial?: { headline: string } };
    expect(biz.commercial?.headline).toMatch(/crecimiento/);
    // Mismo importe que antes de publicar las fichas
    const { catalog, policy } = await svc.commercialCatalog("published");
    expect(isNeutral(policy)).toBe(true);
    expect(quoteResponse(catalog, policy, { plan: "business", interval: "month", items: [{ key: "connect-automations" }] }).totals.monthlyCents).toBe(quote(catalog, { plan: "business", interval: "month", items: [{ key: "connect-automations" }] }).totals.monthlyCents);
  });

  it("política activa: solo inclusiones aprobadas con tope aprobado; nunca cupos ni reglas propuestas", async () => {
    const { store, svc } = await seeded({ commercialPolicy: true });
    await importCommercialSpecs(svc, store, { dryRun: false });
    await neutralSeo(svc, store, ["business", "enterprise"]);
    for (const k of ["essential", "business", "enterprise"]) await svc.publish("product", k, (await store.getEntry("product", k))!.draftVersion, "operator:test");
    const site = await svc.publicSite("published");
    const cat = (k: string) => (site.catalog.products.find((p) => p.key === k) as { catalog: Record<string, unknown> }).catalog;
    expect((cat("business").inclusions as Array<{ key: string }>).map((i) => i.key)).toEqual(["connect-automations", "extra-contracts-esign"]);
    expect((cat("enterprise").inclusions as Array<{ key: string }>).map((i) => i.key)).toEqual(["connect-pack-finance", "extra-accounting", "connect-copilot"]);
    expect(cat("enterprise").quotaProposals).toBeUndefined();
    expect(cat("enterprise").quoteOnRequest).toBeUndefined();
    const { catalog, policy } = await svc.commercialCatalog("published");
    const r = quoteResponse(catalog, policy, { plan: "business", interval: "month", items: [{ key: "connect-automations" }] });
    expect(r.lines.find((l) => l.key === "connect-automations")?.status).toBe("included_in_plan");
    expect(r.totals.monthlyCents).toBe(quote(catalog, { plan: "business", interval: "month" }).totals.monthlyCents);
    expect(r.commercial.pendingRules).toEqual([]);
  });

  it("no se despublica una extensión que un plan publicado incluye", async () => {
    const { store, svc } = await seeded({ commercialPolicy: true });
    await importCommercialSpecs(svc, store, { dryRun: false, keys: ["business"] });
    await neutralSeo(svc, store, ["business"]);
    await svc.publish("product", "business", (await store.getEntry("product", "business"))!.draftVersion, "operator:test");
    await expect(svc.unpublish("product", "connect-automations", "operator:test")).rejects.toThrow(/business/);
  });
});

describe("validaciones comerciales", () => {
  const edit = async (svc: WebAdminService, store: MemoryWebStore, key: string, f: (d: ReturnType<typeof productDraft.parse>) => unknown) => {
    const e = (await store.getEntry("product", key))!;
    return svc.save("product", key, { draft: f(productDraft.parse(e.draft)), expectedVersion: e.draftVersion }, "operator:test");
  };
  const publish = async (svc: WebAdminService, store: MemoryWebStore, key: string) => svc.publish("product", key, (await store.getEntry("product", key))!.draftVersion, "operator:test");

  it("al guardar: una solución sectorial no se incluye en un plan; un parcial necesita tope; la política solo en su familia", async () => {
    const { store, svc } = await seeded();
    await expect(edit(svc, store, "connect-tax", (d) => ({ ...d, catalog: { ...d.catalog, inclusions: [{ key: "connect-voice", mode: "full", status: "approved" }] } }))).rejects.toThrow(/Solo un plan/);
    await expect(edit(svc, store, "business", (d) => ({ ...d, catalog: { ...d.catalog, inclusions: [{ key: "connect-people", mode: "partial", status: "approved" }] } }))).rejects.toThrow(/tope/);
    await expect(edit(svc, store, "connect-tax", (d) => ({ ...d, catalog: { ...d.catalog, bundleRule: { kind: "min2", status: "proposed" } } }))).rejects.toThrow(/paquete/);
    await expect(edit(svc, store, "essential", (d) => ({ ...d, catalog: { ...d.catalog, quotaProposals: [{ metric: "users", included: 9 }] } }))).rejects.toThrow(/ya tiene valor aprobado/);
    await edit(svc, store, "business", (d) => ({ ...d, catalog: { ...d.catalog, inclusions: [{ key: "hotel-net-pms", mode: "full", status: "approved" }] } }));
    await expect(publish(svc, store, "business")).rejects.toThrow(/no puede incluirse en un plan/);
  });

  it("al publicar: importes, promesas, reglas sin aprobar e inclusiones en texto bloquean; lo que no existe solo admite lista de espera", async () => {
    const { store, svc } = await seeded();
    await importCommercialSpecs(svc, store, { dryRun: false, keys: ["connect-tax", "extra-accounting", "connect-voice"] });
    await edit(svc, store, "connect-tax", (d) => ({ ...d, commercial: { ...d.commercial!, benefits: ["Desde 19 €/mes"] } }));
    await expect(publish(svc, store, "connect-tax")).rejects.toThrow(/importe/);
    await edit(svc, store, "connect-tax", (d) => ({ ...d, commercial: { ...d.commercial!, benefits: ["Activación inmediata"] } }));
    await expect(publish(svc, store, "connect-tax")).rejects.toThrow(/activación inmediata/);
    await edit(svc, store, "connect-tax", (d) => ({ ...d, commercial: { ...d.commercial!, benefits: ["Incluido en Business"] } }));
    await expect(publish(svc, store, "connect-tax")).rejects.toThrow(/inclusión en un plan/);
    await edit(svc, store, "connect-tax", (d) => ({ ...d, commercial: { ...d.commercial!, benefits: ["Tope de 15 (regla propuesta)"] } }));
    await expect(publish(svc, store, "connect-tax")).rejects.toThrow(/sin aprobar/);
    // Sin desarrollo: lista de espera y «Próximamente»
    await edit(svc, store, "extra-accounting", (d) => ({ ...d, commercial: { ...d.commercial!, cta: "demo" } }));
    await expect(publish(svc, store, "extra-accounting")).rejects.toThrow(/lista de espera/);
    // Slug repetido
    await edit(svc, store, "connect-voice", (d) => ({ ...d, commercial: { ...d.commercial!, seo: { ...d.commercial!.seo!, slug: "tax" } } }));
    const taxSlug = productDraft.parse((await store.getEntry("product", "connect-tax"))!.draft).commercial!.seo!.slug;
    await edit(svc, store, "connect-voice", (d) => ({ ...d, commercial: { ...d.commercial!, seo: { ...d.commercial!.seo!, slug: taxSlug } } }));
    await expect(publish(svc, store, "connect-voice")).rejects.toThrow(/slug/);
  });

  it("revisión: separa bloqueos, avisos y reglas pendientes; avisa de las aprobadas sin efecto", async () => {
    const { store, svc } = await seeded();
    await importCommercialSpecs(svc, store, { dryRun: false });
    const r = await svc.commercialReview();
    expect(r.policyEnabled).toBe(false);
    expect(r.products).toHaveLength(PRODUCTS.length);
    const biz = r.products.find((p) => p.key === "business")!;
    // El SEO de Business nombra extensiones cuya inclusión aún no se aplica: no se publica tal cual
    expect(biz.blocking.join(" ")).toMatch(/connect-automations/);
    expect(biz.pending).toEqual(expect.arrayContaining(["Tope propuesto de connect-people: 15 empleados más los usuarios adicionales"]));
    expect(biz.warnings.some((w) => /sin efecto todavía/.test(w))).toBe(true);
    // Solo los dos planes con inclusiones y Copilot (límite de IA sin decidir) quedan bloqueados
    expect(r.products.filter((p) => p.blocking.length).map((p) => p.key).sort()).toEqual(["business", "connect-copilot", "enterprise"]);
  });
});

// ── API ──────────────────────────────────────────────────────────────────────
const TOK = { read: "web-read-token-aaaaaaaaaaaaaaaaaaaa", crm: "crm-only-token-dddddddddddddddddddd" };
describe("API: cotizador comercial, revisión y simulador", () => {
  let server: http.Server;
  let store: MemoryWebStore;
  const call = (method: string, path: string, o: { token?: string; body?: unknown } = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        { host: "127.0.0.1", port: (server.address() as AddressInfo).port, path: `/cp/v1${path}`, method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const crmStore = new MemoryCrmStore();
    store = new MemoryWebStore();
    const app = createControlPlaneApp({
      tokens: [
        { id: "lector", sha256: hashToken(TOK.read), scopes: ["web:read"] },
        { id: "crm", sha256: hashToken(TOK.crm), scopes: ["crm:read", "crm:write"] },
      ],
      registry: new TenantRegistryService(reg, () => ring),
      reader: reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      crm: { service: new CrmService({ store: crmStore }), store: crmStore },
      publicIntake: { origins: ["http://localhost:4180"], secret: crypto.randomBytes(24).toString("hex") },
      web: { store },
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const svc = new WebAdminService({ store, refs });
    await seedElephantSource(svc, store);
    await importCommercialSpecs(svc, store, { dryRun: false });
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("permisos: revisión y simulador exigen web:read", async () => {
    expect((await call("GET", "/web/commercial/review")).status).toBe(401);
    expect((await call("GET", "/web/commercial/review", { token: TOK.crm })).status).toBe(403);
    expect((await call("POST", "/web/commercial/simulate", { token: TOK.crm, body: { request: { plan: "business", interval: "month" } } })).status).toBe(403);
    expect((await call("GET", "/web/commercial/review", { token: TOK.read })).status).toBe(200);
    expect((await call("GET", "/web/commercial/net-simulations")).status).toBe(401);
    expect((await call("GET", "/web/commercial/net-simulations", { token: TOK.crm })).status).toBe(403);
  });

  it("simulaciones Elephant Net: con los borradores componen el Core; con lo publicado (política apagada), nada", async () => {
    const prop = await call("GET", "/web/commercial/net-simulations?policy=proposed", { token: TOK.read });
    expect(prop.status).toBe(200);
    expect(prop.json.policyEnabled).toBe(false);
    expect(prop.json.nets.length).toBe(6);
    const ski = prop.json.nets.find((n: { key: string }) => n.key === "ski-net-complete");
    expect(ski.scenarios[0].composed.monthlyCents).toBe(9900);
    expect(ski.issues).toEqual([]);
    const pub = await call("GET", "/web/commercial/net-simulations?policy=published", { token: TOK.read });
    expect(pub.json.nets).toEqual([]);
    expect(pub.json.withoutCore.length).toBe(6);
  });

  it("cotizador público y del CRM: mismos importes que siempre y desglose comercial sin nada interno", async () => {
    const body = { plan: "business", interval: "month", items: [{ key: "connect-automations" }, { key: "connect-people" }], users: 10, employees: 30 };
    const pub = await call("POST", "/public/site/quote", { body });
    expect(pub.status).toBe(200);
    expect(pub.json.totals).toEqual(quote(quoteCatalogFromSeed(), body as QuoteRequest).totals);
    expect(pub.json.commercial.policy).toBe("publicada");
    expect(pub.json.commercial.pendingRules).toEqual([]);
    expect(JSON.stringify(pub.json)).not.toMatch(/internal|pendingDecisions|Texto retenido/);
    const crm = await call("POST", "/web/quote", { token: TOK.read, body });
    expect(crm.json.totals).toEqual(pub.json.totals);
  });

  it("simulador: con los borradores aplica lo propuesto y lo marca; con lo publicado, nada", async () => {
    const request = { plan: "enterprise", interval: "month", users: 40, sites: 3, items: [{ key: "connect-pos", quantity: 3 }] };
    const prop = await call("POST", "/web/commercial/simulate", { token: TOK.read, body: { policy: "proposed", request, recommend: true } });
    expect(prop.status).toBe(200);
    expect(prop.json.policy.neutral).toBe(false);
    expect(prop.json.quote.lines.some((l: { status: string }) => l.status === "on_quote")).toBe(true);
    expect(prop.json.quote.pendingRules).toEqual(expect.arrayContaining(["cupo enterprise:users"]));
    expect(prop.json.recommendation.recommended).toBeTruthy();
    const pub = await call("POST", "/web/commercial/simulate", { token: TOK.read, body: { policy: "published", request, changeTo: "business" } });
    expect(pub.json.policy).toMatchObject({ neutral: true, pendingRules: [] });
    expect(pub.json.change.direction).toBe("downgrade");
    expect((await call("POST", "/web/commercial/simulate", { token: TOK.read, body: { policy: "otra", request } })).status).toBe(400);
  });
});
