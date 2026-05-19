// scripts/sync-drizzle-tracking.cjs
//
// PASO A del saneamiento de migraciones aprobado por el usuario.
// Registra en __drizzle_migrations las 18 migraciones que están aplicadas
// en producción pero nunca se registraron. Idempotente: skip si ya existe.
//
// EXCLUYE 0098_phase5_drop_legacy_commercial (no aplicada, destructiva).
//
// Run with: railway run --service MySQL node scripts/sync-drizzle-tracking.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

// Timestamps (ms). Para las que existen en _journal.json, mantenemos su 'when'
// para coherencia. Para las que no, usamos Date.now() con offset de 1s entre cada una.
const baseNow = Date.now();
let offset = 0;
const nextTs = () => baseNow + (++offset * 1000);

const TARGETS = [
  { tag: "0082_commercial_followup",                     ts: nextTs() },
  { tag: "0083_add_meta_capi_fields_to_reservations",    ts: 1778624703215 },
  { tag: "0083_ghl_inbox",                               ts: nextTs() },
  { tag: "0084_vapi_calls",                              ts: nextTs() },
  { tag: "0085_ghl_contact_id_coupons_cancellations",    ts: 1746700800000 },
  { tag: "0086_email_comm_system",                       ts: 1746787200000 },
  { tag: "0087_commercial_emails_attachments_meta",      ts: nextTs() },
  { tag: "0088_partners_module",                         ts: nextTs() },
  { tag: "0089_lead_sources",                            ts: 1746873600000 },
  { tag: "0090_cms_home_init",                           ts: 1747180800000 },
  { tag: "0091_invoice_exempt_flag",                     ts: 1747353600000 },
  { tag: "0092_tpv_manual_items",                        ts: 1747440000000 },
  { tag: "0093_tpv_concept_text_fix",                    ts: 1747443600000 },
  { tag: "0094_reservation_public_token",                ts: 1747526400000 },
  { tag: "0095_phase1_consolidation_fixes",              ts: nextTs() },
  { tag: "0096_phase2_email_automation_commercial",      ts: nextTs() },
  { tag: "0097_phase3_switchover",                       ts: nextTs() },
  { tag: "0099_fix_tpv_operations_duplicates",           ts: nextTs() },
  // 0098 EXCLUIDA por decisión del usuario (destructiva, no aplicada).
];

function hr() { console.log("=".repeat(70)); }

(async () => {
  hr();
  console.log("PASO A — Registrar migraciones en __drizzle_migrations");
  hr();

  const c = await mysql.createConnection({ uri: DB_URL });

  const [pre] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations`);
  console.log(`\n[PRE] Filas en __drizzle_migrations: ${pre[0].n}`);

  const [existing] = await c.query(`SELECT hash FROM __drizzle_migrations`);
  const existingSet = new Set(existing.map(r => r.hash));

  let inserted = 0;
  let skipped = 0;

  await c.beginTransaction();
  try {
    for (const t of TARGETS) {
      if (existingSet.has(t.tag)) {
        console.log(`  · SKIP  ${t.tag} (ya registrada)`);
        skipped++;
        continue;
      }
      await c.execute(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        [t.tag, t.ts]
      );
      console.log(`  ✓ INSERT ${t.tag}  (ts=${t.ts})`);
      inserted++;
    }
    await c.commit();
    console.log("\n✓ COMMIT");
  } catch (e) {
    await c.rollback();
    console.error("\n✗ ROLLBACK:", e.message);
    await c.end();
    process.exit(1);
  }

  const [post] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations`);
  console.log(`\n[POST] Filas en __drizzle_migrations: ${post[0].n}`);
  console.log(`Insertadas: ${inserted}   Saltadas (ya existían): ${skipped}`);

  console.log("\n[Tags registrados ahora — últimos 25 ordenados por id]:");
  const [tail] = await c.query(
    `SELECT id, hash FROM __drizzle_migrations ORDER BY id DESC LIMIT 25`
  );
  console.table(tail);

  await c.end();
  hr();
  console.log("FIN PASO A");
  hr();
})().catch(e => { console.error("ERR", e); process.exit(1); });
