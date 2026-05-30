// Backfill: propaga a /admin/contabilidad/caja las entradas manuales de TPV
// (cash_movements.type_cm='in') que se registraron ANTES del fix b2b0014 y
// quedaron huérfanas (sin su contraparte en fin_cash_movements).
//
// Política:
//   · Para cada cash_movement 'in', se crea fin_cash_movements con concept
//     "Entrada de caja TPV — BACKFILL — {motivo}" y una nota de auditoría que
//     incluye el marcador "BACKFILL cash_movement #N" para idempotencia.
//   · Se actualiza fin_cash_accounts.current_balance sumando el importe.
//   · La fecha usada es la del movimiento original (no la de hoy).
//   · No toca el cash_movement TPV original.
//
// Idempotente: si vuelves a ejecutar, busca el marcador "BACKFILL cash_movement
// #N" en las notas y salta los ya propagados.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/backfill-cash-in-movements.ts --dry   (simula)
//   railway run npx tsx scripts/backfill-cash-in-movements.ts         (aplica)

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const dry = process.argv.includes("--dry");
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  console.log(`${dry ? "[DRY-RUN] " : ""}Backfill cash_movements 'in' → fin_cash_movements\n`);

  // 1. Cuenta de caja principal activa
  const [accs]: any = await c.query(
    "SELECT id, name, current_balance FROM fin_cash_accounts WHERE type = 'principal' AND is_active = 1 LIMIT 1"
  );
  if (accs.length === 0) {
    console.error("ABORTADO: no hay cuenta de caja 'principal' activa.");
    await c.end(); process.exit(1);
  }
  const acc = accs[0];
  console.log(`Cuenta destino: #${acc.id} "${acc.name}"  balance actual=${acc.current_balance}€\n`);

  // 2. Todas las entradas 'in' del TPV con datos de su sesión
  const [moves]: any = await c.query(`
    SELECT m.id, m.sessionId, m.amount, m.reason, m.cashierName, m.createdAt
    FROM cash_movements m
    WHERE m.type_cm = 'in'
    ORDER BY m.createdAt ASC
  `);
  console.log(`Entradas 'in' totales en cash_movements: ${moves.length}\n`);

  if (moves.length === 0) { await c.end(); return; }

  let propagated = 0;
  let skipped = 0;
  let totalAmount = 0;

  for (const m of moves) {
    // Comprobación de idempotencia: ¿ya se le hizo backfill?
    const marker = `BACKFILL cash_movement #${m.id}`;
    const [existing]: any = await c.query(
      "SELECT id FROM fin_cash_movements WHERE notes LIKE ? LIMIT 1",
      [`%${marker}%`]
    );

    if (existing.length > 0) {
      console.log(`  cash_movement #${m.id}  ${m.amount}€ "${m.reason}"  · ya backfilleado (fin #${existing[0].id}) — skip`);
      skipped++;
      continue;
    }

    const dateStr = new Date(Number(m.createdAt)).toISOString().slice(0, 10);
    const concept = `Entrada de caja TPV — BACKFILL — ${m.reason}`;
    const notes = `BACKFILL cash_movement #${m.id} — Entrada manual registrada en TPV (sesión #${m.sessionId}) por ${m.cashierName ?? "?"} el ${dateStr}. Backfilleada al módulo de contabilidad porque el código original solo propagaba las salidas (corregido en commit b2b0014).`;

    console.log(`  cash_movement #${m.id}  ${m.amount}€ "${m.reason}"  fecha=${dateStr}  → INSERT (${dry ? "DRY" : "aplicar"})`);

    if (!dry) {
      await c.query(
        `INSERT INTO fin_cash_movements (account_id, date, type_fcm, amount, concept, related_entity_type, notes, created_at)
         VALUES (?, ?, 'income', ?, ?, 'manual', ?, NOW())`,
        [acc.id, dateStr, String(m.amount), concept, notes]
      );
      await c.query(
        "UPDATE fin_cash_accounts SET current_balance = current_balance + ? WHERE id = ?",
        [String(m.amount), acc.id]
      );
    }

    propagated++;
    totalAmount += parseFloat(String(m.amount));
  }

  console.log(`\nResumen:`);
  console.log(`  propagadas:   ${propagated}  (importe ${totalAmount.toFixed(2)}€)`);
  console.log(`  ya existían:  ${skipped}`);
  if (!dry && propagated > 0) {
    const [newBal]: any = await c.query("SELECT current_balance FROM fin_cash_accounts WHERE id = ?", [acc.id]);
    console.log(`  balance nuevo de la cuenta #${acc.id}: ${newBal[0].current_balance}€`);
  }

  await c.end();
  console.log(`\n${dry ? "[DRY-RUN] " : ""}FIN`);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
