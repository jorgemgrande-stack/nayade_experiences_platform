import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";

// RBAC-aware adminProcedure. Uses accounting.expenses.view as base permission;
// anyPermissionProcedure covers both view and manage semantics since today only
// admin has either, and admin has all permissions. Fallback: users.role === "admin".
const adminProcedure = permissionProcedure("accounting.expenses.view", ["admin"]);
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);
import {
  costCenters,
  expenseCategories,
  expenseEmailIngestionLogs,
  expenseFiles,
  expenseSuppliers,
  expenses,
  recurringExpenses,
  reservations,
  bankMovements,
  bankMovementLinks,
} from "../../drizzle/schema";
import { and, desc, eq, gte, lte, sql, inArray, isNull } from "drizzle-orm";
import { storagePut } from "../storage";
import { TRPCError } from "@trpc/server";
import { getDefaultCashAccountId, createCashMovementIfNotExists } from "./cashRegisterHelper";

// ─── helpers ─────────────────────────────────────────────────────────────────
function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function addMonths(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addWeeks(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}
function addYears(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Cost Centers ─────────────────────────────────────────────────────────────
const costCentersRouter = router({
  list: adminProcedure.query(async () => {
    return db.select().from(costCenters).orderBy(costCenters.name);
  }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [res] = await db.insert(costCenters).values({ name: input.name, description: input.description });
      return { id: res.insertId };
    }),

  update: adminProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1), description: z.string().optional(), active: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(costCenters).set(data).where(eq(costCenters.id, id));
      return { ok: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(costCenters).where(eq(costCenters.id, input.id));
      return { ok: true };
    }),
});

// ─── Expense Categories ───────────────────────────────────────────────────────
const expenseCategoriesRouter = router({
  list: adminProcedure.query(async () => {
    return db.select().from(expenseCategories).orderBy(expenseCategories.name);
  }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [res] = await db.insert(expenseCategories).values({ name: input.name, description: input.description });
      return { id: res.insertId };
    }),

  update: adminProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1), description: z.string().optional(), active: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(expenseCategories).set(data).where(eq(expenseCategories.id, id));
      return { ok: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(expenseCategories).where(eq(expenseCategories.id, input.id));
      return { ok: true };
    }),
});

// ─── Expense Suppliers ────────────────────────────────────────────────────────
const expenseSuppliersRouter = router({
  list: adminProcedure.query(async () => {
    return db.select().from(expenseSuppliers).orderBy(expenseSuppliers.name);
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      fiscalName: z.string().optional(),
      vatNumber: z.string().optional(),
      address: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      iban: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [res] = await db.insert(expenseSuppliers).values(input);
      return { id: res.insertId };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1),
      fiscalName: z.string().optional(),
      vatNumber: z.string().optional(),
      address: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      iban: z.string().optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(expenseSuppliers).set(data).where(eq(expenseSuppliers.id, id));
      return { ok: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(expenseSuppliers).where(eq(expenseSuppliers.id, input.id));
      return { ok: true };
    }),
});

// ─── Expenses ─────────────────────────────────────────────────────────────────
const expenseInputSchema = z.object({
  date: z.string().min(1),
  concept: z.string().min(1),
  amount: z.string().min(1),
  categoryId: z.number(),
  costCenterId: z.number(),
  supplierId: z.number().nullable().optional(),
  paymentMethod: z.enum(["cash", "card", "transfer", "direct_debit", "tpv_cash"]).default("transfer"),
  status: z.enum(["pending", "justified", "accounted", "conciliado"]).default("pending"),
  reservationId: z.number().nullable().optional(),
  productId: z.number().nullable().optional(),
  notes: z.string().optional(),
});

