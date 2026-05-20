// Gestoría e Impuestos — Fase 1. Aplica la migración 0112_tax_core.
//
// Crea las 5 tablas espina del módulo (tax_obligations, tax_obligation_lines,
// tax_obligation_log, tax_documents, tax_settings) y siembra el singleton.
// Idempotente: CREATE TABLE IF NOT EXISTS + INSERT IGNORE.
//
// Run: railway run --service MySQL node scripts/apply-tax-fase1.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0112_tax_core";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`tax_obligations\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`model\` enum('303','390','111','190','200','202') NOT NULL,
    \`year\` int NOT NULL,
    \`period_type\` enum('trimestral','anual','mensual') NOT NULL,
    \`period_key\` varchar(16) NOT NULL,
    \`period_label\` varchar(96) NOT NULL,
    \`due_date\` varchar(10) NOT NULL,
    \`estimated_amount\` decimal(12,2) NOT NULL DEFAULT '0.00',
    \`presented_amount\` decimal(12,2) NULL,
    \`paid_amount\` decimal(12,2) NULL,
    \`status\` enum('pendiente','estimado','revisado','enviado_gestoria','presentado','pagado','aplazado','cerrado') NOT NULL DEFAULT 'pendiente',
    \`deferral_id\` int NULL,
    \`presented_at\` timestamp NULL,
    \`paid_at\` timestamp NULL,
    \`notes\` text NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_obligations_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`uq_tax_obligation_model_period\` UNIQUE(\`model\`,\`period_key\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`tax_obligation_lines\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`obligation_id\` int NOT NULL,
    \`concept\` varchar(256) NOT NULL,
    \`base\` decimal(12,2) NOT NULL DEFAULT '0.00',
    \`rate\` decimal(5,2) NULL,
    \`amount\` decimal(12,2) NOT NULL DEFAULT '0.00',
    \`source_type\` varchar(32) NULL,
    \`source_ref\` varchar(64) NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_obligation_lines_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`tax_obligation_log\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`obligation_id\` int NOT NULL,
    \`from_status\` varchar(32) NULL,
    \`to_status\` varchar(32) NOT NULL,
    \`user_id\` int NULL,
    \`user_name\` varchar(128) NULL,
    \`note\` text NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_obligation_log_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`tax_documents\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`obligation_id\` int NOT NULL,
    \`doc_type\` enum('modelo_presentado','justificante_pago','resolucion','otro') NOT NULL DEFAULT 'otro',
    \`title\` varchar(256) NOT NULL,
    \`file_url\` text NOT NULL,
    \`file_key\` varchar(512) NULL,
    \`uploaded_by\` int NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_documents_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`tax_settings\` (
    \`id\` int NOT NULL DEFAULT 1,
    \`corporate_tax_rate\` decimal(5,2) NOT NULL DEFAULT '25.00',
    \`fiscal_year_end_month\` int NOT NULL DEFAULT 12,
    \`company_nif\` varchar(32) NULL,
    \`company_name\` varchar(256) NULL,
    \`company_address\` text NULL,
    \`gestoria_emails\` text NULL,
    \`iae_epigraphs\` text NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_settings_id\` PRIMARY KEY(\`id\`)
  )`,
];

(async () => {
  console.log("=".repeat(70));
  console.log("GESTORÍA E IMPUESTOS — FASE 1 — espina dorsal (tax_core)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  console.log("\n[0112] Crear tablas");
  for (const stmt of STATEMENTS) {
    const tableName = stmt.match(/EXISTS `([a-z_]+)`/)[1];
    await c.query(stmt);
    console.log(`  ✓ ${tableName}`);
  }

  console.log("\n[SEED] tax_settings singleton (id=1)");
  await c.query("INSERT IGNORE INTO `tax_settings` (`id`) VALUES (1)");
  console.log("  ✓ tax_settings id=1");

  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(
    `SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]
  );
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const [tables] = await c.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('tax_obligations','tax_obligation_lines','tax_obligation_log','tax_documents','tax_settings')`
  );
  console.log(`\n[POST] ${tables.length}/5 tablas presentes:`, tables.map(t => t.TABLE_NAME).join(", "));

  await c.end();
  console.log("=".repeat(70));
  console.log(tables.length === 5 ? "FIN — Fase 1 aplicada correctamente" : "AVISO — faltan tablas");
  console.log("=".repeat(70));
  if (tables.length !== 5) process.exit(1);
})().catch(e => { console.error("ERR", e); process.exit(1); });
