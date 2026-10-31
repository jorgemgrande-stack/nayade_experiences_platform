/**
 * Presupuestos y cobros sin líneas a 0 € por falta de precio. Adaptado de Skicenter
 * (shared/quoteUnpricedLines.ts 1b89f9c8, server/checkoutLinePricing.ts 86731055).
 */
import { describe, it, expect } from "vitest";
import { findUnpricedCatalogLines, formatUnpricedLines } from "../shared/quoteUnpricedLines";
import { assertQuotePricedForSend } from "./quoteSendGuards";
import { decideCheckoutLinePrice, assertCheckoutLinePriced } from "./checkoutLinePricing";

describe("presupuestos: productos del catálogo a 0 €", () => {
  it("detecta el producto del catálogo con importe 0 o vacío", () => {
    expect(findUnpricedCatalogLines([
      { description: "Curso intensivo", quantity: 2, unitPrice: 0, total: 0, productId: 7 } as any,
      { description: "Servicio con precio", quantity: 1, total: 40, productId: 8 },
      { description: "Sin importe", quantity: 1, total: null, productId: 9 },
    ])).toEqual([{ name: "Curso intensivo", quantity: 2 }, { name: "Sin importe", quantity: 1 }]);
  });

  it("respeta las líneas libres, los descuentos y el precio fijado a mano", () => {
    expect(findUnpricedCatalogLines([
      { description: "Regalo", quantity: 1, total: 0 },
      { description: "Con descuento total", quantity: 1, total: 0, productId: 1, discountPercent: 100 },
      { description: "Precio a mano", quantity: 1, total: 0, productId: 2, manualPriceOverride: true },
    ])).toEqual([]);
    expect(findUnpricedCatalogLines(null)).toEqual([]);
    expect(findUnpricedCatalogLines(undefined)).toEqual([]);
  });

  it("explica en español qué hacer", () => {
    expect(formatUnpricedLines([{ name: "Curso", quantity: 1 }])).toMatch(/^No se puede enviar el presupuesto: el producto «Curso» tiene un importe de 0,00 €/);
    expect(formatUnpricedLines([{ name: "A", quantity: 1 }, { name: "B", quantity: 1 }])).toMatch(/los productos «A», «B» tienen/);
  });

  it("el envío se rechaza con PRECONDITION_FAILED; con precio pasa", () => {
    expect(() => assertQuotePricedForSend([{ description: "Curso", quantity: 1, total: 0, productId: 3 }])).toThrow(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
    expect(() => assertQuotePricedForSend([{ description: "Curso", quantity: 1, total: 10, productId: 3 }])).not.toThrow();
    expect(() => assertQuotePricedForSend(null)).not.toThrow();
  });
});

describe("cobro online: una línea sin precio se bloquea", () => {
  it("solo un importe > 0 se cobra", () => {
    expect(decideCheckoutLinePrice(25)).toEqual({ ok: true, total: 25 });
    for (const v of [0, -5, Number.NaN]) expect(decideCheckoutLinePrice(v).ok).toBe(false);
  });
  it("el bloqueo avisa al cliente de que no se ha cobrado", () => {
    expect(() => assertCheckoutLinePriced("Clase", 0)).toThrow(/no se ha realizado ningún cobro/);
  });
});