const expensesRouter = router({
  list: adminProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      categoryId: z.number().optional(),
      costCenterId: z.number().optional(),
      supplierId: z.number().optional(),
      status: z.enum(["pending", "justified", "accounted", "conciliado"]).optional(),
      paymentMethod: z.enum(["cash", "card", "transfer", "direct_debit", "tpv_cash"]).optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.dateFrom) conditions.push(gte(expenses.date, input.dateFrom));
      if (input.dateTo) conditions.push(lte(expenses.date, input.dateTo));
      if (input.categoryId) conditions.push(eq(expenses.categoryId, input.categoryId));
      if (input.costCenterId) conditions.push(eq(expenses.costCenterId, input.costCenterId));
      if (input.supplierId) conditions.push(eq(expenses.supplierId, input.supplierId));
      if (input.status) conditions.push(eq(expenses.status, input.status));
      if (input.paymentMethod) conditions.push(eq(expenses.paymentMethod, input.paymentMethod));

      const rows = await db
        .select()
        .from(expenses)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(expenses.date), desc(expenses.id))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(expenses)
        .where(conditions.length ? and(...conditions) : undefined);

      // Fetch files for each expense
      const ids = rows.map((r: typeof rows[number]) => r.id);
      const files = ids.length
        ? await db.select().from(expenseFiles).where(
            sql`${expenseFiles.expenseId} IN (${sql.join(ids.map((id: number) => sql`${id}`), sql`, `)})`
          )
        : [];

      type ExpenseFileRow = typeof files[number];
      const filesByExpense: Record<number, ExpenseFileRow[]> = {};
      for (const f of files) {
        if (!filesByExpense[f.expenseId]) filesByExpense[f.expenseId] = [];
        filesByExpense[f.expenseId].push(f);
      }

      return {
        items: rows.map((r) => ({ ...r, files: filesByExpense[r.id] ?? [] })),
        total: Number(total),
      };
    }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(expenses).where(eq(expenses.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const files = await db.select().from(expenseFiles).where(eq(expenseFiles.expenseId, input.id));
      return { ...row, files };
    }),

  create: adminProcedure
    .input(expenseInputSchema)
    .mutation(async ({ input, ctx }) => {
      const [res] = await db.insert(expenses).values({
        ...input,
        supplierId: input.supplierId ?? null,
        reservationId: input.reservationId ?? null,
        productId: input.productId ?? null,
        createdBy: ctx.user.id,
      });
      const expenseId = (res as { insertId: number }).insertId;
      if (input.paymentMethod === "cash" || input.paymentMethod === "tpv_cash") {
        try {
          const cashAccountId = await getDefaultCashAccountId();
          if (cashAccountId) {
            await createCashMovementIfNotExists({
              accountId: cashAccountId,
              date: input.date.slice(0, 10),
              type: "expense",
              amount: parseFloat(input.amount),
              concept: `Pago en efectivo — ${input.concept}`,
              relatedEntityType: "expense",
              relatedEntityId: expenseId,
              createdBy: ctx.user.id,
            });
          }
        } catch (e) {
          console.error("[expenses.create] Error creando movimiento de caja:", e);
        }
      }
      return { id: expenseId };
    }),

  update: adminProcedure
    .input(expenseInputSchema.extend({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.update(expenses).set({
        ...data,
        supplierId: data.supplierId ?? null,
        reservationId: data.reservationId ?? null,
        productId: data.productId ?? null,
      }).where(eq(expenses.id, id));
      if (data.paymentMethod === "cash" || data.paymentMethod === "tpv_cash") {
        try {
          const cashAccountId = await getDefaultCashAccountId();
          if (cashAccountId) {
            await createCashMovementIfNotExists({
              accountId: cashAccountId,
              date: data.date.slice(0, 10),
              type: "expense",
              amount: parseFloat(data.amount),
              concept: `Pago en efectivo — ${data.concept}`,
              relatedEntityType: "expense",
              relatedEntityId: id,
              createdBy: ctx.user.id,
            });
          }
        } catch (e) {
          console.error("[expenses.update] Error creando movimiento de caja:", e);
        }
      }
      return { ok: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(expenseFiles).where(eq(expenseFiles.expenseId, input.id));
      await db.delete(expenses).where(eq(expenses.id, input.id));
      return { ok: true };
    }),

  // Upload file attachment (base64 encoded)
  uploadFile: adminProcedure
    .input(z.object({
      expenseId: z.number(),
      fileName: z.string(),
      mimeType: z.string(),
      base64: z.string(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.base64, "base64");
      const key = `expenses/${input.expenseId}/${input.fileName}-${randomSuffix()}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await db.insert(expenseFiles).values({
        expenseId: input.expenseId,
        filePath: url,
        fileName: input.fileName,
        mimeType: input.mimeType,
      });
      return { url };
    }),

  deleteFile: adminProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(expenseFiles).where(eq(expenseFiles.id, input.fileId));
      return { ok: true };
    }),

  /** Devuelve el vínculo bancario confirmado de un gasto (si existe). */
  getExpenseBankLink: adminProcedure
    .input(z.object({ expenseId: z.number() }))
    .query(async ({ input }) => {
      const [link] = await db
        .select()
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.entityType, "expense"),
          eq(bankMovementLinks.entityId, input.expenseId),
          eq(bankMovementLinks.status, "confirmed"),
        ))
        .limit(1);
      if (!link) return null;
      const [movement] = await db
        .select({ id: bankMovements.id, fecha: bankMovements.fecha, importe: bankMovements.importe, movimiento: bankMovements.movimiento, masDatos: bankMovements.masDatos })
        .from(bankMovements)
        .where(eq(bankMovements.id, link.bankMovementId));
      return { link, movement: movement ?? null };
    }),

  /** Encuentra movimientos bancarios negativos candidatos para vincular a un gasto. */
  suggestBankMovements: adminProcedure
    .input(z.object({ expenseId: z.number() }))
    .query(async ({ input }) => {
      const [expense] = await db.select().from(expenses).where(eq(expenses.id, input.expenseId));
      if (!expense) return { matches: [] };

      const expAmt = parseFloat(expense.amount);
      const tolerance = parseFloat(process.env.EXPENSE_BANK_MATCH_TOLERANCE ?? "0.01");
      const dateFrom = new Date(new Date(expense.date).getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const dateTo = new Date(new Date(expense.date).getTime() + 30 * 86400000).toISOString().slice(0, 10);

      const alreadyLinked = await db
        .select({ bmId: bankMovementLinks.bankMovementId })
        .from(bankMovementLinks)
        .where(and(eq(bankMovementLinks.entityType, "expense"), inArray(bankMovementLinks.status, ["confirmed"])));
      const linkedIds = new Set(alreadyLinked.map(l => l.bmId));

      const candidates = await db
        .select()
        .from(bankMovements)
        .where(and(
          eq(bankMovements.status, "pendiente"),
          sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) < 0`,
          gte(bankMovements.fecha, dateFrom),
          lte(bankMovements.fecha, dateTo),
        ))
        .limit(100);

      const matches = candidates
        .filter(m => !linkedIds.has(m.id))
        .map(m => {
          const movAmt = Math.abs(parseFloat(m.importe));
          const diff = Math.abs(movAmt - expAmt);
          let score = 0;
          if (diff <= tolerance) score += 60;
          else if (diff / Math.max(movAmt, 1) < 0.05) score += 20;
          else return null;
          const diffDays = Math.abs((new Date(m.fecha).getTime() - new Date(expense.date).getTime()) / 86400000);
          if (diffDays <= 3) score += 20;
          else if (diffDays <= 7) score += 10;
          return { ...m, confidenceScore: score };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null && m.confidenceScore > 0)
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 5);

      return { matches };
    }),

  // Summary for a date range (used by Profit & Loss)
  summary: adminProcedure
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      groupBy: z.enum(["category", "costCenter", "paymentMethod", "month"]).default("category"),
    }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(expenses)
        .where(and(gte(expenses.date, input.dateFrom), lte(expenses.date, input.dateTo)));

      const total = rows.reduce((sum: number, r: typeof rows[number]) => sum + parseFloat(r.amount), 0);

      if (input.groupBy === "month") {
        const byMonth: Record<string, number> = {};
        for (const r of rows) {
          const month = r.date.slice(0, 7);
          byMonth[month] = (byMonth[month] ?? 0) + parseFloat(r.amount);
        }
        return { total, groups: Object.entries(byMonth).map(([key, amount]) => ({ key, amount })) };
      }

      if (input.groupBy === "category") {
        const byCategory: Record<number, number> = {};
        for (const r of rows) {
          byCategory[r.categoryId] = (byCategory[r.categoryId] ?? 0) + parseFloat(r.amount);
        }
        return { total, groups: Object.entries(byCategory).map(([key, amount]) => ({ key, amount })) };
      }

      if (input.groupBy === "costCenter") {
        const byCostCenter: Record<number, number> = {};
        for (const r of rows) {
          byCostCenter[r.costCenterId] = (byCostCenter[r.costCenterId] ?? 0) + parseFloat(r.amount);
        }
        return { total, groups: Object.entries(byCostCenter).map(([key, amount]) => ({ key, amount })) };
      }

      // paymentMethod
      const byMethod: Record<string, number> = {};
      for (const r of rows) {
        byMethod[r.paymentMethod] = (byMethod[r.paymentMethod] ?? 0) + parseFloat(r.amount);
      }
      return { total, groups: Object.entries(byMethod).map(([key, amount]) => ({ key, amount })) };
    }),
});

