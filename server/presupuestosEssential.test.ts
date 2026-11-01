/**
 * Presupuestos y facturas de una empresa Essential: condiciones y texto legal sin «Sujeto a disponibilidad» (solo con
 * reservas), plantillas PDF sin restos de la instalación original y PDF completos revisados.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ORIGINAL, restosEn, visibleText } from "../shared/sinNayade";
import { buildVocabulary } from "../shared/vocabulary";

vi.mock("./tenantBrand", () => ({
  companyName: () => "Asesoría Norte",
  brandName: () => "Asesoría Norte",
  legacySiteHost: () => "",
  brandSetting: (k: string) => ({ brand_name: "Asesoría Norte", brand_short_name: "Asesoría Norte" } as Record<string, string>)[k] ?? "",
}));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));

const { SYSTEM_PDF_TEMPLATES, brandedPdfTemplate } = await import("./routers/pdfTemplatesRouter");
const { renderEmailAs } = await import("./emailVocabulary");
const { buildQuotePdfHtml } = await import("./emailTemplates");

const ESSENTIAL_VOC = buildVocabulary({ licensed: true, can: () => false });
const quoteTpl = SYSTEM_PDF_TEMPLATES.find((t) => t.id === "quote_pdf")!;

describe("texto legal y condiciones del presupuesto", () => {
  it("Essential: sin «Sujeto a disponibilidad»; instalación propia o con reservas: el de siempre", () => {
    expect(renderEmailAs(true, () => brandedPdfTemplate(quoteTpl).legalText)).toBe("Presupuesto válido según las condiciones indicadas.");
    expect(renderEmailAs(false, () => brandedPdfTemplate(quoteTpl).legalText)).toContain("Sujeto a disponibilidad");
    expect(ESSENTIAL_VOC.quoteConditions).toBe("Presupuesto válido por 15 días.");
  });

  it("el panel toma las condiciones por defecto del vocabulario (y siguen a las licencias hasta que se editan)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/crm/CRMDashboard.tsx"), "utf8");
    expect(src).not.toContain("Sujeto a disponibilidad");
    expect(src.split("useVocabularyDefault(voc.quoteConditions)").length - 1).toBe(2);
  });
});

describe("plantillas PDF del sistema para una empresa Essential", () => {
  it.each(SYSTEM_PDF_TEMPLATES.map((t) => [t.id, t] as const))("%s: sin restos de la instalación original", (_id, tpl) => {
    const out = renderEmailAs(true, () => brandedPdfTemplate(tpl));
    const text = visibleText([out.name, out.description, out.legalText, out.footerText, out.bodyHtml].join(" | "));
    expect(text).not.toMatch(/N[AÁaá]YADE|EXPERIENCES/i);
    expect(restosEn(text)).toEqual([]);
    expect(out.bodyHtml).toContain("Asesoría Norte");
  });
});

describe("PDF completo del presupuesto", () => {
  it("Essential: marca de la empresa, condiciones genéricas y nada sectorial", () => {
    const html = renderEmailAs(true, () =>
      buildQuotePdfHtml({
        quoteNumber: "PRE-2026-0007",
        title: "Mantenimiento anual",
        clientName: "Lucía Pérez",
        clientEmail: "lucia@cliente.test",
        items: [{ description: "Revisión de equipos", quantity: 2, unitPrice: 50, total: 100 }],
        subtotal: "100",
        discount: "0",
        tax: "21",
        total: "121",
        validUntil: new Date("2026-12-01"),
        notes: null,
        conditions: ESSENTIAL_VOC.quoteConditions,
        paymentLinkUrl: "https://asesorianorte.test/pago/PRE-2026-0007",
        createdAt: new Date("2026-11-01"),
        issuerName: "Asesoría Norte SL",
        issuerCif: "B00000000",
        issuerAddress: "Calle Mayor 1, León",
      }),
    );
    const text = visibleText(html);
    expect(text).not.toMatch(ORIGINAL);
    expect(text).not.toMatch(/Experiences/i);
    expect(restosEn(text)).toEqual([]);
    expect(text).toContain("Presupuesto válido por 15 días.");
    expect(text).toContain("Asesoría Norte");
  });
});
