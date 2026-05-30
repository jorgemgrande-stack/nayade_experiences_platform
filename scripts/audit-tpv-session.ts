// Auditoría de una sesión TPV: ventas, pagos por método, totales esperados
// vs lo que muestra el modal de cierre. Útil cuando "Efectivo esperado" sale
// a 0 pese a haber ventas en efectivo.
//
// Sin argumentos = sesión abierta más reciente.
// Con --session N = sesión concreta.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/audit-tpv-session.ts

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const arg = process.argv.indexOf("--session");
  const sessionArg = arg >= 0 ? Number(process.argv[arg + 1]) : null;

  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  // 1. Sesión a auditar
  let session: any;
  if (sessionArg) {
    const [rows]: any = await c.query("SELECT * FROM cash_sessions WHERE id = ?", [sessionArg]);
    session = rows[0];
  } else {
    const [rows]: any = await c.query(
      "SELECT * FROM cash_sessions ORDER BY id DESC LIMIT 1"
    );
    session = rows[0];
  }
  if (!session) { console.log("Sin sesiones."); await c.end(); return; }

  console.log(`\n── SESIÓN TPV #${session.id} ────────────────────────────────`);
  console.log(`  status:        ${session.status_cs}`);
  const fmtTs = (v: any) => {
    if (v == null) return "—";
    const n = Number(v);
    if (!isNaN(n) && n > 0) return new Date(n).toISOString();
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  console.log(`  opened_at:     ${fmtTs(session.openedAt)}`);
  console.log(`  closed_at:     ${fmtTs(session.closedAt)}`);
  console.log(`  cashier:       ${session.cashierName} (user=${session.cashierUserId})`);
  console.log(`  register_id:   ${session.registerId}`);
  console.log(`  opening_amount:${session.openingAmount}€`);

  // Nota: el proyecto usa sufijos por palabras reservadas en MySQL:
  //   tpv_sales.status_ts          (status)
  //   tpv_sale_payments.method_tsp (method)
  //   tpv_sale_payments.amount_tsp (amount)
  //   tpv_sale_payments.status_tsp (status)
  // El ORM Drizzle los mapea internamente, pero al leer con mysql2 puro
  // hay que usar los nombres reales.

  // 2. Ventas de la sesión
  const [sales]: any = await c.query(
    "SELECT id, ticketNumber, status_ts AS status, total, customerName, createdAt FROM tpv_sales WHERE sessionId = ? ORDER BY id",
    [session.id]
  );
  console.log(`\n── VENTAS (${sales.length}) ────────────────────────────────`);
  if (sales.length === 0) { console.log("  (ninguna)"); await c.end(); return; }
  for (const s of sales) {
    console.log(`  #${s.id}  ${String(s.ticketNumber).padEnd(14)}  status=${String(s.status).padEnd(10)}  total=${s.total}€  customer=${s.customerName ?? "—"}`);
  }

  const saleIds = sales.map((s: any) => s.id);
  const placeholders = saleIds.map(() => "?").join(",");

  // 3. PAGOS
  const [pays]: any = await c.query(
    `SELECT id, saleId AS sale_id, method_tsp AS method, status_tsp AS status, amount_tsp AS amount, createdAt FROM tpv_sale_payments WHERE saleId IN (${placeholders}) ORDER BY saleId, id`,
    saleIds
  );
  console.log(`\n── PAGOS (${pays.length}) ───────────────────────────────`);
  for (const p of pays) {
    console.log(`  sale #${p.sale_id}  method='${p.method}'  status='${p.status}'  amount=${p.amount}€`);
  }

  // 4. AGREGADOS — replicando la lógica de closeSession en backend
  console.log(`\n── TOTALES POR MÉTODO (filtrando status_venta='paid' + status_pago='completed') ──`);
  const totals: Record<string, number> = {};
  const paidSaleIds = sales.filter((s: any) => s.status === "paid").map((s: any) => s.id);
  console.log(`  Ventas con status='paid': ${paidSaleIds.length} de ${sales.length}`);
  const saleIdOf = (p: any) => p.sale_id;
  for (const p of pays) {
    const sid = saleIdOf(p);
    if (!paidSaleIds.includes(sid)) continue;
    if (p.status !== "completed") continue;
    const key = p.method ?? "(null)";
    totals[key] = (totals[key] ?? 0) + parseFloat(String(p.amount));
  }
  for (const [k, v] of Object.entries(totals)) {
    console.log(`  ${k.padEnd(20)} ${v.toFixed(2)}€`);
  }
  const totalCashEsperado = totals.cash ?? 0;
  console.log(`\n  → "Efectivo esperado" calculado = ${totalCashEsperado.toFixed(2)}€`);
  console.log(`     (el modal mostraría: 0.00€ si no hay payments con method='cash' status='completed' en sales status='paid')`);

  // 5. Detectar pagos con método raro / no encajan
  const ALLOWED_METHODS = new Set(["cash", "card", "bizum"]);
  const otherMethods = pays.filter((p: any) => p.method && !ALLOWED_METHODS.has(p.method));
  if (otherMethods.length > 0) {
    console.log(`\n  ⚠ Pagos con method fuera de [cash|card|bizum]: ${otherMethods.length}`);
    for (const p of otherMethods) {
      console.log(`     sale #${saleIdOf(p)}  method='${p.method}'  ${p.amount}€`);
    }
  }
  // Pagos cuya venta no está en 'paid'
  const orphanPays = pays.filter((p: any) => !paidSaleIds.includes(saleIdOf(p)));
  if (orphanPays.length > 0) {
    console.log(`\n  ⚠ Pagos en ventas NO 'paid' (no cuentan en el cierre):`);
    for (const p of orphanPays) {
      const sid = saleIdOf(p);
      const sale = sales.find((s: any) => s.id === sid);
      console.log(`     sale #${sid}  sale.status='${sale?.status}'  pay.method='${p.method}'  pay.status='${p.status}'  ${p.amount}€`);
    }
  }
  // Pagos no 'completed'
  const notCompleted = pays.filter((p: any) => paidSaleIds.includes(saleIdOf(p)) && p.status !== "completed");
  if (notCompleted.length > 0) {
    console.log(`\n  ⚠ Pagos en venta paid pero pago NO 'completed':`);
    for (const p of notCompleted) {
      console.log(`     sale #${saleIdOf(p)}  pay.method='${p.method}'  pay.status='${p.status}'  ${p.amount}€`);
    }
  }

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
