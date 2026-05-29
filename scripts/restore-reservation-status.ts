// Restaura el `status` legacy de una reserva (típicamente cuando ha quedado
// en un estado "zombie" — p.ej. status='cancelled' pero statusPayment='PAGADO'
// y statusReservation='CONFIRMADA' por un bulkUpdateStatus sin cascada).
//
// Deja huella en `reservations.changes_log` con motivo, actor "manual-restore"
// y un timestamp, para que el cambio sea trazable.
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/restore-reservation-status.ts \
//     --id 167 --to paid --reason "Corrección estado zombie tras bulkUpdateStatus"

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

function parseArgs(argv: string[]) {
  const out: { id?: number; to?: string; reason?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id") out.id = Number(argv[++i]);
    else if (argv[i] === "--to") out.to = argv[++i];
    else if (argv[i] === "--reason") out.reason = argv[++i];
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.id || !a.to) {
    console.error("Uso: --id N --to <status> [--reason \"…\"]");
    process.exit(1);
  }
  const valid = ["draft", "pending_payment", "paid", "failed", "cancelled"];
  if (!valid.includes(a.to)) {
    console.error(`status inválido: ${a.to}. Válidos: ${valid.join(", ")}`);
    process.exit(1);
  }

  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  const [rows]: any = await c.query(
    "SELECT id, reservation_number, status, status_reservation, status_payment, changes_log FROM reservations WHERE id = ? LIMIT 1",
    [a.id]
  );
  if (rows.length === 0) {
    console.error(`Reserva ${a.id} no encontrada.`);
    await c.end();
    process.exit(1);
  }
  const r = rows[0];
  console.log(`\nReserva #${r.id} (${r.reservation_number})`);
  console.log(`  status actual:            ${r.status}`);
  console.log(`  status_reservation:       ${r.status_reservation}`);
  console.log(`  status_payment:           ${r.status_payment}`);
  console.log(`  → restaurando status a:   ${a.to}\n`);

  // Construir entrada de changes_log
  const existingLog = (() => {
    if (Array.isArray(r.changes_log)) return r.changes_log;
    if (typeof r.changes_log === "string" && r.changes_log.length > 0) {
      try { return JSON.parse(r.changes_log); } catch { return []; }
    }
    return [];
  })();
  const logEntry = {
    ts: Date.now(),
    actor: "manual-restore (script)",
    action: "status_restore",
    from: r.status,
    to: a.to,
    reason: a.reason ?? "Corrección manual de estado",
  };
  const newLog = JSON.stringify([...existingLog, logEntry]);

  await c.query(
    "UPDATE reservations SET status = ?, changes_log = ?, updated_at = ? WHERE id = ?",
    [a.to, newLog, Date.now(), a.id]
  );

  // Verificar
  const [after]: any = await c.query(
    "SELECT status, status_reservation, status_payment FROM reservations WHERE id = ?",
    [a.id]
  );
  console.log("✓ Restaurado. Estado tras el cambio:");
  console.log(`  status:               ${after[0].status}`);
  console.log(`  status_reservation:   ${after[0].status_reservation}`);
  console.log(`  status_payment:       ${after[0].status_payment}`);
  console.log(`\nEntrada añadida a changes_log:`);
  console.log("  " + JSON.stringify(logEntry));

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
