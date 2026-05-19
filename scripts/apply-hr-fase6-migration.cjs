// Aplica 0109_hr_bonus (Fase 6 RRHH).
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

(async () => {
  console.log("FASE 6 RRHH — Bonus e Incentivos (0109)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "hr_bonus")) {
    console.log("· skip hr_bonus (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE hr_bonus (
        id int AUTO_INCREMENT NOT NULL,
        employee_id int NOT NULL,
        type enum('bonus','comision','prima','gratificacion','anticipo','ajuste') NOT NULL DEFAULT 'bonus',
        amount decimal(12,2) NOT NULL DEFAULT '0.00',
        irpf_amount decimal(12,2) NOT NULL DEFAULT '0.00',
        concept varchar(256) NOT NULL,
        notes text DEFAULT NULL,
        paid_at timestamp NULL DEFAULT NULL,
        payment_method enum('cash','transfer','payroll') DEFAULT NULL,
        expense_id int DEFAULT NULL,
        cash_movement_id int DEFAULT NULL,
        included_in_payslip_id int DEFAULT NULL,
        status enum('pendiente','pagado','anulado') NOT NULL DEFAULT 'pendiente',
        fiscal_status enum('pendiente','revisado','exportado','presentado') NOT NULL DEFAULT 'pendiente',
        created_by int DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT (NOW()),
        updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
        CONSTRAINT hr_bonus_id PRIMARY KEY (id)
      )
    `);
    console.log("✓ CREATE TABLE hr_bonus");
  }

  for (const [name, cols] of [
    ["idx_hr_bonus_employee", "(`employee_id`)"],
    ["idx_hr_bonus_status", "(`status`)"],
    ["idx_hr_bonus_paid_at", "(`paid_at`)"],
    ["idx_hr_bonus_fiscal_status", "(`fiscal_status`)"],
  ]) {
    if (await idxExists(c, "hr_bonus", name)) {
      console.log(`· skip ${name}`);
    } else {
      await c.query(`CREATE INDEX \`${name}\` ON \`hr_bonus\` ${cols}`);
      console.log(`✓ CREATE INDEX ${name}`);
    }
  }

  // Tracking
  const tag = "0109_hr_bonus";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) {
    console.log(`· skip registro ${tag}`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [cols] = await c.query(`SHOW COLUMNS FROM hr_bonus`);
  console.log(`\n[POST] hr_bonus: ${cols.length} columnas`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
