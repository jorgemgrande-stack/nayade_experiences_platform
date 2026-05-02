// scripts/check-tpv-duplicates.ts
// READ-ONLY diagnostic — no writes, no schema changes, no migrations.

import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(pool);

const DATE = "2026-05-01";

function header(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(label);
  console.log("─".repeat(60));
}

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`DIAGNÓSTICO DUPLICADOS TPV — ${DATE}`);
  console.log("=".repeat(60));

  // ── Q1 — Duplicados en card_terminal_operations por operation_number ─────────
  header("[Q1] Duplicados en card_terminal_operations por nº operación:");
  const q1 = await db.execute(sql`
    SELECT
      operation_number,
      terminal_code,
      duplicate_key,
      COUNT(*)               AS veces,
      GROUP_CONCAT(id)       AS fila_ids,
      GROUP_CONCAT(amount)   AS importes,
      GROUP_CONCAT(status)   AS estados
    FROM card_terminal_operations
    WHERE DATE(operation_datetime) = ${DATE}
    GROUP BY operation_number, terminal_code, duplicate_key
    HAVING COUNT(*) > 1
    ORDER BY operation_number
  `);
  const rows1 = (q1 as any)[0] as any[];
  if (rows1.length === 0) console.log("  → Sin duplicados.");
  else console.table(rows1);

  // ── Q2 — Conteo total card_terminal_operations del día ──────────────────────
  header("[Q2] Totales card_terminal_operations del día:");
  const q2 = await db.execute(sql`
    SELECT
      COUNT(*)                          AS total_filas,
      COUNT(DISTINCT operation_number)  AS ops_unicas,
      SUM(amount)                       AS suma_total
    FROM card_terminal_operations
    WHERE DATE(operation_datetime) = ${DATE}
  `);
  console.table((q2 as any)[0]);

  // ── Q3 — Listado completo card_terminal_operations del día ───────────────────
  header("[Q3] Listado completo card_terminal_operations del día:");
  const q3 = await db.execute(sql`
    SELECT
      id,
      operation_number,
      terminal_code,
      amount,
      linked_entity_type,
      linked_entity_id,
      status,
      duplicate_key,
      operation_datetime
    FROM card_terminal_operations
    WHERE DATE(operation_datetime) = ${DATE}
    ORDER BY operation_datetime, operation_number
  `);
  console.table((q3 as any)[0]);

  // ── Q4 — Duplicados en tpv_sales por reservationId ──────────────────────────
  header("[Q4] Duplicados en tpv_sales por reservationId (misma reserva cobrada 2+ veces):");
  const q4 = await db.execute(sql`
    SELECT
      reservationId,
      COUNT(*)                     AS veces,
      GROUP_CONCAT(id)             AS fila_ids,
      GROUP_CONCAT(ticketNumber)   AS tickets,
      GROUP_CONCAT(total)          AS importes,
      GROUP_CONCAT(status_ts)      AS estados
    FROM tpv_sales
    WHERE DATE(FROM_UNIXTIME(createdAt / 1000)) = ${DATE}
      AND reservationId IS NOT NULL
    GROUP BY reservationId
    HAVING COUNT(*) > 1
    ORDER BY reservationId
  `);
  const rows4 = (q4 as any)[0] as any[];
  if (rows4.length === 0) console.log("  → Sin duplicados por reservationId.");
  else console.table(rows4);

  // ── Q5 — Totales tpv_sales del día ──────────────────────────────────────────
  header("[Q5] Totales tpv_sales del día:");
  const q5 = await db.execute(sql`
    SELECT
      COUNT(*)                       AS total_filas,
      COUNT(DISTINCT ticketNumber)   AS tickets_unicos,
      SUM(total)                     AS suma_total
    FROM tpv_sales
    WHERE DATE(FROM_UNIXTIME(createdAt / 1000)) = ${DATE}
  `);
  console.table((q5 as any)[0]);

  // ── Q6 — Listado completo tpv_sales del día ──────────────────────────────────
  header("[Q6] Listado completo tpv_sales del día:");
  const q6 = await db.execute(sql`
    SELECT
      id,
      ticketNumber,
      total,
      reservationId,
      status_ts AS status,
      FROM_UNIXTIME(createdAt / 1000) AS createdAt_legible
    FROM tpv_sales
    WHERE DATE(FROM_UNIXTIME(createdAt / 1000)) = ${DATE}
    ORDER BY createdAt, ticketNumber
  `);
  console.table((q6 as any)[0]);

  // ── Q7 — Cross join card_terminal_operations → reservations → tpv_sales ─────
  // linked_entity_type puede ser 'reservation', 'quote' o 'none'
  // No existe valor 'tpv_sale' — el camino es: cto → reservations → tpv_sales
  header("[Q7] card_terminal_operations del día cruzadas con reservations y tpv_sales:");
  const q7 = await db.execute(sql`
    SELECT
      cto.id              AS cto_id,
      cto.operation_number,
      cto.amount          AS cto_amount,
      cto.linked_entity_type,
      cto.linked_entity_id,
      cto.status          AS cto_status,
      r.id                AS reservation_id,
      r.reservation_number,
      ts.id               AS tpv_sale_id,
      ts.ticketNumber,
      ts.total            AS tpv_total,
      ts.reservationId    AS ts_reservationId
    FROM card_terminal_operations cto
    LEFT JOIN reservations r
           ON cto.linked_entity_type = 'reservation'
          AND r.id = cto.linked_entity_id
    LEFT JOIN tpv_sales ts
           ON ts.reservationId = r.id
    WHERE DATE(cto.operation_datetime) = ${DATE}
    ORDER BY cto.operation_datetime
  `);
  console.table((q7 as any)[0]);

  await pool.end();
  console.log(`\n${"=".repeat(60)}`);
  console.log("FIN DEL DIAGNÓSTICO");
  console.log("=".repeat(60));
}

main().catch((e) => { console.error(e); process.exit(1); });
