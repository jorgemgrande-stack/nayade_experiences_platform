/**
 * Condiciones comerciales personalizadas — servicio sobre suscripciones reales (en memoria), con la simulación de
 * facturación y el plan de licencias de verdad. Los «Caso N» son los casos de aceptación del encargo (sección 14).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService, licencePlan } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, TermsError, effectiveStatus, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";

const A = "operator:ana";
const B = "operator:berta";
const T0 = Date.UTC(2026, 10, 1, 10);
const MONTH = (n: number) => Date.UTC(2026, 10 + n, 1, 10);
const DAY = 86_400_000;

const crm: CrmPort = {
  company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : id === 2 ? { id: 2, name: "Otra" } : null),
  contract: async () => null,
};

let clock: number;
let web: WebAdminService;
let webStore: MemoryWebStore;
let store: MemorySubscriptionStore;
let termsStore: MemoryTermsStore;
let subs: SubscriptionService;
let shadow: ShadowBillingService;
let terms: CommercialTermsService;
let stripeBilled: boolean;
const P: Record<string, number> = {};

async function product(key: string, family: string, name: string, activation: { kind: string; ref: string | null }, over: Record<string, unknown> = {}) {
  await web.create({ kind: "product", key, family: family as never, draft: { name, technicalStatus: "available", activation, billingModel: family === "core_plan" ? "subscription" : "recurring_addon", ...over } }, A);
  await web.publish("product", key, 1, A);
}
async function price(name: string, key: string, kind: "monthly" | "yearly" | "one_time", amountCents: number) {
  const p = await web.addPrice(key, { kind, amountCents, taxRateBp: 2100 } as never, A);
  await web.approvePrice(p.id, A);
  P[name] = p.id;
}

beforeEach(async () => {
  clock = T0;
  stripeBilled = false;
  webStore = new MemoryWebStore();
  web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel", "restaurant"], planIds: () => null }, now: () => clock });
  await product("essential", "core_plan", "Essential", { kind: "plan", ref: "essential" });
  await product("business", "core_plan", "Business", { kind: "plan", ref: "business" });
  await product("hotel-net", "industry_module", "Hotel Net", { kind: "module", ref: "hotel" });
  await product("restaurant-net", "industry_module", "Restaurant Net", { kind: "module", ref: "restaurant" });
  await product("whatsapp", "extension", "Conector WhatsApp", { kind: "feature", ref: null });
  await product("tpv", "extension", "TPV Advanced", { kind: "feature", ref: null }, { catalog: { scope: "company" } });
  await product("proximamente", "extension", "Recepción IA", { kind: "feature", ref: null }, { catalog: { commercialStatus: "coming_soon" } });
  await product("heredado", "extension", "Módulo heredado", { kind: "feature", ref: null }, { catalog: { legacy: { replacedBy: "whatsapp", since: "2026-11-09" } } });
  await product("hoja-ruta", "extension", "En hoja de ruta", { kind: "feature", ref: null }, { technicalStatus: "planned" });
  await product("interno", "extension", "Producto interno", { kind: "feature", ref: null }, { catalog: { internalOnly: true } });
  await price("essM", "essential", "monthly", 2900);
  await price("essY", "essential", "yearly", 27900);
  await price("busM", "business", "monthly", 7900);
  await price("hotM", "hotel-net", "monthly", 11900);
  await price("resM", "restaurant-net", "monthly", 5900);
  await price("waM", "whatsapp", "monthly", 1900);
  await price("tpvM", "tpv", "monthly", 1900);
  await price("proxM", "proximamente", "monthly", 4900);
  await price("herM", "heredado", "monthly", 900);
  await price("rutaM", "hoja-ruta", "monthly", 900);
  await price("intM", "interno", "monthly", 100);
  store = new MemorySubscriptionStore();
  termsStore = new MemoryTermsStore();
  const catalog = catalogFromWebStore(webStore);
  subs = new SubscriptionService({ store, catalog, crm, now: () => clock });
  shadow = new ShadowBillingService({ store, crm, now: () => clock });
  terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm, now: () => clock, stripeBilled: async () => stripeBilled });
});

const cat = (productKey: string, priceName: string, over: Partial<Extract<LineInput, { kind: "catalog" }>> = {}): LineInput => ({ kind: "catalog", productKey, priceId: P[priceName], ...over });
const custom = (name: string, unitCents: number, over: Partial<Extract<LineInput, { kind: "custom" }>> = {}): LineInput => ({ kind: "custom", concept: "maintenance", name, chargeClass: "recurring", unitCents, taxRateBp: 2100, ...over });
const input = (lines: LineInput[], over: Partial<TermsInput> = {}): TermsInput => ({ pricingMode: "per_item", presentation: "breakdown", lines, reason: "Acuerdo comercial negociado", ...over });
const newSub = (companyId = 1, addons: string[] = []) =>
  subs.create({ companyId, interval: "month", plan: { productKey: "essential", priceId: P.essM }, addons: addons.map((k) => ({ productKey: k, priceId: P[k === "hotel-net" ? "hotM" : k === "whatsapp" ? "waM" : "herM"] })) }, A);
const version = async (id: number) => (await subs.must(id)).version;
async function apply(subId: number, i: TermsInput, actor = A) {
  const draft = await terms.createForSubscription(subId, i, actor);
  return terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: await version(subId) }, actor);
}
const live = async (subId: number, at = clock) => (await store.items(subId)).filter((i) => i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at));
const amounts = async (subId: number, at = clock) => Object.fromEntries((await live(subId, at)).filter((i) => i.priceKind !== "one_time").map((i) => [i.productName, i.lineAmountCents ?? i.unitAmountCents * i.quantity]));
/** Renueva y simula el periodo en curso; devuelve las facturas simuladas de ese periodo. */
async function billPeriod(subId: number) {
  await subs.applyRenewals(subId, "system:test");
  const out = await shadow.simulateCurrent(subId, "system:test");
  return out.results.map((r) => r.invoice);
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof TermsError) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("se esperaba un error");
};
const EXAMPLE = () => [cat("essential", "essM"), cat("hotel-net", "hotM"), cat("whatsapp", "waM"), custom("Mantenimiento personalizado", 5000)];

