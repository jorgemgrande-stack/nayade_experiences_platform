/**
 * cardTerminalRelinkService
 *
 * Cron cada 15 min que reintenta tryAutoLink para operaciones TPV en estado
 * 'pendiente' de las últimas 24h. Cubre el caso en que la tpv_sale se crea
 * DESPUÉS de que llega el correo de Comercia (p.ej. el cajero cobra en el TPV
 * unos minutos después de que el sistema ingesta el email).
 *
 * Fallbacks (mismo orden que emailTpvIngestionService):
 *   1. reservations.notes  – patrón "Nº operación TPV: {number}"
 *   2. quotes.notes        – mismo patrón
 *   3. tpv_sales           – importe exacto + ventana temporal [-2h, +30min]
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, gte, like, lte } from "drizzle-orm";
import cron from "node-cron";
import {
  cardTerminalOperations,
  tpvSales,
  reservations,
  quotes,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(_pool);

let isRunning = false;

// ── Core link logic (mirrors emailTpvIngestionService.tryAutoLink) ───────────

async function tryLink(
  opId: number,
  operationNumber: string,
  amount: number,
  operationDatetime: Date,
  now: Date,
): Promise<boolean> {
  const pattern = `%Nº operación TPV: ${operationNumber}%`;

  // 1. reservations.notes
  const [res] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(like(reservations.notes, pattern))
    .limit(1);
  if (res) {
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "reservation",
      linkedEntityId:   res.id,
      linkedAt:         now,
      linkedBy:         "auto-relink",
      status:           "conciliado",
    }).where(eq(cardTerminalOperations.id, opId));
    return true;
  }

  // 2. quotes.notes
  const [qt] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(like(quotes.notes, pattern))
    .limit(1);
  if (qt) {
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "quote",
      linkedEntityId:   qt.id,
      linkedAt:         now,
      linkedBy:         "auto-relink",
      status:           "conciliado",
    }).where(eq(cardTerminalOperations.id, opId));
    return true;
  }

  // 3. tpv_sales: importe exacto + ventana [-4h, +30min] respecto a la operación.
  // Ventana más amplia que en emailService (-2h) para cubrir casos donde el cajero
  // registra la venta en TPV bastante antes de que el cliente pase la tarjeta.
  const opMs = operationDatetime.getTime();
  const [sale] = await db
    .select({ id: tpvSales.id, reservationId: tpvSales.reservationId })
    .from(tpvSales)
    .where(and(
      eq(tpvSales.total,     String(amount.toFixed(2))),
      gte(tpvSales.createdAt, opMs - 4 * 60 * 60 * 1000),
      lte(tpvSales.createdAt, opMs + 30 * 60 * 1000),
      eq(tpvSales.status,    "paid"),
    ))
    .limit(1);
  if (sale?.reservationId != null) {
    await db.update(cardTerminalOperations).set({
      linkedEntityType: "reservation",
      linkedEntityId:   sale.reservationId,
      linkedAt:         now,
      linkedBy:         "auto-relink",
      status:           "conciliado",
    }).where(eq(cardTerminalOperations.id, opId));
    return true;
  }

  return false;
}

// ── Job ──────────────────────────────────────────────────────────────────────

export async function runRelinkJob(): Promise<{ checked: number; linked: number; errors: string[] }> {
  const result = { checked: 0, linked: 0, errors: [] as string[] };
  const now     = new Date();
  const cutoff  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const pending = await db
    .select({
      id:                 cardTerminalOperations.id,
      operationNumber:    cardTerminalOperations.operationNumber,
      amount:             cardTerminalOperations.amount,
      operationDatetime:  cardTerminalOperations.operationDatetime,
    })
    .from(cardTerminalOperations)
    .where(and(
      eq(cardTerminalOperations.status,           "pendiente"),
      eq(cardTerminalOperations.linkedEntityType, "none"),
      gte(cardTerminalOperations.createdAt,       cutoff),
    ));

  result.checked = pending.length;

  for (const op of pending) {
    try {
      const linked = await tryLink(
        op.id,
        op.operationNumber,
        parseFloat(String(op.amount)),
        new Date(op.operationDatetime),
        now,
      );
      if (linked) result.linked++;
    } catch (e: any) {
      result.errors.push(`op ${op.id}: ${e?.message ?? e}`);
    }
  }

  return result;
}

export function startRelinkJob(): void {
  setImmediate(() => {
    runRelinkJob()
      .then(r => console.log(`[CardRelink] Boot — checked: ${r.checked}, linked: ${r.linked}`))
      .catch(e => console.error("[CardRelink] Boot error:", e));
  });

  cron.schedule("*/15 * * * *", async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const r = await runRelinkJob();
      if (r.linked > 0 || r.errors.length > 0) {
        console.log(`[CardRelink] Cron — checked: ${r.checked}, linked: ${r.linked}`);
      }
      if (r.errors.length > 0) console.warn("[CardRelink] Errors:", r.errors);
    } finally {
      isRunning = false;
    }
  });

  console.log("[CardRelink] Job scheduled (boot + every 15 min)");
}
