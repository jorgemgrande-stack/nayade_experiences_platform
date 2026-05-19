// Aplica la migración 0102 (Fase 3 RRHH): añade 'employee' al enum users.role.
// Idempotente — detecta si el valor ya está presente antes de modificar.

const mysql = require("mysql2/promise");
const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

(async () => {
  const c = await mysql.createConnection({ uri: DB_URL });

  const [[row]] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  console.log("Enum actual:", row.COLUMN_TYPE);

  const hasEmployee = /'employee'/i.test(row.COLUMN_TYPE);
  if (hasEmployee) {
    console.log("· skip — 'employee' ya está en el enum");
  } else {
    await c.query(
      `ALTER TABLE \`users\`
       MODIFY COLUMN \`role\` enum(
         'user','admin','monitor','agente','adminrest','controler',
         'partner_admin','partner_user','employee'
       ) NOT NULL DEFAULT 'user'`
    );
    console.log("✓ ALTER ENUM — 'employee' añadido");
  }

  // Verificar
  const [[after]] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  console.log("Enum tras cambio:", after.COLUMN_TYPE);

  // Registrar en __drizzle_migrations
  const tag = "0102_users_role_employee";
  const [[exists]] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [tag]);
  if (exists.n > 0) {
    console.log(`· skip registro — ${tag} ya está`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [tag, Date.now()]);
    console.log(`✓ INSERT __drizzle_migrations: ${tag}`);
  }

  await c.end();
  console.log("FIN");
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