describe("activar un acuerdo sobre una suscripción existente", () => {
  it("Casos 5 y 16 — el ejemplo del encargo: cuota global de 129 €/mes sin crear otra suscripción", async () => {
    const sub = await newSub();
    const out = await apply(sub.id, input(EXAMPLE(), { pricingMode: "global", globalAmountCents: 12900, presentation: "global", packageName: "Paquete hotel" }));
    expect(out.subscription.id).toBe(sub.id);
    expect((await store.list({ companyId: 1 })).length).toBe(1);
    expect(out.subscription.version).toBe(sub.version + 1);
    const a = await amounts(sub.id);
    expect(Object.keys(a).sort()).toEqual(["Conector WhatsApp", "Essential", "Hotel Net", "Mantenimiento personalizado"]);
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(12900);
    // Las partidas materializadas llevan el importe ya resuelto y ningún descuento (nada se aplica dos veces)
    for (const i of await live(sub.id)) expect(i).toMatchObject({ discount: null, priceSource: "contract", termsId: out.terms.id });
    expect(out.terms).toMatchObject({ status: "active", presentation: "global", packageName: "Paquete hotel", versionNo: 1 });
    expect(out.summary.recurring).toMatchObject({ netCents: 12900, taxCents: 2709, totalCents: 15609 });
  });

  it("Caso 23 — la renovación factura el precio negociado; Caso 25 — repetir la simulación no duplica", async () => {
    const sub = await newSub();
    await apply(sub.id, input(EXAMPLE(), { pricingMode: "global", globalAmountCents: 12900, effectiveFrom: MONTH(1) }));
    clock = MONTH(1) + 1000;
    const [renewal] = await billPeriod(sub.id);
    expect(renewal).toMatchObject({ kind: "renewal", periodStart: MONTH(1), subtotalCents: 12900, discountCents: 0, taxCents: 2709, totalCents: 15609 });
    expect(renewal.lines).toHaveLength(4);
    const again = await shadow.simulateCurrent(sub.id, "system:test");
    expect(again.results.map((r) => [r.created, r.drift])).toEqual([[false, null]]);
    expect(await store.shadowInvoices(sub.id)).toHaveLength(1);
    // Y la siguiente, igual
    clock = MONTH(2) + 1000;
    expect((await billPeriod(sub.id))[0]).toMatchObject({ periodStart: MONTH(2), totalCents: 15609 });
  });

  it("Casos 17, 18 y 19 — añadir un producto, retirarlo y cambiar la cuota global, siempre en la misma suscripción", async () => {
    const sub = await newSub();
    await apply(sub.id, input([cat("essential", "essM"), cat("hotel-net", "hotM")], { pricingMode: "global", globalAmountCents: 9900 }));
    expect(await amounts(sub.id)).toEqual({ Essential: 1940, "Hotel Net": 7960 });
    clock += DAY;
    const added = await apply(sub.id, input([cat("essential", "essM"), cat("hotel-net", "hotM"), cat("whatsapp", "waM")], { pricingMode: "global", globalAmountCents: 9900 }));
    expect(Object.keys(await amounts(sub.id)).sort()).toEqual(["Conector WhatsApp", "Essential", "Hotel Net"]);
    expect(added.terms.versionNo).toBe(2);
    clock += DAY;
    await apply(sub.id, input([cat("essential", "essM"), cat("hotel-net", "hotM")], { pricingMode: "global", globalAmountCents: 8900 }));
    const a = await amounts(sub.id);
    expect(Object.keys(a).sort()).toEqual(["Essential", "Hotel Net"]);
    expect(a.Essential + a["Hotel Net"]).toBe(8900);
    expect((await store.list({ companyId: 1 })).length).toBe(1);
    // Los acuerdos anteriores quedan sustituidos, no borrados
    const all = await terms.ofSubscription(sub.id);
    expect(all.terms.map((t) => t.status)).toEqual(["superseded", "superseded", "active"]);
    expect(all.current).toBe(all.terms[2].id);
  });

  it("un cambio inmediato a mitad de periodo no cobra dos veces el resto del periodo", async () => {
    const sub = await newSub();
    await shadow.simulateCurrent(sub.id, "system:test");
    clock = T0 + 15 * DAY;
    await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 3900 }), custom("Mantenimiento", 3000)]));
    const out = await shadow.preview(sub.id);
    const proration = out.drafts.filter((d) => d.kind === "proration");
    // Essential: medio periodo a 39 € menos la parte no consumida a 29 € ya cobrada = 5 €; mantenimiento: medio periodo
    expect(proration.map((d) => d.subtotalCents).sort((x, y) => x - y)).toEqual([500, 1500]);
    // Mismo precio que antes: nada que cobrar
    clock += DAY;
    await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 3900 }), custom("Mantenimiento", 3000, { ref: (await live(sub.id)).find((i) => i.productName === "Mantenimiento")!.productKey })]));
    const again = await shadow.preview(sub.id);
    // Los tramos nuevos no añaden nada: el total del periodo sigue siendo 29 € + 5 € + 15 €
    expect(again.drafts.filter((d) => d.kind === "proration").map((d) => d.subtotalCents).sort((x, y) => x - y)).toEqual([0, 0, 500, 1500]);
  });

  it("sin efectos retroactivos: la fecha efectiva nunca es anterior a ahora", async () => {
    const sub = await newSub();
    clock = T0 + 10 * DAY;
    expect((await fails(terms.createForSubscription(sub.id, input([cat("essential", "essM")], { effectiveFrom: T0 + DAY }), A))).message).toMatch(/retroactivos/);
    // Un borrador cuya fecha se queda atrás se aplica desde el momento de activar, nunca antes
    const draft = await terms.createForSubscription(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 })], { effectiveFrom: clock + DAY }), A);
    clock += 3 * DAY;
    const out = await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: await version(sub.id) }, A);
    expect(out.effectiveFrom).toBe(clock);
    expect((await store.items(sub.id)).filter((i) => i.termsId === out.terms.id).every((i) => i.effectiveFrom >= clock)).toBe(true);
  });

  it("aplicación en la siguiente renovación o en una fecha futura: queda programado y entra solo", async () => {
    const sub = await newSub();
    const out = await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 })], { effectiveFrom: MONTH(1) }));
    expect(out.terms.status).toBe("scheduled");
    expect(await amounts(sub.id)).toEqual({ Essential: 2900 });
    clock = MONTH(1) + 1;
    expect(await amounts(sub.id)).toEqual({ Essential: 1900 });
    expect(effectiveStatus((await terms.must(out.terms.id)), clock)).toBe("active");
    expect((await billPeriod(sub.id))[0].subtotalCents).toBe(1900);
  });
});

