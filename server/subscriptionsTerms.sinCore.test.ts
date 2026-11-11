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
import { OrganizationService } from "./organization/service";
import { MemoryOrganizationStore } from "./organization/service";
import { catalogFromWebStore, type CatalogPort, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService, isEconomicOnly, licencePlan, needsCorePlan, subscriptionEffective } from "./subscriptions/service";
import { addMonthsUTC, madridAnchor } from "./subscriptions/pricing";
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
let quoteSite: () => Promise<ReturnType<typeof quoteCatalogFromSite>>;

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
  quoteSite = async () => quoteCatalogFromSite(await web.site("published"));
  licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: quoteSite, now: () => clock, limits });
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
    expect(p.licences.note).toMatch(/No concede licencias/);
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
    expect(isEconomicOnly(await store.items(sid), clock)).toBe(true);
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
  // Lo habitual: el operador elige «1 de diciembre a las 00:00» en hora de Madrid (30/11 23:00 UTC)
  const DEC1 = Date.UTC(2026, 10, 30, 23);
  const JAN1 = Date.UTC(2026, 11, 31, 23);
  const FEB1 = Date.UTC(2027, 0, 31, 23);
  const DOC = { reference: "CT-1", version: 1, issuer: { legalName: "Big Elephant, S.L.", taxId: "B00000000", address: "Calle 1" }, client: { name: "Empresa 1", legalName: null, taxId: null }, subscriptionReference: null, startsOnAcceptance: true };

  it("meses de calendario de Madrid: del día 1 a las 00:00 al día 1 a las 00:00, con el cambio de hora y los fines de mes", () => {
    const madrid = (ts: number) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts));
    expect(madridAnchor(DEC1)).toBe(-1);
    const starts = [DEC1];
    for (let n = 0; n < 6; n++) starts.push(addMonthsUTC(starts[n], 1, -1));
    expect(starts.map(madrid)).toEqual(["01/12/2026, 00:00", "01/01/2027, 00:00", "01/02/2027, 00:00", "01/03/2027, 00:00", "01/04/2027, 00:00", "01/05/2027, 00:00", "01/06/2027, 00:00"]);
    // Abril ya es horario de verano: el instante UTC cambia de 23:00 a 22:00, la hora de Madrid no
    expect([new Date(starts[3]).getUTCHours(), new Date(starts[4]).getUTCHours()]).toEqual([23, 22]);
    // Día 31: febrero y abril se quedan en su último día y marzo vuelve al 31 (sin deriva)
    const J31 = Date.UTC(2027, 0, 30, 23);
    const ends = [J31];
    for (let n = 0; n < 4; n++) ends.push(addMonthsUTC(ends[n], 1, madridAnchor(J31)));
    expect(ends.map(madrid)).toEqual(["31/01/2027, 00:00", "28/02/2027, 00:00", "31/03/2027, 00:00", "30/04/2027, 00:00", "31/05/2027, 00:00"]);
    // Un año entero y hacia atrás
    expect(madrid(addMonthsUTC(DEC1, 12, -1))).toBe("01/12/2027, 00:00");
    expect(addMonthsUTC(JAN1, -1, -1)).toBe(DEC1);
    // El cálculo de siempre (día de anclaje positivo, UTC) no cambia
    expect(addMonthsUTC(Date.UTC(2026, 0, 31, 10), 1, 31)).toBe(Date.UTC(2026, 1, 28, 10));
    expect(addMonthsUTC(DEC1, 1)).toBe(Date.UTC(2026, 11, 30, 23));
  });

  it("paquete solo económico con una única cuota desde el 1 de diciembre (Madrid): nada se factura antes, y después meses completos de calendario", async () => {
    const draft = await terms.createPackage(1, input([INFRA({ startsAt: DEC1 })]), A);
    const p = await terms.preview(draft.id);
    // La vista previa enseña la cuota real y su fecha, no «0,00»
    expect(p.effectiveFrom).toBe(DEC1);
    expect(p.summary.recurring).toMatchObject({ netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.nextCharge).toEqual({ at: DEC1, netCents: 4463, taxCents: 937, totalCents: 5400 });
    expect(p.serviceStart).toEqual({ at: DEC1, onContracting: { netCents: 0, taxCents: 0, totalCents: 0 } });
    expect(p.prorationNetCents).toBe(0);
    const out = await terms.prepareContracting(draft.id, { expectedRevision: draft.revision }, A);
    const sid = out.subscription.id;
    // Contratada hoy; el servicio empieza el día 1: hasta entonces, un periodo previo sin cuotas
    expect(out.subscription).toMatchObject({ status: "active", tenantId: null, currentPeriodStart: T0, currentPeriodEnd: DEC1, startedAt: DEC1, anchorDay: -1 });
    expect(subscriptionEffective(out.subscription, clock)).toMatchObject({ status: "active", startsAt: DEC1, nextRenewalAt: DEC1 });
    expect(out.terms).toMatchObject({ status: "active", effectiveFrom: T0 });
    expect((await store.items(sid)).map((i) => [i.effectiveFrom, i.effectiveTo, i.lineAmountCents])).toEqual([[DEC1, null, 4463]]);
    // Antes del día 1: ninguna factura registrada y nada que cobrar
    clock = DEC1 - DAY;
    expect((await shadow.simulateCurrent(sid, A)).results).toEqual([]);
    expect(await store.shadowInvoices(sid)).toEqual([]);
    expect((await billing.plan(sid)).items).toEqual([]);
    expect(await terms.currentTerms(sid)).toBeNull();
    // Llegado el día: una sola factura, de un mes completo de calendario; ninguna parte proporcional
    clock = DEC1 + 1000;
    const first = await billPeriod(sid);
    expect(first.map((i) => [i.kind, i.periodStart, i.periodEnd, i.subtotalCents, i.taxCents, i.totalCents])).toEqual([["renewal", DEC1, JAN1, 4463, 937, 5400]]);
    expect(first[0].lines[0].fraction).toBe(1);
    expect(subscriptionEffective(await subs.must(sid), clock).startsAt).toBeNull();
    expect((await billing.plan(sid)).items.map((i) => [i.amountCents, i.interval, i.taxRateBp])).toEqual([[4463, "month", 2100]]);
    clock = JAN1 + 1000;
    expect((await billPeriod(sid)).map((i) => [i.kind, i.periodStart, i.periodEnd, i.totalCents])).toEqual([["renewal", JAN1, FEB1, 5400]]);
    expect((await store.shadowInvoices(sid)).map((i) => i.kind)).toEqual(["renewal", "renewal"]);
    expect((await terms.currentTerms(sid))?.id).toBe(out.terms.id);
    expect(await licenceEvents(sid)).toEqual([]);
  });

  it("documento: la cuota real y «Entrada en vigor» en la fecha elegida, nunca «0,00 € al mes»", async () => {
    const draft = await terms.createPackage(1, input([INFRA({ startsAt: DEC1 })], { requiresAcceptance: true }), A);
    const view = presentTerms(draft);
    expect(view).toMatchObject({ serviceStartAt: DEC1, recurring: { netCents: 4463, taxCents: 937, totalCents: 5400 }, scheduledChanges: [] });
    const text = renderTermsDocument({ ...DOC, view });
    expect(text).toMatch(/Costes de infraestructura: 44,63\s€ al mes/);
    expect(text).toMatch(/Total con impuestos: 54,00\s€ al mes/);
    expect(text).toContain("Entrada en vigor: 1 de diciembre de 2026, 00:00 (hora peninsular) o, si la aceptación es posterior, en el momento de la aceptación.");
    expect(text).toContain("Las cuotas rigen desde el 1 de diciembre de 2026, 00:00 (hora peninsular) o, si la aceptación es posterior, desde la aceptación. La primera cuota corresponde a un periodo completo desde ese inicio: no se factura ninguna parte proporcional anterior.");
    expect(text).not.toMatch(/0,00\s€/);
    // Determinista: no depende de cuándo se genere (misma huella al enviar y al aceptar)
    clock = DEC1 + 5 * DAY;
    expect(renderTermsDocument({ ...DOC, view: presentTerms(await terms.must(draft.id)) })).toBe(text);
    // Un acuerdo sin fecha de inicio propia conserva el texto de siempre
    const plain = renderTermsDocument({ ...DOC, view: presentTerms(await terms.createPackage(2, input([INFRA()]), A)) });
    expect(plain).toContain("Entrada en vigor: en el momento de la aceptación de estas condiciones.");
    expect(plain).not.toContain("Las cuotas rigen desde");
  });

  it("un cargo único sin fecha se debe al contratar (no el día de inicio): vista previa, documento y facturación coinciden", async () => {
    const lines = [INFRA({ startsAt: DEC1 }), custom("Alta del servicio", 10_000, { chargeClass: "initial" })];
    const draft = await terms.createPackage(1, input(lines, { requiresAcceptance: false }), A);
    const p = await terms.preview(draft.id);
    expect(p.serviceStart).toEqual({ at: DEC1, onContracting: { netCents: 10_000, taxCents: 2100, totalCents: 12_100 } });
    expect(p.summary.charges.map((c) => [c.name, c.at, c.totalCents])).toEqual([["Alta del servicio", T0, 12_100]]);
    expect(p.nextCharge).toEqual({ at: DEC1, netCents: 4463, taxCents: 937, totalCents: 5400 });
    const text = renderTermsDocument({ ...DOC, view: presentTerms(draft) });
    expect(text).toMatch(/- Alta del servicio: 100,00\s€ más impuestos \(21 %: 21,00\s€\); total 121,00\s€\. Se factura una sola vez, en el momento de la aceptación de estas condiciones\./);
    expect(text).toMatch(/Total con impuestos: 54,00\s€ al mes/);
    expect(text).not.toContain("Primera contratación");
    const out = await terms.prepareContracting(draft.id, { expectedRevision: draft.revision }, A);
    const sid = out.subscription.id;
    // Al contratar: solo el cargo único
    expect((await shadow.simulateCurrent(sid, A)).results.map((r) => [r.invoice.kind, r.invoice.periodStart, r.invoice.periodEnd, r.invoice.totalCents])).toEqual([["one_time", T0, DEC1, 12_100]]);
    // El día 1: solo la cuota, completa
    clock = DEC1 + 1000;
    expect((await billPeriod(sid)).map((i) => [i.kind, i.periodStart, i.totalCents])).toEqual([["renewal", DEC1, 5400]]);
    expect((await store.shadowInvoices(sid)).map((i) => i.kind).sort()).toEqual(["one_time", "renewal"]);
  });

  it("con fecha de inicio propia, un ajuste de un solo uso sobre las cuotas se rechaza al guardar (no tendría primer periodo)", async () => {
    const e = await fails(terms.createPackage(1, input([INFRA({ startsAt: DEC1 })], { adjustments: [{ line: null, type: "discount", mode: "amount", value: 500, recurrence: "once" }] }), A));
    expect(e).toMatchObject({ code: "invalid_input", message: expect.stringMatching(/ajuste de un solo uso/) });
  });

  it("antes de empezar, un acuerdo posterior no puede regir antes de la fecha de inicio", async () => {
    const out = await contract(1, input([INFRA({ startsAt: DEC1 })]));
    const sid = out.subscription.id;
    const early = await terms.createForSubscription(sid, input([INFRA()]), A);
    expect(await fails(terms.activate(early.id, { expectedRevision: early.revision, expectedVersion: (await subs.must(sid)).version }, A))).toMatchObject({ code: "invalid_state", details: { reason: "not_started" } });
    await expect(terms.preflight(early.id)).rejects.toMatchObject({ details: { reason: "not_started" } });
    const onTime = await terms.createForSubscription(sid, input([custom("Costes de infraestructura", 5000)], { effectiveFrom: DEC1 }), A);
    await terms.activate(onTime.id, { expectedRevision: onTime.revision, expectedVersion: (await subs.must(sid)).version }, A);
    clock = DEC1 + 1000;
    expect((await billPeriod(sid)).map((i) => [i.kind, i.periodStart, i.subtotalCents, i.totalCents])).toEqual([["renewal", DEC1, 5000, 6050]]);
  });

  it("un paquete CON plan no se ancla a futuro: su plan rige desde la contratación, como siempre", async () => {
    // Plan (y todo lo demás) con fecha futura: se rechaza antes de crear nada, como antes de admitir acuerdos sin plan
    const future = await terms.createPackage(1, input([cat("essential", { startsAt: D }), INFRA({ startsAt: D })]), A);
    for (const attempt of [terms.preflight(future.id), terms.prepareContracting(future.id, { expectedRevision: future.revision }, A)]) {
      expect(await fails(attempt)).toMatchObject({ code: "invalid_state", details: { reason: "core_plan_required" }, message: expect.stringMatching(/plan Core desde la entrada en vigor/) });
    }
    expect(await store.list({ companyId: 1 })).toEqual([]);
    expect((await terms.preview(future.id)).serviceStart).toBeNull();
    // También sobre una suscripción existente
    const sub = await subs.create({ companyId: 2, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const later = await terms.createForSubscription(sub.id, input([INFRA(), cat("essential", { startsAt: D })]), A);
    expect(await fails(terms.activate(later.id, { expectedRevision: later.revision, expectedVersion: sub.version }, A))).toMatchObject({ details: { reason: "core_plan_required" } });
    expect((await liveItems(sub.id)).map((i) => i.productKey)).toEqual(["essential"]);
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
    // TODA la siembra, también lo que está en hoja de ruta (activación «none»): solo un servicio puro va sin plan
    const all = (await Promise.all((await webStore.listEntries({ kind: "product" })).map((e) => catalog.product(e.key)))).filter((x): x is NonNullable<typeof x> => !!x);
    expect(all.length).toBeGreaterThan(offer.length);
    const dormant = all.filter((x) => x.activationKind === "none" && x.catalogFamily !== "service" && x.family !== "core_plan");
    expect(dormant.length).toBeGreaterThan(10);
    expect(dormant.some((x) => (x.capabilities ?? []).length > 0)).toBe(true);
    for (const x of all) expect([x.key, needsCorePlan(x)]).toEqual([x.key, x.family !== "core_plan" && !(x.catalogFamily === "service" && (x.capabilities ?? []).length === 0 && x.compatibleWith.length === 0 && !x.addonFor && ["none", "service"].includes(x.activationKind))]);
    for (const x of all.filter((y) => y.catalogFamily !== "service" && y.family !== "core_plan")) expect([x.key, needsCorePlan(x)]).toEqual([x.key, true]);
    // Un «servicio» que concediera capacidades o declarase planes también lo necesitaría
    const hosting = (await catalog.product("service-hosting-basic"))!;
    expect(needsCorePlan({ ...hosting, capabilities: ["cms"] })).toBe(true);
    expect(needsCorePlan({ ...hosting, compatibleWith: ["essential"] })).toBe(true);
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

  it("un servicio que el catálogo no ata a Core puede ir sin plan, y la suscripción es igual de «solo económica»", async () => {
    const HOSTING = () => input([cat("service-hosting-basic"), INFRA()]);
    const p = await terms.preview((await terms.createPackage(3, HOSTING(), A)).id);
    expect(p.licences).toMatchObject({ grantsNothing: true, planProductAfter: null });
    // Empresa sin plataforma: ni «pendiente de plataforma» ni invitación a darla de alta
    const out = await contract(1, HOSTING());
    const sid = out.subscription.id;
    expect((await liveItems(sid)).map((i) => [i.productKey.replace(/^custom:.*/, "custom"), i.family, i.activationKind]).sort()).toEqual([["custom", "service", "none"], ["service-hosting-basic", "extension", "service"]]);
    expect(isEconomicOnly(await store.items(sid), clock)).toBe(true);
    expect(await licenceEvents(sid)).toEqual([]);
    expect(await licences.ensure(sid, A, { force: true })).toMatchObject({ status: "not_applicable" });
    expect(await licences.status(sid)).toMatchObject({ applicable: false, tenantId: null, linked: false, last: null });
    // Empresa con plataforma y su suscripción de Essential a precio pactado: nada de ella cambia
    tenants.set(2, "acme");
    const saas = await subs.create({ companyId: 2, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const d = await terms.createForSubscription(saas.id, input([cat("essential", { negotiatedUnitCents: 3100 })]), A);
    await terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: saas.version }, A);
    const reader = tenantTermsReader(terms, termsStore, store, () => clock);
    const before = { plan: await reader("acme", 2), caps: JSON.stringify(await caps.list("acme")), limits: JSON.stringify(await limits.limits("acme")) };
    expect(before.plan?.today.netCents).toBe(3100);
    const eco = await contract(2, HOSTING());
    expect((await store.get(eco.subscription.id))!.tenantId).toBeNull();
    expect(await licences.companyOnboarded(2)).toEqual([expect.objectContaining({ status: "applied", tenantId: "acme", changed: 0 })]);
    expect((await store.get(eco.subscription.id))!.tenantId).toBeNull();
    expect(await licenceEvents(eco.subscription.id)).toEqual([]);
    expect({ plan: await reader("acme", 2), caps: JSON.stringify(await caps.list("acme")), limits: JSON.stringify(await limits.limits("acme")) }).toEqual(before);
    // …y la suscripción del plan sigue fijando sus límites: la económica no cuenta como «otra suscripción viva»
    expect((await licences.status(saas.id)).plan?.limits).toMatchObject({ pending: [], skipped: [] });
    expect((await subs.liveSaas(2)).map((x) => x.id)).toEqual([saas.id]);
    expect(await subs.liveSaas(1)).toEqual([]);
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

describe("vigencias: el plan tiene que cubrir la de todo producto que dependa de él", () => {
  const D1 = T0 + 5 * DAY;
  const D2 = T0 + 12 * DAY;

  it("[partida a medida ahora, Hotel Net desde D1, Essential desde D2 > D1] se rechaza al guardar, en paquete y sobre una suscripción", async () => {
    const lines = () => [INFRA(), cat("hotel-net-complete", { startsAt: D1 }), cat("essential", { startsAt: D2 })];
    const pkg = await fails(terms.createPackage(1, input(lines()), A));
    expect(pkg).toMatchObject({ code: "invalid_state", details: { reason: "core_plan_required", at: D1 } });
    expect(pkg.message).toMatch(/^Desde el 6 de noviembre de 2026, 11:00 \(hora peninsular\): «Hotel Net[^»]*» necesita un plan Core/);
    expect(pkg.message).toMatch(/La vigencia del plan Core .* debe cubrir la de los productos que dependen de él/);
    const sub = await subs.create({ companyId: 2, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    expect(await fails(terms.createForSubscription(sub.id, input(lines()), A))).toMatchObject({ code: "invalid_state", details: { at: D1 } });
    expect((await liveItems(sub.id)).map((i) => i.productKey)).toEqual(["essential"]);
  });

  it("plan con fecha de fin y producto dependiente sin fin: se rechaza; si el producto termina con el plan (o antes), vale", async () => {
    const bad = await fails(terms.createPackage(1, input([cat("essential", { endsAt: D2 }), cat("hotel-net-complete"), INFRA()]), A));
    expect(bad).toMatchObject({ code: "invalid_state", details: { reason: "core_plan_required", at: D2 } });
    expect(bad.message).toMatch(/^Desde el 13 de noviembre de 2026/);
    const ok = await terms.createPackage(1, input([cat("essential", { endsAt: D2 }), cat("hotel-net-complete", { startsAt: D1, endsAt: D2 }), INFRA()]), A);
    await terms.preflight(ok.id);
    // Un producto que empieza después y termina antes que el plan, también
    const inner = await terms.createPackage(2, input([cat("essential"), cat("connect-voice", { startsAt: D1, endsAt: D2 })]), A);
    const out = await terms.prepareContracting(inner.id, { expectedRevision: inner.revision }, A);
    expect((await liveItems(out.subscription.id, D1 + 1)).map((i) => i.productKey).sort()).toEqual(["connect-voice", "essential"]);
  });

  it("la misma comprobación al activar con la fecha efectiva real y en la condición siguiente", async () => {
    const sub = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    // Guardado válido (el plan cubre a Voice)…
    const d = await terms.createForSubscription(sub.id, input([cat("essential"), cat("connect-voice", { startsAt: D1 })]), A);
    await terms.preflight(d.id);
    const out = await terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: sub.version }, A);
    expect(out.terms.status).toBe("active");
  });
});

describe("casos menores", () => {
  it("un acuerdo sin plan sobre una suscripción EN PRUEBA se rechaza: le quitaría el plan de la prueba", async () => {
    const trial = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", trialDays: 15, plan: { productKey: "essential", priceId: P.essential } }, A);
    const e = await fails(terms.createForSubscription(trial.id, input([INFRA()]), A));
    expect(e).toMatchObject({ code: "invalid_state", details: { reason: "trial_needs_plan" }, message: expect.stringMatching(/prueba gratuita/) });
    // Con el plan, como siempre
    const ok = await terms.createForSubscription(trial.id, input([cat("essential"), INFRA()]), A);
    expect(ok.status).toBe("draft");
    // Un borrador guardado cuando no estaba en prueba tampoco se activa si ahora lo está
    const active = await subs.create({ companyId: 2, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const draft = await terms.createForSubscription(active.id, input([INFRA()]), A);
    await store.mutate(active.id, null, "t", clock, async () => ({ patch: { status: "trialing" as const, trialEnd: clock + 10 * DAY }, event: { kind: "trial_end_changed" as const, before: null, after: null, reason: null }, result: null }));
    await expect(terms.preflight(draft.id)).rejects.toMatchObject({ details: { reason: "trial_needs_plan" } });
    expect(await fails(terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(active.id)).version }, A))).toMatchObject({ details: { reason: "trial_needs_plan" } });
    expect((await liveItems(active.id)).map((i) => i.productKey)).toEqual(["essential"]);
  });

  it("reactivar no deja cuotas programadas por el camino: si la cancelación las dejó sin efecto, se rechaza", async () => {
    const LATER = T0 + 40 * DAY;
    const out = await contract(1, input([INFRA(), custom("Soporte ampliado", 2000, { startsAt: LATER })]));
    const sid = out.subscription.id;
    await subs.scheduleCancel(sid, { reason: "Baja" }, (await subs.must(sid)).version, A);
    clock = MONTH(1) + 1000;
    const canceled = await subs.applyRenewals(sid, A);
    expect(canceled.status).toBe("canceled");
    await expect(subs.reactivate(sid, { reason: "Vuelve" }, canceled.version, A)).rejects.toThrow(/No se encuentran las condiciones vigentes al cancelar: el acuerdo tenía cuotas programadas/);
    expect((await subs.must(sid)).status).toBe("canceled");
  });
});

describe("límites de la organización (sedes, entidades, usuarios)", () => {
  it("una suscripción solo económica enlazada a la plataforma no tapa a la suscripción del plan", async () => {
    const org = new OrganizationService({ store: new MemoryOrganizationStore(), subscriptions: store, catalog: quoteSite, now: () => clock });
    tenants.set(1, "acme");
    const business = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: "business", priceId: P.business } }, A);
    const expected = await org.limits("acme");
    expect(expected.sites).toBeGreaterThan(1);
    // Una segunda suscripción de la misma plataforma, más reciente, que se queda solo con una partida a medida
    const other = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const only = await terms.createForSubscription(other.id, input([INFRA()]), A);
    await terms.activate(only.id, { expectedRevision: only.revision, expectedVersion: other.version }, A);
    expect(isEconomicOnly(await store.items(other.id), clock)).toBe(true);
    expect((await store.get(other.id))!.tenantId).toBe("acme");
    expect(await org.limits("acme")).toEqual(expected);
    expect((await subs.liveSaas(1)).map((s) => s.id)).toEqual([business.id]);
  });
});
