import { z } from "zod";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, desc, eq, gte, lte, like, or, sql } from "drizzle-orm";
import { protectedProcedure } from "../_core/trpc";
import { cardTerminalOperations, tpvFileImports, reservations, quotes, tpvSales } from "../../drizzle/schema";
import * as XLSX from "xlsx";
import { madridStartOfDayUtc, madridEndOfDayUtc } from "../utils/timezone";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const adminProc = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido" });
  }
  return next({ ctx });
});

// ── Comercia Global Payments (CaixaBank) TPV parser ──────────────────────────

function parseExcelDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const ms = (v - 25569) * 86400 * 1000;
    const dt = new Date(ms);
    if (dt.getUTCFullYear() > 1900 && dt.getUTCFullYear() < 2100) return dt;
  }
  const s = String(v).trim();
  // DD/MM/YYYY HH:MM
  const dtMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (dtMatch) {
    return new Date(`${dtMatch[3]}-${dtMatch[2]}-${dtMatch[1]}T${dtMatch[4]}:${dtMatch[5]}:00`);
  }
  // DD/MM/YYYY
  const dMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dMatch) {
    return new Date(`${dMatch[3]}-${dMatch[2]}-${dMatch[1]}T00:00:00`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function normalizeStr(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function makeDuplicateKey(
  _commerceCode: string,
  terminalCode: string,
  operationNumber: string,
  amount: number,
  dt: Date | null
): string {
  // commerceCode excluded: absent in some Excel exports, causing false-positive non-duplicates.
  // datetime truncated to date: minute-level precision causes false-positive non-duplicates.
  const dateStr = dt ? dt.toISOString().slice(0, 10) : "";
  return [normalizeStr(terminalCode), normalizeStr(operationNumber), amount.toFixed(2), dateStr].join("|");
}

interface ParsedTpvRow {
  operationDatetime: Date;
  operationNumber: string;
  commerceCode: string;
  terminalCode: string;
  operationType: "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO";
  amount: number;
  card: string;
  authorizationCode: string;
  duplicateKey: string;
}

function parseTpvBuffer(buffer: Buffer): ParsedTpvRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][];

  const COL_MAP: Record<string, number> = {};
  let headerRow = -1;

  const HEADER_ALIASES: Record<string, string[]> = {
    fecha: ["fecha", "date", "f.operacion", "f. operacion", "fecha operacion", "fecha operación"],
    operationNumber: ["nº operacion", "nº operación", "no operacion", "no operación", "num operacion", "num operación", "transaccion", "transacción", "nº transaccion", "nº transacción", "operacion", "operación"],
    commerceCode: ["codigo comercio", "código comercio", "cod comercio", "cód comercio", "comercio"],
    terminalCode: ["terminal", "num terminal", "nº terminal", "codigo terminal", "código terminal"],
    operationType: ["tipo op", "tipo operacion", "tipo operación", "tipo"],
    amount: ["importe"],
    card: ["tarjeta"],
    authorizationCode: ["autorizacion", "autorización", "cod autorizacion", "cod. autorizacion"],
  };

  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] as unknown[];
    const normalized = row.map((c) => normalizeStr(c));
    const hasImporte = normalized.some((c) => c === "importe");
    if (!hasImporte) continue;

    headerRow = r;
    normalized.forEach((h, i) => {
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (COL_MAP[key] == null && aliases.includes(h)) {
          COL_MAP[key] = i;
        }
      }
    });
    break;
  }

  if (headerRow === -1) throw new Error("No se encontró cabecera válida (columna Importe requerida)");
  if (COL_MAP["amount"] == null) throw new Error("Falta columna obligatoria: Importe");
  if (COL_MAP["fecha"] == null) throw new Error("Falta columna obligatoria: Fecha");

  const parsed: ParsedTpvRow[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const dt = parseExcelDate(row[COL_MAP["fecha"]]);
    if (!dt) continue;
    const amount = parseAmount(row[COL_MAP["amount"]]);
    if (amount === 0) continue;

    const operationNumber = String(row[COL_MAP["operationNumber"] ?? -1] ?? "").trim();
    const commerceCode = String(row[COL_MAP["commerceCode"] ?? -1] ?? "").trim();
    const terminalCode = String(row[COL_MAP["terminalCode"] ?? -1] ?? "").trim();
    const rawType = normalizeStr(row[COL_MAP["operationType"] ?? -1]);
    const operationType: "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO" =
      rawType.includes("venta") ? "VENTA" :
      rawType.includes("devolu") ? "DEVOLUCION" :
      rawType.includes("anula") ? "ANULACION" : "OTRO";
    const card = String(row[COL_MAP["card"] ?? -1] ?? "").trim();
    const authorizationCode = String(row[COL_MAP["authorizationCode"] ?? -1] ?? "").trim();

    const duplicateKey = makeDuplicateKey(commerceCode, terminalCode, operationNumber, amount, dt);

    parsed.push({
      operationDatetime: dt,
      operationNumber,
      commerceCode,
      terminalCode,
      operationType,
      amount,
      card,
      authorizationCode,
      duplicateKey,
    });
  }
  return parsed;
}

