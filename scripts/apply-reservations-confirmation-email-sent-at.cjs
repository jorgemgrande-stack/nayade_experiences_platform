// Aplica la migración 0123_reservations_confirmation_email_sent_at.
//
// Añade la columna `confirmation_email_sent_at` (TIMESTAMP NULL) a
// `reservations`, usada como guarda de idempotencia y trazabilidad del
// nuevo helper centralizado de email de confirmación
// (server/reservationEmails.ts: confirmReservationAndNotify).
//
// Idempotente. Nullable sin default: no altera ninguna fila existente.
//
// Run: railway run --service MySQL node scripts/apply-reservations-confirmation-email-sent-at.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0123_reservations_confirmation_email_sent_at";
const TABLE = "reservations";
const COLUMN = "confirmation_email_sent_at";
const DDL = "TIMESTAMP NULL";

async function colExists(c, table, col) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0123 — reservations · confirmation_email_sent_at");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  if (await colExists(c, TABLE, COLUMN)) {
    console.log(`  · skip ${TABLE}.${COLUMN} (ya existe)`);
  } else {
    await c.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`${COLUMN}\` ${DDL}`);
    console.log(`  ✓ ADD ${TABLE}.${COLUMN}`);
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0123 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
