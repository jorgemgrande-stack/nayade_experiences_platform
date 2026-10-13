/**
 * Correo en multiempresa: el remitente nunca es el de Náyade; sin remitente no se envía;
 * no se usa el SMTP global del entorno.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("./config", () => ({
  getSystemSettingSync: (k: string, fb = "") => settings.values[k] ?? fb,
  getSystemSetting: async (k: string, fb = "") => settings.values[k] ?? fb,
}));

import { sendEmail, resolveTenantSender } from "./mailer";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  calls = [];
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
  delete process.env.BREVO_API_KEY;
  delete process.env.SMTP_FROM;
  delete process.env.PLATFORM_MAIL_FROM;
});

describe("correo en multi", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
  });

  it("usa el remitente de plataforma con el nombre del tenant y Reply-To del tenant", async () => {
    process.env.PLATFORM_MAIL_FROM = "no-reply@mail.elephantsource.es";
    settings.values = { brand_name: "Hotel Sol", email_reservations: "reservas@hotelsol.example" };
    const { runWithTenant } = await import("./_core/tenant");
    const ok = await runWithTenant("hotel-sol", () => sendEmail({ to: "cliente@x.example", subject: "Hola", html: "<p>x</p>" }));
    expect(ok).toBe(true);
    expect(calls[0].body.sender).toEqual({ name: "Hotel Sol", email: "no-reply@mail.elephantsource.es" });
    expect(calls[0].body.replyTo).toEqual({ email: "reservas@hotelsol.example" });
    expect(JSON.stringify(calls[0].body)).not.toMatch(/nayade/i);
    expect(calls[0].body.cc).toBeUndefined(); // sin CC global de Náyade
  });

  it("prefiere el remitente propio del tenant", async () => {
    process.env.PLATFORM_MAIL_FROM = "no-reply@mail.elephantsource.es";
    settings.values = { brand_name: "Hotel Sol", email_noreply_sender: "noreply@hotelsol.example" };
    expect(resolveTenantSender()?.from).toBe("Hotel Sol <noreply@hotelsol.example>");
  });

  it("sin remitente ni marca configurados no se envía", async () => {
    const { runWithTenant } = await import("./_core/tenant");
    const ok = await runWithTenant("nuevo", () => sendEmail({ to: "c@x.example", subject: "s", html: "h" }));
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("si Brevo falla no cae al SMTP global", async () => {
    process.env.PLATFORM_MAIL_FROM = "no-reply@mail.elephantsource.es";
    settings.values = { brand_name: "Hotel Sol" };
    globalThis.fetch = (async () => ({ ok: false, status: 500, text: async () => "boom" }) as unknown as Response) as typeof fetch;
    const { runWithTenant } = await import("./_core/tenant");
    const ok = await runWithTenant("hotel-sol", () => sendEmail({ to: "c@x.example", subject: "s", html: "h" }));
    expect(ok).toBe(false);
  });
});

describe("correo en single (sin cambios)", () => {
  it("mantiene SMTP_FROM y la copia global", async () => {
    settings.values = { brand_name: "Náyade" };
    const ok = await sendEmail({ to: "c@x.example", subject: "s", html: "h" });
    expect(ok).toBe(true);
    expect(calls[0].body.sender.email).toBe("reservas@nayadeexperiences.es");
    expect(calls[0].body.cc).toEqual([{ email: "reservas@nayadeexperiences.es" }]);
  });
});
