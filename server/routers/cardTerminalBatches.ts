import { z } from "zod";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, count, desc, eq, gte, lte, inArray, sql, sum } from "drizzle-orm";
import { protectedProcedure } from "../_core/trpc";
import {
  cardTerminalBatches,
  cardTerminalBatchOperations,
  cardTerminalBatchAuditLogs,
  cardTerminalOperations,
  bankMovements,
  bankMovementLinks,
} from "../../drizzle/schema";
import { runMatchingJob } from "../services/cardTerminalMatchingService";
import { assertModuleEnabled } from "../_core/flagGuard";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(pool);

const adminProc = protectedProcedure.use(async ({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido" });
  }
  await assertModuleEnabled("card_terminal_batches_enabled");
  return next({ ctx });
});

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(fromDate: string, toDate: string): number {
  const a = new Date(fromDate + "T12:00:00Z");
  const b = new Date(toDate + "T12:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export const cardTerminalBatchesRouter = router({
  generate: adminProc
    .input(z.object({
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .mutation(async ({ input }) => {
      const ops = await db.select()
        .from(cardTerminalOperations)
        .where(
          and(
            gte(sql`DATE(${cardTerminalOperations.operationDatetime})`, input.fromDate),
            lte(sql`DATE(${cardTerminalOperations.operationDatetime})`, input.toDate),
            sql`${cardTerminalOperations.status} NOT IN ('included_in_batch', 'settled', 'ignorado')`
          )
        );

      if (ops.length === 0) {
        return { batchesCreated: 0, operationsIncluded: 0 };
      }

      const groups = new Map<string, typeof ops>();
      for (const op of ops) {
        const dateStr = op.operationDatetime
          ? new Date(op.operationDatetime).toISOString().slice(0, 10)
          : input.fromDate;
        const key = `${dateStr}|${op.terminalCode ?? ""}|${op.commerceCode ?? ""}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(op);
      }

      let batchesCreated = 0;
      let operationsIncluded = 0;

      for (const [key, groupOps] of groups) {
        const [batchDate, terminalCode, commerceCode] = key.split("|");

        const existing = await db.select({ id: cardTerminalBatches.id })
          .from(cardTerminalBatches)
          .where(
            and(
              eq(cardTerminalBatches.batchDate, batchDate),
              terminalCode
                ? eq(cardTerminalBatches.terminalCode, terminalCode)
                : sql`${cardTerminalBatches.terminalCode} IS NULL`,
              commerceCode
                ? eq(cardTerminalBatches.commerceCode, commerceCode)
                : sql`${cardTerminalBatches.commerceCode} IS NULL`
            )
          )
          .limit(1);

        if (existing.length > 0) continue;

        let totalSales = 0;
        let totalRefunds = 0;
        for (const op of groupOps) {
          const amount = parseFloat(String(op.amount));
          if (op.operationType === "VENTA") totalSales += amount;
          else if (op.operationType === "DEVOLUCION") totalRefunds += amount;
        }
        const totalNet = totalSales - totalRefunds;

        const [insertResult] = await db.insert(cardTerminalBatches).values({
          batchDate,
          terminalCode: terminalCode || null,
          commerceCode: commerceCode || null,
          currency: "EUR",
          totalSales: totalSales.toFixed(2),
          totalRefunds: totalRefunds.toFixed(2),
          totalNet: totalNet.toFixed(2),
          operationCount: groupOps.length,
          linkedOperationsCount: groupOps.length,
          status: "pending",
        });

        const batchId = (insertResult as any).insertId as number;

        for (const op of groupOps) {
          await db.insert(cardTerminalBatchOperations).values({
            batchId,
            cardTerminalOperationId: op.id,
            amount: String(op.amount),
            operationType: op.operationType,
          });
        }

        const opIds = groupOps.map(op => op.id);
        await db.update(cardTerminalOperations)
          .set({ status: "included_in_batch" })
          .where(inArray(cardTerminalOperations.id, opIds));

        batchesCreated++;
        operationsIncluded += groupOps.length;
      }

      return { batchesCreated, operationsIncluded };
    }),

  list: adminProc
    .input(z.object({
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
      status: z.enum(["pending", "suggested", "auto_ready", "reconciled", "difference", "ignored", "review_required"]).optional(),
      terminalCode: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.fromDate) conditions.push(gte(cardTerminalBatches.batchDate, input.fromDate));
      if (input.toDate) conditions.push(lte(cardTerminalBatches.batchDate, input.toDate));
      if (input.status) conditions.push(eq(cardTerminalBatches.status, input.status));
      if (input.terminalCode) conditions.push(eq(cardTerminalBatches.terminalCode, input.terminalCode));

      return db.select()
        .from(cardTerminalBatches)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(cardTerminalBatches.batchDate), desc(cardTerminalBatches.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getById: adminProc
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.id))
        .limit(1);

      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      const operations = await db.select({
        batchOpId: cardTerminalBatchOperations.id,
        operationId: cardTerminalBatchOperations.cardTerminalOperationId,
        amount: cardTerminalBatchOperations.amount,
        batchOpType: cardTerminalBatchOperations.operationType,
        operationDatetime: cardTerminalOperations.operationDatetime,
        operationNumber: cardTerminalOperations.operationNumber,
        card: cardTerminalOperations.card,
        authorizationCode: cardTerminalOperations.authorizationCode,
        linkedEntityType: cardTerminalOperations.linkedEntityType,
        linkedEntityId: cardTerminalOperations.linkedEntityId,
        opStatus: cardTerminalOperations.status,
      })
        .from(cardTerminalBatchOperations)
        .innerJoin(
          cardTerminalOperations,
          eq(cardTerminalBatchOperations.cardTerminalOperationId, cardTerminalOperations.id)
        )
        .where(eq(cardTerminalBatchOperations.batchId, input.id));

      let bankMovement = null;
      if (batch.bankMovementId) {
        const [bm] = await db.select()
          .from(bankMovements)
          .where(eq(bankMovements.id, batch.bankMovementId))
          .limit(1);
        bankMovement = bm ?? null;
      }

      return { ...batch, operations, bankMovement };
    }),

  suggestBankMovements: adminProc
    .input(z.object({ batchId: z.number() }))
    .query(async ({ input }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);

      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      const batchNet = parseFloat(String(batch.totalNet));
      const batchDate = batch.batchDate;

      const fromDate = offsetDate(batchDate, -1);
      const toDate = offsetDate(batchDate, 4);

      const candidates = await db.select()
        .from(bankMovements)
        .where(
          and(
            gte(bankMovements.fecha, fromDate),
            lte(bankMovements.fecha, toDate),
            sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) > 0`
          )
        )
        .orderBy(desc(bankMovements.fecha));

      const scored = candidates.map(bm => {
        const bmAmount = parseFloat(String(bm.importe));
        let score = 0;

        const diff = Math.abs(bmAmount - batchNet);
        const pct = batchNet > 0 ? diff / batchNet : diff;
        if (diff < 0.01) score += 50;
        else if (pct < 0.005) score += 40;
        else if (pct < 0.01) score += 30;
        else if (pct < 0.05) score += 15;

        const daysDiff = dateDiffDays(batchDate, bm.fecha);
        if (daysDiff === 1) score += 40;
        else if (daysDiff === 2) score += 35;
        else if (daysDiff === 0) score += 20;
        else if (daysDiff === 3) score += 20;
        else if (daysDiff === -1) score += 5;

        const hint = ((bm.movimiento ?? "") + " " + (bm.masDatos ?? "")).toLowerCase();
        if (hint.includes("comercia") || hint.includes("tpv") || hint.includes("datafono") || hint.includes("tarjeta")) {
          score += 10;
        }

        return { ...bm, confidenceScore: Math.min(100, score) };
      });

      return scored
        .filter(s => s.confidenceScore >= 20)
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 10);
    }),

  reconcile: adminProc
    .input(z.object({
      batchId: z.number(),
      bankMovementId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Remesa no encontrada" });

      const [bm] = await db.select()
        .from(bankMovements)
        .where(eq(bankMovements.id, input.bankMovementId))
        .limit(1);
      if (!bm) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento bancario no encontrado" });

      const batchNet = parseFloat(String(batch.totalNet));
      const bmAmount = parseFloat(String(bm.importe));
      const diff = bmAmount - batchNet;
      const hasSignificantDiff = Math.abs(diff) > 0.01;

      await db.delete(bankMovementLinks)
        .where(
          and(
            eq(bankMovementLinks.bankMovementId, input.bankMovementId),
            eq(bankMovementLinks.entityType, "card_terminal_batch"),
            eq(bankMovementLinks.entityId, input.batchId)
          )
        );

      await db.insert(bankMovementLinks).values({
        bankMovementId: input.bankMovementId,
        entityType: "card_terminal_batch",
        entityId: input.batchId,
        linkType: "card_income",
        amountLinked: batchNet.toFixed(2),
        status: "confirmed",
        confidenceScore: 100,
        matchedBy: String(ctx.user.id),
        matchedAt: new Date(),
        notes: input.notes ?? null,
      });

      await db.update(cardTerminalBatches)
        .set({
          bankMovementId: input.bankMovementId,
          reconciledAt: new Date(),
          reconciledBy: String(ctx.user.id),
          differenceAmount: hasSignificantDiff ? diff.toFixed(2) : null,
          status: hasSignificantDiff ? "difference" : "reconciled",
          notes: input.notes ?? batch.notes,
        })
        .where(eq(cardTerminalBatches.id, input.batchId));

      const batchOps = await db.select({ cardTerminalOperationId: cardTerminalBatchOperations.cardTerminalOperationId })
        .from(cardTerminalBatchOperations)
        .where(eq(cardTerminalBatchOperations.batchId, input.batchId));

      if (batchOps.length > 0) {
        await db.update(cardTerminalOperations)
          .set({ status: "settled" })
          .where(inArray(cardTerminalOperations.id, batchOps.map(o => o.cardTerminalOperationId)));
      }

      await db.update(bankMovements)
        .set({ conciliationStatus: "conciliado" })
        .where(eq(bankMovements.id, input.bankMovementId));

      await db.insert(cardTerminalBatchAuditLogs).values({
        batchId: input.batchId,
        action: "manual_reconciled",
        bankMovementId: input.bankMovementId,
        score: 100,
        autoReconciled: false,
        performedBy: String(ctx.user.id),
        notes: input.notes ?? null,
      }).catch(() => {});

      return { success: true, hasDifference: hasSignificantDiff, differenceAmount: diff };
    }),

  unreconcile: adminProc
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ input }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      const bankMovementId = batch.bankMovementId;

      if (bankMovementId) {
        await db.delete(bankMovementLinks)
          .where(
            and(
              eq(bankMovementLinks.bankMovementId, bankMovementId),
              eq(bankMovementLinks.entityType, "card_terminal_batch"),
              eq(bankMovementLinks.entityId, input.batchId)
            )
          );

        const remainingLinks = await db.select({ id: bankMovementLinks.id })
          .from(bankMovementLinks)
          .where(eq(bankMovementLinks.bankMovementId, bankMovementId))
          .limit(1);

        if (remainingLinks.length === 0) {
          await db.update(bankMovements)
            .set({ conciliationStatus: "pendiente" })
            .where(eq(bankMovements.id, bankMovementId));
        }
      }

      await db.update(cardTerminalBatches)
        .set({
          bankMovementId: null,
          reconciledAt: null,
          reconciledBy: null,
          differenceAmount: null,
          status: "pending",
          suggestedBankMovementId: null,
          suggestedScore: null,
          suggestionRejected: false,
        })
        .where(eq(cardTerminalBatches.id, input.batchId));

      const batchOps = await db.select({ cardTerminalOperationId: cardTerminalBatchOperations.cardTerminalOperationId })
        .from(cardTerminalBatchOperations)
        .where(eq(cardTerminalBatchOperations.batchId, input.batchId));

      if (batchOps.length > 0) {
        await db.update(cardTerminalOperations)
          .set({ status: "included_in_batch" })
          .where(inArray(cardTerminalOperations.id, batchOps.map(o => o.cardTerminalOperationId)));
      }

      await db.insert(cardTerminalBatchAuditLogs).values({
        batchId: input.batchId,
        action: "unreconciled",
        bankMovementId: bankMovementId ?? null,
        score: null,
        autoReconciled: false,
        performedBy: "admin",
        notes: null,
      }).catch(() => {});

      return { success: true };
    }),

  markIgnored: adminProc
    .input(z.object({
      batchId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.update(cardTerminalBatches)
        .set({ status: "ignored", notes: input.notes ?? null })
        .where(eq(cardTerminalBatches.id, input.batchId));
      return { success: true };
    }),

  runMatching: adminProc
    .mutation(async () => {
      const result = await runMatchingJob();
      return result;
    }),

  acceptSuggestion: adminProc
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });
      if (!batch.suggestedBankMovementId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No hay sugerencia activa para esta remesa" });
      }

      const [bm] = await db.select()
        .from(bankMovements)
        .where(eq(bankMovements.id, batch.suggestedBankMovementId))
        .limit(1);
      if (!bm) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento bancario sugerido no encontrado" });

      const existingLink = await db.select({ id: bankMovementLinks.id })
        .from(bankMovementLinks)
        .where(and(
          eq(bankMovementLinks.bankMovementId, batch.suggestedBankMovementId),
          eq(bankMovementLinks.entityType, "card_terminal_batch")
        ))
        .limit(1);
      if (existingLink.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Este movimiento bancario ya está conciliado con otra remesa" });
      }

      const batchNet = parseFloat(String(batch.totalNet));
      const bmAmount = parseFloat(String(bm.importe));
      const diff = bmAmount - batchNet;
      const hasSignificantDiff = Math.abs(diff) > 0.01;

      await db.delete(bankMovementLinks).where(
        and(
          eq(bankMovementLinks.entityType, "card_terminal_batch"),
          eq(bankMovementLinks.entityId, input.batchId)
        )
      );

      await db.insert(bankMovementLinks).values({
        bankMovementId: batch.suggestedBankMovementId,
        entityType: "card_terminal_batch",
        entityId: input.batchId,
        linkType: "card_income",
        amountLinked: batchNet.toFixed(2),
        status: "confirmed",
        confidenceScore: batch.suggestedScore ?? 100,
        matchedBy: String(ctx.user.id),
        matchedAt: new Date(),
        notes: `Sugerencia aceptada manualmente. Score: ${batch.suggestedScore ?? 0}%`,
      });

      await db.update(cardTerminalBatches)
        .set({
          bankMovementId: batch.suggestedBankMovementId,
          reconciledAt: new Date(),
          reconciledBy: String(ctx.user.id),
          differenceAmount: hasSignificantDiff ? diff.toFixed(2) : null,
          status: hasSignificantDiff ? "difference" : "reconciled",
        })
        .where(eq(cardTerminalBatches.id, input.batchId));

      await db.update(bankMovements)
        .set({ conciliationStatus: "conciliado" })
        .where(eq(bankMovements.id, batch.suggestedBankMovementId));

      const batchOps = await db.select({ cardTerminalOperationId: cardTerminalBatchOperations.cardTerminalOperationId })
        .from(cardTerminalBatchOperations)
        .where(eq(cardTerminalBatchOperations.batchId, input.batchId));

      if (batchOps.length > 0) {
        await db.update(cardTerminalOperations)
          .set({ status: "settled" })
          .where(inArray(cardTerminalOperations.id, batchOps.map(o => o.cardTerminalOperationId)));
      }

      await db.insert(cardTerminalBatchAuditLogs).values({
        batchId: input.batchId,
        action: "suggestion_accepted",
        bankMovementId: batch.suggestedBankMovementId,
        score: batch.suggestedScore ?? null,
        autoReconciled: false,
        performedBy: String(ctx.user.id),
        notes: `Sugerencia aceptada. Score: ${batch.suggestedScore ?? 0}%`,
      }).catch(() => {});

      return { success: true, hasDifference: hasSignificantDiff, differenceAmount: diff };
    }),

  rejectSuggestion: adminProc
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cardTerminalBatches)
        .set({
          suggestionRejected: true,
          suggestedBankMovementId: null,
          suggestedScore: null,
          status: "pending",
        })
        .where(eq(cardTerminalBatches.id, input.batchId));

      await db.insert(cardTerminalBatchAuditLogs).values({
        batchId: input.batchId,
        action: "suggestion_rejected",
        bankMovementId: batch.suggestedBankMovementId ?? null,
        score: batch.suggestedScore ?? null,
        autoReconciled: false,
        performedBy: String(ctx.user.id),
        notes: null,
      }).catch(() => {});

      return { success: true };
    }),

  getDashboardStats: adminProc
    .query(async () => {
      const rows = await db.select({
        status: cardTerminalBatches.status,
        cnt: count(),
        totalNet: sum(cardTerminalBatches.totalNet),
      })
        .from(cardTerminalBatches)
        .groupBy(cardTerminalBatches.status);

      const stats: Record<string, { count: number; amount: number }> = {};
      let totalCount = 0;
      let totalAmount = 0;
      for (const r of rows) {
        const cnt = Number(r.cnt);
        const amt = parseFloat(String(r.totalNet ?? 0));
        stats[r.status] = { count: cnt, amount: amt };
        totalCount += cnt;
        totalAmount += amt;
      }

      const reconciledCount = (stats["reconciled"]?.count ?? 0) + (stats["difference"]?.count ?? 0);
      const reconciledAmount = (stats["reconciled"]?.amount ?? 0) + (stats["difference"]?.amount ?? 0);
      const pendingCount = (stats["pending"]?.count ?? 0) + (stats["review_required"]?.count ?? 0);
      const suggestedCount = (stats["suggested"]?.count ?? 0) + (stats["auto_ready"]?.count ?? 0);

      return {
        total: { count: totalCount, amount: totalAmount },
        reconciled: { count: reconciledCount, amount: reconciledAmount },
        pending: { count: pendingCount, amount: stats["pending"]?.amount ?? 0 },
        suggested: { count: stats["suggested"]?.count ?? 0, amount: stats["suggested"]?.amount ?? 0 },
        autoReady: { count: stats["auto_ready"]?.count ?? 0, amount: stats["auto_ready"]?.amount ?? 0 },
        reviewRequired: { count: stats["review_required"]?.count ?? 0, amount: stats["review_required"]?.amount ?? 0 },
        difference: { count: stats["difference"]?.count ?? 0, amount: stats["difference"]?.amount ?? 0 },
        ignored: { count: stats["ignored"]?.count ?? 0, amount: stats["ignored"]?.amount ?? 0 },
        pctReconciled: totalCount > 0 ? Math.round((reconciledCount / totalCount) * 100) : 0,
        needsAttention: (stats["review_required"]?.count ?? 0) + (stats["auto_ready"]?.count ?? 0) + (stats["suggested"]?.count ?? 0),
      };
    }),

  // ── Alert / stats procedures ────────────────────────���────────────────────

  getCriticalAlerts: adminProc
    .query(async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [staleBatches, differenceBatches, staleMovements, unlinkedOps] = await Promise.all([
        db.select({ cnt: count() }).from(cardTerminalBatches)
          .where(and(
            sql`${cardTerminalBatches.status} IN ('pending','suggested','auto_ready','review_required')`,
            lte(cardTerminalBatches.batchDate, twoDaysAgo)
          )),
        db.select({ cnt: count() }).from(cardTerminalBatches)
          .where(eq(cardTerminalBatches.status, "difference")),
        db.select({ cnt: count() }).from(bankMovements)
          .where(and(
            sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) > 0`,
            eq(bankMovements.conciliationStatus, "pendiente"),
            eq(bankMovements.status, "pendiente"),
            lte(bankMovements.fecha, twoDaysAgo)
          )),
        db.select({ cnt: count() }).from(cardTerminalOperations)
          .where(sql`${cardTerminalOperations.linkedEntityId} IS NULL AND ${cardTerminalOperations.status} NOT IN ('ignorado','incidencia','included_in_batch','settled')`),
      ]);

      return {
        staleBatches: Number(staleBatches[0]?.cnt ?? 0),
        differenceBatches: Number(differenceBatches[0]?.cnt ?? 0),
        staleIncomingMovements: Number(staleMovements[0]?.cnt ?? 0),
        unlinkedOperations: Number(unlinkedOps[0]?.cnt ?? 0),
      };
    }),

  getReconciliationStats: adminProc
    .query(async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const [totalRows, reconciledRows, differenceRows, pendingRows, movementsRows, unlinkedOpsRows] = await Promise.all([
        db.select({ cnt: count() }).from(cardTerminalBatches)
          .where(gte(cardTerminalBatches.batchDate, monthStart)),
        db.select({ cnt: count() }).from(cardTerminalBatches)
          .where(and(eq(cardTerminalBatches.status, "reconciled"), gte(cardTerminalBatches.batchDate, monthStart))),
        db.select({ cnt: count() }).from(cardTerminalBatches)
          .where(and(eq(cardTerminalBatches.status, "difference"), gte(cardTerminalBatches.batchDate, monthStart))),
        db.select({ cnt: count(), totalNet: sum(cardTerminalBatches.totalNet) }).from(cardTerminalBatches)
          .where(and(
            sql`${cardTerminalBatches.status} IN ('pending','suggested','auto_ready','review_required')`,
            gte(cardTerminalBatches.batchDate, monthStart)
          )),
        db.select({ cnt: count(), totalAmt: sum(bankMovements.importe) }).from(bankMovements)
          .where(and(
            sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) > 0`,
            eq(bankMovements.conciliationStatus, "pendiente"),
            eq(bankMovements.status, "pendiente"),
            gte(bankMovements.fecha, monthStart)
          )),
        db.select({ cnt: count() }).from(cardTerminalOperations)
          .where(sql`${cardTerminalOperations.linkedEntityId} IS NULL AND ${cardTerminalOperations.status} NOT IN ('ignorado','incidencia','included_in_batch','settled')`),
      ]);

      const total = Number(totalRows[0]?.cnt ?? 0);
      const reconciled = Number(reconciledRows[0]?.cnt ?? 0);

      return {
        pctReconciled: total > 0 ? Math.round((reconciled / total) * 100) : 0,
        totalBatches: total,
        reconciledBatches: reconciled,
        differenceBatches: Number(differenceRows[0]?.cnt ?? 0),
        pendingBatches: Number(pendingRows[0]?.cnt ?? 0),
        pendingAmount: parseFloat(String(pendingRows[0]?.totalNet ?? "0")),
        staleMovementsCount: Number(movementsRows[0]?.cnt ?? 0),
        staleMovementsAmount: parseFloat(String(movementsRows[0]?.totalAmt ?? "0")),
        unlinkedOps: Number(unlinkedOpsRows[0]?.cnt ?? 0),
        periodLabel: monthStart.slice(0, 7),
      };
    }),

  getCrmPaymentAlerts: adminProc
    .query(async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      const [unlinkedOps, staleFailedResult] = await Promise.all([
        db.select({ cnt: count() }).from(cardTerminalOperations)
          .where(sql`${cardTerminalOperations.linkedEntityId} IS NULL AND ${cardTerminalOperations.status} NOT IN ('ignorado','incidencia','included_in_batch','settled')`),
        db.execute(sql`SELECT COUNT(*) as cnt FROM quotes WHERE status = 'pago_fallido' AND updated_at < ${twoDaysAgo}`),
      ]);

      return {
        unlinkedTpvOps: Number(unlinkedOps[0]?.cnt ?? 0),
        staleFailedPayments: Number((staleFailedResult[0] as any[])?.[0]?.cnt ?? 0),
      };
    }),

  deleteBatch: adminProc
    .input(z.object({ batchId: z.number() }))
    .mutation(async ({ input }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });

      if (batch.status === "reconciled" || batch.status === "difference") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede eliminar una remesa conciliada. Primero desconcilia.",
        });
      }

      const batchOps = await db.select({ cardTerminalOperationId: cardTerminalBatchOperations.cardTerminalOperationId })
        .from(cardTerminalBatchOperations)
        .where(eq(cardTerminalBatchOperations.batchId, input.batchId));

      if (batchOps.length > 0) {
        await db.update(cardTerminalOperations)
          .set({ status: "pendiente" })
          .where(inArray(cardTerminalOperations.id, batchOps.map(o => o.cardTerminalOperationId)));
      }

      await db.delete(cardTerminalBatchOperations)
        .where(eq(cardTerminalBatchOperations.batchId, input.batchId));

      await db.delete(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId));

      return { success: true };
    }),

  removeOperation: adminProc
    .input(z.object({ batchId: z.number(), batchOpId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Remesa no encontrada" });

      const [batchOp] = await db.select()
        .from(cardTerminalBatchOperations)
        .where(and(
          eq(cardTerminalBatchOperations.id, input.batchOpId),
          eq(cardTerminalBatchOperations.batchId, input.batchId)
        ))
        .limit(1);
      if (!batchOp) throw new TRPCError({ code: "NOT_FOUND", message: "Operación no encontrada en esta remesa" });

      await db.delete(cardTerminalBatchOperations)
        .where(eq(cardTerminalBatchOperations.id, input.batchOpId));

      await db.update(cardTerminalOperations)
        .set({ status: "pendiente" })
        .where(eq(cardTerminalOperations.id, batchOp.cardTerminalOperationId));

      const remainingOps = await db.select()
        .from(cardTerminalBatchOperations)
        .innerJoin(
          cardTerminalOperations,
          eq(cardTerminalBatchOperations.cardTerminalOperationId, cardTerminalOperations.id)
        )
        .where(eq(cardTerminalBatchOperations.batchId, input.batchId));

      let totalSales = 0;
      let totalRefunds = 0;
      for (const r of remainingOps) {
        const amount = parseFloat(String(r.card_terminal_batch_operations.amount));
        if (r.card_terminal_batch_operations.operationType === "VENTA") totalSales += amount;
        else if (r.card_terminal_batch_operations.operationType === "DEVOLUCION") totalRefunds += amount;
      }
      const totalNet = totalSales - totalRefunds;

      let newDiff: string | null = null;
      let newStatus = batch.status;
      if (batch.bankMovementId && (batch.status === "reconciled" || batch.status === "difference")) {
        const [bm] = await db.select()
          .from(bankMovements)
          .where(eq(bankMovements.id, batch.bankMovementId))
          .limit(1);
        if (bm) {
          const bmAmount = parseFloat(String(bm.importe));
          const diff = bmAmount - totalNet;
          const hasSignificantDiff = Math.abs(diff) > 0.01;
          newDiff = hasSignificantDiff ? diff.toFixed(2) : null;
          newStatus = hasSignificantDiff ? "difference" : "reconciled";
        }
      }

      await db.update(cardTerminalBatches)
        .set({
          totalSales: totalSales.toFixed(2),
          totalRefunds: totalRefunds.toFixed(2),
          totalNet: totalNet.toFixed(2),
          operationCount: remainingOps.length,
          linkedOperationsCount: remainingOps.length,
          differenceAmount: newDiff,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(cardTerminalBatches.id, input.batchId));

      await db.insert(cardTerminalBatchAuditLogs).values({
        batchId: input.batchId,
        action: "manual_reconciled",
        bankMovementId: batch.bankMovementId ?? null,
        score: null,
        autoReconciled: false,
        performedBy: String(ctx.user.id),
        notes: `Operación ${batchOp.cardTerminalOperationId} eliminada de la remesa. Nuevo neto: ${totalNet.toFixed(2)} €`,
      }).catch(() => {});

      return { success: true, newTotalNet: totalNet, remainingOps: remainingOps.length };
    }),

  justifyDifference: adminProc
    .input(z.object({
      batchId: z.number(),
      justification: z.string().min(5, "La justificación debe tener al menos 5 caracteres"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [batch] = await db.select()
        .from(cardTerminalBatches)
        .where(eq(cardTerminalBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Remesa no encontrada" });
      if (batch.status !== "difference") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La remesa no tiene diferencias pendientes de justificar" });
      }

      await db.update(cardTerminalBatches)
        .set({
          status: "reconciled",
          notes: input.justification,
          updatedAt: new Date(),
        })
        .where(eq(cardTerminalBatches.id, input.batchId));

      await db.insert(cardTerminalBatchAuditLogs).values({
        batchId: input.batchId,
        action: "manual_reconciled",
        bankMovementId: batch.bankMovementId ?? null,
        score: null,
        autoReconciled: false,
        performedBy: String(ctx.user.id),
        notes: `Diferencia de ${batch.differenceAmount} € justificada: ${input.justification}`,
      }).catch(() => {});

      return { success: true };
    }),
});

