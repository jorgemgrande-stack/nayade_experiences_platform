/**
 * Plantillas de email del sistema: en multiempresa, asunto y cabecera con el nombre de la empresa (nunca el de la
 * instalación original); en la instalación original, tal cual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const brand = vi.hoisted(() => ({ name: "Náyade Experiences" }));
vi.mock("./tenantBrand", () => ({ legacyBrandText: (literal: string) => (brand.name === literal ? literal : brand.name) }));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));

const { brandedTemplateTexts } = await import("./routers/emailTemplatesRouter");

const tpl = {
  subject: "Reserva confirmada · Náyade Experiences",
  headerTitle: "¡Reserva Confirmada!",
  headerSubtitle: "Tu aventura en el lago está asegurada",
};

describe("marca de las plantillas de email del sistema", () => {
  beforeEach(() => {
    brand.name = "Náyade Experiences";
  });

  it("instalación original: sin cambios", () => {
    expect(brandedTemplateTexts(tpl)).toEqual(tpl);
  });

  it("multiempresa: el nombre de la empresa y sin la mención al lago", () => {
    brand.name = "Aventuras Sierra";
    expect(brandedTemplateTexts(tpl)).toEqual({
      subject: "Reserva confirmada · Aventuras Sierra",
      headerTitle: "¡Reserva Confirmada!",
      headerSubtitle: "Tu reserva está asegurada",
    });
    expect(brandedTemplateTexts({ ...tpl, headerSubtitle: "Gracias por tu compra en Náyade Experiences" }).headerSubtitle).toBe("Gracias por tu compra en Aventuras Sierra");
  });

  it("multiempresa sin nombre: ni rastro de la instalación original", () => {
    brand.name = "";
    const out = brandedTemplateTexts({ ...tpl, headerSubtitle: "Gracias por tu compra en Náyade Experiences" });
    expect(out.subject).toBe("Reserva confirmada");
    expect(out.headerSubtitle).toBe("Gracias por tu compra");
  });
});
