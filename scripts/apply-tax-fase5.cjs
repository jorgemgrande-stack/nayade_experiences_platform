// Gestoría e Impuestos — Fase 5. Aplica la migración 0114.
//
// Crea tax_dossiers y añade el rol 'gestoria' al enum users.role.
// Idempotente. Run: railway run --service MySQL node scripts/apply-tax-fase5.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0114_tax_dossiers_gestoria_role";

async function getEnumValues(c, table, col) {
  const [r] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  if (!r[0]) return [];
  const m = r[0].COLUMN_TYPE.match(/^enum\((.+)\)$/i);
  return m ? m[1].split(",").map((s) => s.replace(/^'|'$/g, "")) : [];
}

(async () => {
  console.log("=".repeat(70));
  console.log("GESTORÍA E IMPUESTOS — FASE 5 — expedientes + rol gestoria");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── tax_dossiers ───────────────────────────────────────────────────────────
  console.log("\n[0114] Crear tabla tax_dossiers");
  await c.query(`CREATE TABLE IF NOT EXISTS \`tax_dossiers\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`year\` int NOT NULL,
    \`scope\` enum('iva','laboral','sociedades','global') NOT NULL DEFAULT 'global',
    \`period_key\` varchar(16) NOT NULL,
    \`title\` varchar(160) NOT NULL,
    \`file_url\` text NULL,
    \`file_key\` varchar(512) NULL,
    \`file_size\` int NULL,
    \`file_count\` int NULL,
    \`generated_by\` int NULL,
    \`sent_to_gestoria_at\` timestamp NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`tax_dossiers_id\` PRIMARY KEY(\`id\`)
  )`);
  console.log("  ✓ tax_dossiers");

  // ── users.role += 'gestoria' ───────────────────────────────────────────────
  console.log("\n[0114] Añadir rol 'gestoria' al enum users.role");
  const current = await getEnumValues(c, "users", "role");
  if (current.includes("gestoria")) {
    console.log("  · skip (el enum ya contiene 'gestoria')");
  } else {
    const next = [...current, "gestoria"];
    const literal = next.map((v) => `'${v}'`).join(",");
    await c.query(`ALTER TABLE \`users\` MODIFY COLUMN \`role\` enum(${literal}) NOT NULL DEFAULT 'user'`);
    console.log("  ✓ ALTER users.role — añadido 'gestoria'");
  }

  // ── Registrar ──────────────────────────────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  const finalEnum = await getEnumValues(c, "users", "role");
  const [tbl] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tax_dossiers'`
  );
  console.log(`\n[POST] tax_dossiers: ${tbl[0].n === 1 ? "OK" : "FALTA"} · role incluye gestoria: ${finalEnum.includes("gestoria")}`);

  await c.end();
  console.log("=".repeat(70));
  console.log(tbl[0].n === 1 && finalEnum.includes("gestoria") ? "FIN — Fase 5 aplicada" : "AVISO — revisar");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
