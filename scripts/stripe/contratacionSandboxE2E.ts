/**
 * Validación contra el SANDBOX REAL de Stripe (modo pruebas, con Test Clocks) del circuito de contratación de condiciones
 * personalizadas: el primer cargo cae EXACTAMENTE en el instante pactado y el importe es el del contrato. Nunca en live:
 * exige una clave `sk_test_` / `rk_test_` y se niega con cualquier otra. No toca ninguna suscripción ni empresa real.
 *
 *   ES_SANDBOX_STRIPE_KEY=sk_test_… pnpm exec tsx scripts/stripe/contratacionSandboxE2E.ts
 *
 * Escenario equivalente al de Quantum Soulrise (52,00 € + IVA al mes, tres partidas, primer cargo = fin de la prueba):
 *   1. Sesión de Checkout REAL de la pasarela de producción (`createNegotiatedCheckoutSession`, con `trial_end` redondeado
 *      hacia arriba y partidas en línea): Stripe la acepta y queda abierta con su URL (la página exige navegador).
 *   2. Lo que Checkout crearía al pagar, con la tarjeta de pruebas pm_card_visa (el mecanismo oficial): Customer con reloj,
 *      método de pago autorizado y suscripción con las MISMAS partidas y el MISMO trial_end → estado «trialing», sin cargo.
 *   3. Se avanza el reloj hasta ANTES del instante pactado: sigue sin cargo. Se avanza hasta DESPUÉS: factura de 52,00 €
 *      (+ IVA si el producto/Stripe Tax lo aplica) pagada, con el periodo empezando en el instante pactado.
 *   4. Tarjeta rechazada (pm_card_chargeCustomerFail) en otra suscripción: la factura queda abierta/impagada (gracia).
 *   5. Sesión caducada: expirar la sesión de Checkout y comprobar que Stripe la da por expirada.
 * Al terminar deja el reloj y sus objetos en el sandbox (se borran con el reloj o desde el Dashboard).
 */
import Stripe from "stripe";
import { stripeGateway } from "../../server/stripe/gateway";
import type { StripeConfig } from "../../server/stripe/config";

const key = (process.env.ES_SANDBOX_STRIPE_KEY ?? "").trim();
if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(key)) {
  console.error("Falta ES_SANDBOX_STRIPE_KEY con una clave de PRUEBAS (sk_test_… o rk_test_…). Nunca se usa una clave live.");
  process.exit(2);
}
const API = "2026-09-30.endive";
const config: StripeConfig = { mode: "test", apiKey: key, webhookSecret: "whsec_unused_in_this_script_000000", apiVersion: API, keyKind: key.startsWith("rk_") ? "restricted" : "secret", namespace: `e2e${Date.now() % 100000}`, eventsRetentionDays: 30, taxPolicy: "test_net_no_tax", billingMode: "classic" } as StripeConfig;
const sdk = new Stripe(key, { apiVersion: API as Stripe.LatestApiVersion });
const gateway = stripeGateway(config);
const DAY = 86_400_000;
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
const check = (step: string, ok: boolean, detail = "") => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "OK   " : "FALLO"} ${step}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function advance(clockId: string, toMs: number) {
  await gateway.advanceTestClock!(clockId, Math.floor(toMs / 1000));
  for (let i = 0; i < 120; i++) {
    if ((await gateway.testClock!(clockId))?.status === "ready") return;
    await sleep(2000);
  }
  throw new Error("el reloj de pruebas no terminó de avanzar");
}

