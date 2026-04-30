/**
 * Tests para la plantilla de email de confirmación de pago de presupuesto.
 * Verifica que buildConfirmationHtml genera el HTML correcto con todos los campos.
 */
import { describe, it, expect } from "vitest";
import { buildConfirmationHtml } from "./emailTemplates";

const mockData = {
  clientName: "Cristina Battistelli",
  reservationRef: "FAC-2026-03-22-ABC123",
  quoteNumber: "PRE-2026-0007",
  quoteTitle: "Presupuesto Náyade Experiences - Cristina Battistelli",
  items: [
    { description: "Cableski & Wakeboard Dia Completo", quantity: 1, unitPrice: 4500, total: 4500 },
    { description: "Blob Jump", quantity: 2, unitPrice: 600, total: 1200 },
  ],
  subtotal: "57.00",
  taxAmount: "11.97",
  total: "68.97",
  bookingDate: "2026-04-15",
  contactEmail: "reservas@nayadeexperiences.es",
  contactPhone: "+34 911 67 51 89",
};

describe("buildConfirmationHtml", () => {
  it("incluye el nombre del cliente en el saludo", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("Cristina Battistelli");
  });

  it("incluye la referencia de factura", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("FAC-2026-03-22-ABC123");
  });

  it("incluye el número de presupuesto original", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("PRE-2026-0007");
  });

  it("incluye todos los conceptos del presupuesto", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("Cableski & Wakeboard Dia Completo");
    expect(html).toContain("Blob Jump");
  });

  it("incluye subtotal, IVA y total", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("57.00");
    expect(html).toContain("11.97");
    expect(html).toContain("68.97");
  });

  it("incluye la fecha de la actividad cuando se proporciona", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("2026-04-15");
  });

  it("no incluye bloque de fecha si no se proporciona bookingDate", () => {
    const { bookingDate: _, ...dataWithoutDate } = mockData;
    const html = buildConfirmationHtml(dataWithoutDate);
    // No debe haber el bloque de fecha de actividad
    expect(html).not.toContain("Fecha de la actividad");
  });

  it("incluye el email de contacto correcto", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("reservas@nayadeexperiences.es");
  });

  it("incluye el teléfono de contacto correcto", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("+34 911 67 51 89");
  });

  it("usa los valores por defecto de contacto cuando no se proporcionan", () => {
    const { contactEmail: _e, contactPhone: _p, ...dataWithoutContact } = mockData;
    const html = buildConfirmationHtml(dataWithoutContact);
    expect(html).toContain("reservas@nayadeexperiences.es");
    expect(html).toContain("+34 911 67 51 89");
  });

  it("genera HTML válido con estructura de email", () => {
    const html = buildConfirmationHtml(mockData);
    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain("</html>");
    expect(html).toContain("Reserva Confirmada");
  });

  it("funciona sin campos opcionales (subtotal, taxAmount, bookingDate, quoteNumber)", () => {
    const minimalData = {
      clientName: "Test Cliente",
      reservationRef: "FAC-2026-01-01-TEST",
      quoteTitle: "Pack Básico",
      items: [{ description: "Kayak", quantity: 1, unitPrice: 2000, total: 2000 }],
      total: "20.00",
    };
    expect(() => buildConfirmationHtml(minimalData)).not.toThrow();
    const html = buildConfirmationHtml(minimalData);
    expect(html).toContain("Test Cliente");
    expect(html).toContain("FAC-2026-01-01-TEST");
  });
});
