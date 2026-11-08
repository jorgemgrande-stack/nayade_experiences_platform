/**
 * Elephant Finance Sync: extractos de cualquier banco (Norma 43, Excel o CSV con cabecera) sin código por banco.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { BankStatementError, bankDuplicateKey, looksLikeNorma43, parseBankStatement } from "./bankStatementImport";
import { n43, norma43Sample } from "./finance/testkit";

const xlsx = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Movimientos");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
};
const csv = (s: string) => Buffer.from(s, "utf8");

describe("extractos bancarios de cualquier banco", () => {
  it("Norma 43: todos los movimientos con signo, saldo y concepto; se reconoce por el contenido", () => {
    const f = norma43Sample();
    expect(looksLikeNorma43(f)).toBe(true);
    const r = parseBankStatement(Buffer.from(f, "latin1"));
    expect(r.format).toBe("norma43");
    expect(r.rows.map((x) => [x.fecha, x.importe, x.saldo])).toEqual([
      ["2026-10-02", -3.5, 4996.5],
      ["2026-10-05", -1210, 3786.5],
      ["2026-10-05", 2500, 6286.5],
      ["2026-10-05", -3.5, 6283],
    ]);
    expect(r.rows[1]).toMatchObject({ movimiento: "TRANSF A HOSTING NUBE SL FACTURA F-2026-10", masDatos: "F-2026-10" });
    expect(new Set(r.rows.map((x) => x.duplicateKey)).size).toBe(4);
    // Leer otra vez el mismo fichero da las mismas claves (no se duplica al reimportar)
    expect(parseBankStatement(Buffer.from(f, "latin1")).rows.map((x) => x.duplicateKey)).toEqual(r.rows.map((x) => x.duplicateKey));
  });

  it("Norma 43 que no cuadra: error claro, sin importar nada", () => {
    const { r11, r22, r33, r88 } = n43;
    const bad = [r11({ open: 0 }), r22({ date: "261002", amount: -100 }), r33({ nd: 1, d: 999, nc: 0, c: 0, close: -100 }), r88(3)].join("\n");
    expect(() => parseBankStatement(Buffer.from(bad))).toThrow(BankStatementError);
    expect(() => parseBankStatement(Buffer.from(bad))).toThrow(/no cuadran/);
  });

  it("Excel de CaixaBank: la misma clave de duplicado de siempre (reimportar un extracto ya cargado no duplica)", () => {
    const r = parseBankStatement(xlsx([["Cuenta ES00"], [], ["Fecha", "Fecha valor", "Movimiento", "Más datos", "Importe", "Saldo"], ["02/10/2026", "02/10/2026", "TRANSFERENCIA", "Cliente Uno", 150.25, 1150.25]]));
    expect(r.format).toBe("spreadsheet");
    expect(r.rows).toEqual([{ fecha: "2026-10-02", fechaValor: "2026-10-02", movimiento: "TRANSFERENCIA", masDatos: "Cliente Uno", importe: 150.25, saldo: 1150.25, duplicateKey: "2026-10-02|2026-10-02|transferencia|cliente uno|150.25|1150.25" }]);
  });

  it("CSV de otros bancos: «Fecha operación», «Concepto», importes «1.234,56» y negativos", () => {
    const r = parseBankStatement(csv("Fecha operación;Concepto;Importe (€);Saldo (€)\n05/10/2026;RECIBO LUZ;-1.234,56;8.765,44\n06/10/2026;INGRESO TPV;2.000,00;10.765,44\nTotal;;;\n"));
    expect(r.rows.map((x) => [x.fecha, x.masDatos, x.importe, x.saldo])).toEqual([
      ["2026-10-05", "RECIBO LUZ", -1234.56, 8765.44],
      ["2026-10-06", "INGRESO TPV", 2000, 10765.44],
    ]);
  });

  it("columnas de cargo y abono separadas", () => {
    const r = parseBankStatement(xlsx([["Fecha", "Descripción", "Cargo", "Abono"], ["2026-10-07", "Comisión", "12,00", ""], ["2026-10-08", "Transferencia recibida", "", "300,50"]]));
    expect(r.rows.map((x) => [x.fecha, x.importe])).toEqual([
      ["2026-10-07", -12],
      ["2026-10-08", 300.5],
    ]);
  });

  it("dos movimientos idénticos del mismo extracto no se confunden; sin cabecera, error claro", () => {
    const r = parseBankStatement(csv("Fecha;Concepto;Importe\n02/10/2026;COMISION;-3,50\n02/10/2026;COMISION;-3,50\n"));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].duplicateKey).not.toBe(r.rows[1].duplicateKey);
    expect(() => parseBankStatement(csv("a;b\n1;2\n"))).toThrow(/cabecera/);
    expect(() => parseBankStatement(Buffer.alloc(0))).toThrow(/vacío/);
  });

  it("la clave de duplicado siempre cabe en la columna (255)", () => {
    const k = bankDuplicateKey("2026-10-02", "", "x".repeat(300), "", 1, null);
    expect(k.length).toBeLessThanOrEqual(255);
    expect(k.startsWith("h:")).toBe(true);
  });
});

describe("codificación de los CSV", () => {
  it("un CSV en Latin-1 (habitual en los bancos) se lee igual que en UTF-8", () => {
    const text = "Fecha operación;Descripción;Importe\n09/10/2026;Recibo teléfono;-45,90\n";
    const a = parseBankStatement(Buffer.from(text, "latin1")).rows;
    const b = parseBankStatement(Buffer.from(text, "utf8")).rows;
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ fecha: "2026-10-09", masDatos: "Recibo teléfono", importe: -45.9 });
  });
});
