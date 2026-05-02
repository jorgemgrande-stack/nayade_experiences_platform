// scripts/cleanup-cardops-duplicates.ts
// ONE-TIME cleanup: delete 3 duplicate rows from card_terminal_operations (2026-05-01)
// and reassign the batch reference from id 1705 → 1599 before adding UNIQUE constraint.
//
// Run with: railway run --service MySQL npx tsx scripts/cleanup-cardops-duplicates.ts
//
// Rows to DELETE (higher id of each duplicate pair):  1705, 1641, 1642
// Rows to KEEP   (lower  id of each duplicate pair):  1599, 1611, 1634
// Batch reasignment: card_terminal_batch_operations id=2 → card_terminal_operation_id 1705→1599

import "dotenv/config";
import * as readline from "readline";
import mysql from "mysql2/promise";

const IDS_TO_DELETE = [1705, 1641, 1642] as const;
const IDS_TO_KEEP   = [1599, 1611, 1634] as const;
const ALL_IDS       = [...IDS_TO_KEEP, ...IDS_TO_DELETE].sort((a, b) => a - b);

// Resolve connection URL with fallback chain
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
console.log("LIMPIEZA DUPLICADOS card_terminal_operations — 2026-05-01");
console.log(`Conectando vía: ${DB_VAR_USED}`);
hr();

const conn = await mysql.createConnection({ uri: DB_URL });

// ── 1. Mostrar las 6 filas implicadas antes de actuar ────────────────────────

console.log("\n[PRE] Estado actual de las 6 filas implicadas:");
const [preRows] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT id, operation_number, terminal_code, amount, status, duplicate_key, operation_datetime
   FROM card_terminal_operations
   WHERE id IN (${ALL_IDS.join(",")})
   ORDER BY operation_number, id`
);
console.table(preRows);

const toDeleteFound = preRows.filter((r) => (IDS_TO_DELETE as readonly number[]).includes(r.id));
const toKeepFound   = preRows.filter((r) => (IDS_TO_KEEP   as readonly number[]).includes(r.id));

if (toDeleteFound.length !== 3) {
  console.error(`\n✗ ABORTADO: se esperaban 3 filas a borrar, se encontraron ${toDeleteFound.length}.`);
  console.error("  IDs encontrados:", toDeleteFound.map((r) => r.id));
  await conn.end(); process.exit(1);
}
if (toKeepFound.length !== 3) {
  console.error(`\n✗ ABORTADO: se esperaban 3 filas a conservar, se encontraron ${toKeepFound.length}.`);
  console.error("  IDs encontrados:", toKeepFound.map((r) => r.id));
  await conn.end(); process.exit(1);
}

// ── 2. Mostrar el estado actual del batch ─────────────────────────────────────

console.log("\n[PRE] Estado actual de card_terminal_batch_operations id=2:");
const [batchOpPre] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT id, batch_id, card_terminal_operation_id, amount, operation_type
   FROM card_terminal_batch_operations WHERE id = 2`
);
console.table(batchOpPre);

if (batchOpPre.length !== 1 || batchOpPre[0].card_terminal_operation_id !== 1705) {
  console.error(`\n✗ ABORTADO: card_terminal_batch_operations id=2 no apunta a 1705 como se esperaba.`);
  console.error("  Estado encontrado:", batchOpPre);
  await conn.end(); process.exit(1);
}

// ── 3. Confirmación interactiva ───────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const answer = await new Promise<string>((resolve) => {
  rl.question(
    `\n¿Confirmar reasignación de batch y borrado de filas ${IDS_TO_DELETE.join(", ")}? (escribir 'SI' para continuar): `,
    (ans) => { rl.close(); resolve(ans.trim()); }
  );
});

if (answer !== "SI") {
  console.log("\n✗ Operación cancelada — no se ha modificado nada.");
  await conn.end(); process.exit(0);
}

// ── 4. Transacción: reasignar batch + actualizar status + DELETE ─────────────

console.log("\n[TX] Iniciando transacción...");
await conn.beginTransaction();

