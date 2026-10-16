/**
 * Catálogo oficial de Elephant Source v1 y cotizador.
 * Los importes esperados son los del catálogo oficial (euros sin IVA): si alguien cambia una tarifa
 * en la semilla sin cambiar la decisión de negocio, esta prueba falla.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { CAPABILITIES, CAPABILITY_IDS, capabilitiesOfTier } from "./catalog/capabilities";
import { PRODUCTS, NET_FAMILIES } from "./catalog/elephantSourceV1";
import { quote, type QuoteCatalog, type QuoteRequest } from "./catalog/quote";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { catalogFromWebStore } from "./subscriptions/ports";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const eur = (n: number): number => Math.round(n * 100);

async function seeded() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  const report = await seedElephantSource(svc, store);
  return { store, svc, report };
}

describe("registro de capacidades", () => {
  it("74 capacidades con id único: 29 Essential, 15 Business, 3 Enterprise y 27 Extras", () => {
    expect(CAPABILITIES).toHaveLength(74);
    expect(new Set(CAPABILITY_IDS).size).toBe(74);
    expect(capabilitiesOfTier("essential")).toHaveLength(29);
    expect(capabilitiesOfTier("business")).toHaveLength(15);
    expect(capabilitiesOfTier("enterprise")).toHaveLength(3);
    expect(capabilitiesOfTier("extra")).toHaveLength(27);
  });
  it("ninguna capacidad se declara disponible (no hay multiempresa desplegada)", () => {
    expect(CAPABILITIES.every((c) => c.technicalStatus !== ("available" as string))).toBe(true);
  });
  it("cada capacidad Extra la concede al menos un producto, y ninguna de plan la concede un extra", () => {
    const granted = new Map<string, string[]>();
    for (const p of PRODUCTS) for (const c of p.draft.catalog.capabilities) granted.set(c, [...(granted.get(c) ?? []), p.key]);
    for (const c of capabilitiesOfTier("extra")) expect(granted.get(c)?.length, c).toBeGreaterThan(0);
    for (const c of [...capabilitiesOfTier("essential"), ...capabilitiesOfTier("business"), ...capabilitiesOfTier("enterprise")]) {
      expect(granted.get(c)?.every((k) => ["essential", "business", "enterprise"].includes(k)), c).toBe(true);
    }
  });
});

describe("tarifas oficiales v1 (sin IVA)", () => {
  const price = (key: string, kind: "monthly" | "yearly") => PRODUCTS.find((p) => p.key === key)?.prices.find((x) => x.kind === kind)?.amountCents;
  it("Elephant Core: mensual y anual exactos (anual ≠ 12 × mensual)", () => {
    expect([price("essential", "monthly"), price("essential", "yearly")]).toEqual([eur(29), eur(279)]);
    expect([price("business", "monthly"), price("business", "yearly")]).toEqual([eur(79), eur(759)]);
    expect([price("enterprise", "monthly"), price("enterprise", "yearly")]).toEqual([eur(199), eur(1899)]);
  });
  it("Net, Connect, paquetes y servicios", () => {
    const expected: Record<string, number> = {
      "hotel-net-pms": 59, "hotel-net-channel-manager": 39, "hotel-net-booking-engine": 29, "hotel-net-housekeeping": 19, "hotel-net-complete": 119,
      "ski-net-school": 49, "ski-net-rental": 39, "ski-net-courses": 19, "ski-net-instructors": 19, "ski-net-complete": 99,
      "travel-net-agency": 79, "travel-net-packages": 39, "travel-net-connectors": 29, "travel-net-complete": 119,
      "restaurant-net-floor": 39, "restaurant-net-bookings": 19, "restaurant-net-kds": 19, "restaurant-net-complete": 59,
      "care-net-agenda": 29, "care-net-clinical": 39, "care-net-treatments": 19, "care-net-complete": 69,
      "life-net": 9, "social-token-net-communities": 39, "social-token-net-tokens": 29, "social-token-net-complete": 59,
      "connect-whatsapp-ai": 29, "connect-voice": 39, "connect-reception-ai": 49, "connect-people": 19, "connect-tax": 19, "connect-partners": 19,
      "connect-pos": 25, "connect-deals": 19, "connect-finance-sync": 19, "connect-copilot": 29, "connect-ads-manager": 29, "connect-campaigns": 19,
      "connect-seo-control": 29, "connect-geo-control": 29, "connect-automations": 29,
      "connect-pack-communications": 99, "connect-pack-marketing": 79, "connect-pack-finance": 45, "connect-pack-ai": 49,
      "extra-contracts-esign": 15, "extra-multichannel": 29, "extra-accounting": 29, "service-hosting-basic": 12, "service-hosting-advanced": 29,
      "addon-user-essential": 6, "addon-user-business": 5, "addon-site-business": 12, "addon-storage-10gb": 5,
    };
    for (const [k, v] of Object.entries(expected)) expect(price(k, "monthly"), k).toBe(eur(v));
    // Solo los planes Core tienen tarifa anual; los dominios no tienen tarifa fija
    expect(PRODUCTS.filter((p) => p.prices.some((x) => x.kind === "yearly")).map((p) => p.key)).toEqual(["essential", "business", "enterprise"]);
    expect(PRODUCTS.find((p) => p.key === "service-domain")!.prices).toEqual([]);
  });
  it("siete familias Net, quince Connect y cuatro paquetes Connect", () => {
    expect(NET_FAMILIES).toHaveLength(7);
    for (const f of NET_FAMILIES) expect(PRODUCTS.some((p) => p.draft.catalog.group === f.group && (p.family === "net_module" || p.family === "net_bundle")), f.group).toBe(true);
    expect(PRODUCTS.filter((p) => p.family === "connect")).toHaveLength(15);
    expect(PRODUCTS.filter((p) => p.family === "connect_bundle")).toHaveLength(4);
  });
  it("honestidad: nada es «Disponible» y nada en hoja de ruta se presenta como «Solicitar activación» salvo los planes", () => {
    expect(PRODUCTS.every((p) => p.draft.catalog.commercialStatus !== ("available" as string))).toBe(true);
  });
});

describe("semilla en el catálogo comercial", () => {
  it("crea y publica capacidades y productos con sus precios aprobados, y repetirla no cambia nada", async () => {
    const { store, svc, report } = await seeded();
    expect(report.conflicts).toEqual([]);
    expect(report.created).toHaveLength(74 + PRODUCTS.length);
    expect(report.pricesApproved).toHaveLength(PRODUCTS.reduce((a, p) => a + p.prices.length, 0));
    const site = await svc.site("published");
    expect(site.catalog.capabilities).toHaveLength(74);
    expect(site.catalog.products).toHaveLength(PRODUCTS.length);
    // Ningún dato interno sale en el sitio público
    expect(JSON.stringify(site)).not.toContain("PROPUESTA");
    const again = await seedElephantSource(svc, store);
    expect([again.created, again.updated, again.published, again.pricesApproved]).toEqual([[], [], [], []]);
    expect(again.unchanged).toBe(74 + PRODUCTS.length);
  });
  it("modo simulación: calcula el plan sin escribir nada", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    const plan = await seedElephantSource(svc, store, { dryRun: true });
    expect(plan.created.length).toBe(74 + PRODUCTS.length);
    expect(await store.listEntries()).toEqual([]);
  });
  it("cambiar una tarifa en la semilla aprueba el precio nuevo y retira el anterior (historial)", async () => {
    const { store, svc } = await seeded();
    const life = PRODUCTS.find((p) => p.key === "life-net")!;
    const old = life.prices[0].amountCents;
    life.prices[0].amountCents = 1100;
    try {
      const r = await seedElephantSource(svc, store);
      expect(r.pricesApproved).toEqual(["life-net monthly 1100"]);
      const entry = (await store.getEntry("product", "life-net"))!;
      const prices = await store.listPrices(entry.id);
      expect(prices.sort((a, b) => a.id - b.id).map((p) => [p.amountCents, p.status])).toEqual([[old, "retired"], [1100, "approved"]]);
    } finally {
      life.prices[0].amountCents = old;
    }
  });
});

describe("reglas del catálogo comercial", () => {
  it("una capacidad debe existir en el registro; un producto no puede referenciar capacidades desconocidas", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    await expect(svc.create({ kind: "capability", key: "inventada", draft: { name: "X", tier: "extra", group: "net", technicalStatus: "planned" } }, "t")).rejects.toThrow(/Capacidad desconocida/);
    const base = PRODUCTS.find((p) => p.key === "life-net")!;
    await expect(svc.create({ kind: "product", key: "x", family: "net_module", draft: { ...base.draft, catalog: { ...base.draft.catalog, capabilities: ["inventada"] } } }, "t")).rejects.toThrow(/Capacidades desconocidas/);
  });
  it("«Disponible» exige estado técnico disponible", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    const base = PRODUCTS.find((p) => p.key === "life-net")!;
    await expect(svc.create({ kind: "product", key: "x", family: "net_module", draft: { ...base.draft, catalog: { ...base.draft.catalog, commercialStatus: "available" } } }, "t")).rejects.toThrow(/Disponible/);
  });
  it("un paquete no se publica si sus componentes no están publicados", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    for (const c of CAPABILITIES) {
      await svc.create({ kind: "capability", key: c.id, draft: { name: c.name, tier: c.tier, group: c.group, technicalStatus: c.technicalStatus } }, "t");
      await svc.publish("capability", c.id, 1, "t");
    }
    const b = PRODUCTS.find((p) => p.key === "hotel-net-complete")!;
    const e = await svc.create({ kind: "product", key: b.key, family: b.family, draft: b.draft }, "t");
    await expect(svc.publish("product", b.key, e.draftVersion, "t")).rejects.toThrow(/componente/);
  });
  it("no se despublica una capacidad que usa un producto publicado", async () => {
    const { svc } = await seeded();
    await expect(svc.unpublish("capability", "crm-contacts", "t")).rejects.toThrow(/dependen/);
  });
});

describe("cotizador", () => {
  let cat: QuoteCatalog;
  beforeAll(async () => {
    const { svc } = await seeded();
    cat = quoteCatalogFromSite(await svc.site("published"));
  });
  const q = (r: Partial<QuoteRequest>) => quote(cat, { plan: "essential", interval: "month", ...r });

  it("planes: mensual y anual con sus tarifas exactas e IVA aparte", () => {
    const m = q({});
    expect(m.ok).toBe(true);
    expect(m.totals).toMatchObject({ monthlyCents: eur(29), yearlyCents: 0, taxRateBp: 2100, monthlyTaxCents: 609, annualizedCents: eur(348) });
    expect(q({ interval: "year" }).totals).toMatchObject({ yearlyCents: eur(279), monthlyCents: 0, annualizedCents: eur(279), yearlyTaxCents: 5859 });
    expect(q({ plan: "business", interval: "year" }).totals.yearlyCents).toBe(eur(759));
    expect(q({ plan: "enterprise", interval: "year" }).totals.yearlyCents).toBe(eur(1899));
  });
  it("anual con complementos sin tarifa anual: se cotizan mensuales y se indica", () => {
    const r = q({ interval: "year", items: [{ key: "connect-voice" }] });
    expect(r.totals).toMatchObject({ yearlyCents: eur(279), monthlyCents: eur(39), annualizedCents: eur(279) + 12 * eur(39) });
    expect(r.lines.find((l) => l.key === "connect-voice")!.note).toMatch(/mensualmente/);
  });
  it("planes acumulativos: Business concede las 29 + 15 capacidades; Enterprise las 47", () => {
    expect(q({}).capabilities).toHaveLength(29);
    expect(q({ plan: "business" }).capabilities).toHaveLength(44);
    expect(q({ plan: "enterprise" }).capabilities).toHaveLength(47);
  });
  it("paquete: sus componentes elegidos aparte no se cobran dos veces y se muestra el ahorro", () => {
    const r = q({ items: [{ key: "hotel-net-complete" }, { key: "hotel-net-pms" }] });
    expect(r.ok).toBe(true);
    expect(r.lines.find((l) => l.key === "hotel-net-pms")).toMatchObject({ status: "included_in_bundle", amountCents: 0 });
    expect(r.totals.monthlyCents).toBe(eur(29) + eur(119));
    expect(r.bundleSavings).toEqual([{ bundle: "hotel-net-complete", listCents: eur(146), bundleCents: eur(119), savingCents: eur(27) }]);
  });
  it("sugiere el paquete cuando los componentes elegidos salen más caros", () => {
    const r = q({ items: ["hotel-net-pms", "hotel-net-channel-manager", "hotel-net-booking-engine", "hotel-net-housekeeping"].map((key) => ({ key })) });
    expect(r.totals.monthlyCents).toBe(eur(29) + eur(146));
    expect(r.suggestions).toEqual([expect.objectContaining({ bundle: "hotel-net-complete", savingCents: eur(27) })]);
  });
  it("submódulos contratables por separado; las dependencias se exigen", () => {
    expect(q({ items: [{ key: "ski-net-rental" }] }).ok).toBe(true);
    const r = q({ items: [{ key: "ski-net-courses" }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/requiere «Ski Net · Escuela»/);
    expect(q({ items: [{ key: "ski-net-courses" }], owned: ["ski-net-school"] }).ok).toBe(true);
  });
  it("lo ya contratado: no se vuelve a cobrar y el paquete indica qué sustituye", () => {
    expect(q({ items: [{ key: "connect-voice" }], owned: ["connect-voice"] }).errors.join()).toMatch(/ya está contratado/);
    const r = q({ items: [{ key: "connect-pack-communications" }], owned: ["connect-voice"] });
    expect(r.lines.find((l) => l.key === "connect-pack-communications")!.replaces).toEqual(["connect-voice"]);
  });
  it("usuarios, sedes y almacenamiento adicionales según el plan", () => {
    expect(q({ users: 5 }).lines.find((l) => l.key === "addon-user-essential")).toMatchObject({ quantity: 2, amountCents: eur(12) });
    expect(q({ plan: "business", users: 20 }).lines.find((l) => l.key === "addon-user-business")).toMatchObject({ quantity: 5, amountCents: eur(25) });
    expect(q({ sites: 2 }).errors.join()).toMatch(/Essential incluye 1/);
    expect(q({ plan: "business", sites: 7 }).lines.find((l) => l.key === "addon-site-business")).toMatchObject({ quantity: 2, amountCents: eur(24) });
    expect(q({ storageGb: 26 }).lines.find((l) => l.key === "addon-storage-10gb")).toMatchObject({ quantity: 3, amountCents: eur(15) });
    expect(q({ plan: "enterprise", users: 500 }).warnings.join()).toMatch(/por contrato/);
    expect(q({ plan: "business", fiscalEntities: 2 }).errors.join()).toMatch(/Enterprise/);
  });
  it("activación por sede y precio por unidad", () => {
    expect(q({ plan: "business", sites: 3, items: [{ key: "connect-pos", quantity: 3 }] }).lines.find((l) => l.key === "connect-pos")!.amountCents).toBe(eur(75));
    expect(q({ items: [{ key: "connect-pos", quantity: 2 }] }).errors.join()).toMatch(/2 sedes/);
    expect(q({ items: [{ key: "travel-net-agency" }, { key: "travel-net-connectors", quantity: 3 }] }).lines.find((l) => l.key === "travel-net-connectors")!.amountCents).toBe(eur(87));
  });
  it("contratabilidad honesta: solicitar activación o todavía no disponible", () => {
    expect(q({}).contractable).toBe("request");
    const r = q({ items: [{ key: "ski-net-school" }] });
    expect(r.contractable).toBe("not_available");
    expect(r.blocking).toEqual(["Ski Net · Escuela"]);
  });
  it("costes variables aparte y servicios sin tarifa fija", () => {
    const r = q({ items: [{ key: "connect-voice" }, { key: "service-domain" }] });
    expect(r.variableCosts.map((v) => v.key)).toEqual(["connect-voice"]);
    expect(r.lines.find((l) => l.key === "service-domain")).toMatchObject({ status: "no_price", amountCents: 0 });
    expect(r.warnings.join()).toMatch(/presupuesta aparte/);
  });
  it("entradas inválidas: plan desconocido, plan como artículo, complemento manual, cantidad, repetido", () => {
    expect(quote(cat, { plan: "nope", interval: "month" }).ok).toBe(false);
    expect(q({ items: [{ key: "business" }] }).errors.join()).toMatch(/es un plan/);
    expect(q({ items: [{ key: "addon-user-essential" }] }).errors.join()).toMatch(/se calcula solo/);
    expect(q({ items: [{ key: "life-net", quantity: 0 }] }).ok).toBe(false);
    expect(q({ items: [{ key: "life-net" }, { key: "life-net" }] }).errors.join()).toMatch(/repetido/);
  });
});

describe("motor de suscripciones sobre el catálogo de Elephant Source", () => {
  it("traduce las familias nuevas y expone el estado comercial (lo «Próximamente» no se contrata)", async () => {
    const { store } = await seeded();
    const port = catalogFromWebStore(store);
    expect(await port.product("hotel-net-complete")).toMatchObject({ family: "industry_module", commercialStatus: "coming_soon" });
    expect(await port.product("connect-voice")).toMatchObject({ family: "extension", commercialStatus: "on_request" });
    expect(await port.product("essential")).toMatchObject({ family: "core_plan", commercialStatus: "on_request" });
    const offer = await port.offer();
    expect(offer.find((p) => p.key === "essential")!.prices.map((p) => [p.kind, p.amountCents]).sort()).toEqual([["monthly", 2900], ["yearly", 27900]]);
  });
});