describe("condiciones temporales", () => {
  it("Casos 13 y 15 — tres meses a 99 € y después 149 €, sin ninguna operación posterior", async () => {
    const sub = await newSub();
    const lines = () => [cat("essential", "essM"), cat("hotel-net", "hotM")];
    const second = await terms.createForSubscription(sub.id, input(lines(), { pricingMode: "global", globalAmountCents: 14900, effectiveFrom: MONTH(3) }), A);
    const first = await terms.createForSubscription(sub.id, input(lines(), { pricingMode: "global", globalAmountCents: 9900, effectiveTo: MONTH(3), afterEnd: "next_terms", nextTermsId: second.id }), A);
    await terms.activate(first.id, { expectedRevision: first.revision, expectedVersion: await version(sub.id) }, A);
    expect((await terms.must(second.id)).status).toBe("scheduled");
    const totals: number[] = [];
    for (let m = 1; m <= 4; m++) {
      clock = MONTH(m) + 1000;
      totals.push((await billPeriod(sub.id))[0].subtotalCents);
    }
    expect(totals).toEqual([9900, 9900, 14900, 14900]);
    // Solo renovaciones: ninguna modificación manual entre medias
    expect((await store.events(sub.id)).map((e) => e.kind).filter((k) => k !== "renewed")).toEqual(["created", "terms_applied"]);
  });

  it("Caso 13 — vuelta a la tarifa oficial fijada al pactar; Caso 30 — el catálogo posterior no cambia lo pactado", async () => {
    const sub = await newSub();
    await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 })], { effectiveTo: MONTH(2), afterEnd: "official_snapshot" }));
    // El catálogo sube Essential a 39 € después de pactar
    await price("essM2", "essential", "monthly", 3900);
    expect(await amounts(sub.id)).toEqual({ Essential: 1900 });
    clock = MONTH(1) + 1000;
    expect((await billPeriod(sub.id))[0].subtotalCents).toBe(1900);
    clock = MONTH(2) + 1000;
    expect((await terms.settleDue(sub.id)).settled).toBe(1);
    expect(await amounts(sub.id)).toEqual({ Essential: 2900 });
    expect((await billPeriod(sub.id))[0].subtotalCents).toBe(2900);
    expect((await terms.ofSubscription(sub.id)).terms[0].status).toBe("expired");
  });

  it("vuelta a la tarifa oficial VIGENTE en la fecha del cambio: lee el catálogo ese día y registra el importe aplicado", async () => {
    const sub = await newSub();
    const out = await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 }), custom("Soporte", 3000)], { effectiveTo: MONTH(2), afterEnd: "official_current" }));
    await price("essM2", "essential", "monthly", 3900);
    // Antes de la fecha, la partida posterior lleva (provisional) la tarifa de hoy
    expect(await amounts(sub.id, MONTH(2) + 1)).toEqual({ Essential: 2900, Soporte: 3000 });
    clock = MONTH(2) + 1000;
    expect((await terms.settleDue(sub.id)).settled).toBe(1);
    expect(await amounts(sub.id)).toEqual({ Essential: 3900, Soporte: 3000 });
    const ev = (await termsStore.events({ termsId: out.terms.id })).find((e) => e.kind === "expired")!;
    expect(ev.after).toMatchObject({ afterEnd: "official_current", applied: [{ item: "essential", provisionalCents: 2900, appliedCents: 3900 }] });
    // Idempotente
    expect((await terms.settleDue(sub.id)).settled).toBe(0);
    expect((await billPeriod(sub.id))[0].subtotalCents).toBe(6900);
  });

  it("Caso 12 — un descuento recurrente temporal deja de aplicarse solo", async () => {
    const sub = await newSub();
    await apply(sub.id, input([cat("essential", "essM")], { adjustments: [{ line: 0, type: "discount", mode: "percent", value: 5000, recurrence: "recurring", endsAt: MONTH(2) }], effectiveFrom: MONTH(1) }));
    const totals: number[] = [];
    for (let m = 1; m <= 3; m++) {
      clock = MONTH(m) + 1000;
      totals.push((await billPeriod(sub.id))[0].subtotalCents);
    }
    expect(totals).toEqual([1450, 2900, 2900]);
  });
});

