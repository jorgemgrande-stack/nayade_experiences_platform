// Aplica la migración 0121_admin_notification_dismissals.
//
// Crea la tabla `admin_notification_dismissals` que permite a cada admin
// silenciar items individuales del feed de notificaciones (campana arriba
// a la derecha del AdminLayout). Es por-usuario: silenciar un item afecta
// solo a quien lo silencia.
//
// Idempotente.
//
// Run: railway run --service MySQL node scripts/apply-admin-notification-dismissals.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0121_admin_notification_dismissals";

async function tableExists(c, name) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0121 — admin_notification_dismissals");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  if (await tableExists(c, "admin_notification_dismissals")) {
    console.log("  · skip admin_notification_dismissals (ya existe)");
  } else {
    await c.query(`
      CREATE TABLE \`admin_notification_dismissals\` (
        \`id\`             INT NOT NULL AUTO_INCREMENT,
        \`user_id\`        INT NOT NULL,
        \`kind\`           VARCHAR(40) NOT NULL,
        \`entity_id\`      INT NOT NULL,
        \`dismissed_at\`   BIGINT NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_user_kind_entity\` (\`user_id\`, \`kind\`, \`entity_id\`),
        KEY \`idx_user_kind\` (\`user_id\`, \`kind\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  ✓ CREATE TABLE admin_notification_dismissals");
  }

  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0121 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
