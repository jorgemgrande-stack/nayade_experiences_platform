import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const resId = Number(process.argv[2]);
  if (!resId) { console.error("Uso: ... <reservationId>"); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  const [r]: any = await c.query(
    `SELECT id, operation_datetime, operation_number, operation_type, amount, card,
     status, linked_at, linked_by, notes, duplicate_key, created_at
     FROM card_terminal_operations
     WHERE linked_entity_id = ? AND linked_entity_type = 'reservation'
     ORDER BY operation_datetime`,
    [resId]
  );
  console.log(`\nOperaciones TPV vinculadas a reserva #${resId} (${r.length})\n`);
  for (const x of r) {
    console.log(`  cto #${x.id}`);
    console.log(`    operation_number: ${x.operation_number}`);
    console.log(`    type:             ${x.operation_type}`);
    console.log(`    amount:           ${x.amount} €  card=${x.card}`);
    console.log(`    datetime:         ${x.operation_datetime}`);
    console.log(`    status:           ${x.status}`);
    console.log(`    linked_at:        ${x.linked_at}  by=${x.linked_by}`);
    console.log(`    notes:            ${(x.notes ?? "").slice(0, 80)}`);
    console.log("");
  }
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