describe("cuotas recurrentes y cargos únicos", () => {
  it("Caso 9 — implantación inicial una sola vez; Caso 11 — descuento de un solo uso en la primera renovación", async () => {
    const sub = await newSub();
    await apply(
      sub.id,
      input([cat("essential", "essM"), cat("hotel-net", "hotM"), custom("Implantación inicial", 50000, { chargeClass: "initial", concept: "implementation" })], {
        pricingMode: "global",
        globalAmountCents: 12900,
        effectiveFrom: MONTH(1),
        adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }],
      }),
    );
    clock = MONTH(1) + 1000;
    const first = await billPeriod(sub.id);
    const renewal = first.find((i) => i.kind === "renewal")!;
    const oneTime = first.filter((i) => i.kind === "one_time");
    // 129 € − 29 € de bienvenida; la implantación va aparte, una vez
    expect(renewal.subtotalCents - renewal.discountCents).toBe(10000);
    expect(renewal.taxCents).toBe(2100);
    expect(oneTime.map((i) => [i.subtotalCents, i.taxCents])).toEqual([[50000, 10500]]);
    clock = MONTH(2) + 1000;
    const second = await billPeriod(sub.id);
    // Renovaciones posteriores: únicamente las partidas recurrentes, sin el descuento ni la implantación
    expect(second.map((i) => [i.kind, i.subtotalCents])).toEqual([["renewal", 12900]]);
    expect((await store.shadowInvoices(sub.id)).filter((i) => i.kind === "one_time")).toHaveLength(1);
  });

  it("Caso 10 — cargo extraordinario en su fecha; una versión nueva no vuelve a cobrar lo ya facturado", async () => {
    const sub = await newSub();
    await apply(sub.id, input([cat("essential", "essM"), custom("Desarrollo a medida", 120000, { chargeClass: "extraordinary", concept: "development", startsAt: T0 + 5 * DAY })]));
    clock = T0 + 6 * DAY;
    const invoices = (await shadow.simulateCurrent(sub.id, "system:test")).results.map((r) => r.invoice);
    expect(invoices.filter((i) => i.kind === "one_time").map((i) => i.subtotalCents)).toEqual([120000]);
    // El punto de partida para modificar NO arrastra el cargo ya llegado
    const base = await terms.base(sub.id);
    expect(base.input.lines.map((l) => (l.kind === "custom" ? l.name : l.productKey))).toEqual(["essential"]);
    await apply(sub.id, { ...base.input, reason: "Subida pactada", lines: [cat("essential", "essM", { negotiatedUnitCents: 3900 })] });
    const after = (await shadow.simulateCurrent(sub.id, "system:test")).results.map((r) => r.invoice);
    expect(after.filter((i) => i.kind === "one_time")).toHaveLength(1);
  });

  it("un cargo futuro de un acuerdo sustituido antes de su fecha queda anulado, no se cobra", async () => {
    const sub = await newSub();
    await apply(sub.id, input([cat("essential", "essM"), custom("Formación", 30000, { chargeClass: "initial", concept: "professional_service", startsAt: T0 + 20 * DAY })]));
    clock = T0 + 2 * DAY;
    await apply(sub.id, input([cat("essential", "essM")]));
    clock = T0 + 25 * DAY;
    expect((await shadow.preview(sub.id)).drafts.filter((d) => d.kind === "one_time")).toHaveLength(0);
  });
});