// ── Auto-link helper ─────────────────────────────────────────────────────────

// Exported for unit-testing the time window boundary logic.
export function isWithinTpvWindow(saleCreatedAtMs: number, opDatetime: Date): boolean {
  const opMs = opDatetime.getTime();
  return saleCreatedAtMs >= opMs - 2 * 60 * 60 * 1000 && saleCreatedAtMs <= opMs + 30 * 60 * 1000;
}

async function tryAutoLink(
  opId: number,
  operationNumber: string,
  amount: number,
  operationDatetime: Date,
  linkedBy: string
): Promise<{ linkedEntityType: "reservation" | "quote" | "none"; linkedEntityId: number | null }> {
  if (!operationNumber) return { linkedEntityType: "none", linkedEntityId: null };

  const searchPattern = `%Nº operación TPV: ${operationNumber}%`;

  // 1. Buscar en reservations.notes
  const [res] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(sql`${reservations.notes} LIKE ${searchPattern}`)
    .limit(1);

  if (res) {
    const now = new Date();
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "reservation",
      linkedEntityId: res.id,
      linkedAt: now,
      linkedBy,
      status: "conciliado",
    }).where(eq(cardTerminalOperations.id, opId));
    return { linkedEntityType: "reservation", linkedEntityId: res.id };
  }

  // 2. Buscar en quotes.notes
  const [qt] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(sql`${quotes.notes} LIKE ${searchPattern}`)
    .limit(1);

  if (qt) {
    const now = new Date();
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "quote",
      linkedEntityId: qt.id,
      linkedAt: now,
      linkedBy,
      status: "conciliado",
    }).where(eq(cardTerminalOperations.id, opId));
    return { linkedEntityType: "quote", linkedEntityId: qt.id };
  }

  // 3. Fallback: buscar en tpv_sales por importe + ventana temporal [-2h, +30min]
  const opMs = operationDatetime.getTime();
  const [sale] = await db
    .select({ id: tpvSales.id, reservationId: tpvSales.reservationId })
    .from(tpvSales)
    .where(and(
      eq(tpvSales.total, String(amount.toFixed(2))),
      gte(tpvSales.createdAt, opMs - 2 * 60 * 60 * 1000),
      lte(tpvSales.createdAt, opMs + 30 * 60 * 1000),
      eq(tpvSales.status, "paid"),
    ))
    .limit(1);

  if (sale && sale.reservationId != null) {
    const now = new Date();
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "reservation",
      linkedEntityId: sale.reservationId,
      linkedAt: now,
      linkedBy,
      status: "conciliado",
    }).where(eq(cardTerminalOperations.id, opId));
    return { linkedEntityType: "reservation", linkedEntityId: sale.reservationId };
  }

  return { linkedEntityType: "none", linkedEntityId: null };
}

// ── Router ────────────────────────────────────────────────────────────────────

