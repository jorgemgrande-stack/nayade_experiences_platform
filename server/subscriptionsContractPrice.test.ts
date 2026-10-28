/**
 * Precio negociado por contrato (I-10): la partida guarda el importe pactado con la referencia de la versión del
 * contrato que lo ampara; nunca entra en una suscripción cobrada por Stripe, y el Checkout sigue cobrando solo
 * tarifas aprobadas (un importe distinto del aprobado es `conflict`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { planCheckoutLines } from "./stripe/checkoutLines";
import type { QuoteResult } from "./catalog/quote";

const A = "operator:ana";
const T0 = Date.UTC(2026, 10, 1, 10);

const crm: CrmPort = {
  company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : null),
  contract: async (id) =>
    id === 10
      ? { id: 10, reference: "CT-2026-000010", companyId: 1, status: "signed", amountCents: 7900, currency: "EUR", billingInterval: "month", tenantId: null }
      : id === 12
        ? { id: 12, reference: "CT-2026-000012", companyId: 1, status: "signed", amountCents: 7900, currency: "EUR", billingInterval: "month", tenantId: null }
        : null,
};

let clock: number;
let web: WebAdminService;
let webStore: MemoryWebStore;
let store: MemorySubscriptionStore;
let stripeBilled: boolean;
let subs: SubscriptionService;
let shadow: ShadowBillingService;
const P: Record<string, number> = {};

const draft = (name: string, activation: { kind: string; ref: string | null }, billingModel: string) => ({ name, technicalStatus: "available", activation, billingModel });
async function product(key: string, family: string, d: Record<string, unknown>) {
  await web.create({ kind: "product", key, family: family as never, draft: d }, A);
  await web.publish("product", key, 1, A);
}
async function price(name: string, key: string, kind: "monthly" | "yearly", amountCents: number) {
  const p = await web.addPrice(key, { kind, amountCents, taxRateBp: 2100 } as never, A);
  await web.approvePrice(p.id, A);
  P[name] = p.id;
}

beforeEach(async () => {
  clock = T0;
  stripeBilled = false;
  webStore = new MemoryWebStore();
  web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
  await product("essential", "core_plan", draft("Essential", { kind: "plan", ref: "essential" }, "subscription"));
  await product("business", "core_plan", draft("Business", { kind: "plan", ref: "business" }, "subscription"));
  await product("telefonia", "extension", draft("Telefonía IA", { kind: "feature", ref: null }, "recurring_addon"));
  await price("essM", "essential", "monthly", 4900);
  await price("busM", "business", "monthly", 9900);
  await price("busY", "business", "yearly", 99000);
  await price("telM", "telefonia", "monthly", 2000);
  await price("telY", "telefonia", "yearly", 20000);
  store = new MemorySubscriptionStore();
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock, stripeBilled: async () => stripeBilled });
  shadow = new ShadowBillingService({ store, crm, now: () => clock });
});

const negotiated = (unitAmountCents: number, contractRef = "contract:10:v1") => ({ unitAmountCents, contractRef });
const base = (over: Record<string, unknown> = {}) =>
  subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(7900) }, ...over } as never, A);

describe("precio de contrato por partida", () => {
  it("el alta guarda el importe pactado (origen «contract») y la simulación lo factura", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM }] });
    const d = await subs.detail(s.id);
    expect(d.items.map((i) => [i.productKey, i.priceSource, i.unitAmountCents, i.priceId])).toEqual([
      ["business", "contract", 7900, P.busM],
      ["telefonia", "catalog", 2000, P.telM],
    ]);
    const sim = await shadow.simulateCurrent(s.id, A);
    expect(sim.results[0].invoice.subtotalCents).toBe(9900);
  });

  it("exige la referencia del contrato de la suscripción, importe positivo y sin descuento añadido", async () => {
    await expect(base({ plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(7900, "contract:12:v1") } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(base({ plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(7900, "CT-2026-000010") } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(base({ contractId: null })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(base({ plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(0) } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      base({ plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(7900), discount: { kind: "percent", value: 10, endsAt: null, note: null } } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await subs.list({})).toEqual([]);
  });

  it("añadir o cambiar a un precio de contrato en una suscripción cobrada por Stripe es invalid_state", async () => {
    const s = await subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "business", priceId: P.busM } }, A);
    stripeBilled = true;
    await expect(subs.addItem(s.id, { item: { productKey: "telefonia", priceId: P.telM, contractPrice: negotiated(1500) } }, s.version, A)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(subs.changePlan(s.id, { plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(8900) } }, s.version, A)).rejects.toMatchObject({ code: "invalid_state" });
    // Sin precio de contrato la guarda no interviene (las operaciones de Stripe se rechazan en la API)
    stripeBilled = false;
    const item = await subs.addItem(s.id, { item: { productKey: "telefonia", priceId: P.telM, contractPrice: negotiated(1500) } }, s.version, A);
    expect(item).toBeTruthy();
    expect((await subs.detail(s.id)).items.find((i) => i.productKey === "telefonia")).toMatchObject({ priceSource: "contract", unitAmountCents: 1500 });
  });

  it("renegociar el importe del mismo plan es un cambio; mismo importe, no", async () => {
    const s = await base();
    await expect(subs.changePlan(s.id, { plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(7900, "contract:10:v2") } }, s.version, A)).rejects.toMatchObject({ code: "invalid_input" });
    await subs.changePlan(s.id, { plan: { productKey: "business", priceId: P.busM, contractPrice: negotiated(8900, "contract:10:v2") }, when: "now" }, s.version, A);
    const live = (await subs.detail(s.id)).items.filter((i) => i.effectiveTo === null);
    expect(live.map((i) => i.unitAmountCents)).toEqual([8900]);
  });

  it("cambiar la periodicidad con precios de contrato exige una nueva versión del contrato", async () => {
    const s = await base();
    const plan = (await subs.detail(s.id)).items[0];
    await expect(subs.changeInterval(s.id, { interval: "year", prices: [{ itemId: plan.id, priceId: P.busY }] }, s.version, A)).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("el Checkout de Stripe no cobra precios de contrato", () => {
  it("una línea con importe distinto del precio aprobado es conflict", async () => {
    const catalog = catalogFromWebStore(webStore);
    const q = {
      ok: true,
      errors: [],
      lines: [{ key: "business", name: "Business", family: "core_plan", quantity: 1, unitCents: 7900, amountCents: 7900, interval: "month", status: "included", commercialStatus: "available", note: null }],
    } as unknown as QuoteResult;
    const order = { request: { plan: "business", interval: "month", items: [] }, quote: { currency: "EUR", contractAmountCents: 7900, firstPeriodNetCents: 7900 } } as never;
    const deps = { catalog, store: { priceForWebPrice: async () => null }, gateway: { pricesByLookupKeys: async () => [] } } as never;
    await expect(planCheckoutLines(deps, order, q)).rejects.toMatchObject({ code: "conflict" });
  });
});
