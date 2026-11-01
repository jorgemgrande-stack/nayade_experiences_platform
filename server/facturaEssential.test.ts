/**
 * PDF completo de una factura de una empresa Essential (conceptos en régimen general): nada sectorial ni de la
 * instalación original. El régimen REAV solo aparece con conceptos en ese régimen.
 */
import { describe, it, expect, vi } from "vitest";
import { ORIGINAL, restosEn, visibleText } from "../shared/sinNayade";

// Sin base de datos: la empresa aún no ha guardado ajustes legales
vi.mock("./_core/legacyDb", () => ({
  legacyPool: () => ({}),
  legacyDb: () => ({ select: () => ({ from: () => ({ where: async () => [] }) }) }),
}));

const { buildInvoiceHtml } = await import("./invoiceHtml");

describe("PDF de factura de una empresa Essential", () => {
  it("sin restos de la instalación original ni vocabulario sectorial", async () => {
    const html = await buildInvoiceHtml({
      invoiceNumber: "FAC-2026-0100",
      clientName: "Lucía Pérez",
      clientEmail: "lucia@cliente.test",
      clientPhone: "600 000 000",
      clientNif: "00000000T",
      clientAddress: "Calle Mayor 1, León",
      itemsJson: [{ description: "Revisión de equipos", quantity: 2, unitPrice: 50, total: 100 }],
      subtotal: "100.00",
      taxRate: "21",
      taxAmount: "21.00",
      total: "121.00",
      issuedAt: new Date("2026-11-01"),
    });
    const text = visibleText(html);
    expect(text).not.toMatch(ORIGINAL);
    expect(text).not.toMatch(/REAV|Agencias de Viaje/i);
    expect(restosEn(text)).toEqual([]);
    expect(text).toContain("FAC-2026-0100");
  });
});
