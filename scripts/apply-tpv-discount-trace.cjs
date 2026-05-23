// Aplica la migración 0118_tpv_discount_trace.
//
// Añade columnas de descuento a `reservations` e `invoices` para que el
// desglose generado por TPV viaje con la reserva y la factura.
// Idempotente. Run: railway run --service MySQL node scripts/apply-tpv-discount-trace.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0118_tpv_discount_trace";
const TARGETS = [
  {
    table: "reservations",
    cols: [
      { name: "discount_amount", ddl: "DECIMAL(10,2) NOT NULL DEFAULT '0.00'" },
      { name: "discount_reason", ddl: "VARCHAR(255) NULL" },
    ],
  },
  {
    table: "invoices",
    cols: [
      { name: "discount",        ddl: "DECIMAL(10,2) NOT NULL DEFAULT '0.00'" },
      { name: "discount_reason", ddl: "VARCHAR(255) NULL" },
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
  console.log("MIGRACIÓN 0118 — reservations + invoices · trazabilidad descuento TPV");
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
  console.log("FIN — migración 0118 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
