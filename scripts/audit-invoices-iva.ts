// Auditoría (SOLO LECTURA) de facturas con IVA mal calculado.
//
// Detecta facturas afectadas por el bug de "IVA sumado encima" (rutas factura
// manual y factura desde TPV/reserva): el importe BRUTO se trataba como base y
// se le sumaba el IVA, dejando `total` por encima de la suma de líneas (PVP).
//
// Modelo correcto (IVA incluido): el total = suma de líneas (PVP), y la base se
// EXTRAE (base = total / (1 + tipo/100)). Se reutiliza server/taxUtils para
// calcular exactamente igual que el código ya corregido.
//
// Señal del bug:  total_guardado  >  suma(itemsJson[].total) − descuento  (+1 cént.)
//
// ⚠️ NO MODIFICA NADA. Solo lee e imprime un informe.
//
// Uso (carpeta correctamente linkeada a Nayade Experiences):
//   railway run npx tsx scripts/audit-invoices-iva.ts
//   # o, pasando la URL del proxy público manualmente:
//   $env:MYSQL_PUBLIC_URL = "mysql://…"; npx tsx scripts/audit-invoices-iva.ts
//   # opcional: filtrar una factura concreta
//   railway run npx tsx scripts/audit-invoices-iva.ts FAC-2026-0147

import "dotenv/config";
import { groupTaxBreakdown, totalTaxAmount } from "../server/taxUtils";

const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

type Item = { total?: number; fiscalRegime?: string; taxRate?: number };

function parseItems(raw: unknown): Item[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Item[];
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

const eur = (n: number) => `${n.toFixed(2)} €`;

async function main() {
  const filter = process.argv[2]; // opcional: nº de factura concreto
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL / MYSQL_PUBLIC_URL. Ejecuta con `railway run` o exporta MYSQL_PUBLIC_URL.");
    process.exit(1);
  }

  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  const where = filter ? "WHERE invoiceNumber = ?" : "WHERE invoiceType = 'factura'";
  const params = filter ? [filter] : [];
  const [rows]: any = await c.query(
    `SELECT id, invoiceNumber, reservationId, status, invoiceType,
            itemsJson, subtotal, discount, taxRate, taxAmount, total, issuedAt, createdAt
     FROM invoices ${where}
     ORDER BY id ASC`,
    params,
  );

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  AUDITORÍA IVA EN FACTURAS — SOLO LECTURA (no se modifica nada)");
  console.log(`  Facturas analizadas: ${rows.length}${filter ? ` (filtro: ${filter})` : ""}`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  const affected: any[] = [];
  let sinItems = 0;

  for (const inv of rows) {
    const items = parseItems(inv.itemsJson);
    if (items.length === 0) { sinItems++; continue; }

    const gross = parseFloat(items.reduce((s: number, i: Item) => s + (Number(i.total) || 0), 0).toFixed(2));
    const discount = parseFloat(String(inv.discount ?? "0")) || 0;
    const storedTotal = parseFloat(String(inv.total ?? "0"));
    const storedSubtotal = parseFloat(String(inv.subtotal ?? "0"));
    const storedTax = parseFloat(String(inv.taxAmount ?? "0"));

    // Valores correctos (IVA incluido), mismo motor que el código corregido.
    const correctTax = totalTaxAmount(
      groupTaxBreakdown(items.map((i) => ({ total: Number(i.total) || 0, fiscalRegime: i.fiscalRegime, taxRate: i.taxRate })) as any),
    );
    const correctTotal = parseFloat((gross - discount).toFixed(2));
    const correctSubtotal = parseFloat((correctTotal - correctTax).toFixed(2));

    // Señal del bug: el total guardado supera el bruto (suma de PVP) − descuento.
    const overcharge = parseFloat((storedTotal - correctTotal).toFixed(2));
    if (overcharge > 0.01) {
      affected.push({
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        reservationId: inv.reservationId,
        gross, discount,
        storedSubtotal, storedTax, storedTotal,
        correctSubtotal, correctTax, correctTotal,
        overcharge,
        issuedAt: inv.issuedAt,
      });
    }
  }

  if (affected.length === 0) {
    console.log("✅ No se han detectado facturas con IVA sumado de más.");
    if (sinItems > 0) console.log(`   (${sinItems} facturas sin itemsJson legible — no evaluables por este método)`);
    await c.end();
    return;
  }

  console.log(`⚠️  FACTURAS AFECTADAS: ${affected.length}\n`);
  console.log(
    "  Nº factura".padEnd(20) +
    "Estado".padEnd(12) +
    "Bruto(PVP)".padStart(12) +
    "TotalGuard".padStart(12) +
    "TotalCorr".padStart(12) +
    "Sobrecoste".padStart(12),
  );
  console.log("  " + "─".repeat(78));
  let totalOver = 0;
  for (const a of affected) {
    totalOver += a.overcharge;
    console.log(
      `  ${String(a.invoiceNumber).padEnd(18)}` +
      `${String(a.status).padEnd(12)}` +
      `${eur(a.gross).padStart(12)}` +
      `${eur(a.storedTotal).padStart(12)}` +
      `${eur(a.correctTotal).padStart(12)}` +
      `${eur(a.overcharge).padStart(12)}`,
    );
  }
  console.log("  " + "─".repeat(78));
  console.log(`  Sobrecoste total acumulado en facturas: ${eur(parseFloat(totalOver.toFixed(2)))}\n`);

  console.log("  Detalle (valores guardados → corregidos):");
  for (const a of affected) {
    console.log(`\n  ▸ ${a.invoiceNumber}  [${a.status}]  reserva=${a.reservationId ?? "—"}  emitida=${a.issuedAt ?? "—"}`);
    console.log(`      subtotal:  ${eur(a.storedSubtotal)}  →  ${eur(a.correctSubtotal)}   (base imponible)`);
    console.log(`      IVA:       ${eur(a.storedTax)}  →  ${eur(a.correctTax)}`);
    console.log(`      TOTAL:     ${eur(a.storedTotal)}  →  ${eur(a.correctTotal)}   (debería = bruto/PVP)`);
    if (a.discount > 0) console.log(`      descuento: ${eur(a.discount)}`);
  }

  console.log("\n  NOTA: este informe NO modifica nada. La corrección (en sitio o");
  console.log("  rectificativa) se decide aparte; el campo `total` correcto es el bruto/PVP.");
  await c.end();
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