try {
  // 4a. Reasignar la referencia del batch (WHERE defensivo: verifica que aún apunta a 1705)
  const [upBatch] = await conn.execute<mysql.ResultSetHeader>(
    `UPDATE card_terminal_batch_operations
     SET card_terminal_operation_id = 1599
     WHERE id = 2 AND card_terminal_operation_id = 1705`
  );
  if (upBatch.affectedRows !== 1) {
    throw new Error(`UPDATE batch_operations afectó ${upBatch.affectedRows} filas (esperado 1). Posible cambio concurrente.`);
  }
  console.log("  ✓ batch_operations id=2 → card_terminal_operation_id actualizado a 1599");

  // 4b. Marcar 1599 como included_in_batch (WHERE defensivo: id exacto)
  const [upStatus] = await conn.execute<mysql.ResultSetHeader>(
    `UPDATE card_terminal_operations
     SET status = 'included_in_batch'
     WHERE id = 1599`
  );
  if (upStatus.affectedRows !== 1) {
    throw new Error(`UPDATE status de 1599 afectó ${upStatus.affectedRows} filas (esperado 1).`);
  }
  console.log("  ✓ card_terminal_operations id=1599 → status = 'included_in_batch'");

  // 4c. Borrar las 3 filas duplicadas
  const [del] = await conn.execute<mysql.ResultSetHeader>(
    `DELETE FROM card_terminal_operations WHERE id IN (${IDS_TO_DELETE.join(",")})`
  );
  if (del.affectedRows !== 3) {
    throw new Error(`DELETE afectó ${del.affectedRows} filas (esperado 3).`);
  }
  console.log(`  ✓ DELETE filas ${IDS_TO_DELETE.join(", ")} — affectedRows = ${del.affectedRows}`);

  await conn.commit();
  console.log("\n✓ Transacción confirmada (COMMIT).");

} catch (e) {
  await conn.rollback();
  console.error("\n✗ Error durante la transacción — ROLLBACK ejecutado:", (e as Error).message);
  await conn.end(); process.exit(1);
}

// ── 5. Verificaciones post-transacción ───────────────────────────────────────

console.log("\n[POST] Verificando estado final...");
let allOk = true;

// V1: Las 3 filas conservadas siguen ahí
const [keptCheck] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT id, operation_number, amount, status, operation_datetime
   FROM card_terminal_operations WHERE id IN (${IDS_TO_KEEP.join(",")}) ORDER BY id`
);
if (keptCheck.length === 3) {
  console.log(`  ✓ V1 PASS: filas conservadas (${IDS_TO_KEEP.join(", ")}) = ${keptCheck.length}`);
  console.table(keptCheck);
} else {
  console.error(`  ✗ V1 FAIL: se esperaban 3 filas conservadas, se encontraron ${keptCheck.length}`);
  allOk = false;
}

// V2: Las 3 filas borradas ya no existen
const [deletedCheck] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT id FROM card_terminal_operations WHERE id IN (${IDS_TO_DELETE.join(",")})`
);
if (deletedCheck.length === 0) {
  console.log(`  ✓ V2 PASS: filas ${IDS_TO_DELETE.join(", ")} ya no existen`);
} else {
  console.error(`  ✗ V2 FAIL: aún existen filas borradas:`, deletedCheck.map((r) => r.id));
  allOk = false;
}

// V3: El batch apunta a 1599
const [batchCheck] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT id, card_terminal_operation_id FROM card_terminal_batch_operations WHERE id = 2`
);
if (batchCheck.length === 1 && batchCheck[0].card_terminal_operation_id === 1599) {
  console.log(`  ✓ V3 PASS: batch_operations id=2 → card_terminal_operation_id = 1599`);
} else {
  console.error(`  ✗ V3 FAIL: estado inesperado:`, batchCheck);
  allOk = false;
}

// V4: Status de 1599 es 'included_in_batch'
const [statusCheck] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT id, status FROM card_terminal_operations WHERE id = 1599`
);
if (statusCheck.length === 1 && statusCheck[0].status === "included_in_batch") {
  console.log(`  ✓ V4 PASS: card_terminal_operations id=1599 → status = 'included_in_batch'`);
} else {
  console.error(`  ✗ V4 FAIL: status inesperado:`, statusCheck);
  allOk = false;
}

// V5: Total del 1/5/26 = 6
const [totalCheck] = await conn.execute<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) AS total FROM card_terminal_operations WHERE DATE(operation_datetime) = '2026-05-01'`
);
const totalAfter = Number(totalCheck[0]?.total ?? -1);
if (totalAfter === 6) {
  console.log(`  ✓ V5 PASS: total card_terminal_operations del 1/5/26 = ${totalAfter}`);
} else {
  console.error(`  ✗ V5 FAIL: total esperado 6, obtenido ${totalAfter}`);
  allOk = false;
}

// ── 6. Resumen ────────────────────────────────────────────────────────────────

console.log("\n[RESUMEN]");
console.log(`  Filas borradas:           ${IDS_TO_DELETE.length} (ids ${IDS_TO_DELETE.join(", ")})`);
console.log(`  Filas conservadas:        ${IDS_TO_KEEP.length} (ids ${IDS_TO_KEEP.join(", ")})`);
console.log(`  Batch id=2 reasignado:    1705 → 1599`);
console.log(`  Total del 1/5/26 después: ${totalAfter}`);
console.log(`  Todas las verificaciones: ${allOk ? "✓ PASS" : "✗ HAY FALLOS — revisar arriba"}`);

await conn.end();
hr();
console.log(allOk ? "FIN DE LA LIMPIEZA — ÉXITO" : "FIN DE LA LIMPIEZA — CON ERRORES");
hr();
console.log();

if (!allOk) process.exit(1);
