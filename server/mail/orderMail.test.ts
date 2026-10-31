/**
 * Correo transaccional del pedido listo para live (unitarias, sin red ni base de datos): plantillas
 * nuevas sin textos de prueba en live, disparo por categoría y por modo de cobro, idempotencia,
 * MAIL_MODE=off sin envíos y ningún correo con contraseñas. Datos sintéticos (dominios .example).
 */
import { describe, it, expect } from "vitest";
import { linkHosts as allLinkHosts, mailPolicyFromEnv } from "./policy";
/** Hosts de los enlaces de la operación (sin el pie corporativo: ayuda y textos legales de www.bigelephant.es). */
// Fuera de la web y de las redes del pie corporativo
const SOCIAL = new Set(["www.instagram.com", "www.facebook.com"]);
const linkHosts = (html: string) => allLinkHosts(html).filter((h) => h !== "www.bigelephant.es" && !SOCIAL.has(h));
import { memoryProvider } from "./providers";
import { MailService } from "./service";
import { MemoryMailStore } from "./store";
import { platformTemplates } from "./templates";
import { PlatformMailer } from "./platform";
import { CommercialOrchestrator, type OrderNotifier } from "../orchestrator/service";
import { MemoryOrderStore } from "../orchestrator/store";
import type { CommercialOrder, OrderPayment, PaymentMode } from "../orchestrator/types";

const DAY = 86_400_000;
/** Lo que nunca puede aparecer en un correo destinado a live. */
const TEST_WORDS = /prueba|sandbox|ficticio|simulad|iron elephant de prueba/i;
/** Ni contraseñas en claro ni campos de contraseña: solo el enlace de un solo uso para crearla. */
const PASSWORD_LEAK = /(contraseña|password|clave)\s*(provisional|temporal)?\s*[:=]\s*(?!https?:\/\/)\S/i;
const all = (c: { subject: string; html: string; text?: string }) => `${c.subject}\n${c.html}\n${c.text ?? ""}`;

