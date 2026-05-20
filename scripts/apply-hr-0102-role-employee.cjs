// Aplica la migración 0102_users_role_employee — añade el rol 'employee' al
// enum users.role para que los empleados accedan al Portal del Empleado.
//
// La migración 0102 tenía fichero SQL pero ningún script de aplicación la
// ejecutó (apply-hr-fase1 solo aplicaba 0100 + 0101). Este script lo corrige.
//
// Idempotente. Run: railway run --service MySQL node scripts/apply-hr-0102-role-employee.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0102_users_role_employee";

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
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0102 — users.role += 'employee'");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── ALTER users.role enum ──────────────────────────────────────────────────
  const current = await getEnumValues(c, "users", "role");
  console.log("\n[ANTES] users.role enum:", current.join(", "));

  if (current.includes("employee")) {
    console.log("  · skip ALTER (el enum ya contiene 'employee')");
  } else {
    // Preserva los valores existentes en su orden y añade 'employee' al final.
    const next = [...current, "employee"];
    const literal = next.map(v => `'${v}'`).join(",");
    await c.query(
      `ALTER TABLE \`users\` MODIFY COLUMN \`role\` enum(${literal}) NOT NULL DEFAULT 'user'`
    );
    console.log("  ✓ ALTER users.role — añadido 'employee'");
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
  const finalEnum = await getEnumValues(c, "users", "role");
  console.log("\n[DESPUÉS] users.role enum:", finalEnum.join(", "));
  console.log(finalEnum.includes("employee")
    ? "  ✓ OK — 'employee' presente"
    : "  ✗ ERROR — 'employee' sigue ausente");

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0102 aplicada");
  console.log("=".repeat(70));
})().catch(e => { console.error("ERR", e); process.exit(1); });
