/**
 * Tests para la plantilla de email de confirmación de pago por transferencia bancaria.
 * Verifica que buildTransferConfirmationHtml genera el HTML correcto con todos los campos
 * específicos de una confirmación de transferencia (número de factura, agente validador, etc.).
 */
import { describe, it, expect } from "vitest";
import { buildTransferConfirmationHtml } from "./emailTemplates";

const mockData = {
  clientName: "Eva Longoria",
  invoiceNumber: "FAC-2026-0001",
  reservationRef: "RES-M3K9XZ",
  quoteNumber: "PRE-2026-0001",
  quoteTitle: "Pack Aventura Náyade — Eva Longoria",
  items: [
    { description: "Blob Jump (10 saltos)", quantity: 1, unitPrice: 100, total: 100 },
    { description: "Banana Ski (1 vuelta)", quantity: 2, unitPrice: 21.65, total: 43.30 },
  ],
  subtotal: "118.50",
  taxAmount: "24.89",
  total: "143.39",
  invoiceUrl: "https://cdn.example.com/invoices/FAC-2026-0001.pdf",
  confirmedBy: "Admin Náyade",
  confirmedAt: new Date("2026-03-22T18:00:00Z"),
};

describe("buildTransferConfirmationHtml", () => {
  it("incluye el nombre del cliente en el saludo", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("Eva Longoria");
  });

  it("incluye el número de factura generada", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("FAC-2026-0001");
  });

  it("incluye el número de presupuesto original", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("PRE-2026-0001");
  });

  it("incluye el nombre del agente que validó el pago", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("Admin Náyade");
  });

  it("incluye todos los conceptos del presupuesto", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("Blob Jump (10 saltos)");
    expect(html).toContain("Banana Ski (1 vuelta)");
  });

  it("incluye subtotal, IVA y total correctamente formateados", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("118.50");
    expect(html).toContain("24.89");
    expect(html).toContain("143.39");
  });

  it("incluye el enlace de descarga de la factura PDF cuando se proporciona", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("https://cdn.example.com/invoices/FAC-2026-0001.pdf");
    expect(html).toContain("Descargar Factura");
  });

  it("no incluye el bloque de descarga si no hay URL de factura", () => {
    const { invoiceUrl: _, ...dataWithoutInvoice } = mockData;
    const html = buildTransferConfirmationHtml(dataWithoutInvoice);
    expect(html).not.toContain("Descargar Factura");
  });

  it("menciona explícitamente que el pago fue por transferencia bancaria", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html.toLowerCase()).toContain("transferencia");
  });

  it("incluye el asunto correcto en el título del email", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("FAC-2026-0001");
    expect(html).toContain("Pago confirmado");
  });

  it("genera HTML válido con estructura completa de email", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain("</html>");
    expect(html).toContain("N&Aacute;YADE");
  });

  it("incluye los datos de contacto de Náyade Experiences", () => {
    const html = buildTransferConfirmationHtml(mockData);
    expect(html).toContain("reservas@nayadeexperiences.es");
    expect(html).toContain("+34 930 34 77 91");
  });

  it("funciona sin campos opcionales (invoiceUrl, confirmedBy, confirmedAt, quoteNumber)", () => {
    const minimalData = {
      clientName: "Test Cliente",
      invoiceNumber: "FAC-2026-0099",
      reservationRef: "RES-TEST01",
      quoteTitle: "Pack Básico",
      items: [{ description: "Kayak", quantity: 1, unitPrice: 20, total: 20 }],
      subtotal: "16.53",
      taxAmount: "3.47",
      total: "20.00",
    };
    expect(() => buildTransferConfirmationHtml(minimalData)).not.toThrow();
    const html = buildTransferConfirmationHtml(minimalData);
    expect(html).toContain("Test Cliente");
    expect(html).toContain("FAC-2026-0099");
    expect(html).toContain("20.00");
  });

  it("el asunto del email incluye el número de factura (verificación del subject en el title)", () => {
    const html = buildTransferConfirmationHtml(mockData);
    // El wrapper pone el invoiceNumber en el <title>
    expect(html).toContain("FAC-2026-0001");
  });
});