describe("plantillas para live", () => {
  const t = platformTemplates({ supportEmail: "soporte@bigelephant.example" });
  const live = [
    t.paymentConfirmed({ reference: "PED-2026-000001", amountCents: 29_00, currency: "EUR" }),
    t.invoiceAvailable({ reference: "PED-2026-000001", invoiceRef: "in_123", amountCents: 29_00, currency: "EUR", test: false }),
    t.renewalConfirmed({ reference: "PED-2026-000001", amountCents: 29_00, currency: "EUR", periodStart: Date.UTC(2026, 10, 18), host: "montana.elephantsource.example", test: false }),
    t.subscriptionReactivated({ reference: "PED-2026-000001", reason: "cancel_undone", host: "montana.elephantsource.example" }),
    t.subscriptionReactivated({ reference: "PED-2026-000001", reason: "payment_recovered", host: "montana.elephantsource.example" }),
    t.signupReceived({ companyName: "Montaña Ejemplo SL", reference: "PED-2026-000001", test: false }),
    t.tenantWelcome({ companyName: "Montaña Ejemplo SL", host: "montana.elephantsource.example", setPasswordUrl: "https://montana.elephantsource.example/establecer-contrasena?token=t" }),
    t.contractConfirmed({ companyName: "Montaña Ejemplo SL", reference: "PED-2026-000001", host: "montana.elephantsource.example" }),
    t.paymentFailed({ reference: "PED-2026-000001", graceEndsAt: Date.UTC(2026, 10, 8), host: "montana.elephantsource.example" }),
    t.cancellation({ reference: "PED-2026-000001", cancelAt: Date.UTC(2026, 11, 1) }),
  ];

  it("en español, con la marca, el soporte y la referencia; sin prueba, sandbox ni ficticio; sin IVA inventado", () => {
    for (const c of live) {
      expect(c.html).toMatch(/<html lang="es">/);
      expect(c.html).toMatch(/Big Elephant/);
      expect(c.text).toMatch(/No es publicidad/);
      expect(c.text).toMatch(/soporte@bigelephant\.example/);
      expect(c.subject).toMatch(/PED-2026-000001|Montaña Ejemplo SL/);
      expect(all(c)).not.toMatch(TEST_WORDS);
      expect(all(c)).not.toMatch(/\bIVA\b|impuestos incluidos|factura fiscal|factura completa/i);
      expect(all(c)).not.toMatch(PASSWORD_LEAK);
    }
  });

  it("contenido mínimo de cada aviso nuevo", () => {
    const [paid, invoice, renewal, undone, recovered, signup] = live;
    expect(paid.subject).toBe("Pago confirmado · PED-2026-000001");
    expect(paid.text).toMatch(/Importe cobrado: 29,00\s€/);
    expect(paid.text).toMatch(/Stripe/);
    expect(invoice.subject).toBe("Factura disponible · PED-2026-000001");
    expect(invoice.text).toMatch(/in_123/);
    expect(invoice.text).toMatch(/Customer Portal/);
    // Sin la URL alojada de la factura no hay enlace (no se inventa)
    expect(linkHosts(invoice.html)).toEqual([]);
    expect(renewal.subject).toBe("Renovación confirmada · PED-2026-000001");
    expect(renewal.text).toMatch(/18 de noviembre de 2026/);
    expect(linkHosts(renewal.html)).toEqual(["montana.elephantsource.example"]);
    expect(undone.subject).toBe("Suscripción reactivada · PED-2026-000001");
    expect(undone.text).toMatch(/cancelación programada/);
    expect(recovered.subject).toBe("Suscripción al corriente · PED-2026-000001");
    expect(recovered.text).toMatch(/pago pendiente/);
    expect(signup.subject).toBe("Hemos recibido tu solicitud de alta · PED-2026-000001");
    expect(signup.text).toMatch(/Montaña Ejemplo SL/);
    expect(linkHosts(signup.html)).toEqual([]);
  });

  it("las variantes de pruebas lo dicen siempre (y no prometen un cargo real)", () => {
    const test = [
      t.testPaymentConfirmed({ reference: "PED-1", amountCents: 100, currency: "EUR" }),
      t.invoiceAvailable({ reference: "PED-1", invoiceRef: "in_1", amountCents: 100, currency: "EUR", test: true }),
      t.renewalConfirmed({ reference: "PED-1", amountCents: 100, currency: "EUR", periodStart: null, host: null, test: true }),
      t.signupReceived({ companyName: "Costa Ejemplo SL", reference: "PED-1", test: true }),
    ];
    for (const c of test) {
      expect(all(c)).toMatch(/prueba/i);
      expect(c.text).toMatch(/ningún cargo real/);
    }
    expect(test[2].text).not.toMatch(/Hemos cobrado/);
  });

  it("la bienvenida lleva solo el enlace de un solo uso, nunca una contraseña", () => {
    const c = live[6];
    expect(c.html).toMatch(/establecer-contrasena\?token=t/);
    expect(c.text).toMatch(/El enlace es personal y caduca/);
    expect(all(c)).not.toMatch(PASSWORD_LEAK);
  });
});

// ── Disparo desde los eventos del pedido ──────────────────────────────────────

function setup(o: { mode?: PaymentMode; env?: Record<string, string> } = {}) {
  const store = new MemoryMailStore();
  const provider = memoryProvider();
  const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "bigelephant.example", ELEPHANT_SUPPORT_EMAIL: "soporte@bigelephant.example", ...o.env } as NodeJS.ProcessEnv);
  const m = new PlatformMailer(new MailService({ lane: "platform", store, provider, policy }), policy);
  const payments: OrderPayment[] = [];
  const crmStore = {
    list: async () => [{ id: 2, companyId: 5, email: "principal@pruebas.example", isPrimary: true, status: "active" }],
    get: async () => ({ id: 5, name: "Costa Ejemplo SL" }),
  } as any;
  const reader = { listDomains: async () => [{ domain: "costa.elephantsource.example", kind: "platform_subdomain", status: "active", isPrimary: true, verifiedAt: null }] } as any;
  const notify = m.orderNotifier({ crmStore, orders: { payments: async () => payments }, reader, mode: o.mode });
  return { store, provider, notify, payments };
}
const order = (over: Partial<CommercialOrder> = {}) => ({ id: 3, reference: "PED-2026-000003", companyId: 5, tenantId: "costa", version: 4, graceEndsAt: Date.now() + 7 * DAY, ...over }) as CommercialOrder;
const payment = (over: Partial<OrderPayment>): OrderPayment => ({
  id: 9, orderId: 3, idempotencyKey: "stripe:inv:in_9", purpose: "initial", periodStart: null, amountCents: 29_00, currency: "EUR", status: "succeeded",
  provider: "stripe", mode: "live", providerRef: "in_9", dueAt: null, createdAt: 0, settledAt: 0, ...over,
});

