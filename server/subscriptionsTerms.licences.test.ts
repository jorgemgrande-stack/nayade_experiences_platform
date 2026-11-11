/**
 * Licencias de una suscripción con condiciones comerciales personalizadas: aplicación automática al entrar en vigor el
 * acuerdo y al recibir la empresa su plataforma, con el servicio de licencias REAL (capacidades del catálogo de
 * Elephant Source). Casos de aceptación 27 (conservación de licencias), 28 (derechos adquiridos) y 29 (aislamiento).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { LicensingService } from "./licensing/service";
import { TPV_ACQUIRED_RIGHTS_CAPABILITY, TPV_ACQUIRED_RIGHTS_SOURCE } from "./licensing/tpvAcquiredRights";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { TermsLicences } from "./commercialTerms/licences";

const A = "operator:ana";
const T0 = Date.UTC(2026, 10, 1, 10);
const crm: CrmPort = { company: async (id) => ({ id, name: `Empresa ${id}` }), contract: async () => null };

let clock: number;
let webStore: MemoryWebStore;
let store: MemorySubscriptionStore;
let termsStore: MemoryTermsStore;
let subs: SubscriptionService;
let caps: MemoryCapabilityStore;
let licensing: LicensingService;
let tenants: Map<number, string>;
let P: Record<string, number>;

/** Como en el plano de control: tras cada cambio de lo contratado se aplican las licencias. */
function wire(auto = true) {
  const licences = new TermsLicences({ auto, licensing, subscriptions: subs, subscriptionStore: store, termsStore, companyTenant: async (id) => tenants.get(id) ?? null, now: () => clock });
  const terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog: catalogFromWebStore(webStore), crm, now: () => clock, afterChange: (sid, actor) => licences.afterChange(sid, actor) });
  return { licences, terms };
}

beforeEach(async () => {
  clock = T0;
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  P = {};
  for (const key of ["essential", "hotel-net-complete", "connect-whatsapp-ai", "connect-voice"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  store = new MemorySubscriptionStore();
  termsStore = new MemoryTermsStore();
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  caps = new MemoryCapabilityStore();
  licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock });
  tenants = new Map();
});

const cat = (key: string, over: Partial<Extract<LineInput, { kind: "catalog" }>> = {}): LineInput => ({ kind: "catalog", productKey: key, priceId: P[key], ...over });
const custom = (name: string): LineInput => ({ kind: "custom", concept: "other", name, chargeClass: "recurring", unitCents: 5000, taxRateBp: 2100 });
const PACKAGE = (over: Partial<TermsInput> = {}): TermsInput => ({ pricingMode: "global", globalAmountCents: 12900, presentation: "global", reason: "Acuerdo comercial negociado", lines: [cat("essential"), cat("hotel-net-complete"), cat("connect-whatsapp-ai")], ...over });
const granted = async (tenantId: string, subId: number) => (await caps.list(tenantId)).filter((g) => g.source === `subscription:${subId}` && g.status === "active").map((g) => g.capabilityId).sort();
const licenceEvents = async (termsId: number) => (await termsStore.events({ termsId })).filter((e) => e.kind.startsWith("licences_")).map((e) => e.kind);
/** Lo que concede la misma composición contratada a tarifa oficial, sin acuerdo. */
async function officialCapabilities(companyId: number, tenantId: string, addons: string[]) {
  const s = await subs.create({ companyId, tenantId, interval: "month", plan: { productKey: "essential", priceId: P.essential }, addons: addons.map((k) => ({ productKey: k, priceId: P[k] })) }, A);
  return (await licensing.preview(s.id, { activate: true })).changes.filter((c) => c.status === "active").map((c) => c.capabilityId).sort();
}
async function contracted(companyId: number, tenantId: string | null, input: TermsInput, w = wire()) {
  const sub = await subs.create({ companyId, tenantId, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
  const draft = await w.terms.createForSubscription(sub.id, input, A);
  const out = await w.terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: sub.version }, A);
  return { subId: sub.id, termsId: out.terms.id, ...w };
}

