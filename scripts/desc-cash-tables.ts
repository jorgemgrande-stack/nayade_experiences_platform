import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  for (const t of ["cash_movements", "fin_cash_movements", "fin_cash_accounts"]) {
    console.log(`\n── ${t} ──`);
    try {
      const [r]: any = await c.query(`DESCRIBE ${t}`);
      for (const c of r) console.log(`  ${c.Field} · ${c.Type}`);
    } catch (e: any) {
      console.log(`  ✗ ${e.code}: ${e.message}`);
    }
  }
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
