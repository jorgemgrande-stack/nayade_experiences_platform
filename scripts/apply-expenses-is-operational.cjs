// Aplica la migración 0119_expenses_is_operational.
//
// Añade la columna `isOperational` (BOOLEAN NOT NULL DEFAULT TRUE) a las
// tablas `expenses` y `recurring_expenses` para permitir distinguir entre
// gastos operativos (computan en P&L/EBITDA/KPIs) y gastos solo fiscales
// (computan en gestoría/IVA/tesorería pero NO en rendimiento operativo).
//
// Idempotente. Default TRUE asegura backward compatibility: todos los
// gastos previos se mantienen como operativos sin cambio funcional.
//
// Run: railway run --service MySQL node scripts/apply-expenses-is-operational.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0119_expenses_is_operational";
const TARGETS = [
  {
    table: "expenses",
    cols: [
      { name: "isOperational", ddl: "BOOLEAN NOT NULL DEFAULT TRUE" },
    ],
  },
  {
    table: "recurring_expenses",
    cols: [
      { name: "isOperational", ddl: "BOOLEAN NOT NULL DEFAULT TRUE" },
    ],
  },
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
  console.log("MIGRACIÓN 0119 — expenses + recurring_expenses · isOperational");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  for (const t of TARGETS) {
    console.log(`\n[${t.table}]`);
    for (const col of t.cols) {
      if (await colExists(c, t.table, col.name)) {
        console.log(`  · skip ${t.table}.${col.name} (ya existe)`);
      } else {
        await c.query(`ALTER TABLE \`${t.table}\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
        console.log(`  ✓ ADD ${t.table}.${col.name}`);
      }
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
  console.log("FIN — migración 0119 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
