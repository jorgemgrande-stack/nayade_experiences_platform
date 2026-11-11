/**
 * Una suscripción SOLO ECONÓMICA (acuerdo de partidas a medida o de servicios que no dependen de Elephant Core, sin
 * plan ni plataforma) es invisible para el circuito del SaaS: la prueba gratuita, sus licencias, su conversión por
 * pedido y la contratación por pedidos se comportan exactamente igual que si no existiera, y la empresa que solo paga
 * infraestructura puede contratar después el SaaS. Servicios reales en memoria (pruebas, pedidos, suscripciones,
 * licencias, condiciones personalizadas) y catálogo de Elephant Source.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialOnboardingService, type TrialNotifier } from "./trials/onboarding";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { LicensingService } from "./licensing/service";
import { seedElephantSource } from "./catalog/seed";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService, isEconomicOnly, saasSubscriptions } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { CommercialOrchestrator } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import { CommercialTermsService, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { TermsLicences } from "./commercialTerms/licences";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 19, 13, 50, 33, 778);
const A = "operator:ana";
let clock = T0;
let trials: TrialService;
let trialStore: MemoryTrialStore;
let caps: MemoryCapabilityStore;
let limits: MemoryTenantLimitStore;
let subs: SubscriptionService;
let subStore: MemorySubscriptionStore;
let crmStore: MemoryCrmStore;
let crm: CrmService;
let licensing: LicensingService;
let onboarding: TrialOnboardingService;
let orders: CommercialOrchestrator;
let terms: CommercialTermsService;
let termsStore: MemoryTermsStore;
let licences: TermsLicences;
let P: Record<string, number>;
let n = 0;
const key = () => crypto.randomBytes(12).toString("hex");
const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };

beforeEach(async () => {
  clock = T0;
  const now = () => clock;
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now });
  await seedElephantSource(web, webStore);
  P = {};
  for (const k of ["essential", "service-hosting-basic"]) P[k] = (await webStore.listPrices((await webStore.getEntry("product", k))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const quoteSite = async () => quoteCatalogFromSite(await web.site("published"));
  crmStore = new MemoryCrmStore();
  crm = new CrmService({ store: crmStore, activation: { activate: async ({ company }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) }, now });
  const crmPort = crmFromStore(crmStore);
  const catalog = catalogFromWebStore(webStore);
  subStore = new MemorySubscriptionStore();
  caps = new MemoryCapabilityStore();
  limits = new MemoryTenantLimitStore();
  subs = new SubscriptionService({ store: subStore, catalog, crm: crmPort, now });
  licensing = new LicensingService({ capabilities: caps, subscriptions: subStore, crm: crmPort, catalog: quoteSite, now, limits });
  trialStore = new MemoryTrialStore();
  trials = new TrialService({ store: trialStore, now, subscriptions: subStore, limits: { maxExtensions: 3, perIp24h: 1000, perDomain30d: 1000 } });
  onboarding = new TrialOnboardingService({
    trials,
    provision: async (req) => ({ tenantId: req.tenantId, status: "completed", completedSteps: [], domain: `${req.tenantId}.app.example`, adminInviteToken: "inv" }),
    platformDomain: "app.example",
    companies: {
      byTenant: async (tenantId) => (await crmStore.list("companies", { tenantId }, { limit: 1 }))[0] ?? null,
      // Como en el plano de control; si la empresa ya existe en el CRM con ese nombre (p. ej. un cliente que solo
      // pagaba infraestructura), la prueba es de ESA empresa
      create: async (input, actor) => {
        const existing = (await crmStore.list("companies", {}, { limit: 100 })).find((c) => c.name === input.name);
        const c = existing ?? (await crm.createCompany({ name: input.name, email: input.email }, actor));
        return crmStore.update("companies", c.id, { tenantId: input.tenantId });
      },
    },
    subscriptions: subs,
    licensing,
    priceOf: async (k) => (await webStore.listPrices((await webStore.getEntry("product", k))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id,
    notify,
    now,
  });
  orders = new CommercialOrchestrator({
    store: new MemoryOrderStore(),
    crm,
    crmStore,
    subscriptions: subs,
    subscriptionStore: subStore,
    shadow: new ShadowBillingService({ store: subStore, crm: crmPort, now }),
    catalog,
    quote: async (r) => quote(await quoteSite(), r),
    licensing,
    capabilities: caps,
    platform: { activate: async ({ company }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) },
    trials,
    now,
  });
  termsStore = new MemoryTermsStore();
  licences = new TermsLicences({ auto: true, licensing, limits, capabilities: caps, subscriptions: subs, subscriptionStore: subStore, termsStore, companyTenant: async (id) => (await crmStore.get("companies", id))?.tenantId ?? null, now });
  terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: subStore, catalog, crm: crmPort, now, afterChange: (sid, actor) => licences.afterChange(sid, actor) });
});

const INFRA: LineInput = { kind: "custom", concept: "other", name: "Costes de infraestructura", chargeClass: "recurring", unitCents: 4463, taxRateBp: 2100 };
const pkg = (lines: LineInput[]): TermsInput => ({ pricingMode: "per_item", presentation: "breakdown", interval: "month", lines, reason: "Solo costes de infraestructura" });
/** Las dos formas de «solo económica»: solo partidas a medida, o con un servicio de catálogo que no depende de Core. */
const SHAPES: Array<[string, () => LineInput[]]> = [
  ["solo partidas a medida", () => [INFRA]],
  ["partida a medida + servicio de catálogo sin plan", () => [INFRA, { kind: "catalog", productKey: "service-hosting-basic", priceId: P["service-hosting-basic"] }]],
];
async function economic(companyId: number, lines: LineInput[]) {
  const d = await terms.createPackage(companyId, pkg(lines), A);
  return (await terms.prepareContracting(d.id, { expectedRevision: d.revision }, A)).subscription;
}
async function startTrial(company: string) {
  const r = await trials.register({ email: `info${++n}@${company.toLowerCase().replace(/[^a-z]+/g, "-")}.es`, companyName: company, configuration: { plan: "essential", addons: [] }, idempotencyKey: `idem-coexistencia-${String(n).padStart(4, "0")}` });
  await trials.verify(r.trial.id, r.verificationToken!);
  const out = await onboarding.activate(r.trial.id, "op");
  return { trial: await trials.must(r.trial.id), tenantId: out.tenantId, subscriptionId: out.subscriptionId, companyId: out.companyId };
}
const grantsOf = async (tenantId: string, subscriptionId: number) => (await caps.list(tenantId)).filter((g) => g.source === `subscription:${subscriptionId}`);
/** Foto de una suscripción: nada de ella debe cambiar por lo que le pase a otra. */
const snapshot = async (id: number) => JSON.stringify([await subStore.get(id), await subStore.items(id)]);

