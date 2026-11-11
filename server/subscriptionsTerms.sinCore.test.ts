/**
 * Condiciones comerciales personalizadas SIN plan de Elephant Core: un acuerdo solo con partidas a medida crea una
 * suscripción puramente económica (sin plan, sin plataforma, sin licencias ni límites), con todo el circuito de
 * siempre: vista previa, documento, facturación simulada, renovación y plan de cobro. Catálogo REAL de Elephant
 * Source: la obligación del plan sale de sus datos (compatibilidad, ampliaciones y tipo de activación).
 *
 * Caso real: una empresa que solo paga costes de infraestructura, 44,63 € + 21 % de IVA = 54,00 € al mes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { LicensingService } from "./licensing/service";
import { catalogFromWebStore, type CatalogPort, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService, licencePlan, needsCorePlan, subscriptionEffective } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, TermsError, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { TermsLicences } from "./commercialTerms/licences";
import { TermsBillingService } from "./commercialTerms/billing";
import { presentTerms, renderTermsDocument } from "./commercialTerms/presentation";
import { tenantTermsReader } from "./commercialTerms/tenantView";

const A = "operator:ana";
const T0 = Date.UTC(2026, 10, 1, 10);
const MONTH = (n: number) => Date.UTC(2026, 10 + n, 1, 10);
const DAY = 86_400_000;
const crm: CrmPort = { company: async (id) => ({ id, name: `Empresa ${id}` }), contract: async () => null };

let clock: number;
let webStore: MemoryWebStore;
let catalog: CatalogPort;
let store: MemorySubscriptionStore;
let termsStore: MemoryTermsStore;
let subs: SubscriptionService;
let caps: MemoryCapabilityStore;
let limits: MemoryTenantLimitStore;
let licensing: LicensingService;
let licences: TermsLicences;
let terms: CommercialTermsService;
let shadow: ShadowBillingService;
let billing: TermsBillingService;
let tenants: Map<number, string>;
let P: Record<string, number>;

beforeEach(async () => {
  clock = T0;
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  P = {};
  for (const key of ["essential", "business", "hotel-net-complete", "connect-voice", "connect-people", "addon-user-essential", "service-hosting-basic"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  catalog = catalogFromWebStore(webStore);
  store = new MemorySubscriptionStore();
  termsStore = new MemoryTermsStore();
  subs = new SubscriptionService({ store, catalog, crm, now: () => clock });
  caps = new MemoryCapabilityStore();
  limits = new MemoryTenantLimitStore();
  licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock, limits });
  tenants = new Map();
  // Como en el plano de control: licencias tras cada cambio y reintento al registrar una simulación
  licences = new TermsLicences({ auto: true, licensing, limits, capabilities: caps, subscriptions: subs, subscriptionStore: store, termsStore, companyTenant: async (id) => tenants.get(id) ?? null, now: () => clock });
  terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm, now: () => clock, afterChange: (sid, actor) => licences.afterChange(sid, actor) });
  shadow = new ShadowBillingService({ store, crm, now: () => clock, settle: (id) => terms.settleDue(id), onSimulate: (id) => licences.retryIfPending(id) });
  billing = new TermsBillingService({ enabled: false, termsStore, subscriptionStore: store, now: () => clock });
});

const cat = (key: string, over: Partial<Extract<LineInput, { kind: "catalog" }>> = {}): LineInput => ({ kind: "catalog", productKey: key, priceId: P[key], ...over });
const custom = (name: string, unitCents: number, over: Partial<Extract<LineInput, { kind: "custom" }>> = {}): LineInput => ({ kind: "custom", concept: "other", name, chargeClass: "recurring", unitCents, taxRateBp: 2100, ...over });
const input = (lines: LineInput[], over: Partial<TermsInput> = {}): TermsInput => ({ pricingMode: "per_item", presentation: "breakdown", interval: "month", lines, reason: "Acuerdo comercial negociado", ...over });
/** El caso real: una sola partida a medida de 44,63 € al mes con el 21 % de IVA. */
const INFRA = (over: Partial<Extract<LineInput, { kind: "custom" }>> = {}) => custom("Costes de infraestructura", 4463, over);
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof TermsError) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("se esperaba un error");
};
async function contract(companyId: number, i: TermsInput) {
  const draft = await terms.createPackage(companyId, i, A);
  return terms.prepareContracting(draft.id, { expectedRevision: draft.revision }, A);
}
const liveItems = async (subId: number, at = clock) => (await store.items(subId)).filter((i) => i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at));
const licenceEvents = async (subscriptionId: number) => (await termsStore.events({ subscriptionId })).filter((e) => e.kind.startsWith("licences_")).map((e) => e.kind);
async function billPeriod(subId: number) {
  await subs.applyRenewals(subId, "system:test");
  return (await shadow.simulateCurrent(subId, "system:test")).results.map((r) => r.invoice);
}