describe("licencias: dependen de los productos, no del importe", () => {
  it("Caso 27 — un descuento no quita funciones, un recargo no las añade y una partida a medida no concede nada", async () => {
    const sub = await newSub(1, ["hotel-net"]);
    const before = licencePlan(await subs.must(sub.id), await store.items(sub.id), clock);
    expect(before).toMatchObject({ plan: "essential", modules: [expect.objectContaining({ moduleId: "hotel" })] });
    // 100 % de descuento en Hotel Net y Essential más caro, con un «Restaurant Net a medida» de texto libre
    await apply(
      sub.id,
      input([cat("essential", "essM", { negotiatedUnitCents: 9900 }), cat("hotel-net", "hotM"), custom("Restaurant Net (servicio a medida)", 5900, { concept: "other" })], {
        adjustments: [{ line: 1, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring" }],
      }),
    );
    const after = licencePlan(await subs.must(sub.id), await store.items(sub.id), clock);
    expect(after.plan).toBe("essential");
    expect(after.modules.map((m) => m.moduleId)).toEqual(["hotel"]);
    const customItem = (await live(sub.id)).find((i) => i.productName.startsWith("Restaurant Net"))!;
    expect(customItem).toMatchObject({ activationKind: "none", activationRef: null, priceId: null, family: "service" });
    expect(customItem.productKey).toMatch(/^custom-/);
    expect(await catalogFromWebStore(webStore).product(customItem.productKey)).toBeNull();
  });

  it("la vista previa dice qué licencias entran, salen y se conservan", async () => {
    const sub = await newSub(1, ["hotel-net"]);
    const draft = await terms.createForSubscription(sub.id, input([cat("business", "busM"), cat("restaurant-net", "resM"), custom("Soporte", 1000)]), A);
    const p = await terms.preview(draft.id);
    expect(p.licences).toMatchObject({ planBefore: "essential", planAfter: "business", added: ["restaurant"], removed: ["hotel"], kept: [] });
    expect(p.before).toMatchObject({ netCents: 14800 });
    expect(p.summary.recurring.netCents).toBe(14800);
    expect(p.difference.netCents).toBe(0);
    expect(p.timeZone).toBe("Europe/Madrid");
  });

  it("una partida a medida no puede llevar clave de producto, activación ni capacidad", async () => {
    const sub = await newSub();
    for (const extra of [{ productKey: "hotel-net" }, { activationRef: "hotel" }, { capabilities: ["hotel"] }, { catalog: { activationKind: "module" } }]) {
      const e = await fails(terms.createForSubscription(sub.id, input([cat("essential", "essM"), { ...custom("Hotel de regalo", 0), ...extra } as never]), A));
      expect(e.code).toBe("invalid_input");
      expect(e.message).toMatch(/no puede llevar producto, activación ni capacidades/);
    }
    // Ni hacerse pasar por un producto del catálogo con su referencia
    expect((await fails(terms.createForSubscription(sub.id, input([cat("essential", "essM"), custom("Hotel", 0, { ref: "hotel-net" })]), A))).message).toMatch(/Referencia de partida a medida/);
  });

  it("una partida de catálogo solo admite productos contratables por esa empresa", async () => {
    const sub = await newSub();
    const tryLine = (l: LineInput) => fails(terms.createForSubscription(sub.id, input([cat("essential", "essM"), l]), A));
    expect((await tryLine(cat("proximamente", "proxM"))).message).toMatch(/próximamente/);
    expect((await tryLine(cat("heredado", "herM"))).code).toBe("invalid_state");
    expect((await tryLine(cat("hoja-ruta", "rutaM"))).message).toMatch(/hoja de ruta/);
    expect((await tryLine(cat("interno", "intM"))).message).toMatch(/interno/);
    expect((await tryLine(cat("no-existe", "waM"))).message).toMatch(/no existe/);
    expect((await tryLine(cat("whatsapp", "hotM"))).message).toMatch(/no pertenece/);
    // «Bajo solicitud» sí (venta asistida): es el estado por defecto de este catálogo
    await terms.createForSubscription(sub.id, input([cat("essential", "essM"), cat("whatsapp", "waM")]), A);
    // Un producto por empresa y sin unidad de cobro, una sola vez
    expect((await tryLine(cat("tpv", "tpvM", { quantity: 2 }))).message).toMatch(/una sola vez por empresa/);
    await terms.createForSubscription(sub.id, input([cat("essential", "essM"), cat("tpv", "tpvM")]), A);
    // Sin plan Core no hay suscripción
    expect((await fails(terms.createForSubscription(sub.id, input([cat("whatsapp", "waM")]), A))).message).toMatch(/plan Core/);
  });

  it("un producto heredado se conserva si la suscripción ya lo tiene", async () => {
    const legacySub = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essM }, addons: [{ productKey: "heredado", priceId: P.herM }] }, A);
    const out = await apply(legacySub.id, input([cat("essential", "essM"), cat("heredado", "herM", { negotiatedUnitCents: 500 })]));
    expect(await amounts(legacySub.id)).toEqual({ Essential: 2900, "Módulo heredado": 500 });
    expect(out.terms.lines.map((l) => l.ref)).toEqual(["essential", "heredado"]);
  });
});

