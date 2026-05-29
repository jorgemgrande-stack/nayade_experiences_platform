// Fix puntual: el producto "Canoas & Kayaks" (id=30004) estaba mal
// configurado con pricing_type='per_unit', lo que hacía que su precio NO se
// multiplicase por personas en los modales de reserva. Lo cambiamos a
// 'per_person' (su modelo real de negocio: 15 €/persona) y recalculamos las
// 4 reservas de Partners en estado pending_payment que se crearon con el
// importe sin multiplicar:
//
//   RES-2026-0184  5 pers  15€ → 75€
//   RES-2026-0149  2 pers  15€ → 30€
//   RES-2026-0130  2 pers  15€ → 30€
//   RES-2026-0127  2 pers  15€ → 30€
//
// La RES-2026-0124 (CRM, importe manualmente puesto a 1€) NO se toca.
//
// Idempotente: si ya está corregido, no hace nada. Cada reserva tocada
// queda con entrada en changes_log para trazabilidad.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/fix-canoas-pricing.ts
//   railway run npx tsx scripts/fix-canoas-pricing.ts --dry  (simulación)

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

const PRODUCT_ID = 30004;
const PRODUCT_NAME = "Canoas & Kayaks";
const UNIT_PRICE_EUR = 15; // basePrice esperado
const RESERVATIONS_TO_FIX = ["RES-2026-0184", "RES-2026-0149", "RES-2026-0130", "RES-2026-0127"];

async function main() {
  const dry = process.argv.includes("--dry");
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  console.log(`${dry ? "[DRY-RUN] " : ""}Fix Canoas & Kayaks pricing\n`);

  // 1. Verificar producto
  const [prodRows]: any = await c.query(
    "SELECT id, title, basePrice, pricing_type, unit_capacity FROM experiences WHERE id = ?",
    [PRODUCT_ID]
  );
  if (prodRows.length === 0) {
    console.error(`Producto #${PRODUCT_ID} no encontrado. Aborto.`);
    await c.end(); process.exit(1);
  }
  const prod = prodRows[0];
  console.log(`Producto: ${prod.title}  basePrice=${prod.basePrice}€  pricing_type=${prod.pricing_type}`);
  if (Number(prod.basePrice) !== UNIT_PRICE_EUR) {
    console.error(`⚠ basePrice (${prod.basePrice}) != ${UNIT_PRICE_EUR}. Aborto por seguridad — revisa antes.`);
    await c.end(); process.exit(1);
  }

  if (prod.pricing_type === "per_person") {
    console.log("  · ya estaba en per_person, no se toca el producto.");
  } else {
    console.log(`  → cambiar pricing_type: ${prod.pricing_type} → per_person`);
    if (!dry) {
      await c.query("UPDATE experiences SET pricing_type = 'per_person' WHERE id = ?", [PRODUCT_ID]);
      console.log("  ✓ producto actualizado");
    }
  }

  // 2. Recalcular reservas
  console.log("\nReservas a recalcular:");
  for (const ref of RESERVATIONS_TO_FIX) {
    const [rows]: any = await c.query(
      "SELECT id, reservation_number, product_id, people, amount_total, amount_paid, status, changes_log FROM reservations WHERE reservation_number = ?",
      [ref]
    );
    if (rows.length === 0) { console.log(`  ${ref}  ✗ no encontrada — salto`); continue; }
    const r = rows[0];

    if (r.product_id !== PRODUCT_ID) { console.log(`  ${ref}  ✗ producto distinto (${r.product_id}) — salto`); continue; }
    if (r.status !== "pending_payment") { console.log(`  ${ref}  ✗ status=${r.status} (no es pending_payment) — salto por seguridad`); continue; }
    if (Number(r.amount_paid) > 0) { console.log(`  ${ref}  ✗ amount_paid=${r.amount_paid} (algo ya cobrado) — salto por seguridad`); continue; }

    const expectedCents = r.people * UNIT_PRICE_EUR * 100;
    if (Number(r.amount_total) === expectedCents) {
      console.log(`  ${ref}  · ya está correcto (${r.people}p · ${expectedCents / 100}€) — salto`);
      continue;
    }

    const before = (r.amount_total / 100).toFixed(2);
    const after = (expectedCents / 100).toFixed(2);
    console.log(`  ${ref}  ${r.people}p · ${before}€ → ${after}€  (${dry ? "DRY" : "aplicar"})`);

    if (!dry) {
      const existingLog = Array.isArray(r.changes_log) ? r.changes_log : [];
      const logEntry = {
        ts: Date.now(),
        actor: "fix-canoas-pricing (script)",
        action: "amount_recalculation",
        from: { amount_total: r.amount_total, people: r.people },
        to: { amount_total: expectedCents, people: r.people },
        reason: `Canoas & Kayaks reconfigurado a per_person. Reserva creada con precio sin multiplicar por personas.`,
      };
      const newLog = JSON.stringify([...existingLog, logEntry]);
      await c.query(
        "UPDATE reservations SET amount_total = ?, changes_log = ?, updated_at = ? WHERE id = ?",
        [expectedCents, newLog, Date.now(), r.id]
      );
      console.log(`     ✓ actualizado + log de auditoría`);
    }
  }

  await c.end();
  console.log(`\n${dry ? "[DRY-RUN] " : ""}FIN`);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
