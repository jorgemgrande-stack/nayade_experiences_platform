/**
 * Tests: Periodicidad de liquidaciones en fichas de proveedor
 * Cubre: getPeriodEnd, addPeriod y cálculo de periodos pendientes
 * Nota: usa la misma lógica sin zona horaria que el servidor (Date.UTC)
 */
import { describe, it, expect } from "vitest";

// ─── Helpers idénticos a los del router (sin zona horaria) ────────────────────

function dateAddDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split("T")[0];
}

function lastDayOfMonth(y: number, m: number): string {
  // Date.UTC(y, m, 0) = último día del mes m (1-indexed)
  return new Date(Date.UTC(y, m, 0)).toISOString().split("T")[0];
}

function getPeriodEnd(fromStr: string, freq: string): string {
  const [y, m] = fromStr.split("-").map(Number);
  switch (freq) {
    case "quincenal": return dateAddDays(fromStr, 14);
    case "mensual":   return lastDayOfMonth(y, m);
    case "trimestral": return lastDayOfMonth(y, m + 2);
    case "semestral": return lastDayOfMonth(y, m + 5);
    case "anual":     return lastDayOfMonth(y, m + 11);
    default: return fromStr;
  }
}

function addPeriod(dateStr: string, freq: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  switch (freq) {
    case "quincenal": return dateAddDays(dateStr, 15);
    case "mensual":   return new Date(Date.UTC(y, m, d)).toISOString().split("T")[0];
    case "trimestral": return new Date(Date.UTC(y, m + 2, d)).toISOString().split("T")[0];
    case "semestral": return new Date(Date.UTC(y, m + 5, d)).toISOString().split("T")[0];
    case "anual":     return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().split("T")[0];
    default: return dateStr;
  }
}

function calcPendingPeriods(
  freq: string,
  lastPeriodTo: string | null,
  todayStr: string
): { from: string; to: string }[] {
  if (freq === "manual") return [];
  let currentFrom: string;
  if (lastPeriodTo) {
    currentFrom = dateAddDays(lastPeriodTo, 1);
  } else {
    // Primer día del mes del todayStr
    const [y, m] = todayStr.split("-").map(Number);
    currentFrom = `${y}-${String(m).padStart(2, "0")}-01`;
  }
  const pendingPeriods: { from: string; to: string }[] = [];
  let iterations = 0;
  while (iterations < 24) {
    const periodTo = getPeriodEnd(currentFrom, freq);
    if (periodTo > todayStr) break;
    pendingPeriods.push({ from: currentFrom, to: periodTo });
    currentFrom = addPeriod(currentFrom, freq);
    iterations++;
  }
  return pendingPeriods;
}

// ─── Tests de getPeriodEnd ────────────────────────────────────────────────────

describe("getPeriodEnd - cálculo de fin de periodo", () => {
  it("quincenal: 14 días desde el inicio (del 1 al 15)", () => {
    expect(getPeriodEnd("2026-01-01", "quincenal")).toBe("2026-01-15");
    expect(getPeriodEnd("2026-01-16", "quincenal")).toBe("2026-01-30");
  });

  it("mensual: último día del mes de inicio", () => {
    expect(getPeriodEnd("2026-01-01", "mensual")).toBe("2026-01-31");
    expect(getPeriodEnd("2026-02-01", "mensual")).toBe("2026-02-28");
    expect(getPeriodEnd("2026-03-01", "mensual")).toBe("2026-03-31");
    expect(getPeriodEnd("2026-04-01", "mensual")).toBe("2026-04-30");
  });

  it("trimestral: último día del tercer mes", () => {
    expect(getPeriodEnd("2026-01-01", "trimestral")).toBe("2026-03-31");
    expect(getPeriodEnd("2026-04-01", "trimestral")).toBe("2026-06-30");
    expect(getPeriodEnd("2026-07-01", "trimestral")).toBe("2026-09-30");
    expect(getPeriodEnd("2026-10-01", "trimestral")).toBe("2026-12-31");
  });

  it("semestral: último día del sexto mes", () => {
    expect(getPeriodEnd("2026-01-01", "semestral")).toBe("2026-06-30");
    expect(getPeriodEnd("2026-07-01", "semestral")).toBe("2026-12-31");
  });

  it("anual: último día del mes 12 del año de inicio", () => {
    expect(getPeriodEnd("2026-01-01", "anual")).toBe("2026-12-31");
    expect(getPeriodEnd("2025-01-01", "anual")).toBe("2025-12-31");
  });
});

// ─── Tests de addPeriod ───────────────────────────────────────────────────────

describe("addPeriod - avance al siguiente periodo", () => {
  it("quincenal: avanza 15 días", () => {
    expect(addPeriod("2026-01-01", "quincenal")).toBe("2026-01-16");
    expect(addPeriod("2026-01-16", "quincenal")).toBe("2026-01-31");
  });

  it("mensual: avanza al mismo día del mes siguiente", () => {
    expect(addPeriod("2026-01-01", "mensual")).toBe("2026-02-01");
    expect(addPeriod("2026-11-01", "mensual")).toBe("2026-12-01");
    expect(addPeriod("2026-12-01", "mensual")).toBe("2027-01-01");
  });

  it("trimestral: avanza 3 meses", () => {
    expect(addPeriod("2026-01-01", "trimestral")).toBe("2026-04-01");
    expect(addPeriod("2026-04-01", "trimestral")).toBe("2026-07-01");
    expect(addPeriod("2026-10-01", "trimestral")).toBe("2027-01-01");
  });

  it("semestral: avanza 6 meses", () => {
    expect(addPeriod("2026-01-01", "semestral")).toBe("2026-07-01");
    expect(addPeriod("2026-07-01", "semestral")).toBe("2027-01-01");
  });

  it("anual: avanza un año", () => {
    expect(addPeriod("2026-01-01", "anual")).toBe("2027-01-01");
    expect(addPeriod("2025-06-01", "anual")).toBe("2026-06-01");
  });
});

