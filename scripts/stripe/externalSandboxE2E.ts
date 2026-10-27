/**
 * Validación de punta a punta de los servicios de clientes externos contra el SANDBOX REAL de Stripe, con relojes de
 * prueba (Test Clocks). Nunca en live: exige una clave `sk_test_` / `rk_test_` y se niega con cualquier otra.
 *
 *   ES_SANDBOX_STRIPE_KEY=sk_test_… pnpm exec tsx scripts/stripe/externalSandboxE2E.ts
 *
 * Recorre el piloto Nextair (SkiNet, 1.000 € + 21 % IVA, cobro el día 1 a las 08:00 de Madrid) con el servicio REAL
 * (server/external/service.ts), el CRM en memoria y la pasarela REAL de Stripe:
 *   contrato → aceptación → Customer con reloj → autorización de la tarjeta sin cargo (SetupIntent confirmado con la
 *   tarjeta de prueba pm_card_visa: el mecanismo oficial de pruebas, la página de Checkout exige navegador) →
 *   suscripción con trial_end = primer vencimiento → avance del reloj al día 1 → factura 1.000 + 210 = 1.210 € cobrada →
 *   avance al siguiente día 1 → renovación → tarjeta que falla (pm_card_chargeCustomerFail) → impago (pago pendiente)
 *   → nueva tarjeta y cobro de la MISMA factura → evaluación del margen (día 5) → idempotencia de los eventos.
 *
 * Al terminar deja el reloj y sus objetos en el sandbox (se borran solos con el reloj o desde el Dashboard).
 */
import Stripe from "stripe";
import { CrmService } from "../../server/crm/service";
import { MemoryCrmStore } from "../../server/crm/store";
import { ExternalService } from "../../server/external/service";
import { MemoryExternalStore } from "../../server/external/store";
import { chargeInstant } from "../../server/external/schedule";
import { stripeGateway } from "../../server/stripe/gateway";
import { MemoryStripeStore } from "../../server/stripe/store";
import type { StripeConfig } from "../../server/stripe/config";

const key = (process.env.ES_SANDBOX_STRIPE_KEY ?? "").trim();
if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(key)) {
  console.error("Falta ES_SANDBOX_STRIPE_KEY con una clave de PRUEBAS (sk_test_… o rk_test_…). Nunca se usa una clave live.");
  process.exit(2);
}
const API = "2026-09-30.endive";
const config: StripeConfig = { mode: "test", apiKey: key, webhookSecret: "whsec_unused_in_this_script_000000", apiVersion: API, keyKind: key.startsWith("rk_") ? "restricted" : "secret", namespace: `e2e${Date.now().toString(36)}`, eventsRetentionDays: 30, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(key, { apiVersion: API as Stripe.LatestApiVersion });
const gateway = stripeGateway(config);

let clockMs = 0;
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
const check = (step: string, ok: boolean, detail = "") => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "OK   " : "FALLO"} ${step}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function advance(clockId: string, toMs: number) {
  await gateway.advanceTestClock!(clockId, Math.floor(toMs / 1000));
  for (let i = 0; i < 120; i++) {
    const c = await gateway.testClock!(clockId);
    if (c?.status === "ready") break;
    await sleep(2000);
  }
  clockMs = toMs;
}
/** Estado releído de Stripe aplicado por el servicio (lo que harían los webhooks firmados). */
async function sync(svc: ExternalService, subId: string) {
  const sub = (await gateway.subscription(subId))!;
  return svc.handleSubscription(sub);
}

