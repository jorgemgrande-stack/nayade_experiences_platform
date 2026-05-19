// Aplica 0105 + 0106 + 0107 + 0108 (Fase 5 RRHH — Nóminas y Remesas).
// Idempotente: cada tabla/índice se verifica antes de crearlo.

const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r[0].n > 0;
}
async function idxExists(c, t, idx) {
  const [r] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [t, idx]);
  return r[0].n > 0;
}

async function createTableIfMissing(c, name, ddl) {
  if (await tableExists(c, name)) {
    console.log(`  · skip ${name} (ya existe)`);
  } else {
    await c.query(ddl);
    console.log(`  ✓ CREATE TABLE ${name}`);
  }
}
async function createIndexIfMissing(c, table, indexName, cols) {
  if (await idxExists(c, table, indexName)) {
    console.log(`  · skip ${indexName}`);
  } else {
    await c.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` ${cols}`);
    console.log(`  ✓ CREATE INDEX ${indexName}`);
  }
}

(async () => {
  console.log("=".repeat(70));
  console.log("FASE 5 RRHH — Nóminas y Remesas (0105 + 0106 + 0107 + 0108)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── 0105: hr_payslips ──
  console.log("\n[0105] hr_payslips");
  await createTableIfMissing(c, "hr_payslips", `
    CREATE TABLE hr_payslips (
      id int AUTO_INCREMENT NOT NULL,
      employee_id int NOT NULL,
      period varchar(7) NOT NULL,
      gross_salary decimal(12,2) NOT NULL DEFAULT '0.00',
      irpf_amount decimal(12,2) NOT NULL DEFAULT '0.00',
      ss_employee decimal(12,2) NOT NULL DEFAULT '0.00',
      net_salary decimal(12,2) NOT NULL DEFAULT '0.00',
      ss_company_estimated decimal(12,2) NOT NULL DEFAULT '0.00',
      ss_company_real decimal(12,2) DEFAULT NULL,
      batch_id int DEFAULT NULL,
      pdf_url text DEFAULT NULL,
      pdf_key varchar(512) DEFAULT NULL,
      notes text DEFAULT NULL,
      status enum('borrador','registrada','pagada','anulada') NOT NULL DEFAULT 'borrador',
      fiscal_status enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
      created_by int DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT (NOW()),
      updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
      CONSTRAINT hr_payslips_id PRIMARY KEY (id),
      CONSTRAINT uq_hr_payslips_employee_period UNIQUE (employee_id, period)
    )
  `);
  await createIndexIfMissing(c, "hr_payslips", "idx_hr_payslips_period", "(`period`)");
  await createIndexIfMissing(c, "hr_payslips", "idx_hr_payslips_batch", "(`batch_id`)");
  await createIndexIfMissing(c, "hr_payslips", "idx_hr_payslips_fiscal_status", "(`fiscal_status`)");

  // ── 0106: hr_payroll_batches ──
  console.log("\n[0106] hr_payroll_batches");
  await createTableIfMissing(c, "hr_payroll_batches", `
    CREATE TABLE hr_payroll_batches (
      id int AUTO_INCREMENT NOT NULL,
      period varchar(7) NOT NULL,
      status enum('open','closed','exported') NOT NULL DEFAULT 'open',
      fiscal_status enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
      total_gross decimal(12,2) NOT NULL DEFAULT '0.00',
      total_irpf decimal(12,2) NOT NULL DEFAULT '0.00',
      total_ss_employee decimal(12,2) NOT NULL DEFAULT '0.00',
      total_net decimal(12,2) NOT NULL DEFAULT '0.00',
      total_ss_company_estimated decimal(12,2) NOT NULL DEFAULT '0.00',
      total_ss_company_real decimal(12,2) DEFAULT NULL,
      expense_ids_json text DEFAULT NULL,
      notes text DEFAULT NULL,
      closed_at timestamp NULL DEFAULT NULL,
      closed_by int DEFAULT NULL,
      created_by int DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT (NOW()),
      updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
      CONSTRAINT hr_payroll_batches_id PRIMARY KEY (id),
      CONSTRAINT uq_hr_payroll_batches_period UNIQUE (period)
    )
  `);

  // ── 0107: hr_irpf_ledger + hr_ss_ledger ──
  console.log("\n[0107] hr_irpf_ledger + hr_ss_ledger");
  await createTableIfMissing(c, "hr_irpf_ledger", `
    CREATE TABLE hr_irpf_ledger (
      id int AUTO_INCREMENT NOT NULL,
      period varchar(7) NOT NULL,
      employee_id int NOT NULL,
      taxable_base decimal(12,2) NOT NULL DEFAULT '0.00',
      retained_amount decimal(12,2) NOT NULL DEFAULT '0.00',
      payslip_id int DEFAULT NULL,
      bonus_id int DEFAULT NULL,
      fiscal_status enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
      notes text DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT (NOW()),
      CONSTRAINT hr_irpf_ledger_id PRIMARY KEY (id)
    )
  `);
  await createIndexIfMissing(c, "hr_irpf_ledger", "idx_hr_irpf_ledger_period", "(`period`)");
  await createIndexIfMissing(c, "hr_irpf_ledger", "idx_hr_irpf_ledger_employee", "(`employee_id`, `period`)");
  await createIndexIfMissing(c, "hr_irpf_ledger", "idx_hr_irpf_ledger_fiscal_status", "(`fiscal_status`)");

  await createTableIfMissing(c, "hr_ss_ledger", `
    CREATE TABLE hr_ss_ledger (
      id int AUTO_INCREMENT NOT NULL,
      period varchar(7) NOT NULL,
      estimated_amount decimal(12,2) NOT NULL DEFAULT '0.00',
      real_amount decimal(12,2) DEFAULT NULL,
      real_charged_at timestamp NULL DEFAULT NULL,
      bank_movement_id int DEFAULT NULL,
      batch_id int DEFAULT NULL,
      fiscal_status enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
      notes text DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT (NOW()),
      updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
      CONSTRAINT hr_ss_ledger_id PRIMARY KEY (id),
      CONSTRAINT uq_hr_ss_ledger_period UNIQUE (period)
    )
  `);
  await createIndexIfMissing(c, "hr_ss_ledger", "idx_hr_ss_ledger_fiscal_status", "(`fiscal_status`)");

  // ── 0108: hr_settings ──
  console.log("\n[0108] hr_settings");
  await createTableIfMissing(c, "hr_settings", `
    CREATE TABLE hr_settings (
      id int NOT NULL DEFAULT 1,
      ss_company_percent decimal(5,2) NOT NULL DEFAULT '31.00',
      default_holiday_days int NOT NULL DEFAULT 22,
      default_weekly_hours decimal(5,2) NOT NULL DEFAULT '40.00',
      irpf_default_percent decimal(5,2) DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT (NOW()),
      updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
      CONSTRAINT hr_settings_id PRIMARY KEY (id)
    )
  `);
  await c.query(`INSERT IGNORE INTO hr_settings (id, ss_company_percent, default_holiday_days, default_weekly_hours) VALUES (1, 31.00, 22, 40.00)`);
  console.log("  ✓ INSERT IGNORE row singleton");

  // ── Tracking ──
  console.log("\n[TRACKING] __drizzle_migrations");
  for (const tag of ["0105_hr_payslips", "0106_hr_payroll_batches", "0107_hr_fiscal_ledgers", "0108_hr_settings"]) {
    const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
    if (exists.n > 0) {
      console.log(`  · skip ${tag}`);
    } else {
      await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
      console.log(`  ✓ INSERT ${tag}`);
    }
  }

  console.log("\n[POST] Verificación:");
  for (const t of ["hr_payslips", "hr_payroll_batches", "hr_irpf_ledger", "hr_ss_ledger", "hr_settings"]) {
    const [cols] = await c.query(`SHOW COLUMNS FROM \`${t}\``);
    console.log(`  ${t}: ${cols.length} columnas`);
  }
  const [settingsRow] = await c.query(`SELECT * FROM hr_settings WHERE id = 1`);
  console.log("  hr_settings singleton:", settingsRow[0]);

  await c.end();
  console.log("\nFIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
