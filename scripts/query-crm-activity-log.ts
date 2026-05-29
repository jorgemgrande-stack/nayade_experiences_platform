// Consulta crm_activity_log para una reserva concreta. Sirve para
// descubrir QUIÉN y CUÁNDO disparó cada acción sobre ella (útil cuando
// la propia tabla `reservations.changesLog` está vacía o incompleta).
//
// Uso:
//   $env:MYSQL_PUBLIC_URL = "mysql://..."
//   railway run npx tsx scripts/query-crm-activity-log.ts 167

import "dotenv/config";

const PUBLIC_DB =
  process.env.MYSQL_PUBLIC_URL ||
  process.env.MYSQL_URL ||
  process.env.DATABASE_PUBLIC_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const entityId = Number(process.argv[2]);
  if (!entityId) {
    console.error("Uso: npx tsx scripts/query-crm-activity-log.ts <reservationId>");
    process.exit(1);
  }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  const [rows]: any = await c.query(
    `SELECT * FROM crm_activity_log
     WHERE entityType = 'reservation' AND entityId = ?
     ORDER BY createdAt ASC`,
    [entityId]
  );

  console.log(`\nActividad de reservation #${entityId} (${rows.length} entradas)\n`);
  if (rows.length === 0) {
    console.log("  (sin filas)");
    await c.end();
    return;
  }
  for (const r of rows) {
    let details = r.details;
    if (typeof details === "string") {
      try { details = JSON.parse(details); } catch {}
    }
    const ts = r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt;
    console.log(`[${ts}]  ${String(r.action).padEnd(22)}  actor=${r.actorName ?? "?"} (id=${r.actorId ?? "?"})`);
    if (details) console.log(`   details: ${JSON.stringify(details)}`);
  }
  await c.end();
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
