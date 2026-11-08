/**
 * Plan personal «Life» (decisiones J1–J10 de Jorge del 08/11/2026):
 *  - semilla: plan propio `core_plan`, independiente de Essential, con life-net y las capacidades base, 5 miembros del
 *    hogar, solo mensual y 9 € IVA incluido (base 7,44 € sin IVA);
 *  - cotizador: el plan personal no admite extensiones, Life Net no se suma a un plan de empresa y la regla «Core
 *    incluido» no da importes negativos;
 *  - Stripe: exento de la tarifa anual, sin Product ni Price mientras no esté «available», Essential y Business igual;
 *  - autoservicio preparado para particulares (sin razón social), apagado por el estado comercial;
 *  - escaparate de empresas sin Life Net; un hogar solo ve lo suyo;
 *  - fichas: sin requisito de Elephant Core y con las siete funciones;
 *  - revisión del 08/11/2026: alta idempotente, sin tocar otros precios ni borradores ajenos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTS, TAX_RATE_BP } from "./catalog/elephantSourceV1";
import { CAPABILITIES } from "./catalog/capabilities";
import { QUOTE_PERSONAL_PLANS, QUOTE_PERSONAL_PRODUCTS, quote, type QuoteCatalog } from "./catalog/quote";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { commercialQuote } from "./catalog/commercial/commercialQuote";
import { PROPOSED_POLICY } from "./catalog/commercial/policy";
import { draftWithSpec } from "./catalog/commercial/importSpecs";
import { commercialChecks, textProblems } from "./catalog/commercial/checks";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import { validateSpecs } from "./catalog/commercial/validateSpecs";
import { applyCatalogAdditions, PRESENTATION_PATCHES_2026_11_08, REVIEW_ID_2026_11_08 } from "./catalog/review20261108";
import { CHECKOUT_PLANS, SELF_SERVICE_PLANS, STRIPE_PRODUCT_NAME, desiredCatalog, type SkippedProduct } from "./stripe/catalog";
import { selfServiceBody } from "./stripe/selfService";
import { buildConnectCatalog } from "./connectMarketplace";
import { panelCatalog } from "./commerce/panelCatalog";
import { shownInShowcase } from "../shared/connectMarketplace";
import { HOUSEHOLD_MEMBERS_METRIC, LIFE_CAPABILITIES, LIFE_PLAN, LIFE_TRIAL_DAYS, PERSONAL_PLANS, PERSONAL_PRODUCTS, priceWithTaxCents } from "../shared/personalPlans";
import { NET_PRODUCTS } from "../shared/netProducts";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { catalogFromWebStore, type CatalogPort } from "./subscriptions/ports";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TRIAL_PLANS, TrialOnboardingService, householdNameOf, lifeTrialsEnabled, trialPlanOf } from "./trials/onboarding";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const life = PRODUCTS.find((p) => p.key === LIFE_PLAN)!;

async function seeded() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  return { store, svc, catalog: quoteCatalogFromSite(await svc.site("published")) };
}

describe("semilla: plan personal Life", () => {
  it("plan propio de Elephant Core, independiente de Essential, con la licencia y las capacidades base", () => {
    expect(life.family).toBe("core_plan");
    expect(life.draft.catalog.inherits).toBeNull();
    expect(life.draft.catalog.capabilities).toEqual(["life-net", "admin-users", "comms-email"]);
    expect(life.draft.catalog.capabilities).toEqual([...LIFE_CAPABILITIES]);
    // Sin CRM, tienda, CMS ni facturación
    expect(life.draft.catalog.capabilities.some((c) => /^(crm|shop|cms|bill)-/.test(c))).toBe(false);
    expect(life.draft.catalog.quotas).toEqual([{ metric: HOUSEHOLD_MEMBERS_METRIC, included: 5, unit: "" }]);
    expect([life.draft.catalog.commercialStatus, life.draft.technicalStatus]).toEqual(["coming_soon", "planned"]);
  });

  it("solo tarifa mensual: 7,44 € sin IVA, que con el 21 % son 9,00 € IVA incluido", () => {
    expect(life.prices).toEqual([{ kind: "monthly", amountCents: 744, unit: null }]);
    expect(TAX_RATE_BP).toBe(2100);
    expect(priceWithTaxCents(744, TAX_RATE_BP)).toBe(900);
  });

  it("va al final del catálogo: no mueve el orden de lo que ya existe", () => {
    expect(PRODUCTS[PRODUCTS.length - 1].key).toBe(LIFE_PLAN);
    expect(Math.max(...PRODUCTS.map((p) => p.sortOrder))).toBe(life.sortOrder);
    expect(PRODUCTS.find((p) => p.key === "essential")!.sortOrder).toBe(10);
  });

  it("Life Net sigue como licencia LIFE_NET, personal y para particulares", () => {
    const np = NET_PRODUCTS.find((p) => p.key === "life-net")!;
    expect([np.licence, np.segment]).toEqual(["LIFE_NET", "personal"]);
    expect(PRODUCTS.find((p) => p.key === "life-net")!.draft.presentation.forWho).toBe("Particulares y familias.");
  });

  it("el cotizador usa las mismas listas que shared/personalPlans.ts", () => {
    expect([...QUOTE_PERSONAL_PLANS]).toEqual([...PERSONAL_PLANS]);
    expect(QUOTE_PERSONAL_PRODUCTS).toEqual(PERSONAL_PRODUCTS);
    expect([...CHECKOUT_PLANS].filter((p) => !(SELF_SERVICE_PLANS as readonly string[]).includes(p))).toEqual([...PERSONAL_PLANS]);
    expect(STRIPE_PRODUCT_NAME.life).toBe("Elephant Life");
  });
});

describe("cotizador con el plan Life", () => {
  let catalog: QuoteCatalog;
  beforeEach(async () => {
    ({ catalog } = await seeded());
  });

  it("mensual: 7,44 € + 1,56 € de IVA = 9,00 €; no se contrata todavía (próximamente)", () => {
    const q = quote(catalog, { plan: "life", interval: "month" });
    expect(q.errors).toEqual([]);
    expect(q.totals).toMatchObject({ monthlyCents: 744, taxRateBp: 2100, monthlyTaxCents: 156 });
    expect(q.totals.monthlyCents + q.totals.monthlyTaxCents).toBe(900);
    expect(q.capabilities).toEqual(["admin-users", "comms-email", "life-net"]);
    expect(q.contractable).toBe("not_available");
  });

  it("sin tarifa anual", () => {
    expect(quote(catalog, { plan: "life", interval: "year" }).errors[0]).toMatch(/no tiene tarifa anual/);
  });

  it("no admite extensiones ni soluciones de empresa, y Life Net ya va incluido", () => {
    expect(quote(catalog, { plan: "life", interval: "month", items: [{ key: "connect-people" }] }).errors[0]).toMatch(/es personal/);
    expect(quote(catalog, { plan: "life", interval: "month", items: [{ key: "hotel-net-complete" }] }).errors[0]).toMatch(/es personal/);
    expect(quote(catalog, { plan: "life", interval: "month", items: [{ key: "life-net" }] }).errors[0]).toMatch(/ya va incluido en el plan Life/);
  });

  it("Life Net no se suma a un plan de empresa", () => {
    for (const plan of ["essential", "business"]) expect(quote(catalog, { plan, interval: "month", items: [{ key: "life-net" }] }).errors[0]).toMatch(/plan personal Life, no sobre un plan de empresa/);
  });

  it("Essential sigue igual", () => {
    const q = quote(catalog, { plan: "essential", interval: "month" });
    expect([q.ok, q.totals.monthlyCents]).toEqual([true, 2900]);
  });

  it("la regla «Core incluido» no se aplica a Life: nada a 0 € ni importes negativos", () => {
    const q = commercialQuote(catalog, PROPOSED_POLICY, { plan: "life", interval: "month" });
    expect(q.lines.every((l) => l.amountCents >= 0 && l.status !== "included_in_net")).toBe(true);
    expect(q.lines.find((l) => l.key === "life")!.amountCents).toBe(744);
    expect(q.discounts.coreIncludedCents).toBe(0);
    const withNet = commercialQuote(catalog, PROPOSED_POLICY, { plan: "life", interval: "month", items: [{ key: "hotel-net-complete" }] });
    expect(withNet.ok).toBe(false);
    expect(withNet.lines.every((l) => l.amountCents >= 0)).toBe(true);
  });
});

describe("Stripe: plan personal exento de la tarifa anual y sin Price hasta abrir la venta", () => {
  const port = (lifeStatus: string | null, lifePrices: Array<{ kind: "monthly" | "yearly"; amountCents: number }> = [{ kind: "monthly", amountCents: 744 }]): CatalogPort => {
    let id = 0;
    const price = (productKey: string, kind: "monthly" | "yearly", amountCents: number) => ({ id: ++id, productKey, kind, amountCents, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved" as const });
    const plan = (key: string, status: string, prices: ReturnType<typeof price>[]) => ({ key, name: key, family: "core_plan", technicalStatus: "partial", commercialStatus: status, activationKind: "plan", activationRef: null, prices });
    const offer = [
      plan("essential", "available", [price("essential", "monthly", 2900), price("essential", "yearly", 27900)]),
      plan("business", "available", [price("business", "monthly", 7900), price("business", "yearly", 75900)]),
      ...(lifeStatus ? [plan("life", lifeStatus, lifePrices.map((p) => price("life", p.kind, p.amountCents)))] : []),
    ];
    return { offer: async () => offer, product: async () => null, price: async () => null } as unknown as CatalogPort;
  };
  const essentialAndBusiness = (d: Awaited<ReturnType<typeof desiredCatalog>>) => d.filter((x) => x.productKey !== "life").map((x) => [x.productKey, x.kind, x.amountCents]);

  it("sin publicar: el catálogo de Stripe es el de siempre y no avisa de nada", async () => {
    const skipped: SkippedProduct[] = [];
    const d = await desiredCatalog(port(null), { onSkip: (s) => skipped.push(s) });
    expect(d.map((x) => x.productKey)).toEqual(["essential", "essential", "business", "business"]);
    expect(skipped).toEqual([]);
  });

  it("próximamente: ni Product ni Price (se informa); Essential y Business no cambian", async () => {
    const skipped: SkippedProduct[] = [];
    const d = await desiredCatalog(port("coming_soon"), { onSkip: (s) => skipped.push(s) });
    expect(d.some((x) => x.productKey === "life")).toBe(false);
    expect(skipped.map((s) => s.productKey)).toEqual(["life"]);
    expect(essentialAndBusiness(d)).toEqual(essentialAndBusiness(await desiredCatalog(port(null))));
  });

  it("disponible: solo el Price mensual, sin exigir tarifa anual", async () => {
    const d = await desiredCatalog(port("available"));
    expect(d.filter((x) => x.productKey === "life").map((x) => [x.kind, x.interval, x.amountCents, x.lookupKey.startsWith("es:life:monthly:eur:v"), x.productName])).toEqual([["monthly", "month", 744, true, "Elephant Life"]]);
    // Un anual aprobado no se convierte en Price: el plan personal solo es mensual
    const withYearly = await desiredCatalog(port("available", [{ kind: "monthly", amountCents: 744 }, { kind: "yearly", amountCents: 7440 }]));
    expect(withYearly.filter((x) => x.productKey === "life").map((x) => x.kind)).toEqual(["monthly"]);
  });

  it("disponible sin tarifa mensual: se detiene (nunca se cobra algo dudoso)", async () => {
    await expect(desiredCatalog(port("available", []))).rejects.toThrow(/plan «life» necesita exactamente un precio mensual/);
  });

  it("con el catálogo sembrado (Life próximamente) no hay nada de Life que crear en Stripe", async () => {
    const { store } = await seeded();
    const skipped: SkippedProduct[] = [];
    const d = await desiredCatalog(catalogFromWebStore(store), { onSkip: (s) => skipped.push(s) }).catch(() => []);
    expect(d.some((x) => x.productKey === "life")).toBe(false);
  });
});

describe("autoservicio preparado para particulares (apagado)", () => {
  const base = {
    idempotencyKey: "0b7c4c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e",
    plan: "life",
    interval: "month",
    admin: { name: "Ana López", email: "ana@example.com" },
    consents: { terms: true, privacy: true, termsVersion: "v1" },
    ticket: "ticket-de-prueba-largo",
  };
  const consumer = { type: "consumer", firstName: "Ana", lastName: "López", country: "ES", postalCode: "28001" };

  it("lo contrata un particular: nombre y apellidos, NIF opcional y el nombre del hogar", () => {
    expect(selfServiceBody.safeParse({ ...base, buyer: consumer }).success).toBe(true);
    expect(selfServiceBody.safeParse({ ...base, buyer: consumer, household: { name: "Casa López" } }).success).toBe(true);
  });

  it("sin razón social: una empresa o los datos de empresa no valen para el plan personal", () => {
    expect(selfServiceBody.safeParse({ ...base, buyer: { type: "business", legalName: "Acme SL", taxId: "B12345678", country: "ES" } }).success).toBe(false);
    expect(selfServiceBody.safeParse({ ...base, company: { name: "Acme SL" } }).success).toBe(false);
  });

  it("solo mensual, y el nombre del hogar solo en el plan personal", () => {
    expect(selfServiceBody.safeParse({ ...base, buyer: consumer, interval: "year" }).success).toBe(false);
    expect(selfServiceBody.safeParse({ ...base, plan: "essential", buyer: consumer, household: { name: "Casa" } }).success).toBe(false);
    expect(selfServiceBody.safeParse({ ...base, plan: "essential", buyer: consumer }).success).toBe(true);
  });
});

describe("escaparate del panel: Life Net fuera de las empresas", () => {
  it("regla: una empresa no ve los productos personales; un hogar solo ve los suyos", () => {
    for (const plan of ["essential", "business", "enterprise", null]) {
      expect(shownInShowcase("life-net", plan)).toBe(false);
      expect(shownInShowcase("connect-people", plan)).toBe(true);
    }
    expect(shownInShowcase("life-net", "life")).toBe(true);
    expect(shownInShowcase("connect-people", "life")).toBe(false);
  });

  it("catálogo del panel: sin Life Net ni el plan Life para una empresa", async () => {
    const { catalog, svc } = await seeded();
    const site = await svc.site("published");
    const forCompany = panelCatalog(catalog.products, { version: catalog.version, purchasesEnabled: true, site, marketplace: { doc: null, plan: "essential" } });
    expect(forCompany.items.some((i) => i.key === "life-net")).toBe(false);
    expect(forCompany.items.some((i) => i.key === "connect-people")).toBe(true);
    expect(forCompany.plans.map((p) => p.key)).toEqual(["essential", "business", "enterprise"]);
    // Sin plan conocido, como una empresa
    expect(panelCatalog(catalog.products, { version: catalog.version, purchasesEnabled: true, site }).plans.map((p) => p.key)).not.toContain("life");
    const forHome = panelCatalog(catalog.products, { version: catalog.version, purchasesEnabled: true, site, marketplace: { doc: null, plan: "life" } });
    expect(forHome.items.map((i) => i.key)).toEqual(["life-net"]);
    expect(forHome.plans.map((p) => p.key)).toEqual(["life"]);
  });

  it("marketplace: Life Net no sale a una empresa, ni como relacionado", async () => {
    const { catalog, svc } = await seeded();
    const items = panelCatalog(catalog.products, { version: catalog.version, purchasesEnabled: true, site: await svc.site("published") }).items;
    // Aunque el canal lo mandara, el escaparate de una empresa no lo muestra
    const lifeItem = { ...items[0], key: "life-net", name: "Life Net", family: "net_module", capabilities: ["life-net"], commercialStatus: "coming_soon" as const, purchasable: false };
    const out = buildConnectCatalog({ items: [...items, lifeItem] }, [], 1_790_000_000_000, "essential");
    expect(out.some((i) => i.key === "life-net")).toBe(false);
    expect(out.flatMap((i) => i.sheet.related)).not.toContain("life-net");
  });
});

describe("fichas: Life Net personal, sin requisito de Elephant Core y con sus siete funciones", () => {
  const spec = (key: string) => PRODUCT_SPECS.find((s) => s.key === key)!;

  it("las especificaciones siguen siendo válidas", () => {
    expect(validateSpecs(PRODUCTS, PRODUCT_SPECS, PROPOSED_POLICY)).toEqual([]);
  });

  it("Life Net: las siete funciones del registro común, próximamente y con lista de espera", () => {
    const s = spec("life-net");
    const np = NET_PRODUCTS.find((p) => p.key === "life-net")!;
    expect(s.includes).toEqual(np.areas.flatMap((a) => a.features.map((f) => f.label)));
    expect(s.publicContent.benefits).toEqual(np.benefits);
    expect(s.publicContent.cta).toBe("waitlist");
    const text = JSON.stringify([s.longDescription, s.problem, s.forWho, s.capacityRules, s.excludes, s.publicContent, s.seo]);
    expect(text).not.toMatch(/Requiere un plan|Elephant Core|Para toda la empresa|Por empresa|sin IVA|Profesionales/);
    for (const f of s.includes) expect(s.longDescription.toLowerCase()).toContain(f.toLowerCase());
  });

  it("las fichas de Life Net y del plan Life se publican sin bloqueos", async () => {
    const { store } = await seeded();
    const entries = await Promise.all(["life-net", "life"].map(async (k) => (await store.getEntry("product", k))!));
    const all = (await store.listEntries({ kind: "product" })).map((e) => ({ key: e.key, family: e.family, publication: e.publication, draft: productDraft.parse(e.draft) }));
    for (const e of entries) {
      const draft = draftWithSpec(productDraft.parse(e.draft), e.family!, spec(e.key));
      const check = commercialChecks({ key: e.key, family: e.family, publication: "published", draft }, all);
      expect(check.blocking, e.key).toEqual([]);
      expect(draft.commercial!.forWho).toBe("Particulares y familias.");
      for (const t of [draft.commercial!.longDescription, ...draft.commercial!.capacityRules]) expect(textProblems(t, { approvedQuotas: draft.catalog.quotas })).toEqual([]);
    }
  });
});

describe("revisión del 08/11/2026: alta del plan Life", () => {
  const AUTHOR = `operacion:${REVIEW_ID_2026_11_08}`;
  /** Catálogo como el de production antes de la revisión: sin el plan Life y Life Net con su texto anterior. */
  async function before() {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
    for (const c of CAPABILITIES) {
      const e = await svc.create({ kind: "capability", key: c.id, draft: { name: c.name, description: "", tier: c.tier, group: c.group, technicalStatus: c.technicalStatus } }, "catalogo:elephant-source-v1");
      await svc.publish("capability", c.id, e.draftVersion, "catalogo:elephant-source-v1");
    }
    for (const key of ["essential", "life-net"]) {
      const p = PRODUCTS.find((x) => x.key === key)!;
      const draft = key === "life-net" ? { ...p.draft, presentation: { ...p.draft.presentation, forWho: "Profesionales y familias." } } : p.draft;
      const e = await svc.create({ kind: "product", key, family: p.family, sortOrder: p.sortOrder, draft }, "catalogo:elephant-source-v1");
      await svc.publish("product", key, e.draftVersion, "catalogo:elephant-source-v1");
      const price = await svc.addPrice(key, { kind: "monthly", amountCents: p.prices[0].amountCents, currency: "EUR", taxRateBp: 2100, taxIncluded: false }, "catalogo:elephant-source-v1");
      await svc.approvePrice(price.id, "catalogo:elephant-source-v1");
    }
    return { store, svc };
  }
  const priceSnapshot = async (store: MemoryWebStore) => (await store.listPrices()).map((p) => [p.id, p.status, p.amountCents]);

  it("simulación: no cambia nada", async () => {
    const { store, svc } = await before();
    const prices = await priceSnapshot(store);
    const r = await applyCatalogAdditions(svc, store, { author: AUTHOR });
    expect(r.created).toEqual(["life: monthly 744 céntimos sin IVA"]);
    expect(r.patched).toEqual(["life-net.forWho: «Profesionales y familias.» → «Particulares y familias.»"]);
    expect(await store.getEntry("product", "life")).toBeNull();
    expect(await priceSnapshot(store)).toEqual(prices);
  });

  it("aplicación: plan publicado con su único precio aprobado, sin tocar los demás; idempotente", async () => {
    const { store, svc } = await before();
    const prices = await priceSnapshot(store);
    await applyCatalogAdditions(svc, store, { apply: true, author: AUTHOR });
    const e = (await store.getEntry("product", "life"))!;
    expect([e.family, e.publication, e.createdBy]).toEqual(["core_plan", "published", AUTHOR]);
    const d = productDraft.parse(e.draft);
    expect(d.internal.evidence).toMatch(/Jorge el 08\/11\/2026/);
    const own = (await store.listPrices(e.id)).map((p) => [p.kind, p.status, p.amountCents, p.taxRateBp, p.taxIncluded]);
    expect(own).toEqual([["monthly", "approved", 744, 2100, false]]);
    const ids = new Set(prices.map((p) => p[0]));
    expect((await priceSnapshot(store)).filter((p) => ids.has(p[0]))).toEqual(prices);
    expect(await priceSnapshot(store)).toHaveLength(prices.length + 1);
    const ln = (await store.getEntry("product", "life-net"))!;
    expect([productDraft.parse(ln.published).presentation.forWho, ln.publishedVersion === ln.draftVersion]).toEqual(["Particulares y familias.", true]);
    // Publicado: el cotizador lo ve
    const q = quote(quoteCatalogFromSite(await svc.site("published")), { plan: "life", interval: "month" });
    expect(q.totals.monthlyCents + q.totals.monthlyTaxCents).toBe(900);

    const again = await applyCatalogAdditions(svc, store, { apply: true, author: AUTHOR });
    expect([again.created, again.patched, again.conflicts]).toEqual([[], [], []]);
    expect(again.already).toEqual(["life", "life-net.forWho"]);
  });

  it("respeta lo decidido en el CRM: un plan «life» ajeno o un texto ya cambiado no se tocan", async () => {
    const { store, svc } = await before();
    await svc.create({ kind: "product", key: "life", family: "core_plan", sortOrder: 1, draft: life.draft }, "operador:jorge");
    const ln = (await store.getEntry("product", "life-net"))!;
    const d = productDraft.parse(ln.draft);
    await svc.save("product", "life-net", { draft: { ...d, presentation: { ...d.presentation, forWho: "Hogares." } }, expectedVersion: ln.draftVersion }, "operador:jorge");
    const r = await applyCatalogAdditions(svc, store, { apply: true, author: AUTHOR });
    expect(r.created).toEqual([]);
    expect(r.conflicts).toEqual([
      "life: ya existe en el catálogo (creado por operador:jorge); se deja como lo decidió el CRM",
      "life-net.forWho: vale «Hogares.» (se esperaba «Profesionales y familias.»); se deja como lo decidió el CRM",
    ]);
    expect(await store.listPrices((await store.getEntry("product", "life"))!.id)).toEqual([]);
  });

  it("no publica un borrador ajeno de Life Net", async () => {
    const { store, svc } = await before();
    const ln = (await store.getEntry("product", "life-net"))!;
    const d = productDraft.parse(ln.draft);
    await svc.save("product", "life-net", { draft: { ...d, tagline: "Cambio sin publicar." }, expectedVersion: ln.draftVersion }, "operador:jorge");
    const r = await applyCatalogAdditions(svc, store, { apply: true, author: AUTHOR, additions: [] });
    expect(r.conflicts).toEqual(["life-net: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno"]);
    expect(PRESENTATION_PATCHES_2026_11_08).toHaveLength(1);
  });
});

