// Reproduce exactamente los JOIN del listado de reservas del CRM para una
// reserva concreta y devuelve cuántas filas resultantes hay. Si es >1,
// alguno de los JOIN duplica.
import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const ref = process.argv[2];
  if (!ref) { console.error("Uso: ... <reservation_number>"); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  // Query idéntica a la del listado (server/routers/crm.ts:4117)
  // Nota: reservations.quote_id e invoice_id son snake_case;
  // clients.leadId es camelCase; card_terminal_operations todo snake.
  const [rows]: any = await c.query(`
    SELECT
      r.id AS res_id, r.reservation_number,
      i.id AS invoice_id, i.invoiceNumber,
      q.id AS quote_id,
      cl.id AS client_id,
      cto.id AS cto_id, cto.operation_number AS cto_op, cto.operation_type AS cto_type
    FROM reservations r
    LEFT JOIN invoices i ON i.id = r.invoiceId
    LEFT JOIN quotes q ON q.id = r.quote_id
    LEFT JOIN clients cl ON cl.leadId = q.leadId
    LEFT JOIN card_terminal_operations cto
      ON cto.linked_entity_id = r.id AND cto.linked_entity_type = 'reservation'
    WHERE r.reservation_number = ?
  `, [ref]);

  console.log(`\nFilas resultantes: ${rows.length}\n`);
  for (const r of rows) console.log(`  ${JSON.stringify(r)}`);

  // Diagnosticar: ¿de qué JOIN viene el duplicado?
  console.log("\n── filas por tabla individual ──");
  const checks = [
    ["clients por leadId del quote", `SELECT cl.id, cl.name FROM reservations r JOIN quotes q ON q.id = r.quoteId JOIN clients cl ON cl.leadId = q.leadId WHERE r.reservation_number = ?`],
    ["card_terminal_operations", `SELECT cto.id, cto.id, cto.amount FROM card_terminal_operations cto JOIN reservations r ON cto.linkedEntityId = r.id AND cto.linkedEntityType = 'reservation' WHERE r.reservation_number = ?`],
  ];
  for (const [label, q] of checks) {
    const [rs]: any = await c.query(q, [ref]);
    console.log(`  ${label}: ${rs.length} fila(s)`);
    for (const r of rs) console.log(`    ${JSON.stringify(r)}`);
  }

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