// ─── Tests de cálculo de periodos pendientes ──────────────────────────────────

describe("calcPendingPeriods - periodos pendientes de liquidar", () => {
  it("mensual: sin liquidaciones previas, hoy último día del mes → 1 periodo", () => {
    const periods = calcPendingPeriods("mensual", null, "2026-02-28");
    expect(periods.length).toBe(1);
    expect(periods[0]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("mensual: última liquidación en enero, hoy 15 de marzo → 1 periodo (febrero)", () => {
    const periods = calcPendingPeriods("mensual", "2026-01-31", "2026-03-15");
    expect(periods.length).toBe(1);
    expect(periods[0]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("mensual: última liquidación en enero, hoy último de marzo → 2 periodos", () => {
    const periods = calcPendingPeriods("mensual", "2026-01-31", "2026-03-31");
    expect(periods.length).toBe(2);
    expect(periods[0]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periods[1]).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("trimestral: sin liquidaciones, hoy 31 de marzo → 0 periodos (el periodo Q1 de marzo a mayo no ha terminado)", () => {
    // Sin liquidaciones, currentFrom = 2026-03-01, periodEnd = 2026-05-31 > 2026-03-31 → no pendiente
    const periods = calcPendingPeriods("trimestral", null, "2026-03-31");
    expect(periods.length).toBe(0);
  });

  it("trimestral: sin liquidaciones, hoy 1 de julio → 1 periodo (Q2 abril-junio)", () => {
    // Sin liquidaciones, currentFrom = 2026-07-01, periodEnd = 2026-09-30 > 2026-07-01 → no pendiente
    // Pero si hoy es 2026-06-30, currentFrom = 2026-06-01, periodEnd = 2026-08-31 > 2026-06-30 → no pendiente
    // Con lastPeriodTo = 2026-03-31, currentFrom = 2026-04-01, periodEnd = 2026-06-30 <= 2026-07-01 → 1 pendiente
    const periods = calcPendingPeriods("trimestral", "2026-03-31", "2026-07-01");
    expect(periods.length).toBe(1);
    expect(periods[0]).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("trimestral: última en Q1, hoy en julio → 1 periodo (Q2)", () => {
    const periods = calcPendingPeriods("trimestral", "2026-03-31", "2026-07-15");
    expect(periods.length).toBe(1);
    expect(periods[0]).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("quincenal: sin liquidaciones, hoy el 16 → 1 periodo (1-15)", () => {
    const periods = calcPendingPeriods("quincenal", null, "2026-01-16");
    expect(periods.length).toBe(1);
    expect(periods[0]).toEqual({ from: "2026-01-01", to: "2026-01-15" });
  });

  it("manual: siempre retorna vacío", () => {
    const periods = calcPendingPeriods("manual", null, "2026-03-31");
    expect(periods.length).toBe(0);
  });

  it("al día: si el periodo actual no ha terminado, no hay pendientes", () => {
    const periods = calcPendingPeriods("mensual", "2026-03-31", "2026-04-01");
    expect(periods.length).toBe(0);
  });

  it("semestral: sin liquidaciones, hoy 30 junio → 0 periodos (el semestre de junio termina en nov)", () => {
    // Sin liquidaciones, currentFrom = 2026-06-01, periodEnd = 2026-11-30 > 2026-06-30 → no pendiente
    const periods = calcPendingPeriods("semestral", null, "2026-06-30");
    expect(periods.length).toBe(0);
  });

  it("semestral: última en H1 (junio), hoy en enero siguiente → 1 periodo (H2)", () => {
    const periods = calcPendingPeriods("semestral", "2026-06-30", "2027-01-15");
    expect(periods.length).toBe(1);
    expect(periods[0]).toEqual({ from: "2026-07-01", to: "2026-12-31" });
  });
});

// ─── Tests de validación del enum ────────────────────────────────────────────

describe("Validación de enum settlementFrequency", () => {
  const validFrequencies = ["quincenal", "mensual", "trimestral", "semestral", "anual", "manual"];

  it("todos los valores del enum son válidos", () => {
    for (const freq of validFrequencies) {
      expect(validFrequencies).toContain(freq);
    }
  });

  it("el valor por defecto es manual", () => {
    expect(validFrequencies).toContain("manual");
  });

  it("getPeriodEnd con freq desconocida retorna el mismo fromStr", () => {
    expect(getPeriodEnd("2026-01-01", "desconocida")).toBe("2026-01-01");
  });

  it("addPeriod con freq desconocida retorna el mismo dateStr", () => {
    expect(addPeriod("2026-01-01", "desconocida")).toBe("2026-01-01");
  });
});
