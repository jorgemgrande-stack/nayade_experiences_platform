// Aplica la migración 0117_reservation_delegation_proof.
//
// Añade a `reservations` las columnas del justificante de reserva delegada.
// Idempotente. Run: railway run --service MySQL node scripts/apply-reservation-delegation.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0117_reservation_delegation_proof";
const COLUMNS = [
  { name: "delegation_proof_url", ddl: "TEXT NULL" },
  { name: "delegation_proof_key", ddl: "VARCHAR(512) NULL" },
  { name: "delegation_note",      ddl: "TEXT NULL" },
];

async function colExists(c, table, col) {
  const [r] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return r[0].n > 0;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0117 — reservations + justificante de reserva delegada");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  for (const col of COLUMNS) {
    if (await colExists(c, "reservations", col.name)) {
      console.log(`  · skip reservations.${col.name} (ya existe)`);
    } else {
      await c.query(`ALTER TABLE \`reservations\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
      console.log(`  ✓ ADD reservations.${col.name}`);
    }
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
  console.log("FIN — migración 0117 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
