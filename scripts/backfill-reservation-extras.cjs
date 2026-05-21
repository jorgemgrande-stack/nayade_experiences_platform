// Backfill — actividades extra de reservas multi-línea.
//
// Reservas creadas desde presupuestos con varias líneas perdían las líneas
// adicionales: solo el producto principal llegaba a Operaciones. Este script
// reconstruye `extras_json` (y corrige `product_id` si está a 0) leyendo las
// líneas del presupuesto vinculado.
//
// Solo lectura + UPDATE puntual. Idempotente: no toca reservas que ya tienen
// extras_json poblado.
//
// Run: railway run --service MySQL node scripts/backfill-reservation-extras.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

function parseItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/** Misma lógica que server/reservationUtils.ts. */
function deriveProduct(items) {
  if (items.length === 0) return { productId: null, extras: [] };
  let mainIdx = items.findIndex((i) => i.productId != null);
  if (mainIdx < 0) mainIdx = 0;
  const main = items[mainIdx];
  const extras = items
    .filter((_, idx) => idx !== mainIdx)
    .map((it) => ({
      productId: it.productId ?? null,
      experienceTitle: it.description ?? "Actividad",
      name: it.description ?? "Actividad",
      productName: it.description ?? "Actividad",
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unitPrice ?? 0),
      total: Number(it.total ?? 0),
    }));
  return { productId: main?.productId ?? null, extras };
}

(async () => {
  console.log("=".repeat(70));
  console.log("BACKFILL — actividades extra de reservas multi-línea");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  const [rows] = await c.query(`
    SELECT r.id, r.reservation_number AS num, r.product_id AS productId,
           r.extras_json AS extrasJson, q.items AS items
    FROM reservations r
    JOIN quotes q ON q.id = r.quote_id
    WHERE r.quote_id IS NOT NULL
  `);

  let fixed = 0, skipped = 0;
  for (const r of rows) {
    const items = parseItems(r.items);
    if (items.length <= 1) { skipped++; continue; }

    const existingExtras = parseItems(r.extrasJson);
    if (existingExtras.length > 0) { skipped++; continue; } // ya tiene extras

    const { productId, extras } = deriveProduct(items);
    if (extras.length === 0) { skipped++; continue; }

    const newProductId = (!r.productId || r.productId === 0) && productId ? productId : r.productId;
    await c.execute(
      "UPDATE reservations SET extras_json = ?, product_id = ? WHERE id = ?",
      [JSON.stringify(extras), newProductId, r.id]
    );
    console.log(`  ✓ ${r.num} (id=${r.id}) — ${extras.length} actividad(es) extra reconstruida(s)`
      + (newProductId !== r.productId ? ` · product_id ${r.productId}→${newProductId}` : ""));
    fixed++;
  }

  await c.end();
  console.log("=".repeat(70));
  console.log(`FIN — ${fixed} reserva(s) corregida(s), ${skipped} sin cambios`);
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
