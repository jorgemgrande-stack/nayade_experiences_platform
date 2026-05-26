// Auditoría del "tracto" de una reserva: estado en `reservations` + huellas
// en tablas operativas (reservation_operational, bookings, monitor_assignments,
// reav_expedients, ...). Sirve para entender por qué una reserva borrada o
// anulada puede seguir apareciendo en módulos como el calendario operativo.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/audit-reservation-trace.ts RES-2026-0166

import "dotenv/config";

const PUBLIC_DB =
  process.env.MYSQL_PUBLIC_URL ||
  process.env.MYSQL_URL ||
  process.env.DATABASE_PUBLIC_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error("Uso: npx tsx scripts/audit-reservation-trace.ts <reservationNumber>");
    process.exit(1);
  }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  const log = (title: string, rows: any[]) => {
    console.log(`\n── ${title} (${rows.length}) `.padEnd(70, "─"));
    if (rows.length === 0) { console.log("  (sin filas)"); return; }
    for (const r of rows) {
      const keep: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v == null) continue;
        if (typeof v === "string" && v.length > 100) keep[k] = v.slice(0, 97) + "...";
        else keep[k] = v;
      }
      console.log("  •", JSON.stringify(keep));
    }
  };

  // 1. La reserva en `reservations` — los nombres reales en BD son snake_case
  const [resRows]: any = await c.query(
    "SELECT * FROM reservations WHERE reservation_number = ? OR merchant_order = ? LIMIT 5",
    [ref, ref]
  );
  log("reservations", resRows);

  if (resRows.length === 0) {
    console.log("\n⚠ No se encontró ninguna reserva con esa referencia. Fin.");
    await c.end();
    return;
  }

  const ids = resRows.map((r: any) => r.id);
  const merchantOrders = [...new Set(resRows.map((r: any) => r.merchant_order).filter(Boolean))];
  const placeholders = ids.map(() => "?").join(",");

  // 2. ¿Otras reservas hermanas con el mismo merchantOrder?
  // Nota: confirmado que la tabla `reservations` NO tiene columna deleted_at →
  // el borrado es HARD-DELETE (no soft).
  if (merchantOrders.length > 0) {
    const [sibs]: any = await c.query(
      "SELECT id, reservation_number, product_name, status, status_reservation, partner_id " +
      `FROM reservations WHERE merchant_order IN (${merchantOrders.map(() => "?").join(",")})`,
      merchantOrders
    );
    log("reservations hermanas (mismo merchant_order)", sibs);
  }

  // 3. reservation_operational
  const [opRows]: any = await c.query(
    `SELECT * FROM reservation_operational WHERE reservation_id IN (${placeholders})`,
    ids
  ).catch((e: any) => { console.log("  (sin tabla reservation_operational?", e.code, ")"); return [[]]; });
  log("reservation_operational", opRows);

  // 4. bookings — uso SHOW COLUMNS para descubrir el nombre real
  const [bookingRows]: any = await c.query(
    `SELECT * FROM bookings WHERE reservation_id IN (${placeholders}) LIMIT 20`,
    ids
  ).catch(() => [[]]);
  log("bookings", bookingRows);

  // 5. monitor_assignments
  const [maRows]: any = await c.query(
    `SELECT * FROM monitor_assignments WHERE reservation_id IN (${placeholders}) LIMIT 20`,
    ids
  ).catch(() => [[]]);
  log("monitor_assignments", maRows);

  // 6. reav_expedients
  const [reavRows]: any = await c.query(
    `SELECT id, reservation_id, fiscal_status, operative_status, service_date, created_at FROM reav_expedients ` +
    `WHERE reservation_id IN (${placeholders})`,
    ids
  ).catch(() => [[]]);
  log("reav_expedients", reavRows);

  // 7. invoices (mira por reservation_id Y por invoice_number cruzado con res.invoice_id)
  const invoiceIds = resRows.map((r: any) => r.invoice_id).filter(Boolean);
  if (invoiceIds.length > 0) {
    const [invRows]: any = await c.query(
      `SELECT id, invoice_number, status, total, created_at FROM invoices WHERE id IN (${invoiceIds.map(() => "?").join(",")})`,
      invoiceIds
    ).catch(() => [[]]);
    log("invoices vinculadas (por invoice_id)", invRows);
  }

  // 8. partner_billing_batch_items
  const [bbiRows]: any = await c.query(
    `SELECT * FROM partner_billing_batch_items WHERE reservation_id IN (${placeholders}) LIMIT 20`,
    ids
  ).catch(() => [[]]);
  log("partner_billing_batch_items", bbiRows);

  // 9. cancellation_requests (si hubo una solicitud que no llegó a aprobarse)
  const [crRows]: any = await c.query(
    `SELECT * FROM cancellation_requests WHERE reservation_id IN (${placeholders}) LIMIT 20`,
    ids
  ).catch(() => [[]]);
  log("cancellation_requests", crRows);

  await c.end();
  console.log("\n── FIN ──");
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
