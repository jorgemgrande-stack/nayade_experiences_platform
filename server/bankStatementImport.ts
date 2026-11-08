/**
 * Elephant Finance Sync · lectura de extractos bancarios de cualquier banco (activación del marketplace, 08/11/2026).
 *
 * Antes solo se leía el Excel de CaixaBank: el resto de bancos exigía implantación. Ahora, sin código por banco:
 *  - Norma 43 (cuaderno 43 de la AEB, el formato que exportan todos los bancos españoles): el lector de las finanzas
 *    corporativas (server/finance/opsRules.ts `parseNorma43`), que comprueba totales y saldos;
 *  - Excel o CSV con cabecera: se reconoce por el nombre de las columnas (fecha, concepto, importe o cargo/abono y
 *    saldo, con los nombres habituales de los bancos), con importes «1.234,56» y «1,234.56» bien leídos.
 *
 * Función pura (sin BD): devuelve las filas que guarda `bankMovements.uploadBankFile`. La clave de duplicado de un Excel
 * con un movimiento único es la de siempre, así que volver a importar un extracto ya cargado no duplica nada.
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { decodeText, parseExcelDate, parseImporte, parseNorma43 } from "./finance/opsRules";
import { FinanceError } from "./finance/types";

export interface ParsedBankRow {
  fecha: string;
  fechaValor: string;
  movimiento: string;
  masDatos: string;
  importe: number;
  saldo: number | null;
  duplicateKey: string;
}

export type BankStatementFormat = "norma43" | "spreadsheet";

export class BankStatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankStatementError";
  }
}

const normalize = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Clave de duplicado de siempre (server/routers/bankMovements.ts); si no cabe en la columna (255), su huella. */
export function bankDuplicateKey(fecha: string, fechaValor: string, movimiento: string, masDatos: string, importe: number, saldo: number | null): string {
  const key = [fecha, fechaValor, normalize(movimiento), normalize(masDatos), importe.toFixed(2), saldo != null ? saldo.toFixed(2) : ""].join("|");
  return key.length <= 255 ? key : `h:${createHash("sha256").update(key).digest("hex")}`;
}

/** Dos movimientos idénticos en el mismo extracto (dos comisiones iguales el mismo día) no se confunden. */
function withOccurrences(rows: Array<Omit<ParsedBankRow, "duplicateKey">>): ParsedBankRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = bankDuplicateKey(r.fecha, r.fechaValor, r.movimiento, r.masDatos, r.importe, r.saldo);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, duplicateKey: n === 1 ? base : bankDuplicateKey(r.fecha, r.fechaValor, r.movimiento, `${r.masDatos}#${n}`, r.importe, r.saldo) };
  });
}

const euros = (cents: number) => Math.round(cents) / 100;
/** Longitud de la columna `bank_movements.movimiento` (varchar 255). */
const MOV_MAX = 255;

/** ¿Es Norma 43? Primera línea con registro 11 y registros de 80 posiciones numerados. */
export function looksLikeNorma43(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length >= 2 && /^11\d{18}/.test(lines[0]) && lines.every((l) => /^(11|22|23|24|33|88)/.test(l) && l.replace(/\s+$/, "").length <= 80);
}

// Nombres de columna habituales en los extractos de los bancos españoles (normalizados: minúsculas y espacios simples)
const ALIASES = {
  fecha: ["fecha", "fecha operación", "fecha operacion", "fecha de operación", "fecha de operacion", "f. operación", "f. operacion", "f.operación", "f.operacion", "fecha contable", "fecha oper.", "date"],
  fechaValor: ["fecha valor", "fecha de valor", "f.valor", "f. valor", "fechavalor", "valor"],
  movimiento: ["movimiento", "tipo", "tipo de movimiento", "concepto común", "concepto comun"],
  masDatos: ["más datos", "mas datos", "concepto", "descripcion", "descripción", "detalle", "observaciones", "concepto propio", "beneficiario", "description"],
  importe: ["importe", "importe (€)", "importe €", "importe eur", "importe (eur)", "importe euros", "cantidad", "amount"],
  cargo: ["cargo", "cargos", "debe", "salida", "salidas", "gasto"],
  abono: ["abono", "abonos", "haber", "entrada", "entradas", "ingreso", "ingresos"],
  saldo: ["saldo", "saldo (€)", "saldo €", "saldo eur", "saldo disponible", "balance"],
} as const;
type Col = keyof typeof ALIASES;

