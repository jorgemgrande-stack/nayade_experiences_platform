import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;
async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  const [maxc]: any = await c.query("SHOW VARIABLES LIKE 'max_connections'");
  const [cur]: any = await c.query("SHOW STATUS LIKE 'Threads_connected'");
  const [list]: any = await c.query("SHOW PROCESSLIST");
  console.log("max_connections:", maxc[0]?.Value);
  console.log("Threads_connected:", cur[0]?.Value);
  console.log("Process list (" + list.length + "):");
  for (const p of list.slice(0, 30)) {
    console.log(`  #${p.Id} user=${p.User} host=${p.Host} db=${p.db} cmd=${p.Command} time=${p.Time}s state=${p.State ?? "-"}`);
  }
  await c.end();
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