export const cardTerminalOperationsRouter = router({

  listImports: adminProc.query(async () => {
    return db.select().from(tpvFileImports).orderBy(desc(tpvFileImports.createdAt));
  }),

  importExcel: adminProc
    .input(z.object({
      fileName: z.string(),
      fileType: z.string(),
      fileBase64: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      let rows: ParsedTpvRow[];
      try {
        rows = parseTpvBuffer(buffer);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.insert(tpvFileImports).values({
          fileName: input.fileName,
          fileType: input.fileType,
          importedRows: 0,
          duplicatesSkipped: 0,
          status: "error",
          errorMessage: msg,
        });
        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
      }

      const existing = await db.select({ duplicateKey: cardTerminalOperations.duplicateKey }).from(cardTerminalOperations);
      const existingKeys = new Set(existing.map((r) => r.duplicateKey));
      const toInsert = rows.filter((r) => !existingKeys.has(r.duplicateKey));
      const duplicatesSkipped = rows.length - toInsert.length;

      const [imp] = await db.insert(tpvFileImports).values({
        fileName: input.fileName,
        fileType: input.fileType,
        importedRows: toInsert.length,
        duplicatesSkipped,
        status: "ok",
      });
      const importId = (imp as { insertId: number }).insertId;

      let autoLinked = 0;
      if (toInsert.length > 0) {
        for (const r of toInsert) {
          // onDuplicateKeyUpdate with no-op acts as INSERT IGNORE: if the UNIQUE constraint
          // on duplicate_key fires (race condition or in-memory Set miss), the row is silently skipped.
          const [inserted] = await db.insert(cardTerminalOperations).values({
            importId,
            operationDatetime: r.operationDatetime,
            operationNumber: r.operationNumber,
            commerceCode: r.commerceCode || null,
            terminalCode: r.terminalCode || null,
            operationType: r.operationType,
            amount: String(r.amount),
            card: r.card || null,
            authorizationCode: r.authorizationCode || null,
            duplicateKey: r.duplicateKey,
            status: "pendiente",
          }).onDuplicateKeyUpdate({ set: { duplicateKey: sql`${cardTerminalOperations.duplicateKey}` } });
          const opId = (inserted as { insertId: number }).insertId;
          if (opId === 0) continue; // duplicate silently ignored
          const result = await tryAutoLink(opId, r.operationNumber, r.amount, r.operationDatetime, ctx.user.name ?? "sistema");
          if (result.linkedEntityType !== "none") autoLinked++;
        }
      }

      return { importId, importedRows: toInsert.length, duplicatesSkipped, autoLinked };
    }),

  list: adminProc
    .input(z.object({
      status: z.enum(["pendiente", "conciliado", "incidencia", "ignorado", "todos"]).default("todos"),
      operationType: z.enum(["VENTA", "DEVOLUCION", "ANULACION", "OTRO", "todos"]).default("todos"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      search: z.string().optional(),
      importId: z.number().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.status !== "todos") conditions.push(eq(cardTerminalOperations.status, input.status as "pendiente" | "conciliado" | "incidencia" | "ignorado"));
      if (input.operationType !== "todos") conditions.push(eq(cardTerminalOperations.operationType, input.operationType as "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO"));
      if (input.importId) conditions.push(eq(cardTerminalOperations.importId, input.importId));
      if (input.dateFrom) conditions.push(gte(cardTerminalOperations.operationDatetime, madridStartOfDayUtc(input.dateFrom)));
      if (input.dateTo)   conditions.push(lte(cardTerminalOperations.operationDatetime, madridEndOfDayUtc(input.dateTo)));

      const baseQuery = db.select().from(cardTerminalOperations);
      const withWhere = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
      const rows = await withWhere.orderBy(desc(cardTerminalOperations.operationDatetime), desc(cardTerminalOperations.id));

      const search = input.search?.toLowerCase().trim();
      const filtered = search
        ? rows.filter(
            (r) =>
              r.operationNumber?.toLowerCase().includes(search) ||
              r.card?.toLowerCase().includes(search) ||
              r.terminalCode?.toLowerCase().includes(search) ||
              r.commerceCode?.toLowerCase().includes(search) ||
              r.authorizationCode?.toLowerCase().includes(search)
          )
        : rows;

      const total = filtered.length;
      const offset = (input.page - 1) * input.pageSize;
      const data = filtered.slice(offset, offset + input.pageSize);

      const totalVentas = filtered
        .filter((r) => r.operationType === "VENTA" && r.status !== "ignorado")
        .reduce((s, r) => s + parseFloat(String(r.amount)), 0);
      const totalDevoluciones = filtered
        .filter((r) => r.operationType === "DEVOLUCION" && r.status !== "ignorado")
        .reduce((s, r) => s + parseFloat(String(r.amount)), 0);

      // Enriquecer con reservationNumber para las operaciones vinculadas a reservas
      const reservationIds = data
        .filter(r => r.linkedEntityType === "reservation" && r.linkedEntityId)
        .map(r => r.linkedEntityId!);

      const reservationNumberMap: Record<number, string> = {};
      if (reservationIds.length > 0) {
        const resRows = await db
          .select({ id: reservations.id, reservationNumber: reservations.reservationNumber })
          .from(reservations)
          .where(sql`${reservations.id} IN (${sql.join(reservationIds.map(id => sql`${id}`), sql`, `)})`);
        for (const r of resRows) reservationNumberMap[r.id] = r.reservationNumber;
      }

      const enrichedData = data.map(r => ({
        ...r,
        linkedReservationNumber: r.linkedEntityType === "reservation" && r.linkedEntityId
          ? (reservationNumberMap[r.linkedEntityId] ?? null)
          : null,
      }));

      return { data: enrichedData, total, totalVentas, totalDevoluciones };
    }),

  getById: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [op] = await db.select().from(cardTerminalOperations).where(eq(cardTerminalOperations.id, input.id));
      if (!op) throw new TRPCError({ code: "NOT_FOUND" });
      return op;
    }),

  searchUnlinkedReservations: adminProc
    .input(z.object({
      search: z.string().optional(),
      amountEur: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const conditions: ReturnType<typeof eq>[] = [
        sql`${reservations.id} NOT IN (
          SELECT linked_entity_id FROM card_terminal_operations
          WHERE linked_entity_type = 'reservation' AND linked_entity_id IS NOT NULL
        )` as any,
      ];
      if (input.search?.trim()) {
        const term = `%${input.search.trim()}%`;
        conditions.push(or(
          like(reservations.customerName, term),
          like(reservations.reservationNumber, term),
        ) as any);
      }
      if (input.amountEur !== undefined) {
        conditions.push(eq(reservations.amountTotal, Math.round(input.amountEur * 100)) as any);
      }
      return db.select({
        id: reservations.id,
        reservationNumber: reservations.reservationNumber,
        customerName: reservations.customerName,
        amountTotal: reservations.amountTotal,
        bookingDate: reservations.bookingDate,
      }).from(reservations)
        .where(and(...conditions))
        .orderBy(desc(reservations.id))
        .limit(15);
    }),

  linkManually: adminProc
    .input(z.object({
      id: z.number(),
      entityType: z.enum(["reservation", "quote"]),
      entityId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [op] = await db.select().from(cardTerminalOperations).where(eq(cardTerminalOperations.id, input.id));
      if (!op) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cardTerminalOperations).set({
        linkedEntityType: input.entityType,
        linkedEntityId: input.entityId,
        linkedAt: new Date(),
        linkedBy: ctx.user.name ?? "admin",
        status: "conciliado",
        notes: input.notes ?? op.notes,
      }).where(eq(cardTerminalOperations.id, input.id));

      return { success: true };
    }),

  markIncident: adminProc
    .input(z.object({
      id: z.number(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      await db.update(cardTerminalOperations).set({
        status: "incidencia",
        incidentReason: input.reason,
      }).where(eq(cardTerminalOperations.id, input.id));
      return { success: true };
    }),

  unlink: adminProc
    .input(z.object({
      id: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.update(cardTerminalOperations).set({
        linkedEntityType: "none",
        linkedEntityId: null,
        linkedAt: null,
        linkedBy: null,
        status: "pendiente",
        notes: input.notes ?? null,
      }).where(eq(cardTerminalOperations.id, input.id));
      return { success: true };
    }),

  updateStatus: adminProc
    .input(z.object({
      id: z.number(),
      status: z.enum(["pendiente", "ignorado"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.update(cardTerminalOperations).set({
        status: input.status,
        notes: input.notes ?? null,
      }).where(eq(cardTerminalOperations.id, input.id));
      return { success: true };
    }),

  deleteImport: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(cardTerminalOperations).where(eq(cardTerminalOperations.importId, input.id));
      await db.delete(tpvFileImports).where(eq(tpvFileImports.id, input.id));
      return { success: true };
    }),

  // Repairs ops that ended up with linkedEntityType set but status still "pendiente"
  // or "included_in_batch" due to a race between relinkService and emailService on boot.
  repairLinkedStatus: adminProc.mutation(async () => {
    const result = await db
      .update(cardTerminalOperations)
      .set({ status: "conciliado" })
      .where(and(
        sql`${cardTerminalOperations.linkedEntityType} != 'none'`,
        sql`${cardTerminalOperations.status} IN ('pendiente', 'included_in_batch')`,
      ));
    const fixed = (result[0] as any)?.affectedRows ?? 0;
    return { fixed };
  }),
});

