import { describe, it, expect } from "vitest";
import { createEmailTrialNotifier, memoryEmailPort, trialEmails, trialNotifierFromEnv, type TransactionalEmailPort } from "./emailNotifier";

const VERIFY = "https://web.example/prueba-gratuita/verificar";
const TOKEN = "tok_" + "a".repeat(40);

function setup(mode: "off" | "sandbox" | "live", allowedDomains: string[] = [], port: TransactionalEmailPort | null = memoryEmailPort()) {
  const logs: Record<string, unknown>[] = [];
  const notifier = createEmailTrialNotifier({ mode, port, allowedDomains, verifyUrl: VERIFY, pricingUrl: "https://web.example/precios", log: (e) => logs.push(e) });
  return { notifier, logs, port: port as ReturnType<typeof memoryEmailPort> };
}

describe("plantillas de la prueba gratuita", () => {
  const t = trialEmails({ verifyUrl: VERIFY, pricingUrl: "https://web.example/precios" });

  it("verificación: enlace con id y token, en español", () => {
    const m = t.verification("ana@empresa.example", { trialId: 7, token: TOKEN });
    expect(m.subject).toMatch(/Confirma tu correo/);
    expect(m.text).toContain(`${VERIFY}?id=7&token=${TOKEN}`);
    expect(m.html).toContain(`href="${VERIFY}?id=7&amp;token=${TOKEN}"`);
    expect(m.tag).toBe("trial_verification");
  });

  it("bienvenida: enlace de contraseña en el dominio de la empresa; sin dominio, sin enlace", () => {
    const m = t.welcome("ana@empresa.example", { tenantId: "t7-empresa", domain: "t7-empresa.elephantsource.es", inviteToken: "inv123" });
    expect(m.text).toContain("https://t7-empresa.elephantsource.es/establecer-contrasena?token=inv123");
    const sin = t.welcome("ana@empresa.example", { tenantId: "t7-empresa", domain: null, inviteToken: "inv123" });
    expect(sin.text).not.toContain("inv123");
  });

  it("aviso de vencimiento: hoy, mañana y en N días; deja claro que nada se borra", () => {
    const endsAt = Date.UTC(2026, 9, 31, 12);
    expect(t.expiryNotice("a@b.example", { trialId: 1, endsAt, daysLeft: 0 }).subject).toMatch(/termina hoy/);
    expect(t.expiryNotice("a@b.example", { trialId: 1, endsAt, daysLeft: 1 }).subject).toMatch(/termina mañana/);
    const m = t.expiryNotice("a@b.example", { trialId: 1, endsAt, daysLeft: 3 });
    expect(m.subject).toMatch(/termina en 3 días/);
    expect(m.text).toContain("31 de octubre de 2026");
    expect(m.text).toMatch(/no se borra nada/);
  });

  it("escapa el HTML de los datos variables", () => {
    const m = trialEmails({ verifyUrl: 'https://web.example/v?x="><script>', productName: "<b>X</b>" }).verification("a@b.example", { trialId: 1, token: TOKEN });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>X</b>");
  });
});

describe("modos de envío", () => {
  it("off: no envía nada y deja constancia sin dirección ni token", async () => {
    const { notifier, logs, port } = setup("off");
    await notifier.verification("ana@empresa.example", { trialId: 7, token: TOKEN });
    expect(port.sent).toHaveLength(0);
    expect(logs).toEqual([{ event: "trial_verification_not_sent", reason: "mode_off", trialId: 7 }]);
  });

  it("sandbox: solo a los dominios permitidos", async () => {
    const { notifier, logs, port } = setup("sandbox", ["equipo.example"]);
    await notifier.verification("ana@cliente.example", { trialId: 1, token: TOKEN });
    await notifier.verification("qa@Equipo.example", { trialId: 2, token: TOKEN });
    expect(port.sent.map((m) => m.to)).toEqual(["qa@Equipo.example"]);
    expect(logs.map((l) => l.event)).toEqual(["trial_verification_not_sent", "trial_verification_sent"]);
    expect(logs[0].reason).toBe("sandbox_recipient_not_allowed");
  });

  it("live: envía a cualquiera", async () => {
    const { notifier, port } = setup("live");
    await notifier.welcome("ana@cliente.example", { tenantId: "t1-x", domain: "t1-x.elephantsource.es", inviteToken: "inv" });
    await notifier.expiryNotice("ana@cliente.example", { trialId: 1, endsAt: Date.now(), daysLeft: 1 });
    expect(port.sent.map((m) => m.tag)).toEqual(["trial_welcome", "trial_expiry"]);
  });

  it("un fallo del proveedor no rompe el alta ni filtra datos personales", async () => {
    const failing: TransactionalEmailPort = { name: "smtp", send: async () => { throw new Error(`fallo enviando a ana@cliente.example ${TOKEN}`); } };
    const { notifier, logs } = setup("live", [], failing);
    await expect(notifier.verification("ana@cliente.example", { trialId: 9, token: TOKEN })).resolves.toBeUndefined();
    expect(logs).toEqual([{ event: "trial_verification_failed", provider: "smtp", error: "Error", trialId: 9 }]);
    expect(JSON.stringify(logs)).not.toMatch(/ana@|tok_/);
  });
});

describe("configuración desde el entorno", () => {
  const smtp = { CP_TRIAL_SMTP_HOST: "smtp.example", CP_TRIAL_SMTP_USER: "u", CP_TRIAL_SMTP_PASS: "p", CP_TRIAL_EMAIL_FROM: "Elephant <no-reply@web.example>", CP_TRIAL_VERIFY_URL: VERIFY };

  it("sin variable o con valor desconocido: apagado (se mantiene el aviso que solo deja constancia)", () => {
    expect(trialNotifierFromEnv({})).toBeNull();
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "si", ...smtp })).toBeNull();
  });

  it("configuración incompleta: queda apagado y dice por qué", () => {
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "live", ...smtp, CP_TRIAL_VERIFY_URL: "http://inseguro.example" })).toMatchObject({ mode: "off", reason: "verify_url_missing" });
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "sandbox", ...smtp })).toMatchObject({ mode: "off", reason: "sandbox_without_allowed_domains" });
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "live", CP_TRIAL_VERIFY_URL: VERIFY })).toMatchObject({ mode: "off", reason: "smtp_not_configured" });
  });

  it("sandbox completo: SMTP con dominios permitidos", () => {
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "sandbox", CP_TRIAL_EMAIL_ALLOWED_DOMAINS: "equipo.example", ...smtp })).toMatchObject({ mode: "sandbox", provider: "smtp" });
  });
});
