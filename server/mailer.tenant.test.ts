/**
 * Correo en multiempresa: `sendEmail` pasa SIEMPRE por el servicio centralizado (bandeja de salida de la
 * empresa, MAIL_MODE, remitente de plataforma): nunca el envío directo con el remitente de Náyade ni el
 * SMTP global. En single sin MAIL_MODE, exactamente como antes. El envío real con dos empresas sobre
 * MySQL está en `server/mail.outbox.mysql.test.ts`.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("./config", () => ({
  getSystemSettingSync: (k: string, fb = "") => settings.values[k] ?? fb,
  getSystemSetting: async (k: string, fb = "") => settings.values[k] ?? fb,
}));
const outbox = vi.hoisted(() => ({ calls: [] as any[], result: true }));
vi.mock("./mail/tenantMail", async (orig) => ({
  ...(await orig<typeof import("./mail/tenantMail")>()),
  sendTenantMail: async (p: unknown) => (outbox.calls.push(p), outbox.result),
}));

import { sendEmail, resolveTenantSender } from "./mailer";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  calls = [];
  outbox.calls = [];
  outbox.result = true;
  settings.values = {};
  process.env.BREVO_API_KEY = "brevo-test";
  process.env.SMTP_FROM = "Náyade <reservas@nayadeexperiences.es>";
  process.env.GLOBAL_CC_EMAIL = "reservas@nayadeexperiences.es";
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ messageId: "m1" }), text: async () => "" } as unknown as Response;
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TENANT_MODE;
  delete process.env.MAIL_MODE;
  delete process.env.BREVO_API_KEY;
  delete process.env.SMTP_FROM;
  delete process.env.PLATFORM_MAIL_FROM;
});

describe("correo en multi", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
  });

  it("va a la bandeja de salida de la empresa con su categoría; nada de envío directo ni copia global de Náyade", async () => {
    settings.values = { brand_name: "Hotel Sol", email_reservations: "reservas@hotelsol.example" };
    const { runWithTenant } = await import("./_core/tenant");
    const ok = await runWithTenant("hotel-sol", () => sendEmail({ to: "cliente@x.example", subject: "Hola", html: "<p>x</p>", category: "user_invite" }));
    expect(ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(outbox.calls).toHaveLength(1);
    expect(outbox.calls[0]).toMatchObject({ to: "cliente@x.example", category: "user_invite" });
    expect(JSON.stringify(outbox.calls[0])).not.toMatch(/nayade/i);
  });

  it("la copia de la empresa (email_cc_all) nunca va en los correos con enlaces de acceso; en el resto, sí", async () => {
    settings.values = { brand_name: "Hotel Sol", email_cc_all: "copia@hotelsol.example" };
    const { runWithTenant } = await import("./_core/tenant");
    for (const category of ["password_reset", "user_invite", "email_verification", "tenant_welcome"] as const)
      await runWithTenant("hotel-sol", () => sendEmail({ to: "u@x.example", subject: "Acceso", html: "<p>enlace</p>", category }));
    await runWithTenant("hotel-sol", () => sendEmail({ to: "c@x.example", subject: "Reserva", html: "<p>r</p>" }));
    expect(outbox.calls).toHaveLength(5);
    for (const c of outbox.calls.slice(0, 4)) expect(JSON.stringify(c)).not.toContain("copia@hotelsol.example");
    expect(JSON.stringify(outbox.calls[4])).toContain("copia@hotelsol.example");
  });

  it("si la bandeja no lo acepta, devuelve false y no cae a Brevo directo ni al SMTP global", async () => {
    outbox.result = false;
    const { runWithTenant } = await import("./_core/tenant");
    const ok = await runWithTenant("hotel-sol", () => sendEmail({ to: "c@x.example", subject: "s", html: "h" }));
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("resolveTenantSender (envío heredado) sigue prefiriendo el remitente propio", async () => {
    process.env.PLATFORM_MAIL_FROM = "no-reply@mail.elephantsource.es";
    settings.values = { brand_name: "Hotel Sol", email_noreply_sender: "noreply@hotelsol.example" };
    expect(resolveTenantSender()?.from).toBe("Hotel Sol <noreply@hotelsol.example>");
  });
});

describe("correo en single", () => {
  it("sin MAIL_MODE: sin cambios (SMTP_FROM y la copia global)", async () => {
    settings.values = { brand_name: "Náyade" };
    const ok = await sendEmail({ to: "c@x.example", subject: "s", html: "h" });
    expect(ok).toBe(true);
    expect(outbox.calls).toHaveLength(0);
    expect(calls[0].body.sender.email).toBe("reservas@nayadeexperiences.es");
    expect(calls[0].body.cc).toEqual([{ email: "reservas@nayadeexperiences.es" }]);
  });

  it("sin MAIL_MODE: la recuperación de contraseña no lleva la copia global", async () => {
    settings.values = { brand_name: "Náyade" };
    await sendEmail({ to: "c@x.example", subject: "s", html: "h", category: "password_reset" });
    expect(calls[0].body.cc).toBeUndefined();
  });

  it("con MAIL_MODE definido: pasa por el servicio centralizado", async () => {
    process.env.MAIL_MODE = "off";
    await sendEmail({ to: "c@x.example", subject: "s", html: "h" });
    expect(outbox.calls).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});
