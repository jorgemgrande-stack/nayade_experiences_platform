import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  const [r]: any = await c.query("DESCRIBE experiences");
  for (const col of r) console.log(col.Field, "·", col.Type);
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
