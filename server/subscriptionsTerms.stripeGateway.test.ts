/**
 * Pasarela REAL de las condiciones personalizadas (`commercialTerms/stripeGateway.ts`) sobre el doble de Stripe (sin red
 * ni claves): precios en línea sobre los Products existentes, impuestos con Stripe Tax (sin tipo fijo por partida),
 * sin prorrateo, idempotencia y el cerrojo que impide tocar cualquier suscripción que no sea de condiciones
 * personalizadas puestas a cobrar por un operador.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { NegotiatedItem } from "./commercialTerms/billing";
import { CUSTOM_SERVICE_PRODUCT_ID, NEGOTIATED_MARK, NegotiatedGatewayError, StripeNegotiatedGateway, catalogProductsOf, expectedTaxMode } from "./commercialTerms/stripeGateway";
import type { NegotiatedItemsChange, StripeGateway } from "./stripe/gateway";
import { FakeStripeGateway } from "./stripe/testing";

const NS = "local";
let gw: FakeStripeGateway;
let allowed: Set<string>;
let customerId: string;

const LINKS = [
  { lookupKey: "es:essential:monthly:eur:v11", stripeProductId: "prod_essential", status: "active" },
  { lookupKey: "es:essential:yearly:eur:v12", stripeProductId: "prod_essential", status: "active" },
  { lookupKey: "es:hotel-net:monthly:eur:v13", stripeProductId: "prod_hotel", status: "active" },
  { lookupKey: "es:viejo:monthly:eur:v14", stripeProductId: "prod_viejo", status: "archived" },
];
const item = (key: string, amountCents: number, over: Partial<NegotiatedItem> = {}): NegotiatedItem => ({ key, name: key, product: key.startsWith("custom:") ? { kind: "custom" } : { kind: "catalog", productKey: key }, amountCents, interval: "month", taxRateBp: 2100, ...over });
const adapter = (o: { mode?: "test" | "live"; gateway?: StripeGateway; taxPolicy?: "stripe_tax_exclusive" | "test_net_no_tax" | null } = {}) =>
  new StripeNegotiatedGateway({ gateway: o.gateway ?? gw, namespace: NS, mode: o.mode ?? "test", taxPolicy: o.taxPolicy === undefined ? "test_net_no_tax" : o.taxPolicy, catalogProducts: async () => catalogProductsOf(LINKS), allowed: async (id) => allowed.has(id) });

/** Suscripción negociada tal como la deja Checkout: partidas en línea SIN metadatos propios. */
async function negotiatedSub(lines: Array<{ productId: string; unitAmount: number }>, o: { automaticTax?: boolean; metadata?: Record<string, string> } = {}) {
  const s = await gw.createNegotiatedCheckoutSession({ customerId, lines: lines.map((l) => ({ ...l, currency: "EUR", interval: "month" as const })), clientReferenceId: "es-terms-1", metadata: { [NEGOTIATED_MARK]: "1", es_terms_subscription: "1", es_env: NS, ...(o.metadata ?? {}) }, successUrl: "https://x.example/ok", cancelUrl: "https://x.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "x", notice: "x", ...(o.automaticTax ? { automaticTax: true } : {}) }, `k-${gw.sessions.size}`);
  const id = gw.completeNegotiatedSession(s.id);
  allowed.add(id);
  gw.calls.length = 0;
  return id;
}
const writes = () => gw.calls.filter((c) => c.op === "subscriptions.update(negotiated)" || c.op === "invoiceitems.create");
const total = (id: string) => gw.negotiated.get(id)!.items.reduce((a, i) => a + i.unitAmount * i.quantity, 0);

beforeEach(async () => {
  gw = new FakeStripeGateway();
  allowed = new Set();
  for (const id of ["prod_essential", "prod_hotel", "prod_viejo"]) gw.addProduct({ id, name: id });
  customerId = (await gw.createCustomer({ name: "Empresa", email: null, metadata: {} }, "k-cus")).id;
});

describe("catálogo enlazado → Product de Stripe", () => {
  it("un Product por producto, solo de los precios activos; un producto con dos Products distintos no se resuelve", () => {
    expect(Array.from(catalogProductsOf(LINKS))).toEqual([["essential", "prod_essential"], ["hotel-net", "prod_hotel"]]);
    expect(catalogProductsOf([...LINKS, { lookupKey: "es:hotel-net:yearly:eur:v15", stripeProductId: "prod_otro", status: "active" }]).has("hotel-net")).toBe(false);
    expect(expectedTaxMode("stripe_tax_exclusive")).toBe("automatic");
    expect(expectedTaxMode("test_net_no_tax")).toBe("none");
  });
});

describe("lo que Stripe tiene (`current`)", () => {
  it("partidas con su clave (metadato o Product de catálogo), importe y periodicidad; con Stripe Tax el tipo es null", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 1900 }, { productId: "prod_hotel", unitAmount: 8000 }], { automaticTax: true });
    const r = (await adapter({ mode: "live", taxPolicy: "stripe_tax_exclusive" }).current(id))!;
    expect(r.currency).toBe("EUR");
    expect(r.items).toEqual([
      { key: "essential", amountCents: 1900, interval: "month", taxRateBp: null },
      { key: "hotel-net", amountCents: 8000, interval: "month", taxRateBp: null },
    ]);
    expect(r).toMatchObject({ status: "active", cancelAtPeriodEnd: false, tax: { mode: "automatic", expected: "automatic" } });
    // Sin Stripe Tax y con la política live: el modo no es el esperado
    gw.negotiated.get(id)!.automaticTax = false;
    expect((await adapter({ mode: "live", taxPolicy: "stripe_tax_exclusive" }).current(id))!.tax).toEqual({ mode: "none", expected: "automatic" });
    // Un tipo fijo en la partida sí se informa (y entonces se compara)
    gw.negotiated.get(id)!.items[0].taxRateBp = 2100;
    expect((await adapter().current(id))!.items[0].taxRateBp).toBe(2100);
    expect((await adapter().current(id))!.tax).toEqual({ mode: "fixed", expected: "none" });
  });

  it("dos partidas sin clave sobre el mismo Product (a medida) no se adivinan: clave null", async () => {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 1900 }, { productId: CUSTOM_SERVICE_PRODUCT_ID, unitAmount: 5000 }, { productId: CUSTOM_SERVICE_PRODUCT_ID, unitAmount: 3000 }]);
    expect((await adapter().current(id))!.items.map((i) => i.key)).toEqual(["essential", null, null]);
  });
});

