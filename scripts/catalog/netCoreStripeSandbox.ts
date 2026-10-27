/**
 * Sondeo en el SANDBOX de Stripe de la mecánica de cobro del producto compuesto «Elephant Net completo con Elephant
 * Core incluido» (contrato v3, docs/elephant-source/CONTRATO_CATALOGO_COMERCIAL_STRIPE.md). Para la ventana de Stripe:
 * decide con datos entre la mecánica A (Price completo del plan + cupón del Core incluido) y la B (tarifa derivada,
 * p. ej. un Price de 50 €), comprobando que el importe ACEPTADO (vista previa con fecha de prorrateo fija) es el
 * COBRADO. Nunca en live: exige una clave `sk_test_` / `rk_test_`; usa relojes de prueba y objetos propios.
 *
 *   ES_SANDBOX_STRIPE_KEY=sk_test_… pnpm exec tsx scripts/catalog/netCoreStripeSandbox.ts
 *
 * Casos (importes del catálogo vigente, sin IVA): alta Ski Net + Business; prorrateo de la ampliación a mitad de
 * periodo (A y B, aceptado = cobrado con la misma fecha); renovación mensual; Business anual (480 €/año); cambio de
 * Business a Enterprise (170 €/mes); bajada a Essential (solo el Net); Net adicional (−29 €); pago rechazado y
 * reintento; actualización de precio sin tocar lo contratado; repetición idempotente de una operación.
 * Imprime una línea por caso y sale con código 1 si alguno no cuadra. No toca el código de la ventana de Stripe.
 */
import Stripe from "stripe";

const key = (process.env.ES_SANDBOX_STRIPE_KEY ?? "").trim();
if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(key)) {
  console.error("Falta ES_SANDBOX_STRIPE_KEY con una clave de PRUEBAS (sk_test_… o rk_test_…). Nunca se usa una clave live.");
  process.exit(2);
}
const sdk = new Stripe(key, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });
const NS = `netcore-${Date.now().toString(36)}`;
const EUR = "eur";
/** Tarifas del catálogo vigente (céntimos, sin IVA) */
const T = { essentialM: 2900, essentialY: 27900, businessM: 7900, businessY: 75900, enterpriseM: 19900, skiM: 9900, hotelM: 11900 };

const results: Array<{ caso: string; ok: boolean; detalle: string }> = [];
const check = (caso: string, esperado: number, obtenido: number | null | undefined, extra = "") => {
  const ok = obtenido === esperado;
  results.push({ caso, ok, detalle: `esperado ${esperado / 100} €, obtenido ${obtenido == null ? "—" : obtenido / 100} €${extra ? ` · ${extra}` : ""}` });
};

