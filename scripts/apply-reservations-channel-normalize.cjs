// Aplica la migración 0120_reservations_channel_normalize.
//
// Normaliza el enum `reservations.channel`. La conversión no es trivial
// porque MySQL ENUM compara valores case-insensitive: 'telefono' y
// 'TELEFONO' se consideran duplicados, así que no podemos meter ambos
// en el ENUM al mismo tiempo.
//
// Plan en 3 fases:
//   FASE 1 — preservar info: copiar el valor legacy a channel_detail
//            cuando esté vacío (para no perder la distinción telefono/email
//            tras la conversión a VENTA_DELEGADA).
//   FASE 2 — migrar legacy a moderno EXISTENTE en el enum actual:
//     web      -> ONLINE_DIRECTO
//     crm      -> VENTA_DELEGADA
//     telefono -> VENTA_DELEGADA  (channel_detail preserva 'telefono')
//     email    -> VENTA_DELEGADA  (channel_detail preserva 'email')
//     otro     -> MANUAL
//     tpv      -> TPV_FISICO
//     groupon  -> PARTNER (+ platform_name='Groupon' si null)
//   FASE 3 — reducir el ENUM eliminando los legacy y AÑADIENDO los dos
//            nuevos modernos (TELEFONO, EMAIL) en el mismo ALTER. Como
//            los legacy ya no están, no hay colisión case-insensitive.
//
// Idempotente. Se puede ejecutar varias veces sin efecto.
//
// Run: railway run --service MySQL node scripts/apply-reservations-channel-normalize.cjs

const mysql = require("mysql2/promise");

const DB_URL = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!DB_URL) { console.error("ABORTADO: sin URL MySQL"); process.exit(1); }

const TAG = "0120_reservations_channel_normalize";

const LEGACY_VALUES = ["web","crm","telefono","email","otro","tpv","groupon"];

const ENUM_FINAL = [
  "ONLINE_DIRECTO","ONLINE_ASISTIDO","VENTA_DELEGADA","TELEFONO","EMAIL",
  "TPV_FISICO","PARTNER","TICKETING","MANUAL","API",
];

function buildEnum(values) {
  return values.map(v => `'${v}'`).join(",");
}

