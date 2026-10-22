/**
 * Plantillas PDF del sistema: en cualquier modo, nombre, web y contacto de la empresa (nunca los de la instalación
 * original, que solo quedan como texto de ejemplo dentro del código).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const brand = vi.hoisted(() => ({ multi: false }));
const SETTINGS: Record<string, string> = { brand_nif: "B99999999", brand_address: "Calle Sol 3, Granada", brand_phone: "+34 958 000 000", site_business_email: "hola@aventurassierra.es" };
vi.mock("./tenantBrand", () => ({
  companyName: () => "Aventuras Sierra",
  legacySiteHost: () => (brand.multi ? "www.aventurassierra.es" : ""),
  brandSetting: (key: string) => SETTINGS[key] ?? "",
}));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));

const { SYSTEM_PDF_TEMPLATES, brandedPdfTemplate } = await import("./routers/pdfTemplatesRouter");

const ORIGINAL = /N[aá]yade|skicenter|Embalse|639 57 66 27/;

describe("marca de las plantillas PDF del sistema", () => {
  beforeEach(() => {
    brand.multi = false;
  });

  it.each([false, true])("multiempresa=%s: ningún dato de la instalación original y los de la empresa en su lugar", (multi) => {
    brand.multi = multi;
    for (const tpl of SYSTEM_PDF_TEMPLATES) {
      const out = brandedPdfTemplate(tpl);
      for (const field of ["companyName", "companyAddress", "companyPhone", "companyEmail", "footerText", "bodyHtml"] as const) {
        expect(String(out[field]), `${tpl.id}.${field}`).not.toMatch(ORIGINAL);
      }
      expect(out.companyName).toBe("Aventuras Sierra");
      expect(out.companyNif).toBe("B99999999");
      expect(out.companyEmail).toBe("hola@aventurassierra.es");
    }
    expect(brandedPdfTemplate(SYSTEM_PDF_TEMPLATES[0]).footerText).toBe(multi ? "Gracias por confiar en Aventuras Sierra · www.aventurassierra.es" : "Gracias por confiar en Aventuras Sierra");
  });
});