describe("caso real — solo costes de infraestructura: 44,63 € + 21 % = 54,00 € al mes, sin plan ni plataforma", () => {
  it("vista previa: 44,63 + 9,37 = 54,00, ninguna línea de plan y ningún efecto sobre las licencias", async () => {
    const draft = await terms.createPackage(1, input([INFRA()]), A);
    expect(draft).toMatchObject({ status: "draft", subscriptionId: null });
    const p = await terms.preview(draft.id);
    // 44,63 × 1,21 = 54,0023 → 54,00
    expect(p.summary.recurring).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.summary.recurring.lines.map((l) => [l.name, l.kind])).toEqual([["Costes de infraestructura", "custom"]]);
    expect(p.summary.first).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.nextCharge).toEqual({ at: T0, netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.effectiveFrom).toBe(T0);
    expect(p.prorationNetCents).toBe(0);
    expect(p.licences).toMatchObject({ grantsNothing: true, planBefore: null, planAfter: null, planProductBefore: null, planProductAfter: null, added: [], removed: [], kept: [], products: { added: [], removed: [], kept: [] } });
    expect(p.licences.note).toMatch(/no concede licencias/);
    expect(p.licences.note).toMatch(/ninguna plataforma/);
    expect(JSON.stringify(p)).not.toMatch(/essential/i);
  });

  it("contratación: una suscripción de la EMPRESA sin plan, sin plataforma y sin contrato, con la partida a medida", async () => {
    const out = await contract(1, input([INFRA()]));
    expect(out.terms).toMatchObject({ status: "active", effectiveFrom: T0 });
    expect(out.subscription).toMatchObject({ companyId: 1, tenantId: null, contractId: null, status: "active", currency: "EUR", interval: "month", currentPeriodStart: T0, currentPeriodEnd: MONTH(1), startedAt: T0, trialEnd: null });
    const all = await store.items(out.subscription.id);
    // Ni una partida de plan (tampoco una «fantasma» del alta): solo la partida a medida
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ family: "service", activationKind: "none", activationRef: null, priceId: null, priceKind: "monthly", priceSource: "contract", lineAmountCents: 4463, taxRateBp: 2100, effectiveFrom: T0, effectiveTo: null, termsId: out.terms.id });
    expect(all[0].productKey).toMatch(/^custom:[a-z0-9]+$/);
    expect(licencePlan(out.subscription, all, clock)).toMatchObject({ plan: null, modules: [] });
    expect(subscriptionEffective(out.subscription, clock)).toMatchObject({ status: "active", nextRenewalAt: MONTH(1) });
    const created = (await store.events(out.subscription.id)).find((e) => e.kind === "created")!;
    expect(created.after).toMatchObject({ plan: null, addons: [], withoutPlan: true });
    // El historial del acuerdo, como el de cualquier paquete
    expect((await termsStore.events({ termsId: out.terms.id })).map((e) => e.kind)).toEqual(["draft_created", "subscription_created", "activated"]);
    expect((await terms.ofSubscription(out.subscription.id)).currentRecurring).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
  });

  it("no concede nada: ni licencias, ni límites, ni «pendiente de plataforma», ni reintentos", async () => {
    const out = await contract(1, input([INFRA()]));
    const sid = out.subscription.id;
    expect(await licenceEvents(sid)).toEqual([]);
    expect(await licences.ensure(sid, A)).toMatchObject({ status: "not_applicable" });
    expect(await licences.ensure(sid, A, { force: true })).toMatchObject({ status: "not_applicable" });
    await licences.retryIfPending(sid);
    await shadow.simulateCurrent(sid, A);
    expect(await licenceEvents(sid)).toEqual([]);
    expect(await licensing.limitsFor(sid)).toEqual([]);
    expect(await licences.status(sid)).toMatchObject({ applicable: false, tenantId: null, linked: false, last: null, plan: null });
    expect((await licences.status(sid)).note).toMatch(/no concede licencias/);
  });

  it("si la empresa ya tiene plataforma por otro motivo, no se enlaza ni cambia nada en ella", async () => {
    tenants.set(1, "acme");
    await caps.apply("acme", [{ capabilityId: "crm", siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "seed", reason: "otra contratación", now: clock });
    await limits.setLimits("acme", [{ metric: "users", limit: 7 }], { source: "operator", actor: "seed", now: clock });
    const before = JSON.stringify([await caps.list("acme"), await limits.limits("acme")]);
    const out = await contract(1, input([INFRA()]));
    const sid = out.subscription.id;
    expect(await licences.companyOnboarded(1)).toEqual([]);
    expect(await licences.ensure(sid, A, { force: true })).toMatchObject({ status: "not_applicable" });
    expect((await store.get(sid))!.tenantId).toBeNull();
    expect((await store.events(sid)).map((e) => e.kind)).not.toContain("tenant_linked");
    expect(JSON.stringify([await caps.list("acme"), await limits.limits("acme")])).toBe(before);
    expect(await licenceEvents(sid)).toEqual([]);
    expect(await licences.status(sid)).toMatchObject({ applicable: false, tenantId: null });
  });

  it("facturación simulada: el primer periodo empieza con el acuerdo y es un mes completo (54,00), sin parte proporcional; después renueva igual", async () => {
    const out = await contract(1, input([INFRA()]));
    const sid = out.subscription.id;
    const first = await billPeriod(sid);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "renewal", periodStart: T0, periodEnd: MONTH(1), currency: "EUR", subtotalCents: 4463, discountCents: 0, taxCents: 937, totalCents: 5400 });
    expect(first[0].lines).toHaveLength(1);
    expect(first[0].lines[0]).toMatchObject({ fraction: 1, netCents: 4463, taxRateBp: 2100, taxCents: 937, totalCents: 5400, priceId: null });
    // Repetir no duplica
    expect((await shadow.simulateCurrent(sid, A)).results.map((r) => [r.created, r.drift])).toEqual([[false, null]]);
    // Renovación mensual automática
    clock = MONTH(1) + 1000;
    const second = await billPeriod(sid);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ kind: "renewal", periodStart: MONTH(1), periodEnd: MONTH(2), subtotalCents: 4463, taxCents: 937, totalCents: 5400 });
    clock = MONTH(2) + 1000;
    expect((await billPeriod(sid))[0]).toMatchObject({ kind: "renewal", periodStart: MONTH(2), totalCents: 5400 });
    const all = await store.shadowInvoices(sid);
    expect(all.map((i) => i.kind)).toEqual(["renewal", "renewal", "renewal"]);
    expect((await store.events(sid)).filter((e) => e.kind === "renewed")).toHaveLength(2);
    expect(await licenceEvents(sid)).toEqual([]);
  });

  it("plan de cobro (Stripe): una sola partida de 4463 céntimos al mes al 21 %, sin plan ni plataforma", async () => {
    const out = await contract(1, input([INFRA()]));
    const plan = await billing.plan(out.subscription.id);
    expect(plan).toMatchObject({ subscriptionId: out.subscription.id, termsId: out.terms.id, currency: "EUR", recurringNetCents: 4463, oneOffs: [] });
    expect(plan.items).toEqual([{ key: expect.stringMatching(/^custom:/), name: "Costes de infraestructura", product: { kind: "custom" }, amountCents: 4463, interval: "month", taxRateBp: 2100 }]);
    // 4463 + 21 % = 5400 exactos
    expect(plan.items[0].amountCents + Math.round((plan.items[0].amountCents * plan.items[0].taxRateBp) / 10_000)).toBe(5400);
    // Con el interruptor apagado no se llama a nada
    expect(await billing.sync(out.subscription.id, A)).toMatchObject({ status: "disabled" });
  });

  it("documento del contrato: importes exactos y ni una mención a planes, licencias concedidas o plataformas contratadas", async () => {
    const draft = await terms.createPackage(1, input([INFRA()], { requiresAcceptance: true }), A);
    const view = presentTerms(draft);
    expect(view.recurring).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
    const text = renderTermsDocument({ view, reference: "CT-1", version: 1, issuer: { legalName: "Big Elephant, S.L.", taxId: "B00000000", address: "Calle 1" }, client: { name: "Empresa 1", legalName: null, taxId: null }, subscriptionReference: null, startsOnAcceptance: true });
    expect(text).toMatch(/Costes de infraestructura: 44,63\s€ al mes/);
    expect(text).toMatch(/Impuesto 21 % sobre 44,63\s€: 9,37\s€/);
    expect(text).toMatch(/Total con impuestos: 54,00\s€ al mes/);
    expect(text).toContain("Estas condiciones son exclusivamente económicas: no incluyen licencias de uso ni el alta de ninguna plataforma de Big Elephant.");
    expect(text).not.toMatch(/\bplan\b|Essential|Elephant Core|funcionalidades/i);
    // Con un producto del catálogo, el texto de siempre
    const withPlan = presentTerms(await terms.createPackage(2, input([cat("essential"), INFRA()]), A));
    expect(renderTermsDocument({ view: withPlan, reference: "CT-2", version: 1, issuer: { legalName: "Big Elephant, S.L.", taxId: "B00000000", address: "Calle 1" }, client: { name: "Empresa 2", legalName: null, taxId: null }, subscriptionReference: null, startsOnAcceptance: true })).toContain("Las funcionalidades y licencias del cliente son las de los productos incluidos, con independencia del precio pactado.");
  });

  it("«Mi plan» de la plataforma: una suscripción solo económica no se muestra ni estorba a la que sí es su plan", async () => {
    const reader = tenantTermsReader(terms, termsStore, store, () => clock);
    // Empresa 1: plataforma «acme» con su suscripción de Essential a precio pactado…
    const saas = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const d = await terms.createForSubscription(saas.id, input([cat("essential", { negotiatedUnitCents: 1900 })]), A);
    await terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: saas.version }, A);
    const before = await reader("acme", 1);
    expect(before?.today.netCents).toBe(1900);
    // …y, además, el acuerdo de infraestructura: «Mi plan» sigue mostrando solo el suyo
    await contract(1, input([INFRA()]));
    expect(await reader("acme", 1)).toEqual(before);
    // Empresa 2: solo el acuerdo económico. Su plataforma (si la tuviera) no enseña ningún «plan»
    await contract(2, input([INFRA()]));
    expect(await reader("otra", 2)).toBeNull();
  });
});