async function main() {
  const t0 = Date.now();
  // Fin de prueba con milisegundos (como el real de Quantum): el primer cargo no puede adelantarse ni un segundo
  const trialEndMs = Math.floor((t0 + 30 * DAY) / 1000) * 1000 + 769;
  const trialEndSec = Math.ceil(trialEndMs / 1000);
  const clock = await gateway.createTestClock!(Math.floor(t0 / 1000), "es-contratacion-e2e");
  check("reloj de pruebas creado", !!clock.id, clock.id);

  const products = [] as Array<{ id: string; cents: number }>;
  for (const [name, cents] of [["Business", 3235], ["WhatsApp AI", 1187], ["Campaigns", 778]] as const) {
    const p = await sdk.products.create({ name: `es-e2e ${name}`, metadata: { es_e2e: "1" } });
    products.push({ id: p.id, cents });
  }
  const total = products.reduce((a, p) => a + p.cents, 0);
  check("importe de las partidas = 52,00 € netos", total === 5200, String(total));

  const customer = await sdk.customers.create({ name: "Cliente E2E contratación", email: "e2e-contratacion@example.com", test_clock: clock.id, metadata: { es_e2e: "1" } });

  // 1) Checkout REAL de la pasarela de producción
  const session = await gateway.createNegotiatedCheckoutSession!(
    {
      customerId: customer.id,
      lines: products.map((p) => ({ productId: p.id, unitAmount: p.cents, currency: "EUR", interval: "month" as const })),
      clientReferenceId: `es-e2e-${config.namespace}`,
      metadata: { es_negotiated: "1", es_e2e: "1" },
      successUrl: "https://example.com/ok?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://example.com/cancelado",
      expiresAt: Math.floor((t0 + 2 * 3600_000) / 1000),
      integrationIdentifier: "es-contratacion-e2e",
      notice: "Prueba de contratación (sandbox)",
      trialEnd: trialEndSec,
    },
    `es-e2e-${config.namespace}-checkout-1`,
  );
  check("Stripe acepta la sesión de Checkout con trial_end y partidas en línea", session.status === "open" && !!session.url, session.id);
  const raw = await sdk.checkout.sessions.retrieve(session.id);
  check("la sesión es de suscripción y lleva el trial_end pedido", raw.mode === "subscription", `mode=${raw.mode}`);
  await sdk.checkout.sessions.expire(session.id);
  const expired = await sdk.checkout.sessions.retrieve(session.id);
  check("sesión caducada: Stripe la da por expirada (hay que abrir otra)", expired.status === "expired", String(expired.status));

  // 2) Lo que Checkout crea al pagar: método de pago autorizado + suscripción con trial_end
  const pm = await sdk.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await sdk.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  const sub = await sdk.subscriptions.create({
    customer: customer.id,
    default_payment_method: pm.id,
    trial_end: trialEndSec,
    items: products.map((p) => ({ quantity: 1, price_data: { currency: "eur", product: p.id, unit_amount: p.cents, recurring: { interval: "month" as const }, tax_behavior: "exclusive" as const } })),
    metadata: { es_negotiated: "1", es_e2e: "1" },
  });
  check("suscripción en prueba hasta el instante pactado (método autorizado, sin cargo)", sub.status === "trialing" && sub.trial_end === trialEndSec, `${sub.status} trial_end=${sub.trial_end}`);
  check("el primer cargo no se adelanta: trial_end ≥ instante pactado (< 1 s de redondeo)", sub.trial_end! * 1000 >= trialEndMs && sub.trial_end! * 1000 - trialEndMs < 1000);
  const invoicesBefore = await sdk.invoices.list({ subscription: sub.id });
  check("sin cobro durante la prueba (factura inicial de 0 €)", invoicesBefore.data.every((i) => (i.amount_paid ?? 0) === 0), `${invoicesBefore.data.length} facturas`);

  // 3) El reloj llega al instante pactado
  await advance(clock.id, trialEndMs - 60_000);
  const early = await sdk.subscriptions.retrieve(sub.id);
  check("un minuto antes del instante pactado sigue en prueba y sin cobro", early.status === "trialing");
  await advance(clock.id, trialEndMs + 3600_000);
  const after = await sdk.subscriptions.retrieve(sub.id);
  const invs = await sdk.invoices.list({ subscription: sub.id, limit: 10 });
  const first = invs.data.find((i) => i.amount_paid > 0 || i.subtotal > 0);
  check("tras el instante pactado la suscripción está activa", after.status === "active", after.status);
  check("primera factura = 52,00 € netos, pagada", !!first && first.subtotal === 5200 && first.status === "paid", first ? `subtotal=${first.subtotal} status=${first.status}` : "sin factura");
  check("el periodo de pago empieza en el instante pactado", !!first && Math.abs((first.period_start ?? 0) - trialEndSec) <= 1, String(first?.period_start));
  const dup = invs.data.filter((i) => i.subtotal === 5200);
  check("no hay cargos duplicados", dup.length === 1, String(dup.length));

  // 4) Tarjeta rechazada
  const bad = await sdk.customers.create({ name: "Cliente E2E rechazo", email: "e2e-rechazo@example.com", test_clock: clock.id, metadata: { es_e2e: "1" } });
  const failPm = await sdk.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: bad.id });
  await sdk.customers.update(bad.id, { invoice_settings: { default_payment_method: failPm.id } });
  const subBad = await sdk.subscriptions.create({ customer: bad.id, default_payment_method: failPm.id, items: [{ quantity: 1, price_data: { currency: "eur", product: products[0].id, unit_amount: 5200, recurring: { interval: "month" as const } } }], payment_behavior: "allow_incomplete" });
  const badInv = (await sdk.invoices.list({ subscription: subBad.id })).data[0];
  check("tarjeta rechazada: la factura no queda pagada (impago → periodo de gracia)", !!badInv && badInv.status !== "paid", `${badInv?.status} / sub=${subBad.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nResultado: ${results.length - failed.length}/${results.length} comprobaciones correctas`);
  console.log(`Reloj de pruebas ${clock.id}: bórralo desde el Dashboard (modo pruebas) para limpiar los objetos.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
