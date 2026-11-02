/**
 * Banco de pruebas de la contratación de módulos (solo tests): orquestador REAL en memoria, sin MySQL ni Stripe,
 * con pagos del proveedor SIMULADO firmado de pruebas y fallos inyectables en los pasos posteriores al cobro.
 * Datos sintéticos; nada se cobra.
 */
import crypto from "node:crypto";
import { SignedTestProvider } from "./orchestrator/payments";
import { CommercialOrchestrator, type OrchestratorDeps } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import type { CommercialOrder, OrderPayment } from "./orchestrator/types";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { decide } from "./_core/capabilities/model";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { panelCatalog } from "./commerce/panelCatalog";
import { orderActivation, orderPlan, type ActivationReaderDeps, type BillingView } from "./commerce/panelActivation";

export const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
export const PRODUCT = "connect-people";
export const CAPABILITY = "people-hr";
export const DAY = 24 * 3600 * 1000;
export const ACTOR = "operator:test";
export const key = () => crypto.randomBytes(12).toString("hex");

/** Fallos inyectados: cada llamada al paso consume el primero de la cola (si lo hay) y lo lanza. */
export interface Faults {
  /** Al enlazar la suscripción con el contrato (paso «subscribe» de un cambio, tras aplicar las partidas). */
  subscribe: Error[];
  /** Al conceder las licencias (paso «license»). */
  licensing: Error[];
  /** En la nota del CRM justo antes de activar (paso «activate»). */
  activate: Error[];
  coverageHeld: boolean;
}

export async function contratacion(o: { processing?: ActivationReaderDeps["processing"] } = {}) {
  const t = { clock: Date.UTC(2026, 9, 16, 9) };
  const now = () => t.clock;
  const faults: Faults = { subscribe: [], licensing: [], activate: [], coverageHeld: false };
  const crmStore = new MemoryCrmStore();
  const subsStore = new MemorySubscriptionStore();
  const caps = new MemoryCapabilityStore();
  const orders = new MemoryOrderStore();
  const provider = new SignedTestProvider({ webhookSecret: SECRET });
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now });
  await seedElephantSource(web, webStore);
  const site: SiteDocument = await web.site("published");
  const platform = { activate: async ({ company }: { company: { id: number; tenantId: string | null } }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) };
  const crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now });
  const log = crm.log.bind(crm);
  crm.log = (async (...a: Parameters<CrmService["log"]>) => {
    if (/activo: suscripción/.test(String(a[3])) && faults.activate.length) throw faults.activate.shift();
    return log(...a);
  }) as CrmService["log"];
  const catalog = catalogFromWebStore(webStore);
  const crmPort = crmFromStore(crmStore);
  const subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now });
  const link = subs.linkContract.bind(subs);
  subs.linkContract = (async (...a: Parameters<SubscriptionService["linkContract"]>) => {
    if (faults.subscribe.length) throw faults.subscribe.shift();
    return link(...a);
  }) as SubscriptionService["linkContract"];
  const quoteSite = async () => quoteCatalogFromSite(await web.site("published"));
  const licensing = new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: quoteSite, now });
  const deps: OrchestratorDeps = {
    store: orders,
    crm,
    crmStore,
    subscriptions: subs,
    subscriptionStore: subsStore,
    shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now }),
    catalog,
    quote: async (r) => quote(await quoteSite(), r),
    licensing: {
      preview: (id, x) => licensing.preview(id, x),
      apply: async (id, x) => {
        if (faults.licensing.length) throw faults.licensing.shift();
        return licensing.apply(id, x);
      },
    },
    capabilities: caps,
    platform,
    payments: provider,
    coverageHeld: async () => faults.coverageHeld,
    now,
  };
  const svc = new CommercialOrchestrator(deps);
  let billing: BillingView | null = null;

  const activations = (tenantId: string) =>
    orderActivation({ crm: crmStore, orders, now, subscriptions: subsStore, billing: async () => billing, processing: o.processing })(tenantId);
  const panelItem = async (tenantId: string, product = PRODUCT) => {
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site, activation: await activations(tenantId) });
    return cat.items.find((i) => i.key === product)!;
  };
  const activationOf = async (tenantId: string, product = PRODUCT) => (await panelItem(tenantId, product)).activation!;
  const planOf = (tenantId: string) => orderPlan({ crm: crmStore, orders })(tenantId);
  const access = async (tenantId: string, write = true, capability = CAPABILITY) => decide(await caps.list(tenantId), capability, { write, now: t.clock });

  const company = async (name: string) => {
    const c = await crm.createCompany({ name }, ACTOR);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@${c.id}.example` }, ACTOR);
    return c.id;
  };
  /** Empresa con Business activo (alta aprobada por un operador, sin cobro). */
  const baseOrder = async (name: string, items: string[] = []) => {
    const cid = await company(name);
    const x = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "business", interval: "month", items: items.map((k) => ({ key: k })) } }, ACTOR)).order;
    await svc.accept(x.id, { signatureRef: "firma-alta", approvalReason: "Aprobado por producto" }, ACTOR);
    return (await svc.approve(x.id, { reason: "Cliente piloto de pruebas" }, ACTOR)).order;
  };
  const changeWith = (prev: CommercialOrder, items: string[]) => svc.create({ idempotencyKey: key(), changeOf: prev.id, request: { plan: "business", interval: "month", items: items.map((k) => ({ key: k })) } }, ACTOR);
  const paymentEvent = (p: Pick<OrderPayment, "idempotencyKey" | "providerRef" | "amountCents" | "currency">, type: "payment.succeeded" | "payment.failed") => {
    const body = JSON.stringify({ id: `evt_${key()}`, type, paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(t.clock / 1000)));
  };
  /** Compra del módulo sobre el pedido vigente hasta el cobro solicitado (pedido contratado). */
  const contractModule = async (base: CommercialOrder, items = [PRODUCT]) => {
    const ch = (await changeWith(base, items)).order;
    await svc.accept(ch.id, { signatureRef: `firma-${key()}`, approvalReason: "Aprobado por producto" }, ACTOR);
    const pay = (await svc.requestPayment(ch.id, ACTOR)).payment;
    return { order: ch, payment: pay };
  };
  /** Plan Core vigente de la suscripción (nunca cambia al contratar, suspender o cancelar un módulo). */
  const corePlan = async (subscriptionId: number) => {
    const items = await subsStore.items(subscriptionId);
    return items.find((i) => i.family === "core_plan" && i.effectiveFrom <= t.clock && (i.effectiveTo === null || i.effectiveTo > t.clock))?.productKey ?? null;
  };

  return {
    t,
    faults,
    svc,
    orders,
    crmStore,
    subsStore,
    caps,
    site,
    setBilling: (b: BillingView | null) => void (billing = b),
    activations,
    activationOf,
    planOf,
    access,
    baseOrder,
    changeWith,
    paymentEvent,
    contractModule,
    corePlan,
  };
}
export type Contratacion = Awaited<ReturnType<typeof contratacion>>;