async function price(name: string, amount: number, interval: "month" | "year") {
  const product = await sdk.products.create({ name: `${NS} ${name}`, metadata: { es_probe: NS } });
  return sdk.prices.create({ product: product.id, unit_amount: amount, currency: EUR, recurring: { interval }, metadata: { es_probe: NS } });
}
async function clockAt(ms: number) {
  return sdk.testHelpers.testClocks.create({ frozen_time: Math.floor(ms / 1000), name: NS });
}
async function advance(clock: string, ms: number) {
  await sdk.testHelpers.testClocks.advance(clock, { frozen_time: Math.floor(ms / 1000) });
  for (let i = 0; i < 60; i++) {
    const c = await sdk.testHelpers.testClocks.retrieve(clock);
    if (c.status === "ready") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("el reloj de prueba no avanzó");
}
async function customer(clock: string, card = "pm_card_visa") {
  return sdk.customers.create({ test_clock: clock, payment_method: card, invoice_settings: { default_payment_method: card }, metadata: { es_probe: NS } });
}
const paid = async (invoiceId: string | null | Stripe.Invoice) => {
  const id = typeof invoiceId === "string" ? invoiceId : invoiceId?.id;
  return id ? sdk.invoices.retrieve(id) : null;
};

async function main() {
  const start = Date.UTC(2027, 0, 1, 8);
  const P = {
    essentialM: await price("Essential mensual", T.essentialM, "month"),
    businessM: await price("Business mensual", T.businessM, "month"),
    businessY: await price("Business anual", T.businessY, "year"),
    enterpriseM: await price("Enterprise mensual", T.enterpriseM, "month"),
    skiM: await price("Ski Net Complete", T.skiM, "month"),
    hotelM: await price("Hotel Net Complete", T.hotelM, "month"),
    derivedBusinessM: await price("Ampliación Business (derivada, mecánica B)", T.businessM - T.essentialM, "month"),
  };
  const coreM = await sdk.coupons.create({ amount_off: T.essentialM, currency: EUR, duration: "forever", name: "Elephant Core incluido (mensual)", metadata: { es_probe: NS } });
  const coreY = await sdk.coupons.create({ amount_off: T.essentialY, currency: EUR, duration: "forever", name: "Elephant Core incluido (anual)", metadata: { es_probe: NS } });

  // 1. Alta: Ski Net + Business (A: Price completo + cupón) = 99 + 50
  const c1 = await clockAt(start);
  const cu1 = await customer(c1.id);
  const s1 = await sdk.subscriptions.create({ customer: cu1.id, items: [{ price: P.skiM.id }, { price: P.businessM.id, discounts: [{ coupon: coreM.id }] }], expand: ["latest_invoice"] });
  check("alta Ski Net + Business (A)", T.skiM + T.businessM - T.essentialM, (s1.latest_invoice as Stripe.Invoice).amount_paid);

  // 2. Renovación mensual: mismo importe
  await advance(c1.id, start + 32 * 86_400_000);
  const inv2 = (await sdk.invoices.list({ subscription: s1.id, limit: 1 })).data[0];
  check("renovación mensual (A)", T.skiM + T.businessM - T.essentialM, inv2?.amount_paid, `factura ${inv2?.billing_reason}`);

  // 3. Prorrateo de la ampliación a mitad de periodo: aceptado (vista previa con fecha fija) = cobrado, A y B
  for (const mech of ["A", "B"] as const) {
    const ck = await clockAt(start);
    const cu = await customer(ck.id);
    const sub = await sdk.subscriptions.create({ customer: cu.id, items: [{ price: P.skiM.id }] });
    await advance(ck.id, start + 15 * 86_400_000);
    const at = Math.floor((start + 15 * 86_400_000) / 1000) + 60;
    const item = mech === "A" ? { price: P.businessM.id, discounts: [{ coupon: coreM.id }] } : { price: P.derivedBusinessM.id };
    const preview = await sdk.invoices.createPreview({ customer: cu.id, subscription: sub.id, subscription_details: { items: [item], proration_date: at, proration_behavior: "always_invoice" } });
    const upd = await sdk.subscriptions.update(sub.id, { items: [item], proration_date: at, proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete", expand: ["latest_invoice"] });
    const charged = (upd.latest_invoice as Stripe.Invoice).amount_paid;
    check(`prorrateo de la ampliación (${mech}): aceptado = cobrado`, preview.amount_due, charged);
    // Lo correcto es (79 − 29) × fracción del periodo; el cupón podría aplicarse entero (79 × f − 29)
    const ideal = Math.round((T.businessM - T.essentialM) * ((upd.items.data.find((i) => i.price.id !== P.skiM.id)?.current_period_end ?? 0) - at) / ((upd.items.data[0]?.current_period_end ?? 0) - (upd.items.data[0]?.current_period_start ?? 0)));
    results.push({ caso: `prorrateo de la ampliación (${mech}): (79 − 29) × fracción`, ok: Math.abs(charged - ideal) <= 1, detalle: `esperado ≈ ${ideal / 100} €, cobrado ${charged / 100} €` });
  }

  // 4. Business anual con Ski Net mensual (suscripción única flexible): 480 €/año + 99 €/mes
  const c4 = await clockAt(start);
  const cu4 = await customer(c4.id);
  const s4 = await sdk.subscriptions.create({ customer: cu4.id, billing_mode: { type: "flexible" }, items: [{ price: P.skiM.id }, { price: P.businessY.id, discounts: [{ coupon: coreY.id }] }], expand: ["latest_invoice"] } as Stripe.SubscriptionCreateParams);
  check("alta Ski Net + Business anual (A)", T.skiM + T.businessY - T.essentialY, (s4.latest_invoice as Stripe.Invoice).amount_paid);

  // 5. Business → Enterprise (170 €/mes): el cupón sigue en la partida del plan
  const bItem = s1.items.data.find((i) => i.price.id === P.businessM.id)!;
  const at5 = Math.floor((start + 32 * 86_400_000) / 1000) + 120;
  const pv5 = await sdk.invoices.createPreview({ customer: cu1.id, subscription: s1.id, subscription_details: { items: [{ id: bItem.id, price: P.enterpriseM.id, discounts: [{ coupon: coreM.id }] }], proration_date: at5, proration_behavior: "always_invoice" } });
  const u5 = await sdk.subscriptions.update(s1.id, { items: [{ id: bItem.id, price: P.enterpriseM.id, discounts: [{ coupon: coreM.id }] }], proration_date: at5, proration_behavior: "always_invoice", expand: ["latest_invoice"] });
  check("Business → Enterprise: aceptado = cobrado", pv5.amount_due, (u5.latest_invoice as Stripe.Invoice).amount_paid);
  await advance(c1.id, start + 63 * 86_400_000);
  const inv5 = (await sdk.invoices.list({ subscription: s1.id, limit: 1 })).data[0];
  check("renovación con Enterprise (99 + 170)", T.skiM + T.enterpriseM - T.essentialM, inv5?.amount_paid);

  // 6. Bajada a Essential incluido: se quita la partida del plan a fin de periodo; queda solo el Net
  const eItem = u5.items.data.find((i) => i.price.id === P.enterpriseM.id)!;
  await sdk.subscriptions.update(s1.id, { items: [{ id: eItem.id, deleted: true }], proration_behavior: "none" });
  await advance(c1.id, start + 94 * 86_400_000);
  const inv6 = (await sdk.invoices.list({ subscription: s1.id, limit: 1 })).data[0];
  check("bajada a Essential incluido: solo el Net", T.skiM, inv6?.amount_paid);

  // 7. Net adicional: Hotel Net con el crédito del Core ya incluido (119 − 29)
  const at7 = Math.floor((start + 94 * 86_400_000) / 1000) + 120;
  const pv7 = await sdk.invoices.createPreview({ customer: cu1.id, subscription: s1.id, subscription_details: { items: [{ price: P.hotelM.id, discounts: [{ coupon: coreM.id }] }], proration_date: at7, proration_behavior: "always_invoice" } });
  const u7 = await sdk.subscriptions.update(s1.id, { items: [{ price: P.hotelM.id, discounts: [{ coupon: coreM.id }] }], proration_date: at7, proration_behavior: "always_invoice", expand: ["latest_invoice"] });
  check("Net adicional: aceptado = cobrado", pv7.amount_due, (u7.latest_invoice as Stripe.Invoice).amount_paid);
  await advance(c1.id, start + 125 * 86_400_000);
  const inv7 = (await sdk.invoices.list({ subscription: s1.id, limit: 1 })).data[0];
  check("renovación Ski + Hotel adicional (99 + 90)", T.skiM + T.hotelM - T.essentialM, inv7?.amount_paid);

  // 8. Pago rechazado y reintento con otra tarjeta: se cobra la MISMA factura
  const c8 = await clockAt(start);
  const cu8 = await customer(c8.id);
  const s8 = await sdk.subscriptions.create({ customer: cu8.id, items: [{ price: P.skiM.id }] });
  await sdk.customers.update(cu8.id, { invoice_settings: { default_payment_method: (await sdk.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: cu8.id })).id } });
  await advance(c8.id, start + 32 * 86_400_000);
  const failed = (await sdk.invoices.list({ subscription: s8.id, limit: 1 })).data[0];
  results.push({ caso: "pago rechazado: factura abierta", ok: failed?.status === "open", detalle: `estado ${failed?.status}` });
  const good = await sdk.paymentMethods.attach("pm_card_visa", { customer: cu8.id });
  const retried = failed ? await sdk.invoices.pay(failed.id, { payment_method: good.id }) : null;
  check("reintento: cobra la misma factura", T.skiM, retried?.amount_paid, `factura ${retried?.id === failed?.id ? "la misma" : "otra"}`);

  // 9. Actualización de precio: una tarifa nueva no cambia lo contratado (el Price de la suscripción no se toca)
  const newBusiness = await sdk.prices.create({ product: P.businessM.product as string, unit_amount: 8900, currency: EUR, recurring: { interval: "month" } });
  const c9 = await clockAt(start);
  const cu9 = await customer(c9.id);
  const s9 = await sdk.subscriptions.create({ customer: cu9.id, items: [{ price: P.skiM.id }, { price: P.businessM.id, discounts: [{ coupon: coreM.id }] }] });
  await sdk.prices.update(P.businessM.id, { active: false });
  await advance(c9.id, start + 32 * 86_400_000);
  const inv9 = (await sdk.invoices.list({ subscription: s9.id, limit: 1 })).data[0];
  check("precio contractual conservado tras publicar una tarifa nueva", T.skiM + T.businessM - T.essentialM, inv9?.amount_paid, `tarifa nueva ${newBusiness.unit_amount! / 100} € sin efecto`);

  // 10. Idempotencia: repetir la misma alta con la misma clave devuelve la misma suscripción
  const c10 = await clockAt(start);
  const cu10 = await customer(c10.id);
  const idem = `${NS}-alta-1`;
  const a = await sdk.subscriptions.create({ customer: cu10.id, items: [{ price: P.skiM.id }] }, { idempotencyKey: idem });
  const b = await sdk.subscriptions.create({ customer: cu10.id, items: [{ price: P.skiM.id }] }, { idempotencyKey: idem });
  results.push({ caso: "idempotencia del alta", ok: a.id === b.id, detalle: a.id === b.id ? "misma suscripción" : "dos suscripciones" });

  for (const r of results) console.log(`${r.ok ? "OK   " : "FALLO"} ${r.caso}: ${r.detalle}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} casos correctos · prefijo de objetos ${NS} (relojes de prueba)`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error("ERROR", e instanceof Error ? e.message : e);
  process.exit(1);
});
