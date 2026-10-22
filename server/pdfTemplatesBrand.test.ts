/**
 * Plantillas PDF del sistema: en multiempresa, nombre, web y contacto de la empresa (nunca los de la instalación
 * original); en la instalación original, tal cual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const brand = vi.hoisted(() => ({ multi: false }));
const SETTINGS: Record<string, string> = { brand_nif: "B99999999", brand_address: "Calle Sol 3, Granada", brand_phone: "+34 958 000 000", site_business_email: "hola@aventurassierra.es" };
vi.mock("./tenantBrand", () => ({
  legacyBrandText: (literal: string) => (brand.multi ? "Aventuras Sierra" : literal),
  legacySiteHost: (literal: string) => (brand.multi ? "www.aventurassierra.es" : literal),
  brandSetting: (key: string, fallback: string) => (brand.multi ? (SETTINGS[key] ?? "") : fallback),
  legacyBrandSetting: (key: string, literal: string) => (brand.multi ? (SETTINGS[key] ?? "") : literal),
}));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));

const { SYSTEM_PDF_TEMPLATES, brandedPdfTemplate } = await import("./routers/pdfTemplatesRouter");

const ORIGINAL = /N[aá]yade|skicenter|Embalse|639 57 66 27/;

describe("marca de las plantillas PDF del sistema", () => {
  beforeEach(() => {
    brand.multi = false;
  });

  it("instalación original: sin cambios", () => {
    for (const tpl of SYSTEM_PDF_TEMPLATES) expect(brandedPdfTemplate(tpl)).toBe(tpl);
    expect(SYSTEM_PDF_TEMPLATES.find((t) => t.id === "quote_pdf")!.bodyHtml).toMatch(/Náyade/);
  });

  it("multiempresa: ningún dato de la instalación original y los de la empresa en su lugar", () => {
    brand.multi = true;
    for (const tpl of SYSTEM_PDF_TEMPLATES) {
      const out = brandedPdfTemplate(tpl);
      for (const field of ["companyName", "companyAddress", "companyPhone", "companyEmail", "footerText", "bodyHtml"] as const) {
        expect(String(out[field]), `${tpl.id}.${field}`).not.toMatch(ORIGINAL);
      }
      expect(out.companyName).toBe("Aventuras Sierra");
      expect(out.companyNif).toBe("B99999999");
      expect(out.companyEmail).toBe("hola@aventurassierra.es");
    }
    expect(brandedPdfTemplate(SYSTEM_PDF_TEMPLATES[0]).footerText).toBe("Gracias por confiar en Aventuras Sierra · www.aventurassierra.es");
  });
});