describe.each(SHAPES)("empresa EN PRUEBA con plataforma + suscripción económica creada después (%s)", (_name, lines) => {
  it("ampliar la prueba mueve la suscripción de la prueba y sus licencias, como si la económica no existiera", async () => {
    const { trial, tenantId, subscriptionId, companyId } = await startTrial("Skibox");
    const eco = await economic(companyId, lines());
    const before = await snapshot(eco.id);
    expect((await subStore.list({ companyId })).map((s) => s.id)).toEqual([eco.id, subscriptionId]);
    expect(isEconomicOnly(await subStore.items(eco.id), clock)).toBe(true);
    expect((await subs.liveSaas(companyId)).map((s) => s.id)).toEqual([subscriptionId]);
    clock = T0 + 14 * DAY;
    const ext = await onboarding.approveExtension(trial.id, { expectedVersion: trial.version, days: 5, actor: "operator:jorge" });
    expect(ext.endsAt).toBe(trial.endsAt! + 5 * DAY);
    expect((await subs.must(subscriptionId)).trialEnd).toBe(ext.endsAt);
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((x) => x.validUntil === ext.endsAt && x.status === "active")).toBe(true);
    expect(await onboarding.syncLicences(trial.id, "op")).toMatchObject({ outcome: "in_sync", licencesChanged: 0, subscriptionMoved: false });
    // La económica: intacta, sin plataforma y sin una sola licencia
    expect(await snapshot(eco.id)).toBe(before);
    expect(await grantsOf(tenantId, eco.id)).toEqual([]);
    expect(await licences.ensure(eco.id, A, { force: true })).toMatchObject({ status: "not_applicable" });
    expect((await termsStore.events({ subscriptionId: eco.id })).some((e) => e.kind.startsWith("licences_"))).toBe(false);
  });

  it("pausar y reactivar la prueba reaplica las licencias de la suscripción de la prueba", async () => {
    const { trial, tenantId, subscriptionId, companyId } = await startTrial("Pausa");
    const eco = await economic(companyId, lines());
    const before = await snapshot(eco.id);
    const ext = await trials.approveExtension(trial.id, trial.version, 5, "op");
    const sus = await onboarding.suspend(trial.id, { reason: "Revisión de uso", expectedVersion: ext.version, actor: "op" });
    expect((await grantsOf(tenantId, subscriptionId)).every((x) => x.status === "suspended")).toBe(true);
    const back = await onboarding.reactivate(trial.id, { expectedVersion: sus.version, actor: "op" });
    expect(back.licencesChanged).toBeGreaterThan(0);
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.every((x) => x.status === "active" && x.validUntil === ext.endsAt)).toBe(true);
    expect(await snapshot(eco.id)).toBe(before);
  });

  it("repetir el alta de la prueba (reintento) sigue usando la suscripción de la prueba, sin crear otra", async () => {
    const { trial, subscriptionId, companyId } = await startTrial("Reintento");
    const eco = await economic(companyId, lines());
    const again = await onboarding.activate(trial.id, "op");
    expect(again.subscriptionId).toBe(subscriptionId);
    expect((await subStore.list({ companyId })).map((s) => s.id).sort()).toEqual([subscriptionId, eco.id].sort());
  });

  it("el pedido de conversión de la prueba apunta a la suscripción de la prueba y la convierte; la económica no se toca", async () => {
    const { trial, tenantId, subscriptionId, companyId } = await startTrial("Conversion");
    const eco = await economic(companyId, lines());
    const before = await snapshot(eco.id);
    clock += 3 * DAY;
    const o = (await orders.create({ idempotencyKey: key(), trialId: trial.id, request: { plan: "business", interval: "month", items: [] } }, A)).order;
    expect(o).toMatchObject({ kind: "trial_conversion", subscriptionId, tenantId, companyId });
    await orders.accept(o.id, { signatureRef: "firma-conversion", approvalReason: "Aprobado por producto" }, A);
    const done = (await orders.approve(o.id, { reason: "Cliente piloto de pruebas" }, A)).order;
    expect(done.state).toBe("active");
    const sub = await subs.must(subscriptionId);
    expect(sub).toMatchObject({ status: "active", trialEnd: null, tenantId });
    expect((await subStore.items(subscriptionId)).filter((i) => i.effectiveTo === null).map((i) => i.productKey)).toEqual(["business"]);
    expect((await trials.must(trial.id)).state).toBe("converted");
    const g = await grantsOf(tenantId, subscriptionId);
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((x) => x.status === "active" && x.validUntil === null)).toBe(true);
    expect(await snapshot(eco.id)).toBe(before);
    // Con el SaaS ya contratado, otro pedido «nuevo» se sigue rechazando, igual que sin la económica
    await expect(orders.create({ idempotencyKey: key(), companyId, request: { plan: "essential", interval: "month", items: [] } }, A)).rejects.toMatchObject({ code: "conflict" });
  });
});

