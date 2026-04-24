import { z } from "zod";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { protectedProcedure } from "../_core/trpc";
import { bankFileImports, bankMovements } from "../../drizzle/schema";
import * as XLSX from "xlsx";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

const adminProc = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido" });
  }
  return next({ ctx });
});

// ── CaixaBank parser ──────────────────────────────────────────────────────────

function parseExcelDate(v: unknown): string {
  if (v == null || v === "") return "";
  // JS Date (when cellDates:true)
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // Numeric serial (Excel epoch: 1 = Jan 1 1900, with 1900 leap-year bug offset)
  if (typeof v === "number") {
    const ms = (v - 25569) * 86400 * 1000;
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    if (y > 1900 && y < 2100) return `${y}-${m}-${d}`;
  }
  // String DD/MM/YYYY or YYYY-MM-DD
  const s = String(v).trim();
  const dmatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmatch) return `${dmatch[3]}-${dmatch[2]}-${dmatch[1]}`;
  const ymatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymatch) return s.slice(0, 10);
  return s;
}

function parseImporte(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normalize(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function makeDuplicateKey(
  fecha: string,
  fechaValor: string,
  movimiento: string,
  masDatos: string,
  importe: number,
  saldo: number | null
): string {
  return [fecha, fechaValor, normalize(movimiento), normalize(masDatos), importe.toFixed(2), saldo != null ? saldo.toFixed(2) : ""].join("|");
}

interface ParsedRow {
  fecha: string;
  fechaValor: string;
  movimiento: string;
  masDatos: string;
  importe: number;
  saldo: number | null;
  duplicateKey: string;
}

function parseCaixaBankBuffer(buffer: Buffer, ext: string): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][];

  // Find header row by searching for known column names
  const COL_MAP: Record<string, number> = {};
  let headerRow = -1;

  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] as unknown[];
    const normalized = row.map((c) => normalize(c));
    const hasFecha = normalized.some((c) => c === "fecha");
    const hasImporte = normalized.some((c) => c === "importe");
    if (hasFecha && hasImporte) {
      headerRow = r;
      normalized.forEach((h, i) => {
        if (h === "fecha" && COL_MAP["fecha"] == null) COL_MAP["fecha"] = i;
        else if ((h === "fecha valor" || h === "f.valor" || h === "fechavalor") && COL_MAP["fechaValor"] == null) COL_MAP["fechaValor"] = i;
        else if (h === "movimiento" && COL_MAP["movimiento"] == null) COL_MAP["movimiento"] = i;
        else if ((h === "más datos" || h === "mas datos" || h === "concepto" || h === "descripcion" || h === "descripción") && COL_MAP["masDatos"] == null) COL_MAP["masDatos"] = i;
        else if (h === "importe" && COL_MAP["importe"] == null) COL_MAP["importe"] = i;
        else if (h === "saldo" && COL_MAP["saldo"] == null) COL_MAP["saldo"] = i;
      });
      break;
    }
  }

  if (headerRow === -1) throw new Error("No se encontró cabecera válida (Fecha + Importe)");
  if (COL_MAP["fecha"] == null || COL_MAP["importe"] == null) throw new Error("Faltan columnas obligatorias: Fecha, Importe");

  const parsed: ParsedRow[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const fecha = parseExcelDate(row[COL_MAP["fecha"]]);
    if (!fecha) continue;
    const fechaValor = COL_MAP["fechaValor"] != null ? parseExcelDate(row[COL_MAP["fechaValor"]]) : "";
    const movimiento = String(row[COL_MAP["movimiento"] ?? -1] ?? "").trim();
    const masDatos = String(row[COL_MAP["masDatos"] ?? -1] ?? "").trim();
    const importe = parseImporte(row[COL_MAP["importe"]]);
    const saldo = COL_MAP["saldo"] != null ? parseImporte(row[COL_MAP["saldo"]]) : null;
    const duplicateKey = makeDuplicateKey(fecha, fechaValor, movimiento, masDatos, importe, saldo);
    parsed.push({ fecha, fechaValor, movimiento, masDatos, importe, saldo, duplicateKey });
  }
  return parsed;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const bankMovementsRouter = router({

  listImports: adminProc.query(async () => {
    return db.select().from(bankFileImports).orderBy(desc(bankFileImports.createdAt));
  }),

  deleteImport: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(bankMovements).where(eq(bankMovements.importId, input.id));
      await db.delete(bankFileImports).where(eq(bankFileImports.id, input.id));
      return { success: true };
    }),

  uploadBankFile: adminProc
    .input(z.object({
      fileName: z.string(),
      fileType: z.string(),
      fileBase64: z.string(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      let rows: ParsedRow[];
      try {
        rows = parseCaixaBankBuffer(buffer, input.fileType);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          await db.insert(bankFileImports).values({
            fileName: input.fileName,
            fileType: input.fileType,
            importedRows: 0,
            duplicatesSkipped: 0,
            status: "error",
            errorMessage: msg,
          });
        } catch (_) { /* tabla aún no disponible, ignorar */ }
        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
      }

      // Fetch existing duplicate keys for dedup
      const existing = await db
        .select({ duplicateKey: bankMovements.duplicateKey })
        .from(bankMovements);
      const existingKeys = new Set(existing.map((r) => r.duplicateKey));

      const toInsert = rows.filter((r) => !existingKeys.has(r.duplicateKey));
      const duplicatesSkipped = rows.length - toInsert.length;

      const [imp] = await db.insert(bankFileImports).values({
        fileName: input.fileName,
        fileType: input.fileType,
        importedRows: toInsert.length,
        duplicatesSkipped,
        status: "ok",
      });
      const importId = (imp as { insertId: number }).insertId;

      if (toInsert.length > 0) {
        await db.insert(bankMovements).values(
          toInsert.map((r) => ({
            importId,
            fecha: r.fecha,
            fechaValor: r.fechaValor || null,
            movimiento: r.movimiento || null,
            masDatos: r.masDatos || null,
            importe: String(r.importe),
            saldo: r.saldo != null ? String(r.saldo) : null,
            duplicateKey: r.duplicateKey,
            status: "pendiente" as const,
          }))
        );
      }

      return { importId, importedRows: toInsert.length, duplicatesSkipped };
    }),

  listMovements: adminProc
    .input(z.object({
      importId: z.number().optional(),
      status: z.enum(["pendiente", "ignorado", "todos"]).default("todos"),
      fechaFrom: z.string().optional(),
      fechaTo: z.string().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.importId) conditions.push(eq(bankMovements.importId, input.importId));
      if (input.status !== "todos") conditions.push(eq(bankMovements.status, input.status as "pendiente" | "ignorado"));
      if (input.fechaFrom) conditions.push(gte(bankMovements.fecha, input.fechaFrom));
      if (input.fechaTo) conditions.push(lte(bankMovements.fecha, input.fechaTo));

      const baseQuery = db.select().from(bankMovements);
      const withWhere = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

      const rows = await withWhere.orderBy(desc(bankMovements.fecha), desc(bankMovements.id));

      // Client-side search filter (movimiento + masDatos)
      const search = input.search?.toLowerCase().trim();
      const filtered = search
        ? rows.filter(
            (r) =>
              r.movimiento?.toLowerCase().includes(search) ||
              r.masDatos?.toLowerCase().includes(search)
          )
        : rows;

      const total = filtered.length;
      const offset = (input.page - 1) * input.pageSize;
      const data = filtered.slice(offset, offset + input.pageSize);

      // Totals
      const totalIngresado = filtered
        .filter((r) => r.status !== "ignorado" && parseFloat(r.importe) > 0)
        .reduce((s, r) => s + parseFloat(r.importe), 0);
      const totalCargado = filtered
        .filter((r) => r.status !== "ignorado" && parseFloat(r.importe) < 0)
        .reduce((s, r) => s + parseFloat(r.importe), 0);

      return { data, total, totalIngresado, totalCargado };
    }),

  updateMovementStatus: adminProc
    .input(z.object({
      id: z.number(),
      status: z.enum(["pendiente", "ignorado"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.update(bankMovements)
        .set({ status: input.status, notes: input.notes ?? null })
        .where(eq(bankMovements.id, input.id));
      return { success: true };
    }),
});
