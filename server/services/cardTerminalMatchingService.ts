import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, gte, lte, inArray, ne, sql, not } from "drizzle-orm";
import cron from "node-cron";
import {
  cardTerminalBatches,
  cardTerminalBatchOperations,
  cardTerminalOperations,
  cardTerminalBatchAuditLogs,
  bankMovements,
  bankMovementLinks,
  type CardTerminalBatch,
} from "../../drizzle/schema";

// ── Config ──────────────────────────────────────────────────────────────────

const TOLERANCE = parseFloat(process.env.CARD_BATCH_TOLERANCE ?? "0.01");
const AUTO_RECONCILE = (process.env.AUTO_RECONCILE_CARD_BATCHES ?? "false") === "true";

// ── DB ───────────────────────────────────────────────────────────────────────

const _matchingPool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _matchingDb = drizzle(_matchingPool);

function makeDb() {
  return _matchingDb;
}

// ── Concurrency ──────────────────────────────────────────────────────────────

let isRunning = false;

// ── Date helpers ─────────────────────────────────────────────────────────────

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

// ── Score calculation ────────────────────────────────────────────────────────

interface MatchCandidate {
  bankMovementId: number;
  score: number;
  diff: number;
  bmAmount: number;
  fecha: string;
}

async function scoreCandidates(
  db: ReturnType<typeof makeDb>,
  batch: CardTerminalBatch,
  excludeLinkedIds: Set<number>
): Promise<MatchCandidate[]> {
  const batchNet = parseFloat(String(batch.totalNet));
  const batchDate = batch.batchDate;

  // Search window: batch_date -1 to batch_date +3 (T+1 most common, buffer on both sides)
  const fromDate = offsetDate(batchDate, -1);
  const toDate = offsetDate(batchDate, 3);

  const candidates = await db.select()
    .from(bankMovements)
    .where(
      and(
        gte(bankMovements.fecha, fromDate),
        lte(bankMovements.fecha, toDate),
        sql`CAST(${bankMovements.importe} AS DECIMAL(12,2)) > 0`,
        eq(bankMovements.status, "pendiente")
      )
    );

  const scored: MatchCandidate[] = [];

  for (const bm of candidates) {
    if (excludeLinkedIds.has(bm.id)) continue;

    const bmAmount = parseFloat(String(bm.importe));
    const diff = Math.abs(bmAmount - batchNet);
    let score = 0;

    // Amount scoring (+60 exact, -40 different)
    if (diff < 0.001) {
      score += 60;
    } else {
      score -= 40;
    }

    // Date scoring
    const daysDiff = dateDiffDays(batchDate, bm.fecha);
    if (daysDiff === 1) score += 20;
    else if (daysDiff === 0 || daysDiff === 2) score += 10;
    else if (daysDiff < 0 || daysDiff > 3) score -= 30;

    // Concept scoring
    const concept = ((bm.movimiento ?? "") + " " + (bm.masDatos ?? "")).toUpperCase();
    if (/\bTPV\b|\bTARJETA\b|COMERCIA|ABONO\s*TARJETA|\bVISA\b|\bMASTERCARD\b/.test(concept)) {
      score += 10;
    } else if (/ABONO|COBRO/.test(concept)) {
      score += 5;
    }

    score = Math.max(0, Math.min(100, score));
    scored.push({ bankMovementId: bm.id, score, diff, bmAmount, fecha: bm.fecha });
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ── Classify batch status from score ────────────────────────────────────────

function classifyStatus(score: number, diff: number, candidateCount: number): CardTerminalBatch["status"] {
  if (score >= 95 && diff < 0.001 && candidateCount === 1) return "auto_ready";
  if (score >= 80) return "suggested";
  if (score >= 50 && candidateCount > 1) return "review_required";
  return "pending";
}

// ── Check if batch ops are all valid (no incidents, no unresolved issues) ────

async function areBatchOpsValid(
  db: ReturnType<typeof makeDb>,
  batchId: number
): Promise<boolean> {
  const ops = await db
    .select({ status: cardTerminalOperations.status })
    .from(cardTerminalBatchOperations)
    .innerJoin(
      cardTerminalOperations,
      eq(cardTerminalBatchOperations.cardTerminalOperationId, cardTerminalOperations.id)
    )
    .where(eq(cardTerminalBatchOperations.batchId, batchId));

  return ops.every(o => o.status !== "incidencia");
}

// ── Core matching function ───────────────────────────────────────────────────

export async function matchBatchWithBankMovement(
  db: ReturnType<typeof makeDb>,
  batch: CardTerminalBatch
): Promise<{ status: CardTerminalBatch["status"]; bankMovementId: number | null; score: number | null }> {
  // Find all bank movement IDs already linked to a card_terminal_batch
  const linked = await db
    .select({ bankMovementId: bankMovementLinks.bankMovementId })
    .from(bankMovementLinks)
    .where(eq(bankMovementLinks.entityType, "card_terminal_batch"));

  const linkedIds = new Set(linked.map(l => l.bankMovementId));
  // Also exclude the batch's own existing link
  if (batch.bankMovementId) linkedIds.delete(batch.bankMovementId);

  const scored = await scoreCandidates(db, batch, linkedIds);

  if (scored.length === 0) {
    // Check if batch is old enough to flag as review_required
    const daysSinceBatch = dateDiffDays(batch.batchDate, new Date().toISOString().slice(0, 10));
    if (daysSinceBatch >= 2) {
      return { status: "review_required", bankMovementId: null, score: null };
    }
    return { status: "pending", bankMovementId: null, score: null };
  }

  const best = scored[0];
  const highScoreCandidates = scored.filter(s => s.score >= 80).length;
  const status = classifyStatus(best.score, best.diff, highScoreCandidates);

  return { status, bankMovementId: best.bankMovementId, score: best.score };
}

// ── Auto-reconcile logic ─────────────────────────────────────────────────────

async function attemptAutoReconcile(
  db: ReturnType<typeof makeDb>,
  batch: CardTerminalBatch
): Promise<boolean> {
  if (!AUTO_RECONCILE) return false;
  if (batch.status !== "auto_ready") return false;
  if (!batch.suggestedBankMovementId) return false;
  if (batch.bankMovementId) return false; // already reconciled

  // Verify ops have no incidents
  const opsValid = await areBatchOpsValid(db, batch.id);
  if (!opsValid) {
    await db.update(cardTerminalBatches)
      .set({ status: "review_required" })
      .where(eq(cardTerminalBatches.id, batch.id));
    await logAudit(db, batch.id, "review_flagged", null, null, false, "auto", "Operaciones con incidencia detectadas");
    return false;
  }

  // Verify the suggested bank movement is still free
  const [bm] = await db.select()
    .from(bankMovements)
    .where(eq(bankMovements.id, batch.suggestedBankMovementId))
    .limit(1);
  if (!bm) return false;

  const existingLink = await db.select({ id: bankMovementLinks.id })
    .from(bankMovementLinks)
    .where(
      and(
        eq(bankMovementLinks.bankMovementId, batch.suggestedBankMovementId),
        eq(bankMovementLinks.entityType, "card_terminal_batch")
      )
    )
    .limit(1);
  if (existingLink.length > 0) return false;

  // Execute reconciliation
  const batchNet = parseFloat(String(batch.totalNet));
  const bmAmount = parseFloat(String(bm.importe));
  const diff = bmAmount - batchNet;

  await db.insert(bankMovementLinks).values({
    bankMovementId: batch.suggestedBankMovementId,
    entityType: "card_terminal_batch",
    entityId: batch.id,
    linkType: "card_income",
    amountLinked: batchNet.toFixed(2),
    status: "confirmed",
    confidenceScore: batch.suggestedScore ?? 100,
    matchedBy: "auto-matching",
    matchedAt: new Date(),
    notes: "Conciliación automática — score " + (batch.suggestedScore ?? 0) + "%",
  });

  await db.update(cardTerminalBatches)
    .set({
      bankMovementId: batch.suggestedBankMovementId,
      reconciledAt: new Date(),
      reconciledBy: "auto-matching",
      differenceAmount: Math.abs(diff) > 0.001 ? diff.toFixed(2) : null,
      status: Math.abs(diff) > 0.001 ? "difference" : "reconciled",
    })
    .where(eq(cardTerminalBatches.id, batch.id));

  // Update bank movement
  await db.update(bankMovements)
    .set({ conciliationStatus: "conciliado" })
    .where(eq(bankMovements.id, batch.suggestedBankMovementId));

  // Update operations to settled
  const batchOps = await db.select({ cardTerminalOperationId: cardTerminalBatchOperations.cardTerminalOperationId })
    .from(cardTerminalBatchOperations)
    .where(eq(cardTerminalBatchOperations.batchId, batch.id));

  if (batchOps.length > 0) {
    await db.update(cardTerminalOperations)
      .set({ status: "settled" })
      .where(inArray(cardTerminalOperations.id, batchOps.map(o => o.cardTerminalOperationId)));
  }

  await logAudit(db, batch.id, "auto_reconciled", batch.suggestedBankMovementId, batch.suggestedScore, true, "auto-matching",
    `Conciliación automática. Score: ${batch.suggestedScore}%. Diferencia: ${diff.toFixed(2)}€`);

  console.log(`[BatchMatching] Auto-reconciled batch ${batch.id} (${batch.batchDate}) with bm ${batch.suggestedBankMovementId}, score ${batch.suggestedScore}`);
  return true;
}

// ── Audit log helper ─────────────────────────────────────────────────────────

async function logAudit(
  db: ReturnType<typeof makeDb>,
  batchId: number,
  action: CardTerminalBatchAuditLog["action"],
  bankMovementId: number | null,
  score: number | null,
  autoReconciled: boolean,
  performedBy: string,
  notes?: string
): Promise<void> {
  try {
    await db.insert(cardTerminalBatchAuditLogs).values({
      batchId,
      action,
      bankMovementId,
      score,
      autoReconciled,
      performedBy,
      notes: notes ?? null,
    });
  } catch (e) {
    console.warn("[BatchMatching] Audit log failed:", (e as any)?.message);
  }
}

// Bring type into scope for logAudit signature
type CardTerminalBatchAuditLog = { action: "match_suggested" | "match_auto_ready" | "match_no_candidate" | "match_review_required" | "suggestion_accepted" | "suggestion_rejected" | "auto_reconciled" | "manual_reconciled" | "unreconciled" | "review_flagged" };

// ── Main job ─────────────────────────────────────────────────────────────────

export async function runMatchingJob(): Promise<{ processed: number; suggested: number; autoReady: number; autoReconciled: number; errors: string[] }> {
  const result = { processed: 0, suggested: 0, autoReady: 0, autoReconciled: 0, errors: [] as string[] };
  const db = makeDb();

  try {
    // Find all non-reconciled, non-ignored, non-rejected batches
    const pending = await db.select()
      .from(cardTerminalBatches)
      .where(
        and(
          sql`${cardTerminalBatches.status} IN ('pending', 'suggested', 'auto_ready', 'review_required')`,
          eq(cardTerminalBatches.suggestionRejected, false)
        )
      );

    for (const batch of pending) {
      try {
        const { status, bankMovementId, score } = await matchBatchWithBankMovement(db, batch);

        const now = new Date();
        await db.update(cardTerminalBatches)
          .set({
            status,
            suggestedBankMovementId: bankMovementId,
            suggestedScore: score,
            matchingRunAt: now,
          })
          .where(eq(cardTerminalBatches.id, batch.id));

        // Log audit
        const actionMap: Record<string, CardTerminalBatchAuditLog["action"]> = {
          suggested: "match_suggested",
          auto_ready: "match_auto_ready",
          pending: "match_no_candidate",
          review_required: "match_review_required",
        };
        const auditAction = actionMap[status] ?? "match_no_candidate";
        if (status !== "pending" || batch.status !== "pending") {
          await logAudit(db, batch.id, auditAction, bankMovementId, score, false, "matching-job");
        }

        result.processed++;
        if (status === "suggested") result.suggested++;
        if (status === "auto_ready") {
          result.autoReady++;
          const reconciled = await attemptAutoReconcile(db, { ...batch, status, suggestedBankMovementId: bankMovementId, suggestedScore: score });
          if (reconciled) result.autoReconciled++;
        }
      } catch (e: any) {
        const msg = `batch ${batch.id}: ${e?.message ?? e}`;
        result.errors.push(msg);
        console.error("[BatchMatching] Error processing batch:", msg);
      }
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    result.errors.push(`Job error: ${msg}`);
    console.error("[BatchMatching] Job error:", msg);
  }

  return result;
}

// ── Cron + boot ──────────────────────────────────────────────────────────────

export function startMatchingJob(): void {
  setImmediate(() => {
    runMatchingJob()
      .then(r => console.log(`[BatchMatching] Boot run — processed: ${r.processed}, suggested: ${r.suggested}, auto_ready: ${r.autoReady}, auto_reconciled: ${r.autoReconciled}`))
      .catch(e => console.error("[BatchMatching] Boot run error:", e));
  });

  cron.schedule("*/10 * * * *", async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const r = await runMatchingJob();
      if (r.processed > 0 || r.errors.length > 0) {
        console.log(`[BatchMatching] Cron — processed: ${r.processed}, suggested: ${r.suggested}, auto_reconciled: ${r.autoReconciled}`);
      }
      if (r.errors.length > 0) console.warn("[BatchMatching] Cron errors:", r.errors);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[BatchMatching] Job scheduled (boot + every 10 min) AUTO_RECONCILE=${AUTO_RECONCILE}`);
}

