/**
 * Correos transaccionales del recorrido Essential (recuperación de contraseña e invitación al equipo):
 *  - multi: identidad de la empresa en curso; ningún resto de Náyade (cabecera, pie, lema, teléfono,
 *    correo, logotipo).
 *  - single (Náyade): la cabecera y el pie de siempre.
 * Sin red: el envío está sustituido por un buzón en memoria.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ byTenant: {} as Record<string, Record<string, string>> }));
const outbox = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string; text?: string }>);
vi.mock("./config", async () => {
  const { peekTenantContext } = await import("./_core/tenant");
  const get = (k: string, fb = "") => settings.byTenant[peekTenantContext()?.tenantId ?? "default"]?.[k] || fb;
  return { getSystemSettingSync: get, getSystemSetting: async (k: string, fb = "") => get(k, fb) };
});
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text?: string }) => (outbox.push(m), true)) }));
vi.mock("./emailManager", () => ({ logDirectEmail: vi.fn(async () => undefined) }));

import { runWithTenant } from "./_core/tenant";
import { buildInviteHtml, buildPasswordResetHtml } from "./emailTemplates";
import { sendInviteEmail } from "./inviteEmail";

/** Cualquier resto de Náyade: nombre (con o sin entidades HTML), lema, teléfono, correo, dominio o CDN. */
const NAYADE = /n(?:á|a|&aacute;|&Aacute;)yade|N&Aacute;YADE|EXPERIENCES|Vive el verano|639\s?57|nayadeexperiences|cloudfront/i;
const saved = process.env.TENANT_MODE;

beforeEach(() => {
  outbox.length = 0;
  settings.byTenant = {
    montana: {
      brand_name: "Montaña Ejemplo",
      brand_logo_url: "https://cdn.montana.example/logo.png",
      brand_phone: "+34 600 000 001",
      email_reservations: "hola@montana.example",
      brand_location: "Calle Cumbre 1, Pico",
    },
    // Empresa recién creada: solo su nombre
    costa: { brand_name: "Costa <Ejemplo>" },
  };
});
afterEach(() => {
  if (saved === undefined) delete process.env.TENANT_MODE;
  else process.env.TENANT_MODE = saved;
});

describe("multi: correos con la identidad de la empresa", () => {
  beforeEach(() => void (process.env.TENANT_MODE = "multi"));

  it("recuperación de contraseña: cabecera y pie de la empresa, sin Náyade", async () => {
    const html = await runWithTenant("montana", async () => buildPasswordResetHtml({ name: "Ana", resetUrl: "https://montana.example/nueva-contrasena?token=x", expiryMinutes: 60 }));
    expect(html).not.toMatch(NAYADE);
    expect(html).toContain("Montaña Ejemplo");
    expect(html).toContain("&copy; " + new Date().getFullYear() + " MONTAÑA EJEMPLO");
    expect(html).toContain("hola@montana.example");
    expect(html).toContain("https://cdn.montana.example/logo.png");
  });

  it("empresa sin datos de contacto ni logotipo: nada de otra empresa y el nombre escapado", async () => {
    const html = await runWithTenant("costa", async () => buildPasswordResetHtml({ name: "Luis", resetUrl: "https://costa.example/x", expiryMinutes: 60 }));
    expect(html).not.toMatch(NAYADE);
    expect(html).toContain("Costa &lt;Ejemplo&gt;");
    expect(html).not.toContain("<Ejemplo>");
    expect(html).not.toContain('href="tel:"');
    expect(html).not.toContain('href="mailto:"');
    expect(html).not.toMatch(/<img src=""/);
  });

  it("invitación al equipo (asunto, HTML y texto), incluido el rol de solo lectura", async () => {
    await runWithTenant("montana", () => sendInviteEmail({ name: "Eva", email: "eva@montana.example", setPasswordUrl: "https://montana.example/establecer-contrasena?token=x", role: "readonly" }));
    expect(outbox).toHaveLength(1);
    const m = outbox[0];
    expect(m.subject).toBe("Te han invitado a Montaña Ejemplo en Big Elephant");
    for (const part of [m.subject, m.html, m.text ?? ""]) expect(part).not.toMatch(NAYADE);
    expect(m.html).toContain("Montaña Ejemplo");
    expect(m.html).toContain("Solo lectura");
  });
});

describe("instalación de una sola empresa: la misma identidad que cualquier empresa (sus ajustes)", () => {
  beforeEach(() => void delete process.env.TENANT_MODE);

  it("cabecera, pie e invitación con su nombre; nunca la marca de Náyade", () => {
    settings.byTenant = { default: { brand_name: "Empresa Única" } };
    const html = buildPasswordResetHtml({ name: "Ana", resetUrl: "https://example.com/x", expiryMinutes: 60 });
    expect(html).toContain("Empresa Única");
    const invite = buildInviteHtml({ name: "Eva", role: "agente", setPasswordUrl: "https://example.com/x" });
    expect(invite).toContain("Plataforma de Gesti&oacute;n de Empresa Única");
    expect(invite).toContain("<strong>Empresa Única</strong>");
    expect(invite).toContain("Comercial");
    expect(invite).not.toContain("Agente Comercial");
    for (const h of [html, invite]) expect(h).not.toMatch(/N&Aacute;YADE|N&aacute;yade|EXPERIENCES<\/td>|Vive el verano/);
  });
});