describe("sustitución de partidas (`applyItems`)", () => {
  it("precios en línea sobre los Products existentes, con su clave, sin tocar Prices ni Products y sin facturar nada", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }]);
    const invoices = gw.invoices.size;
    await adapter().applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 1900), item("hotel-net", 8000), item("custom:mant", 5000)], metadata: { es_terms: "7" } }, "ct:s1:items:abc:g1");
    const call = writes()[0];
    expect(call.key).toMatch(/^es-local-ct:s1:items:abc:g1:[0-9a-f]{12}$/);
    const change = call.input as NegotiatedItemsChange;
    expect(change.add.map((a) => [a.productId, a.unitAmount, a.interval, a.metadata.es_line])).toEqual([["prod_essential", 1900, "month", "essential"], ["prod_hotel", 8000, "month", "hotel-net"], [CUSTOM_SERVICE_PRODUCT_ID, 5000, "month", "custom:mant"]]);
    expect(change.remove).toHaveLength(1);
    expect(change.metadata).toMatchObject({ es_terms: "7", es_env: NS, [NEGOTIATED_MARK]: "1" });
    expect(total(id)).toBe(14900);
    expect(gw.invoices.size).toBe(invoices);
    expect(gw.prices).toEqual([]);
    // El Product genérico se creó solo porque es el entorno de pruebas
    expect(Array.from(gw.products.keys())).toEqual(["prod_essential", "prod_hotel", "prod_viejo", CUSTOM_SERVICE_PRODUCT_ID]);
  });

  it("conserva lo que ya coincide; repetir no envía nada; un reintento sobre el mismo estado repite la clave", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }]);
    const a = adapter();
    const items = [item("essential", 1900), item("hotel-net", 8000)];
    await a.applyItems({ subscriptionId: id, currency: "EUR", items, metadata: {} }, "k1");
    await a.applyItems({ subscriptionId: id, currency: "EUR", items, metadata: {} }, "k1");
    expect(writes()).toHaveLength(1);
    // Solo cambia una partida: se retira y se añade esa, la otra se conserva con su id
    const keep = gw.negotiated.get(id)!.items.find((i) => i.metadata.es_line === "essential")!.id;
    await a.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 1900), item("hotel-net", 9000)], metadata: {} }, "k2");
    const second = writes()[1].input as NegotiatedItemsChange;
    expect(second.remove).toHaveLength(1);
    expect(second.add.map((x) => x.metadata.es_line)).toEqual(["hotel-net"]);
    expect(gw.negotiated.get(id)!.items.find((i) => i.metadata.es_line === "essential")!.id).toBe(keep);
    expect(total(id)).toBe(10900);
    // Dos peticiones iguales a la vez: misma clave de Stripe, un solo efecto
    await Promise.all([a.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 2000), item("hotel-net", 9000)], metadata: {} }, "k3"), a.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 2000), item("hotel-net", 9000)], metadata: {} }, "k3")]);
    expect(new Set(writes().slice(2).map((c) => c.key)).size).toBe(1);
    expect(gw.negotiated.get(id)!.items).toHaveLength(2);
    expect(total(id)).toBe(11000);
  });

  it("rechaza sin escribir: producto sin Product enlazado, importes no válidos, otra moneda, otra periodicidad, lista vacía", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }]);
    const a = adapter();
    const call = (items: NegotiatedItem[], currency = "EUR") => a.applyItems({ subscriptionId: id, currency, items, metadata: {} }, "k");
    await expect(call([item("viejo", 100)])).rejects.toMatchObject({ code: "product_not_linked" });
    await expect(call([item("desconocido", 100)])).rejects.toMatchObject({ code: "product_not_linked" });
    await expect(call([item("essential", -1)])).rejects.toMatchObject({ code: "invalid_items" });
    await expect(call([item("essential", 10.5)])).rejects.toMatchObject({ code: "invalid_items" });
    await expect(call([item("essential", 100), item("essential", 200)])).rejects.toMatchObject({ code: "invalid_items" });
    await expect(call([item("essential", 100), item("hotel-net", 200, { interval: "year" })])).rejects.toMatchObject({ code: "invalid_items" });
    await expect(call([])).rejects.toMatchObject({ code: "invalid_items" });
    await expect(call([item("essential", 100)], "USD")).rejects.toMatchObject({ code: "invalid_items" });
    await expect(call([item("essential", 100000, { interval: "year" })])).rejects.toMatchObject({ code: "interval_change" });
    expect(writes()).toEqual([]);
    expect(total(id)).toBe(2900);
  });

  it("en live nunca crea el Product genérico: lo crea el propietario (o se indica su id)", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }], { automaticTax: true });
    const live = adapter({ mode: "live", taxPolicy: "stripe_tax_exclusive" });
    await expect(live.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 1900), item("custom:mant", 5000)], metadata: {} }, "k")).rejects.toMatchObject({ code: "custom_product_missing" });
    expect(gw.products.has(CUSTOM_SERVICE_PRODUCT_ID)).toBe(false);
    expect(writes()).toEqual([]);
    gw.addProduct({ id: "prod_del_propietario", name: "Servicios profesionales" });
    const configured = new StripeNegotiatedGateway({ gateway: gw, namespace: NS, mode: "live", taxPolicy: "stripe_tax_exclusive", customProductId: "prod_del_propietario", catalogProducts: async () => catalogProductsOf(LINKS), allowed: async (x) => allowed.has(x) });
    await configured.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 1900), item("custom:mant", 5000)], metadata: {} }, "k");
    expect(gw.negotiated.get(id)!.items.map((i) => i.productId).sort()).toEqual(["prod_del_propietario", "prod_essential"]);
    // Un Product archivado tampoco vale
    gw.addProduct({ id: "prod_archivado", name: "x", active: false });
    await expect(new StripeNegotiatedGateway({ gateway: gw, namespace: NS, mode: "live", taxPolicy: "stripe_tax_exclusive", customProductId: "prod_archivado", catalogProducts: async () => new Map(), allowed: async () => true }).customServiceProduct()).rejects.toThrow(/está archivado/);
  });
});

