// Investiga si una reserva tiene "vínculos múltiples" que puedan provocar
// que aparezca duplicada en listados (típicamente por JOIN sin GROUP BY).
import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const ref = process.argv[2];
  if (!ref) { console.error("Uso: npx tsx scripts/audit-duplication.ts <reservation_number>"); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  const [resRows]: any = await c.query(
    "SELECT id, reservation_number, customer_name, status, status_reservation, invoiceId, cancellation_request_id FROM reservations WHERE reservation_number = ?",
    [ref]
  );
  if (resRows.length === 0) { console.log(`Sin reserva ${ref}`); await c.end(); return; }
  console.log(`\n── reservations con reservation_number='${ref}' (${resRows.length}) ──`);
  for (const r of resRows) console.log(`  id=${r.id}  invoiceId=${r.invoiceId}  cancellation_request_id=${r.cancellation_request_id}  status=${r.status}/${r.status_reservation}`);

  if (resRows.length > 1) {
    console.log("\n⚠ HAY DUPLICADO REAL en la tabla reservations. Fin.");
    await c.end(); return;
  }

  const resId = resRows[0].id;

  // Cruces que pueden multiplicar el listado si hay LEFT JOIN sin agrupar
  const checks: Array<[string, string]> = [
    ["tpv_sales", `SELECT id, ticketNumber, status_ts AS status, total FROM tpv_sales WHERE reservationId = ${resId}`],
    ["tpv_sale_items", `SELECT i.id, i.saleId, i.productName, i.subtotal FROM tpv_sale_items i JOIN tpv_sales s ON s.id = i.saleId WHERE s.reservationId = ${resId}`],
    ["cancellation_requests", `SELECT id, status, total_amount_refunded, requested_at FROM cancellation_requests WHERE reservationId = ${resId}`],
    ["invoices (por reservationId)", `SELECT id, invoiceNumber, status FROM invoices WHERE reservationId = ${resId}`],
    ["bookings", `SELECT id, status, bookingDate FROM bookings WHERE reservationId = ${resId}`],
    ["reservation_operational", `SELECT id, op_status, monitor_id FROM reservation_operational WHERE reservation_id = ${resId}`],
    ["partner_billing_batch_items", `SELECT id, batchId, amount FROM partner_billing_batch_items WHERE reservationId = ${resId}`],
    ["transactions", `SELECT id, type, status, amount FROM transactions WHERE reservationId = ${resId}`],
    ["reav_expedients", `SELECT id, fiscal_status, operative_status FROM reav_expedients WHERE reservationId = ${resId}`],
  ];

  for (const [label, q] of checks) {
    try {
      const [rows]: any = await c.query(q);
      console.log(`\n── ${label} (${rows.length}) ──`);
      for (const r of rows) console.log(`  ${JSON.stringify(r)}`);
    } catch (e: any) {
      console.log(`\n── ${label} ──  ✗ ${e.code ?? e.message}`);
    }
  }

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
