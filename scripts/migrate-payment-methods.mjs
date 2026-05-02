// scripts/migrate-payment-methods.mjs
// ONE-TIME migration: rename legacy paymentMethod values to the new canonical values.
//
//   "redsys"  → "tarjeta_redsys"  (pasarela web Redsys)   — in reservations, quotes, invoices
//   "tarjeta" → "tarjeta_fisica"  (datáfono físico)         — in transactions linked to tpv_sales
//             → "tarjeta_redsys"  (pasarela web Redsys)    — in transactions NOT linked to tpv
//
// Detection logic for transactions.paymentMethod = 'tarjeta':
//   • tpvSaleId IS NOT NULL  → tarjeta_fisica  (direct TPV sale)
//   • saleChannel = 'tpv'   → tarjeta_fisica
//   • reservationId_tx linked to card_terminal_operations → tarjeta_fisica (CRM + datáfono)
//   • everything else        → tarjeta_redsys
//
// Run AFTER deploying the schema change (drizzle-kit push) and the new backend code.
// Run with: railway run npx node scripts/migrate-payment-methods.mjs
// Safe to re-run (idempotent — only touches rows still holding legacy values).

import "dotenv/config";
import * as readline from "readline";
import mysql from "mysql2/promise";

const [DB_URL, DB_VAR_USED] =
  process.env.DATABASE_URL     ? [process.env.DATABASE_URL,     "DATABASE_URL"]     :
  process.env.MYSQL_PUBLIC_URL ? [process.env.MYSQL_PUBLIC_URL, "MYSQL_PUBLIC_URL"] :
  process.env.MYSQL_URL        ? [process.env.MYSQL_URL,        "MYSQL_URL"]        :
  [null, null];

if (!DB_URL) {
  console.error("✗ ABORTADO: DATABASE_URL / MYSQL_PUBLIC_URL / MYSQL_URL no encontrada.");
  process.exit(1);
}

function hr() { console.log("═".repeat(70)); }

const conn = await mysql.createConnection({ uri: DB_URL });

hr();
console.log("MIGRACIÓN MÉTODOS DE PAGO — tarjeta/redsys → tarjeta_fisica/tarjeta_redsys");
console.log(`Conectando vía: ${DB_VAR_USED}`);
hr();

// ── 1. Diagnóstico previo ─────────────────────────────────────────────────────

const [[resOld]]   = await conn.execute("SELECT COUNT(*) AS n FROM reservations WHERE paymentMethod = 'redsys'");
const [[invOld]]   = await conn.execute("SELECT COUNT(*) AS n FROM invoices WHERE paymentMethod = 'redsys'");
const [[quoOld]]   = await conn.execute("SELECT COUNT(*) AS n FROM quotes WHERE payment_method = 'redsys'");
const [[txTarjeta]] = await conn.execute("SELECT COUNT(*) AS n FROM transactions WHERE paymentMethod = 'tarjeta'");

// Transactions física: tpvSaleId IS NOT NULL OR saleChannel = 'tpv' OR linked via card_terminal_operations
const [[txFisicaDirect]] = await conn.execute(`
  SELECT COUNT(*) AS n FROM transactions
  WHERE paymentMethod = 'tarjeta'
    AND (tpvSaleId IS NOT NULL OR saleChannel = 'tpv')
`);
const [[txFisicaViaOp]] = await conn.execute(`
  SELECT COUNT(*) AS n FROM transactions t
  WHERE t.paymentMethod = 'tarjeta'
    AND t.tpvSaleId IS NULL AND t.saleChannel != 'tpv'
    AND EXISTS (
      SELECT 1 FROM card_terminal_operations co
      WHERE co.linked_entity_type = 'reservation'
        AND co.linked_entity_id   = t.reservationId_tx
    )
`);
const txFisicaTotal = Number(txFisicaDirect.n) + Number(txFisicaViaOp.n);
const txRedsysTotal = Number(txTarjeta.n) - txFisicaTotal;

console.log("\n[PRE] Registros afectados:");
console.log(`  reservations.paymentMethod = 'redsys'        → tarjeta_redsys : ${resOld.n}`);
console.log(`  invoices.paymentMethod     = 'redsys'        → tarjeta_redsys : ${invOld.n}`);
console.log(`  quotes.payment_method      = 'redsys'        → tarjeta_redsys : ${quoOld.n}`);
console.log(`  transactions.paymentMethod = 'tarjeta'       (total)          : ${txTarjeta.n}`);
console.log(`    ↳ con tpvSaleId o saleChannel='tpv'        → tarjeta_fisica : ${txFisicaDirect.n}`);
console.log(`    ↳ con card_terminal_op vinculada            → tarjeta_fisica : ${txFisicaViaOp.n}`);
console.log(`    ↳ resto                                     → tarjeta_redsys : ${txRedsysTotal}`);

const total = Number(resOld.n) + Number(invOld.n) + Number(quoOld.n) + Number(txTarjeta.n);
if (total === 0) {
  console.log("\n✓ No hay filas con valores legacy — nada que migrar.");
  await conn.end(); process.exit(0);
}

