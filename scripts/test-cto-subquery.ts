import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  const [r]: any = await c.query(`
    SELECT r.id, r.reservation_number, cto_agg.operationNumber
    FROM reservations r
    LEFT JOIN (
      SELECT linked_entity_id AS reservationId, MAX(operation_number) AS operationNumber
      FROM card_terminal_operations
      WHERE linked_entity_type = 'reservation'
      GROUP BY linked_entity_id
    ) cto_agg ON cto_agg.reservationId = r.id
    WHERE r.reservation_number = 'RES-2026-0196'
  `);
  console.log("Filas:", r.length);
  r.forEach((x: any) => console.log(" ", JSON.stringify(x)));
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
