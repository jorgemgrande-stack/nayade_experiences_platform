/**
 * Suscripciones con intervalos mixtos (sin BD): plan anual con complementos mensuales, renovación
 * independiente de cada partida, bajas y vencimientos de módulos sin tocar el Core, cambio de plan a
 * mitad de periodo, paquetes con componentes ya contratados y licencias resultantes (estado y
 * caducidad). Usa el catálogo oficial de Elephant Source (semilla real en memoria).
 *
 * Enterprise, WhatsApp AI y Ski Net · Alquiler están hoy «en hoja de ruta» o «próximamente» y el motor
 * NO deja contratarlos; aquí se habilitan SOLO en el catálogo en memoria de la prueba para poder
 * ejercitar los casos pedidos (el catálogo real no cambia).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { CapabilityAccess } from "./_core/capabilities/access";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { quote } from "./catalog/quote";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { LicensingService } from "./licensing/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { addMonthsUTC, itemPeriods } from "./subscriptions/pricing";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";

const A = "operator:ana";
const T0 = Date.UTC(2026, 0, 15, 10); // 15/01/2026
const E1 = Date.UTC(2027, 0, 15, 10); // fin del primer año
const month = (n: number) => addMonthsUTC(T0, n, 15);
const DAY = 86_400_000;
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

let clock: number;
let web: WebAdminService;
let webStore: MemoryWebStore;
let store: MemorySubscriptionStore;
let subs: SubscriptionService;
let shadow: ShadowBillingService;
let caps: MemoryCapabilityStore;
let licensing: LicensingService;
let configuration: { request: { plan: string; interval: "month" | "year"; items: Array<{ key: string }> } } | null;

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
  configuration = null;
  webStore = new MemoryWebStore();
  web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  for (const k of ["enterprise", "connect-whatsapp-ai", "ski-net-rental"]) await enable(k);
  const crm: CrmPort = {
    company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : null),
    contract: async (id) => (id === 10 ? { id: 10, reference: "CT-2026-000010", companyId: 1, status: "signed", amountCents: null, currency: "EUR", billingInterval: "year", tenantId: "acme", configuration } : null),
  };
  store = new MemorySubscriptionStore();
  caps = new MemoryCapabilityStore();
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  shadow = new ShadowBillingService({ store, crm, now: () => clock });
  licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock });
});

const create = async (plan: string, interval: "month" | "year", addons: string[], over: Record<string, unknown> = {}) =>
  subs.create(
    {
      companyId: 1,
      contractId: 10,
      interval,
      plan: { productKey: plan, priceId: await priceOf(plan, interval === "year" ? "yearly" : "monthly") },
      addons: await Promise.all(addons.map(async (k) => ({ productKey: k, priceId: await priceOf(k) }))),
      ...over,
    } as never,
    A,
  );
const itemOf = async (id: number, key: string) => (await subs.detail(id)).items.find((i) => i.productKey === key && i.effectiveTo === null) ?? (await subs.detail(id)).items.filter((i) => i.productKey === key).pop()!;
const version = async (id: number) => (await subs.must(id)).version;
const grant = async (cap: string) => (await caps.list("acme")).find((g) => g.capabilityId === cap);
const invoices = async (id: number) => (await store.shadowInvoices(id)).map((i) => [i.kind, i.dedupeKey, day(i.periodStart), day(i.periodEnd), i.subtotalCents]);

describe("periodos propios", () => {
  it("un periodo anual se divide en 12 periodos mensuales con el mismo anclaje; el último acaba con el Core", () => {
    const ps = itemPeriods({ interval: "year", anchorDay: 15, currentPeriodStart: T0, currentPeriodEnd: E1 }, "month");
    expect(ps).toHaveLength(12);
    expect(ps[0]).toEqual({ start: T0, end: month(1) });
    expect(ps[11].end).toBe(E1);
    expect(itemPeriods({ interval: "month", anchorDay: 15, currentPeriodStart: T0, currentPeriodEnd: month(1) }, "month")).toEqual([{ start: T0, end: month(1) }]);
  });
});

describe("intervalos mixtos", () => {
  it("1) Essential anual + WhatsApp AI mensual: cada partida con su periodo y su renovación; licencias activas sin caducidad", async () => {
    // El contrato del CRM acuerda plan anual con el complemento mensual (lo que daba el cotizador)
    configuration = { request: { plan: "essential", interval: "year", items: [{ key: "connect-whatsapp-ai" }] } };
    const s = await create("essential", "year", ["connect-whatsapp-ai"]);
    expect(s).toMatchObject({ interval: "year", currentPeriodEnd: E1 });
    const d = await subs.detail(s.id);
    expect(d.schedule.map((x) => [x.productKey, x.interval, day(x.periodEnd), x.renewsAt && day(x.renewsAt)])).toEqual([
      ["essential", "year", "2027-01-15", "2027-01-15"],
      ["connect-whatsapp-ai", "month", "2026-02-15", "2026-02-15"],
    ]);
    await shadow.simulateCurrent(s.id, A);
    expect(await invoices(s.id)).toEqual([
      ["renewal", "", "2026-01-15", "2027-01-15", 27900],
      ["renewal", "interval:month", "2026-01-15", "2026-02-15", 2900],
    ]);
    const r = await licensing.apply(s.id, { activate: true, actor: A });
    expect(r.desired.map((x) => x.capabilityId).sort()).toEqual([...capabilitiesOfTier("essential"), "whatsapp-ai"].sort());
    expect(r.applied.every((e) => e.toStatus === "active")).toBe(true);
    expect(await grant("whatsapp-ai")).toMatchObject({ status: "active", validUntil: null });
    expect(await grant("crm-leads")).toMatchObject({ status: "active", validUntil: null });
  });

  it("2) Business mensual + Ski Net · Alquiler mensual: un solo intervalo, igual que antes", async () => {
    const s = await create("business", "month", ["ski-net-rental"]);
    await shadow.simulateCurrent(s.id, A);
    // Una sola factura de renovación con las dos partidas: sin conceptos por intervalo
    expect(await invoices(s.id)).toEqual([["renewal", "", "2026-01-15", "2026-02-15", 7900 + 3900]]);
    expect((await subs.detail(s.id)).schedule.map((x) => [x.interval, day(x.renewsAt!)])).toEqual([
      ["month", "2026-02-15"],
      ["month", "2026-02-15"],
    ]);
    await licensing.apply(s.id, { activate: true, actor: A });
    expect(await grant("ski-rental")).toMatchObject({ status: "active", validUntil: null });
    // Un complemento anual no cabe en un plan mensual (precio anual sintético, solo en esta prueba)
    const y = await web.addPrice("connect-people", { kind: "yearly", amountCents: 19000, taxRateBp: 2100 } as never, A);
    await web.approvePrice(y.id, A);
    await expect(subs.addItem(s.id, { item: { productKey: "connect-people", priceId: y.id } }, s.version, A)).rejects.toThrow(/exige un plan Core anual/);
    // El plan Core sigue exigiendo el precio de su periodicidad
    await expect(subs.create({ companyId: 1, interval: "year", plan: { productKey: "business", priceId: await priceOf("business") } }, A)).rejects.toThrow(/precio yearly/);
  });

  it("3) Enterprise anual + complemento mensual: el complemento renueva cada mes sin duplicar facturas", async () => {
    // Elephant People solo se contrata con Essential o Business (01/11/2026): otra extensión mensual del mismo precio
    await expect(create("enterprise", "year", ["connect-people"])).rejects.toThrow(/no es compatible con el plan/);
    const s = await create("enterprise", "year", ["connect-tax"]);
    clock = month(2) + DAY;
    const a = await shadow.simulateCurrent(s.id, A);
    const b = await shadow.simulateCurrent(s.id, A);
    expect(b.results.every((x) => !x.created && x.drift === null)).toBe(true);
    expect(a.results.map((x) => x.invoice.id)).toEqual(b.results.map((x) => x.invoice.id));
    expect(await invoices(s.id)).toEqual([
      ["renewal", "", "2026-01-15", "2027-01-15", 189900],
      ["renewal", "interval:month", "2026-01-15", "2026-02-15", 1900],
      ["renewal", "interval:month", "2026-02-15", "2026-03-15", 1900],
      ["renewal", "interval:month", "2026-03-15", "2026-04-15", 1900],
    ]);
    const r = await licensing.apply(s.id, { activate: true, actor: A });
    expect(r.desired.map((x) => x.capabilityId)).toEqual(expect.arrayContaining([...capabilitiesOfTier("enterprise"), "tax-filings"]));
    expect((await caps.list("acme")).every((g) => g.status === "active" && g.validUntil === null)).toBe(true);
  });

  it("4) cambio de plan a mitad de periodo: subida prorrateada sobre el periodo del Core; el complemento mensual sigue igual; bajada programada caduca lo que se pierde", async () => {
    const s = await create("essential", "year", ["connect-whatsapp-ai"]);
    await shadow.simulateCurrent(s.id, A);
    await licensing.apply(s.id, { activate: true, actor: A });
    clock = month(6); // 15/07/2026: quedan 184 de 365 días del año
    await subs.changePlan(s.id, { plan: { productKey: "business", priceId: await priceOf("business", "yearly") } }, await version(s.id), A);
    const sim = await shadow.simulateCurrent(s.id, A);
    const prorr = sim.results.find((x) => x.invoice.kind === "proration")!.invoice;
    expect([day(prorr.periodStart), day(prorr.periodEnd)]).toEqual(["2026-01-15", "2027-01-15"]);
    expect(prorr.lines.map((l) => [l.productKey, l.grossCents])).toEqual([
      ["business", Math.floor((75900 * 184) / 365)],
      ["essential", -Math.floor((27900 * 184) / 365)],
    ]);
    expect(prorr.subtotalCents).toBe(38261 - 14064);
    // Lo ya registrado no cambia: la renovación anual de Essential sigue en 27.900
    expect((await store.shadowInvoices(s.id)).find((i) => i.kind === "renewal" && i.dedupeKey === "")!.subtotalCents).toBe(27900);
    // WhatsApp sigue con su precio y sus renovaciones mensuales (7 meses empezados)
    expect((await store.shadowInvoices(s.id)).filter((i) => i.dedupeKey === "interval:month").map((i) => i.subtotalCents)).toEqual(Array(7).fill(2900));
    const up = await licensing.apply(s.id, { activate: true, actor: A });
    expect(up.applied.map((e) => e.capabilityId).sort()).toEqual([...capabilitiesOfTier("business")].sort());
    // Bajada a Essential: a fin del periodo del Core, sin abonos; lo exclusivo de Business caduca entonces
    await expect(subs.changePlan(s.id, { plan: { productKey: "essential", priceId: await priceOf("essential", "yearly") }, when: "now" }, await version(s.id), A)).rejects.toThrow(/fin de periodo/);
    const down = await subs.changePlan(s.id, { plan: { productKey: "essential", priceId: await priceOf("essential", "yearly") } }, await version(s.id), A);
    expect(down.result.effectiveFrom).toBe(E1);
    const p = await licensing.preview(s.id, { activate: true });
    const businessOnly = capabilitiesOfTier("business").filter((c) => !capabilitiesOfTier("essential").includes(c));
    expect(p.changes.map((c) => c.capabilityId).sort()).toEqual([...businessOnly].sort());
    expect(p.changes.every((c) => c.validUntil === E1 && c.status === "active")).toBe(true);
  });

  it("5) cancelación de un complemento mensual en un plan anual: termina al acabar SU mes, sin abonos ni tocar lo facturado", async () => {
    const s = await create("essential", "year", ["connect-whatsapp-ai"]);
    await shadow.simulateCurrent(s.id, A);
    const before = await store.shadowInvoices(s.id);
    clock = T0 + 20 * DAY; // 04/02/2026
    const wa = await itemOf(s.id, "connect-whatsapp-ai");
    const r = await subs.removeItem(s.id, wa.id, { reason: "El cliente no lo usa" }, await version(s.id), A);
    expect(day(r.result.effectiveTo)).toBe("2026-02-15");
    const d = await subs.detail(s.id);
    expect(d.subscription).toMatchObject({ status: "active", cancelAt: null, currentPeriodEnd: E1 });
    expect(d.schedule.find((x) => x.productKey === "connect-whatsapp-ai")).toMatchObject({ renewsAt: null, periodEnd: month(1) });
    await licensing.apply(s.id, { activate: true, actor: A });
    expect(await grant("whatsapp-ai")).toMatchObject({ status: "active", validUntil: month(1) });
    expect(await grant("crm-leads")).toMatchObject({ status: "active", validUntil: null });
    clock = month(2) + DAY;
    const sim = await shadow.simulateCurrent(s.id, A);
    // Ni prorrateo ni abono; los meses siguientes ya no llevan WhatsApp
    expect(sim.results.some((x) => x.invoice.kind === "proration")).toBe(false);
    expect(await invoices(s.id)).toEqual([
      ["renewal", "", "2026-01-15", "2027-01-15", 27900],
      ["renewal", "interval:month", "2026-01-15", "2026-02-15", 2900],
    ]);
    const after = await store.shadowInvoices(s.id);
    expect(after.map((i) => [i.id, i.subtotalCents, i.totalCents, i.inputHash])).toEqual(before.map((i) => [i.id, i.subtotalCents, i.totalCents, i.inputHash]));
  });

  it("6) renovación anual independiente: 12 renovaciones mensuales del complemento y una sola del Core", async () => {
    const s = await create("essential", "year", ["connect-whatsapp-ai"]);
    for (let m = 0; m < 12; m++) {
      clock = month(m);
      await shadow.simulateCurrent(s.id, A);
    }
    // A mitad de año no hay «renovaciones vencidas»: los cambios siguen permitidos
    const all = await store.shadowInvoices(s.id);
    expect(all.filter((i) => i.dedupeKey === "interval:month")).toHaveLength(12);
    expect(all.filter((i) => i.dedupeKey === "")).toHaveLength(1);
    expect((await subs.detail(s.id)).events.filter((e) => e.kind === "renewed")).toHaveLength(0);
    await licensing.apply(s.id, { activate: true, actor: A });
    clock = E1;
    const r = await subs.applyRenewals(s.id, "system");
    expect(r).toMatchObject({ interval: "year", currentPeriodStart: E1, currentPeriodEnd: Date.UTC(2028, 0, 15, 10) });
    expect((await subs.detail(s.id)).events.filter((e) => e.kind === "renewed")).toHaveLength(1);
    await shadow.simulateCurrent(s.id, A);
    expect((await invoices(s.id)).slice(-2)).toEqual([
      ["renewal", "", "2027-01-15", "2028-01-15", 27900],
      ["renewal", "interval:month", "2027-01-15", "2027-02-15", 2900],
    ]);
    // Las licencias no cambian con las renovaciones
    expect((await licensing.apply(s.id, { activate: true, actor: A })).applied).toEqual([]);
  });

  it("7) vencimiento de un módulo sin cancelar el Core: caduca, se cancela al reaplicar y el Core sigue activo", async () => {
    const s = await create("essential", "year", ["connect-whatsapp-ai", "connect-people"]);
    await licensing.apply(s.id, { activate: true, actor: A });
    const wa = await itemOf(s.id, "connect-whatsapp-ai");
    await subs.removeItem(s.id, wa.id, { reason: "Fin del módulo" }, await version(s.id), A);
    // Reaplicar tras la baja fija la caducidad del módulo; el Core y People siguen sin caducidad
    const fixed = await licensing.apply(s.id, { activate: true, actor: A });
    expect(fixed.applied.map((e) => e.capabilityId)).toEqual(["whatsapp-ai"]);
    expect(await grant("whatsapp-ai")).toMatchObject({ status: "active", validUntil: month(1) });
    expect(await grant("people-hr")).toMatchObject({ status: "active", validUntil: null });
    clock = month(1) + 3_600_000;
    const access = new CapabilityAccess(caps, { enforce: true, now: () => clock });
    // Caducado y aún sin reaplicar: solo lectura
    expect(await access.check("whatsapp-ai", { write: true, tenantId: "acme" })).toMatchObject({ allowed: false, status: "expired" });
    const r = await licensing.apply(s.id, { activate: true, actor: A });
    expect(r.applied.map((e) => [e.capabilityId, e.fromStatus, e.toStatus])).toEqual([["whatsapp-ai", "active", "cancelled"]]);
    const access2 = new CapabilityAccess(caps, { enforce: true, now: () => clock });
    expect((await access2.check("whatsapp-ai", { write: false, tenantId: "acme" })).allowed).toBe(false);
    expect((await access2.check("crm-leads", { write: true, tenantId: "acme" })).allowed).toBe(true);
    expect((await access2.check("people-hr", { write: true, tenantId: "acme" })).allowed).toBe(true);
    expect(await subs.must(s.id)).toMatchObject({ status: "active", cancelAt: null, canceledAt: null });
    // En la renovación anual el módulo vencido no vuelve
    clock = E1;
    await subs.applyRenewals(s.id, "system");
    await shadow.simulateCurrent(s.id, A);
    const last = (await store.shadowInvoices(s.id)).filter((i) => i.periodStart === E1);
    expect(last.flatMap((i) => i.lines.map((l) => l.productKey)).sort()).toEqual(["connect-people", "essential"]);
  });

  it("8) paquete con componentes ya contratados: los sustituye al final de su mes, sin duplicar cobros ni licencias", async () => {
    const s = await create("essential", "year", ["connect-tax", "connect-partners"]);
    await shadow.simulateCurrent(s.id, A);
    await licensing.apply(s.id, { activate: true, actor: A });
    clock = T0 + 10 * DAY;
    const pack = { productKey: "connect-pack-finance", priceId: await priceOf("connect-pack-finance") };
    await expect(subs.addItem(s.id, { item: pack, when: "now" }, await version(s.id), A)).rejects.toThrow(/final de su periodo/);
    const added = await subs.addItem(s.id, { item: pack }, await version(s.id), A);
    expect(added.result.effectiveFrom).toBe(month(1));
    const d = await subs.detail(s.id);
    expect(d.items.filter((i) => i.productKey !== "essential").map((i) => [i.productKey, i.effectiveTo && day(i.effectiveTo)])).toEqual([
      ["connect-tax", "2026-02-15"],
      ["connect-partners", "2026-02-15"],
      ["connect-pack-finance", null],
    ]);
    // Misma regla que el cotizador (owned → replaces)
    const site = quoteCatalogFromSite(await web.site("published"));
    const q = quote(site, { plan: "essential", interval: "year", owned: ["connect-tax", "connect-partners"], items: [{ key: "connect-pack-finance" }] });
    const replaced = (d.events.find((e) => e.kind === "item_added")!.before as { replaced: Array<{ item: string }> }).replaced.map((x) => x.item);
    expect(q.lines.find((l) => l.key === "connect-pack-finance")!.replaces).toEqual(replaced);
    // Un componente no se contrata aparte mientras siga contratado ni cuando ya lo cubre el paquete
    await expect(subs.addItem(s.id, { item: { productKey: "connect-tax", priceId: await priceOf("connect-tax") } }, await version(s.id), A)).rejects.toThrow(/ya está contratado/);
    // Las licencias de los componentes no caducan: el paquete las sigue concediendo sin hueco
    expect((await licensing.preview(s.id, { activate: true })).changes).toEqual([]);
    clock = month(1) + DAY;
    await expect(subs.addItem(s.id, { item: { productKey: "connect-tax", priceId: await priceOf("connect-tax") } }, await version(s.id), A)).rejects.toThrow(/incluido en el paquete/);
    await shadow.simulateCurrent(s.id, A);
    expect((await invoices(s.id)).filter((i) => i[1] !== "")).toEqual([
      ["renewal", "interval:month", "2026-01-15", "2026-02-15", 1900 + 1900],
      ["renewal", "interval:month", "2026-02-15", "2026-03-15", 4500],
    ]);
    const r = await licensing.apply(s.id, { activate: true, actor: A });
    expect(r.applied.map((e) => [e.capabilityId, e.toStatus]).sort()).toEqual([
      ["bank-import-pos", "active"],
      ["bank-reconciliation", "active"],
    ]);
    const fin = r.desired.filter((x) => ["tax-filings", "supplier-settlements"].includes(x.capabilityId));
    expect(fin.every((x) => x.grantedBy.join() === "connect-pack-finance")).toBe(true);
    expect(new Set(r.desired.map((x) => x.capabilityId)).size).toBe(r.desired.length);
    expect((await caps.list("acme")).filter((g) => g.status !== "active")).toEqual([]);
  });

  it("lo que no está a la venta sigue sin poder contratarse", async () => {
    await expect(create("essential", "year", ["connect-reception-ai"])).rejects.toThrow(/no es contratable|aún no se puede contratar/);
  });
});