describe("primer periodo: anclado en el inicio efectivo de las cuotas del paquete", () => {
  const D = T0 + 10 * DAY;

  it("una única cuota que empieza el día D: la suscripción nace con su periodo en D y factura meses completos desde D", async () => {
    const draft = await terms.createPackage(1, input([INFRA({ startsAt: D })]), A);
    const p = await terms.preview(draft.id);
    expect(p.effectiveFrom).toBe(D);
    expect(p.summary.recurring).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.nextCharge).toEqual({ at: D, netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.prorationNetCents).toBe(0);
    const out = await terms.prepareContracting(draft.id, { expectedRevision: draft.revision }, A);
    const end = Date.UTC(2026, 11, 11, 10);
    expect(out.subscription).toMatchObject({ currentPeriodStart: D, currentPeriodEnd: end, startedAt: D, anchorDay: 11, status: "active" });
    expect(out.terms).toMatchObject({ status: "scheduled", effectiveFrom: D });
    expect((await store.items(out.subscription.id)).map((i) => [i.effectiveFrom, i.effectiveTo, i.lineAmountCents])).toEqual([[D, null, 4463]]);
    // Llegado el día: una sola factura, de un mes completo; ninguna parte proporcional
    clock = D + 1000;
    const first = await billPeriod(out.subscription.id);
    expect(first.map((i) => [i.kind, i.periodStart, i.periodEnd, i.subtotalCents, i.taxCents, i.totalCents])).toEqual([["renewal", D, end, 4463, 937, 5400]]);
    expect(first[0].lines[0].fraction).toBe(1);
    clock = end + 1000;
    expect((await billPeriod(out.subscription.id)).map((i) => [i.kind, i.periodStart, i.totalCents])).toEqual([["renewal", end, 5400]]);
    expect((await store.shadowInvoices(out.subscription.id)).some((i) => i.kind === "proration")).toBe(false);
    expect((await terms.currentTerms(out.subscription.id))?.id).toBe(out.terms.id);
  });

  it("si la fecha de inicio ya pasó al contratar (p. ej. el cliente acepta después), el periodo empieza al contratar", async () => {
    const draft = await terms.createPackage(1, input([INFRA({ startsAt: D })]), A);
    clock = D + 3 * DAY;
    const out = await terms.prepareContracting(draft.id, { expectedRevision: draft.revision }, A);
    expect(out.subscription).toMatchObject({ currentPeriodStart: clock });
    expect(out.terms).toMatchObject({ status: "active", effectiveFrom: clock });
    expect((await billPeriod(out.subscription.id)).map((i) => [i.kind, i.periodStart, i.totalCents])).toEqual([["renewal", clock, 5400]]);
  });

  it("si alguna cuota empieza ya, nada cambia: la suscripción nace ahora y la cuota posterior entra en su fecha", async () => {
    const out = await contract(1, input([cat("essential"), INFRA({ startsAt: D })]));
    expect(out.subscription).toMatchObject({ currentPeriodStart: T0, currentPeriodEnd: MONTH(1) });
    expect(out.terms).toMatchObject({ status: "active", effectiveFrom: T0 });
    expect((await liveItems(out.subscription.id)).map((i) => i.productKey)).toEqual(["essential"]);
    expect((await liveItems(out.subscription.id, D)).map((i) => i.productKey).sort()[0]).toMatch(/^custom:/);
  });

  it("un paquete sin plan no tiene periodo de prueba", async () => {
    const draft = await terms.createPackage(1, input([INFRA()]), A);
    expect(await fails(terms.prepareContracting(draft.id, { expectedRevision: draft.revision, trialDays: 14 }, A))).toMatchObject({ code: "invalid_input", message: expect.stringMatching(/periodo de prueba/) });
    expect(await store.list({ companyId: 1 })).toEqual([]);
  });
});

