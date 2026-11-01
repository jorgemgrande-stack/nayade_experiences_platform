import { describe, it, expect } from "vitest";
import {
  computeTpvReport,
  madridRangeMs,
  prorateCents,
  rangeDays,
  reportSectionCsv,
  saleDateKey,
  type ReportItemRow,
  type ReportPaymentRow,
  type ReportSaleRow,
  type ReportSessionRow,
  type TpvReportInput,
} from "./tpvReports";

const at = (iso: string) => Date.parse(iso);

function sale(o: Partial<ReportSaleRow> & { id: number }): ReportSaleRow {
  return {
    ticketNumber: `T-${o.id}`, sessionId: 1, registerId: 1, registerName: "Mostrador", status: "paid", total: "0",
    discountAmount: "0", paidAt: at("2026-06-10T10:00:00Z"), createdAt: at("2026-06-10T10:00:00Z"),
    sellerUserId: 1, sellerName: "Ana", cashierName: "Ana", customerName: null, ...o,
  };
}
function line(o: Partial<ReportItemRow> & { saleId: number }): ReportItemRow {
  return {
    productType: "experience", productId: 1, productName: "Corte", isManual: false, conceptText: null, categoryName: "Peluquería",
    quantity: 1, subtotal: "0", taxRate: "21", taxBase: "0", taxAmount: "0", fiscalRegime: "general", ...o,
  };
}
const pay = (saleId: number, method: string, amount: string, status = "completed"): ReportPaymentRow => ({ saleId, method, amount, status });
const input = (o: Partial<TpvReportInput>): TpvReportInput => ({ dateFrom: "2026-06-01", dateTo: "2026-06-30", registerId: null, sales: [], items: [], payments: [], sessions: [], ...o });

