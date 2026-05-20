// Gestoría e Impuestos — aplica la migración 0116_tax_obligation_reminder.
//
// Añade tax_obligations.last_reminder_days (idempotencia del cron de avisos).
// Idempotente. Run: railway run --service MySQL node scripts/apply-tax-reminder.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0116_tax_obligation_reminder";

(async () => {
  console.log("=".repeat(70));
  console.log("GESTORÍA E IMPUESTOS — cron de vencimientos — last_reminder_days");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  const [cols] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tax_obligations' AND COLUMN_NAME = 'last_reminder_days'`
  );
  if (cols[0].n > 0) {
    console.log("  · skip tax_obligations.last_reminder_days (ya existe)");
  } else {
    await c.query("ALTER TABLE `tax_obligations` ADD COLUMN `last_reminder_days` int NULL");
    console.log("  ✓ ADD tax_obligations.last_reminder_days");
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
  console.log("FIN — migración aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
