import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const id = Number(process.argv[2]);
  if (!id) { console.error("Uso: npx tsx scripts/who-is-user.ts <userId>"); process.exit(1); }
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
  const [r]: any = await c.query("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  if (r.length === 0) console.log("Sin usuario con id", id);
  else {
    const u = r[0];
    console.log(`#${u.id}  ${u.name ?? u.fullName ?? "?"}  email=${u.email ?? "?"}  role=${u.role ?? "?"}  lastLogin=${u.lastLogin ?? u.lastLoginAt ?? "?"}`);
  }
  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