async function currentEnumValues(c) {
  const [r] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'channel'`
  );
  if (!r.length) return [];
  const t = r[0].COLUMN_TYPE;
  const m = t.match(/^enum\((.+)\)$/i);
  if (!m) return [];
  return m[1].split(",").map(s => s.replace(/^'|'$/g, ""));
}

async function countByChannel(c, value) {
  const [r] = await c.query("SELECT COUNT(*) AS n FROM reservations WHERE channel = ?", [value]);
  return r[0].n;
}

(async () => {
  console.log("=".repeat(70));
  console.log("MIGRACIÓN 0120 — reservations.channel normalize");
  console.log("=".repeat(70));

  const c = await mysql.createConnection({ uri: DB_URL });

  // ── Estado inicial ─────────────────────────────────────────────────
  const before = await currentEnumValues(c);
  console.log(`\n[Estado inicial] ${before.length} valores en el ENUM`);
  console.log(`  ${before.join(", ")}`);

  // ── FASE 1: preservar info en channel_detail ──────────────────────
  console.log("\n[FASE 1] Preservando info en channel_detail (telefono/email)…");
  const [r1a] = await c.query(
    `UPDATE reservations
        SET channel_detail = 'telefono'
      WHERE channel = 'telefono'
        AND (channel_detail IS NULL OR channel_detail = '')`
  );
  console.log(`  · channel_detail='telefono'  (${r1a.affectedRows} filas)`);
  const [r1b] = await c.query(
    `UPDATE reservations
        SET channel_detail = 'email'
      WHERE channel = 'email'
        AND (channel_detail IS NULL OR channel_detail = '')`
  );
  console.log(`  · channel_detail='email'     (${r1b.affectedRows} filas)`);

  // ── FASE 2: UPDATE legacy → moderno (al enum actual) ──────────────
  console.log("\n[FASE 2] Migrando legacy → moderno");
  const mapping = [
    ["web",      "ONLINE_DIRECTO"],
    ["crm",      "VENTA_DELEGADA"],
    ["telefono", "VENTA_DELEGADA"],  // info preservada en channel_detail
    ["email",    "VENTA_DELEGADA"],  // info preservada en channel_detail
    ["otro",     "MANUAL"],
    ["tpv",      "TPV_FISICO"],
  ];
  let totalUpdated = 0;
  for (const [legacy, modern] of mapping) {
    if (!before.includes(legacy)) {
      console.log(`  · skip ${legacy.padEnd(8)} → ${modern.padEnd(16)} (no en ENUM)`);
      continue;
    }
    const cnt = await countByChannel(c, legacy);
    if (cnt === 0) {
      console.log(`  · skip ${legacy.padEnd(8)} → ${modern.padEnd(16)} (0 filas)`);
      continue;
    }
    const [r] = await c.query("UPDATE reservations SET channel = ? WHERE channel = ?", [modern, legacy]);
    console.log(`  ✓ ${legacy.padEnd(8)} → ${modern.padEnd(16)} (${r.affectedRows} filas)`);
    totalUpdated += r.affectedRows;
  }

  if (before.includes("groupon")) {
    const grouponCount = await countByChannel(c, "groupon");
    if (grouponCount > 0) {
      const [r] = await c.query(
        `UPDATE reservations
            SET channel = 'PARTNER',
                platform_name = COALESCE(platform_name, 'Groupon')
          WHERE channel = 'groupon'`
      );
      console.log(`  ✓ groupon  → PARTNER          (${r.affectedRows} filas, platform_name='Groupon' si null)`);
      totalUpdated += r.affectedRows;
    } else {
      console.log(`  · skip groupon  → PARTNER          (0 filas)`);
    }
  } else {
    console.log(`  · skip groupon  → PARTNER          (no en ENUM)`);
  }

  console.log(`\n  Total normalizadas: ${totalUpdated}`);

  // ── Verificación pre-fase 3: no quedan legacy ─────────────────────
  const [leftovers] = await c.query(
    `SELECT channel, COUNT(*) AS n FROM reservations
      WHERE channel IN (${LEGACY_VALUES.map(() => "?").join(",")})
      GROUP BY channel`,
    LEGACY_VALUES
  );
  if (leftovers.length > 0) {
    console.error("\n[ABORTAR] Aún hay filas con valores legacy:");
    for (const r of leftovers) console.error(`  · ${r.channel}: ${r.n}`);
    await c.end();
    process.exit(2);
  }
  console.log("\n[Verificación pre-FASE 3] ✓ no quedan filas con valores legacy");

  // ── FASE 3: ALTER enum a la forma final (10 valores) ──────────────
  const after = await currentEnumValues(c);
  const isAlreadyFinal = ENUM_FINAL.every(v => after.includes(v))
                      && after.length === ENUM_FINAL.length
                      && !after.some(v => LEGACY_VALUES.includes(v));
  if (isAlreadyFinal) {
    console.log("\n[FASE 3] · skip (ENUM ya está en su forma final)");
  } else {
    console.log("\n[FASE 3] Reduciendo ENUM a taxonomía limpia (10 valores)…");
    console.log(`  Objetivo: ${ENUM_FINAL.join(", ")}`);
    await c.query(
      `ALTER TABLE \`reservations\` MODIFY COLUMN \`channel\`
       ENUM(${buildEnum(ENUM_FINAL)}) DEFAULT 'ONLINE_DIRECTO'`
    );
    console.log("  ✓ ENUM actualizado");
  }

  // ── Distribución final ────────────────────────────────────────────
  console.log("\n[Distribución final]");
  const [dist] = await c.query(
    "SELECT channel, COUNT(*) AS n FROM reservations GROUP BY channel ORDER BY n DESC"
  );
  for (const r of dist) console.log(`  ${String(r.n).padStart(5)}  ${r.channel}`);

  // ── Tracking ──────────────────────────────────────────────────────
  console.log("\n[TRACKING] __drizzle_migrations");
  const [exists] = await c.query(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?`, [TAG]);
  if (exists[0].n > 0) {
    console.log(`  · skip ${TAG} (ya registrada)`);
  } else {
    await c.execute(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [TAG, Date.now()]);
    console.log(`  ✓ INSERT ${TAG}`);
  }

  await c.end();
  console.log("=".repeat(70));
  console.log("FIN — migración 0120 aplicada");
  console.log("=".repeat(70));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
