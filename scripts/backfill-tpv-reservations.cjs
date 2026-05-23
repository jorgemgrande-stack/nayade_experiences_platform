// Backfill de reservas creadas desde TPV.
//
// Repara, para cada venta TPV que generó reserva, los datos inconsistentes
// que existían antes del fix:
//   1. reservations.people: ahora Σ(quantity × participants) sobre tpv_sale_items.
//   2. reservations.extras_json: limpia la duplicación del item principal
//      (antes guardaba todos los items, incluido el principal).
//   3. reservations.discount_amount / discount_reason: propaga desde tpv_sales.
//   4. invoices.discount / discount_reason: propaga desde tpv_sales si la
//      factura está vinculada a la reserva.
//
// 100% idempotente: se puede ejecutar tantas veces como se quiera; recalcula
// siempre el valor "correcto" según el estado actual de tpv_sale_items.
//
// Requiere que la migración 0118 esté aplicada (columnas discount_amount /
// discount_reason en reservations + discount / discount_reason en invoices).
//
// Run: railway run --service MySQL node scripts/backfill-tpv-reservations.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

(async () => {
  console.log("=".repeat(70));
  console.log("BACKFILL — Reservas TPV (people + extras_json + descuento)");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // Sanity: comprobar que las columnas del 0118 existen.
  const [colsRes] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
       AND COLUMN_NAME IN ('discount_amount','discount_reason')`
  );
  const [colsInv] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
       AND COLUMN_NAME IN ('discount','discount_reason')`
  );
  if (colsRes.length < 2 || colsInv.length < 2) {
    console.error("ABORTADO: faltan columnas del 0118. Ejecuta antes:");
    console.error("  railway run --service MySQL node scripts/apply-tpv-discount-trace.cjs");
    process.exit(1);
  }

  // 1. Localizar ventas TPV que crearon reserva
  // (tpv_sales usa camelCase en las columnas — ver drizzle/schema.ts tpvSales)
  const [sales] = await c.query(
    `SELECT id, reservationId, invoiceId, discountAmount, discountReason, ticketNumber
       FROM tpv_sales
      WHERE reservationId IS NOT NULL`
  );
  console.log(`\nVentas TPV con reserva asociada: ${sales.length}`);

  let fixedPeople = 0, fixedExtras = 0, fixedResDiscount = 0, fixedInvDiscount = 0;

  for (const sale of sales) {
    // 1a. Recalcular people = Σ(quantity × participants) sobre items de la venta
    // (tpv_sale_items usa camelCase: saleId, productId, productName, productType_tsi, unitPrice, eventDate, eventTime)
    const [items] = await c.query(
      `SELECT productId, productName, productType_tsi AS productType,
              quantity, unitPrice, participants, eventDate, eventTime
         FROM tpv_sale_items
        WHERE saleId = ?
        ORDER BY id ASC`,
      [sale.id]
    );
    if (items.length === 0) continue;

    const totalPeople = items.reduce(
      (sum, it) => sum + (Number(it.quantity) * (Number(it.participants) || 1)), 0
    );

    // 1b. Recomponer extras_json (excluye el item principal = el primero)
    const extrasJson = JSON.stringify(items.slice(1).map(it => ({
      productId:   it.productId,
      productName: it.productName,
      productType: it.productType,
      quantity:    Number(it.quantity),
      unitPrice:   Number(it.unitPrice),
      participants: Number(it.participants) || 1,
      eventDate:   it.eventDate,
      eventTime:   it.eventTime,
    })));

    // 2. Leer estado actual de la reserva para comparar antes de UPDATE
    // (reservations sí usa snake_case en sus columnas — ver drizzle/schema.ts)
    const [resRows] = await c.query(
      `SELECT id, people, extras_json, discount_amount, discount_reason
         FROM reservations WHERE id = ? LIMIT 1`,
      [sale.reservationId]
    );
    if (resRows.length === 0) continue;
    const res = resRows[0];

    const newDiscountAmount = sale.discountAmount != null ? String(Number(sale.discountAmount).toFixed(2)) : "0.00";
    const newDiscountReason = sale.discountReason ?? null;

    const peopleDelta   = Number(res.people)            !== totalPeople;
    const extrasDelta   = String(res.extras_json ?? "") !== extrasJson;
    const discountDelta = String(res.discount_amount ?? "0.00") !== newDiscountAmount
                       || (res.discount_reason ?? null)        !== newDiscountReason;

    if (peopleDelta || extrasDelta || discountDelta) {
      await c.query(
        `UPDATE reservations
            SET people = ?, extras_json = ?, discount_amount = ?, discount_reason = ?,
                updated_at = ?
          WHERE id = ?`,
        [totalPeople, extrasJson, newDiscountAmount, newDiscountReason, Date.now(), res.id]
      );
      if (peopleDelta)   fixedPeople++;
      if (extrasDelta)   fixedExtras++;
      if (discountDelta) fixedResDiscount++;
      console.log(`  ✓ res #${res.id} [${sale.ticketNumber}]`
        + (peopleDelta   ? ` people ${res.people}→${totalPeople}` : "")
        + (extrasDelta   ? ` extras_json` : "")
        + (discountDelta ? ` discount ${res.discount_amount}→${newDiscountAmount}` : "")
      );
    }

    // 3. Propagar descuento a invoice si está vinculada
    // (invoices usa camelCase para updatedAt, snake_case para discount_reason — coherente con el ALTER de 0118)
    if (sale.invoiceId) {
      const [invRows] = await c.query(
        `SELECT id, discount, discount_reason FROM invoices WHERE id = ? LIMIT 1`,
        [sale.invoiceId]
      );
      if (invRows.length > 0) {
        const inv = invRows[0];
        const invDelta = String(inv.discount ?? "0.00") !== newDiscountAmount
                      || (inv.discount_reason ?? null)  !== newDiscountReason;
        if (invDelta) {
          await c.query(
            `UPDATE invoices
                SET discount = ?, discount_reason = ?, updatedAt = NOW()
              WHERE id = ?`,
            [newDiscountAmount, newDiscountReason, inv.id]
          );
          fixedInvDiscount++;
          console.log(`    ↳ inv #${inv.id} discount ${inv.discount}→${newDiscountAmount}`);
        }
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("RESUMEN");
  console.log("=".repeat(70));
  console.log(`  · ventas analizadas:            ${sales.length}`);
  console.log(`  · reservas con people corregido: ${fixedPeople}`);
  console.log(`  · reservas con extras_json limpio: ${fixedExtras}`);
  console.log(`  · reservas con descuento propagado: ${fixedResDiscount}`);
  console.log(`  · facturas con descuento propagado: ${fixedInvDiscount}`);

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
