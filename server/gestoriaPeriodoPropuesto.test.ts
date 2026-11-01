/**
 * Exportación para la gestoría: el diálogo propone el trimestre en curso (o el último con facturas) en lugar de un
 * trimestre cerrado sin facturas, y un periodo vacío no descarga un ZIP vacío.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { emptyExportMessage, isEmptyExport, isEmptyExportMessage, resolveExportPeriod, suggestedExportQuarter } from "../shared/gestoriaExportPeriod";

const NOW = new Date("2026-11-01T10:00:00Z");

describe("trimestre propuesto", () => {
  it("empresa nueva con facturas este trimestre: el trimestre en curso (no el 3.er trimestre vacío)", () => {
    expect(suggestedExportQuarter(NOW, "2026-11-01T09:00:00Z")).toEqual({ year: 2026, quarter: 4 });
  });
  it("sin facturas todavía: el trimestre en curso", () => {
    expect(suggestedExportQuarter(NOW, null)).toEqual({ year: 2026, quarter: 4 });
    expect(suggestedExportQuarter(NOW, "no es una fecha")).toEqual({ year: 2026, quarter: 4 });
  });
  it("sin facturas este trimestre: el último trimestre con facturas", () => {
    expect(suggestedExportQuarter(NOW, "2026-08-10T10:00:00Z")).toEqual({ year: 2026, quarter: 3 });
    expect(suggestedExportQuarter(NOW, "2025-12-31T23:30:00Z")).toEqual({ year: 2026, quarter: 1 }); // 1 de enero en Madrid
  });
  it("cambio de trimestre con la hora de Madrid", () => {
    expect(suggestedExportQuarter(new Date("2026-09-30T22:30:00Z"), "2026-09-15T10:00:00Z")).toEqual({ year: 2026, quarter: 3 });
  });
});

describe("periodo vacío", () => {
  it("sin facturas ni abonos no se descarga", () => {
    expect(isEmptyExport({ invoices: 0, creditNotes: 0 })).toBe(true);
    expect(isEmptyExport({ invoices: 0, creditNotes: 1 })).toBe(false);
    expect(isEmptyExport({ invoices: 2, creditNotes: 0 })).toBe(false);
    // Solo tickets de caja en el periodo: también se descarga (van en el libro)
    expect(isEmptyExport({ invoices: 0, creditNotes: 0, tickets: 3 })).toBe(false);
    expect(isEmptyExport({ invoices: 0, creditNotes: 0, tickets: 0 })).toBe(true);
  });
  it("el diálogo avisa y no descarga cuando el periodo está vacío", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/crm/GestoriaExportDialog.tsx"), "utf8");
    const check = src.indexOf("if (isEmptyExport(res))");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf("downloadBase64(res.fileName"));
    expect(src).toContain("No hay facturas ni abonos emitidos en");
    expect(src).toContain("suggestedExportQuarter(");
    expect(src).not.toContain("lastClosedQuarter");
  });
});

describe("periodo vacío en el servidor", () => {
  it("mensaje claro en español con el periodo, reconocible por el diálogo", () => {
    const label = resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 1 }).label;
    expect(emptyExportMessage(label)).toBe(`No hay facturas ni abonos emitidos en ${label}. Elige otro periodo.`);
    expect(isEmptyExportMessage(emptyExportMessage(label))).toBe(true);
    expect(isEmptyExportMessage("El periodo tiene 300 documentos")).toBe(false);
    expect(isEmptyExportMessage(undefined)).toBe(false);
  });
  it("exportForGestoria lo rechaza antes de montar el ZIP y el diálogo lo muestra como aviso", () => {
    const crm = fs.readFileSync(path.resolve(__dirname, "routers/crm.ts"), "utf8");
    const proc = crm.slice(crm.indexOf("exportForGestoria:"));
    const empty = proc.indexOf("if (stored.length === 0 && tickets.length === 0) throw new TRPCError({ code: \"BAD_REQUEST\", message: emptyExportMessage(period.label) });");
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(proc.indexOf("buildGestoriaInvoiceZip("));
    const dialog = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/crm/GestoriaExportDialog.tsx"), "utf8");
    expect(dialog).toContain("if (isEmptyExportMessage(message)) toast.warning(message as string);");
  });
});
