// Aplica las migraciones 0100 y 0101 del proyecto Personal/RRHH Fase 1.
// Idempotente: verifica que cada cambio sea necesario antes de aplicarlo.
//
// Run: railway run --service MySQL node scripts/apply-hr-fase1-migrations.cjs

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

function hr() { console.log("=".repeat(70)); }

async function colExists(c, table, col) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return r[0].n > 0;
}

async function idxExists(c, table, idx) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, idx]
  );
  return r[0].n > 0;
}

async function getEnumValues(c, table, col) {
  const [r] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  if (!r[0]) return [];
  const m = r[0].COLUMN_TYPE.match(/^enum\((.+)\)$/i);
  if (!m) return [];
  return m[1].split(",").map(s => s.replace(/^'|'$/g, ""));
}

(async () => {
  hr();
  console.log("FASE 1 RRHH — Aplicación 0100 + 0101");
  hr();

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── 0100_hr_employees_columns ──────────────────────────────────────────────
  console.log("\n[0100] Ampliar tabla monitors");

  const newCols0100 = [
    { name: "position",          ddl: "varchar(64) DEFAULT NULL" },
    { name: "department",        ddl: "varchar(64) DEFAULT NULL" },
    { name: "weekly_hours",      ddl: "decimal(5,2) DEFAULT NULL" },
    { name: "holiday_days_year", ddl: "int DEFAULT 22" },
    { name: "nss",               ddl: "varchar(20) DEFAULT NULL" },
    { name: "irpf_percent",      ddl: "decimal(5,2) DEFAULT NULL" },
    { name: "cost_center_id",    ddl: "int DEFAULT NULL" },
  ];

  for (const col of newCols0100) {
    if (await colExists(c, "monitors", col.name)) {
      console.log(`  · skip monitors.${col.name} (ya existe)`);
    } else {
      await c.query(`ALTER TABLE \`monitors\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
      console.log(`  ✓ ADD monitors.${col.name}`);
    }
  }

  if (await idxExists(c, "monitors", "idx_monitors_cost_center_id")) {
    console.log("  · skip idx_monitors_cost_center_id (ya existe)");
  } else {
    await c.query(`CREATE INDEX \`idx_monitors_cost_center_id\` ON \`monitors\` (\`cost_center_id\`)`);
    console.log("  ✓ CREATE INDEX idx_monitors_cost_center_id");
  }

  // ── 0101_hr_documents_enum_extend ──────────────────────────────────────────
  console.log("\n[0101] Ampliar monitor_documents");

  const currentEnum = await getEnumValues(c, "monitor_documents", "type");
  const requiredEnum = ["dni", "contrato", "certificado", "prl", "formacion", "nomina_pdf", "baja_medica", "finiquito", "otro"];
  const missing = requiredEnum.filter(v => !currentEnum.includes(v));

  if (missing.length === 0) {
    console.log(`  · skip enum type (ya contiene todos los valores requeridos: ${requiredEnum.length})`);
  } else {
    console.log(`  ↻ ampliar enum type — faltaban: ${missing.join(", ")}`);
    const enumLiteral = requiredEnum.map(v => `'${v}'`).join(",");
    await c.query(
      `ALTER TABLE \`monitor_documents\` MODIFY COLUMN \`type\` enum(${enumLiteral}) NOT NULL`
    );
    console.log("  ✓ MODIFY enum type");
  }

  for (const col of [
    { name: "expires_at",            ddl: "date DEFAULT NULL" },
    { name: "signed_by_employee_at", ddl: "timestamp NULL DEFAULT NULL" },
  ]) {
    if (await colExists(c, "monitor_documents", col.name)) {
      console.log(`  · skip monitor_documents.${col.name} (ya existe)`);
    } else {
      await c.query(`ALTER TABLE \`monitor_documents\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
      console.log(`  ✓ ADD monitor_documents.${col.name}`);
    }
  }

  if (await idxExists(c, "monitor_documents", "idx_monitor_documents_expires_at")) {
    console.log("  · skip idx_monitor_documents_expires_at (ya existe)");
  } else {
    await c.query(`CREATE INDEX \`idx_monitor_documents_expires_at\` ON \`monitor_documents\` (\`expires_at\`)`);
    console.log("  ✓ CREATE INDEX idx_monitor_documents_expires_at");
  }

  // ── Registrar en __drizzle_migrations ──────────────────────────────────────
  console.log("\n[TRACKING] Registrar en __drizzle_migrations");
  const newTags = [
    "0100_hr_employees_columns",
    "0101_hr_documents_enum_extend",
  ];
  for (const tag of newTags) {
    const [exists] = await c.query(
      `SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`,
      [tag]
    );
    if (exists[0].n > 0) {
      console.log(`  · skip ${tag} (ya registrada)`);
    } else {
      await c.execute(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        [tag, Date.now()]
      );
      console.log(`  ✓ INSERT ${tag}`);
    }
  }

  // ── Post-verificación ──────────────────────────────────────────────────────
  console.log("\n[POST] Estado final:");
  const [monitorsCols] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monitors'
       AND COLUMN_NAME IN ('position','department','weekly_hours','holiday_days_year','nss','irpf_percent','cost_center_id')
     ORDER BY ORDINAL_POSITION`
  );
  console.log("  monitors columnas nuevas:", monitorsCols.map(r => r.COLUMN_NAME).join(", "));

  const finalEnum = await getEnumValues(c, "monitor_documents", "type");
  console.log("  monitor_documents.type enum:", finalEnum.join(", "));

  const [docCols] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monitor_documents'
       AND COLUMN_NAME IN ('expires_at','signed_by_employee_at')`
  );
  console.log("  monitor_documents columnas nuevas:", docCols.map(r => r.COLUMN_NAME).join(", "));

  const [[total]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations`);
  console.log(`  __drizzle_migrations total: ${total.n}`);

  await c.end();
  hr();
  console.log("FIN FASE 1 RRHH — 0100 + 0101 aplicadas");
  hr();
})().catch(e => { console.error("ERR", e); process.exit(1); });
