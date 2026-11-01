/**
 * Contabilidad › Resumen: series por mes y ventas por categoría con los datos reales de la empresa.
 */
import { describe, it, expect } from "vitest";
import { buildAccountingSummary, lastMonthKeys, madridMonthKey, monthLabel, prorateTicket, NO_CATEGORY } from "./accountingSummary";

const NOW = Date.UTC(2026, 10, 15, 12); // 15/11/2026
const at = (y: number, m: number, d = 10) => Date.UTC(y, m - 1, d, 12);
const base = { now: NOW, sales: [], payments: [], invoices: [], expenses: null, categories: [], pendingQuotes: null };

describe("resumen contable", () => {
  it("los últimos 6 meses en hora de Madrid, del más antiguo al actual", () => {
    expect(lastMonthKeys(NOW)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(lastMonthKeys(Date.UTC(2026, 1, 3))).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    // 31/12 a las 23:30 UTC ya es 1 de enero en Madrid
    expect(madridMonthKey(Date.UTC(2026, 11, 31, 23, 30))).toBe("2027-01");
    expect(monthLabel("2026-11")).toBe("Nov");
  });

  it("empresa vacía: todos los meses a cero, sin categorías y sin datos (la pantalla guía)", () => {
    const s = buildAccountingSummary(base);
    expect(s.months).toHaveLength(6);
    expect(s.months.every((m) => m.sales === 0 && m.payments === 0 && m.invoiced === 0 && m.expenses === 0)).toBe(true);
    expect(s.categories).toEqual([]);
    expect(s.hasData).toBe(false);
    expect(s.hasExpenses).toBe(false);
    expect(s.totals).toMatchObject({ sales: 0, salesCount: 0, averageTicket: 0, invoiced: 0 });
  });

  it("suma ventas, cobros, facturas (menos abonos) y gastos por mes; lo de fuera del periodo no cuenta", () => {
    const s = buildAccountingSummary({
      ...base,
      sales: [{ at: at(2026, 11), amount: 121 }, { at: at(2026, 11, 12), amount: 30.25 }, { at: at(2026, 9), amount: 50 }, { at: at(2026, 4), amount: 999 }],
      payments: [{ at: at(2026, 11), amount: 151.25 }, { at: at(2026, 11), amount: -10 }],
      invoices: [{ at: at(2026, 10), amount: 108.9 }, { at: at(2026, 10, 20), amount: -8.9 }],
      expenses: [{ month: "2026-11", amount: 40 }, { month: "2025-01", amount: 500 }],
      pendingQuotes: 2,
    });
    const nov = s.months.find((m) => m.key === "2026-11")!;
    expect(nov).toMatchObject({ sales: 151.25, payments: 141.25, expenses: 40 });
    expect(s.months.find((m) => m.key === "2026-10")!.invoiced).toBe(100);
    expect(s.totals).toMatchObject({ sales: 201.25, salesCount: 3, averageTicket: 67.08, payments: 141.25, invoiced: 100, invoiceCount: 1, expenses: 40 });
    expect(s.hasData).toBe(true);
    expect(s.hasExpenses).toBe(true);
    expect(s.pendingQuotes).toBe(2);
  });

  it("ventas por categoría real del producto, de mayor a menor; sin producto, «Sin categoría»", () => {
    const s = buildAccountingSummary({
      ...base,
      categories: [{ category: "Consultoría", amount: 300 }, { category: "Formación", amount: 100 }, { category: null, amount: 100 }, { category: "Consultoría", amount: 0 }],
    });
    expect(s.categories).toEqual([
      { name: "Consultoría", amount: 300, percent: 60 },
      { name: "Formación", amount: 100, percent: 20 },
      { name: NO_CATEGORY, amount: 100, percent: 20 },
    ]);
  });

  it("el total cobrado de un ticket con descuento se reparte entre sus líneas al céntimo", () => {
    expect(prorateTicket(90, [60, 40])).toEqual([54, 36]);
    const out = prorateTicket(10, [3.33, 3.33, 3.34]);
    expect(Math.round(out.reduce((s, n) => s + n, 0) * 100) / 100).toBe(10);
    expect(prorateTicket(10, [0, 0])).toEqual([0, 0]);
  });
});
