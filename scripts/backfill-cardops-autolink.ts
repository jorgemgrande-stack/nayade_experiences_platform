// scripts/backfill-cardops-autolink.ts
// Intenta vincular operaciones card_terminal_operations con status='pendiente'
// que no tienen linked_entity mediante el fallback tpv_sales (importe + ventana temporal).
// SOLO LECTURA en modo --dry-run (por defecto). Pasar --apply para ejecutar.
//
// Run: railway run --service MySQL npx tsx scripts/backfill-cardops-autolink.ts [--apply]

import "dotenv/config";
import mysql from "mysql2/promise";

const DRY_RUN = !process.argv.includes("--apply");
const WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000;  // 2h
const WINDOW_AFTER_MS  = 30 * 60 * 1000;       // 30min

const DB_URL =
  process.env.DATABASE_URL     ??
  process.env.MYSQL_PUBLIC_URL ??
  process.env.MYSQL_URL;

if (!DB_URL) { console.error("No DB_URL"); process.exit(1); }

const conn = await mysql.createConnection({ uri: DB_URL });

console.log(`\nbackfill-cardops-autolink — modo ${DRY_RUN ? "DRY RUN (--apply para ejecutar)" : "APLICAR"}`);
console.log("─".repeat(60));

// Operaciones pendientes sin vínculo
const [pending] = await conn.execute<mysql.RowDataPacket[]>(`
  SELECT id, operation_number, amount, operation_datetime
  FROM card_terminal_operations
  WHERE status = 'pendiente'
    AND linked_entity_type = 'none'
  ORDER BY id
`);
console.log(`Operaciones pendientes sin vínculo: ${pending.length}`);

if (pending.length === 0) {
  console.log("Nada que hacer.");
  await conn.end(); process.exit(0);
}

let linked = 0;
let noMatch = 0;

for (const op of pending) {
  const opMs = new Date(op.operation_datetime).getTime();
  const windowStart = opMs - WINDOW_BEFORE_MS;
  const windowEnd   = opMs + WINDOW_AFTER_MS;

  const [sales] = await conn.execute<mysql.RowDataPacket[]>(`
    SELECT id, reservationId, total
    FROM tpv_sales
    WHERE status_ts = 'paid'
      AND CAST(total AS DECIMAL(12,2)) = CAST(? AS DECIMAL(12,2))
      AND createdAt >= ?
      AND createdAt <= ?
    LIMIT 1
  `, [String(Number(op.amount).toFixed(2)), windowStart, windowEnd]);

  if (sales.length === 0 || sales[0].reservationId == null) {
    console.log(`  id=${op.id}: sin match en tpv_sales`);
    noMatch++;
    continue;
  }

  const sale = sales[0];
  console.log(`  id=${op.id}: match → tpv_sales id=${sale.id}, reservationId=${sale.reservationId} ${DRY_RUN ? "[DRY RUN]" : ""}`);

  if (!DRY_RUN) {
    await conn.execute(`
      UPDATE card_terminal_operations
      SET linked_entity_type = 'reservation',
          linked_entity_id   = ?,
          linked_at          = NOW(),
          linked_by          = 'backfill-autolink',
          status             = 'conciliado'
      WHERE id = ?
        AND status = 'pendiente'
        AND linked_entity_type = 'none'
    `, [sale.reservationId, op.id]);
  }
  linked++;
}

console.log(`\nResumen: ${linked} vinculados, ${noMatch} sin match`);
if (DRY_RUN && linked > 0) console.log("Ejecuta con --apply para guardar los cambios.");

await conn.end();
