// scripts/backfill-cardops-autolink.ts
// Vincula card_terminal_operations pendientes a reservations a través de tpv_sales.
//
// Estrategia: amount-match + closest-in-time one-to-one (evita double-match para importes iguales).
// Cada tpv_sale solo se usa una vez: el card_terminal_operation más cercano temporalmente gana.
//
// Modos:
//   --dry-run  (por defecto) muestra qué haría sin tocar nada
//   --apply    ejecuta los UPDATEs en producción
//
// Run: railway run --service MySQL npx tsx scripts/backfill-cardops-autolink.ts [--apply]

import "dotenv/config";
import mysql from "mysql2/promise";

const DRY_RUN = !process.argv.includes("--apply");

const DB_URL =
  process.env.DATABASE_URL     ??
  process.env.MYSQL_PUBLIC_URL ??
  process.env.MYSQL_URL;

if (!DB_URL) { console.error("No DB_URL"); process.exit(1); }

const conn = await mysql.createConnection({ uri: DB_URL });

console.log(`\nbackfill-cardops-autolink — modo ${DRY_RUN ? "DRY RUN (pasa --apply para ejecutar)" : "APLICAR"}`);
console.log("─".repeat(64));

// ── 1. Operaciones pendientes sin vínculo ────────────────────────────────────

const [ops] = await conn.execute<mysql.RowDataPacket[]>(`
  SELECT id, operation_number, CAST(amount AS DECIMAL(12,2)) AS amount,
         operation_datetime, card
  FROM card_terminal_operations
  WHERE status = 'pendiente'
    AND linked_entity_type = 'none'
  ORDER BY operation_datetime
`);

if (ops.length === 0) {
  console.log("Sin operaciones pendientes. Nada que hacer.");
  await conn.end(); process.exit(0);
}
console.log(`Operaciones pendientes sin vínculo: ${ops.length}`);

// ── 2. Candidatas en tpv_sales (pagadas, con reservationId) ─────────────────

const amounts = [...new Set(ops.map((o: any) => String(o.amount)))];
const placeholders = amounts.map(() => "?").join(",");

const [sales] = await conn.execute<mysql.RowDataPacket[]>(`
  SELECT ts.id AS saleId, ts.reservationId, ts.ticketNumber,
         CAST(ts.total AS DECIMAL(12,2)) AS total,
         ts.createdAt,
         r.reservation_number, r.customer_name
  FROM tpv_sales ts
  JOIN reservations r ON r.id = ts.reservationId
  WHERE ts.status_ts = 'paid'
    AND ts.reservationId IS NOT NULL
    AND CAST(ts.total AS DECIMAL(12,2)) IN (${placeholders})
  ORDER BY ts.createdAt
`, amounts);

// Simplificación: excluir tpv_sales cuya reservationId ya está vinculada
const [alreadyLinked] = await conn.execute<mysql.RowDataPacket[]>(`
  SELECT DISTINCT linked_entity_id FROM card_terminal_operations
  WHERE linked_entity_type = 'reservation' AND linked_entity_id IS NOT NULL
`);
const linkedResIds = new Set(alreadyLinked.map((r: any) => r.linked_entity_id));

const availableSales = (sales as any[]).filter((s: any) => !linkedResIds.has(s.reservationId));
console.log(`tpv_sales disponibles como candidatas: ${availableSales.length}`);

// ── 3. One-to-one matching: para cada importe, asignar closest-in-time ───────

// Por importe, ordenar ops y sales por tiempo y emparejar posicionalmente
// (el primero en tiempo gana el primero disponible de ese importe)
interface Match {
  opId: number;
  opNumber: string;
  opDatetimeMs: number;
  saleId: number;
  reservationId: number;
  reservationNumber: string;
  customerName: string;
  amount: string;
  dtDiffMin: number;
}

const matches: Match[] = [];
const usedSaleIds = new Set<number>();

// Agrupa ops y sales por importe
const opsByAmount = new Map<string, any[]>();
const salesByAmount = new Map<string, any[]>();

