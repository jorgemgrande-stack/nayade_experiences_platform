/**
 * Cobro en Stripe de condiciones personalizadas (fase 4), con un DOBLE de Stripe (sin red ni claves) y detrás de su
 * interruptor. Casos de aceptación 23 (renovación con precio negociado), 24 (impuestos por concepto) y 25
 * (idempotencia de cobros), más recuperación ante fallos parciales, conciliación y aislamiento.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { TermsBillingService, type BillingLink } from "./commercialTerms/billing";
import { FakeNegotiatedGateway } from "./commercialTerms/billingTesting";

const A = "operator:ana";
const T0 = Date.UTC(2026, 10, 1, 10);
const MONTH = (n: number) => Date.UTC(2026, 10 + n, 1, 10);
const crm: CrmPort = { company: async (id) => ({ id, name: `Empresa ${id}` }), contract: async () => null };

let clock: number;
let store: MemorySubscriptionStore;
let termsStore: MemoryTermsStore;
let subs: SubscriptionService;
let shadow: ShadowBillingService;
let terms: CommercialTermsService;
let gw: FakeNegotiatedGateway;
let links: Map<number, BillingLink>;
let catalog: ReturnType<typeof catalogFromWebStore>;
const P: Record<string, number> = {};

beforeEach(async () => {
  clock = T0;
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
  for (const [key, family, name, activation, amount] of [
    ["essential", "core_plan", "Essential", { kind: "plan", ref: "essential" }, 2900],
    ["hotel-net", "industry_module", "Hotel Net", { kind: "module", ref: "hotel" }, 11900],
    ["whatsapp", "extension", "Conector WhatsApp", { kind: "feature", ref: null }, 2900],
  ] as const) {
    await web.create({ kind: "product", key, family: family as never, draft: { name, technicalStatus: "available", activation, billingModel: family === "core_plan" ? "subscription" : "recurring_addon" } }, A);
    await web.publish("product", key, 1, A);
    const p = await web.addPrice(key, { kind: "monthly", amountCents: amount, taxRateBp: 2100 } as never, A);
    await web.approvePrice(p.id, A);
    P[key] = p.id;
  }
  store = new MemorySubscriptionStore();
  termsStore = new MemoryTermsStore();
  catalog = catalogFromWebStore(webStore);
  subs = new SubscriptionService({ store, catalog, crm, now: () => clock });
  terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm, now: () => clock });
  shadow = new ShadowBillingService({ store, crm, now: () => clock, settle: (id) => terms.settleDue(id) });
  gw = new FakeNegotiatedGateway();
  links = new Map();
});

const billing = (over: Partial<ConstructorParameters<typeof TermsBillingService>[0]> = {}) => new TermsBillingService({ enabled: true, gateway: gw, link: async (id) => links.get(id) ?? null, termsStore, subscriptionStore: store, now: () => clock, ...over });
const cat = (key: string, over: Partial<Extract<LineInput, { kind: "catalog" }>> = {}): LineInput => ({ kind: "catalog", productKey: key, priceId: P[key], ...over });
const custom = (name: string, unitCents: number, over: Partial<Extract<LineInput, { kind: "custom" }>> = {}): LineInput => ({ kind: "custom", concept: "maintenance", name, chargeClass: "recurring", unitCents, taxRateBp: 2100, ...over });
const PACKAGE = (over: Partial<TermsInput> = {}): TermsInput => ({ pricingMode: "global", globalAmountCents: 12900, presentation: "global", reason: "Acuerdo comercial negociado", lines: [cat("essential"), cat("hotel-net"), cat("whatsapp")], ...over });
async function agreed(companyId: number, input: TermsInput, stripe = true) {
  const sub = await subs.create({ companyId, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
  const draft = await terms.createForSubscription(sub.id, input, A);
  const out = await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: sub.version }, A);
  if (stripe) links.set(sub.id, { customerId: `cus_${companyId}`, subscriptionId: `sub_stripe_${companyId}` });
  return { subId: sub.id, termsId: out.terms.id, stripeId: `sub_stripe_${companyId}` };
}

const writes = () => gw.calls.filter((c) => c.op === "applyItems" || c.op === "addOneOff");
const stripeNet = (id: string) => gw.items.get(id)!.reduce((x, i) => x + i.amountCents, 0);
const applyNew = async (subId: number, input: TermsInput) => {
  const draft = await terms.createForSubscription(subId, input, A);
  return terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(subId)).version }, A);
};

describe("interruptores: apagado por defecto y sin efectos", () => {
  it("con el interruptor apagado no sale ninguna llamada ni cambia nada", async () => {
    const a = await agreed(1, PACKAGE());
    const out = await billing({ enabled: false }).sync(a.subId, A);
    expect(out.status).toBe("disabled");
    expect(gw.calls).toHaveLength(0);
    expect((await termsStore.get(a.termsId))!.syncStatus).toBe("none");
    expect((await termsStore.events({ termsId: a.termsId })).some((e) => e.kind === "sync")).toBe(false);
    expect(await billing({ enabled: false }).syncIfOpen(a.subId)).toBeNull();
  });

  it("encendido pero sin pasarela validada, o sin enlace con Stripe, tampoco", async () => {
    const a = await agreed(1, PACKAGE());
    expect((await billing({ gateway: null }).sync(a.subId, A)).status).toBe("unsupported");
    expect(billing({ gateway: null }).open).toBe(false);
    const simulated = await agreed(2, PACKAGE(), false);
    expect((await billing().sync(simulated.subId, A)).status).toBe("not_linked");
    expect(gw.calls).toHaveLength(0);
    // La conciliación tampoco consulta a Stripe sin los cerrojos, y da el plan de cobro
    const view = await billing({ enabled: false }).reconcile(a.subId);
    expect(view).toMatchObject({ available: false, plan: { recurringNetCents: 12900 } });
    expect(gw.calls).toHaveLength(0);
  });

  it("una suscripción sin condiciones personalizadas no se toca (nunca se envía una lista vacía)", async () => {
    const plain = await subs.create({ companyId: 3, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    links.set(plain.id, { customerId: "cus_3", subscriptionId: "sub_stripe_3" });
    expect((await billing().sync(plain.id, A)).status).toBe("nothing_to_bill");
    expect(writes()).toHaveLength(0);
  });
});

describe("el importe negociado es la fuente del cobro", () => {
  it("Caso 23 — Stripe recibe exactamente lo que factura la simulación: 129,00 € + 27,09 € = 156,09 €, también en la renovación", async () => {
    const a = await agreed(1, PACKAGE());
    const out = await billing().sync(a.subId, A);
    expect(out).toMatchObject({ status: "synced", applied: 1 });
    const items = gw.items.get(a.stripeId)!;
    expect(items.map((i) => i.key).sort()).toEqual(["essential", "hotel-net", "whatsapp"]);
    expect(stripeNet(a.stripeId)).toBe(12900);
    // Productos de catálogo con su Product existente: la pasarela no tiene ninguna operación para crear o cambiar Prices
    expect(items.every((i) => i.product.kind === "catalog" && i.interval === "month")).toBe(true);
    expect(Object.getOwnPropertyNames(FakeNegotiatedGateway.prototype).filter((m) => /price|product/i.test(m))).toEqual([]);
    for (const month of [0, 1, 2]) {
      if (month) {
        clock = MONTH(month) + 1000;
        await subs.applyRenewals(a.subId, "system:test");
        await billing().sync(a.subId, A);
      }
      const invoice = (await shadow.simulateCurrent(a.subId, "system:test")).results.find((r) => r.invoice.kind === "renewal")!.invoice;
      expect([invoice.subtotalCents - invoice.discountCents, invoice.taxCents, invoice.totalCents]).toEqual([12900, 2709, 15609]);
      expect(gw.nextInvoice(a.stripeId)).toMatchObject({ netCents: 12900, taxCents: 2709, totalCents: 15609 });
    }
    expect((await termsStore.get(a.termsId))!.syncStatus).toBe("synced");
    expect((await termsStore.events({ termsId: a.termsId })).filter((e) => e.kind === "sync")[0]).toMatchObject({ actor: A, syncResult: "synced" });
  });

  it("Caso 24 — cada concepto viaja con su tipo de impuesto; una partida a medida usa el producto genérico", async () => {
    const a = await agreed(1, { pricingMode: "per_item", presentation: "breakdown", reason: "Acuerdo con formación exenta", lines: [cat("essential"), custom("Formación bonificada", 10000, { taxRateBp: 0, concept: "professional_service" }), custom("Publicación", 3333, { taxRateBp: 400, concept: "other" })] });
    await billing().sync(a.subId, A);
    expect(gw.items.get(a.stripeId)!.map((i) => [i.name, i.product.kind, i.amountCents, i.taxRateBp])).toEqual([
      ["Essential", "catalog", 2900, 2100],
      ["Formación bonificada", "custom", 10000, 0],
      ["Publicación", "custom", 3333, 400],
    ]);
    expect(gw.nextInvoice(a.stripeId)).toEqual({ netCents: 16233, taxCents: 609 + 0 + 133, totalCents: 16233 + 742, lines: 3 });
  });

  it("Casos 9, 10 y 11 — cargos únicos y descuento de un solo uso: una vez, cuando vencen", async () => {
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" }), custom("Desarrollo a medida", 120000, { chargeClass: "extraordinary", concept: "development", startsAt: MONTH(1) })], adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }] }));
    const first = await billing().sync(a.subId, A);
    expect(first).toMatchObject({ status: "synced", applied: 3 });
    expect((first as { pendingOneOffs: string[] }).pendingOneOffs).toHaveLength(1);
    expect(gw.oneOffs.get(a.stripeId)!.map((o) => o.amountCents).sort((x, y) => x - y)).toEqual([-2900, 50000]);
    clock = MONTH(1) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    const later = await billing().sync(a.subId, A);
    expect(later).toMatchObject({ status: "synced", applied: 1, pendingOneOffs: [] });
    expect(gw.oneOffs.get(a.stripeId)!.map((o) => o.amountCents).sort((x, y) => x - y)).toEqual([-2900, 50000, 120000]);
  });

  it("un acuerdo programado para más adelante no cambia lo que Stripe cobra hoy", async () => {
    const a = await agreed(1, PACKAGE());
    await billing().sync(a.subId, A);
    clock += 86_400_000;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, effectiveFrom: MONTH(1) }));
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(stripeNet(a.stripeId)).toBe(12900);
    // Llegada la fecha, sí
    clock = MONTH(1) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(stripeNet(a.stripeId)).toBe(9900);
    expect((await shadow.simulateCurrent(a.subId, "system:test")).results.find((r) => r.invoice.kind === "renewal")!.invoice.subtotalCents).toBe(9900);
  });

  it("al terminar un tramo temporal se vuelve a la composición anterior aunque ya se hubiera enviado antes", async () => {
    const a = await agreed(1, { pricingMode: "per_item", presentation: "breakdown", reason: "Soporte reforzado un mes", lines: [cat("essential"), custom("Soporte reforzado", 5000, { startsAt: MONTH(1), endsAt: MONTH(2) })] });
    await billing().sync(a.subId, A);
    expect(stripeNet(a.stripeId)).toBe(2900);
    clock = MONTH(1) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    await billing().sync(a.subId, A);
    expect(stripeNet(a.stripeId)).toBe(7900);
    clock = MONTH(2) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(stripeNet(a.stripeId)).toBe(2900);
  });

  it("al vencer una condición temporal se cobra lo que rige después (tarifa oficial)", async () => {
    const a = await agreed(1, { pricingMode: "per_item", presentation: "breakdown", reason: "Meses de lanzamiento", lines: [cat("essential", { negotiatedUnitCents: 1000 })], effectiveTo: MONTH(2), afterEnd: "official_snapshot" });
    await billing().sync(a.subId, A);
    expect(stripeNet(a.stripeId)).toBe(1000);
    clock = MONTH(2) + 1000;
    await subs.applyRenewals(a.subId, "system:test");
    // El acuerdo ya figura vencido, pero lo que la suscripción tiene hoy se sigue cobrando bien
    expect(await billing({ settle: (id) => terms.settleDue(id) }).sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(stripeNet(a.stripeId)).toBe(2900);
    expect((await termsStore.get(a.termsId))!.status).toBe("expired");
  });
});

describe("Caso 25 — idempotencia de cobros y recuperación ante fallos", () => {
  const withCharge = () => PACKAGE({ lines: [cat("essential"), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" })] });

  it("repetir la sincronización no repite ningún cargo ni vuelve a enviar las partidas", async () => {
    const a = await agreed(1, withCharge());
    await billing().sync(a.subId, A);
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0, skipped: 2 });
    expect(writes()).toHaveLength(2);
    expect(gw.oneOffs.get(a.stripeId)).toHaveLength(1);
  });

  it("si Stripe aplicó un paso pero se perdió la respuesta, el reintento no lo duplica", async () => {
    const a = await agreed(1, withCharge());
    gw.failures = ["after"];
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "failed", completed: 0 });
    expect((await termsStore.get(a.termsId))!.syncStatus).toBe("failed");
    // Reintento: las partidas ya están en Stripe (se comprueba); ahora se pierde la respuesta del cargo
    gw.failures = ["after"];
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "failed", completed: 1, remaining: 1 });
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0, skipped: 2 });
    expect(gw.oneOffs.get(a.stripeId)).toEqual([expect.objectContaining({ amountCents: 50000 })]);
    expect(gw.items.get(a.stripeId)).toHaveLength(1);
    expect(writes()).toHaveLength(2);
    // Errores y reintentos, en el historial
    expect((await termsStore.events({ termsId: a.termsId })).filter((e) => e.kind === "sync").map((e) => e.syncResult)).toEqual(["failed", "failed", "synced"]);
    expect(((await termsStore.get(a.termsId))!.syncDetail as { attempts: number }).attempts).toBe(3);
  });

  it("un reintento tardío, cuando la clave de idempotencia de Stripe ya caducó, tampoco duplica el cargo", async () => {
    const a = await agreed(1, withCharge());
    await billing().sync(a.subId, A);
    // Se pierde el registro local de lo enviado y Stripe ya no reconoce las claves: solo queda lo que Stripe tiene
    await termsStore.patch(a.termsId, { syncDetail: null, syncStatus: "none" }, null, clock);
    gw.forgetKeys();
    clock += 3 * 86_400_000;
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0, skipped: 2 });
    expect(gw.oneOffs.get(a.stripeId)).toHaveLength(1);
    expect(writes()).toHaveLength(2);
  });

  it("un fallo antes de aplicar nada deja Stripe como estaba y el reintento lo completa", async () => {
    const a = await agreed(1, PACKAGE());
    gw.failures = ["before"];
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "failed", completed: 0 });
    expect(gw.items.has(a.stripeId)).toBe(false);
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(gw.items.get(a.stripeId)).toHaveLength(3);
  });

  it("un cargo vencido de un acuerdo ya sustituido se sigue enviando, una vez", async () => {
    const a = await agreed(1, withCharge());
    clock += 86_400_000;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, lines: [cat("essential")] }));
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 2 });
    expect(gw.oneOffs.get(a.stripeId)).toEqual([expect.objectContaining({ amountCents: 50000 })]);
    await billing().sync(a.subId, A);
    expect(gw.oneOffs.get(a.stripeId)).toHaveLength(1);
  });

  it("dos sincronizaciones a la vez no duplican efectos ni se pisan el registro", async () => {
    const a = await agreed(1, withCharge());
    const out = await Promise.all([billing().sync(a.subId, A), billing().sync(a.subId, A)]);
    expect(out.every((o) => o.status === "synced")).toBe(true);
    expect(gw.oneOffs.get(a.stripeId)).toHaveLength(1);
    expect(gw.items.get(a.stripeId)).toHaveLength(1);
    const detail = (await termsStore.get(a.termsId))!.syncDetail as { oneOffs: Record<string, string> };
    expect(Object.keys(detail.oneOffs)).toHaveLength(1);
  });
});

describe("consistencia y aislamiento", () => {
  it("la conciliación detecta importes cambiados e importes únicos que faltan; sincronizar repara la deriva", async () => {
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" })] }));
    await billing().sync(a.subId, A);
    expect(await billing().reconcile(a.subId)).toMatchObject({ available: true, consistent: true, differences: [] });
    // Alguien cambia un importe en Stripe por su cuenta y borra el cargo de implantación
    gw.items.get(a.stripeId)![0].amountCents += 100;
    gw.oneOffs.set(a.stripeId, []);
    const r = await billing().reconcile(a.subId);
    expect(r.consistent).toBe(false);
    expect(r.differences.map((d) => d.kind).sort()).toEqual(["item", "one_off"]);
    // Sincronizar repara las partidas (compara con lo que Stripe tiene de verdad, no con lo que cree haber enviado)
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(stripeNet(a.stripeId)).toBe(12900);
  });

  it("con el cobro abierto, activar unas condiciones nuevas las lleva a Stripe sin intervención", async () => {
    // Como en el plano de control: tras cada cambio de lo contratado se sincroniza si el cobro está abierto
    const svc = billing();
    const wired = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm, now: () => clock, afterChange: (sid) => svc.syncIfOpen(sid) });
    const sub = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    links.set(sub.id, { customerId: "cus_1", subscriptionId: "sub_stripe_1" });
    const d1 = await wired.createForSubscription(sub.id, PACKAGE(), A);
    await wired.activate(d1.id, { expectedRevision: d1.revision, expectedVersion: sub.version }, A);
    expect(stripeNet("sub_stripe_1")).toBe(12900);
    clock += 86_400_000;
    const d2 = await wired.createForSubscription(sub.id, PACKAGE({ globalAmountCents: 9900, lines: [cat("essential"), cat("hotel-net")] }), A);
    await wired.activate(d2.id, { expectedRevision: d2.revision, expectedVersion: (await subs.must(sub.id)).version }, A);
    expect(gw.items.get("sub_stripe_1")!.map((i) => i.key).sort()).toEqual(["essential", "hotel-net"]);
    expect(stripeNet("sub_stripe_1")).toBe(9900);
  });

  it("si cambia la suscripción de Stripe enlazada, la nueva recibe todo desde cero", async () => {
    const a = await agreed(1, PACKAGE());
    await billing().sync(a.subId, A);
    links.set(a.subId, { customerId: "cus_1", subscriptionId: "sub_stripe_nueva" });
    expect(await billing().sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(stripeNet("sub_stripe_nueva")).toBe(12900);
  });

  it("Caso 29 — cada empresa, su suscripción de Stripe: nada de una llega a la otra", async () => {
    const one = await agreed(1, PACKAGE());
    const two = await agreed(2, PACKAGE({ globalAmountCents: 5000 }));
    const asked: number[] = [];
    const svc = billing({ link: async (id) => (asked.push(id), links.get(id) ?? null) });
    await svc.sync(one.subId, A);
    // Solo se pidió el enlace de ESA suscripción y solo se escribió en SU suscripción de Stripe
    expect(asked).toEqual([one.subId]);
    expect(writes().map((c) => (c.input as { subscriptionId: string }).subscriptionId)).toEqual([one.stripeId]);
    expect(gw.items.has(two.stripeId)).toBe(false);
    await svc.sync(two.subId, A);
    expect(stripeNet(one.stripeId)).toBe(12900);
    expect(stripeNet(two.stripeId)).toBe(5000);
    expect((await termsStore.get(two.termsId))!.syncDetail).toMatchObject({ stripeSubscriptionId: two.stripeId });
  });
});
