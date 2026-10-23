/**
 * Plantillas de email del sistema: asunto y cabecera con la marca de la empresa en cualquier modo (marcador
 * `{{marca}}`); sin marca configurada, sin ella. Nunca el nombre de otra empresa ni de la instalación original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const brand = vi.hoisted(() => ({ name: "Aventuras Sierra" }));
vi.mock("./tenantBrand", () => ({ brandName: () => brand.name }));
vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));

const { brandedTemplateTexts, BRAND_TOKEN } = await import("./routers/emailTemplatesRouter");

const tpl = {
  subject: `Reserva confirmada · ${BRAND_TOKEN}`,
  headerTitle: "¡Reserva Confirmada!",
  headerSubtitle: "Tu aventura en el lago está asegurada",
};

describe("marca de las plantillas de email del sistema", () => {
  beforeEach(() => {
    brand.name = "Aventuras Sierra";
  });

  it("el nombre de la empresa y sin la mención al lago", () => {
    expect(brandedTemplateTexts(tpl)).toEqual({
      subject: "Reserva confirmada · Aventuras Sierra",
      headerTitle: "¡Reserva Confirmada!",
      headerSubtitle: "Tu reserva está asegurada",
    });
    expect(brandedTemplateTexts({ ...tpl, headerSubtitle: `Gracias por tu compra en ${BRAND_TOKEN}` }).headerSubtitle).toBe("Gracias por tu compra en Aventuras Sierra");
  });

  it("sin marca configurada: sin nombre, sin marcador", () => {
    brand.name = "";
    const out = brandedTemplateTexts({ ...tpl, headerSubtitle: `Gracias por tu compra en ${BRAND_TOKEN}` });
    expect(out.subject).toBe("Reserva confirmada");
    expect(out.headerSubtitle).toBe("Gracias por tu compra");
  });

  it("los textos de las plantillas no llevan la marca de ninguna empresa, solo el marcador", () => {
    const src = fs.readFileSync(new URL("./routers/emailTemplatesRouter.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/N[aá]yade|skicenter/i);
    expect((src.match(/ · \{\{marca\}\}",/g) ?? []).length).toBeGreaterThanOrEqual(25);
  });
});
