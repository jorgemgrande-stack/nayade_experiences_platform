// Aplica la migración 0122_tpv_sale_items_legopack_enum.
//
// Añade 'legoPack' al enum `productType_tsi` de `tpv_sale_items`. El TPV ya
// permite vender Lego Packs (tpv.ts: createSale), pero el enum de la BD no
// aceptaba ese valor y el INSERT de la línea de venta fallaba, dejando la
// venta huérfana en `tpv_sales` con status='pending'.
//
// Idempotente.
//
// Run: railway run --service MySQL node scripts/apply-tpv-sale-items-legopack-enum.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0122_tpv_sale_items_legopack_enum";

async function getColumnType(c) {
  const [rows] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tpv_sale_items' AND COLUMN_NAME = 'productType_tsi'`
  );
  if (!rows.length) throw new Error("Columna productType_tsi no encontrada en tpv_sale_items");
  return rows[0].COLUMN_TYPE;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0122 — tpv_sale_items.productType_tsi + legoPack");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  const currentType = await getColumnType(c);
  if (currentType.includes("legoPack")) {
    console.log("  · skip ALTER TABLE (el enum ya incluye 'legoPack')");
    console.log(`    actual: ${currentType}`);
  } else {
    console.log(`  · enum actual: ${currentType}`);
    await c.query(
      "ALTER TABLE `tpv_sale_items` MODIFY COLUMN `productType_tsi` ENUM('experience','pack','spa','hotel','restaurant','extra','legoPack') NOT NULL"
    );
    console.log("  ✓ ALTER TABLE tpv_sale_items MODIFY COLUMN productType_tsi (+ legoPack)");
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
  console.log("FIN — migración 0122 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
