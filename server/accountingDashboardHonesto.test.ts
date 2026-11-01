/**
 * Contabilidad del panel de empresa: sin cifras inventadas ni controles que no hacen nada (variaciones fijas,
 * selector de periodo sin efecto, exportaciones «próximamente»), y sin consultar módulos no contratados.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/accounting/AccountingDashboard.tsx"), "utf8");
const reports = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/accounting/AccountingReports.tsx"), "utf8");

/** Opciones de la llamada `trpc.<proc>.useQuery(...)` (hasta el cierre de la sentencia). */
const callOf = (code: string, proc: string) => {
  const i = code.indexOf(`trpc.${proc}.useQuery`);
  expect(i, proc).toBeGreaterThan(-1);
  return code.slice(i, code.indexOf(");", i));
};

describe("contabilidad del panel de empresa", () => {
  it("no muestra variaciones porcentuales escritas a mano ni controles sin efecto", () => {
    expect(src).not.toMatch(/change:\s*"[+-]\d/);
    expect(src).not.toContain("Función disponible próximamente");
    expect(src).not.toContain("onValueChange={setPeriod}");
    expect(src).toContain("trpc.accounting.getSummary.useQuery");
  });

  it("el resumen no lleva cifras ni categorías de ejemplo ni estados técnicos", () => {
    for (const s of ["monthlyData", "categoryData", "Nieve & Ski", "Acuático", "Multiaventura", "Reservas Completadas", "pending / suggested / auto_ready", "12400"]) {
      expect(src, s).not.toContain(s);
    }
    expect(src).toContain("summary?.categories");
    expect(src).toContain("<PanelEmpty");
  });

  it("cada bloque de un módulo aparte solo se consulta con ese módulo contratado (sin 403)", () => {
    const gated: Array<[string, string]> = [
      ["gestoria.executiveSummary", "canTax"],
      ["financial.expenses.distortionKpi", "canTax"],
      ["cardTerminalBatches.getReconciliationStats", "canBank"],
      ["bankMovements.getExpenseStats", "canBank"],
      ["bankMovements.getCashflowForecast", "canBank"],
      ["accounting.getDashboardMetrics", "canPartners"],
    ];
    for (const [proc, flag] of gated) expect(callOf(src, proc), proc).toContain(`enabled: ${flag}`);
    expect(src).toContain('sub.can("tax-filings")');
    expect(src).toContain('sub.can("bank-import-pos")');
    expect(src).toContain("{canTax && (");
    expect(src).toContain("{canBank && (");
    expect(callOf(reports, "bankMovements.getCashflowForecast")).toContain("enabled: canBank");
    expect(reports).not.toContain('title="Informes BI"');
  });
});