for (const op of ops as any[]) {
  const k = String(Number(op.amount).toFixed(2));
  const arr = opsByAmount.get(k) ?? [];
  arr.push(op);
  opsByAmount.set(k, arr);
}
for (const sale of availableSales) {
  const k = String(Number(sale.total).toFixed(2));
  const arr = salesByAmount.get(k) ?? [];
  arr.push(sale);
  salesByAmount.set(k, arr);
}

for (const [amount, opsForAmount] of opsByAmount.entries()) {
  const salesForAmount = (salesByAmount.get(amount) ?? [])
    .filter((s: any) => !usedSaleIds.has(s.saleId))
    .sort((a: any, b: any) => a.createdAt - b.createdAt);

  for (const op of opsForAmount) {
    const opMs = new Date(op.operation_datetime).getTime();

    // Elegir la sale MÁS CERCANA temporalmente que aún no esté usada
    let bestSale: any = null;
    let bestDiff = Infinity;
    for (const sale of salesForAmount) {
      if (usedSaleIds.has(sale.saleId)) continue;
      const diff = Math.abs(sale.createdAt - opMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSale = sale;
      }
    }

    if (!bestSale) {
      console.log(`  op id=${op.id} (${op.operation_number}, €${amount}): sin candidata en tpv_sales`);
      continue;
    }

    usedSaleIds.add(bestSale.saleId);
    matches.push({
      opId: op.id,
      opNumber: op.operation_number,
      opDatetimeMs: opMs,
      saleId: bestSale.saleId,
      reservationId: bestSale.reservationId,
      reservationNumber: bestSale.reservation_number,
      customerName: bestSale.customer_name,
      amount,
      dtDiffMin: Math.round(Math.abs(bestSale.createdAt - opMs) / 60000),
    });
  }
}

// ── 4. Mostrar plan ───────────────────────────────────────────────────────────

console.log(`\nPlan de vinculación (${matches.length} matches):`);
for (const m of matches) {
  const flag = m.dtDiffMin > 60 ? " ⚠ diff>60min" : "";
  console.log(
    `  op ${m.opId} (op.nº ${m.opNumber}, €${m.amount}) → ${m.reservationNumber} (${m.customerName}) [diff=${m.dtDiffMin}min]${flag}`
  );
}

if (matches.length === 0) {
  console.log("Sin matches. Fin.");
  await conn.end(); process.exit(0);
}

const highDiff = matches.filter((m) => m.dtDiffMin > 120);
if (highDiff.length > 0) {
  console.warn(`\n⚠ ${highDiff.length} match(es) con diferencia >2h — revisar antes de aplicar:`);
  for (const m of highDiff) {
    console.warn(`  op ${m.opId} ↔ ${m.reservationNumber} (${m.dtDiffMin}min)`);
  }
}

// ── 5. Aplicar si --apply ────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log("\nDRY RUN — nada modificado. Pasa --apply para ejecutar.");
  await conn.end(); process.exit(0);
}

await conn.beginTransaction();
try {
  for (const m of matches) {
    const [upd] = await conn.execute<mysql.ResultSetHeader>(`
      UPDATE card_terminal_operations
      SET linked_entity_type = 'reservation',
          linked_entity_id   = ?,
          linked_at          = NOW(),
          linked_by          = 'backfill-autolink',
          status             = 'conciliado'
      WHERE id = ?
        AND status = 'pendiente'
        AND linked_entity_type = 'none'
    `, [m.reservationId, m.opId]);
    if (upd.affectedRows === 1) {
      console.log(`  ✓ op ${m.opId} → reservation ${m.reservationId} (${m.reservationNumber})`);
    } else {
      console.warn(`  ⚠ op ${m.opId}: no afectó filas (¿ya vinculada?)`);
    }
  }
  await conn.commit();
  console.log(`\n✓ COMMIT — ${matches.length} operaciones vinculadas.`);
} catch (e) {
  await conn.rollback();
  console.error("ROLLBACK:", (e as Error).message);
  await conn.end(); process.exit(1);
}

await conn.end();