function spreadsheetRows(buffer: Buffer): ParsedBankRow[] {
  let rows: unknown[][];
  try {
    // Excel (zip o binario) tal cual; un CSV se decodifica antes (UTF-8 o Latin-1) para no romper «Fecha operación»
    const binary = buffer.subarray(0, 2).toString("latin1") === "PK" || buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    const wb = binary ? XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true }) : XLSX.read(decodeText(buffer), { type: "string", cellDates: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][];
  } catch {
    throw new BankStatementError("No se pudo leer el fichero: usa el Excel o CSV del extracto, o el fichero Norma 43 de tu banco");
  }
  const col: Partial<Record<Col, number>> = {};
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 25) && headerRow < 0; r++) {
    const h = (rows[r] ?? []).map((c) => normalize(c));
    const has = (k: Col) => h.some((x) => (ALIASES[k] as readonly string[]).includes(x));
    if (!has("fecha") || !(has("importe") || has("cargo") || has("abono"))) continue;
    headerRow = r;
    h.forEach((x, i) => {
      for (const k of Object.keys(ALIASES) as Col[]) if (col[k] == null && (ALIASES[k] as readonly string[]).includes(x)) return void (col[k] = i);
    });
  }
  if (headerRow < 0 || col.fecha == null) throw new BankStatementError("No se encontró la cabecera del extracto: hacen falta las columnas de fecha y de importe (o de cargo y abono)");
  const cell = (row: unknown[], k: Col) => (col[k] == null ? undefined : row[col[k]!]);
  const out: Array<Omit<ParsedBankRow, "duplicateKey">> = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const fecha = parseExcelDate(cell(row, "fecha"));
    if (!fecha) continue; // pies, totales y líneas en blanco
    let cents: number | null;
    const blank = (k: Col) => String(cell(row, k) ?? "").trim() === "";
    // Fila sin importe (ni cargo ni abono): no es un movimiento (antes contaba como 0 y tampoco se guardaba con sentido)
    if (col.importe != null ? blank("importe") : blank("cargo") && blank("abono")) continue;
    if (col.importe != null) cents = parseImporte(cell(row, "importe"));
    else {
      const cargo = parseImporte(cell(row, "cargo")) ?? 0;
      const abono = parseImporte(cell(row, "abono")) ?? 0;
      cents = abono - Math.abs(cargo);
    }
    if (cents === null) throw new BankStatementError(`Fila ${r + 1}: importe no reconocido`);
    if (cents === 0) continue;
    const saldo = col.saldo != null ? parseImporte(cell(row, "saldo")) : null;
    out.push({
      fecha,
      fechaValor: col.fechaValor != null ? parseExcelDate(cell(row, "fechaValor")) : "",
      movimiento: String(cell(row, "movimiento") ?? "").trim().slice(0, MOV_MAX),
      masDatos: String(cell(row, "masDatos") ?? "").trim().slice(0, 1000),
      importe: euros(cents),
      saldo: saldo === null ? null : euros(saldo),
    });
  }
  return withOccurrences(out);
}

function norma43Rows(text: string): ParsedBankRow[] {
  let accounts;
  try {
    accounts = parseNorma43(text);
  } catch (e) {
    throw new BankStatementError(e instanceof FinanceError ? e.message : "El fichero Norma 43 no es válido");
  }
  const out: Array<Omit<ParsedBankRow, "duplicateKey">> = [];
  for (const a of accounts)
    for (const m of a.movements) {
      // `movimiento` es varchar(255): lo que no cabe del concepto (registros 23) pasa a «más datos» (text)
      const rest = m.description.slice(MOV_MAX).trim();
      out.push({ fecha: m.bookingDate, fechaValor: m.valueDate ?? "", movimiento: m.description.slice(0, MOV_MAX), masDatos: [rest, m.reference ?? ""].filter(Boolean).join(" · "), importe: euros(m.amountCents), saldo: m.balanceCents === null ? null : euros(m.balanceCents) });
    }
  return withOccurrences(out);
}

/** Lee un extracto de cualquier banco: Norma 43 (por contenido) o Excel/CSV con cabecera. */
export function parseBankStatement(buffer: Buffer): { format: BankStatementFormat; rows: ParsedBankRow[] } {
  if (!buffer.length) throw new BankStatementError("El fichero está vacío");
  const head = buffer.subarray(0, 2).toString("latin1");
  if (head === "11") {
    // Algunos bancos cierran el fichero con el fin de fichero de DOS (0x1A)
    const text = decodeText(buffer).replace(/\x1a[\s\x1a]*$/, "");
    if (looksLikeNorma43(text)) return { format: "norma43", rows: norma43Rows(text) };
    if (/^11\d{18}/.test(text)) throw new BankStatementError("El fichero parece Norma 43 pero no tiene el formato del cuaderno 43 (registros de 80 posiciones 11, 22, 23, 33 y 88): descárgalo de nuevo de tu banco");
  }
  return { format: "spreadsheet", rows: spreadsheetRows(buffer) };
}
