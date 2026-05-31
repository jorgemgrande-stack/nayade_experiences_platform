// Audita cómo el dashboard cuenta "leads sin contactar +3 días" vs cómo
// los presenta el CRM. La tabla `leads` tiene DOS sistemas de estado
// conviviendo: `status` (legacy: nuevo/contactado/en_proceso/convertido/
// perdido) y `opportunityStatus` (CRM: nueva/enviada/ganada/perdida).
// El dashboard usa el legacy; el CRM usa el nuevo.

import "dotenv/config";
const PUBLIC_DB = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });

  const fmtCount = (n: number) => String(n).padStart(4);

  console.log("\n── TOTAL leads en BD ──");
  const [[total]]: any = await c.query("SELECT COUNT(*) AS n FROM leads");
  console.log(`  ${total.n}`);

  console.log("\n── distribución por status (legacy) ──");
  const [byStatus]: any = await c.query(
    "SELECT status, COUNT(*) AS n FROM leads GROUP BY status ORDER BY n DESC"
  );
  for (const r of byStatus) console.log(`  ${fmtCount(r.n)}  status=${r.status}`);

  console.log("\n── distribución por opportunityStatus (CRM) ──");
  const [byOpp]: any = await c.query(
    "SELECT opportunityStatus, COUNT(*) AS n FROM leads GROUP BY opportunityStatus ORDER BY n DESC"
  );
  for (const r of byOpp) console.log(`  ${fmtCount(r.n)}  opportunityStatus=${r.opportunityStatus}`);

  console.log("\n── cruce status × opportunityStatus ──");
  const [cross]: any = await c.query(
    "SELECT status, opportunityStatus, COUNT(*) AS n FROM leads GROUP BY status, opportunityStatus ORDER BY n DESC"
  );
  for (const r of cross) console.log(`  ${fmtCount(r.n)}  status='${r.status}' × opp='${r.opportunityStatus}'`);

  console.log("\n── lastContactAt (legacy) ──");
  const [[withContact]]: any = await c.query("SELECT COUNT(*) AS n FROM leads WHERE lastContactAt IS NOT NULL");
  const [[neverContacted]]: any = await c.query("SELECT COUNT(*) AS n FROM leads WHERE lastContactAt IS NULL");
  console.log(`  con lastContactAt:  ${withContact.n}`);
  console.log(`  sin lastContactAt:  ${neverContacted.n}`);

  // QUERY EXACTA DEL DASHBOARD (db.ts:1898-1900)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 19).replace("T", " ");
  console.log(`\n── QUERY del dashboard "leads sin contactar +3 días" ──`);
  console.log(`  WHERE status NOT IN ('convertido','perdido')`);
  console.log(`    AND (lastContactAt IS NULL OR lastContactAt < '${threeDaysAgoStr}')`);
  const [[dashCount]]: any = await c.query(
    "SELECT COUNT(*) AS n FROM leads WHERE status NOT IN ('convertido','perdido') AND (lastContactAt IS NULL OR lastContactAt < ?)",
    [threeDaysAgo]
  );
  console.log(`  → ${dashCount.n} leads cumplen este criterio (lo que muestra el dashboard)`);

  // Cuántos de esos 40 tienen opportunityStatus = ganada / perdida (deberían estar excluidos en realidad)
  console.log("\n── desglose de esos N leads por opportunityStatus ──");
  const [agingByOpp]: any = await c.query(
    `SELECT opportunityStatus, COUNT(*) AS n FROM leads
     WHERE status NOT IN ('convertido','perdido')
       AND (lastContactAt IS NULL OR lastContactAt < ?)
     GROUP BY opportunityStatus ORDER BY n DESC`,
    [threeDaysAgo]
  );
  for (const r of agingByOpp) console.log(`  ${fmtCount(r.n)}  opportunityStatus=${r.opportunityStatus}`);

  // Si filtramos también por opportunityStatus (criterio que SÍ usa el CRM)
  const [[dashCountIfNew]]: any = await c.query(
    `SELECT COUNT(*) AS n FROM leads
     WHERE status NOT IN ('convertido','perdido')
       AND opportunityStatus NOT IN ('ganada','perdida')
       AND (lastContactAt IS NULL OR lastContactAt < ?)`,
    [threeDaysAgo]
  );
  console.log(`\n  Si EXCLUIMOS opportunityStatus IN ('ganada','perdida'):`);
  console.log(`  → ${dashCountIfNew.n} leads cumplen (lo que DEBERÍA contar el dashboard)`);

  // ¿Cuántos leads están "vivos" según el CRM y serían visibles al admin sin filtro?
  console.log(`\n── el CRM muestra TODOS los leads sin filtro por defecto ──`);
  const [[crmDefault]]: any = await c.query("SELECT COUNT(*) AS n FROM leads");
  console.log(`  → ${crmDefault.n} leads en total (con paginación de 50/página)`);

  // Filtrando "nueva" (lo que probablemente el admin entiende por "sin atender")
  const [[crmNueva]]: any = await c.query(
    "SELECT COUNT(*) AS n FROM leads WHERE opportunityStatus = 'nueva'"
  );
  console.log(`  → ${crmNueva.n} leads con opportunityStatus='nueva'`);

  await c.end();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
