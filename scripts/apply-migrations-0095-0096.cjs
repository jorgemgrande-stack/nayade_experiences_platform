// scripts/apply-migrations-0095-0096.cjs
//
// Aplica manualmente las migraciones 0095 y 0096 en producción. Estas
// migraciones existen en drizzle/*.sql desde mayo 2026 pero nunca llegaron
// al _journal.json, así que drizzle-kit migrate jamás las ejecutó. El
// servidor ya asume el estado post-0096 (consulta quote_internal_notes),
// por lo que el panel de Historial de Atención Comercial está roto.
//
// La 0095 son 3 UPDATEs idempotentes.
// La 0096 son DDL (ALTER + CREATE TABLE + CREATE INDEX) — no transaccional.
//
// Verificación previa antes de cada DDL para que el script sea idempotente.
//
// Run with: railway run --service MySQL node scripts/apply-migrations-0095-0096.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

function hr() { console.log("=".repeat(70)); }

(async () => {
  hr();
  console.log("APLICANDO MIGRACIONES 0095 + 0096");
  hr();

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── 0095: 3 UPDATEs ────────────────────────────────────────────────────────
  console.log("\n[0095] Fase 1 — UPDATEs de saneamiento");
  await c.beginTransaction();
  try {
    const [r1] = await c.execute(
      `UPDATE feature_flags SET enabled = 0 WHERE \`key\` = 'quote_reminder_job_enabled'`
    );
    console.log(`  ✓ feature_flags quote_reminder_job_enabled: ${r1.affectedRows} fila(s)`);

    const [r2] = await c.execute(
      `UPDATE quote_commercial_tracking
       SET reminderCount = 2, lastReminderAt = '2026-05-17 19:32:43',
           commercialStatus = 'reminder_2_sent', updatedAt = NOW()
       WHERE quoteId = 89`
    );
    console.log(`  ✓ quote_commercial_tracking quoteId=89: ${r2.affectedRows} fila(s)`);

    const [r3] = await c.execute(
      `UPDATE quotes
       SET reminderCount = 2, lastReminderAt = '2026-05-17 19:32:43', updatedAt = NOW()
       WHERE id = 89`
    );
    console.log(`  ✓ quotes id=89: ${r3.affectedRows} fila(s)`);

    await c.commit();
    console.log("  ✓ COMMIT 0095");
  } catch (e) {
    await c.rollback();
    console.error("  ✗ ROLLBACK 0095:", e.message);
    await c.end();
    process.exit(1);
  }

  // ── 0096: DDL ──────────────────────────────────────────────────────────────
  console.log("\n[0096] Fase 2 — DDL");

  // 0096.1: ADD COLUMN respectCommercialPause si no existe
  const [colCheck] = await c.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_automation_rules'
       AND COLUMN_NAME = 'respectCommercialPause'`
  );
  if (colCheck[0].c === 0) {
    await c.query(
      `ALTER TABLE email_automation_rules
       ADD COLUMN respectCommercialPause boolean NOT NULL DEFAULT false`
    );
    console.log("  ✓ ALTER TABLE email_automation_rules ADD COLUMN respectCommercialPause");
  } else {
    console.log("  · email_automation_rules.respectCommercialPause ya existe — skip");
  }

  // 0096.2: CREATE TABLE quote_internal_notes si no existe
  const [tblCheck] = await c.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_internal_notes'`
  );
  if (tblCheck[0].c === 0) {
    await c.query(`
      CREATE TABLE quote_internal_notes (
        id int AUTO_INCREMENT NOT NULL,
        quoteId int NOT NULL,
        channel enum('email','phone','whatsapp','internal') NOT NULL DEFAULT 'internal',
        body text NOT NULL,
        authorUserId int,
        createdAt timestamp NOT NULL DEFAULT (NOW()),
        CONSTRAINT quote_internal_notes_id PRIMARY KEY(id)
      )
    `);
    console.log("  ✓ CREATE TABLE quote_internal_notes");
  } else {
    console.log("  · quote_internal_notes ya existe — skip");
  }

  // 0096.3: CREATE INDEX si no existe
  const [idxCheck] = await c.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_internal_notes'
       AND INDEX_NAME = 'idx_quote_internal_notes_quoteId'`
  );
  if (idxCheck[0].c === 0) {
    await c.query(
      `CREATE INDEX idx_quote_internal_notes_quoteId ON quote_internal_notes (quoteId)`
    );
    console.log("  ✓ CREATE INDEX idx_quote_internal_notes_quoteId");
  } else {
    console.log("  · idx_quote_internal_notes_quoteId ya existe — skip");
  }

  // ── Verificación ───────────────────────────────────────────────────────────
  console.log("\n[POST] Verificando…");
  const [v1] = await c.query(
    `SELECT enabled FROM feature_flags WHERE \`key\` = 'quote_reminder_job_enabled'`
  );
  console.log("  quote_reminder_job_enabled:", v1[0]?.enabled ?? "(no existe)");

  const [v2] = await c.query(
    `SELECT id, reminderCount, lastReminderAt FROM quote_commercial_tracking WHERE quoteId = 89`
  );
  console.log("  quote_commercial_tracking quoteId=89:", v2[0] || "(no encontrado)");

  const [v3] = await c.query(
    `DESCRIBE quote_internal_notes`
  );
  console.log("  quote_internal_notes columnas:", v3.map(r => r.Field).join(", "));

  const [v4] = await c.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_automation_rules'
       AND COLUMN_NAME = 'respectCommercialPause'`
  );
  console.log("  email_automation_rules.respectCommercialPause existe:", v4[0].c === 1);

  await c.end();
  hr();
  console.log("FIN — 0095 y 0096 aplicadas");
  hr();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
