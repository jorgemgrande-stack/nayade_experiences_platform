/**
 * Plantillas (español, transaccionales, marca y host correctos) y avisos de plataforma conectados a los
 * eventos existentes (prueba, alta asistida, pedidos) con una bandeja en memoria.
 */
import { describe, it, expect } from "vitest";
import { forbiddenLinkHosts, linkHosts, mailPolicyFromEnv } from "./policy";
import { memoryProvider } from "./providers";
import { MailService } from "./service";
import { MemoryMailStore } from "./store";
import { platformTemplates, tenantNotice } from "./templates";
import { PlatformMailer } from "./platform";

const LEFTOVERS = /n[aá]yade|skicenter|iron elephant|nayadeexperiences/i;
const DAY = 86_400_000;

describe("plantillas de plataforma", () => {
  const t = platformTemplates({ supportEmail: null });
  const all = [
    t.emailVerification({ verifyUrl: "https://web.example/prueba/verificar?id=1&token=abc" }),
    t.tenantWelcome({ companyName: "Montaña Ejemplo SL", host: "montana.elephantsource.example", setPasswordUrl: "https://montana.elephantsource.example/establecer-contrasena?token=t" }),
    t.signupConfirmation({ companyName: "Montaña Ejemplo SL" }),
    t.trialActivated({ host: "montana.elephantsource.example", setPasswordUrl: "https://montana.elephantsource.example/establecer-contrasena?token=t", endsAt: Date.UTC(2026, 10, 1) }),
    t.trialExpiry({ endsAt: Date.UTC(2026, 10, 1), daysLeft: 3, pricingUrl: "https://web.example/precios" }),
    t.contractConfirmed({ companyName: "Montaña Ejemplo SL", reference: "PED-0001", host: "montana.example" }),
    t.testPaymentConfirmed({ reference: "PED-0001", amountCents: 4840, currency: "EUR" }),
    t.paymentFailed({ reference: "PED-0001", graceEndsAt: Date.UTC(2026, 10, 8), host: "montana.example" }),
    t.cancellation({ reference: "PED-0001", cancelAt: Date.UTC(2026, 11, 1) }),
  ];

  it("en español, con la marca Elephant Source, sin restos de otra instalación y sin publicidad", () => {
    for (const c of all) {
      expect(c.html).toMatch(/<html lang="es">/);
      expect(c.html).toMatch(/Elephant Source/);
      expect(c.text).toMatch(/No es publicidad/);
      expect(`${c.subject} ${c.html} ${c.text}`).not.toMatch(LEFTOVERS);
      expect(c.subject).not.toMatch(/[\r\n]/);
    }
  });

  it("los enlaces van al host de la empresa o a la URL de la web indicada", () => {
    expect(linkHosts(all[1].html)).toEqual(["montana.elephantsource.example"]);
    expect(linkHosts(all[5].html)).toEqual(["montana.example"]);
    expect(linkHosts(all[0].html)).toEqual(["web.example"]);
    expect(all[6].text).toMatch(/48,40/);
    expect(all[6].text).toMatch(/PRUEBA/);
    expect(all[6].text).toMatch(/ningún cargo real/);
  });

  it("la dirección de soporte solo aparece si se configura", () => {
    expect(all.some((c) => /Escríbenos/.test(c.text!))).toBe(false);
    const withSupport = platformTemplates({ supportEmail: "soporte@elephant.example" }).cancellation({ reference: null, cancelAt: null });
    expect(withSupport.text).toMatch(/soporte@elephant\.example/);
  });

  it("escapa el contenido y descarta enlaces que no son https", () => {
    const c = t.tenantWelcome({ companyName: '<script>alert(1)</script>"', host: null, setPasswordUrl: "javascript:alert(1)" });
    expect(c.html).not.toMatch(/<script>|javascript:/);
    expect(c.html).toMatch(/&lt;script&gt;/);
  });

  it("aviso de empresa con su marca y su host", () => {
    const c = tenantNotice({ brandName: "Costa Ejemplo SL", title: "Nueva reserva", paragraphs: ["Tienes una reserva nueva."], host: "costa.example", path: "/admin", ctaLabel: "Abrir el panel" });
    expect(c.html).toMatch(/Costa Ejemplo SL/);
    expect(c.html).not.toMatch(/Elephant Source/);
    expect(linkHosts(c.html)).toEqual(["costa.example"]);
  });
});

describe("guarda de enlaces en correos de empresa (multiempresa)", () => {
  it("bloquea Náyade y el host global de la instalación; permite el de la empresa", () => {
    const html = '<a href="https://www.nayadeexperiences.es/x">a</a><a href="https://app.instalacion.example/y">b</a><a href="https://costa.example/z">c</a>';
    expect(forbiddenLinkHosts(html, { tenantHosts: ["costa.example"], appUrl: "https://app.instalacion.example" })).toEqual(["www.nayadeexperiences.es", "app.instalacion.example"]);
    expect(forbiddenLinkHosts('<a href="https://costa.example/">x</a>', { tenantHosts: ["costa.example"], appUrl: "https://costa.example" })).toEqual([]);
  });
});