describe("permisos del flujo, concurrencia e historial", () => {
  it("Caso 26 — dos administradores a la vez: uno gana y el otro recibe un conflicto, sin estados a medias", async () => {
    const sub = await newSub();
    const a = await terms.createForSubscription(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 })]), A);
    const b = await terms.createForSubscription(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 2400 })]), B);
    const v = await version(sub.id);
    const results = await Promise.allSettled([terms.activate(a.id, { expectedRevision: a.revision, expectedVersion: v }, A), terms.activate(b.id, { expectedRevision: b.revision, expectedVersion: v }, B)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "version_conflict" });
    const a2 = await amounts(sub.id);
    expect([1900, 2400]).toContain(a2.Essential);
    expect((await live(sub.id)).filter((i) => i.priceKind === "monthly")).toHaveLength(1);
    // El perdedor sigue siendo un borrador intacto
    expect((await terms.ofSubscription(sub.id)).terms.map((t) => t.status).sort()).toEqual(["active", "draft"]);
  });

  it("dos ediciones del mismo borrador: la segunda con la revisión antigua se rechaza", async () => {
    const sub = await newSub();
    const d = await terms.createForSubscription(sub.id, input([cat("essential", "essM")]), A);
    const saved = await terms.updateDraft(d.id, input([cat("essential", "essM", { negotiatedUnitCents: 2000 })]), d.revision, A);
    expect(saved.revision).toBe(d.revision + 1);
    expect((await fails(terms.updateDraft(d.id, input([cat("essential", "essM", { negotiatedUnitCents: 100 })]), d.revision, B))).code).toBe("version_conflict");
    expect((await terms.must(d.id)).lines[0].negotiatedUnitCents).toBe(2000);
    // Activar con una revisión que ya no es la vigente tampoco
    expect((await fails(terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: await version(sub.id) }, B))).code).toBe("version_conflict");
  });

  it("motivo obligatorio e historial inmutable con quién, cuándo, antes, después y efecto económico", async () => {
    const sub = await newSub();
    expect((await fails(terms.createForSubscription(sub.id, input([cat("essential", "essM")], { reason: "  " }), A))).message).toMatch(/motivo/);
    const out = await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 })], { reason: "Fidelización tras incidencia" }));
    const h = await terms.ofSubscription(sub.id);
    expect(h.events.map((e) => e.kind)).toEqual(["draft_created", "activated"]);
    const ev = h.events[1];
    expect(ev).toMatchObject({ actor: A, reason: "Fidelización tras incidencia", companyId: 1, subscriptionId: sub.id, effectiveAt: out.effectiveFrom, acceptanceStatus: "not_required", syncResult: "not_applicable", createdAt: clock });
    expect(ev.before).toMatchObject({ recurringNetCents: 2900 });
    expect(ev.economic).toMatchObject({ recurringNetCents: 1900, difference: { netCents: -1000 } });
    // Y en el historial de la propia suscripción
    const subEvent = (await store.events(sub.id)).pop()!;
    expect(subEvent).toMatchObject({ kind: "terms_applied", actor: A, reason: "Fidelización tras incidencia" });
    // Un acuerdo activado no se reescribe
    expect((await fails(terms.updateDraft(out.terms.id, input([cat("essential", "essM")]), out.terms.revision, A))).message).toMatch(/Solo se edita un borrador/);
    expect((await fails(terms.cancelDraft(out.terms.id, { reason: "Me equivoqué" }, out.terms.revision, A))).code).toBe("invalid_state");
  });

  it("lo que exige aceptación del cliente no se activa por adelantado", async () => {
    const sub = await newSub();
    const d = await terms.createForSubscription(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 4900 })], { requiresAcceptance: true }), A);
    expect(d.acceptanceStatus).toBe("pending");
    const e = await fails(terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: await version(sub.id) }, A));
    expect(e).toMatchObject({ code: "invalid_state", details: { reason: "acceptance_required" } });
    expect(await amounts(sub.id)).toEqual({ Essential: 2900 });
  });

  it("una suscripción cobrada por Stripe no admite condiciones personalizadas (hasta habilitarlo)", async () => {
    const sub = await newSub();
    const d = await terms.createForSubscription(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 })]), A);
    stripeBilled = true;
    expect(await fails(terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: await version(sub.id) }, A))).toMatchObject({ code: "invalid_state", details: { reason: "stripe_billed" } });
    expect(await amounts(sub.id)).toEqual({ Essential: 2900 });
  });

  it("recuperación ante un fallo parcial: repetir la activación no materializa dos veces", async () => {
    const sub = await newSub();
    const d = await terms.createForSubscription(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 1900 }), custom("Soporte", 1000)]), A);
    const patch = termsStore.patch.bind(termsStore);
    let broken = true;
    termsStore.patch = async (...args: Parameters<typeof patch>) => {
      if (broken) throw new Error("corte de conexión");
      return patch(...args);
    };
    await expect(terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: await version(sub.id) }, A)).rejects.toThrow("corte de conexión");
    expect((await terms.must(d.id)).status).toBe("draft");
    broken = false;
    const out = await terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: await version(sub.id) }, A);
    expect(out.terms.status).toBe("active");
    expect((await store.items(sub.id)).filter((i) => i.termsId === d.id)).toHaveLength(2);
    expect(await amounts(sub.id)).toEqual({ Essential: 1900, Soporte: 1000 });
  });

  it("Caso 29 — aislamiento: las condiciones de una empresa no alcanzan a la suscripción de otra", async () => {
    const one = await newSub(1);
    const two = await newSub(2);
    const mine = await terms.createForSubscription(one.id, input([cat("essential", "essM")], { effectiveFrom: MONTH(2) }), A);
    // La condición «siguiente» de otra suscripción se rechaza
    const e = await fails(terms.createForSubscription(two.id, input([cat("essential", "essM", { negotiatedUnitCents: 100 })], { effectiveTo: MONTH(2), afterEnd: "next_terms", nextTermsId: mine.id }), A));
    expect(e.message).toMatch(/no pertenece a esta suscripción/);
    await apply(one.id, input([cat("essential", "essM", { negotiatedUnitCents: 100 })]));
    expect(await amounts(one.id)).toEqual({ Essential: 100 });
    expect(await amounts(two.id)).toEqual({ Essential: 2900 });
    expect((await terms.ofSubscription(two.id)).terms).toHaveLength(0);
    expect((await terms.ofCompany(2)).terms).toHaveLength(0);
    expect((await terms.ofSubscription(one.id)).events.every((ev) => ev.companyId === 1 && ev.subscriptionId === one.id)).toBe(true);
  });
});