// ─── Recurring Expenses ───────────────────────────────────────────────────────
const recurringExpensesRouter = router({
  list: adminProcedure.query(async () => {
    return db.select().from(recurringExpenses).orderBy(recurringExpenses.nextExecutionDate);
  }),

  create: adminProcedure
    .input(z.object({
      concept: z.string().min(1),
      amount: z.string().min(1),
      categoryId: z.number(),
      costCenterId: z.number(),
      supplierId: z.number().nullable().optional(),
      recurrenceType: z.enum(["monthly", "weekly", "yearly"]).default("monthly"),
      nextExecutionDate: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const [res] = await db.insert(recurringExpenses).values({
        ...input,
        supplierId: input.supplierId ?? null,
      });
      return { id: res.insertId };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      concept: z.string().min(1),
      amount: z.string().min(1),
      categoryId: z.number(),
      costCenterId: z.number(),
      supplierId: z.number().nullable().optional(),
      recurrenceType: z.enum(["monthly", "weekly", "yearly"]).default("monthly"),
      nextExecutionDate: z.string().min(1),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(recurringExpenses).set({ ...data, supplierId: data.supplierId ?? null }).where(eq(recurringExpenses.id, id));
      return { ok: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(recurringExpenses).where(eq(recurringExpenses.id, input.id));
      return { ok: true };
    }),

  // Manually trigger a recurring expense (creates an expense and advances next date)
  trigger: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [rec] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, input.id));
      if (!rec) throw new TRPCError({ code: "NOT_FOUND" });

      const [res] = await db.insert(expenses).values({
        date: rec.nextExecutionDate,
        concept: rec.concept,
        amount: rec.amount,
        categoryId: rec.categoryId,
        costCenterId: rec.costCenterId,
        supplierId: rec.supplierId,
        paymentMethod: "transfer",
        status: "pending",
        createdBy: ctx.user.id,
      });

      // Advance next execution date
      let nextDate = rec.nextExecutionDate;
      if (rec.recurrenceType === "monthly") nextDate = addMonths(nextDate, 1);
      else if (rec.recurrenceType === "weekly") nextDate = addWeeks(nextDate, 1);
      else nextDate = addYears(nextDate, 1);

      await db.update(recurringExpenses).set({ nextExecutionDate: nextDate }).where(eq(recurringExpenses.id, input.id));

      return { expenseId: res.insertId, nextExecutionDate: nextDate };
    }),
});