describe.each(SHAPES)("empresa que solo paga infraestructura (%s) y después contrata el SaaS", (_name, lines) => {
  it("por pedidos: se crea una segunda suscripción, con plan y plataforma; la económica queda como estaba", async () => {
    const company = await crm.createCompany({ name: "Infra Ensayo SL" }, A);
    await crm.createContact(company.id, { name: "Ana Ensayo", email: `ana@${company.id}.example` }, A);
    const eco = await economic(company.id, lines());
    const before = await snapshot(eco.id);
    const o = (await orders.create({ idempotencyKey: key(), companyId: company.id, request: { plan: "essential", interval: "month", items: [] } }, A)).order;
    expect(o).toMatchObject({ kind: "new", companyId: company.id, subscriptionId: null });
    await orders.accept(o.id, { signatureRef: "firma-alta", approvalReason: "Aprobado por producto" }, A);
    const done = (await orders.approve(o.id, { reason: "Cliente piloto de pruebas" }, A)).order;
    expect(done.state).toBe("active");
    expect(done.subscriptionId).not.toBe(eco.id);
    const saas = await subs.must(done.subscriptionId!);
    expect(saas).toMatchObject({ companyId: company.id, status: "active", tenantId: done.tenantId });
    expect(saas.tenantId).toBeTruthy();
    expect((await subStore.items(saas.id)).filter((i) => i.effectiveTo === null).map((i) => i.productKey)).toEqual(["essential"]);
    expect((await grantsOf(saas.tenantId!, saas.id)).length).toBeGreaterThan(0);
    // Dos suscripciones vivas: la del SaaS y la económica, que no ha cambiado ni se ha enlazado a la plataforma nueva
    expect((await subStore.list({ companyId: company.id })).filter((s) => s.status !== "canceled").map((s) => s.id).sort()).toEqual([eco.id, saas.id].sort());
    expect((await subs.liveSaas(company.id)).map((s) => s.id)).toEqual([saas.id]);
    expect(await licences.companyOnboarded(company.id)).toEqual([]);
    expect(await snapshot(eco.id)).toBe(before);
    expect(await grantsOf(saas.tenantId!, eco.id)).toEqual([]);
  });

  it("por una prueba gratuita: el alta crea la suscripción del plan en prueba aunque exista la económica", async () => {
    const company = await crm.createCompany({ name: "Infra Prueba SL" }, A);
    const eco = await economic(company.id, lines());
    const before = await snapshot(eco.id);
    const t = await startTrial("Infra Prueba SL");
    expect(t.companyId).toBe(company.id);
    expect(t.subscriptionId).not.toBe(eco.id);
    expect(await subs.must(t.subscriptionId)).toMatchObject({ status: "trialing", tenantId: t.tenantId, companyId: company.id });
    const g = await grantsOf(t.tenantId, t.subscriptionId);
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((x) => x.status === "active" && x.validUntil !== null)).toBe(true);
    expect(await snapshot(eco.id)).toBe(before);
    // Y su ampliación funciona
    const ext = await onboarding.approveExtension(t.trial.id, { expectedVersion: t.trial.version, days: 5, actor: "op" });
    expect((await subs.must(t.subscriptionId)).trialEnd).toBe(ext.endsAt);
  });
});

