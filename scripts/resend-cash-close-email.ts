// Re-envía el email de cierre de caja de una sesión TPV ya cerrada.
//
// Útil para:
//   · Validar visualmente cambios en la plantilla (cambia el `--to`).
//   · Repetir el envío si el original falló (SMTP caído, destinatario erróneo, etc.).
//
// Uso (los hosts internos `*.railway.internal` no resuelven fuera de la VPC,
// así que hay que inyectar la URL pública antes de invocar):
//
//   $env:MYSQL_PUBLIC_URL = "mysql://..."   # obtenida con
//                                           # railway run --service MySQL node -e "console.log(process.env.MYSQL_PUBLIC_URL)"
//   railway run npx tsx scripts/resend-cash-close-email.ts --to a@b.com
//
// El subject lleva el prefijo "[REENVÍO] " para distinguir del envío automático.

import "dotenv/config";

// Priorizar host PÚBLICO de Railway cuando se ejecuta desde fuera del runtime
// (mysql.railway.internal solo resuelve dentro de la VPC). Se hace ANTES de
// cualquier import dinámico que pueda abrir un pool con `process.env.DATABASE_URL`.
const PUBLIC_DB =
  process.env.MYSQL_PUBLIC_URL ||
  process.env.MYSQL_URL ||
  process.env.DATABASE_PUBLIC_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

function parseArgs(argv: string[]): { sessionId?: number; to?: string } {
  const out: { sessionId?: number; to?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session" || a === "--sessionId") out.sessionId = Number(argv[++i]);
    else if (a === "--to") out.to = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error("ABORTADO: falta DATABASE_URL en el entorno.");
    process.exit(1);
  }
  if (process.env.DATABASE_URL.includes(".railway.internal")) {
    console.error("ABORTADO: DATABASE_URL apunta al host INTERNO de Railway, que no resuelve fuera de la VPC.");
    console.error("        Define MYSQL_PUBLIC_URL antes de ejecutar (ver cabecera del script).");
    process.exit(1);
  }

  // Imports dinámicos: se cargan DESPUÉS de sobrescribir DATABASE_URL, así
  // los pools internos de los módulos (tpv.ts, gestoriaTax.ts, etc.) usan
  // la URL pública.
  const { drizzle } = await import("drizzle-orm/mysql2");
  const mysql = (await import("mysql2/promise")).default;
  const { eq, desc, isNotNull, and } = await import("drizzle-orm");
  const { cashSessions } = await import("../drizzle/schema");
  const { sendCashCloseEmailForSession } = await import("../server/routers/tpv");

  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);

  let sessionId = args.sessionId;
  if (!sessionId) {
    const [last] = await db
      .select({ id: cashSessions.id, closedAt: cashSessions.closedAt })
      .from(cashSessions)
      .where(and(eq(cashSessions.status, "closed"), isNotNull(cashSessions.closedAt)))
      .orderBy(desc(cashSessions.closedAt))
      .limit(1);
    if (!last) {
      console.error("No hay ninguna sesión TPV cerrada en la BD.");
      await pool.end();
      process.exit(1);
    }
    sessionId = last.id;
    console.log(`Última sesión cerrada detectada: #${sessionId}`);
  }

  console.log("=".repeat(70));
  console.log(`REENVÍO email cierre de caja · sesión #${sessionId}`);
  if (args.to) console.log(`→ destinatario forzado: ${args.to}`);
  console.log("=".repeat(70));

  try {
    const { to, subject } = await sendCashCloseEmailForSession(sessionId, {
      toOverride: args.to,
      subjectPrefix: "[REENVÍO] ",
    });
    console.log(`✓ Email enviado a: ${to}`);
    console.log(`  Subject: ${subject}`);
  } catch (e) {
    console.error("✗ Error enviando email:", e);
    await pool.end();
    process.exit(1);
  }

  await pool.end();
  console.log("=".repeat(70));
  console.log("FIN");
  console.log("=".repeat(70));
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