describe("avisos del pedido en live (Stripe, cuenta real)", () => {
  it("pago del alta: «payment_confirmed» real y «invoice_available»; nunca el texto de prueba", async () => {
    const { notify, provider, payments } = setup({ mode: "live" });
    payments.push(payment({}));
    await notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    expect(provider.sent.map((x) => x.tag)).toEqual(["payment_confirmed", "invoice_available"]);
    for (const s of provider.sent) {
      expect(`${s.subject}\n${s.html}\n${s.text}`).not.toMatch(TEST_WORDS);
      expect(s.from).toEqual({ name: "Big Elephant", email: "no-reply@bigelephant.example" });
      expect(s.replyTo).toBe("soporte@bigelephant.example");
    }
    expect(provider.sent[1].text).toMatch(/in_9/);
  });

  it("renovación cobrada: «renewal_confirmed» y su factura; un cambio cobrado solo avisa de la factura", async () => {
    const { notify, provider, payments } = setup({ mode: "live" });
    payments.push(payment({ id: 10, purpose: "renewal", periodStart: Date.UTC(2026, 10, 18), providerRef: "in_10" }), payment({ id: 11, purpose: "change", providerRef: "in_11" }));
    await notify({ order: order(), action: "payment_recorded", detail: { paymentId: 10, purpose: "renewal" } });
    await notify({ order: order(), action: "payment_recorded", detail: { paymentId: 11, purpose: "change" } });
    expect(provider.sent.map((x) => x.tag)).toEqual(["renewal_confirmed", "invoice_available", "invoice_available"]);
    expect(provider.sent[0].subject).toBe("Renovación confirmada · PED-2026-000003");
    expect(provider.sent.every((s) => !TEST_WORDS.test(`${s.subject}\n${s.html}\n${s.text}`))).toBe(true);
  });

  it("reactivación (cancelación deshecha) y recuperación tras impago: «subscription_reactivated»", async () => {
    const { notify, provider } = setup({ mode: "live" });
    await notify({ order: order({ version: 6 }), action: "reactivate", detail: { source: "stripe" } });
    await notify({ order: order({ version: 7 }), action: "payment_recovered", detail: { source: "stripe" } });
    expect(provider.sent.map((x) => `${x.tag}:${x.subject}`)).toEqual([
      "subscription_reactivated:Suscripción reactivada · PED-2026-000003",
      "subscription_reactivated:Suscripción al corriente · PED-2026-000003",
    ]);
    expect(linkHosts(provider.sent[0].html)).toEqual(["costa.elephantsource.example"]);
  });

  it("solicitud de alta en línea: acuse «signup_received» solo con la aceptación de la web", async () => {
    const { notify, provider } = setup({ mode: "live" });
    await notify({ order: order({ version: 3 }), action: "sign", detail: { contractId: 1, signatureRef: "firma-del-operador" } });
    await notify({ order: order({ version: 3 }), action: "sign", detail: { contractId: 1, signatureRef: "web-terms:2026-10:abcdef0123456789" } });
    expect(provider.sent.map((x) => x.tag)).toEqual(["signup_received"]);
    expect(`${provider.sent[0].html}\n${provider.sent[0].text}`).not.toMatch(TEST_WORDS);
  });

  it("idempotencia: el mismo evento (o el mismo pago) no genera dos correos", async () => {
    const { notify, provider, store, payments } = setup({ mode: "live" });
    payments.push(payment({}), payment({ id: 10, purpose: "renewal", providerRef: "in_10" }));
    for (let i = 0; i < 3; i++) {
      await notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
      // El aviso del cobro no depende de la versión del pedido: se repite con otra versión y sigue siendo uno
      await notify({ order: order({ version: 4 + i }), action: "payment_recorded", detail: { paymentId: 10, purpose: "renewal" } });
      await notify({ order: order({ version: 8 }), action: "reactivate", detail: null });
    }
    expect(provider.sent.map((x) => x.tag)).toEqual(["payment_confirmed", "invoice_available", "renewal_confirmed", "invoice_available", "subscription_reactivated"]);
    expect(store.rows.map((r) => r.idempotencyKey)).toEqual([
      "order:3:confirm:4",
      "order:3:invoice_available:p9",
      "order:3:renewal_confirmed:p10",
      "order:3:invoice_available:p10",
      "order:3:reactivate:8",
    ]);
  });

  it("acciones sin aviso: cotización, firma del operador, confirmación administrativa, suspensión", async () => {
    const { notify, provider } = setup({ mode: "live" });
    await notify({ order: order(), action: "quote", detail: null });
    await notify({ order: order(), action: "confirm", detail: { basis: "admin_approval" } });
    await notify({ order: order(), action: "suspend", detail: null });
    await notify({ order: order(), action: "payment_recorded", detail: { paymentId: 404 } });
    expect(provider.sent).toHaveLength(0);
  });
});