// ── 2. Confirmación ───────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((resolve) => {
  rl.question(`\n¿Confirmar migración de ${total} filas? (escribir 'SI' para continuar): `, (a) => {
    rl.close(); resolve(a.trim());
  });
});
if (answer !== "SI") {
  console.log("\n✗ Operación cancelada — no se ha modificado nada.");
  await conn.end(); process.exit(0);
}

// ── 3. Transacción ────────────────────────────────────────────────────────────

console.log("\n[TX] Iniciando transacción...");
await conn.beginTransaction();

try {
  // reservations: redsys → tarjeta_redsys
  const [r1] = await conn.execute(
    "UPDATE reservations SET paymentMethod = 'tarjeta_redsys' WHERE paymentMethod = 'redsys'"
  );
  console.log(`  ✓ reservations  redsys→tarjeta_redsys : ${r1.affectedRows}`);

  // invoices: redsys → tarjeta_redsys
  const [r2] = await conn.execute(
    "UPDATE invoices SET paymentMethod = 'tarjeta_redsys' WHERE paymentMethod = 'redsys'"
  );
  console.log(`  ✓ invoices      redsys→tarjeta_redsys : ${r2.affectedRows}`);

  // quotes: redsys → tarjeta_redsys
  const [r3] = await conn.execute(
    "UPDATE quotes SET payment_method = 'tarjeta_redsys' WHERE payment_method = 'redsys'"
  );
  console.log(`  ✓ quotes        redsys→tarjeta_redsys : ${r3.affectedRows}`);

  // transactions: tarjeta (física directa) → tarjeta_fisica
  const [r4] = await conn.execute(`
    UPDATE transactions
    SET paymentMethod = 'tarjeta_fisica'
    WHERE paymentMethod = 'tarjeta'
      AND (tpvSaleId IS NOT NULL OR saleChannel = 'tpv')
  `);
  console.log(`  ✓ transactions  tarjeta→tarjeta_fisica (directa)  : ${r4.affectedRows}`);

  // transactions: tarjeta (física vía card_terminal_op) → tarjeta_fisica
  const [r5] = await conn.execute(`
    UPDATE transactions t
    SET t.paymentMethod = 'tarjeta_fisica'
    WHERE t.paymentMethod = 'tarjeta'
      AND t.tpvSaleId IS NULL AND t.saleChannel != 'tpv'
      AND EXISTS (
        SELECT 1 FROM card_terminal_operations co
        WHERE co.linked_entity_type = 'reservation'
          AND co.linked_entity_id   = t.reservationId_tx
      )
  `);
  console.log(`  ✓ transactions  tarjeta→tarjeta_fisica (via op)   : ${r5.affectedRows}`);

  // transactions: tarjeta (restante, web Redsys) → tarjeta_redsys
  const [r6] = await conn.execute(
    "UPDATE transactions SET paymentMethod = 'tarjeta_redsys' WHERE paymentMethod = 'tarjeta'"
  );
  console.log(`  ✓ transactions  tarjeta→tarjeta_redsys (resto)    : ${r6.affectedRows}`);

  await conn.commit();
  console.log("\n✓ COMMIT");

} catch (e) {
  await conn.rollback();
  console.error("\n✗ Error — ROLLBACK:", e.message);
  await conn.end(); process.exit(1);
}

// ── 4. Verificación post ──────────────────────────────────────────────────────

console.log("\n[POST] Verificando que no queden valores legacy...");
const [[postRes]] = await conn.execute("SELECT COUNT(*) AS n FROM reservations WHERE paymentMethod IN ('redsys','tarjeta')");
const [[postInv]] = await conn.execute("SELECT COUNT(*) AS n FROM invoices     WHERE paymentMethod IN ('redsys','tarjeta')");
const [[postQuo]] = await conn.execute("SELECT COUNT(*) AS n FROM quotes        WHERE payment_method IN ('redsys','tarjeta')");
const [[postTx]]  = await conn.execute("SELECT COUNT(*) AS n FROM transactions  WHERE paymentMethod IN ('redsys','tarjeta')");

const allOk = [postRes, postInv, postQuo, postTx].every(r => Number(r.n) === 0);
console.log(`  reservations legacy restantes  : ${postRes.n} ${Number(postRes.n) === 0 ? "✓" : "✗"}`);
console.log(`  invoices     legacy restantes  : ${postInv.n} ${Number(postInv.n) === 0 ? "✓" : "✗"}`);
console.log(`  quotes       legacy restantes  : ${postQuo.n} ${Number(postQuo.n) === 0 ? "✓" : "✗"}`);
console.log(`  transactions legacy restantes  : ${postTx.n}  ${Number(postTx.n)  === 0 ? "✓" : "✗"}`);

await conn.end();
hr();
console.log(allOk ? "FIN — MIGRACIÓN COMPLETADA CON ÉXITO" : "FIN — HAY ERRORES (revisar arriba)");
hr();
if (!allOk) process.exit(1);