describe("el plan Core sigue siendo obligatorio cuando el catálogo lo exige", () => {
  it("la regla sale de los datos del catálogo: soluciones Net, Connect y ampliaciones dependen de Core; un servicio, no", async () => {
    const offer = await catalog.offer();
    const by = (family: string) => offer.filter((p) => p.catalogFamily === family);
    for (const family of ["net_module", "net_bundle", "connect", "connect_bundle", "addon"]) {
      expect(by(family).length).toBeGreaterThan(0);
      for (const p of by(family)) expect([p.key, needsCorePlan(p)]).toEqual([p.key, true]);
    }
    for (const p of offer.filter((x) => x.family === "core_plan")) expect(needsCorePlan(p)).toBe(false);
    expect(needsCorePlan((await catalog.product("service-hosting-basic"))!)).toBe(false);
    // Compatibilidad declarada y ampliación de cupo: datos del catálogo, no una lista
    expect((await catalog.product("connect-people"))!.compatibleWith).toEqual(["essential", "business", "enterprise"]);
    expect((await catalog.product("addon-user-essential"))!.addonFor).toBeTruthy();
    // Producto ya retirado del catálogo: decide la instantánea de la partida
    expect(needsCorePlan(null, { family: "industry_module", activationKind: "feature" })).toBe(true);
    expect(needsCorePlan(null, { family: "service", activationKind: "none" })).toBe(false);
  });

  it("un producto que depende de Core sin plan se rechaza; con plan, se admite", async () => {
    for (const key of ["hotel-net-complete", "connect-voice", "connect-people", "addon-user-essential"]) {
      const e = await fails(terms.createPackage(1, input([cat(key), INFRA()]), A));
      expect(e).toMatchObject({ code: "invalid_state", details: { reason: "core_plan_required" } });
      expect(e.message).toMatch(/necesita un plan Core/);
    }
    const ok = await terms.createPackage(1, input([cat("essential"), cat("hotel-net-complete"), cat("connect-voice"), INFRA()]), A);
    const out = await terms.prepareContracting(ok.id, { expectedRevision: ok.revision }, A);
    expect((await liveItems(out.subscription.id)).map((i) => i.productKey).filter((k) => !k.includes(":")).sort()).toEqual(["connect-voice", "essential", "hotel-net-complete"]);
  });

  it("como mucho un plan Core, y al menos una cuota recurrente", async () => {
    expect((await fails(terms.createPackage(1, input([cat("essential"), cat("business")]), A))).message).toMatch(/Solo puede haber un plan Core/);
    expect((await fails(terms.createPackage(1, input([custom("Implantación", 50_000, { chargeClass: "initial" })]), A))).message).toMatch(/al menos una cuota recurrente/);
  });

  it("un servicio que el catálogo no ata a Core puede ir sin plan", async () => {
    const out = await contract(1, input([cat("service-hosting-basic"), INFRA()]));
    expect((await liveItems(out.subscription.id)).map((i) => i.family)).not.toContain("core_plan");
    expect(out.subscription.tenantId).toBeNull();
  });

  it("las operaciones ordinarias de una suscripción siguen exigiendo su plan", async () => {
    await expect(subs.checkComposition([])).rejects.toThrow(/necesita exactamente un plan Core/);
    await expect(subs.checkComposition([{ productKey: "hotel-net-complete", family: "industry_module" }])).rejects.toThrow(/necesita exactamente un plan Core/);
  });
});

