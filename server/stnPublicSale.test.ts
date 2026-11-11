/**
 * Social Token Net (clase A) en la web pública: PREPARADO, NO encendido (11/11/2026). Comprueba con dobles (sin Stripe
 * real) el camino que seguiría el primer cobro supervisado con los interruptores documentados en
 * docs/elephant-source/CHECKOUT_UNIFICADO.md: Essential + Social Token Net, en el modo live (Prices sin IVA), con el
 * catálogo sembrado igual que production (Social Token Net disponible, inmediata con Checkout) y la elegibilidad de un
 * comprador empresa de la Península.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { catalogFromWebStore } from "./subscriptions/ports";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { PublicCart, publicCheckoutProductsFromEnv } from "./stripe/publicCart";
import { checkEligibility, consumerRatesFromEnv, scenarioCountriesFromEnv } from "./stripe/eligibility";
import type { ConsentVersions } from "./stripe/buyerProfile";

const NOW = Date.UTC(2026, 10, 11, 12);
const STN = "social-token-net-complete";
let cart: (allowed: ReadonlySet<string>) => PublicCart;
let web: WebAdminService;

beforeAll(async () => {
  const store = new MemoryWebStore();
  web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  // Essential, a la venta en línea como en production (la semilla no lo pone: solo Social Token Net)
  const { entry: e } = await web.get("product", "essential");
  const draft = structuredClone(e.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
  draft.technicalStatus = "available";
  draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available", offer: { modality: "immediate", checkout: true, trial: true } };
  const saved = await web.save("product", "essential", { draft, expectedVersion: e.draftVersion }, "operator:test");
  await web.publish("product", "essential", saved.draftVersion, "operator:test");
  const gw = new FakeStripeGateway();
  const stripe = new MemoryStripeStore();
  const desired = await desiredCatalog(catalogFromWebStore(store));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  const linked = await syncCatalog(desired, gw, stripe, NOW);
  expect(linked.linked.filter((l) => l.sellable).map((l) => l.lookupKey).some((k) => k.startsWith(`es:${STN}:monthly`))).toBe(true);
  cart = (allowed) => new PublicCart({ allowed, catalog: catalogFromWebStore(store), site: async () => quoteCatalogFromSite(await web.site("published")), store: stripe, gateway: gw, requireExclusive: true, now: () => NOW });
});

describe("Social Token Net en la web pública (preparado, apagado)", () => {
  it("interruptor de la lista blanca: el valor documentado habilita SOLO Social Token Net; vacío, nada", () => {
    expect(Array.from(publicCheckoutProductsFromEnv({ CP_PUBLIC_CHECKOUT_PRODUCTS: STN } as NodeJS.ProcessEnv))).toEqual([STN]);
    expect(publicCheckoutProductsFromEnv({} as NodeJS.ProcessEnv).size).toBe(0);
  });

  it("primer cobro supervisado: Essential 29 € + Social Token Net 59 € = 88 € al mes, IVA aparte, Prices sin IVA (live)", async () => {
    const v = await cart(new Set([STN])).validate({ plan: "essential", interval: "month", products: [STN] });
    expect(v.request).toEqual({ plan: "essential", interval: "month", items: [{ key: STN }] });
    expect(v.lines.recurring.map((l) => [l.productKey, l.unitAmountCents, l.quantity])).toEqual([["essential", 2900, 1], [STN, 5900, 1]]);
    expect(v.lines).toMatchObject({ firstChargeCents: 8800, monthlyCents: 8800, yearlyCents: 0 });
    expect(v.lines.deferred).toEqual([]);
  });

  it("sin el valor en la lista blanca (hoy en production): Social Token Net no se vende en la web; anual tampoco (solo mensual)", async () => {
    await expect(cart(new Set()).validate({ plan: "essential", interval: "month", products: [STN] })).rejects.toMatchObject({ code: "no_online", product: STN });
    await expect(cart(new Set([STN])).validate({ plan: "essential", interval: "year", products: [STN] })).rejects.toMatchObject({ code: "incompatible", product: STN });
  });

  it("elegibilidad del comprador del primer cobro: empresa de la Península con NIF válido y domicilio; sin escenario aprobado, no", () => {
    const consent: ConsentVersions = { terms: "v1", privacy: "2026-10-25", precontract: "pre1", withdrawal: "immediate_execution_ack" };
    const approved = { scenarios: new Set(["business:es_mainland" as const]), taxExpectations: new Map([["business:es_mainland" as const, "taxed" as const]]), countries: scenarioCountriesFromEnv({ CP_STRIPE_SCENARIO_COUNTRIES: "" }), consumerRates: consumerRatesFromEnv({ CP_STRIPE_CONSUMER_RATES: "" }), consent };
    const buyer = { type: "business" as const, country: "ES", postalCode: "28002", taxId: "B26987875", hasAddress: true };
    expect(checkEligibility(buyer, approved, { requireAddress: true })).toMatchObject({ eligible: true, scenario: "business:es_mainland", taxExpectation: "taxed" });
    expect(checkEligibility(buyer, { ...approved, scenarios: new Set() }, { requireAddress: true }).eligible).toBe(false);
    expect(checkEligibility({ ...buyer, hasAddress: false }, approved, { requireAddress: true }).reasons).toContain("address_incomplete");
  });
});