describe("informes del TPV — cálculo", () => {
  it("ventas netas, varios IVA, formas de pago y ticket medio; anuladas y devueltas aparte; a medias y no grabadas fuera", () => {
    const r = computeTpvReport(input({
      sales: [
        sale({ id: 1, total: "121.00" }),
        sale({ id: 2, total: "110.00", sellerName: "Luis" }),
        sale({ id: 3, total: "50.00", status: "cancelled" }),
        sale({ id: 4, total: "30.00", status: "refunded", sellerName: "Luis" }),
        sale({ id: 5, total: "999.00", status: "cancelled" }), // no se pudo grabar: sin cobros
        sale({ id: 6, total: "77.00", status: "pending" }),
      ],
      items: [
        line({ saleId: 1, subtotal: "121.00", taxRate: "21", taxBase: "100.00", taxAmount: "21.00" }),
        line({ saleId: 2, productId: 2, productName: "Libro", categoryName: "Librería", subtotal: "110.00", taxRate: "10", taxBase: "100.00", taxAmount: "10.00" }),
        line({ saleId: 3, subtotal: "50.00" }),
        line({ saleId: 4, subtotal: "30.00" }),
      ],
      payments: [
        pay(1, "cash", "100.00"), pay(1, "card", "21.00"),
        pay(2, "bizum", "110.00"),
        pay(3, "cash", "50.00"),
        pay(4, "card", "30.00"),
        pay(6, "card", "77.00", "pending"),
      ],
    }));
    expect(r.summary).toMatchObject({
      tickets: 2, netSales: 231, taxBase: 200, taxAmount: 31, averageTicket: 115.5, units: 2,
      voidedTickets: 1, voidedAmount: 50, refundedTickets: 1, refundedAmount: 30,
    });
    expect(r.byTaxRate.map((t) => [t.label, t.taxBase, t.taxAmount, t.amount])).toEqual([
      ["IVA 10 %", 100, 10, 110],
      ["IVA 21 %", 100, 21, 121],
    ]);
    expect(r.byPaymentMethod.map((m) => [m.label, m.payments, m.amount])).toEqual([["Bizum", 1, 110], ["Efectivo", 1, 100], ["Tarjeta", 1, 21]]);
    expect(r.byPaymentMethod.reduce((a, m) => a + m.share, 0)).toBeCloseTo(100, 1);
    expect(r.byCategory.map((c) => [c.category, c.amount])).toEqual([["Peluquería", 121], ["Librería", 110]]);
    expect(r.byCashier.map((c) => [c.cashier, c.tickets, c.netSales])).toEqual([["Ana", 1, 121], ["Luis", 1, 110]]);
    expect(r.voids.map((v) => [v.ticketNumber, v.statusLabel, v.amount])).toEqual([["T-3", "Anulada", 50], ["T-4", "Devuelta", 30]]);
    expect(r.byDay).toEqual([{ date: "2026-06-10", tickets: 2, netSales: 231, averageTicket: 115.5, voidedTickets: 2, voidedAmount: 80 }]);
  });

  it("cambio de día en Madrid: una venta a las 00:30 de Madrid (22:30 UTC del día anterior) cuenta en su día", () => {
    // Verano (UTC+2): 2026-07-14T22:30Z = 15/07 00:30 en Madrid
    expect(saleDateKey({ paidAt: at("2026-07-14T22:30:00Z"), createdAt: 0 })).toBe("2026-07-15");
    // Invierno (UTC+1): 2026-01-14T23:30Z = 15/01 00:30; 2026-01-14T22:59Z sigue siendo el 14
    expect(saleDateKey({ paidAt: at("2026-01-14T23:30:00Z"), createdAt: 0 })).toBe("2026-01-15");
    expect(saleDateKey({ paidAt: at("2026-01-14T22:59:00Z"), createdAt: 0 })).toBe("2026-01-14");
    // Sin fecha de cobro se usa la de creación
    expect(saleDateKey({ paidAt: null, createdAt: at("2026-07-14T22:30:00Z") })).toBe("2026-07-15");
    const r = computeTpvReport(input({
      dateFrom: "2026-07-14", dateTo: "2026-07-15",
      sales: [sale({ id: 1, total: "10", paidAt: at("2026-07-14T21:59:00Z") }), sale({ id: 2, total: "20", paidAt: at("2026-07-14T22:30:00Z") })],
      payments: [pay(1, "cash", "10"), pay(2, "cash", "20")],
    }));
    expect(r.byDay.map((d) => [d.date, d.netSales])).toEqual([["2026-07-14", 10], ["2026-07-15", 20]]);
  });

  it("rango de días de Madrid completo también en los días de cambio de hora (23 y 25 horas)", () => {
    const spring = madridRangeMs("2026-03-29", "2026-03-29");
    expect(new Date(spring.fromMs).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(new Date(spring.toMsExclusive).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    const autumn = madridRangeMs("2026-10-25", "2026-10-25");
    expect(new Date(autumn.fromMs).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    // 25 horas: las 23:30 de Madrid (22:30 UTC) siguen dentro del día
    expect(new Date(autumn.toMsExclusive).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(at("2026-10-25T22:30:00Z")).toBeLessThan(autumn.toMsExclusive);
    expect(rangeDays("2026-01-01", "2026-12-31")).toBe(365);
    expect(() => madridRangeMs("2026-02-02", "2026-02-01")).toThrow();
    expect(() => madridRangeMs("2026-2-1", "2026-02-01")).toThrow();
  });

  it("el descuento del ticket se reparte entre las líneas: producto, categoría e IVA suman las ventas netas", () => {
    const r = computeTpvReport(input({
      sales: [sale({ id: 1, total: "90.00", discountAmount: "10.00" }), sale({ id: 2, total: "100.00" })],
      items: [
        line({ saleId: 1, productId: 1, productName: "Corte", subtotal: "60.00", taxBase: "49.59", taxAmount: "10.41" }),
        line({ saleId: 1, productId: 0, productName: "Concepto", isManual: 1, conceptText: "Peinado especial", categoryName: null, subtotal: "40.00", taxRate: "10", taxBase: "36.36", taxAmount: "3.64" }),
        line({ saleId: 2, productType: "extra", productId: 0, productName: "Bolsa", categoryName: null, subtotal: "33.33", taxBase: "27.55", taxAmount: "5.78" }),
        line({ saleId: 2, productType: "extra", productId: 0, productName: "Bolsa", categoryName: null, subtotal: "33.33", taxBase: "27.55", taxAmount: "5.78" }),
        line({ saleId: 2, productId: 1, productName: "Corte", subtotal: "33.34", taxBase: "27.55", taxAmount: "5.79" }),
      ],
      payments: [pay(1, "card", "90.00"), pay(2, "cash", "100.00")],
    }));
    expect(r.summary.netSales).toBe(190);
    expect(r.summary.ticketDiscounts).toBe(10);
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum(r.byProduct.map((p) => p.amount))).toBe(190);
    expect(sum(r.byCategory.map((c) => c.amount))).toBe(190);
    expect(sum(r.byTaxRate.map((t) => t.amount))).toBe(190);
    expect(r.byProduct.find((p) => p.product === "Corte")!.amount).toBe(54 + 33.34);
    expect(r.byProduct.find((p) => p.product === "Peinado especial")).toMatchObject({ category: "Conceptos libres", amount: 36 });
    expect(r.byCategory.map((c) => c.category).sort()).toEqual(["Conceptos libres", "Extras", "Peluquería"]);
    // Base y cuota también con el descuento repartido (90 % en el ticket 1)
    const iva10 = r.byTaxRate.find((t) => t.rate === "10.00")!;
    expect(iva10.taxBase).toBe(32.73);
    expect(iva10.taxAmount).toBe(3.28);
  });

  it("reparto en céntimos exacto (resto mayor)", () => {
    expect(prorateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(prorateCents(9000, [6000, 4000])).toEqual([5400, 3600]);
    expect(prorateCents(500, [0, 0])).toEqual([500, 0]);
    expect(prorateCents(0, [])).toEqual([]);
  });

  it("cajero: el vendedor de la venta y, si no consta, quien abrió la caja", () => {
    const r = computeTpvReport(input({
      sales: [sale({ id: 1, total: "10", sellerName: null, cashierName: "Marta" }), sale({ id: 2, total: "10", sellerName: null, cashierName: null })],
      payments: [pay(1, "cash", "10"), pay(2, "cash", "10")],
    }));
    expect(r.byCashier.map((c) => c.cashier)).toEqual(["Marta", "Sin identificar"]);
  });

  it("cierres de caja: descuadres por exceso y por defecto, cuadrados sin contar", () => {
    const s = (id: number, diff: string, closedAt: number | null = at("2026-06-10T20:00:00Z")): ReportSessionRow => ({
      id, registerId: 1, registerName: "Mostrador", cashierName: "Ana", openedAt: at("2026-06-10T08:00:00Z"), closedAt,
      openingAmount: "50", closingAmount: "150", countedCash: String(150 + parseFloat(diff)), cashDifference: diff,
      totalCash: "100", totalCard: "20", totalBizum: "0", totalMixed: "0", totalManualIn: "0", totalManualOut: "0",
    });
    const r = computeTpvReport(input({ sessions: [s(1, "0.00"), s(2, "-12.50"), s(3, "3.00"), s(4, "0.004"), s(5, "-1", null)] }));
    expect(r.closures).toMatchObject({ count: 4, withDifference: 2, shortage: 12.5, surplus: 3, netDifference: -9.5 });
    expect(r.closures.sessions[1]).toMatchObject({ sessionId: 2, expectedCash: 150, countedCash: 137.5, difference: -12.5 });
  });

  it("sin ventas: todo a cero sin dividir por cero", () => {
    const r = computeTpvReport(input({}));
    expect(r.summary).toMatchObject({ tickets: 0, netSales: 0, averageTicket: 0 });
    expect([r.byDay, r.byProduct, r.byPaymentMethod, r.voids, r.closures.sessions]).toEqual([[], [], [], [], []]);
  });

  it("CSV: BOM, «;», coma decimal, importes negativos tal cual y textos sin fórmulas", () => {
    const r = computeTpvReport(input({
      sales: [sale({ id: 1, total: "12.50", customerName: "=HYPERLINK(\"x\")", status: "cancelled" }), sale({ id: 2, total: "5" })],
      items: [line({ saleId: 2, productName: "Café \"solo\"", subtotal: "5" })],
      payments: [pay(1, "cash", "12.50"), pay(2, "cash", "5")],
      sessions: [{
        id: 9, registerId: 1, registerName: "Mostrador", cashierName: "Ana", openedAt: at("2026-06-10T08:00:00Z"), closedAt: at("2026-06-10T20:00:00Z"),
        openingAmount: "0", closingAmount: "10", countedCash: "7.5", cashDifference: "-2.5", totalCash: "10", totalCard: "0", totalBizum: "0", totalMixed: "0", totalManualIn: "0", totalManualOut: "0",
      }],
    }));
    const voids = reportSectionCsv(r, "anulaciones");
    expect(voids.startsWith("﻿\"Ticket\";\"Fecha\"")).toBe(true);
    expect(voids).toContain("\"T-1\";\"2026-06-10\";\"Anulada\";12,50;");
    expect(voids).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(reportSectionCsv(r, "productos")).toContain("\"Café \"\"solo\"\"\";\"Peluquería\";1;5,00;100,00");
    const closures = reportSectionCsv(r, "cierres");
    expect(closures).toContain(";10,00;7,50;-2,50;");
    expect(closures).toContain("10/6/26, 10:00");
  });
});
