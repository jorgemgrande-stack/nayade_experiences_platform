// Auditoría de configuración de precios:
//   1. Estado de una reserva concreta (qué se guardó).
//   2. Configuración del producto reservado (basePrice, pricing_type, unit_capacity).
//   3. Listado de TODOS los productos con `pricing_type = "per_unit"` para
//      detectar otros que pudieran sufrir el mismo malentendido en cálculos.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/audit-pricing.ts RES-2026-0184

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const ref = process.argv[2];
  if (!ref) { console.error("Uso: npx tsx scripts/audit-pricing.ts <reservationNumber>"); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  // 1. La reserva
  const [resRows]: any = await c.query(
    "SELECT id, reservation_number, product_id, product_name, people, amount_total, amount_paid, status, status_reservation, channel, partner_id, merchant_order, created_at, units_booked FROM reservations WHERE reservation_number = ? LIMIT 1",
    [ref]
  );
  if (resRows.length === 0) { console.log(`Sin reserva ${ref}`); await c.end(); return; }
  const r = resRows[0];
  console.log("── RESERVA ──────────────────────────────────────────────");
  console.log(`  ${r.reservation_number} (id=${r.id})`);
  console.log(`  product:       #${r.product_id}  "${r.product_name}"`);
  console.log(`  people:        ${r.people}`);
  console.log(`  units_booked:  ${r.units_booked ?? "—"}`);
  console.log(`  amount_total:  ${(r.amount_total / 100).toFixed(2)} €  (${r.amount_total} cents)`);
  console.log(`  channel:       ${r.channel}  partner_id=${r.partner_id ?? "—"}`);
  console.log(`  status:        ${r.status} / ${r.status_reservation}`);

  // 2. El producto
  const [prodRows]: any = await c.query(
    "SELECT * FROM experiences WHERE id = ? LIMIT 1",
    [r.product_id]
  );
  console.log("\n── PRODUCTO ─────────────────────────────────────────────");
  if (prodRows.length === 0) { console.log("  (no encontrado)"); }
  else {
    const p = prodRows[0];
    console.log(`  ${p.title} (id=${p.id}, slug=${p.slug})`);
    console.log(`  basePrice:    ${p.basePrice} €`);
    console.log(`  pricing_type:  ${p.pricing_type ?? "NULL"}  ← determina si se multiplica por personas`);
    console.log(`  unit_capacity: ${p.unit_capacity ?? "—"}`);
    console.log(`  active=${p.is_active}  published=${p.is_published}`);
    const base = parseFloat(p.basePrice ?? "0");
    const expectedPerPerson = (base * r.people).toFixed(2);
    const expectedPerUnit = base.toFixed(2);
    console.log(`\n  Importe esperado si per_person × ${r.people}: ${expectedPerPerson} €`);
    console.log(`  Importe esperado si per_unit (precio fijo):    ${expectedPerUnit} €`);
    console.log(`  Importe REAL guardado:                          ${(r.amount_total / 100).toFixed(2)} €`);
  }

  // 3. Todos los productos per_unit (para ver qué más puede sufrir el mismo problema)
  const [perUnitRows]: any = await c.query(
    "SELECT * FROM experiences WHERE pricing_type = 'per_unit' ORDER BY title"
  );
  console.log(`\n── PRODUCTOS CON pricing_type='per_unit' (${perUnitRows.length}) ──────`);
  if (perUnitRows.length === 0) console.log("  (ninguno)");
  for (const p of perUnitRows) {
    const flag = (p.is_active && p.is_published) ? "✓" : (p.is_active ? "○" : "✗");
    console.log(`  ${flag} #${p.id}  ${p.title.padEnd(45)}  ${p.basePrice} €  capacity=${p.unit_capacity ?? "—"}`);
  }

  // 4. ¿Hay productos con pricing_type NULL (legacy)?
  const [nullRows]: any = await c.query(
    "SELECT COUNT(*) AS n FROM experiences WHERE pricing_type IS NULL OR pricing_type = ''"
  );
  console.log(`\nProductos con pricing_type NULL/vacío: ${nullRows[0].n}`);

  // 5. Reservas recientes de productos per_unit: ver si más reservas tienen
  //    el patrón sospechoso "people > 1 con amount = basePrice" (sin multiplicar).
  if (perUnitRows.length > 0) {
    const perUnitIds = perUnitRows.map((p: any) => p.id);
    const [suspects]: any = await c.query(
      `SELECT res.id, res.reservation_number, res.product_id, res.product_name, res.people,
              res.amount_total, res.channel, res.partner_id, res.units_booked, res.created_at,
              e.basePrice
       FROM reservations res
       JOIN experiences e ON e.id = res.product_id
       WHERE res.product_id IN (${perUnitIds.map(() => "?").join(",")})
         AND res.people > 1
         AND res.amount_total <= e.basePrice * 100 + 1
       ORDER BY res.created_at DESC
       LIMIT 30`,
      perUnitIds
    );
    console.log(`\n── RESERVAS SOSPECHOSAS (people>1 con importe ≈ basePrice) ${suspects.length} ─`);
    for (const s of suspects) {
      const total = (s.amount_total / 100).toFixed(2);
      const expectedIfPerPerson = (parseFloat(s.basePrice) * s.people).toFixed(2);
      console.log(`  ${s.reservation_number}  ${s.product_name.padEnd(28)}  ${s.people} pers · cobrado ${total}€ · si fuera per_person ${expectedIfPerPerson}€  [${s.channel}]`);
    }
  }

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