async function main() {
  // Hoy en el reloj: 27/10/2026 10:00 (Madrid); primer cargo el 01/11/2026 a las 08:00
  clockMs = Date.UTC(2026, 9, 27, 9);
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => clockMs });
  const store = new MemoryExternalStore("test");
  const stripeStore = new MemoryStripeStore();
  const svc = new ExternalService({ store, crm, crmStore, stripeStore, gateway, mode: "test", namespace: config.namespace, urls: { acceptance: "https://admin.example/cp/v1/public/contract-acceptance", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" }, ipSalt: "e2e", now: () => clockMs });

  const company = await crm.createCompany({ name: "Nextair SL (sandbox)", legalName: "Nextair SL", taxId: "B00000000", country: "ES", billingEmail: "facturas@nextair.example" }, "e2e");
  const x0 = await svc.create(
    { companyId: company.id, service: { key: "skinet", name: "SkiNet — Servicio tecnológico gestionado" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", externalRef: "skicenter:nextair", conditions: "Servicio tecnológico gestionado de la plataforma Skicenter (validación en sandbox).", testClock: { frozenTime: clockMs } },
    "e2e",
  );
  check("1-2. Contratación externa sin duplicados", x0.status === "awaiting_acceptance" && !!x0.stripeTestClockId, `reloj ${x0.stripeTestClockId}`);
  const dup = await svc.create({ companyId: company.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Duplicado de prueba, debe rechazarse." }, "e2e").then(() => false, () => true);
  check("1. Segunda contratación del mismo servicio rechazada", dup);

  const req = await svc.requestAcceptance(x0.id, { name: "Laura Representante", email: "laura@nextair.example", role: "Administradora" }, "e2e");
  const token = new URL(req.url).searchParams.get("token")!;
  const acc = await svc.accept(token, { name: "Laura Representante", taxId: "00000000T", accept: true }, { ip: "203.0.113.7", userAgent: "e2e" });
  check("3. Contrato y aceptación con evidencias", acc.accepted && acc.documentSha256 === req.documentSha256, `versión ${acc.version}, huella ${acc.documentSha256.slice(0, 12)}…`);

  const setup = await svc.paymentSetup(x0.id, "e2e");
  check("4. Enlace de autorización de la tarjeta (Checkout setup)", !!setup.url && setup.url.startsWith("https://checkout.stripe.com/"), setup.sessionId);

  // 5. El cliente autoriza la tarjeta sin cargo. La página de Checkout exige navegador: se usa el mecanismo oficial de
  // pruebas (SetupIntent confirmado con pm_card_visa) y se cierra la sesión de setup como haría el cliente
  const x1 = (await store.get(x0.id))!;
  const si = await sdk.setupIntents.create({ customer: x1.stripeCustomerId!, payment_method: "pm_card_visa", confirm: true, usage: "off_session", automatic_payment_methods: { enabled: true, allow_redirects: "never" } });
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method!.id;
  await gateway.setDefaultPaymentMethod!(x1.stripeCustomerId!, pm);
  await store.update(x1.id, x1.version, { stripePaymentMethodId: pm }, clockMs);
  // Mismo paso que hace handleSetupSession tras el webhook: programar la suscripción
  const sched = await (svc as unknown as { schedule(x: unknown, actor: string): Promise<{ status: string; stripeSubscriptionId: string }> }).schedule(await store.get(x1.id), "e2e");
  const invoicesNow = await sdk.invoices.list({ customer: x1.stripeCustomerId!, limit: 10 });
  const charged = invoicesNow.data.reduce((a, i) => a + i.amount_paid, 0);
  check("5. Método de pago registrado sin cargo inmediato", si.status === "succeeded" && charged === 0, `SetupIntent ${si.id}; cobrado hoy: ${charged}`);
  const sub0 = await sdk.subscriptions.retrieve(sched.stripeSubscriptionId);
  const first = chargeInstant("2026-11-01", 8, "Europe/Madrid");
  check("6. Primer vencimiento programado (01/11/2026 08:00 Madrid)", sub0.status === "trialing" && sub0.trial_end === Math.floor(first / 1000), `trial_end ${new Date((sub0.trial_end ?? 0) * 1000).toISOString()}`);

  // 7-8. Día 1: Stripe factura y cobra 1.000 + 210 = 1.210 €
  await advance(x1.stripeTestClockId!, first + 3600_000);
  await sleep(5000);
  let sub = await sdk.subscriptions.retrieve(sched.stripeSubscriptionId, { expand: ["latest_invoice"] });
  let inv = sub.latest_invoice as Stripe.Invoice;
  check("7. Factura con base 1.000 € e IVA 210 €", inv.subtotal === 100_000 && (inv.total_taxes?.reduce((a, t) => a + t.amount, 0) ?? (inv.total - inv.subtotal)) === 21_000, `${inv.id}: subtotal ${inv.subtotal}, total ${inv.total}`);
  check("8. Cobro total de 1.210 € en modo test", inv.status === "paid" && inv.amount_paid === 121_000, `${inv.status}, pagado ${inv.amount_paid}`);
  await sync(svc, sub.id);
  check("8. Estado comercial activo", (await store.get(x1.id))!.status === "active");

  // 9. Renovación el 01/12
  await advance(x1.stripeTestClockId!, chargeInstant("2026-12-01", 8, "Europe/Madrid") + 3600_000);
  await sleep(5000);
  sub = await sdk.subscriptions.retrieve(sched.stripeSubscriptionId, { expand: ["latest_invoice"] });
  inv = sub.latest_invoice as Stripe.Invoice;
  check("9. Renovación el siguiente día 1", inv.status === "paid" && inv.amount_paid === 121_000 && inv.billing_reason === "subscription_cycle", `${inv.id} periodo desde ${new Date(inv.period_start * 1000).toISOString()}`);
  await sync(svc, sub.id);

  // 10. Impago el 01/01 con una tarjeta que falla y recuperación con otra antes del día 5 (la MISMA factura)
  const bad = await sdk.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: x1.stripeCustomerId! });
  await sdk.customers.update(x1.stripeCustomerId!, { invoice_settings: { default_payment_method: bad.id } });
  await sdk.subscriptions.update(sub.id, { default_payment_method: bad.id });
  await advance(x1.stripeTestClockId!, chargeInstant("2027-01-01", 8, "Europe/Madrid") + 3600_000);
  await sleep(5000);
  sub = await sdk.subscriptions.retrieve(sched.stripeSubscriptionId, { expand: ["latest_invoice"] });
  inv = sub.latest_invoice as Stripe.Invoice;
  await sync(svc, sub.id);
  const pending = (await store.get(x1.id))!;
  check("10. Impago registrado como pago pendiente (días 1 a 5)", inv.status === "open" && pending.status === "past_due" && pending.graceUntil !== null, `${inv.id}; margen hasta ${pending.graceUntil ? new Date(pending.graceUntil).toISOString() : "?"}`);
  const good = await sdk.paymentMethods.attach("pm_card_visa", { customer: x1.stripeCustomerId! });
  await sdk.subscriptions.update(sub.id, { default_payment_method: good.id });
  const paid = await sdk.invoices.pay(inv.id!, { payment_method: good.id });
  await sync(svc, sub.id);
  const invCount = (await sdk.invoices.list({ subscription: sub.id, limit: 20 })).data.length;
  check("10. Recuperación de la MISMA factura, sin cargo adicional", paid.status === "paid" && (await store.get(x1.id))!.status === "active" && invCount === 3, `${invCount} facturas de la suscripción`);

  // 11. Idempotencia: releer y aplicar otra vez no duplica nada
  const before = (await store.events(x1.id)).length;
  await sync(svc, sub.id);
  await sync(svc, sub.id);
  check("11. Conciliación idempotente", (await store.events(x1.id)).length === before);

  // 12-13. Sin aprovisionamiento y evidencias conservadas
  check("12. Ningún aprovisionamiento en Elephant Core", (await crmStore.get("companies", company.id))!.tenantId === null);
  const detail = await svc.detail(x1.id);
  check("13. Contrato y evidencias conservados", detail.contract?.status === "signed" && detail.acceptances[0]?.status === "accepted", `firmado ${detail.contract?.signatureMethod}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas contra el sandbox de Stripe (reloj ${x1.stripeTestClockId})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
