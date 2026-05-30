// Audita la propagación de movimientos de caja TPV (cash_movements) al
// módulo de Contabilidad → Caja (fin_cash_movements). Sirve para detectar
// movimientos huérfanos que aparecen en TPV pero no en /admin/contabilidad/caja.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/audit-cash-movement.ts [--session N]

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const arg = process.argv.indexOf("--session");
  const sessionArg = arg >= 0 ? Number(process.argv[arg + 1]) : null;
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  let session: any;
  if (sessionArg) {
    const [r]: any = await c.query("SELECT * FROM cash_sessions WHERE id = ?", [sessionArg]);
    session = r[0];
  } else {
    const [r]: any = await c.query("SELECT * FROM cash_sessions ORDER BY id DESC LIMIT 1");
    session = r[0];
  }
  if (!session) { console.log("Sin sesiones."); await c.end(); return; }

  console.log(`\n── SESIÓN TPV #${session.id} (status=${session.status_cs}) ──`);
  const openedAt = new Date(Number(session.openedAt));
  console.log(`  abierta: ${openedAt.toISOString()}`);

  // 1. cash_movements de esa sesión (col real: type_cm)
  const [moves]: any = await c.query(
    "SELECT id, sessionId, type_cm AS type, amount, reason, cashierName, createdAt FROM cash_movements WHERE sessionId = ? ORDER BY createdAt",
    [session.id]
  );
  console.log(`\n── cash_movements de la sesión TPV (${moves.length}) ──`);
  for (const m of moves) {
    const ts = m.createdAt ? new Date(Number(m.createdAt)).toISOString() : "?";
    console.log(`  #${m.id}  type='${m.type}'  amount=${m.amount}€  reason='${m.reason ?? ""}'  cashier=${m.cashierName ?? "?"}  ts=${ts}`);
  }

  // 2. fin_cash_movements del mismo rango (col real: type_fcm)
  const dayStart = new Date(openedAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartStr = dayStart.toISOString().slice(0, 10);
  // También miramos el día siguiente por si el movimiento se registró tarde y cruzó día UTC.
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);

  const [finMoves]: any = await c.query(
    "SELECT id, account_id, date, type_fcm AS type, amount, concept, related_entity_type, notes, created_at FROM fin_cash_movements WHERE date IN (?, ?) ORDER BY id",
    [dayStartStr, nextDayStr]
  );
  console.log(`\n── fin_cash_movements del día ${dayStartStr} / ${nextDayStr} (${finMoves.length}) ──`);
  if (finMoves.length === 0) console.log("  (ninguno)");
  for (const f of finMoves) {
    console.log(`  #${f.id}  date=${f.date}  type='${f.type}'  amount=${f.amount}€  concept='${(f.concept ?? "").slice(0, 60)}'  related=${f.related_entity_type ?? "—"}`);
  }

  // 3. Reconciliación: por cada cash_movement, ¿existe un fin_cash_movement equivalente?
  console.log(`\n── RECONCILIACIÓN ──`);
  for (const m of moves) {
    const amt = parseFloat(String(m.amount));
    const finType = m.type === "out" ? "expense" : "income";
    const matches = finMoves.filter((f: any) =>
      parseFloat(String(f.amount)) === amt &&
      f.type === finType &&
      ((f.concept ?? "").toLowerCase().includes("tpv") || (f.notes ?? "").includes(`sesión #${session.id}`))
    );
    const status = matches.length > 0
      ? `✓ propagado (fin_cash_movement #${matches.map((m: any) => m.id).join(",")})`
      : `✗ NO PROPAGADO  ← debería existir en fin_cash_movements como '${finType}' de ${amt}€`;
    console.log(`  cash_movement #${m.id} (${m.type} ${m.amount}€ · "${m.reason}"): ${status}`);
  }

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
