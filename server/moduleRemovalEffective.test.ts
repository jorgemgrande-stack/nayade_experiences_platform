/**
 * Baja EFECTIVA de un módulo (plantilla module.removal_effective): la sincronización de licencias emite
 * `subscription.module_removal_effective` con el producto retirado solo cuando cancela de verdad sus licencias, una vez
 * por partida, y el despachador la envía al contacto de facturación. Nunca por una baja solo programada ni por un
 * paquete que sustituye a sus componentes. Catálogo oficial en memoria (como subscriptions.intervals.test.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemoryCommercialEventLog } from "./commercialEvents/log";
import type { CommercialEvent } from "./commercialEvents/types";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { LicensingService } from "./licensing/service";
import { NotificationDispatcher } from "./notifications/dispatcher";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { addMonthsUTC } from "./subscriptions/pricing";
import { SubscriptionService } from "./subscriptions/service";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";

const A = "operator:ana";
const T0 = Date.UTC(2026, 0, 15, 10);
const DAY = 86_400_000;
const month = (n: number) => addMonthsUTC(T0, n, 15);

let clock: number;
let web: WebAdminService;
let webStore: MemoryWebStore;
let store: MemorySubscriptionStore;
let subs: SubscriptionService;
let caps: MemoryCapabilityStore;
let log: MemoryCommercialEventLog;
let licensing: LicensingService;

async function priceOf(key: string, kind: "monthly" | "yearly" = "monthly") {
  const e = (await webStore.getEntry("product", key))!;
  return (await webStore.listPrices(e.id)).find((p) => p.status === "approved" && p.kind === kind)!.id;
}
/** Solo en el catálogo en memoria de la prueba: lo marca contratable. */
async function enable(key: string) {
  const e = (await webStore.getEntry("product", key))!;
  const d = e.draft as Record<string, unknown> & { catalog: Record<string, unknown> };
  const saved = await web.save("product", key, { draft: { ...d, technicalStatus: "partial", catalog: { ...d.catalog, commercialStatus: "on_request" } }, expectedVersion: e.draftVersion }, A);
  await web.publish("product", key, saved.draftVersion, A);
}

beforeEach(async () => {
  clock = T0;
  webStore = new MemoryWebStore();
  web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  await enable("connect-whatsapp-ai");
  const crm: CrmPort = {
    company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : null),
    contract: async (id) => (id === 10 ? { id: 10, reference: "CT-2026-000010", companyId: 1, status: "signed", amountCents: null, currency: "EUR", billingInterval: "year", tenantId: "acme", configuration: null } : null),
  };
  store = new MemorySubscriptionStore();
  caps = new MemoryCapabilityStore();
  log = new MemoryCommercialEventLog("test");
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock, events: log });
});

const create = async (addons: string[]) =>
  subs.create(
    {
      companyId: 1,
      contractId: 10,
      interval: "year",
      plan: { productKey: "essential", priceId: await priceOf("essential", "yearly") },
      addons: await Promise.all(addons.map(async (k) => ({ productKey: k, priceId: await priceOf(k) }))),
    } as never,
    A,
  );
const version = async (id: number) => (await subs.must(id)).version;
const itemOf = async (id: number, key: string) => (await subs.detail(id)).items.find((i) => i.productKey === key && i.effectiveTo === null)!;
const removals = async () => (await log.list({ types: ["subscription.module_removal_effective"] })) as CommercialEvent[];