describe("avisos del pedido en pruebas", () => {
  it("Stripe en modo pruebas: texto de PRUEBA en el pago, la factura y la renovación; nunca el real", async () => {
    const { notify, provider, payments } = setup({ mode: "test" });
    payments.push(payment({ provider: "stripe_test", mode: "test" }), payment({ id: 10, purpose: "renewal", provider: "stripe_test", mode: "test", providerRef: "in_10" }));
    await notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    await notify({ order: order(), action: "payment_recorded", detail: { paymentId: 10, purpose: "renewal" } });
    await notify({ order: order(), action: "sign", detail: { signatureRef: "web-terms:v1:abc" } });
    expect(provider.sent.map((x) => x.tag)).toEqual(["test_payment_confirmed", "invoice_available", "renewal_confirmed", "invoice_available", "signup_received"]);
    for (const s of provider.sent) {
      expect(s.text).toMatch(/prueba/i);
      expect(s.subject).not.toMatch(/^Pago confirmado|^Renovación confirmada|^Factura disponible/);
    }
  });

  it("pago simulado: sin factura de Stripe; un pago de modo pruebas en un entorno live tampoco sale como real", async () => {
    const a = setup({ mode: "test" });
    a.payments.push(payment({ provider: "simulated", mode: "test", providerRef: "sim_1" }));
    await a.notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    expect(a.provider.sent.map((x) => x.tag)).toEqual(["test_payment_confirmed"]);
    // Defensa: el entorno es live pero el pago no es de Stripe live → texto de prueba
    const b = setup({ mode: "live" });
    b.payments.push(payment({ provider: "stripe_test", mode: "test" }));
    await b.notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    expect(b.provider.sent.map((x) => x.tag)).toEqual(["test_payment_confirmed", "invoice_available"]);
    expect(b.provider.sent[1].subject).toMatch(/Factura de prueba/);
    // …y un pago live en un entorno de pruebas tampoco se anuncia como real
    const c = setup({ mode: "test" });
    c.payments.push(payment({}));
    await c.notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    expect(c.provider.sent[0].tag).toBe("test_payment_confirmed");
  });
});

describe("MAIL_MODE=off", () => {
  it("no envía nada (ni guarda el cuerpo) aunque el pedido dispare todos los avisos", async () => {
    const { notify, provider, store, payments } = setup({ mode: "live", env: { MAIL_MODE: "off" } });
    payments.push(payment({}), payment({ id: 10, purpose: "renewal", providerRef: "in_10" }));
    await notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    await notify({ order: order(), action: "payment_recorded", detail: { paymentId: 10, purpose: "renewal" } });
    await notify({ order: order(), action: "reactivate", detail: null });
    await notify({ order: order(), action: "sign", detail: { signatureRef: "web-terms:v1:abc" } });
    expect(provider.sent).toHaveLength(0);
    expect(store.rows.length).toBe(6);
    expect(store.rows.every((r) => r.status === "skipped" && r.reason === "mode_off" && r.html === null && r.toEmail === null)).toBe(true);
  });

  it("por defecto (sin MAIL_MODE) también queda en off", () => {
    expect(mailPolicyFromEnv({ MAIL_SENDING_DOMAIN: "bigelephant.example" } as NodeJS.ProcessEnv).mode).toBe("off");
  });
});