describe("acuerdos posteriores", () => {
  it("quitar el plan de una suscripción con productos que dependen de él se rechaza; sin ellos, se admite y retira lo suyo", async () => {
    tenants.set(1, "acme");
    const sub = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const first = await terms.createForSubscription(sub.id, input([cat("essential"), cat("hotel-net-complete"), INFRA()]), A);
    await terms.activate(first.id, { expectedRevision: first.revision, expectedVersion: sub.version }, A);
    const own = async () => (await caps.list("acme")).filter((g) => g.source === `subscription:${sub.id}` && g.status === "active").length;
    expect(await own()).toBeGreaterThan(0);
    expect(Object.fromEntries((await limits.limits("acme")).map((l) => [l.metric, l.limit]))).toMatchObject({ users: 3 });
    // Sin el plan, Hotel Net no puede quedarse
    const e = await fails(terms.createForSubscription(sub.id, input([cat("hotel-net-complete"), INFRA()]), A));
    expect(e).toMatchObject({ code: "invalid_state", details: { reason: "core_plan_required" } });
    expect(e.message).toMatch(/«Hotel Net[^»]*» necesita un plan Core/);
    // Solo la partida a medida: se admite. Las licencias que eran de ESTA suscripción se retiran (ya tenía plataforma)
    const only = await terms.createForSubscription(sub.id, input([INFRA()]), A);
    const out = await terms.activate(only.id, { expectedRevision: only.revision, expectedVersion: (await subs.must(sub.id)).version }, A);
    expect((await liveItems(sub.id)).map((i) => [i.family, i.lineAmountCents])).toEqual([["service", 4463]]);
    expect(out.subscription.tenantId).toBe("acme");
    expect(await own()).toBe(0);
  });

  it("una suscripción sin plan admite acuerdos posteriores (cambio de importe a mitad de periodo y vuelta a añadir productos)", async () => {
    const out = await contract(1, input([INFRA()]));
    const sid = out.subscription.id;
    const base = await terms.base(sid);
    expect(base.input.lines).toEqual([expect.objectContaining({ kind: "custom", name: "Costes de infraestructura", unitCents: 4463, taxRateBp: 2100 })]);
    // En la próxima renovación sube a 50,00 €
    const next = await terms.createForSubscription(sid, input([{ ...(base.input.lines[0] as Extract<LineInput, { kind: "custom" }>), unitCents: 5000 }], { effectiveFrom: MONTH(1) }), A);
    const p = await terms.preview(next.id);
    expect(p.before).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.summary.recurring).toMatchObject({ netCents: 5000, taxCents: 1050, totalCents: 6050 });
    expect(p.licences.grantsNothing).toBe(true);
    await terms.activate(next.id, { expectedRevision: next.revision, expectedVersion: (await subs.must(sid)).version }, A);
    clock = MONTH(1) + 1000;
    expect((await billPeriod(sid)).map((i) => [i.kind, i.subtotalCents, i.totalCents])).toEqual([["renewal", 5000, 6050]]);
    expect(await licenceEvents(sid)).toEqual([]);
    // Y un producto ligado a Core sigue necesitando el plan también aquí
    expect((await fails(terms.createForSubscription(sid, input([cat("connect-voice"), INFRA()]), A))).message).toMatch(/necesita un plan Core/);
    const withPlan = await terms.createForSubscription(sid, input([cat("essential"), cat("connect-voice"), INFRA()]), A);
    expect(withPlan.status).toBe("draft");
  });
});

