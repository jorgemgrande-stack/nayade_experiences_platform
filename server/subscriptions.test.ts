/**
 * Suscripciones v1 y facturación en modo sombra (sin BD): instantánea contractual, operaciones,
 * concurrencia, cálculo de periodos, idempotencia y cobros SIMULADOS. Usa el catálogo comercial real
 * (WebAdminService + MemoryWebStore) a través del adaptador, no un doble.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { ShadowPaymentService, SimulatedProvider } from "./subscriptions/shadowPayments";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { addMonthsUTC, lineAmounts } from "./subscriptions/pricing";

const A = "operator:ana";
const B = "operator:bea";
const T0 = Date.UTC(2026, 0, 31, 10); // 31/01/2026: prueba el anclaje de fin de mes
const DAY = 86_400_000;

const draft = (name: string, activation: { kind: string; ref: string | null }, billingModel: string, over: Record<string, unknown> = {}) => ({
  name,
  technicalStatus: "available",
  activation,
  billingModel,
  ...over,
});

const crm: CrmPort = {
  company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : null),
  contract: async (id) =>
    id === 10
      ? { id: 10, reference: "CT-2026-000010", companyId: 1, status: "signed", amountCents: 9900, currency: "EUR", billingInterval: "month", tenantId: null }
      : id === 11
        ? { id: 11, reference: "CT-2026-000011", companyId: 1, status: "draft", amountCents: null, currency: "EUR", billingInterval: null, tenantId: null }
        : null,
};

let clock: number;
let web: WebAdminService;
let store: MemorySubscriptionStore;
let subs: SubscriptionService;
let shadow: ShadowBillingService;
const P: Record<string, number> = {};

async function product(key: string, family: string, d: Record<string, unknown>) {
  await web.create({ kind: "product", key, family: family as never, draft: d }, A);
  await web.publish("product", key, 1, A);
}
async function price(name: string, key: string, kind: "monthly" | "yearly" | "one_time" | "usage", amountCents: number, over: Record<string, unknown> = {}) {
  const p = await web.addPrice(key, { kind, amountCents, taxRateBp: 2100, ...over } as never, A);
  await web.approvePrice(p.id, A);
  P[name] = p.id;
  return p.id;
}

beforeEach(async () => {
  clock = T0;
  const webStore = new MemoryWebStore();
  web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel", "spa"], planIds: () => null }, now: () => clock });
  await product("essential", "core_plan", draft("Essential", { kind: "plan", ref: "essential" }, "subscription"));
  await product("business", "core_plan", draft("Business", { kind: "plan", ref: "business" }, "subscription"));
  await product("telefonia", "extension", draft("Telefonía IA", { kind: "feature", ref: null }, "recurring_addon"));
  await product("whatsapp", "extension", draft("WhatsApp", { kind: "feature", ref: null }, "recurring_addon", { dependencies: ["telefonia"] }));
  await product("hoteles", "industry_module", draft("Hoteles", { kind: "module", ref: "hotel" }, "recurring_addon", { compatibleWith: ["business"] }));
  await product("onboarding", "service", draft("Puesta en marcha", { kind: "service", ref: null }, "one_time"));
  await product("minutos", "usage", draft("Minutos de voz", { kind: "usage", ref: null }, "usage"));
  await price("essM", "essential", "monthly", 4900);
  await price("busM", "business", "monthly", 9900);
  await price("busY", "business", "yearly", 99000);
  await price("telM", "telefonia", "monthly", 2000);
  await price("telY", "telefonia", "yearly", 20000);
  await price("waM", "whatsapp", "monthly", 1500);
  await price("hotM", "hoteles", "monthly", 3000);
  await price("onb", "onboarding", "one_time", 50000);
  await price("min", "minutos", "usage", 5, { unit: "minuto" });
  store = new MemorySubscriptionStore();
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
  shadow = new ShadowBillingService({ store, crm, now: () => clock });
});

const base = (over: Record<string, unknown> = {}) =>
  subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "business", priceId: P.busM }, ...over } as never, A);

describe("cálculo puro", () => {
  it("anclaje a fin de mes sin deriva: 31/01 → 28/02 → 31/03", () => {
    const feb = addMonthsUTC(T0, 1, 31);
    expect(new Date(feb).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonthsUTC(feb, 1, 31)).toISOString().slice(0, 10)).toBe("2026-03-31");
  });
  it("impuesto añadido o incluido, descuento a favor del cliente y fracción redondeada hacia abajo", () => {
    expect(lineAmounts({ unitAmountCents: 9900, quantity: 1, taxRateBp: 2100, taxIncluded: false, discount: null }, 0)).toEqual({ grossCents: 9900, discountCents: 0, netCents: 9900, taxCents: 2079, totalCents: 11979 });
    expect(lineAmounts({ unitAmountCents: 12100, quantity: 1, taxRateBp: 2100, taxIncluded: true, discount: null }, 0)).toEqual({ grossCents: 12100, discountCents: 0, netCents: 10000, taxCents: 2100, totalCents: 12100 });
    expect(lineAmounts({ unitAmountCents: 999, quantity: 1, taxRateBp: 0, taxIncluded: false, discount: { kind: "percent", value: 10, endsAt: null, note: null } }, 0).discountCents).toBe(100);
    expect(lineAmounts({ unitAmountCents: 1000, quantity: 1, taxRateBp: 0, taxIncluded: false, discount: null }, 0, 1 / 3).grossCents).toBe(333);
  });
});

describe("alta y validaciones", () => {
  it("crea con referencia, instantánea del precio aceptado e historial", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM }] });
    expect(s).toMatchObject({ reference: "SUB-2026-000001", status: "active", mode: "shadow", interval: "month", anchorDay: 31, version: 1 });
    expect(new Date(s.currentPeriodEnd).toISOString().slice(0, 10)).toBe("2026-02-28");
    const d = await subs.detail(s.id);
    expect(d.items.map((i) => [i.productKey, i.unitAmountCents, i.priceId])).toEqual([
      ["business", 9900, P.busM],
      ["telefonia", 2000, P.telM],
    ]);
    expect(d.events.map((e) => e.kind)).toEqual(["created"]);
    expect(d.licencePlan).toMatchObject({ applied: false, plan: "business" });
  });

  it("rechaza: empresa inexistente, contrato no firmado, precio en borrador, tipo o moneda incorrectos, producto no publicado", async () => {
    await expect(base({ companyId: 2 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(base({ contractId: 11 })).rejects.toMatchObject({ code: "invalid_state" });
    const draftPrice = await web.addPrice("business", { kind: "monthly", amountCents: 1, taxRateBp: 2100 }, A);
    await expect(base({ plan: { productKey: "business", priceId: draftPrice.id } })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(base({ plan: { productKey: "business", priceId: P.busY } })).rejects.toThrow(/precio monthly/);
    await expect(base({ currency: "USD" })).rejects.toThrow(/EUR/);
    await expect(base({ plan: { productKey: "telefonia", priceId: P.telM } })).rejects.toThrow(/familia/);
    await web.create({ kind: "product", key: "oculto", family: "extension", draft: draft("Oculto", { kind: "feature", ref: null }, "recurring_addon") }, A);
    await expect(base({ addons: [{ productKey: "oculto", priceId: P.telM }] })).rejects.toThrow(/no está publicado/);
  });

  it("dependencias y compatibilidad del catálogo", async () => {
    await expect(base({ addons: [{ productKey: "whatsapp", priceId: P.waM }] })).rejects.toThrow(/requiere «telefonia»/);
    await expect(
      subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essM }, addons: [{ productKey: "hoteles", priceId: P.hotM }] }, A),
    ).rejects.toThrow(/no es compatible/);
  });

  it("un contrato solo puede tener una suscripción viva", async () => {
    await base();
    await expect(base()).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("instantánea contractual: el catálogo no altera contratos anteriores", () => {
  it("aprobar un precio nuevo (y retirar el viejo) no cambia las partidas ni la simulación", async () => {
    const s = await base();
    const before = await shadow.simulateCurrent(s.id, A);
    // El catálogo sube Business a 12.900 y retira el precio contratado
    await price("busM2", "business", "monthly", 12900);
    const d = await subs.detail(s.id);
    expect(d.items[0]).toMatchObject({ unitAmountCents: 9900, priceId: P.busM });
    clock = s.currentPeriodEnd;
    await subs.applyRenewals(s.id, "system");
    const next = await shadow.simulateCurrent(s.id, A);
    expect(next.results[0].invoice.subtotalCents).toBe(9900);
    expect(before.results[0].invoice.subtotalCents).toBe(9900);
    // Un alta NUEVA sí usa el precio vigente
    const s2 = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "business", priceId: P.busM2 } }, A);
    expect((await subs.detail(s2.id)).items[0].unitAmountCents).toBe(12900);
    // y el precio retirado ya no se acepta en altas nuevas
    await expect(subs.create({ companyId: 1, interval: "month", plan: { productKey: "business", priceId: P.busM } }, A)).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("concurrencia", () => {
  it("dos operadores con la misma versión: uno gana, el otro recibe conflicto y nada se pisa", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM }] });
    const r = await Promise.allSettled([
      subs.addItem(s.id, { item: { productKey: "hoteles", priceId: P.hotM } }, 1, A),
      subs.scheduleCancel(s.id, { reason: "El cliente lo pide" }, 1, B),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({ reason: { code: "version_conflict" } });
    const d = await subs.detail(s.id);
    expect(d.subscription.version).toBe(2);
    expect(d.events.map((e) => e.version)).toEqual([1, 2]);
  });
});

describe("cambios de suscripción", () => {
  it("subida de plan inmediata con prorrateo; bajada solo a fin de periodo; historial con antes y después", async () => {
    const s = await subs.create({ companyId: 1, interval: "month", plan: { productKey: "essential", priceId: P.essM } }, A);
    await shadow.simulateCurrent(s.id, A); // renovación con Essential
    clock = T0 + 14 * DAY;
    await subs.changePlan(s.id, { plan: { productKey: "business", priceId: P.busM } }, 1, A);
    const sim = await shadow.simulateCurrent(s.id, A);
    const prorr = sim.results.find((r) => r.invoice.kind === "proration")!.invoice;
    // 14 días de 28 consumidos: se cobra la mitad de Business y se descuenta la mitad de Essential
    expect(prorr.lines.map((l) => [l.productKey, l.grossCents])).toEqual([
      ["business", 4950],
      ["essential", -2450],
    ]);
    expect(prorr.subtotalCents).toBe(2500);
    await expect(subs.changePlan(s.id, { plan: { productKey: "essential", priceId: P.essM }, when: "now" }, 2, A)).rejects.toThrow(/fin de periodo/);
    const down = await subs.changePlan(s.id, { plan: { productKey: "essential", priceId: P.essM } }, 2, A);
    expect(down.result.effectiveFrom).toBe(s.currentPeriodEnd);
    const ev = (await subs.detail(s.id)).events.filter((e) => e.kind === "plan_changed");
    expect(ev.map((e) => (e.after as { direction: string }).direction)).toEqual(["up", "down"]);
    expect(ev[0].before).toMatchObject({ plan: "essential", unitAmountCents: 4900 });
  });

  it("añadir y quitar extensiones respetando dependencias; quitar es a fin de periodo y sin abonos", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM }] });
    const wa = await subs.addItem(s.id, { item: { productKey: "whatsapp", priceId: P.waM } }, 1, A);
    const tel = (await subs.detail(s.id)).items.find((i) => i.productKey === "telefonia")!;
    await expect(subs.removeItem(s.id, tel.id, {}, 2, A)).rejects.toThrow(/requiere «telefonia»/);
    const r = await subs.removeItem(s.id, wa.result.id, {}, 2, A);
    expect(r.result.effectiveTo).toBe(s.currentPeriodEnd);
    await expect(subs.addItem(s.id, { item: { productKey: "whatsapp", priceId: P.waM } }, 3, A)).rejects.toThrow(/ya está contratado/);
    const core = (await subs.detail(s.id)).items.find((i) => i.family === "core_plan")!;
    await expect(subs.removeItem(s.id, core.id, {}, 3, A)).rejects.toThrow(/no se quita/);
  });

  it("módulo sectorial (licencia simulada) y servicio de pago único", async () => {
    const s = await base();
    await subs.addItem(s.id, { item: { productKey: "hoteles", priceId: P.hotM } }, 1, A);
    await subs.addItem(s.id, { item: { productKey: "onboarding", priceId: P.onb } }, 2, A);
    const d = await subs.detail(s.id);
    expect(d.licencePlan.modules).toEqual([{ moduleId: "hotel", source: "hoteles", validUntil: s.currentPeriodEnd }]);
    const sim = await shadow.simulateCurrent(s.id, A);
    expect(sim.results.map((r) => r.invoice.kind).sort()).toEqual(["one_time", "renewal"]);
    expect(sim.results.find((r) => r.invoice.kind === "one_time")!.invoice.subtotalCents).toBe(50000);
  });

  it("cancelación programada: sin renovaciones posteriores; reactivación conserva las condiciones contratadas", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM }] });
    await expect(subs.scheduleCancel(s.id, { reason: " " }, 1, A)).rejects.toThrow(/motivo/);
    await subs.scheduleCancel(s.id, { reason: "Cierre del negocio" }, 1, A);
    clock = s.currentPeriodEnd + DAY;
    const after = await subs.applyRenewals(s.id, "system");
    expect(after).toMatchObject({ status: "canceled", canceledAt: s.currentPeriodEnd });
    expect((await shadow.simulateCurrent(s.id, A)).results).toEqual([]);
    expect((await subs.detail(s.id)).licencePlan.modules).toEqual([]);
    // Mientras tanto el catálogo cambia el precio: la reactivación mantiene el contratado
    await price("busM3", "business", "monthly", 15000);
    await subs.reactivate(s.id, { reason: "Vuelve" }, after.version, A);
    const d = await subs.detail(s.id);
    expect(d.subscription.status).toBe("active");
    const live = d.items.filter((i) => i.effectiveTo === null);
    expect(live.map((i) => [i.productKey, i.unitAmountCents])).toEqual([
      ["business", 9900],
      ["telefonia", 2000],
    ]);
  });

  it("deshacer una cancelación programada", async () => {
    const s = await base();
    await subs.scheduleCancel(s.id, { reason: "Duda" }, 1, A);
    await subs.reactivate(s.id, {}, 2, A);
    expect((await subs.must(s.id)).cancelAt).toBeNull();
  });

  it("cambio de periodicidad a la próxima renovación con precios anuales aprobados", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM }] });
    const items = (await subs.detail(s.id)).items;
    await expect(subs.changeInterval(s.id, { interval: "year", prices: [{ itemId: items[0].id, priceId: P.busY }] }, 1, A)).rejects.toThrow(/Falta el precio anual/);
    await subs.changeInterval(
      s.id,
      { interval: "year", prices: [{ itemId: items[0].id, priceId: P.busY }, { itemId: items[1].id, priceId: P.telY }] },
      1,
      A,
    );
    clock = s.currentPeriodEnd;
    const r = await subs.applyRenewals(s.id, "system");
    expect(r).toMatchObject({ interval: "year", pendingInterval: null });
    const sim = await shadow.simulateCurrent(s.id, A);
    expect(sim.results[0].invoice.subtotalCents).toBe(99000 + 20000);
  });

  it("no se modifica una suscripción con renovaciones vencidas sin aplicar", async () => {
    const s = await base();
    clock = s.currentPeriodEnd + DAY;
    await expect(subs.addItem(s.id, { item: { productKey: "telefonia", priceId: P.telM } }, 1, A)).rejects.toThrow(/renovaciones vencidas/);
  });
});

describe("facturación sombra", () => {
  it("simular dos veces el mismo periodo no duplica: misma factura, misma huella", async () => {
    const s = await base({ addons: [{ productKey: "telefonia", priceId: P.telM, discount: { kind: "percent", value: 10, endsAt: null, note: "lanzamiento" } }] });
    const a = await shadow.simulateCurrent(s.id, A);
    const b = await shadow.simulateCurrent(s.id, B);
    expect(a.results[0].created).toBe(true);
    expect(b.results[0]).toMatchObject({ created: false, drift: null });
    expect(b.results[0].invoice.id).toBe(a.results[0].invoice.id);
    const inv = a.results[0].invoice;
    expect([inv.subtotalCents, inv.discountCents, inv.taxCents, inv.totalCents]).toEqual([11900, 200, 2457, 14157]);
    // Comparación con el contrato (9.900 €/mes): diferencia de la base imponible
    expect(inv).toMatchObject({ contractAmountCents: 9900, contractDiffCents: 11700 - 9900, paymentStatus: "none" });
    expect(await store.shadowInvoices(s.id)).toHaveLength(1);
  });

  it("prueba gratuita: el periodo en prueba no se factura", async () => {
    const s = await subs.create({ companyId: 1, interval: "month", trialDays: 14, plan: { productKey: "business", priceId: P.busM } }, A);
    const sim = await shadow.simulateCurrent(s.id, A);
    // 14 de 28 días en prueba: solo la mitad
    expect(sim.results[0].invoice.subtotalCents).toBe(4950);
  });

  it("consumos: solo con el periodo cerrado y sin contar dos veces la misma lectura", async () => {
    const s = await base();
    const it = (await subs.addItem(s.id, { item: { productKey: "minutos", priceId: P.min } }, 1, A)).result;
    await subs.recordUsage(s.id, { itemId: it.id, quantity: 100, idempotencyKey: "erm:minutos:lectura-1", source: "erm" });
    const dup = await subs.recordUsage(s.id, { itemId: it.id, quantity: 100, idempotencyKey: "erm:minutos:lectura-1", source: "erm" });
    expect(dup.created).toBe(false);
    const open = await shadow.simulateCurrent(s.id, A);
    expect(open.results.some((r) => r.invoice.kind === "usage")).toBe(false);
    expect(open.pending.join()).toMatch(/no ha terminado/);
    clock = s.currentPeriodEnd;
    const closed = await shadow.simulateCurrent(s.id, A);
    expect(closed.results.find((r) => r.invoice.kind === "usage")!.invoice.subtotalCents).toBe(500);
  });
});

describe("cobros SIMULADOS (sin proveedor real)", () => {
  async function invoice() {
    const s = await base();
    const inv = (await shadow.simulateCurrent(s.id, A)).results[0].invoice;
    return { s, inv };
  }

  it("error de red tras cobrar: el reintento consulta con la MISMA clave y no hay doble cargo", async () => {
    const { inv } = await invoice();
    const provider = new SimulatedProvider().next("network_error_after");
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    const first = await pay.attempt(inv.id);
    expect(first).toMatchObject({ kind: "settled", charge: { status: "unknown", attempt: 1 } });
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("pending");
    const second = await pay.attempt(inv.id);
    expect(second).toMatchObject({ kind: "settled", charge: { status: "succeeded", attempt: 1 } });
    expect(provider.executed).toHaveLength(1);
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("paid");
    expect(await pay.attempt(inv.id)).toMatchObject({ kind: "already_paid" });
  });

  it("«processing» no es fallo ni pago; un fallo definitivo abre un intento nuevo con clave nueva", async () => {
    const { inv } = await invoice();
    const provider = new SimulatedProvider().next("processing");
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    await pay.attempt(inv.id);
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("pending");
    provider.settle("inv:" + inv.id + ":a1", "failed");
    await pay.attempt(inv.id); // consulta: fallido
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("failed");
    provider.next("succeeded");
    const retry = await pay.attempt(inv.id);
    expect(retry).toMatchObject({ charge: { attempt: 2, idempotencyKey: `inv:${inv.id}:a2`, status: "succeeded" } });
  });

  it("un pago fallido nunca cuenta como pagado", async () => {
    const { inv } = await invoice();
    const pay = new ShadowPaymentService({ store, provider: new SimulatedProvider().next("failed"), now: () => clock });
    await pay.attempt(inv.id);
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("failed");
  });

  it("dos intentos simultáneos crean un solo intento y un solo cargo", async () => {
    const { inv } = await invoice();
    const provider = new SimulatedProvider();
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    await Promise.all([pay.attempt(inv.id), pay.attempt(inv.id)]);
    expect(await store.charges(inv.id)).toHaveLength(1);
    expect(provider.executed).toHaveLength(1);
  });

  it("suscripción cancelada: no se cobra; un pago tardío por webhook queda en revisión y no la reactiva", async () => {
    const { s, inv } = await invoice();
    const provider = new SimulatedProvider().next("processing");
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    await pay.attempt(inv.id);
    await subs.scheduleCancel(s.id, { reason: "Baja" }, 1, A);
    clock = s.currentPeriodEnd;
    await subs.applyRenewals(s.id, "system");
    const r = await pay.webhook({ id: "evt_1", key: `inv:${inv.id}:a1`, status: "succeeded", ref: "sim_x" });
    expect(r.status).toBe("processed");
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("review");
    expect((await subs.must(s.id)).status).toBe("canceled");
  });

  it("webhooks: duplicado sin efecto; si el efecto falla, el evento se reprocesa", async () => {
    const { inv } = await invoice();
    const provider = new SimulatedProvider().next("processing");
    const pay = new ShadowPaymentService({ store, provider, now: () => clock });
    await pay.attempt(inv.id);
    await expect(pay.webhook({ id: "evt_bad", key: "inv:999:a1", status: "succeeded", ref: "x" })).rejects.toMatchObject({ code: "not_found" });
    const ok = await pay.webhook({ id: "evt_2", key: `inv:${inv.id}:a1`, status: "succeeded", ref: "sim_y" });
    expect(ok.status).toBe("processed");
    expect((await pay.webhook({ id: "evt_2", key: `inv:${inv.id}:a1`, status: "failed", ref: "sim_y" })).status).toBe("duplicate");
    // Un evento tardío «failed» con otro id no pisa el pago confirmado
    await pay.webhook({ id: "evt_3", key: `inv:${inv.id}:a1`, status: "failed", ref: "sim_y" });
    expect((await store.shadowInvoice(inv.id))!.paymentStatus).toBe("paid");
  });
});
