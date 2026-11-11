/**
 * Licencias de una suscripción con condiciones comerciales personalizadas: aplicación automática al entrar en vigor el
 * acuerdo y al recibir la empresa su plataforma, con el servicio de licencias REAL (capacidades del catálogo de
 * Elephant Source). Casos de aceptación 27 (conservación de licencias), 28 (derechos adquiridos) y 29 (aislamiento).
 * Los límites y cupos (usuarios, sedes, almacenamiento) se fijan a la vez, con el almacén de límites real en memoria.
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
let limits: MemoryTenantLimitStore;
let tenants: Map<number, string>;
let P: Record<string, number>;

/** Como en el plano de control: tras cada cambio de lo contratado se aplican las licencias. */
function wire(auto = true, withLimits = true) {
  const licences = new TermsLicences({ auto, licensing, limits: withLimits ? limits : undefined, capabilities: caps, subscriptions: subs, subscriptionStore: store, termsStore, companyTenant: async (id) => tenants.get(id) ?? null, now: () => clock });
  const terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog: catalogFromWebStore(webStore), crm, now: () => clock, afterChange: (sid, actor) => licences.afterChange(sid, actor) });
  return { licences, terms };
}

beforeEach(async () => {
  clock = T0;
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  P = {};
  for (const key of ["essential", "hotel-net-complete", "connect-whatsapp-ai", "connect-voice", "addon-user-essential", "addon-storage-10gb"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  store = new MemorySubscriptionStore();
  termsStore = new MemoryTermsStore();
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  caps = new MemoryCapabilityStore();
  limits = new MemoryTenantLimitStore();
  licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock, limits });
  tenants = new Map();
});