describe("avisos de plataforma conectados a los eventos", () => {
  function mailer() {
    const store = new MemoryMailStore();
    const provider = memoryProvider();
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "bigelephant.example", ELEPHANT_SUPPORT_EMAIL: "soporte@bigelephant.example" } as NodeJS.ProcessEnv);
    const svc = new MailService({ lane: "platform", store, provider, policy });
    return { store, provider, m: new PlatformMailer(svc, policy, { verifyUrl: "https://web.example/prueba/verificar", pricingUrl: "https://web.example/precios" }) };
  }

  it("prueba: verificación, bienvenida con el host de la empresa y vencimiento; sin duplicados", async () => {
    const { m, provider, store } = mailer();
    const n = m.trialNotifier();
    await n.verification("dueña@pruebas.example".replace("ñ", "n"), { trialId: 7, token: "tok-verif" });
    await n.verification("duena@pruebas.example", { trialId: 7, token: "tok-verif" });
    await n.welcome("duena@pruebas.example", { tenantId: "montana", domain: "montana.elephantsource.example", inviteToken: "inv-1" });
    const endsAt = Date.now() + 3 * DAY;
    await n.expiryNotice("duena@pruebas.example", { trialId: 7, endsAt, daysLeft: 3 });
    await n.expiryNotice("duena@pruebas.example", { trialId: 7, endsAt, daysLeft: 3 });
    expect(provider.sent.map((x) => x.tag)).toEqual(["email_verification", "trial_activated", "trial_expiry"]);
    expect(provider.sent[0].from).toEqual({ name: "Elephant Source", email: "no-reply@bigelephant.example" });
    expect(provider.sent[0].replyTo).toBe("soporte@bigelephant.example");
    expect(linkHosts(provider.sent[1].html)).toEqual(["montana.elephantsource.example"]);
    expect(provider.sent[1].html).toMatch(/establecer-contrasena\?token=inv-1/);
    expect(store.rows.find((r) => r.category === "trial_activated")?.tenantId).toBe("montana");
  });

  it("alta asistida: bienvenida de la empresa", async () => {
    const { m, provider } = mailer();
    await m.assistedWelcome()("admin@pruebas.example", { tenantId: "costa", companyName: "Costa Ejemplo SL", domain: "costa.elephantsource.example", inviteToken: "inv-2" });
    expect(provider.sent[0]).toMatchObject({ tag: "tenant_welcome", subject: "La plataforma de Costa Ejemplo SL está lista" });
    expect(linkHosts(provider.sent[0].html)).toEqual(["costa.elephantsource.example"]);
  });

  it("pedidos: contratación, pago de prueba, impago y cancelación al contacto principal; otras acciones no avisan", async () => {
    const { m, provider } = mailer();
    const crmStore = {
      list: async () => [
        { id: 1, companyId: 5, email: "otro@pruebas.example", isPrimary: false, status: "active" },
        { id: 2, companyId: 5, email: "principal@pruebas.example", isPrimary: true, status: "active" },
      ],
      get: async () => ({ id: 5, name: "Costa Ejemplo SL" }),
    } as any;
    const orders = { payments: async () => [{ id: 9, amountCents: 4840, currency: "EUR" }] } as any;
    const reader = { listDomains: async () => [{ domain: "costa.elephantsource.example", kind: "platform_subdomain", status: "active", isPrimary: true, verifiedAt: null }] } as any;
    const notify = m.orderNotifier({ crmStore, orders, reader });
    const order = { id: 3, reference: "PED-0003", companyId: 5, tenantId: "costa", version: 4, graceEndsAt: Date.now() + 7 * DAY } as any;
    await notify({ order, action: "quote", detail: null });
    await notify({ order, action: "confirm", detail: { basis: "admin_approval" } });
    await notify({ order, action: "confirm", detail: { basis: "payment", paymentId: 9 } });
    await notify({ order: { ...order, version: 5 }, action: "activate", detail: null });
    await notify({ order: { ...order, version: 6 }, action: "payment_failed", detail: null });
    await notify({ order: { ...order, version: 7 }, action: "cancel", detail: { cancelAt: Date.now() + 20 * DAY } });
    await notify({ order: { ...order, version: 7 }, action: "cancel", detail: { cancelAt: Date.now() + 20 * DAY } });
    expect(provider.sent.map((x) => x.tag)).toEqual(["test_payment_confirmed", "contract_confirmed", "payment_failed", "cancellation"]);
    expect(provider.sent.every((x) => x.to === "principal@pruebas.example")).toBe(true);
    expect(linkHosts(provider.sent[1].html)).toEqual(["costa.elephantsource.example"]);
    expect(provider.sent.every((x) => x.ref.startsWith("es1.p.costa."))).toBe(true);
  });
});
