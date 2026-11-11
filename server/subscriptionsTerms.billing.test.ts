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
  const catalog = catalogFromWebStore(webStore);
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

describe("interruptores: apagado por defecto y sin efectos", () => {
  it("con el interruptor apagado no sale ninguna llamada ni cambia nada", async () => {
    const a = await agreed(1, PACKAGE());
    const out = await billing({ enabled: false }).sync(a.termsId, A);
    expect(out.status).toBe("disabled");
    expect(gw.calls).toHaveLength(0);
    expect((await termsStore.get(a.termsId))!.syncStatus).toBe("none");
    expect((await termsStore.events({ termsId: a.termsId })).some((e) => e.kind === "sync")).toBe(false);
  });

  it("encendido pero sin pasarela validada, o sin enlace con Stripe, tampoco", async () => {
    const a = await agreed(1, PACKAGE());
    expect((await billing({ gateway: null }).sync(a.termsId, A)).status).toBe("unsupported");
    const simulated = await agreed(2, PACKAGE(), false);
    expect((await billing().sync(simulated.termsId, A)).status).toBe("not_linked");
    expect(gw.calls).toHaveLength(0);
    // La conciliación tampoco consulta a Stripe sin los tres cerrojos
    expect((await billing({ enabled: false }).reconcile(a.termsId)).available).toBe(false);
    expect(gw.calls).toHaveLength(0);
  });

  it("solo se cobran unas condiciones activadas", async () => {
    const sub = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    const draft = await terms.createForSubscription(sub.id, PACKAGE(), A);
    await expect(billing().sync(draft.id, A)).rejects.toMatchObject({ code: "invalid_state" });
    expect(gw.calls).toHaveLength(0);
  });
});

describe("el importe negociado es la fuente del cobro", () => {
  it("Caso 23 — Stripe recibe exactamente lo que factura la simulación: 129,00 € + 27,09 € = 156,09 €", async () => {
    const a = await agreed(1, PACKAGE());
    const out = await billing().sync(a.termsId, A);
    expect(out).toMatchObject({ status: "synced", steps: 1, skipped: 0 });
    const items = gw.items.get(a.stripeId)!;
    expect(items.map((i) => i.key).sort()).toEqual(["essential", "hotel-net", "whatsapp"]);
    expect(items.reduce((x, i) => x + i.amountCents, 0)).toBe(12900);
    // Productos de catálogo: su Product existente; ningún Price nuevo (la pasarela ni siquiera tiene esa operación)
    expect(items.every((i) => i.product.kind === "catalog" && i.interval === "month")).toBe(true);
    expect(Object.keys(gw)).not.toContain("prices");
    const invoice = (await shadow.simulateCurrent(a.subId, "system:test")).results[0].invoice;
    expect(gw.nextInvoice(a.stripeId)).toMatchObject({ netCents: invoice.subtotalCents - invoice.discountCents, taxCents: invoice.taxCents, totalCents: invoice.totalCents });
    expect(invoice.totalCents).toBe(15609);
    const t = (await termsStore.get(a.termsId))!;
    expect(t.syncStatus).toBe("synced");
    const ev = (await termsStore.events({ termsId: a.termsId })).filter((e) => e.kind === "sync");
    expect(ev).toEqual([expect.objectContaining({ actor: A, syncResult: "synced" })]);
  });

  it("Caso 24 — cada concepto viaja con su tipo de impuesto; una partida a medida usa el producto genérico", async () => {
    const a = await agreed(1, { pricingMode: "per_item", presentation: "breakdown", reason: "Acuerdo con formación exenta", lines: [cat("essential"), custom("Formación bonificada", 10000, { taxRateBp: 0, concept: "professional_service" }), custom("Publicación", 3333, { taxRateBp: 400, concept: "other" })] });
    await billing().sync(a.termsId, A);
    const items = gw.items.get(a.stripeId)!;
    expect(items.map((i) => [i.name, i.product.kind, i.amountCents, i.taxRateBp])).toEqual([
      ["Essential", "catalog", 2900, 2100],
      ["Formación bonificada", "custom", 10000, 0],
      ["Publicación", "custom", 3333, 400],
    ]);
    expect(gw.nextInvoice(a.stripeId)).toEqual({ netCents: 16233, taxCents: 609 + 0 + 133, totalCents: 16233 + 742, lines: 3 });
  });

  it("Casos 9, 10 y 11 — cargos únicos y descuento de un solo uso: una vez, cuando vencen", async () => {
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" }), custom("Desarrollo a medida", 120000, { chargeClass: "extraordinary", concept: "development", startsAt: MONTH(1) })], adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }] }));
    const first = await billing().sync(a.termsId, A);
    // Ahora: las partidas, la implantación y el descuento; el desarrollo, en su fecha
    expect(first).toMatchObject({ status: "synced", steps: 3 });
    expect((first as { pendingOneOffs: string[] }).pendingOneOffs).toHaveLength(1);
    expect(gw.oneOffs.get(a.stripeId)!.map((o) => o.amountCents).sort((x, y) => x - y)).toEqual([-2900, 50000]);
    clock = MONTH(1) + 1000;
    const later = await billing().sync(a.termsId, A);
    expect(later).toMatchObject({ status: "synced", steps: 1, skipped: 3, pendingOneOffs: [] });
    expect(gw.oneOffs.get(a.stripeId)!.map((o) => o.amountCents).sort((x, y) => x - y)).toEqual([-2900, 50000, 120000]);
  });
});

