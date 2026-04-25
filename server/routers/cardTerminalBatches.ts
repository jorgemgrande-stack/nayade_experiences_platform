import { z } from "zod";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { protectedProcedure } from "../_core/trpc";
import {
  cardTerminalBatches,
  cardTerminalBatchOperations,
  cardTerminalOperations,
  bankMovements,
  bankMovementLinks,
} from "../../drizzle/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool);

const adminProc = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido" });
  }
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
      status: z.enum(["pending", "suggested_bank_match", "reconciled", "difference", "ignored"]).optional(),
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
});