describe("una suscripción enlazada a una plataforma nunca es «solo económica»", () => {
  it("aunque un acuerdo la deje solo con partidas a medida, sigue siendo la del SaaS (no se abre otro pedido)", async () => {
    const custom = { productKey: "custom:infra", family: "service", activationKind: null, effectiveFrom: T0 - DAY, effectiveTo: null };
    const sub = (id: number, tenantId: string | null) => ({ id, companyId: 7, tenantId, status: "active" }) as unknown as Awaited<ReturnType<typeof subs.list>>[number];
    const src = { list: async () => [sub(2, null), sub(1, "t-cliente")], items: async () => [custom] as never };
    expect(isEconomicOnly([custom], T0)).toBe(true);
    // La de la plataforma cuenta; la que nunca tuvo plataforma, no
    expect((await saasSubscriptions(src, 7, T0)).map((s) => s.id)).toEqual([1]);
  });
});

describe("sin suscripción económica nada cambia", () => {
  it("una suscripción ordinaria viva sigue contando: no se admite un segundo pedido nuevo y la prueba usa la suya", async () => {
    const { subscriptionId, companyId } = await startTrial("Normal");
    expect((await subs.liveSaas(companyId)).map((s) => s.id)).toEqual([subscriptionId]);
    await expect(orders.create({ idempotencyKey: key(), companyId, request: { plan: "essential", interval: "month", items: [] } }, A)).rejects.toMatchObject({ code: "conflict" });
  });
});