describe("baja efectiva de un módulo", () => {
  it("solo al cancelar de verdad sus licencias (no al programarla), una vez por partida y con el producto retirado", async () => {
    const s = await create(["connect-whatsapp-ai", "connect-people"]);
    await licensing.apply(s.id, { activate: true, actor: A });
    const wa = await itemOf(s.id, "connect-whatsapp-ai");
    await subs.removeItem(s.id, wa.id, { reason: "Fin del módulo" }, await version(s.id), A);
    // Baja programada: la sincronización fija la caducidad, pero el módulo sigue activo → ningún hecho de baja efectiva
    await licensing.apply(s.id, { activate: true, actor: A });
    clock = month(1) - DAY;
    await licensing.apply(s.id, { activate: true, actor: A });
    expect(await removals()).toEqual([]);
    // Cumplida la fecha: la sincronización cancela sus licencias y emite el hecho
    clock = month(1) + 3_600_000;
    const r = await licensing.apply(s.id, { activate: true, actor: A });
    expect(r.applied.map((e) => [e.capabilityId, e.toStatus])).toEqual([["whatsapp-ai", "cancelled"]]);
    const ev = await removals();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ key: `subscription:${s.id}:item:${wa.id}:removal_effective`, tenantId: "acme", companyId: 1, subscriptionId: s.id, occurredAt: clock });
    expect(ev[0].data).toMatchObject({ before: { item: "connect-whatsapp-ai" }, after: { effectiveTo: month(1) }, capabilities: ["whatsapp-ai"] });
    // Repetir la sincronización no repite el hecho; el resto de módulos no se da de baja
    await licensing.apply(s.id, { activate: true, actor: A });
    clock += DAY;
    await licensing.apply(s.id, { activate: true, actor: A });
    expect(await removals()).toHaveLength(1);
  });

  it("un paquete que sustituye a sus componentes no es una baja (sus licencias siguen)", async () => {
    const s = await create(["connect-tax", "connect-partners"]);
    await licensing.apply(s.id, { activate: true, actor: A });
    clock = T0 + 10 * DAY;
    await subs.addItem(s.id, { item: { productKey: "connect-pack-finance", priceId: await priceOf("connect-pack-finance") } }, await version(s.id), A);
    clock = month(1) + DAY;
    await licensing.apply(s.id, { activate: true, actor: A });
    expect(await removals()).toEqual([]);
  });

  it("sin registro de eventos no emite nada ni falla", async () => {
    licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm: { company: async () => null, contract: async () => ({ id: 10, reference: null, companyId: 1, status: "signed", amountCents: null, currency: "EUR", billingInterval: "year", tenantId: "acme", configuration: null }) }, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock });
    const s = await create(["connect-whatsapp-ai"]);
    await licensing.apply(s.id, { activate: true, actor: A });
    await subs.removeItem(s.id, (await itemOf(s.id, "connect-whatsapp-ai")).id, { reason: "Fin del módulo" }, await version(s.id), A);
    clock = month(1) + DAY;
    await expect(licensing.apply(s.id, { activate: true, actor: A })).resolves.toBeTruthy();
    expect(await removals()).toEqual([]);
  });

  it("el despachador lo envía una vez al contacto de facturación (module.removal_effective), no como baja programada", async () => {
    const crmStore = new MemoryCrmStore();
    const crmSvc = new CrmService({ store: crmStore, now: () => clock });
    const company = await crmSvc.createCompany({ name: "Acme SL" }, A);
    await crmSvc.createContact(company.id, { name: "Ana", email: "ana@acme.example", isPrimary: true }, A);
    const s = await create(["connect-whatsapp-ai"]);
    await licensing.apply(s.id, { activate: true, actor: A });
    await subs.removeItem(s.id, (await itemOf(s.id, "connect-whatsapp-ai")).id, { reason: "Fin del módulo" }, await version(s.id), A);
    clock = month(1) + DAY;
    await licensing.apply(s.id, { activate: true, actor: A });
    const sent: Array<{ key: string; to: string; subject: string; text: string }> = [];
    const dispatcher = new NotificationDispatcher({
      queue: log,
      send: async (_t, key, _c, to, content) => void sent.push({ key, to, subject: content.subject, text: content.text ?? "" }),
      crmStore,
      hostOf: async () => "acme.elephant.test",
      productName: async (k) => (k === "connect-whatsapp-ai" ? "WhatsApp AI" : null),
      supportEmail: "soporte@bigelephant.es",
      since: T0,
      now: () => clock,
    });
    // El evento lleva la empresa 1 de la suscripción; en el CRM de la prueba es la recién creada
    expect(company.id).toBe(1);
    await dispatcher.run();
    await dispatcher.run();
    expect(sent.map((x) => [x.key.split(":")[1], x.to])).toEqual([["module.removal_effective", "ana@acme.example"]]);
    expect(sent[0].subject).toContain("WhatsApp AI ya no está activo");
  });
});