describe("importes únicos", () => {
  it("con signo, con su clave y encontrables después (también ya facturados y con las claves de Stripe caducadas)", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }]);
    const a = adapter();
    expect(await a.findOneOff(id, "charge:5")).toBeNull();
    const out = await a.addOneOff({ subscriptionId: id, customerId, currency: "EUR", item: { key: "charge:5", name: "Migración de datos", amountCents: 30000, taxRateBp: 2100 }, metadata: { es_terms: "7" } }, "ct:s1:charge:5");
    await a.addOneOff({ subscriptionId: id, customerId, currency: "EUR", item: { key: "credit:6", name: "Descuento de bienvenida", amountCents: -2900, taxRateBp: 2100 }, metadata: {} }, "ct:s1:credit:6");
    expect(writes().map((c) => c.key)).toEqual(["es-local-ct:s1:charge:5", "es-local-ct:s1:credit:6"]);
    expect(writes()[0].input).toMatchObject({ customerId, subscriptionId: id, amount: 30000, currency: "EUR", description: "Migración de datos", metadata: { es_key: "charge:5", es_env: NS, es_terms: "7", es_stripe_subscription: id } });
    expect(await a.findOneOff(id, "charge:5")).toEqual({ ref: out.ref, amountCents: 30000 });
    expect(await a.findOneOff(id, "credit:6")).toMatchObject({ amountCents: -2900 });
    // La misma clave no duplica; tras facturarse y caducar las claves de Stripe, se sigue encontrando
    await a.addOneOff({ subscriptionId: id, customerId, currency: "EUR", item: { key: "charge:5", name: "Migración de datos", amountCents: 30000, taxRateBp: 2100 }, metadata: { es_terms: "7" } }, "ct:s1:charge:5");
    expect(gw.invoiceItems).toHaveLength(2);
    gw.chargeNegotiatedPeriod(id);
    gw.forgetIdempotencyKeys();
    expect(await a.findOneOff(id, "charge:5")).toMatchObject({ amountCents: 30000 });
    // De otra suscripción del mismo cliente no se confunde
    const other = await negotiatedSub([{ productId: "prod_hotel", unitAmount: 8000 }]);
    expect(await a.findOneOff(other, "charge:5")).toBeNull();
    await expect(a.addOneOff({ subscriptionId: id, customerId: "cus_de_otro", currency: "EUR", item: { key: "charge:9", name: "x", amountCents: 100, taxRateBp: 0 }, metadata: {} }, "k")).rejects.toMatchObject({ code: "not_negotiated" });
    await expect(a.addOneOff({ subscriptionId: id, customerId, currency: "EUR", item: { key: "charge:9", name: "x", amountCents: 0, taxRateBp: 0 }, metadata: {} }, "k")).rejects.toMatchObject({ code: "invalid_items" });
  });
});

