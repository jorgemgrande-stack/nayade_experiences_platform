// Gestoría e Impuestos — Fase 6. Aplica la migración 0115_tax_deferrals.
//
// Crea tax_deferrals y tax_deferral_installments. Idempotente.
// Run: railway run --service MySQL node scripts/apply-tax-fase6.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0115_tax_deferrals";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`tax_deferrals\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`obligation_id\` int NOT NULL,
    \`status\` enum('solicitado','concedido','denegado','fraccionado') NOT NULL DEFAULT 'solicitado',
    \`requested_at\` varchar(10) NULL,
    \`resolution_at\` varchar(10) NULL,
    \`principal\` decimal(12,2) NOT NULL DEFAULT '0.00',
    \`interest_rate\` decimal(5,2) NULL,
    \`installment_count\` int NOT NULL DEFAULT 1,
    \`notes\` text NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_deferrals_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`tax_deferral_installments\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`deferral_id\` int NOT NULL,
    \`number\` int NOT NULL,
    \`due_date\` varchar(10) NOT NULL,
    \`amount\` decimal(12,2) NOT NULL DEFAULT '0.00',
    \`interest\` decimal(12,2) NOT NULL DEFAULT '0.00',
    \`paid_at\` varchar(10) NULL,
    \`status\` enum('pendiente','pagada') NOT NULL DEFAULT 'pendiente',
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_deferral_installments_id\` PRIMARY KEY(\`id\`)
  )`,
];

(async () => {
  console.log("=".repeat(70));
  console.log("GESTORÍA E IMPUESTOS — FASE 6 — aplazamientos y fraccionamientos");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log("\n[0115] Crear tablas");
  for (const stmt of STATEMENTS) {
    const tableName = stmt.match(/EXISTS `([a-z_]+)`/)[1];
    await c.query(stmt);
    console.log(`  ✓ ${tableName}`);
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const [tables] = await c.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tax_deferrals','tax_deferral_installments')`
  );
  console.log(`\n[POST] ${tables.length}/2 tablas presentes`);

  await c.end();
  console.log("=".repeat(70));
  console.log(tables.length === 2 ? "FIN — Fase 6 aplicada" : "AVISO — faltan tablas");
  console.log("=".repeat(70));
  if (tables.length !== 2) process.exit(1);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
