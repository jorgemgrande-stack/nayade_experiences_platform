// scripts/generate-tpv-invoices.mjs
// Genera facturas retroactivas para las ventas TPV que no la tienen.
// Por defecto procesa las 7 reservas RES-2026-0082..0088 pero acepta
// cualquier lista de reservation_numbers como argumento CLI.
//
// Run with: node scripts/generate-tpv-invoices.mjs [RES-2026-XXXX ...]

import "dotenv/config";
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("✗ DATABASE_URL no encontrada"); process.exit(1); }

const DEFAULT_CODES = [
  "RES-2026-0082","RES-2026-0083","RES-2026-0084",
  "RES-2026-0085","RES-2026-0086","RES-2026-0087","RES-2026-0088",
];
const codes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CODES;

function hr() { console.log("═".repeat(70)); }

const conn = await mysql.createConnection({ uri: DB_URL });

// ── Generar número de factura (replica la lógica de documentNumbers.ts) ─────
async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  await conn.execute(
    "UPDATE document_counters SET current_number = current_number + 1 WHERE document_type = 'factura' AND year = ?",
    [year]
  );
  const [[row]] = await conn.execute(
    "SELECT current_number, prefix FROM document_counters WHERE document_type = 'factura' AND year = ?",
    [year]
  );
  const num = String(row.current_number).padStart(4, "0");
  return `${row.prefix}-${year}-${num}`;
}

hr();
console.log(`GENERACIÓN FACTURAS TPV — ${codes.length} reserva(s)`);
hr();

const ph = codes.map(() => "?").join(",");
const [reservations] = await conn.execute(
  `SELECT id, reservation_number, customer_name, customer_email, customer_phone, paymentMethod, created_at
   FROM reservations WHERE reservation_number IN (${ph}) AND invoiceId IS NULL`,
  codes
);

if (reservations.length === 0) {
  console.log("✓ Todas las reservas ya tienen factura — nada que hacer.");
  await conn.end(); process.exit(0);
}

console.log(`\nReservas sin factura encontradas: ${reservations.length}`);
const resIds = reservations.map(r => r.id);

// Cargar tpvSales vinculadas
const phIds = resIds.map(() => "?").join(",");
const [sales] = await conn.execute(
  `SELECT id AS saleId, reservationId, ticketNumber, customerName, customerEmail, customerPhone,
          subtotal, total, taxBase, taxAmount, taxRate, fiscalSummary, paidAt
   FROM tpv_sales WHERE reservationId IN (${phIds})`,
  resIds
);
const salesBySaleId = Object.fromEntries(sales.map(s => [s.saleId, s]));
const salesByResId  = Object.fromEntries(sales.map(s => [s.reservationId, s]));
const saleIds = sales.map(s => s.saleId);

// Cargar items
const [allItems] = saleIds.length
  ? await conn.execute(
      `SELECT saleId, productName, quantity, unitPrice, subtotal_tsi AS lineTotal,
              fiscalRegime_tsi AS fiscalRegime, taxBase_tsi AS taxBase,
              taxAmount_tsi AS taxAmount, taxRate_tsi AS taxRate, productId
       FROM tpv_sale_items WHERE saleId IN (${saleIds.map(() => "?").join(",")})`,
      saleIds
    )
  : [[]];
const itemsBySaleId = {};
for (const item of allItems) {
  if (!itemsBySaleId[item.saleId]) itemsBySaleId[item.saleId] = [];
  itemsBySaleId[item.saleId].push(item);
}

// Cargar método de pago principal (method_tsp) desde tpv_sale_payments
const [allPays] = saleIds.length
  ? await conn.execute(
      `SELECT saleId, method_tsp FROM tpv_sale_payments WHERE saleId IN (${saleIds.map(() => "?").join(",")})`,
      saleIds
    )
  : [[]];
const payMethodBySaleId = {};
for (const p of allPays) payMethodBySaleId[p.saleId] = p.method_tsp;

console.log();
const generated = [];

await conn.beginTransaction();
try {
  for (const res of reservations) {
    const sale = salesByResId[res.id];
    if (!sale) {
      console.log(`  ✗ ${res.reservation_number} — sin tpvSale vinculada, se omite`);
      continue;
    }

    const items = itemsBySaleId[sale.saleId] ?? [];
    const rawMethod = payMethodBySaleId[sale.saleId] ?? "card";
    const invoicePayMethod =
      rawMethod === "cash"  ? "efectivo" :
      rawMethod === "card"  ? "tarjeta_fisica" : "otro";

    // items en formato itemsJson de invoices
    const itemsJson = items.map(it => ({
      description: it.productName,
      quantity:    Number(it.quantity),
      unitPrice:   Number(it.unitPrice),
      total:       Number(it.lineTotal),
      fiscalRegime: it.fiscalRegime ?? "reav",
      taxRate:     Number(it.taxRate),
      productId:   it.productId ?? undefined,
    }));

    const total    = Number(sale.total);
    const subtotal = Number(sale.subtotal);
    const taxAmount = Number(sale.taxAmount);
    const taxRate   = Number(sale.taxRate);
    const issuedAt  = new Date(Number(sale.paidAt));

    const invoiceNumber = await nextInvoiceNumber();

    // Insert invoice
    const [ins] = await conn.execute(
      `INSERT INTO invoices
         (invoiceNumber, reservationId, clientName, clientEmail, clientPhone,
          itemsJson, subtotal, taxRate, taxAmount, total, currency,
          status, invoiceType, paymentMethod, issuedAt, createdAt, updatedAt)
       VALUES (?,?,?,?,?, ?,?,?,?,?,'EUR', 'cobrada','factura',?,?,?,?)`,
      [
        invoiceNumber,
        res.id,
        sale.customerName || res.customer_name,
        sale.customerEmail || res.customer_email || "",
        sale.customerPhone || res.customer_phone || null,
        JSON.stringify(itemsJson),
        String(subtotal.toFixed(2)),
        String(taxRate.toFixed(2)),
        String(taxAmount.toFixed(2)),
        String(total.toFixed(2)),
        invoicePayMethod,
        issuedAt,
        issuedAt,
        issuedAt,
      ]
    );
    const invoiceId = ins.insertId;

    // Update reservation
    await conn.execute(
      "UPDATE reservations SET invoiceId = ?, invoiceNumber = ? WHERE id = ?",
      [invoiceId, invoiceNumber, res.id]
    );

    // Update tpvSale
    await conn.execute(
      "UPDATE tpv_sales SET invoiceId = ? WHERE id = ?",
      [invoiceId, sale.saleId]
    );

    console.log(`  ✓ ${res.reservation_number}  ${sale.customerName.padEnd(28)} ${invoiceNumber}  ${total.toFixed(2)} €`);
    generated.push({ reservation: res.reservation_number, invoice: invoiceNumber, total });
  }

  await conn.commit();
  console.log("\n✓ COMMIT");
} catch (e) {
  await conn.rollback();
  console.error("\n✗ Error — ROLLBACK:", e.message);
  await conn.end(); process.exit(1);
}

await conn.end();
hr();
console.log(`FIN — ${generated.length} factura(s) generada(s)`);
hr();