describe("cambios de estado sin plan ni plataforma (los mismos puntos de entrada que usa el circuito de cobro)", () => {
  it("baja programada → cancelada al fin del periodo → reactivada: sin errores y sin tocar licencias, límites ni plataformas", async () => {
    const out = await contract(1, input([INFRA()]));
    const sid = out.subscription.id;
    await subs.scheduleCancel(sid, { reason: "Impago: baja al fin del periodo" }, (await subs.must(sid)).version, "system:billing");
    expect(subscriptionEffective((await subs.must(sid))!, clock)).toMatchObject({ status: "active", nextRenewalAt: null });
    // Deshacer la baja (el cliente paga)
    await subs.reactivate(sid, { reason: "Pago recibido" }, (await subs.must(sid)).version, "system:billing");
    expect((await subs.must(sid)).cancelAt).toBeNull();
    await subs.scheduleCancel(sid, { reason: "Baja definitiva" }, (await subs.must(sid)).version, "system:billing");
    clock = MONTH(1) + 1000;
    const canceled = await subs.applyRenewals(sid, "system:billing");
    expect(canceled).toMatchObject({ status: "canceled", canceledAt: MONTH(1), tenantId: null });
    expect(await liveItems(sid)).toEqual([]);
    expect((await shadow.simulateCurrent(sid, "system:billing")).results).toEqual([]);
    expect(await licences.ensure(sid, "system:billing", { force: true })).toMatchObject({ status: "not_applicable" });
    await licences.afterChange(sid);
    await licences.retryIfPending(sid);
    expect((await billing.plan(sid)).items).toEqual([]);
    // Reactivación: vuelve la misma cuota, con un periodo nuevo completo
    await subs.reactivate(sid, { reason: "Vuelve a contratar" }, canceled.version, "system:billing");
    const back = await subs.must(sid);
    expect(back).toMatchObject({ status: "active", currentPeriodStart: clock, tenantId: null });
    expect((await liveItems(sid)).map((i) => [i.family, i.lineAmountCents, i.taxRateBp])).toEqual([["service", 4463, 2100]]);
    expect((await billPeriod(sid)).map((i) => [i.kind, i.periodStart, i.totalCents])).toEqual([["renewal", clock, 5400]]);
    expect((await billing.plan(sid)).items.map((i) => [i.amountCents, i.interval, i.taxRateBp])).toEqual([[4463, "month", 2100]]);
    // Nada de licencias, límites ni plataformas en todo el recorrido
    expect(await licenceEvents(sid)).toEqual([]);
    expect((await store.events(sid)).map((e) => e.kind)).not.toContain("tenant_linked");
    expect(await licensing.limitsFor(sid)).toEqual([]);
  });
});
