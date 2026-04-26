import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { finCashAccounts, finCashMovements, finCashClosures } from "../../drizzle/schema";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

const adminProc = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

const INCOME_TYPES = ["income", "transfer_in", "opening_balance"] as const;
const EXPENSE_TYPES = ["expense", "transfer_out"] as const;

function balanceDelta(type: string, amount: number): number {
  if ((INCOME_TYPES as readonly string[]).includes(type)) return amount;
  if ((EXPENSE_TYPES as readonly string[]).includes(type)) return -amount;
  return 0;
}

export const cashRegisterRouter = router({
  // ── Accounts ────────────────────────────────────────────────────────────────
  listAccounts: adminProc.query(async () => {
    return db.select().from(finCashAccounts).orderBy(finCashAccounts.name);
  }),

  createAccount: adminProc
    .input(z.object({
      name: z.string().min(1).max(128),
      description: z.string().optional(),
      type: z.enum(["principal", "secondary", "petty_cash", "other"]).default("principal"),
      initialBalance: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      await db.insert(finCashAccounts).values({
        name: input.name,
        description: input.description,
        type: input.type,
        initialBalance: String(input.initialBalance),
        currentBalance: String(input.initialBalance),
      });
      return { ok: true };
    }),

  updateAccount: adminProc
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(128).optional(),
      description: z.string().optional(),
      type: z.enum(["principal", "secondary", "petty_cash", "other"]).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(finCashAccounts).set(data).where(eq(finCashAccounts.id, id));
      return { ok: true };
    }),

  // ── Movements ──────────────────────────────────────────────────────────────
  listMovements: adminProc
    .input(z.object({
      accountId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().default(200),
    }))
    .query(async ({ input }) => {
      const conds = [];
      if (input.accountId) conds.push(eq(finCashMovements.accountId, input.accountId));
      if (input.dateFrom) conds.push(gte(finCashMovements.date, input.dateFrom));
      if (input.dateTo) conds.push(lte(finCashMovements.date, input.dateTo));
      return db
        .select()
        .from(finCashMovements)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(finCashMovements.date), desc(finCashMovements.id))
        .limit(input.limit);
    }),

  createMovement: adminProc
    .input(z.object({
      accountId: z.number(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      type: z.enum(["income", "expense", "transfer_in", "transfer_out", "opening_balance", "adjustment"]),
      amount: z.number().positive(),
      concept: z.string().min(1).max(512),
      counterparty: z.string().max(256).optional(),
      category: z.string().max(128).optional(),
      relatedEntityType: z.enum(["reservation", "expense", "tpv_sale", "bank_deposit", "manual"]).optional(),
      relatedEntityId: z.number().optional(),
      transferToAccountId: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.insert(finCashMovements).values({
        accountId: input.accountId,
        date: input.date,
        type: input.type,
        amount: String(input.amount),
        concept: input.concept,
        counterparty: input.counterparty,
        category: input.category,
        relatedEntityType: input.relatedEntityType ?? "manual",
        relatedEntityId: input.relatedEntityId,
        transferToAccountId: input.transferToAccountId,
        notes: input.notes,
        createdBy: ctx.user.id,
      });

      // Update cached balance on source account
      const delta = balanceDelta(input.type, input.amount);
      await db
        .update(finCashAccounts)
        .set({ currentBalance: sql`current_balance + ${delta}` })
        .where(eq(finCashAccounts.id, input.accountId));

      // For transfers: create mirrored income movement on target account
      if (input.type === "transfer_out" && input.transferToAccountId) {
        await db.insert(finCashMovements).values({
          accountId: input.transferToAccountId,
          date: input.date,
          type: "transfer_in",
          amount: String(input.amount),
          concept: `Transferencia desde: ${input.concept}`,
          createdBy: ctx.user.id,
        });
        await db
          .update(finCashAccounts)
          .set({ currentBalance: sql`current_balance + ${input.amount}` })
          .where(eq(finCashAccounts.id, input.transferToAccountId));
      }

      return { ok: true };
    }),

  deleteMovement: adminProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [mv] = await db
        .select()
        .from(finCashMovements)
        .where(eq(finCashMovements.id, input.id));
      if (!mv) throw new TRPCError({ code: "NOT_FOUND" });

      const amount = parseFloat(mv.amount);
      // Reverse the balance impact
      const reverseDelta = -balanceDelta(mv.type, amount);
      await db
        .update(finCashAccounts)
        .set({ currentBalance: sql`current_balance + ${reverseDelta}` })
        .where(eq(finCashAccounts.id, mv.accountId));

      await db.delete(finCashMovements).where(eq(finCashMovements.id, input.id));
      return { ok: true };
    }),

  // ── Closures ───────────────────────────────────────────────────────────────
  listClosures: adminProc
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ input }) => {
      const conds = input.accountId ? [eq(finCashClosures.accountId, input.accountId)] : [];
      return db
        .select()
        .from(finCashClosures)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(finCashClosures.date));
    }),

  createClosure: adminProc
    .input(z.object({
      accountId: z.number(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      countedAmount: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [account] = await db
        .select()
        .from(finCashAccounts)
        .where(eq(finCashAccounts.id, input.accountId));
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });

      const movements = await db
        .select()
        .from(finCashMovements)
        .where(and(
          eq(finCashMovements.accountId, input.accountId),
          eq(finCashMovements.date, input.date),
        ));

      const totalIncome = movements
        .filter(m => (INCOME_TYPES as readonly string[]).includes(m.type))
        .reduce((s, m) => s + parseFloat(m.amount), 0);
      const totalExpenses = movements
        .filter(m => (EXPENSE_TYPES as readonly string[]).includes(m.type))
        .reduce((s, m) => s + parseFloat(m.amount), 0);

      // Opening balance: last closure's closing balance, or initial balance
      const [prevClosure] = await db
        .select()
        .from(finCashClosures)
        .where(eq(finCashClosures.accountId, input.accountId))
        .orderBy(desc(finCashClosures.date))
        .limit(1);

      const openingBalance = prevClosure
        ? parseFloat(prevClosure.closingBalance)
        : parseFloat(account.initialBalance);
      const closingBalance = openingBalance + totalIncome - totalExpenses;
      const difference =
        input.countedAmount !== undefined ? input.countedAmount - closingBalance : null;

      await db.insert(finCashClosures).values({
        accountId: input.accountId,
        date: input.date,
        openingBalance: String(openingBalance),
        totalIncome: String(totalIncome),
        totalExpenses: String(totalExpenses),
        closingBalance: String(closingBalance),
        countedAmount: input.countedAmount !== undefined ? String(input.countedAmount) : undefined,
        difference: difference !== null ? String(difference) : undefined,
        status: "closed",
        notes: input.notes,
        closedBy: ctx.user.id,
        closedAt: new Date(),
      });

      return { ok: true, closingBalance };
    }),

  // ── Summary ────────────────────────────────────────────────────────────────
  getSummary: adminProc.query(async () => {
    const accounts = await db
      .select()
      .from(finCashAccounts)
      .where(eq(finCashAccounts.isActive, true));

    const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.currentBalance), 0);
    const today = new Date().toISOString().slice(0, 10);

    const todayMovements = await db
      .select()
      .from(finCashMovements)
      .where(eq(finCashMovements.date, today));

    const todayIncome = todayMovements
      .filter(m => (INCOME_TYPES as readonly string[]).includes(m.type))
      .reduce((s, m) => s + parseFloat(m.amount), 0);
    const todayExpenses = todayMovements
      .filter(m => (EXPENSE_TYPES as readonly string[]).includes(m.type))
      .reduce((s, m) => s + parseFloat(m.amount), 0);

    return {
      accounts,
      totalBalance,
      todayIncome,
      todayExpenses,
      todayNet: todayIncome - todayExpenses,
    };
  }),
});
