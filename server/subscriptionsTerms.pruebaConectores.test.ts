/**
 * Condiciones particulares aceptadas por un cliente que todavía está EN PRUEBA, con dos Connect de contratación
 * asistida (17/11/2026): Essential 29 € con 14 € de descuento recurrente, Elephant WhatsApp AI y Elephant Campaigns al
 * 100 %. Al aceptar: la prueba termina y se convierte, las licencias del acuerdo se aplican (las de Essential activas;
 * las de los Connect, «contratadas, pendientes de implantación»), se abren sus expedientes de implantación y al iniciar
 * cada expediente se activan solo sus licencias. Nada se cobra (modo sombra). Datos sintéticos en memoria.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { productDraft } from "./web/schemas";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { decide } from "./_core/capabilities/model";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { LicensingService } from "./licensing/service";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { TermsLicences } from "./commercialTerms/licences";
import { TermsAcceptanceService } from "./commercialTerms/acceptance";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MemoryExternalStore } from "./external/store";
import { MemoryTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialScheduler, memoryLock } from "./trials/scheduler";
import { ImplementationService } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { solutionFromWebStore } from "./implementation/ports";
import { addedByTerms, assistedConnectKeys, paidNetOpener } from "./implementation/paidNet";

const A = "operator:ana";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 5, 10);
const TENANT = "cliente-prueba";
const ESSENTIAL_CAP = "crm-contacts";

let clock: number;
let webStore: MemoryWebStore;
let P: Record<string, number>;
let subsStore: MemorySubscriptionStore;
let subs: SubscriptionService;
let termsStore: MemoryTermsStore;
let caps: MemoryCapabilityStore;
let licensing: LicensingService;
let licences: TermsLicences;
let terms: CommercialTermsService;
let crmStore: MemoryCrmStore;
let crm: CrmService;
let trialStore: MemoryTrialStore;
let trials: TrialService;
let implStore: MemoryImplementationStore;
let implementation: ImplementationService;
let acceptance: TermsAcceptanceService;
let shadow: ShadowBillingService;
let companyId: number;

beforeEach(async () => {
  clock = T0;
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  // Elephant Campaigns contratable con implantación acompañada (como en production desde la revisión del 08/11/2026)
  const e = (await webStore.getEntry("product", "connect-campaigns"))!;
  const d = productDraft.parse(e.draft);
  const saved = await web.save("product", "connect-campaigns", { draft: productDraft.parse({ ...d, technicalStatus: "partial", catalog: { ...d.catalog, commercialStatus: "on_request" } }), expectedVersion: e.draftVersion }, A);
  await web.publish("product", "connect-campaigns", saved.draftVersion, A);
  P = {};
  for (const key of ["essential", "connect-whatsapp-ai", "connect-campaigns"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  crmStore = new MemoryCrmStore();
  crm = new CrmService({ store: crmStore, now: () => clock });
  const c = await crm.createCompany({ name: "Cliente en prueba", legalName: "Cliente en prueba SL" }, A);
  companyId = c.id;
  await crmStore.update("companies", c.id, { tenantId: TENANT });
  await crm.createContact(c.id, { name: "Marta Prueba", email: "marta@cliente-prueba.example", isPrimary: true } as never, A);
  // Como en el plano de control: empresas y contratos del CRM
  const crmPort = crmFromStore(crmStore);
  subsStore = new MemorySubscriptionStore();
  subs = new SubscriptionService({ store: subsStore, catalog: catalogFromWebStore(webStore), crm: crmPort, now: () => clock });
  termsStore = new MemoryTermsStore();
  caps = new MemoryCapabilityStore();
  licensing = new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock, limits: new MemoryTenantLimitStore() });
  licences = new TermsLicences({ auto: true, licensing, capabilities: caps, subscriptions: subs, subscriptionStore: subsStore, termsStore, companyTenant: async () => TENANT, now: () => clock });
  terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: subsStore, catalog: catalogFromWebStore(webStore), crm: crmPort, now: () => clock, afterChange: (sid, actor) => licences.afterChange(sid, actor) });
  trialStore = new MemoryTrialStore();
  trials = new TrialService({ store: trialStore, subscriptions: subsStore, now: () => clock });
  implStore = new MemoryImplementationStore();
  implementation = new ImplementationService({
    store: implStore,
    crm,
    crmStore,
    solution: solutionFromWebStore(webStore),
    notify: async () => ({ queued: true }),
    activateSolution: (sid, key, actor) => licensing.activatePendingSetup(sid, key, { actor }),
    now: () => clock,
  });
  const paidNet = paidNetOpener({ implementation, catalog: catalogFromWebStore(webStore) });
  acceptance = new TermsAcceptanceService({
    terms,
    termsStore,
    subscriptions: subs,
    subscriptionStore: subsStore,
    crm,
    crmStore,
    acceptances: new MemoryExternalStore("test"),
    url: "https://admin.example.test/cp/v1/public/contract-acceptance/condiciones",
    now: () => clock,
    // Como en el plano de control (server/controlPlane/api.ts)
    onActivated: async ({ terms: t, subscriptionId, contractId }) => {
      const added = addedByTerms(t, await termsStore.list({ companyId: t.companyId, status: ["active", "scheduled", "superseded", "expired"] }));
      await paidNet.fromTerms({ companyId: t.companyId, contractId, subscriptionId, productKeys: added, reference: `condiciones #${t.id}` });
      await paidNet.assistedFromTerms({ companyId: t.companyId, contractId, subscriptionId, productKeys: added, reference: `condiciones #${t.id}` });
    },
    trials: { byTenant: (tenantId) => trialStore.byTenant(tenantId), convert: (id, v, sid, actor) => trials.convert(id, v, sid, actor) },
    licences,
  });
  shadow = new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock, settle: (sid) => terms.settleDue(sid), onSimulate: (sid) => licences.retryIfPending(sid) });
});

const cat = (key: string): LineInput => ({ kind: "catalog", productKey: key, priceId: P[key] });
/** Essential 29 € − 14 € (recurrente) + WhatsApp AI y Campaigns al 100 % (recurrente): 15,00 € al mes. */
const AGREEMENT = (): TermsInput => ({
  pricingMode: "per_item",
  presentation: "breakdown",
  requiresAcceptance: true,
  reason: "Condiciones particulares negociadas con el cliente en prueba",
  lines: [cat("essential"), cat("connect-whatsapp-ai"), cat("connect-campaigns")],
  adjustments: [
    { line: 0, type: "discount", mode: "amount", value: 1400, recurrence: "recurring" },
    { line: 1, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring" },
    { line: 2, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring" },
  ],
});

/** Prueba gratuita en curso, como la deja el circuito de la prueba: registro activo, suscripción en prueba y licencias. */
async function trialing() {
  const sub = await subs.create({ companyId, tenantId: TENANT, interval: "month", trialDays: 15, plan: { productKey: "essential", priceId: P.essential }, reason: "Prueba gratuita" }, "system:trial");
  await licensing.apply(sub.id, { activate: true, actor: "system:trial", reason: "Prueba gratuita" });
  const trial = await trialStore.insert(
    {
      email: "marta@cliente-prueba.example",
      emailDomain: "cliente-prueba.example",
      companyName: "Cliente en prueba",
      configuration: { plan: "essential", addons: [] },
      state: "active",
      verificationTokenHash: null,
      verificationExpiresAt: null,
      verifiedAt: T0,
      tenantId: TENANT,
      startsAt: T0,
      endsAt: T0 + 15 * DAY,
      extensionsUsed: 0,
      extensionRequestedAt: null,
      extensionReason: null,
      suspendedReason: null,
      convertedSubscriptionId: null,
      idempotencyKey: "prueba-condiciones-conectores",
      ipHash: null,
      createdAt: T0,
    },
    "system:trial",
  );
  return { sub, trial };
}

async function acceptOn(subscriptionId: number) {
  const draft = await terms.createForSubscription(subscriptionId, AGREEMENT(), A);
  const sent = await acceptance.request(draft.id, { signer: { name: "Marta Prueba", email: "marta@cliente-prueba.example" }, expectedRevision: draft.revision }, A);
  const token = sent.url.split("token=")[1];
  const out = await acceptance.accept(token, { name: "Marta Prueba", accept: true }, { ip: null, userAgent: "navegador-de-prueba" });
  return { termsId: draft.id, out };
}

const grant = async (capabilityId: string) => (await caps.list(TENANT)).find((g) => g.capabilityId === capabilityId) ?? null;
const statusOf = async (capabilityId: string) => (await grant(capabilityId))?.status ?? null;
const netOfPeriod = async (subscriptionId: number) => {
  const inv = (await shadow.simulateCurrent(subscriptionId, "system:test")).results.find((r) => r.invoice.kind === "renewal")!.invoice;
  return inv.subtotalCents - inv.discountCents;
};

describe("condiciones con Connect asistido aceptadas durante la prueba", () => {
  it("la prueba termina y se convierte; Essential activo; WhatsApp AI y Campaigns pendientes de implantación con sus expedientes; nada se cobra", async () => {
    const { sub, trial } = await trialing();
    expect(await statusOf(ESSENTIAL_CAP)).toBe("active");
    expect((await grant(ESSENTIAL_CAP))!.validUntil).toBe(sub.trialEnd);
    const { termsId, out } = await acceptOn(sub.id);
    expect(out).toMatchObject({ accepted: true, activated: true });

    // Suscripción: fuera de la prueba, primer periodo desde hoy, en modo sombra y con las partidas del acuerdo
    const after = await subs.must(sub.id);
    expect(after).toMatchObject({ status: "active", trialEnd: null, mode: "shadow", currentPeriodStart: clock, contractId: (await termsStore.get(termsId))!.contractId });
    expect((await subsStore.events(sub.id)).map((e) => e.kind)).toContain("trial_ended");
    const live = (await subsStore.items(sub.id)).filter((i) => i.effectiveTo === null);
    expect(live.map((i) => [i.productKey, i.priceSource]).sort()).toEqual([["connect-campaigns", "contract"], ["connect-whatsapp-ai", "contract"], ["essential", "contract"]]);
    // Registro de la prueba convertido en esta suscripción
    expect(await trialStore.get(trial.id)).toMatchObject({ state: "converted", convertedSubscriptionId: sub.id });
    expect((await termsStore.events({ termsId })).find((e) => e.kind === "trial_ended")).toMatchObject({ syncResult: "applied", after: { subscriptionId: sub.id, trialEnded: true, trialId: trial.id, trialConverted: true } });

    // Licencias del acuerdo: Essential activa y sin caducidad de prueba; los Connect, contratados sin permitir su uso
    expect(await grant(ESSENTIAL_CAP)).toMatchObject({ status: "active", validUntil: null, source: `subscription:${sub.id}` });
    expect(await grant("whatsapp-ai")).toMatchObject({ status: "pending_setup", source: `subscription:${sub.id}` });
    expect(await grant("email-campaigns")).toMatchObject({ status: "pending_setup", source: `subscription:${sub.id}` });
    const grants = await caps.list(TENANT);
    expect(decide(grants, "whatsapp-ai", { write: false, now: clock })).toMatchObject({ allowed: false, status: "pending_setup" });
    expect(decide(grants, ESSENTIAL_CAP, { write: true, now: clock })).toMatchObject({ allowed: true });
    const applied = (await termsStore.events({ termsId })).filter((e) => e.kind === "licences_applied").pop()!;
    expect(applied.after).toMatchObject({ pendingSetup: ["email-campaigns", "whatsapp-ai"] });

    // Expedientes de implantación de los dos Connect, contratados (sin propuesta) y con la suscripción
    const orders = implStore.rows.filter((o) => o.companyId === companyId);
    expect(orders.map((o) => [o.solutionKey, o.status, o.subscriptionId]).sort()).toEqual([
      ["connect-campaigns", "accepted", sub.id],
      ["connect-whatsapp-ai", "accepted", sub.id],
    ]);
    expect(orders.every((o) => (o.requestSnapshot as { source?: string; circuit?: string }).source === "paid" && (o.requestSnapshot as { circuit?: string }).circuit === "custom_terms")).toBe(true);

    // Nada se cobra: sin cobro abierto ni sincronización con Stripe; la cuota negociada es 15,00 €
    expect((await termsStore.events({ termsId })).some((e) => e.kind === "sync" || e.kind.startsWith("billing"))).toBe(false);
    expect((await termsStore.get(termsId))!.summary).toMatchObject({ recurring: { netCents: 1500 } });
    expect(await netOfPeriod(sub.id)).toBe(1500);
  });

  it("repetir la aplicación y renovar mantiene los Connect pendientes y la cuota de 15,00 €; la prueba vencida ya no la vence la tarea", async () => {
    const { sub, trial } = await trialing();
    const { termsId } = await acceptOn(sub.id);
    const before = await caps.list(TENANT);
    expect(await licences.ensure(sub.id, A, { force: true })).toMatchObject({ status: "applied", changed: 0, pendingSetup: ["email-campaigns", "whatsapp-ai"] });
    expect(await licences.afterChange(sub.id)).toMatchObject({ status: "applied", changed: 0 });
    expect(await caps.list(TENANT)).toEqual(before);
    expect(await licences.status(sub.id)).toMatchObject({ plan: { pending: 0, pendingSetup: ["email-campaigns", "whatsapp-ai"] } });

    // Renovación (un mes después): mismas partidas de contrato, misma cuota y licencias sin cambios
    clock = (await subs.must(sub.id)).currentPeriodEnd + 1000;
    await subs.applyRenewals(sub.id, "system:test");
    expect(await netOfPeriod(sub.id)).toBe(1500);
    expect((await subsStore.items(sub.id)).filter((i) => i.effectiveTo === null).every((i) => i.priceSource === "contract")).toBe(true);
    await licences.retryIfPending(sub.id);
    expect(await statusOf("whatsapp-ai")).toBe("pending_setup");
    expect(await statusOf("email-campaigns")).toBe("pending_setup");
    expect(await statusOf(ESSENTIAL_CAP)).toBe("active");
    expect((await termsStore.events({ termsId })).filter((e) => e.kind === "trial_ended")).toHaveLength(1);

    // Pasado el fin original de la prueba, la tarea programada no vence ni avisa a la prueba convertida
    expect(clock).toBeGreaterThan(trial.endsAt!);
    const tick = await new TrialScheduler({ store: trialStore, notify: { expiryNotice: async () => undefined }, lock: memoryLock(), now: () => clock, log: () => undefined, exempt: new Set() }).tick();
    expect(tick).toMatchObject({ expired: 0, noticesQueued: 0, errors: 0 });
    expect((await trialStore.get(trial.id))!.state).toBe("converted");
  });

  it("al iniciar el expediente de WhatsApp AI se activan solo sus licencias; Campaigns sigue pendiente", async () => {
    const { sub } = await trialing();
    await acceptOn(sub.id);
    const wa = implStore.rows.find((o) => o.solutionKey === "connect-whatsapp-ai")!;
    for (const m of await implStore.milestones(wa.id)) if (m.required) await implementation.setMilestoneDone(wa.id, m.id, true, A);
    await implementation.markReady(wa.id, {}, A);
    await implementation.enable(wa.id, A);
    const started = await implementation.communicate(wa.id, A);
    expect(started).toMatchObject({ status: "started", subscriptionId: sub.id });
    expect(await grant("whatsapp-ai")).toMatchObject({ status: "active", source: `subscription:${sub.id}` });
    expect(await statusOf("email-campaigns")).toBe("pending_setup");
    expect(await statusOf(ESSENTIAL_CAP)).toBe("active");
    expect((await implStore.events(wa.id)).some((e) => e.type === "note" && /whatsapp-ai/.test(e.detail ?? ""))).toBe(true);
    // La suscripción no cambia (no se crea otra) y la aplicación de las licencias del acuerdo no vuelve a rebajarla
    expect((await subsStore.list({ companyId })).map((s) => s.id)).toEqual([sub.id]);
    expect(await licences.ensure(sub.id, A, { force: true })).toMatchObject({ status: "applied", changed: 0, pendingSetup: ["email-campaigns"] });
    expect(await statusOf("whatsapp-ai")).toBe("active");
    // Repetir el inicio no cambia nada
    expect(await implementation.start(wa.id, A)).toMatchObject({ status: "started" });
    expect(await licensing.activatePendingSetup(sub.id, "connect-whatsapp-ai", { actor: A })).toMatchObject({ activated: [] });
  });

  it("en una suscripción que no está en prueba la aceptación sigue como antes (sin terminar ni convertir ninguna prueba)", async () => {
    const sub = await subs.create({ companyId, tenantId: TENANT, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const { termsId, out } = await acceptOn(sub.id);
    expect(out).toMatchObject({ accepted: true, activated: true });
    const after = await subs.must(sub.id);
    expect(after).toMatchObject({ status: "active", currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd });
    expect((await subsStore.events(sub.id)).map((e) => e.kind)).not.toContain("trial_ended");
    expect((await termsStore.events({ termsId })).some((e) => e.kind.startsWith("trial_"))).toBe(false);
    expect(await statusOf(ESSENTIAL_CAP)).toBe("active");
    expect(await statusOf("whatsapp-ai")).toBe("pending_setup");
  });

  it("solo los productos Connect de contratación asistida abren expediente (ni el plan, ni los directos, ni las ampliaciones)", () => {
    expect(assistedConnectKeys(["essential", "connect-whatsapp-ai", "connect-people", "addon-user-essential", "connect-whatsapp-ai"])).toEqual(["connect-whatsapp-ai"]);
  });
});