describe("Caso 25 — idempotencia de cobros y recuperación ante fallos", () => {
  it("repetir la sincronización no repite ningún cargo", async () => {
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" })] }));
    await billing().sync(a.termsId, A);
    const again = await billing().sync(a.termsId, A);
    expect(again).toMatchObject({ status: "synced", steps: 0, skipped: 2 });
    expect(gw.calls.filter((c) => c.op !== "current")).toHaveLength(2);
    expect(gw.oneOffs.get(a.stripeId)).toHaveLength(1);
  });

  it("si Stripe aplicó el cargo pero se perdió la respuesta, el reintento no lo duplica", async () => {
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" })] }));
    // Stripe aplica las partidas y la respuesta se pierde
    gw.failures = ["after"];
    const failed = await billing().sync(a.termsId, A);
    // La primera llamada (partidas) se aplicó y perdió la respuesta: nada marcado como hecho
    expect(failed).toMatchObject({ status: "failed", completed: 0, remaining: 2 });
    expect((await termsStore.get(a.termsId))!.syncStatus).toBe("failed");
    gw.failures = ["after"];
    const retry1 = await billing().sync(a.termsId, A);
    // Reintento: las partidas responden por idempotencia (sin repetir el efecto); ahora se pierde la respuesta del cargo
    expect(retry1).toMatchObject({ status: "failed", completed: 1, remaining: 1 });
    const retry2 = await billing().sync(a.termsId, A);
    expect(retry2).toMatchObject({ status: "synced", steps: 1, skipped: 1 });
    // Un solo cargo de implantación y un solo juego de partidas, pese a tres intentos
    expect(gw.oneOffs.get(a.stripeId)).toEqual([expect.objectContaining({ amountCents: 50000 })]);
    expect(gw.items.get(a.stripeId)).toHaveLength(1);
    const t = (await termsStore.get(a.termsId))!;
    expect(t.syncStatus).toBe("synced");
    expect((t.syncDetail as { attempts: number }).attempts).toBe(3);
    // Errores y reintentos, en el historial
    expect((await termsStore.events({ termsId: a.termsId })).filter((e) => e.kind === "sync").map((e) => e.syncResult)).toEqual(["failed", "failed", "synced"]);
  });

  it("un fallo antes de aplicar nada deja el estado como estaba y el reintento lo completa", async () => {
    const a = await agreed(1, PACKAGE());
    gw.failures = ["before"];
    expect(await billing().sync(a.termsId, A)).toMatchObject({ status: "failed", completed: 0 });
    expect(gw.items.has(a.stripeId)).toBe(false);
    expect(await billing().sync(a.termsId, A)).toMatchObject({ status: "synced", steps: 1 });
    expect(gw.items.get(a.stripeId)).toHaveLength(3);
  });
});

describe("consistencia y aislamiento", () => {
  it("la conciliación detecta que Stripe no coincide con lo pactado", async () => {
    const a = await agreed(1, PACKAGE());
    await billing().sync(a.termsId, A);
    expect(await billing().reconcile(a.termsId)).toMatchObject({ available: true, consistent: true, differences: [] });
    // Alguien cambia un importe en Stripe por su cuenta
    gw.items.get(a.stripeId)![0].amountCents += 100;
    const r = await billing().reconcile(a.termsId);
    expect(r.consistent).toBe(false);
    expect(r.differences).toHaveLength(1);
  });

  it("una modificación del acuerdo sustituye las partidas de Stripe; el acuerdo sustituido ya no se cobra", async () => {
    const a = await agreed(1, PACKAGE());
    await billing().sync(a.termsId, A);
    clock += 86_400_000;
    const draft = await terms.createForSubscription(a.subId, PACKAGE({ globalAmountCents: 9900, lines: [cat("essential"), cat("hotel-net")] }), A);
    const next = await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(a.subId)).version }, A);
    await expect(billing().sync(a.termsId, A)).rejects.toMatchObject({ code: "invalid_state" });
    await billing().sync(next.terms.id, A);
    const items = gw.items.get(a.stripeId)!;
    expect(items.map((i) => i.key).sort()).toEqual(["essential", "hotel-net"]);
    expect(items.reduce((x, i) => x + i.amountCents, 0)).toBe(9900);
  });

  it("Caso 29 — cada empresa, su suscripción de Stripe: nada de una llega a la otra", async () => {
    const one = await agreed(1, PACKAGE());
    const two = await agreed(2, PACKAGE({ globalAmountCents: 5000 }));
    await billing().sync(one.termsId, A);
    expect(gw.items.has(two.stripeId)).toBe(false);
    await billing().sync(two.termsId, A);
    expect(gw.items.get(one.stripeId)!.reduce((x, i) => x + i.amountCents, 0)).toBe(12900);
    expect(gw.items.get(two.stripeId)!.reduce((x, i) => x + i.amountCents, 0)).toBe(5000);
    for (const c of gw.calls.filter((x) => x.op === "applyItems")) {
      const input = c.input as { subscriptionId: string; metadata: Record<string, string> };
      expect(input.subscriptionId).toBe(input.metadata.es_subscription === String(one.subId) ? one.stripeId : two.stripeId);
    }
  });
});
