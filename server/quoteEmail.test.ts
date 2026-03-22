/**
 * quoteEmail.test.ts
 *
 * Tests de protección para buildQuoteHtml.
 * Garantizan que el botón "Confirmar y Pagar Ahora" (CTA) siempre aparece
 * cuando se pasa paymentLinkUrl, y que nunca desaparece por regresión.
 *
 * Bug histórico: createDirect con sendNow=true no generaba token ni paymentLinkUrl
 * antes de enviar el email, por lo que el bloque ctaBlock quedaba vacío y se mostraba
 * el bloque de contacto en su lugar.
 */

import { describe, it, expect } from "vitest";
import { buildQuoteHtml } from "./emailTemplates";

const BASE_ITEMS = [
  { description: "Aventura Hinchable Acuática", quantity: 1, unitPrice: 12, total: 12 },
  { description: "Blob Jump", quantity: 3, unitPrice: 6, total: 18 },
];

const BASE_DATA = {
  quoteNumber: "PRE-2026-0001",
  title: "Propuesta Náyade Experiences",
  clientName: "Jorge Grande",
  items: BASE_ITEMS,
  subtotal: "30",
  discount: "0",
  tax: "6.30",
  total: "36.30",
};

describe("buildQuoteHtml — botón CTA de aceptación", () => {
  it("incluye el botón 'Confirmar y Pagar Ahora' cuando se pasa paymentLinkUrl", () => {
    const html = buildQuoteHtml({
      ...BASE_DATA,
      paymentLinkUrl: "https://nayade-shop-av298fs8.manus.space/presupuesto/abc123token",
    });
    expect(html).toContain("Confirmar y Pagar Ahora");
    expect(html).toContain("abc123token");
    expect(html).toContain("Pago 100% seguro");
  });

  it("el botón CTA enlaza a la URL de pago correcta", () => {
    const paymentUrl = "https://nayade-shop-av298fs8.manus.space/presupuesto/mytoken456";
    const html = buildQuoteHtml({
      ...BASE_DATA,
      paymentLinkUrl: paymentUrl,
    });
    expect(html).toContain(`href="${paymentUrl}"`);
  });

  it("muestra el bloque de contacto cuando NO se pasa paymentLinkUrl (sin botón CTA)", () => {
    const html = buildQuoteHtml({ ...BASE_DATA });
    expect(html).not.toContain("Confirmar y Pagar Ahora");
    expect(html).toContain("reservas@nayadeexperiences.es");
  });

  it("muestra el bloque de contacto cuando paymentLinkUrl es undefined", () => {
    const html = buildQuoteHtml({ ...BASE_DATA, paymentLinkUrl: undefined });
    expect(html).not.toContain("Confirmar y Pagar Ahora");
    expect(html).toContain("reservas@nayadeexperiences.es");
  });

  it("incluye los conceptos del presupuesto en el email", () => {
    const html = buildQuoteHtml({
      ...BASE_DATA,
      paymentLinkUrl: "https://example.com/presupuesto/token",
    });
    expect(html).toContain("Aventura Hinchable Acuática");
    expect(html).toContain("Blob Jump");
    expect(html).toContain("36.30");
  });

  it("incluye la fecha de validez cuando se pasa validUntil", () => {
    const html = buildQuoteHtml({
      ...BASE_DATA,
      paymentLinkUrl: "https://example.com/presupuesto/token",
      validUntil: new Date("2026-04-06"),
    });
    expect(html).toContain("válida hasta el");
  });

  it("incluye el número de presupuesto en el asunto del email", () => {
    const html = buildQuoteHtml({
      ...BASE_DATA,
      paymentLinkUrl: "https://example.com/presupuesto/token",
    });
    expect(html).toContain("PRE-2026-0001");
  });
});