const cat = (key: string, over: Partial<Extract<LineInput, { kind: "catalog" }>> = {}): LineInput => ({ kind: "catalog", productKey: key, priceId: P[key], ...over });
const custom = (name: string): LineInput => ({ kind: "custom", concept: "other", name, chargeClass: "recurring", unitCents: 5000, taxRateBp: 2100 });
const PACKAGE = (over: Partial<TermsInput> = {}): TermsInput => ({ pricingMode: "global", globalAmountCents: 12900, presentation: "global", reason: "Acuerdo comercial negociado", lines: [cat("essential"), cat("hotel-net-complete"), cat("connect-whatsapp-ai")], ...over });
const granted = async (tenantId: string, subId: number) => (await caps.list(tenantId)).filter((g) => g.source === `subscription:${subId}` && g.status === "active").map((g) => g.capabilityId).sort();
/** Límites vigentes de la empresa: métrica → [valor, origen]. */
const limitsOf = async (tenantId: string) => Object.fromEntries((await limits.limits(tenantId)).map((l) => [l.metric, [l.limit, l.source]]));
const values = (o: Record<string, Array<number | string | null>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v[0]]));
/** Paquete con ampliaciones: Essential + 2 usuarios adicionales + 1 bloque de 10 GB. */
const EXTENDED = (over: Partial<TermsInput> = {}): TermsInput => PACKAGE({ lines: [cat("essential"), cat("addon-user-essential", { quantity: 2 }), cat("addon-storage-10gb")], ...over });
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
    // Una capacidad que Hotel Net también concede, ya dada por un operador, y los derechos adquiridos del TPV
    const essentialOnly = await officialCapabilities(9, "oficial", []);
    const hotelCap = (await officialCapabilities(8, "otra", ["hotel-net-complete"])).find((c) => !essentialOnly.includes(c))!;
    expect(hotelCap).toBeTruthy();
    await caps.apply("acme", [{ capabilityId: TPV_ACQUIRED_RIGHTS_CAPABILITY, siteId: "", status: "active", validUntil: null, source: TPV_ACQUIRED_RIGHTS_SOURCE }, { capabilityId: hotelCap, siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "seed", reason: "previas", now: clock });
    const a = await contracted(1, "acme", PACKAGE());
    // La capacidad del operador NO cambia de dueño: queda anotada como «sin tocar»
    const ev = (await termsStore.events({ termsId: a.termsId })).find((e) => e.kind === "licences_applied")!;
    expect((ev.after as { skipped: unknown[] }).skipped).toEqual([{ capabilityId: hotelCap, why: "other_source" }]);
    const before = await granted("acme", a.subId);
    expect(before).not.toContain(hotelCap);
    clock += 86_400_000;
    // Nuevo acuerdo sin Hotel Net ni WhatsApp: se retiran SOLO las licencias de esta suscripción que ya no corresponden
    const d = await a.terms.createForSubscription(a.subId, PACKAGE({ globalAmountCents: 2900, lines: [cat("essential")] }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    const after = await granted("acme", a.subId);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every((c) => before.includes(c))).toBe(true);
    const others = (await caps.list("acme")).filter((g) => !g.source.startsWith("subscription:"));
    // Al retirar Hotel Net, la del operador sigue activa y suya; los derechos adquiridos, intactos
    expect(others.map((g) => [g.capabilityId, g.status, g.source]).sort()).toEqual(
      [
        [hotelCap, "active", "operator"],
        [TPV_ACQUIRED_RIGHTS_CAPABILITY, "active", TPV_ACQUIRED_RIGHTS_SOURCE],
      ].sort(),
    );
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

describe("aplicación restringida: nunca reactiva, nunca se apropia, nunca retroactiva", () => {
  it("una licencia suspendida o en solo lectura no se reactiva al activar otro acuerdo ni al llegar una fecha", async () => {
    const a = await contracted(1, "acme", PACKAGE());
    const mine = await granted("acme", a.subId);
    // Impago: un operador suspende una y deja otra en solo lectura (mismo origen de la suscripción)
    const source = `subscription:${a.subId}`;
    await caps.apply("acme", [{ capabilityId: mine[0], siteId: "", status: "suspended", validUntil: null, source }, { capabilityId: mine[1], siteId: "", status: "read_only", validUntil: null, source }], { actor: "operator:x", reason: "impago", now: clock });
    clock += 86_400_000;
    const d = await a.terms.createForSubscription(a.subId, PACKAGE({ globalAmountCents: 9900 }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    const state = Object.fromEntries((await caps.list("acme")).map((g) => [g.capabilityId, g.status]));
    expect(state[mine[0]]).toBe("suspended");
    expect(state[mine[1]]).toBe("read_only");
    const out = await a.licences.ensure(a.subId, A, { force: true });
    expect(out).toMatchObject({ status: "applied", changed: 0 });
    expect((out as { skipped: Array<{ why: string }> }).skipped.map((x) => x.why).sort()).toEqual(["read_only", "suspended"]);
    expect((await caps.list("acme")).find((g) => g.capabilityId === mine[0])!.status).toBe("suspended");
  });

  it("una suscripción en prueba no se toca: sus licencias las gobierna la prueba gratuita", async () => {
    const w = wire();
    const sub = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", trialDays: 15, plan: { productKey: "essential", priceId: P.essential } }, A);
    // Licencias de la prueba, con su caducidad
    await licensing.apply(sub.id, { activate: true, actor: "trial", reason: "prueba" });
    const trial = (await caps.list("acme")).map((g) => [g.capabilityId, g.status, g.validUntil]);
    const draft = await w.terms.createForSubscription(sub.id, PACKAGE(), A);
    await w.terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: sub.version }, A);
    expect((await caps.list("acme")).map((g) => [g.capabilityId, g.status, g.validUntil])).toEqual(trial);
    expect(await w.licences.ensure(sub.id, A, { force: true })).toMatchObject({ status: "manual" });
    // Tampoco sus límites: siguen los de la prueba aunque el acuerdo lleve ampliaciones
    const before = await limitsOf("acme");
    const d2 = await w.terms.createForSubscription(sub.id, EXTENDED(), A);
    await w.terms.activate(d2.id, { expectedRevision: d2.revision, expectedVersion: (await subs.must(sub.id)).version }, A);
    await w.licences.retryIfPending(sub.id);
    expect(await limitsOf("acme")).toEqual(before);
    expect(values(before)).toMatchObject({ users: 3 });
    expect(await licenceEvents(draft.id)).toEqual([]);
  });

  it("nunca retroactivo: un acuerdo activado sin esta función no recibe nada al calcular la facturación", async () => {
    // Acuerdo activado «antes»: sin gancho de licencias y, por tanto, sin eventos de licencias
    const terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
    const sub = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const draft = await terms.createForSubscription(sub.id, PACKAGE(), A);
    await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: sub.version }, A);
    const { licences } = wire();
    await licences.retryIfPending(sub.id);
    expect(await caps.list("acme")).toEqual([]);
    expect(await licenceEvents(draft.id)).toEqual([]);
    // A mano (o al dar de alta la plataforma de la empresa), sí
    expect(await licences.ensure(sub.id, A, { force: true })).toMatchObject({ status: "applied" });
    expect((await granted("acme", sub.id)).length).toBeGreaterThan(0);
  });

  it("un fallo que se repite no llena el historial, y sin capacidades aplicadas tampoco se fijan los límites", async () => {
    const apply = caps.apply.bind(caps);
    caps.apply = (async () => {
      throw new Error("registro de licencias no disponible");
    }) as typeof caps.apply;
    const a = await contracted(1, "acme", PACKAGE());
    for (let n = 0; n < 4; n++) await a.licences.retryIfPending(a.subId);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_failed"]);
    caps.apply = apply;
    expect(await limits.limits("acme")).toEqual([]);
  });
});

