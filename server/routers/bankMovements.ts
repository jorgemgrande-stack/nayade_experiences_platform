import { z } from "zod";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, count, desc, eq, gte, lte, ne, inArray, isNull, or, sql, sum } from "drizzle-orm";
import { protectedProcedure } from "../_core/trpc";
import { bankFileImports, bankMovements, bankMovementLinks, quotes, leads, expenses, reservations } from "../../drizzle/schema";
import * as XLSX from "xlsx";
import { assertModuleEnabled } from "../_core/flagGuard";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const adminProc = protectedProcedure.use(async ({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido" });
  }
  await assertModuleEnabled("bank_movements_module_enabled");
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

// ── Expense auto-category suggestion ─────────────────────────────────────────

const _EXPENSE_KEYWORD_CATS: Array<{ keywords: string[]; name: string }> = [
  { keywords: ["iberdrola", "endesa", "i-de redes", "electricidad"], name: "Electricidad" },
  { keywords: ["canal isabel", "aguas de", "aguas municipal"], name: "Agua" },
  { keywords: ["naturgy", "gas natural redes"], name: "Gas" },
  { keywords: ["movistar", "vodafone", "orange", "jazztel", "masmovil", "simyo", "telefonica"], name: "Telecomunicaciones" },
  { keywords: ["amazon", "amzn mktplace"], name: "Material de oficina" },
  { keywords: ["mapfre", "axa", "zurich", "helvetia", "allianz", "seguros"], name: "Seguros" },
  { keywords: ["alquiler", "arrendamiento"], name: "Alquiler" },
  { keywords: ["agencia tributaria", "aeat"], name: "Impuestos" },
  { keywords: ["seguridad social", "tgss", "tesoreria ss"], name: "Seguridad Social" },
  { keywords: ["google", "microsoft", "apple.com/bill", "dropbox", "adobe", "slack"], name: "Software" },
  { keywords: ["spotify", "netflix", "amazon prime"], name: "Suscripciones" },
];

function _suggestExpenseCategoryName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const entry of _EXPENSE_KEYWORD_CATS) {
    if (entry.keywords.some(k => lower.includes(k))) return entry.name;
  }
  return null;
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

  // ── FASE 2A: Conciliación bancaria (solo transferencias) ──────────────────

  /** Busca presupuestos pendientes que podrían corresponder a un movimiento bancario. */
  findMatches: adminProc
    .input(z.object({ bankMovementId: z.number() }))
    .query(async ({ input }) => {
      const [movement] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
      if (!movement) throw new TRPCError({ code: "NOT_FOUND" });

      const movAmount = parseFloat(movement.importe);
      if (movAmount <= 0) return { movement, matches: [] };

      // IDs de presupuestos ya vinculados con status confirmed (excluir)
      const confirmedLinks = await db
        .select({ entityId: bankMovementLinks.entityId })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.entityType, "quote"),
          eq(bankMovementLinks.status, "confirmed"),
        ));
      const confirmedQuoteIds = confirmedLinks.map(l => l.entityId);

      // IDs ya rechazados para ESTE movimiento (no mostrar como propuesta principal)
      const rejectedLinks = await db
        .select({ entityId: bankMovementLinks.entityId })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, input.bankMovementId),
          eq(bankMovementLinks.entityType, "quote"),
          eq(bankMovementLinks.status, "rejected"),
        ));
      const rejectedQuoteIds = rejectedLinks.map(l => l.entityId);

      // Presupuestos candidatos: enviados/visualizados sin pagar
      const candidateConditions = [
        inArray(quotes.status, ["enviado", "visualizado"]),
        isNull(quotes.paidAt),
      ];
      if (confirmedQuoteIds.length > 0) {
        // No incluir ya conciliados
      }

      const allQuotes = await db
        .select({
          id: quotes.id,
          quoteNumber: quotes.quoteNumber,
          title: quotes.title,
          total: quotes.total,
          status: quotes.status,
          sentAt: quotes.sentAt,
          leadId: quotes.leadId,
        })
        .from(quotes)
        .where(and(...candidateConditions))
        .orderBy(desc(quotes.sentAt))
        .limit(200);

      // Obtener leads para enriquecer con nombre/email/teléfono
      const leadIds = Array.from(new Set(allQuotes.map(q => q.leadId)));
      const leadsData = leadIds.length > 0
        ? await db.select({ id: leads.id, name: leads.name, email: leads.email, phone: leads.phone })
            .from(leads).where(inArray(leads.id, leadIds))
        : [];
      const leadsMap = new Map(leadsData.map(l => [l.id, l]));

      const concept = `${movement.movimiento ?? ""} ${movement.masDatos ?? ""}`.toLowerCase();
      const movDate = movement.fecha;

      const matches = allQuotes
        .filter(q => !confirmedQuoteIds.includes(q.id))
        .map(q => {
          const lead = leadsMap.get(q.leadId);
          const qTotal = parseFloat(String(q.total));
          let score = 0;

          // +50 importe exacto
          if (Math.abs(qTotal - movAmount) < 0.02) score += 50;
          // +20 fecha dentro de 7 días
          if (movDate && q.sentAt) {
            const diffDays = Math.abs((new Date(movDate).getTime() - new Date(q.sentAt).getTime()) / 86400000);
            if (diffDays <= 7) score += 20;
          }
          // +15 nombre/apellido en concepto
          if (lead?.name) {
            const nameParts = lead.name.toLowerCase().split(/\s+/);
            if (nameParts.some(p => p.length > 2 && concept.includes(p))) score += 15;
          }
          // +10 número de presupuesto en concepto
          if (q.quoteNumber && concept.includes(q.quoteNumber.toLowerCase())) score += 10;
          // +10 email o teléfono en concepto
          if (lead?.email && concept.includes(lead.email.toLowerCase().split("@")[0])) score += 10;
          if (lead?.phone && concept.includes(lead.phone.replace(/\D/g, "").slice(-6))) score += 10;
          // -30 ya rechazado para este movimiento
          if (rejectedQuoteIds.includes(q.id)) score -= 30;

          return {
            quoteId: q.id,
            quoteNumber: q.quoteNumber,
            title: q.title,
            total: qTotal,
            status: q.status,
            sentAt: q.sentAt,
            clientName: lead?.name ?? null,
            clientEmail: lead?.email ?? null,
            clientPhone: lead?.phone ?? null,
            confidenceScore: score,
            isRejected: rejectedQuoteIds.includes(q.id),
          };
        })
        .filter(m => m.confidenceScore > 0)
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 10);

      return { movement, matches };
    }),

  /** Devuelve los vínculos (confirmado + historial) de un movimiento. */
  getLinks: adminProc
    .input(z.object({ bankMovementId: z.number() }))
    .query(async ({ input }) => {
      const links = await db
        .select()
        .from(bankMovementLinks)
        .where(eq(bankMovementLinks.bankMovementId, input.bankMovementId))
        .orderBy(desc(bankMovementLinks.createdAt));
      return links;
    }),

  /** Rechaza una propuesta de vínculo (no modifica presupuesto ni movimiento). */
  rejectLink: adminProc
    .input(z.object({
      bankMovementId: z.number(),
      quoteId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Upsert: si ya existe propuesta para este par, actualizarla; si no, crear
      const [existing] = await db
        .select({ id: bankMovementLinks.id })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, input.bankMovementId),
          eq(bankMovementLinks.entityType, "quote"),
          eq(bankMovementLinks.entityId, input.quoteId),
          ne(bankMovementLinks.status, "confirmed"),
        ))
        .limit(1);

      const now = new Date();
      if (existing) {
        await db.update(bankMovementLinks)
          .set({ status: "rejected", rejectedAt: now, matchedBy: ctx.user.name ?? undefined, notes: input.notes ?? null })
          .where(eq(bankMovementLinks.id, existing.id));
      } else {
        const [movement] = await db.select({ importe: bankMovements.importe })
          .from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
        const [quote] = await db.select({ total: quotes.total })
          .from(quotes).where(eq(quotes.id, input.quoteId));
        await db.insert(bankMovementLinks).values({
          bankMovementId: input.bankMovementId,
          entityType: "quote",
          entityId: input.quoteId,
          linkType: "income_transfer",
          amountLinked: String(quote?.total ?? movement?.importe ?? "0"),
          status: "rejected",
          rejectedAt: now,
          matchedBy: ctx.user.name ?? undefined,
          notes: input.notes ?? null,
        });
      }
      return { success: true };
    }),

  // ── GASTOS ↔ MOVIMIENTOS BANCARIOS ────────────────────────────────────────────

  /** Estadísticas de gastos y movimientos bancarios para dashboards. */
  getExpenseStats: adminProc.query(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    const [negativeMovements, linkedExpenseLinks, pendingExp, conciliadoExp, staleExp] = await Promise.all([
      db.select({ cnt: count() }).from(bankMovements)
        .where(and(eq(bankMovements.status, "pendiente"), sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) < 0`)),

      db.select({ bmId: bankMovementLinks.bankMovementId }).from(bankMovementLinks)
        .where(and(eq(bankMovementLinks.entityType, "expense"), inArray(bankMovementLinks.status, ["confirmed", "rejected"]))),

      db.select({ cnt: count(), total: sum(expenses.amount) }).from(expenses)
        .where(eq(expenses.status, "pending")),

      db.select({ cnt: count(), total: sum(expenses.amount) }).from(expenses)
        .where(and(eq(expenses.status, "conciliado"), gte(expenses.date, monthStart), lte(expenses.date, monthEnd))),

      db.select({ cnt: count() }).from(expenses)
        .where(and(eq(expenses.status, "pending"), lte(expenses.date, thirtyDaysAgo))),
    ]);

    const linkedIds = new Set(linkedExpenseLinks.map(l => l.bmId));
    const candidatesCount = Math.max(0, (negativeMovements[0]?.cnt ?? 0) - linkedIds.size);

    return {
      candidatesCount,
      pendingExpensesCount: Number(pendingExp[0]?.cnt ?? 0),
      pendingExpensesAmount: parseFloat(String(pendingExp[0]?.total ?? 0)),
      conciliadoThisMonthCount: Number(conciliadoExp[0]?.cnt ?? 0),
      conciliadoThisMonthAmount: parseFloat(String(conciliadoExp[0]?.total ?? 0)),
      staleExpensesCount: Number(staleExp[0]?.cnt ?? 0),
      periodLabel: now.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
    };
  }),

  /** Devuelve movimientos negativos sin vínculo de gasto confirmado o ignorado. */
  listExpenseCandidates: adminProc
    .input(z.object({ page: z.number().default(1), pageSize: z.number().default(30) }))
    .query(async ({ input }) => {
      const all = await db
        .select()
        .from(bankMovements)
        .where(and(
          eq(bankMovements.status, "pendiente"),
          sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) < 0`,
        ))
        .orderBy(desc(bankMovements.fecha), desc(bankMovements.id));

      const linkedLinks = await db
        .select({ bmId: bankMovementLinks.bankMovementId })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.entityType, "expense"),
          inArray(bankMovementLinks.status, ["confirmed", "rejected"]),
        ));
      const linkedIds = new Set(linkedLinks.map(l => l.bmId));

      const candidates = all.filter(m => !linkedIds.has(m.id));
      const total = candidates.length;
      const offset = (input.page - 1) * input.pageSize;
      const data = candidates.slice(offset, offset + input.pageSize).map(m => ({
        ...m,
        suggestedCategoryName: _suggestExpenseCategoryName(`${m.movimiento ?? ""} ${m.masDatos ?? ""}`),
      }));
      return { data, total };
    }),

  /** Crea un nuevo gasto y lo vincula a un movimiento negativo. */
  createExpenseFromMovement: adminProc
    .input(z.object({
      bankMovementId: z.number(),
      concept: z.string().min(1),
      categoryId: z.number(),
      costCenterId: z.number(),
      supplierId: z.number().nullable().optional(),
      paymentMethod: z.enum(["cash", "card", "transfer", "direct_debit", "tpv_cash"]).default("transfer"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [movement] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
      if (!movement) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento no encontrado" });
      const movAmt = parseFloat(movement.importe);
      if (movAmt >= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Solo movimientos negativos se pueden vincular a gastos" });

      const [existing] = await db
        .select({ id: bankMovementLinks.id })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, input.bankMovementId),
          eq(bankMovementLinks.entityType, "expense"),
          eq(bankMovementLinks.status, "confirmed"),
        ))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "El movimiento ya está vinculado a un gasto" });

      const amount = Math.abs(movAmt).toFixed(2);
      const now = new Date();

      const [expRes] = await db.insert(expenses).values({
        date: movement.fecha,
        concept: input.concept,
        amount,
        categoryId: input.categoryId,
        costCenterId: input.costCenterId,
        supplierId: input.supplierId ?? null,
        paymentMethod: input.paymentMethod,
        status: "conciliado",
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      const expenseId = (expRes as { insertId: number }).insertId;

      await db.insert(bankMovementLinks).values({
        bankMovementId: input.bankMovementId,
        entityType: "expense",
        entityId: expenseId,
        linkType: "expense_payment",
        amountLinked: amount,
        status: "confirmed",
        confidenceScore: 100,
        matchedBy: ctx.user.name ?? undefined,
        matchedAt: now,
      });

      await db.update(bankMovements)
        .set({ conciliationStatus: "conciliado" })
        .where(eq(bankMovements.id, input.bankMovementId));

      return { expenseId };
    }),

  /** Vincula un gasto existente a un movimiento negativo. */
  linkExpenseToMovement: adminProc
    .input(z.object({
      bankMovementId: z.number(),
      expenseId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [[movement], [expense]] = await Promise.all([
        db.select({ id: bankMovements.id, importe: bankMovements.importe }).from(bankMovements).where(eq(bankMovements.id, input.bankMovementId)),
        db.select({ id: expenses.id, amount: expenses.amount }).from(expenses).where(eq(expenses.id, input.expenseId)),
      ]);
      if (!movement) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento no encontrado" });
      if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Gasto no encontrado" });

      const [[existingMovLink], [existingExpLink]] = await Promise.all([
        db.select({ id: bankMovementLinks.id }).from(bankMovementLinks)
          .where(and(eq(bankMovementLinks.bankMovementId, input.bankMovementId), eq(bankMovementLinks.entityType, "expense"), eq(bankMovementLinks.status, "confirmed"))).limit(1),
        db.select({ id: bankMovementLinks.id }).from(bankMovementLinks)
          .where(and(eq(bankMovementLinks.entityType, "expense"), eq(bankMovementLinks.entityId, input.expenseId), eq(bankMovementLinks.status, "confirmed"))).limit(1),
      ]);
      if (existingMovLink) throw new TRPCError({ code: "CONFLICT", message: "El movimiento ya tiene un gasto vinculado" });
      if (existingExpLink) throw new TRPCError({ code: "CONFLICT", message: "El gasto ya está vinculado a un movimiento" });

      const now = new Date();
      await db.insert(bankMovementLinks).values({
        bankMovementId: input.bankMovementId,
        entityType: "expense",
        entityId: input.expenseId,
        linkType: "expense_payment",
        amountLinked: expense.amount,
        status: "confirmed",
        matchedBy: ctx.user.name ?? undefined,
        matchedAt: now,
        notes: input.notes ?? null,
      });

      await Promise.all([
        db.update(bankMovements).set({ conciliationStatus: "conciliado" }).where(eq(bankMovements.id, input.bankMovementId)),
        db.update(expenses).set({ status: "conciliado" }).where(eq(expenses.id, input.expenseId)),
      ]);

      return { success: true };
    }),

  /** Ignora un movimiento negativo (no necesita gasto vinculado). */
  ignoreForExpense: adminProc
    .input(z.object({ bankMovementId: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(bankMovements)
        .set({ status: "ignorado" })
        .where(eq(bankMovements.id, input.bankMovementId));
      return { success: true };
    }),

  /** Desvincula el gasto de un movimiento bancario. */
  unlinkExpenseFromMovement: adminProc
    .input(z.object({ bankMovementId: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [link] = await db
        .select()
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, input.bankMovementId),
          eq(bankMovementLinks.entityType, "expense"),
          eq(bankMovementLinks.status, "confirmed"),
        ))
        .limit(1);
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "No hay vínculo de gasto para deshacer" });

      const now = new Date();
      await db.update(bankMovementLinks)
        .set({ status: "unlinked", unlinkedAt: now, matchedBy: ctx.user.name ?? undefined, notes: input.notes ?? null })
        .where(eq(bankMovementLinks.id, link.id));

      await Promise.all([
        db.update(bankMovements).set({ conciliationStatus: "pendiente" }).where(eq(bankMovements.id, input.bankMovementId)),
        db.update(expenses).set({ status: "pending" }).where(eq(expenses.id, link.entityId)),
      ]);

      return { success: true };
    }),

  /** Conciliación manual para movimientos sin contrapartida en el sistema. */
  manuallyConciliate: adminProc
    .input(z.object({
      bankMovementId: z.number(),
      manualType: z.enum(["transferencia_interna", "comision_bancaria", "pago_impuesto", "ajuste_contable", "devolucion", "otro"]),
      counterparty: z.string().optional(),
      notes: z.string().min(1, "La justificación es obligatoria"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [movement] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
      if (!movement) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento no encontrado" });

      const [existing] = await db
        .select({ id: bankMovementLinks.id })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, input.bankMovementId),
          eq(bankMovementLinks.status, "confirmed"),
        ))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "El movimiento ya tiene una conciliación confirmada" });

      const now = new Date();
      await db.insert(bankMovementLinks).values({
        bankMovementId: input.bankMovementId,
        entityType: "manual",
        entityId: 0,
        linkType: "manual_conciliation",
        amountLinked: movement.importe,
        status: "confirmed",
        confidenceScore: 100,
        matchedBy: ctx.user.name ?? undefined,
        matchedAt: now,
        notes: [
          `[${input.manualType}]`,
          input.counterparty ? `Contraparte: ${input.counterparty}` : null,
          input.notes,
        ].filter(Boolean).join(" · "),
      });

      await db.update(bankMovements)
        .set({ conciliationStatus: "conciliado" })
        .where(eq(bankMovements.id, input.bankMovementId));

      return { success: true };
    }),

  /** Previsión de tesorería: saldo actual + ingresos/gastos pendientes. */
  getCashflowForecast: adminProc.query(async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const in7d  = new Date(now.getTime() + 7  * 86400000).toISOString().slice(0, 10);
    const in30d = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);

    const [lastMovementRow, pendingExpRow, pendingRevRow, expIn7d, expIn30d] = await Promise.all([
      // Último saldo bancario registrado
      db.select({ saldo: bankMovements.saldo, fecha: bankMovements.fecha })
        .from(bankMovements)
        .where(sql`${bankMovements.saldo} IS NOT NULL`)
        .orderBy(desc(bankMovements.fecha), desc(bankMovements.id))
        .limit(1),

      // Gastos pendientes de pago (pending + justified)
      db.select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
        .from(expenses)
        .where(inArray(expenses.status, ["pending", "justified"])),

      // Reservas pendientes de pago (ingreso esperado)
      db.select({
        total: sql<string>`COALESCE(SUM(${reservations.amountTotal}), 0)`,
        count: count(),
      })
        .from(reservations)
        .where(inArray(reservations.status, ["pending_payment", "draft"])),

      // Gastos venciendo en ≤7 días (aquellos con fecha <= today+7 y pending)
      db.select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
        .from(expenses)
        .where(and(inArray(expenses.status, ["pending", "justified"]), lte(expenses.date, in7d))),

      // Gastos venciendo en ≤30 días
      db.select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
        .from(expenses)
        .where(and(inArray(expenses.status, ["pending", "justified"]), lte(expenses.date, in30d))),
    ]);

    const currentBalance     = parseFloat(lastMovementRow[0]?.saldo ?? "0");
    const lastBalanceDate    = lastMovementRow[0]?.fecha ?? today;
    const pendingExpenses    = parseFloat(pendingExpRow[0]?.total ?? "0");
    const pendingIncome      = parseFloat(pendingRevRow[0]?.total ?? "0") / 100; // cents
    const pendingCount       = Number(pendingRevRow[0]?.count ?? 0);
    const urgentExpenses7d   = parseFloat(expIn7d[0]?.total ?? "0");
    const urgentExpenses30d  = parseFloat(expIn30d[0]?.total ?? "0");

    return {
      currentBalance,
      lastBalanceDate,
      pendingIncome,
      pendingExpenses,
      pendingReservationCount: pendingCount,
      estimatedBalance: currentBalance + pendingIncome - pendingExpenses,
      forecast7d:  currentBalance - urgentExpenses7d,
      forecast30d: currentBalance + pendingIncome - urgentExpenses30d,
    };
  }),

  /** Desvincula una conciliación ya confirmada (no borra factura/reserva/presupuesto). */
  unlinkMovement: adminProc
    .input(z.object({
      bankMovementId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [confirmedLink] = await db
        .select()
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, input.bankMovementId),
          eq(bankMovementLinks.status, "confirmed"),
        ))
        .limit(1);

      if (!confirmedLink) throw new TRPCError({ code: "NOT_FOUND", message: "No hay conciliación confirmada para este movimiento." });

      const now = new Date();
      await db.update(bankMovementLinks)
        .set({ status: "unlinked", unlinkedAt: now, matchedBy: ctx.user.name ?? undefined, notes: input.notes ?? null })
        .where(eq(bankMovementLinks.id, confirmedLink.id));

      // Devolver movimiento a pendiente de conciliación
      await db.update(bankMovements)
        .set({ conciliationStatus: "pendiente" })
        .where(eq(bankMovements.id, input.bankMovementId));

      return { success: true };
    }),
});