describe("restaurar tarifas oficiales, punto de partida y paquetes", () => {
  it("restaura las tarifas oficiales vigentes; las partidas a medida conservan su precio", async () => {
    const sub = await newSub();
    await apply(sub.id, input([cat("essential", "essM", { negotiatedUnitCents: 900 }), cat("hotel-net", "hotM", { negotiatedUnitCents: 5000 }), custom("Soporte", 1500)]));
    clock += DAY;
    const out = await terms.restoreOfficial(sub.id, { reason: "Fin del acuerdo comercial", expectedVersion: await version(sub.id) }, A);
    expect(await amounts(sub.id)).toEqual({ Essential: 2900, "Hotel Net": 11900, Soporte: 1500 });
    expect(out.terms.adjustments).toHaveLength(0);
    expect((await terms.ofSubscription(sub.id)).terms.map((t) => t.status)).toEqual(["superseded", "active"]);
  });

  it("el punto de partida de una suscripción sin acuerdo recoge su precio de contrato y su descuento", async () => {
    const sub = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essM }, addons: [{ productKey: "hotel-net", priceId: P.hotM, discount: { kind: "percent", value: 10, endsAt: null, note: "alta" } }] }, A);
    const base = await terms.base(sub.id);
    expect(base).toMatchObject({ termsId: null, subscriptionVersion: 1 });
    expect(base.input.lines).toEqual([
      { kind: "catalog", productKey: "essential", priceId: P.essM, quantity: 1, negotiatedUnitCents: null },
      { kind: "catalog", productKey: "hotel-net", priceId: P.hotM, quantity: 1, negotiatedUnitCents: null },
    ]);
    expect(base.input.adjustments).toEqual([{ line: 1, type: "discount", mode: "percent", value: 1000, recurrence: "recurring", endsAt: null, note: "alta" }]);
    // Aplicarlo tal cual no cambia lo que se paga
    await apply(sub.id, { ...base.input, reason: "Paso a condiciones personalizadas" });
    expect(await amounts(sub.id)).toEqual({ Essential: 2900, "Hotel Net": 10710 });
  });

  it("criterio final — paquete personalizado para una empresa: borrador, vista previa y contratación con su suscripción", async () => {
    const draft = await terms.createPackage(
      2,
      input([cat("essential", "essM"), cat("hotel-net", "hotM"), cat("whatsapp", "waM"), custom("Mantenimiento personalizado", 5000), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" })], {
        pricingMode: "global",
        globalAmountCents: 12900,
        presentation: "global",
        packageName: "Paquete hotel a medida",
        interval: "month",
      }),
      A,
    );
    expect(draft).toMatchObject({ status: "draft", subscriptionId: null, companyId: 2 });
    const p = await terms.preview(draft.id);
    expect(p.summary.first).toMatchObject({ netCents: 62900 });
    expect(p.before).toBeNull();
    // Un paquete no se «activa»: se prepara su contratación
    expect((await fails(terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: 1 }, A))).message).toMatch(/prepara la contratación/);
    const out = await terms.prepareContracting(draft.id, { expectedRevision: draft.revision }, A);
    expect(out.subscription).toMatchObject({ companyId: 2, status: "active", interval: "month" });
    expect(out.terms).toMatchObject({ status: "active", subscriptionId: out.subscription.id });
    const invoices = (await shadow.simulateCurrent(out.subscription.id, "system:test")).results.map((r) => r.invoice);
    // Primera contratación: la cuota pactada y la implantación; la partida del alta no se factura
    expect(invoices.map((i) => [i.kind, i.subtotalCents]).sort()).toEqual([["one_time", 50000], ["renewal", 12900]]);
    expect(licencePlan(out.subscription, await store.items(out.subscription.id), clock).modules.map((m) => m.moduleId)).toEqual(["hotel"]);
  });

  it("cambio de periodicidad: solo en la próxima renovación y con los precios de referencia de esa periodicidad", async () => {
    const sub = await newSub();
    expect((await fails(terms.createForSubscription(sub.id, input([cat("essential", "essM")], { interval: "year" }), A))).message).toMatch(/precio anual/);
    const d = await terms.createForSubscription(sub.id, input([cat("essential", "essY", { negotiatedUnitCents: 24000 })], { interval: "year" }), A);
    expect((await fails(terms.activate(d.id, { expectedRevision: d.revision, expectedVersion: await version(sub.id) }, A))).message).toMatch(/próxima renovación/);
    const d2 = await terms.updateDraft(d.id, input([cat("essential", "essY", { negotiatedUnitCents: 24000 })], { interval: "year", effectiveFrom: MONTH(1) }), d.revision, A);
    await terms.activate(d2.id, { expectedRevision: d2.revision, expectedVersion: await version(sub.id) }, A);
    clock = MONTH(1) + 1000;
    const [renewal] = await billPeriod(sub.id);
    expect(renewal).toMatchObject({ subtotalCents: 24000, periodStart: MONTH(1), periodEnd: Date.UTC(2027, 11, 1, 10) });
    expect((await subs.must(sub.id)).interval).toBe("year");
  });
});
