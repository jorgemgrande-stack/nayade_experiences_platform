// Aplica 0110_hr_leaves (Fase 8 RRHH — Vacaciones y Permisos). Idempotente.
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
async function createIdx(c, t, name, cols) {
  if (await idxExists(c, t, name)) { console.log(`· skip ${name}`); }
  else { await c.query(`CREATE INDEX \`${name}\` ON \`${t}\` ${cols}`); console.log(`✓ CREATE INDEX ${name}`); }
}

(async () => {
  console.log("FASE 8 RRHH — Vacaciones y Permisos (0110)");
  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "hr_leave_requests")) {
    console.log("· skip hr_leave_requests (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE hr_leave_requests (
        id int AUTO_INCREMENT NOT NULL,
        employee_id int NOT NULL,
        type enum('vacaciones','asuntos_propios','baja_medica','permiso','otro') NOT NULL DEFAULT 'vacaciones',
        from_date date NOT NULL,
        to_date date NOT NULL,
        days decimal(5,1) NOT NULL DEFAULT '0.0',
        status enum('pendiente','aprobada','rechazada','cancelada') NOT NULL DEFAULT 'pendiente',
        reason text DEFAULT NULL,
        decision_reason text DEFAULT NULL,
        approved_by int DEFAULT NULL,
        approved_at timestamp NULL DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT (NOW()),
        updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
        CONSTRAINT hr_leave_requests_id PRIMARY KEY (id)
      )
    `);
    console.log("✓ CREATE TABLE hr_leave_requests");
  }
  await createIdx(c, "hr_leave_requests", "idx_hr_leave_requests_employee", "(`employee_id`)");
  await createIdx(c, "hr_leave_requests", "idx_hr_leave_requests_status", "(`status`)");
  await createIdx(c, "hr_leave_requests", "idx_hr_leave_requests_dates", "(`from_date`, `to_date`)");

  if (await tableExists(c, "hr_leave_balance")) {
    console.log("· skip hr_leave_balance (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE hr_leave_balance (
        id int AUTO_INCREMENT NOT NULL,
        employee_id int NOT NULL,
        year int NOT NULL,
        accrued_days decimal(5,1) NOT NULL DEFAULT '22.0',
        notes varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT (NOW()),
        updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
        CONSTRAINT hr_leave_balance_id PRIMARY KEY (id),
        CONSTRAINT uq_hr_leave_balance_employee_year UNIQUE (employee_id, year)
      )
    `);
    console.log("✓ CREATE TABLE hr_leave_balance");
  }

  const tag = "0110_hr_leaves";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) { console.log(`· skip registro ${tag}`); }
  else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT ${tag}`);
  }

  const [c1] = await c.query(`SHOW COLUMNS FROM hr_leave_requests`);
  const [c2] = await c.query(`SHOW COLUMNS FROM hr_leave_balance`);
  console.log(`\n[POST] hr_leave_requests: ${c1.length} cols · hr_leave_balance: ${c2.length} cols`);

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