describe("cerrojo: solo suscripciones de condiciones personalizadas puestas a cobrar", () => {
  it("lo que no consta en el registro no llega ni a leerse en Stripe", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }]);
    allowed.clear();
    const a = adapter();
    await expect(a.current(id)).rejects.toMatchObject({ code: "not_negotiated" });
    await expect(a.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 1)], metadata: {} }, "k")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    await expect(a.addOneOff({ subscriptionId: id, customerId, currency: "EUR", item: { key: "charge:1", name: "x", amountCents: 1, taxRateBp: 0 }, metadata: {} }, "k")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    await expect(a.findOneOff(id, "charge:1")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    await expect(a.setCancelAtPeriodEnd(id, true, "k")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    expect(gw.calls).toEqual([]);
  });

  it("aun constando en el registro, una suscripción de un pedido, de un servicio externo, de otro entorno o sin la marca no se toca", async () => {
    const a = adapter();
    for (const metadata of [{ es_order_id: "7" }, { es_external_id: "3" }, { es_env: "otro" }, { [NEGOTIATED_MARK]: "0" }]) {
      const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }], { metadata });
      const before = JSON.stringify([gw.subscriptions.get(id), gw.negotiated.get(id)]);
      await expect(a.current(id)).rejects.toMatchObject({ code: "not_negotiated" });
      await expect(a.applyItems({ subscriptionId: id, currency: "EUR", items: [item("essential", 1)], metadata: {} }, "k")).rejects.toMatchObject({ code: "not_negotiated" });
      await expect(a.addOneOff({ subscriptionId: id, customerId, currency: "EUR", item: { key: "charge:1", name: "x", amountCents: 1, taxRateBp: 0 }, metadata: {} }, "k")).rejects.toMatchObject({ code: "not_negotiated" });
      await expect(a.setCancelAtPeriodEnd(id, true, "k")).rejects.toMatchObject({ code: "not_negotiated" });
      expect(JSON.stringify([gw.subscriptions.get(id), gw.negotiated.get(id)])).toBe(before);
    }
    expect(gw.negotiatedWrites()).toEqual([]);
    expect(gw.invoiceItems).toEqual([]);
    allowed.add("sub_inexistente");
    await expect(a.current("sub_inexistente")).rejects.toMatchObject({ code: "not_found" });
  });

  it("fin al final del periodo pagado: una llamada con su clave, sin factura", async () => {
    const id = await negotiatedSub([{ productId: "prod_essential", unitAmount: 2900 }]);
    const invoices = gw.invoices.size;
    await adapter().setCancelAtPeriodEnd(id, true, "ct:s1:cancel:1");
    expect(gw.subscriptions.get(id)).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
    expect((await adapter().current(id))!.cancelAtPeriodEnd).toBe(true);
    expect(gw.calls.find((c) => c.op === "subscriptions.update(cancel_at_period_end)")!.key).toBe("es-local-ct:s1:cancel:1");
    expect(gw.invoices.size).toBe(invoices);
  });

  it("sin las operaciones necesarias en el acceso a Stripe, la pasarela no se considera disponible", () => {
    expect(StripeNegotiatedGateway.supported(gw)).toBe(true);
    expect(StripeNegotiatedGateway.supported({ product: gw.product.bind(gw) } as never)).toBe(false);
  });
});
