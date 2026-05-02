import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, gte, lte, desc, sql, inArray, or, isNull, notInArray } from "drizzle-orm";
import { finCashAccounts, finCashMovements, finCashClosures, finCashAlerts, finCashClosureActions, reservations, expenses } from "../../drizzle/schema";
import { cashSessions } from "../../drizzle/schema";
import { createCashMovementIfNotExists } from "./cashRegisterHelper";
import { getSystemSetting } from "../config";
import { assertModuleEnabled } from "../_core/flagGuard";
import { madridDateKey } from "../utils/timezone";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

// RBAC-aware procedures. Fallback: admin only (cash module is admin-only by default).
const cashViewProc   = permissionProcedure("accounting.cash.view",   ["admin"]).use(async ({ ctx, next }) => {
  await assertModuleEnabled("cash_register_module_enabled");
  return next({ ctx });
});
const cashManageProc = permissionProcedure("accounting.cash.manage", ["admin"]).use(async ({ ctx, next }) => {
  await assertModuleEnabled("cash_register_module_enabled");
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
  listAccounts: cashViewProc.query(async () => {
    return db.select().from(finCashAccounts).orderBy(finCashAccounts.name);
  }),

  createAccount: cashManageProc
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

  updateAccount: cashManageProc
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
  listMovements: cashViewProc
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

  createMovement: cashManageProc
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

  deleteMovement: cashManageProc
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
  listClosures: cashViewProc
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ input }) => {
      const conds = input.accountId ? [eq(finCashClosures.accountId, input.accountId)] : [];
      return db
        .select()
        .from(finCashClosures)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(finCashClosures.date));
    }),

  createClosure: cashManageProc
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
  getSummary: cashViewProc.query(async () => {
    const accounts = await db
      .select()
      .from(finCashAccounts)
      .where(eq(finCashAccounts.isActive, true));

    const totalBalance = accounts.reduce((s, a) => s + parseFloat(a.currentBalance), 0);
    const today = madridDateKey();

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

  // ── Sincronización ─────────────────────────────────────────────────────────
  syncCheck: cashViewProc.query(async () => {
    // Reservas pagadas en efectivo
    const cashReservations = await db
      .select({
        id: reservations.id,
        amountTotal: reservations.amountTotal,
        bookingDate: reservations.bookingDate,
        customerName: reservations.customerName,
        reservationNumber: reservations.reservationNumber,
      })
      .from(reservations)
      .where(and(
        eq(reservations.paymentMethod, "efectivo"),
        eq(reservations.status, "paid"),
      ));

    const linkedResIds = new Set<number>();
    if (cashReservations.length) {
      const ids = cashReservations.map(r => r.id);
      const linked = await db
        .select({ relatedEntityId: finCashMovements.relatedEntityId })
        .from(finCashMovements)
        .where(and(
          eq(finCashMovements.relatedEntityType, "reservation"),
          eq(finCashMovements.type, "income"),
          inArray(finCashMovements.relatedEntityId, ids),
        ));
      for (const m of linked) if (m.relatedEntityId != null) linkedResIds.add(m.relatedEntityId);
    }

    // Gastos pagados en efectivo
    const cashExpenses = await db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        date: expenses.date,
        concept: expenses.concept,
      })
      .from(expenses)
      .where(or(
        eq(expenses.paymentMethod, "cash"),
        eq(expenses.paymentMethod, "tpv_cash"),
      ));

    const linkedExpIds = new Set<number>();
    if (cashExpenses.length) {
      const ids = cashExpenses.map(e => e.id);
      const linked = await db
        .select({ relatedEntityId: finCashMovements.relatedEntityId })
        .from(finCashMovements)
        .where(and(
          eq(finCashMovements.relatedEntityType, "expense"),
          eq(finCashMovements.type, "expense"),
          inArray(finCashMovements.relatedEntityId, ids),
        ));
      for (const m of linked) if (m.relatedEntityId != null) linkedExpIds.add(m.relatedEntityId);
    }

    return {
      missingReservations: cashReservations
        .filter(r => !linkedResIds.has(r.id))
        .map(r => ({
          id: r.id,
          reservationNumber: r.reservationNumber ?? `#${r.id}`,
          customerName: r.customerName,
          amount: (r.amountTotal ?? 0) / 100,
          date: r.bookingDate ?? "",
        })),
      missingExpenses: cashExpenses
        .filter(e => !linkedExpIds.has(e.id))
        .map(e => ({
          id: e.id,
          concept: e.concept,
          amount: parseFloat(e.amount),
          date: e.date,
        })),
    };
  }),

  // ── Alertas ────────────────────────────────────────────────────────────────
  listAlerts: cashViewProc
    .input(z.object({ includeResolved: z.boolean().default(false) }))
    .query(async ({ input }) => {
      const conds = input.includeResolved ? [] : [isNull(finCashAlerts.resolvedAt)];
      return db
        .select()
        .from(finCashAlerts)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(finCashAlerts.createdAt))
        .limit(100);
    }),

  markAlertRead: cashViewProc
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(finCashAlerts).set({ isRead: true }).where(eq(finCashAlerts.id, input.id));
      return { ok: true };
    }),

  markAllAlertsRead: cashViewProc.mutation(async () => {
    await db.update(finCashAlerts)
      .set({ isRead: true, resolvedAt: new Date() })
      .where(isNull(finCashAlerts.resolvedAt));
    return { ok: true };
  }),

  // ── Resolución de descuadres ────────────────────────────────────────────────
  listClosureActions: cashViewProc
    .input(z.object({ closureId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(finCashClosureActions)
        .where(eq(finCashClosureActions.closureId, input.closureId))
        .orderBy(desc(finCashClosureActions.createdAt));
    }),

  reviewClosure: cashManageProc
    .input(z.object({ closureId: z.number(), notes: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [closure] = await db.select().from(finCashClosures).where(eq(finCashClosures.id, input.closureId));
      if (!closure) throw new TRPCError({ code: "NOT_FOUND" });
      if (closure.status !== "difference") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden revisar cierres con diferencia pendiente" });
      }

      await db.update(finCashClosures).set({ status: "reviewed" }).where(eq(finCashClosures.id, input.closureId));

      await db.insert(finCashClosureActions).values({
        closureId: input.closureId,
        actionType: "review",
        notes: input.notes,
        createdById: ctx.user.id,
        createdByName: ctx.user.name ?? ctx.user.email ?? "admin",
      });

      if (closure.sourceEntityId) {
        await db.update(finCashAlerts).set({
          isRead: true,
          resolvedAt: new Date(),
          resolvedBy: ctx.user.name ?? ctx.user.email ?? "admin",
          resolutionNotes: input.notes,
          resolutionAction: "review",
        }).where(and(
          eq(finCashAlerts.sessionId, closure.sourceEntityId),
          isNull(finCashAlerts.resolvedAt),
        ));
      }

      return { ok: true };
    }),

  createClosureAdjustment: cashManageProc
    .input(z.object({ closureId: z.number(), notes: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [closure] = await db.select().from(finCashClosures).where(eq(finCashClosures.id, input.closureId));
      if (!closure) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["difference", "reviewed"].includes(closure.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden ajustar cierres con diferencia pendiente o revisados" });
      }

      // Idempotencia: no crear dos ajustes para el mismo cierre
      const [existingAdj] = await db
        .select({ id: finCashClosureActions.id })
        .from(finCashClosureActions)
        .where(and(
          eq(finCashClosureActions.closureId, input.closureId),
          eq(finCashClosureActions.actionType, "adjustment_created"),
        ))
        .limit(1);
      if (existingAdj) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un ajuste para este cierre" });

      const difference = parseFloat(closure.difference ?? "0");
      const cashTolerance = parseFloat(await getSystemSetting('cash_register_tolerance', '0.01')) || 0.01;
      if (Math.abs(difference) < cashTolerance) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay diferencia que ajustar" });

      const [defaultAcc] = await db
        .select({ id: finCashAccounts.id })
        .from(finCashAccounts)
        .where(and(eq(finCashAccounts.type, "principal"), eq(finCashAccounts.isActive, true)))
        .limit(1);
      if (!defaultAcc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay cuenta de caja principal activa" });

      const sessionRef = closure.sourceEntityId ? `TPV #${closure.sourceEntityId}` : `cierre #${closure.id}`;
      const movType: "income" | "expense" = difference > 0 ? "income" : "expense";
      const movAmount = Math.abs(difference);
      const concept = difference > 0
        ? `Ajuste por sobrante ${sessionRef}`
        : `Ajuste por faltante ${sessionRef}`;

      await db.insert(finCashMovements).values({
        accountId: defaultAcc.id,
        date: closure.date,
        type: movType,
        amount: String(movAmount.toFixed(2)),
        concept,
        category: "cash_adjustment",
        notes: input.notes,
        relatedEntityType: "manual",
        createdBy: ctx.user.id,
      });

      const delta = movType === "income" ? movAmount : -movAmount;
      await db.update(finCashAccounts)
        .set({ currentBalance: sql`current_balance + ${delta}` })
        .where(eq(finCashAccounts.id, defaultAcc.id));

      await db.update(finCashClosures).set({ status: "adjusted" }).where(eq(finCashClosures.id, input.closureId));

      await db.insert(finCashClosureActions).values({
        closureId: input.closureId,
        actionType: "adjustment_created",
        amount: String(movAmount.toFixed(2)),
        notes: input.notes,
        createdById: ctx.user.id,
        createdByName: ctx.user.name ?? ctx.user.email ?? "admin",
      });

      if (closure.sourceEntityId) {
        await db.update(finCashAlerts).set({
          isRead: true,
          resolvedAt: new Date(),
          resolvedBy: ctx.user.name ?? ctx.user.email ?? "admin",
          resolutionNotes: input.notes,
          resolutionAction: "adjustment_created",
        }).where(and(
          eq(finCashAlerts.sessionId, closure.sourceEntityId),
          isNull(finCashAlerts.resolvedAt),
        ));
      }

      return { ok: true, concept, amount: movAmount, movType };
    }),

  acceptDifference: cashManageProc
    .input(z.object({ closureId: z.number(), notes: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [closure] = await db.select().from(finCashClosures).where(eq(finCashClosures.id, input.closureId));
      if (!closure) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["difference", "reviewed"].includes(closure.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden aceptar cierres con diferencia pendiente o revisados" });
      }

      await db.update(finCashClosures).set({ status: "accepted_difference" }).where(eq(finCashClosures.id, input.closureId));

      await db.insert(finCashClosureActions).values({
        closureId: input.closureId,
        actionType: "accepted_difference",
        amount: closure.difference ?? null,
        notes: input.notes,
        createdById: ctx.user.id,
        createdByName: ctx.user.name ?? ctx.user.email ?? "admin",
      });

      if (closure.sourceEntityId) {
        await db.update(finCashAlerts).set({
          isRead: true,
          resolvedAt: new Date(),
          resolvedBy: ctx.user.name ?? ctx.user.email ?? "admin",
          resolutionNotes: input.notes,
          resolutionAction: "accepted_difference",
        }).where(and(
          eq(finCashAlerts.sessionId, closure.sourceEntityId),
          isNull(finCashAlerts.resolvedAt),
        ));
      }

      return { ok: true };
    }),

  addClosureNote: cashManageProc
    .input(z.object({ closureId: z.number(), notes: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [closure] = await db.select().from(finCashClosures).where(eq(finCashClosures.id, input.closureId));
      if (!closure) throw new TRPCError({ code: "NOT_FOUND" });

      await db.insert(finCashClosureActions).values({
        closureId: input.closureId,
        actionType: "note_added",
        notes: input.notes,
        createdById: ctx.user.id,
        createdByName: ctx.user.name ?? ctx.user.email ?? "admin",
      });

      return { ok: true };
    }),

  // ── Verificación de cierres ────────────────────────────────────────────────
  verifyCashClosures: cashViewProc.query(async () => {
    // Sesiones TPV cerradas sin cierre contable registrado
    const closedSessions = await db
      .select({
        id: cashSessions.id,
        cashierName: cashSessions.cashierName,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
        closingAmount: cashSessions.closingAmount,
        countedCash: cashSessions.countedCash,
        cashDifference: cashSessions.cashDifference,
      })
      .from(cashSessions)
      .where(eq(cashSessions.status, "closed"));

    const sessionIds = closedSessions.map(s => s.id);
    const linkedIds = new Set<number>();
    if (sessionIds.length > 0) {
      const linked = await db
        .select({ sourceEntityId: finCashClosures.sourceEntityId })
        .from(finCashClosures)
        .where(and(
          eq(finCashClosures.sourceEntityType, "tpv_session"),
          inArray(finCashClosures.sourceEntityId, sessionIds),
        ));
      for (const l of linked) if (l.sourceEntityId != null) linkedIds.add(l.sourceEntityId);
    }

    const missingSessions = closedSessions.filter(s => !linkedIds.has(s.id));

    // Cierres con diferencia no revisada (is_read = false en la alerta)
    const unreviewedAlerts = await db
      .select()
      .from(finCashAlerts)
      .where(and(
        eq(finCashAlerts.type, "cash_difference"),
        eq(finCashAlerts.isRead, false),
      ))
      .orderBy(desc(finCashAlerts.createdAt));

    // Posibles duplicados (más de un cierre por sesión)
    const duplicates: Array<{ sessionId: number; count: number }> = [];
    if (sessionIds.length > 0) {
      const allClosures = await db
        .select({ sourceEntityId: finCashClosures.sourceEntityId })
        .from(finCashClosures)
        .where(and(
          eq(finCashClosures.sourceEntityType, "tpv_session"),
          inArray(finCashClosures.sourceEntityId, sessionIds),
        ));
      const counts: Record<number, number> = {};
      for (const c of allClosures) {
        if (c.sourceEntityId != null) counts[c.sourceEntityId] = (counts[c.sourceEntityId] ?? 0) + 1;
      }
      for (const [id, count] of Object.entries(counts)) {
        if (count > 1) duplicates.push({ sessionId: Number(id), count });
      }
    }

    return { missingSessions, unreviewedAlerts, duplicates };
  }),

  runSync: cashManageProc.mutation(async ({ ctx }) => {
    const [defaultAcc] = await db
      .select({ id: finCashAccounts.id })
      .from(finCashAccounts)
      .where(and(
        eq(finCashAccounts.type, "principal"),
        eq(finCashAccounts.isActive, true),
      ))
      .limit(1);
    if (!defaultAcc) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No hay cuenta de caja principal activa",
      });
    }

    const userId = (ctx.user as { id: number }).id;

    // Sincronizar reservas
    const cashReservations = await db
      .select({
        id: reservations.id,
        amountTotal: reservations.amountTotal,
        bookingDate: reservations.bookingDate,
        customerName: reservations.customerName,
        reservationNumber: reservations.reservationNumber,
      })
      .from(reservations)
      .where(and(
        eq(reservations.paymentMethod, "efectivo"),
        eq(reservations.status, "paid"),
      ));

    let reservationsCreated = 0;
    for (const r of cashReservations) {
      try {
        const result = await createCashMovementIfNotExists({
          accountId: defaultAcc.id,
          date: (r.bookingDate ?? madridDateKey()).slice(0, 10),
          type: "income",
          amount: (r.amountTotal ?? 0) / 100,
          concept: `Cobro en efectivo ${r.reservationNumber ?? `#${r.id}`} — ${r.customerName}`,
          relatedEntityType: "reservation",
          relatedEntityId: r.id,
          createdBy: userId,
        });
        if (result.created) reservationsCreated++;
      } catch (e) {
        console.error("[runSync] Error en reserva", r.id, e);
      }
    }

    // Sincronizar gastos
    const cashExpenses = await db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        date: expenses.date,
        concept: expenses.concept,
      })
      .from(expenses)
      .where(or(
        eq(expenses.paymentMethod, "cash"),
        eq(expenses.paymentMethod, "tpv_cash"),
      ));

    let expensesCreated = 0;
    for (const e of cashExpenses) {
      try {
        const result = await createCashMovementIfNotExists({
          accountId: defaultAcc.id,
          date: (e.date ?? "").slice(0, 10),
          type: "expense",
          amount: parseFloat(e.amount),
          concept: `Pago en efectivo — ${e.concept}`,
          relatedEntityType: "expense",
          relatedEntityId: e.id,
          createdBy: userId,
        });
        if (result.created) expensesCreated++;
      } catch (ex) {
        console.error("[runSync] Error en gasto", e.id, ex);
      }
    }

    return { reservationsCreated, expensesCreated };
  }),
});

