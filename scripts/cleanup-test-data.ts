// scripts/cleanup-test-data.ts
// ONE-TIME cleanup: delete test data from legacy `bookings`, `booking_monitors`,
// `daily_orders`, and `transactions` tables created before 2026-05-01 (production start date).
//
// Run with:
//   railway run npx tsx scripts/cleanup-test-data.ts
//
// Safe to run multiple times (idempotent — queries skip if 0 rows found).

import "dotenv/config";
import * as readline from "readline";
import mysql from "mysql2/promise";

const CUTOFF = "2026-05-01 00:00:00";

const [DB_URL, DB_VAR_USED] =
  process.env.DATABASE_URL     ? [process.env.DATABASE_URL,     "DATABASE_URL"]     :
  process.env.MYSQL_PUBLIC_URL ? [process.env.MYSQL_PUBLIC_URL, "MYSQL_PUBLIC_URL"] :
  process.env.MYSQL_URL        ? [process.env.MYSQL_URL,        "MYSQL_URL"]        :
  [null, null];

if (!DB_URL) {
  console.error("✗ ABORTADO: no se encontró DATABASE_URL, MYSQL_PUBLIC_URL ni MYSQL_URL.");
  process.exit(1);
}

function hr() { console.log("═".repeat(62)); }

hr();
console.log("LIMPIEZA DATOS DE PRUEBA — tablas legacy");
console.log(`Corte: ${CUTOFF} (se borran registros ANTERIORES a esta fecha)`);
console.log(`Conectando vía: ${DB_VAR_USED}`);
hr();

const conn = await mysql.createConnection({ uri: DB_URL });

// ── 1. Contar lo que se va a borrar ──────────────────────────────────────────

const [[bmCount]] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS n FROM booking_monitors bm
   JOIN bookings b ON b.id = bm.bookingId
   WHERE b.createdAt < ?`, [CUTOFF]
);
const [[doCount]] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS n FROM daily_orders do2
   JOIN bookings b ON b.id = do2.bookingId
   WHERE b.createdAt < ?`, [CUTOFF]
);
const [[bkCount]] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS n FROM bookings WHERE createdAt < ?`, [CUTOFF]
);
const [[txCount]] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS n FROM transactions WHERE createdAt < ?`, [CUTOFF]
);

console.log("\n[PRE] Registros a eliminar:");
console.log(`  booking_monitors (hijos de bookings < ${CUTOFF}): ${bmCount.n}`);
console.log(`  daily_orders     (hijos de bookings < ${CUTOFF}): ${doCount.n}`);
console.log(`  bookings         (createdAt < ${CUTOFF}):         ${bkCount.n}`);
console.log(`  transactions     (createdAt < ${CUTOFF}):         ${txCount.n}`);

if (Number(bkCount.n) === 0 && Number(txCount.n) === 0) {
  console.log("\n✓ No hay datos de prueba que eliminar — nada que hacer.");
  await conn.end(); process.exit(0);
}

// ── 2. Confirmación interactiva ───────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise<string>((resolve) => {
  rl.question(
    `\n¿Confirmar borrado? (escribir 'SI' para continuar): `,
    (ans) => { rl.close(); resolve(ans.trim()); }
  );
});
if (answer !== "SI") {
  console.log("\n✗ Operación cancelada — no se ha modificado nada.");
  await conn.end(); process.exit(0);
}

// ── 3. Transacción ───────────────────────────────────────────────────────────

console.log("\n[TX] Iniciando transacción...");
await conn.beginTransaction();

try {
  const [delBm] = await conn.execute<mysql.ResultSetHeader>(
    `DELETE bm FROM booking_monitors bm
     JOIN bookings b ON b.id = bm.bookingId
     WHERE b.createdAt < ?`, [CUTOFF]
  );
  console.log(`  ✓ booking_monitors eliminados: ${delBm.affectedRows}`);

  const [delDo] = await conn.execute<mysql.ResultSetHeader>(
    `DELETE do2 FROM daily_orders do2
     JOIN bookings b ON b.id = do2.bookingId
     WHERE b.createdAt < ?`, [CUTOFF]
  );
  console.log(`  ✓ daily_orders eliminados:     ${delDo.affectedRows}`);

  const [delBk] = await conn.execute<mysql.ResultSetHeader>(
    `DELETE FROM bookings WHERE createdAt < ?`, [CUTOFF]
  );
  console.log(`  ✓ bookings eliminados:         ${delBk.affectedRows}`);

  const [delTx] = await conn.execute<mysql.ResultSetHeader>(
    `DELETE FROM transactions WHERE createdAt < ?`, [CUTOFF]
  );
  console.log(`  ✓ transactions eliminados:     ${delTx.affectedRows}`);

  await conn.commit();
  console.log("\n✓ Transacción confirmada (COMMIT).");
} catch (e) {
  await conn.rollback();
  console.error("\n✗ Error — ROLLBACK ejecutado:", (e as Error).message);
  await conn.end(); process.exit(1);
}

// ── 4. Verificación post ──────────────────────────────────────────────────────

console.log("\n[POST] Verificando estado final...");
const [[bkAfter]] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS n FROM bookings WHERE createdAt < ?`, [CUTOFF]
);
const [[txAfter]] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS n FROM transactions WHERE createdAt < ?`, [CUTOFF]
);
const allOk = Number(bkAfter.n) === 0 && Number(txAfter.n) === 0;
console.log(`  bookings   restantes con fecha < ${CUTOFF}: ${bkAfter.n} ${Number(bkAfter.n) === 0 ? "✓" : "✗"}`);
console.log(`  transactions restantes con fecha < ${CUTOFF}: ${txAfter.n} ${Number(txAfter.n) === 0 ? "✓" : "✗"}`);

await conn.end();
hr();
console.log(allOk ? "FIN — ÉXITO" : "FIN — CON ERRORES (revisar arriba)");
hr();
if (!allOk) process.exit(1);