describe("ningún correo lleva contraseñas", () => {
  it("bienvenida (alta asistida y prueba) y avisos del pedido: solo enlaces de un solo uso", async () => {
    const { notify, provider, payments } = setup({ mode: "live" });
    const store = new MemoryMailStore();
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "bigelephant.example" } as NodeJS.ProcessEnv);
    const welcomeProvider = memoryProvider();
    const m = new PlatformMailer(new MailService({ lane: "platform", store, provider: welcomeProvider, policy }), policy);
    await m.assistedWelcome()("admin@pruebas.example", { tenantId: "costa", companyName: "Costa Ejemplo SL", domain: "costa.elephantsource.example", inviteToken: "inv-secreto-1" });
    await m.trialNotifier().welcome("admin@pruebas.example", { tenantId: "montana", domain: "montana.elephantsource.example", inviteToken: "inv-secreto-2" });
    payments.push(payment({}));
    await notify({ order: order(), action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    await notify({ order: order(), action: "activate", detail: null });
    const sent = [...welcomeProvider.sent, ...provider.sent];
    expect(sent.length).toBe(5);
    for (const s of sent) expect(`${s.subject}\n${s.html}\n${s.text}`).not.toMatch(PASSWORD_LEAK);
    expect(welcomeProvider.sent.map((s) => s.tag)).toEqual(["tenant_welcome", "trial_activated"]);
    expect(welcomeProvider.sent[0].html).toMatch(/establecer-contrasena\?token=inv-secreto-1/);
    expect(welcomeProvider.sent[0].text).not.toMatch(TEST_WORDS);
  });
});

// ── Orquestador: aviso de cobro sin cambio de estado ─────────────────────────

describe("orquestador: «payment_recorded»", () => {
  async function orchestrator(mode: PaymentMode) {
    const store = new MemoryOrderStore();
    const events: Array<{ action: string; detail: Record<string, unknown> | null }> = [];
    const notify: OrderNotifier = async (e) => void events.push({ action: e.action, detail: e.detail });
    const svc = new CommercialOrchestrator({ store, notify, mode } as any);
    const { order: o } = await store.insert({
      idempotencyKey: "pedido-de-ensayo-0001", payloadHash: "h", kind: "new", state: "active", companyId: 5, leadRequestId: null, trialId: null, previousOrderId: null,
      request: { plan: "essential", interval: "month", items: [] }, quote: null, contractId: null, subscriptionId: 1, tenantId: "costa", confirmation: null, graceEndsAt: null,
      attempts: 0, lastError: null, createdAt: 0, createdBy: "test",
    });
    return { store, svc, events, o };
  }
  const pay = (orderId: number, over: Partial<OrderPayment>) => ({ orderId, idempotencyKey: `k-${Math.random()}`, purpose: "renewal" as const, periodStart: 1, amountCents: 2900, currency: "EUR", status: "succeeded" as const, provider: "stripe", mode: "live" as const, providerRef: "in_r", dueAt: null, createdAt: 0, settledAt: 0, ...over });

  it("solo para cobros verificados de renovación o cambio del modo del entorno", async () => {
    const { store, svc, events, o } = await orchestrator("live");
    const renewal = (await store.insertPayment(pay(o.id, {}))).payment;
    const initial = (await store.insertPayment(pay(o.id, { purpose: "initial" }))).payment;
    const pending = (await store.insertPayment(pay(o.id, { status: "pending" }))).payment;
    const otherMode = (await store.insertPayment(pay(o.id, { provider: "stripe_test", mode: "test" }))).payment;
    for (const p of [renewal, initial, pending, otherMode]) await svc.paymentRecorded(o.id, p.id);
    await svc.paymentRecorded(o.id, 9999);
    expect(events).toEqual([{ action: "payment_recorded", detail: { paymentId: renewal.id, purpose: "renewal" } }]);
    // No toca el pedido
    expect((await store.get(o.id))!.version).toBe(o.version);
  });
});