describe("aplicación automática al entrar en vigor el acuerdo", () => {
  it("Caso 27 — el paquete de 129 € concede exactamente las licencias de sus tres productos, sin intervención", async () => {
    const official = await officialCapabilities(9, "oficial", ["hotel-net-complete", "connect-whatsapp-ai"]);
    expect(official.length).toBeGreaterThan(0);
    const a = await contracted(1, "acme", PACKAGE());
    expect(await granted("acme", a.subId)).toEqual(official);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_applied"]);
    const ev = (await termsStore.events({ termsId: a.termsId })).find((e) => e.kind === "licences_applied")!;
    expect(ev).toMatchObject({ actor: A, syncResult: "applied", after: { tenantId: "acme", linked: false, capabilities: official } });
    // Idempotente: repetirlo no cambia nada ni añade ruido al historial
    expect(await a.licences.ensure(a.subId, A)).toMatchObject({ status: "applied", changed: 0 });
    expect(await a.licences.ensure(a.subId, A, { force: true })).toMatchObject({ status: "applied", changed: 0 });
    expect(await licenceEvents(a.termsId)).toEqual(["licences_applied"]);
  });

  it("el precio no interviene: un 100 % de descuento no quita licencias, un recargo no añade, y una partida a medida no concede nada", async () => {
    const official = await officialCapabilities(9, "oficial", ["hotel-net-complete"]);
    const a = await contracted(1, "acme", {
      pricingMode: "per_item",
      presentation: "breakdown",
      reason: "Acuerdo con descuento total",
      lines: [cat("essential", { negotiatedUnitCents: 9900 }), cat("hotel-net-complete"), custom("WhatsApp Connect (servicio a medida)"), custom("Hotel Net Premium a medida")],
      adjustments: [{ line: 1, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring" }],
    });
    // Las de Essential y Hotel Net; nada por las partidas de texto libre, aunque se llamen como un producto
    expect(await granted("acme", a.subId)).toEqual(official);
    const whatsapp = (await officialCapabilities(8, "otra", ["connect-whatsapp-ai"])).filter((c) => !official.includes(c));
    expect(whatsapp.length).toBeGreaterThan(0);
    for (const c of whatsapp) expect(await granted("acme", a.subId)).not.toContain(c);
  });

  it("Caso 28 — los derechos adquiridos y las licencias de otro origen no se tocan, tampoco al retirar un producto", async () => {
    await caps.apply("acme", [{ capabilityId: TPV_ACQUIRED_RIGHTS_CAPABILITY, siteId: "", status: "active", validUntil: null, source: TPV_ACQUIRED_RIGHTS_SOURCE }, { capabilityId: "capacidad-de-operador", siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "seed", reason: "previas", now: clock });
    const a = await contracted(1, "acme", PACKAGE());
    const before = await granted("acme", a.subId);
    clock += 86_400_000;
    // Nuevo acuerdo sin Hotel Net: se retiran SOLO las licencias de esta suscripción que ya no corresponden
    const d = await a.terms.createForSubscription(a.subId, PACKAGE({ globalAmountCents: 4900, lines: [cat("essential"), cat("connect-whatsapp-ai")] }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    const after = await granted("acme", a.subId);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every((c) => before.includes(c))).toBe(true);
    const others = (await caps.list("acme")).filter((g) => !g.source.startsWith("subscription:"));
    expect(others.map((g) => [g.capabilityId, g.status, g.source]).sort()).toEqual([
      ["capacidad-de-operador", "active", "operator"],
      [TPV_ACQUIRED_RIGHTS_CAPABILITY, "active", TPV_ACQUIRED_RIGHTS_SOURCE],
    ]);
  });
});

describe("empresa sin plataforma: pendiente, y automático al darla de alta", () => {
  it("queda pendiente (una vez en el historial) y, al recibir la empresa su plataforma, se enlaza y se aplican", async () => {
    const official = await officialCapabilities(9, "oficial", ["hotel-net-complete", "connect-whatsapp-ai"]);
    const a = await contracted(12, null, PACKAGE());
    expect(await licenceEvents(a.termsId)).toEqual(["licences_pending"]);
    expect(await a.licences.status(a.subId)).toMatchObject({ automatic: true, tenantId: null, linked: false, last: { kind: "licences_pending" }, plan: null });
    // Sin plataforma, repetirlo no añade más avisos
    await a.licences.retryIfPending(a.subId);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_pending"]);
    // Alta de la plataforma de la empresa desde el CRM
    tenants.set(12, "prueba-condiciones-129");
    const out = await a.licences.companyOnboarded(12, A);
    expect(out).toEqual([expect.objectContaining({ status: "applied", tenantId: "prueba-condiciones-129", linked: true })]);
    expect((await subs.must(a.subId)).tenantId).toBe("prueba-condiciones-129");
    expect((await store.events(a.subId)).pop()).toMatchObject({ kind: "tenant_linked", actor: A, after: { tenantId: "prueba-condiciones-129" } });
    expect(await granted("prueba-condiciones-129", a.subId)).toEqual(official);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_pending", "licences_applied"]);
    const st = await a.licences.status(a.subId);
    expect(st).toMatchObject({ tenantId: "prueba-condiciones-129", linked: true, last: { kind: "licences_applied" }, plan: { capabilities: official, pending: 0 } });
  });

  it("si nadie avisa del alta, se aplican igualmente en la siguiente ocasión (antes de calcular la facturación)", async () => {
    const a = await contracted(12, null, PACKAGE());
    tenants.set(12, "prueba-condiciones-129");
    await a.licences.retryIfPending(a.subId);
    expect((await granted("prueba-condiciones-129", a.subId)).length).toBeGreaterThan(0);
    expect((await subs.must(a.subId)).tenantId).toBe("prueba-condiciones-129");
  });

  it("Caso 29 — cada suscripción toma la plataforma de SU empresa; una suscripción nunca cambia de plataforma", async () => {
    tenants.set(1, "acme");
    const mine = await contracted(1, null, PACKAGE());
    const other = await contracted(2, null, PACKAGE({ globalAmountCents: 5000 }));
    // La empresa 1 tiene plataforma; la 2, no: sus licencias siguen pendientes y nada suyo llega a «acme»
    expect((await subs.must(mine.subId)).tenantId).toBe("acme");
    expect((await subs.must(other.subId)).tenantId).toBeNull();
    expect((await caps.list("acme")).every((g) => g.source === `subscription:${mine.subId}`)).toBe(true);
    expect(await licenceEvents(other.termsId)).toEqual(["licences_pending"]);
    await expect(subs.linkTenant(mine.subId, { tenantId: "otra" }, A)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(subs.linkTenant(mine.subId, { tenantId: "NO VÁLIDA" }, A)).rejects.toMatchObject({ code: "invalid_input" });
    // Una suscripción sin condiciones personalizadas no se toca
    const plain = await subs.create({ companyId: 3, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    tenants.set(3, "tres");
    expect(await mine.licences.companyOnboarded(3, A)).toEqual([]);
    expect((await subs.must(plain.id)).tenantId).toBeNull();
  });
});

describe("fallos, reintento e interruptor", () => {
  it("si la propagación falla queda registrado y el reintento la completa, sin duplicar nada", async () => {
    const apply = caps.apply.bind(caps);
    let broken = true;
    caps.apply = (async (...args: Parameters<typeof apply>) => {
      if (broken) throw new Error("registro de licencias no disponible");
      return apply(...args);
    }) as typeof caps.apply;
    const a = await contracted(1, "acme", PACKAGE());
    // El acuerdo queda activado igualmente: las licencias, pendientes de reintento
    expect((await termsStore.get(a.termsId))!.status).toBe("active");
    expect(await licenceEvents(a.termsId)).toEqual(["licences_failed"]);
    expect(await granted("acme", a.subId)).toEqual([]);
    broken = false;
    await a.licences.retryIfPending(a.subId);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_failed", "licences_applied"]);
    const first = await granted("acme", a.subId);
    expect(first.length).toBeGreaterThan(0);
    await a.licences.retryIfPending(a.subId);
    expect(await granted("acme", a.subId)).toEqual(first);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_failed", "licences_applied"]);
  });

  it("con la aplicación automática apagada nada se aplica solo; a mano, sí", async () => {
    const a = await contracted(1, "acme", PACKAGE(), wire(false));
    expect(await granted("acme", a.subId)).toEqual([]);
    expect(await licenceEvents(a.termsId)).toEqual([]);
    expect(await a.licences.ensure(a.subId, A)).toMatchObject({ status: "manual" });
    await a.licences.retryIfPending(a.subId);
    expect(await granted("acme", a.subId)).toEqual([]);
    const forced = await a.licences.ensure(a.subId, A, { force: true });
    expect(forced).toMatchObject({ status: "applied", tenantId: "acme" });
    expect((await granted("acme", a.subId)).length).toBeGreaterThan(0);
  });

  it("un acuerdo programado para más adelante no adelanta licencias de productos que aún no rigen", async () => {
    const a = await contracted(1, "acme", PACKAGE({ lines: [cat("essential")], globalAmountCents: 2900 }));
    const base = await granted("acme", a.subId);
    clock += 86_400_000;
    const d = await a.terms.createForSubscription(a.subId, PACKAGE({ effectiveFrom: Date.UTC(2026, 11, 1, 10) }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    expect(await granted("acme", a.subId)).toEqual(base);
    // Antes de la fecha, la siguiente ocasión no cambia nada
    await a.licences.retryIfPending(a.subId);
    expect(await granted("acme", a.subId)).toEqual(base);
    // Llegada la fecha, en la siguiente ocasión (cálculo de la facturación) entran las de Hotel Net y WhatsApp
    clock = Date.UTC(2026, 11, 1, 10) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    await a.licences.retryIfPending(a.subId);
    expect((await granted("acme", a.subId)).length).toBeGreaterThan(base.length);
  });
});
