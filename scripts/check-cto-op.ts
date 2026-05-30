import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const opNum = process.argv[2];
  if (!opNum) { console.error("Uso: ... <operation_number>"); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  const [r]: any = await c.query(
    `SELECT id, operation_datetime, operation_number, operation_type, amount, card,
     authorization_code, linked_entity_type, linked_entity_id, status,
     linked_at, linked_by, notes, duplicate_key
     FROM card_terminal_operations WHERE operation_number = ?`,
    [opNum]
  );
  for (const x of r) {
    console.log(`\ncto #${x.id} — op ${x.operation_number}`);
    console.log(`  datetime:     ${x.operation_datetime}`);
    console.log(`  type:         ${x.operation_type}`);
    console.log(`  amount:       ${x.amount}€`);
    console.log(`  card:         ${x.card ?? "—"}`);
    console.log(`  auth_code:    ${x.authorization_code ?? "—"}`);
    console.log(`  status:       ${x.status}`);
    console.log(`  linked:       ${x.linked_entity_type ?? "—"} #${x.linked_entity_id ?? "—"}  by=${x.linked_by ?? "—"}`);
    console.log(`  notes:        ${(x.notes ?? "").slice(0, 100)}`);
  }
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
