import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  for (const t of ["tpv_sales", "tpv_sale_payments", "cash_sessions"]) {
    console.log(`\n── ${t} ──`);
    const [cols]: any = await c.query(`DESCRIBE ${t}`);
    for (const c of cols) console.log(`  ${c.Field} · ${c.Type}`);
  }
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