describe("prueba gratuita del plan Life (14 días, apagada por defecto)", () => {
  const DAY = 86_400_000;
  const T0 = Date.UTC(2026, 10, 8, 9);
  let n = 0;
  const key = () => `idem-life-${String(++n).padStart(8, "0")}`;
  const holder = { firstName: "Ana", lastName: "López", taxId: null };

  function harness(lifeTrials: boolean) {
    const store = new MemoryTrialStore();
    const trials = new TrialService({ store, now: () => T0 });
    const sent: string[] = [];
    const provisions: Array<{ tenantId: string; displayName: string; trialDays?: number }> = [];
    const created: Array<{ plan: { productKey: string; priceId: number }; trialDays?: number }> = [];
    const companies: Array<{ name: string }> = [];
    const ob = new TrialOnboardingService({
      trials,
      now: () => T0,
      lifeTrials,
      platformDomain: "app.example",
      notify: { verification: async () => void sent.push("verification"), welcome: async () => void sent.push("welcome"), expiryNotice: async () => undefined },
      provision: async (req: { tenantId: string; displayName: string; trialDays?: number }) => (provisions.push(req), { status: "completed", tenantId: req.tenantId, domain: `${req.tenantId}.app.example`, adminInviteToken: "invitacion" }),
      priceOf: async (k: string) => (k === "life" ? 31 : 7),
      companies: { byTenant: async () => null, create: async (input: { name: string }) => (companies.push(input), { id: companies.length }) },
      subscriptions: { list: async () => [], create: async (input: (typeof created)[number]) => (created.push(input), { id: created.length, status: "trialing" }) },
      licensing: { apply: async () => ({ applied: [], desired: [] }) },
    } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
    return { store, trials, ob, sent, provisions, created, companies };
  }

  it("interruptor propio: solo «1» exacto la enciende", () => {
    expect(lifeTrialsEnabled({})).toBe(false);
    expect(lifeTrialsEnabled({ CP_LIFE_TRIAL_ENABLED: "true" })).toBe(false);
    expect(lifeTrialsEnabled({ CP_LIFE_TRIAL_ENABLED: "1" })).toBe(true);
    expect([TRIAL_PLANS.life, TRIAL_PLANS.essential, LIFE_TRIAL_DAYS]).toEqual([14, 15, 14]);
  });

  it("apagada: no se registra ninguna prueba de Life", async () => {
    const h = harness(false);
    await expect(h.ob.registerLife({ email: "ana@example.com", holder, idempotencyKey: key() })).rejects.toMatchObject({ code: "unavailable" });
    expect(h.sent).toEqual([]);
  });

  it("encendida: titular particular y hogar; 14 días desde la activación con la suscripción del plan Life", async () => {
    const h = harness(true);
    const r = await h.ob.registerLife({ email: "ana@example.com", holder: { firstName: " Ana ", lastName: "López", taxId: "12345678z" }, idempotencyKey: key() });
    const t = await h.trials.must(r.trialId);
    expect([t.companyName, trialPlanOf(t)]).toEqual(["Hogar de Ana López", "life"]);
    expect(t.configuration.holder).toEqual({ firstName: "Ana", lastName: "López", taxId: "12345678Z" });
    expect(h.sent).toEqual(["verification"]);
    // Otra solicitud con nombre de hogar propio, verificada y activada
    const fresh = await h.trials.register({ email: "luis@example.com", companyName: "Casa Pérez", configuration: { plan: "life", addons: [], holder: { firstName: "Luis", lastName: "Pérez" } }, idempotencyKey: key() });
    await h.trials.verify(fresh.trial.id, fresh.verificationToken!);
    const out = await h.ob.activate(fresh.trial.id, "op");
    expect(out.trial.endsAt! - out.trial.startsAt!).toBe(14 * DAY);
    expect(out.trial.startsAt).toBe(T0);
    expect(h.provisions[0]).toMatchObject({ displayName: "Casa Pérez", trialDays: 14 });
    expect(h.created[0]).toMatchObject({ plan: { productKey: "life", priceId: 31 }, trialDays: 14 });
    expect(h.companies).toEqual([expect.objectContaining({ name: "Casa Pérez" })]);
  });

  it("una prueba de Life guardada no se activa con el interruptor apagado; Essential sigue igual (15 días)", async () => {
    const h = harness(false);
    const l = await h.trials.register({ email: "eva@example.com", companyName: "Casa Eva", configuration: { plan: "life", addons: [], holder }, idempotencyKey: key() });
    await h.trials.verify(l.trial.id, l.verificationToken!);
    await expect(h.ob.activate(l.trial.id, "op")).rejects.toMatchObject({ code: "unavailable" });
    expect(h.provisions).toEqual([]);
    const e = await h.trials.register({ email: "acme@example.com", companyName: "Acme", configuration: { plan: "essential", addons: [] }, idempotencyKey: key() });
    await h.trials.verify(e.trial.id, e.verificationToken!);
    const out = await h.ob.activate(e.trial.id, "op");
    expect(out.trial.endsAt! - out.trial.startsAt!).toBe(15 * DAY);
    expect(h.created[0]).toMatchObject({ plan: { productKey: "essential", priceId: 7 }, trialDays: 15 });
  });

  it("titular: nombre y apellidos obligatorios; el hogar toma su nombre si no se da otro", async () => {
    const h = harness(true);
    await expect(h.ob.registerLife({ email: "x@example.com", holder: { firstName: "", lastName: "López" }, idempotencyKey: key() })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(h.ob.registerLife({ email: "y@example.com", holder: { firstName: "Ana", lastName: "López", taxId: "no válido!" }, idempotencyKey: key() })).rejects.toMatchObject({ code: "invalid_input" });
    expect(householdNameOf({ firstName: "Ana", lastName: "López" }, "  Casa Azul ")).toBe("Casa Azul");
    expect(householdNameOf({ firstName: "Ana", lastName: "López" }, null)).toBe("Hogar de Ana López");
  });
});
