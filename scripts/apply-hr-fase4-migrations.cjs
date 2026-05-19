// Aplica 0103 + 0104 (Fase 4 RRHH — Registro Horario).
// Idempotente: detecta cada tabla/índice antes de crearlo.

const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

async function tableExists(c, t) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [t]
  );
  return r[0].n > 0;
}
async function idxExists(c, t, idx) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [t, idx]
  );
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("FASE 4 RRHH — Registro Horario (0103 + 0104)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── 0103: hr_time_clock ──
  console.log("\n[0103] hr_time_clock");
  if (await tableExists(c, "hr_time_clock")) {
    console.log("  · skip hr_time_clock (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE hr_time_clock (
        id int AUTO_INCREMENT NOT NULL,
        employee_id int NOT NULL,
        clock_in_at timestamp NOT NULL,
        clock_out_at timestamp NULL DEFAULT NULL,
        source enum('portal','admin','tablet','external') NOT NULL DEFAULT 'portal',
        meta_json text DEFAULT NULL,
        status enum('open','closed','incomplete','edited','cancelled') NOT NULL DEFAULT 'open',
        notes text DEFAULT NULL,
        created_by int DEFAULT NULL,
        updated_by int DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT (NOW()),
        updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
        CONSTRAINT hr_time_clock_id PRIMARY KEY (id)
      )
    `);
    console.log("  ✓ CREATE TABLE hr_time_clock");
  }
  for (const [idx, cols] of [
    ["idx_hr_time_clock_employee_in", "(`employee_id`, `clock_in_at`)"],
    ["idx_hr_time_clock_status", "(`status`)"],
  ]) {
    if (await idxExists(c, "hr_time_clock", idx)) {
      console.log(`  · skip ${idx}`);
    } else {
      await c.query(`CREATE INDEX \`${idx}\` ON \`hr_time_clock\` ${cols}`);
      console.log(`  ✓ CREATE INDEX ${idx}`);
    }
  }

  // ── 0104: hr_schedule_templates + hr_schedule_exceptions ──
  console.log("\n[0104] hr_schedule_templates + hr_schedule_exceptions");
  if (await tableExists(c, "hr_schedule_templates")) {
    console.log("  · skip hr_schedule_templates (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE hr_schedule_templates (
        id int AUTO_INCREMENT NOT NULL,
        employee_id int NOT NULL,
        weekday tinyint NOT NULL,
        start_time varchar(5) NOT NULL,
        end_time varchar(5) NOT NULL,
        valid_from date DEFAULT NULL,
        valid_until date DEFAULT NULL,
        notes varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT (NOW()),
        updated_at timestamp NOT NULL DEFAULT (NOW()) ON UPDATE NOW(),
        CONSTRAINT hr_schedule_templates_id PRIMARY KEY (id)
      )
    `);
    console.log("  ✓ CREATE TABLE hr_schedule_templates");
  }
  if (await idxExists(c, "hr_schedule_templates", "idx_hr_schedule_templates_employee")) {
    console.log("  · skip idx_hr_schedule_templates_employee");
  } else {
    await c.query(`CREATE INDEX \`idx_hr_schedule_templates_employee\` ON \`hr_schedule_templates\` (\`employee_id\`, \`weekday\`)`);
    console.log("  ✓ CREATE INDEX idx_hr_schedule_templates_employee");
  }

  if (await tableExists(c, "hr_schedule_exceptions")) {
    console.log("  · skip hr_schedule_exceptions (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE hr_schedule_exceptions (
        id int AUTO_INCREMENT NOT NULL,
        employee_id int DEFAULT NULL,
        date date NOT NULL,
        type enum('festivo','vacaciones','baja','permiso','otro') NOT NULL DEFAULT 'festivo',
        notes varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT (NOW()),
        CONSTRAINT hr_schedule_exceptions_id PRIMARY KEY (id)
      )
    `);
    console.log("  ✓ CREATE TABLE hr_schedule_exceptions");
  }
  for (const [idx, cols] of [
    ["idx_hr_schedule_exceptions_date", "(`date`)"],
    ["idx_hr_schedule_exceptions_employee", "(`employee_id`, `date`)"],
  ]) {
    if (await idxExists(c, "hr_schedule_exceptions", idx)) {
      console.log(`  · skip ${idx}`);
    } else {
      await c.query(`CREATE INDEX \`${idx}\` ON \`hr_schedule_exceptions\` ${cols}`);
      console.log(`  ✓ CREATE INDEX ${idx}`);
    }
  }

  // ── Tracking ──
  console.log("\n[TRACKING] __drizzle_migrations");
  for (const tag of ["0103_hr_time_clock", "0104_hr_schedule_templates"]) {
    const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
    if (exists.n > 0) {
      console.log(`  · skip ${tag}`);
    } else {
      await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
      console.log(`  ✓ INSERT ${tag}`);
    }
  }

  console.log("\n[POST] Verificación:");
  for (const t of ["hr_time_clock", "hr_schedule_templates", "hr_schedule_exceptions"]) {
    const [cols] = await c.query(`SHOW COLUMNS FROM \`${t}\``);
    console.log(`  ${t}:`, cols.map(c => c.Field).join(", "));
  }

  await c.end();
  console.log("\nFIN");
})().catch(e => { console.error("ERR", e); process.exit(1); });