// ─── helpers for profitLoss ───────────────────────────────────────────────────
async function _profitLossForPeriod(dateFrom: string, dateTo: string, conciliatedOnly: boolean) {
  const expenseConditions = [gte(expenses.date, dateFrom), lte(expenses.date, dateTo)];
  if (conciliatedOnly) expenseConditions.push(eq(expenses.status, "conciliado"));

  const [paidReservations, expenseRows] = await Promise.all([
    db.select().from(reservations).where(
      and(
        eq(reservations.status, "paid"),
        gte(sql`DATE(FROM_UNIXTIME(${reservations.paidAt} / 1000))`, dateFrom),
        lte(sql`DATE(FROM_UNIXTIME(${reservations.paidAt} / 1000))`, dateTo),
      )
    ),
    db.select().from(expenses).where(and(...expenseConditions)),
  ]);

  const totalRevenue = paidReservations.reduce((s, r) => s + r.amountTotal / 100, 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + parseFloat(r.amount), 0);
  const grossProfit = totalRevenue - totalExpenses;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  const revenueByChannel: Record<string, number> = {};
  const revenueByProduct: Record<string, number> = {};
  const revenueByChannelCount: Record<string, number> = {};
  for (const r of paidReservations) {
    const ch = r.channel ?? "web";
    revenueByChannel[ch] = (revenueByChannel[ch] ?? 0) + r.amountTotal / 100;
    revenueByChannelCount[ch] = (revenueByChannelCount[ch] ?? 0) + 1;
    revenueByProduct[r.productName] = (revenueByProduct[r.productName] ?? 0) + r.amountTotal / 100;
  }

  const expensesByCategory: Record<number, number> = {};
  const expensesByCostCenter: Record<number, number> = {};
  const monthlyRevenue: Record<string, number> = {};
  const monthlyExpenses: Record<string, number> = {};
  for (const r of expenseRows) {
    expensesByCategory[r.categoryId] = (expensesByCategory[r.categoryId] ?? 0) + parseFloat(r.amount);
    expensesByCostCenter[r.costCenterId] = (expensesByCostCenter[r.costCenterId] ?? 0) + parseFloat(r.amount);
    const month = r.date.slice(0, 7);
    monthlyExpenses[month] = (monthlyExpenses[month] ?? 0) + parseFloat(r.amount);
  }
  for (const r of paidReservations) {
    const month = new Date(r.paidAt!).toISOString().slice(0, 7);
    monthlyRevenue[month] = (monthlyRevenue[month] ?? 0) + r.amountTotal / 100;
  }

  return {
    summary: { totalRevenue, totalExpenses, grossProfit, grossMargin, reservationCount: paidReservations.length },
    revenueByChannel: Object.entries(revenueByChannel).map(([channel, amount]) => ({
      channel, amount, count: revenueByChannelCount[channel] ?? 0,
      ticketMedio: revenueByChannelCount[channel] > 0 ? amount / revenueByChannelCount[channel] : 0,
    })),
    revenueByProduct: Object.entries(revenueByProduct).sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([product, amount]) => ({ product, amount })),
    expensesByCategory: Object.entries(expensesByCategory).map(([categoryId, amount]) => ({ categoryId: Number(categoryId), amount })),
    expensesByCostCenter: Object.entries(expensesByCostCenter).map(([costCenterId, amount]) => ({ costCenterId: Number(costCenterId), amount })),
    monthly: (() => {
      const allMonths = new Set([...Object.keys(monthlyRevenue), ...Object.keys(monthlyExpenses)]);
      return Array.from(allMonths).sort().map((month) => ({
        month,
        revenue: monthlyRevenue[month] ?? 0,
        expenses: monthlyExpenses[month] ?? 0,
        profit: (monthlyRevenue[month] ?? 0) - (monthlyExpenses[month] ?? 0),
      }));
    })(),
  };
}

