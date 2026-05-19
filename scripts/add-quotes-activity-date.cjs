// scripts/add-quotes-activity-date.cjs
//
// Añade la columna activity_date (DATE NULL) a la tabla quotes.
// Idempotente: detecta si ya existe.
//
// Run with: railway run --service MySQL node scripts/add-quotes-activity-date.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

(async () => {
  const c = await mysql.createConnection({ uri: DB_URL });

  const [check] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
       AND COLUMN_NAME = 'activity_date'`
  );
  if (check[0].n > 0) {
    console.log("quotes.activity_date ya existe — skip");
  } else {
    await c.query(
      `ALTER TABLE quotes ADD COLUMN activity_date DATE NULL AFTER validUntil`
    );
    console.log("✓ ALTER TABLE quotes ADD COLUMN activity_date DATE NULL");
  }

  // Verificación
  const [desc] = await c.query(`SHOW COLUMNS FROM quotes WHERE Field = 'activity_date'`);
  console.log("Columna:", desc[0]);

  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