describe("límites y cupos: se fijan solos con el acuerdo (plan + ampliaciones)", () => {
  it("los mismos que daría «Aplicar licencias» a tarifa oficial; el precio no interviene; idempotente", async () => {
    // Referencia: la misma composición a tarifa oficial, aplicada a mano por un operador
    const ref = await subs.create({ companyId: 9, tenantId: "oficial", interval: "month", plan: { productKey: "essential", priceId: P.essential }, addons: [{ productKey: "addon-user-essential", priceId: P["addon-user-essential"], quantity: 2 }, { productKey: "addon-storage-10gb", priceId: P["addon-storage-10gb"] }] }, A);
    await licensing.apply(ref.id, { activate: true, actor: A });
    const official = values(await limitsOf("oficial"));
    expect(official).toEqual({ users: 5, sites: 1, storage_gb: 15 });
    // El acuerdo, por 49 € en total: sin ningún paso manual
    const a = await contracted(1, "acme", EXTENDED({ globalAmountCents: 4900 }));
    const mine = await limitsOf("acme");
    expect(values(mine)).toEqual(official);
    expect(Object.values(mine).every((v) => v[1] === `subscription:${a.subId}`)).toBe(true);
    const ev = (await termsStore.events({ termsId: a.termsId })).find((e) => e.kind === "licences_applied")!;
    expect((ev.after as { limits: unknown }).limits).toEqual([
      { metric: "users", to: 5 },
      { metric: "sites", to: 1 },
      { metric: "storage_gb", to: 15 },
    ]);
    // Nada pendiente para el CRM
    expect(await a.licences.status(a.subId)).toMatchObject({ plan: { pending: 0, skipped: [], limits: { contracted: [{ metric: "users", limit: 5 }, { metric: "sites", limit: 1 }, { metric: "storage_gb", limit: 15 }], pending: [], skipped: [] } } });
    // Idempotente: ni a mano ni en la siguiente ocasión cambia nada ni añade ruido
    expect(await a.licences.ensure(a.subId, A, { force: true })).toMatchObject({ status: "applied", changed: 0, limits: [], limitsSkipped: [] });
    await a.licences.retryIfPending(a.subId);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_applied"]);
    expect(await limitsOf("acme")).toEqual(mine);
    // Otra empresa no se ve afectada
    expect(await limits.limits("otra")).toEqual([]);
  });

  it("un acuerdo nuevo que retira o cambia las ampliaciones mueve los límites con él", async () => {
    const a = await contracted(1, "acme", EXTENDED());
    expect(values(await limitsOf("acme"))).toEqual({ users: 5, sites: 1, storage_gb: 15 });
    clock += 86_400_000;
    // Más usuarios, sin almacenamiento adicional
    let d = await a.terms.createForSubscription(a.subId, PACKAGE({ lines: [cat("essential"), cat("addon-user-essential", { quantity: 4 })] }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    expect(values(await limitsOf("acme"))).toEqual({ users: 7, sites: 1, storage_gb: 5 });
    clock += 86_400_000;
    // Solo el plan: lo incluido
    d = await a.terms.createForSubscription(a.subId, PACKAGE({ globalAmountCents: 2900, lines: [cat("essential")] }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    expect(values(await limitsOf("acme"))).toEqual({ users: 3, sites: 1, storage_gb: 5 });
    expect(await a.licences.status(a.subId)).toMatchObject({ plan: { pending: 0, limits: { pending: [] } } });
  });

  it("una partida a medida no amplía nada, se llame como se llame", async () => {
    await contracted(1, "acme", PACKAGE({ pricingMode: "per_item", presentation: "breakdown", globalAmountCents: undefined, lines: [cat("essential"), custom("10 usuarios adicionales (a medida)")] }));
    expect(values(await limitsOf("acme"))).toEqual({ users: 3, sites: 1, storage_gb: 5 });
  });

  it("empresa sin plataforma: los límites se fijan al darla de alta, junto con las capacidades", async () => {
    const a = await contracted(12, null, EXTENDED());
    expect(await limits.limits("prueba-condiciones-129")).toEqual([]);
    tenants.set(12, "prueba-condiciones-129");
    expect(await a.licences.companyOnboarded(12, A)).toEqual([expect.objectContaining({ status: "applied", linked: true, limits: expect.arrayContaining([{ metric: "users", from: undefined, to: 5 }]) })]);
    expect(values(await limitsOf("prueba-condiciones-129"))).toEqual({ users: 5, sites: 1, storage_gb: 15 });
  });

  it("un acuerdo programado no adelanta sus ampliaciones; llegada la fecha, entran en la siguiente ocasión", async () => {
    const a = await contracted(1, "acme", PACKAGE({ lines: [cat("essential")], globalAmountCents: 2900 }));
    clock += 86_400_000;
    const d = await a.terms.createForSubscription(a.subId, EXTENDED({ effectiveFrom: Date.UTC(2026, 11, 1, 10) }), A);
    await a.terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    await a.licences.retryIfPending(a.subId);
    expect(values(await limitsOf("acme"))).toEqual({ users: 3, sites: 1, storage_gb: 5 });
    clock = Date.UTC(2026, 11, 1, 10) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    await a.licences.retryIfPending(a.subId);
    expect(values(await limitsOf("acme"))).toEqual({ users: 5, sites: 1, storage_gb: 15 });
  });

  it("los límites de otra suscripción viva o de otro origen no se pisan; los de una suscripción cancelada se relevan", async () => {
    // Otra suscripción viva de la misma empresa ya fijó los límites (Essential + 1 usuario)
    const other = await subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: "essential", priceId: P.essential }, addons: [{ productKey: "addon-user-essential", priceId: P["addon-user-essential"], quantity: 1 }] }, A);
    await licensing.apply(other.id, { activate: true, actor: A });
    // …y el almacenamiento lo fijó otro proceso
    await limits.setLimits("acme", [{ metric: "storage_gb", limit: 50 }], { source: "operator", actor: "operator:x", now: clock });
    const before = await limitsOf("acme");
    const a = await contracted(1, "acme", EXTENDED());
    expect(await limitsOf("acme")).toEqual(before);
    const ev = (await termsStore.events({ termsId: a.termsId })).find((e) => e.kind === "licences_applied")!;
    // Sedes coincide (1): no se anota ni cambia de dueño
    expect(ev.after).toMatchObject({ limits: [], limitsSkipped: [{ metric: "users", why: "other_source" }, { metric: "storage_gb", why: "other_source" }] });
    // Para el CRM no queda nada «por aplicar»: lo que no se toca va aparte
    expect(await a.licences.status(a.subId)).toMatchObject({ plan: { pending: 0, limits: { pending: [], skipped: [{ metric: "users", why: "other_source" }, { metric: "storage_gb", why: "other_source" }] } } });
    // A mano desde las condiciones, igual de prudente
    expect(await a.licences.ensure(a.subId, A, { force: true })).toMatchObject({ status: "applied", limits: [] });
    expect(await limitsOf("acme")).toEqual(before);
    // La otra suscripción termina: en la siguiente aplicación, esta releva sus límites (no los de otro origen)
    await subs.scheduleCancel(other.id, { reason: "Baja de la suscripción antigua" }, (await subs.must(other.id)).version, A);
    clock = (await subs.must(other.id)).currentPeriodEnd + 1000;
    await subs.applyRenewals(other.id, "system:test");
    expect((await subs.must(other.id)).status).toBe("canceled");
    await subs.applyRenewals(a.subId, "system:test");
    const out = await a.licences.ensure(a.subId, A, { force: true });
    expect(out).toMatchObject({ status: "applied", limits: [{ metric: "users", from: 4, to: 5 }], limitsSkipped: [{ metric: "storage_gb", why: "other_source" }] });
    const own = `subscription:${a.subId}`;
    expect(await limitsOf("acme")).toEqual({ users: [5, own], sites: [1, own], storage_gb: [50, "operator"] });
  });

  it("con la automática apagada no se fijan solos; a mano, sí. Sin registro de límites, solo capacidades", async () => {
    const a = await contracted(1, "acme", EXTENDED(), wire(false));
    await a.licences.retryIfPending(a.subId);
    expect(await limits.limits("acme")).toEqual([]);
    expect(await a.licences.ensure(a.subId, A, { force: true })).toMatchObject({ status: "applied" });
    expect(values(await limitsOf("acme"))).toEqual({ users: 5, sites: 1, storage_gb: 15 });
    // Sin registro de límites (migración 0013 ausente): las capacidades se aplican y los límites no se tocan
    const b = await contracted(2, "beta", EXTENDED(), wire(true, false));
    expect((await granted("beta", b.subId)).length).toBeGreaterThan(0);
    expect(await limits.limits("beta")).toEqual([]);
    expect(await b.licences.status(b.subId)).toMatchObject({ plan: { pending: 0, limits: null } });
  });

  it("un acuerdo aplicado antes de que la automática fijara los límites se pone al día una sola vez", async () => {
    // Aplicado «antes»: capacidades sí, límites no (su resultado no los registra)
    const a = await contracted(1, "acme", EXTENDED(), wire(true, false));
    expect(await licenceEvents(a.termsId)).toEqual(["licences_applied"]);
    expect(await limits.limits("acme")).toEqual([]);
    const now = wire();
    expect(await now.licences.status(a.subId)).toMatchObject({ plan: { pending: 3 } });
    await now.licences.retryIfPending(a.subId);
    expect(values(await limitsOf("acme"))).toEqual({ users: 5, sites: 1, storage_gb: 15 });
    expect(await licenceEvents(a.termsId)).toEqual(["licences_applied", "licences_applied"]);
    await now.licences.retryIfPending(a.subId);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_applied", "licences_applied"]);
    expect(await now.licences.status(a.subId)).toMatchObject({ plan: { pending: 0 } });
  });

  it("si falla la escritura de los límites queda registrado y el reintento la completa", async () => {
    const set = limits.setLimits.bind(limits);
    let broken = true;
    limits.setLimits = (async (...args: Parameters<typeof set>) => {
      if (broken) throw new Error("registro de límites no disponible");
      return set(...args);
    }) as typeof limits.setLimits;
    const a = await contracted(1, "acme", EXTENDED());
    expect((await termsStore.get(a.termsId))!.status).toBe("active");
    expect(await licenceEvents(a.termsId)).toEqual(["licences_failed"]);
    // Las capacidades ya estaban aplicadas; los límites, no
    expect((await granted("acme", a.subId)).length).toBeGreaterThan(0);
    expect(await limits.limits("acme")).toEqual([]);
    broken = false;
    await a.licences.retryIfPending(a.subId);
    expect(await licenceEvents(a.termsId)).toEqual(["licences_failed", "licences_applied"]);
    expect(values(await limitsOf("acme"))).toEqual({ users: 5, sites: 1, storage_gb: 15 });
  });
});