// ─── Profit & Loss (Cuenta de Resultados) ────────────────────────────────────
const profitLossRouter = router({
  report: adminProcedure
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      conciliatedOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      // Compute previous period (same duration, immediately before)
      const fromMs = new Date(input.dateFrom).getTime();
      const toMs = new Date(input.dateTo).getTime();
      const duration = toMs - fromMs;
      const prevDateTo = new Date(fromMs - 86400000).toISOString().slice(0, 10);
      const prevDateFrom = new Date(fromMs - 86400000 - duration).toISOString().slice(0, 10);

      const [current, prev] = await Promise.all([
        _profitLossForPeriod(input.dateFrom, input.dateTo, input.conciliatedOnly),
        _profitLossForPeriod(prevDateFrom, prevDateTo, input.conciliatedOnly),
      ]);

      return {
        ...current,
        prevSummary: prev.summary,
        prevPeriod: { dateFrom: prevDateFrom, dateTo: prevDateTo },
      };
    }),
});

// ─── Email Ingestion sub-router ──────────────────────────────────────────────
const emailIngestionRouter = router({
  triggerSync: adminProcedure
    .mutation(async () => {
      const { runExpenseEmailIngestion } = await import("../services/expenseEmailIngestionService");
      const result = await runExpenseEmailIngestion();
      return result;
    }),

  listLogs: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(expenseEmailIngestionLogs)
        .orderBy(desc(expenseEmailIngestionLogs.processedAt))
        .limit(input.limit);
    }),
});

// ─── Main export ──────────────────────────────────────────────────────────────
export const expensesModuleRouter = router({
  costCenters: costCentersRouter,
  categories: expenseCategoriesRouter,
  suppliers: expenseSuppliersRouter,
  expenses: expensesRouter,
  recurring: recurringExpensesRouter,
  profitLoss: profitLossRouter,
  emailIngestion: emailIngestionRouter,
});

