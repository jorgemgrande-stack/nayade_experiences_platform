// Gestoría e Impuestos — Fase 0. Aplica la migración 0111_expenses_fiscal_fields.
//
// Amplía `expenses` con el desglose fiscal del IVA soportado. Idempotente:
// verifica cada columna en information_schema y añade solo las que faltan.
//
// Run: railway run --service MySQL node scripts/apply-tax-fase0.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0111_expenses_fiscal_fields";

// Columnas a añadir a `expenses` (nombre → DDL del ADD COLUMN).
const COLUMNS = [
  { name: "taxBase",            ddl: "DECIMAL(12,2) NULL" },
  { name: "taxRate",            ddl: "DECIMAL(5,2) NOT NULL DEFAULT 21.00" },
  { name: "taxAmount",          ddl: "DECIMAL(12,2) NULL" },
  { name: "deductiblePercent",  ddl: "DECIMAL(5,2) NOT NULL DEFAULT 100.00" },
  { name: "supplierNif",        ddl: "VARCHAR(32) NULL" },
  { name: "supplierName",       ddl: "VARCHAR(256) NULL" },
  { name: "retentionPercent",   ddl: "DECIMAL(5,2) NULL" },
  { name: "retentionAmount",    ddl: "DECIMAL(12,2) NULL" },
  { name: "invoiceType",        ddl: "ENUM('ordinaria','simplificada','intracomunitaria','importacion','exenta','sin_factura') NOT NULL DEFAULT 'ordinaria'" },
  { name: "accrualDate",        ddl: "VARCHAR(10) NULL" },
  { name: "fiscalReviewStatus", ddl: "ENUM('pendiente','revisado') NOT NULL DEFAULT 'pendiente'" },
];

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
  console.log("GESTORÍA E IMPUESTOS — FASE 0 — expenses + desglose fiscal");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── 0111: columnas fiscales en expenses ────────────────────────────────────
  console.log("\n[0111] Ampliar tabla expenses");
  for (const col of COLUMNS) {
    if (await colExists(c, "expenses", col.name)) {
      console.log(`  · skip expenses.${col.name} (ya existe)`);
    } else {
      await c.query(`ALTER TABLE \`expenses\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
      console.log(`  ✓ ADD expenses.${col.name}`);
    }
  }

  // ── Registrar en __drizzle_migrations ──────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(
    `SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`,
    [TAG]
  );
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
      [TAG, Date.now()]
    );
    console.log(`  ✓ INSERT ${TAG}`);
  }

  // ── Post-verificación ──────────────────────────────────────────────────────
  const [cols] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
       AND COLUMN_NAME IN ('taxBase','taxRate','taxAmount','deductiblePercent',
         'supplierNif','supplierName','retentionPercent','retentionAmount',
         'invoiceType','accrualDate','fiscalReviewStatus')`
  );
  console.log(`\n[POST] expenses tiene ${cols.length}/11 columnas fiscales:`,
    cols.map(r => r.COLUMN_NAME).join(", "));

  await c.end();
  console.log("=".repeat(70));
  console.log(cols.length === 11 ? "FIN — Fase 0 aplicada correctamente" : "AVISO — faltan columnas");
  console.log("=".repeat(70));
  if (cols.length !== 11) process.exit(1);
})().catch(e => { console.error("ERR", e); process.exit(1); });
