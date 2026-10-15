/**
 * Plan de esquema de Náyade — EXCLUSIVAMENTE LECTURA, autocontenido.
 *
 * Pensado para ejecutarse dentro del contenedor de producción ANTES de desplegar #79 (que es quien
 * trae `--schema-maintenance`), con la misma lógica de comprobación (`schemaCheck.ts`):
 *
 *   pnpm exec esbuild scripts/schema-plan-readonly.ts --bundle --platform=node --format=esm \
 *     --outfile=dist-tools/schema-plan-readonly.mjs \
 *     --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
 *   (en el contenedor, desde el directorio de la app)  node --input-type=module  < schema-plan-readonly.mjs
 *
 * Garantías:
 *  1. Toda consulta pasa por una guarda que SOLO admite SELECT y SHOW (y el inicio/fin de una
 *     transacción de solo lectura). Cualquier otra sentencia aborta el proceso antes de enviarse.
 *  2. Sesión y transacción de solo lectura (`SET SESSION TRANSACTION READ ONLY` y `START TRANSACTION
 *     READ ONLY`): el propio servidor rechaza escrituras, y se comprueba antes de seguir. Al final, ROLLBACK.
 *  3. Usa DATABASE_URL del entorno y NUNCA la imprime (ni usuario, ni contraseña, ni host de la URL).
 *     Solo imprime metadatos de estructura: nombres de BD, tablas, columnas, triggers y migraciones.
 */
import mysql from "mysql2/promise";
import { checkAppSchema, describeSchemaReport } from "../server/_core/schemaCheck";

const ALLOWED = /^\s*(SELECT|SHOW)\b/i;
const TX = /^\s*(SET SESSION TRANSACTION READ ONLY|START TRANSACTION READ ONLY|ROLLBACK)\s*$/i;

/** Envuelve una conexión para que no pueda enviar nada que no sea lectura. */
export function readOnlyGuard<C extends { query: (...a: any[]) => any }>(conn: C, log: string[] = []): C {
  return new Proxy(conn, {
    get(target, prop, recv) {
      if (prop === "execute") return () => Promise.reject(new Error("Guarda de solo lectura: execute() no está permitido"));
      if (prop !== "query") return Reflect.get(target, prop, recv);
      return (sql: unknown, ...rest: unknown[]) => {
        const text = typeof sql === "string" ? sql : (sql as { sql?: string })?.sql ?? "";
        if (!ALLOWED.test(text) && !TX.test(text)) {
          return Promise.reject(new Error(`Guarda de solo lectura: sentencia bloqueada (${text.trim().split(/\s+/)[0] ?? "?"})`));
        }
        log.push(text.trim().split(/\s+/).slice(0, 2).join(" "));
        return target.query(sql, ...rest);
      };
    },
  });
}

/** Objetos que creaba el DDL del arranque o bajo demanda (presencia en la BD real). */
const EXTRA_TABLES = [
  "document_counters", "document_number_logs", "email_accounts", "commercial_emails",
  "ghl_conversations", "ghl_messages", "ghl_webhook_events", "vapi_calls", "proposals", "proposal_options",
  "crm_lead_sources", "partners", "__elephant_migrations",
];
const EXTRA_COLUMNS = [
  ["reservations", "invoice_exempt"], ["reservations", "public_token"], ["reservations", "delegation_proof_url"],
  ["commercial_emails", "attachments_meta"], ["invoices", "taxBreakdown"],
];

export async function runPlan(conn: { query: (...a: any[]) => any }, out: (l: string) => void = console.log) {
  const q = async (sql: string, args?: unknown[]) => ((await conn.query(sql, args)) as [any[], unknown])[0];
  // Sesión y transacción de solo lectura: el servidor rechaza cualquier escritura.
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await conn.query("START TRANSACTION READ ONLY");
  try {
    const [who] = await q("SELECT DATABASE() AS db, @@hostname AS host, VERSION() AS v, @@transaction_read_only AS ro");
    out(`[Plan] BD «${who.db}» en ${who.host} · MySQL ${who.v} · transacción de solo lectura: ${Number(who.ro) === 1 ? "sí" : "NO"}`);
    if (Number(who.ro) !== 1) throw new Error("La transacción no es de solo lectura: se aborta.");

    const report = await checkAppSchema(conn as any);
    for (const l of describeSchemaReport(report)) out(l);

    const [ledger] = report.ledgerMissing
      ? [{ n: 0, m: null }]
      : await q("SELECT COUNT(*) AS n, MAX(created_at) AS m FROM `__drizzle_migrations`");
    out(`[Plan] __drizzle_migrations: ${ledger.n} filas · último created_at ${ledger.m ?? "—"}`);

    const triggers = await q(
      "SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS t, ACTION_TIMING AS timing, EVENT_MANIPULATION AS ev FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY 1",
    );
    out(`[Plan] Triggers (${triggers.length}): ${triggers.map((r: any) => `${r.name} (${r.timing} ${r.ev} ${r.t})`).join(", ") || "ninguno"}`);

    const tables = new Set((await q("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")).map((r: any) => String(r.n)));
    out(`[Plan] Tablas totales: ${tables.size}`);
    out(`[Plan] Tablas que creaba el DDL de arranque o bajo demanda: ${EXTRA_TABLES.map((t) => `${t}=${tables.has(t) ? "sí" : "NO"}`).join(", ")}`);
    const cols = await q(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('reservations','commercial_emails','invoices')",
    );
    const has = new Set(cols.map((r: any) => `${r.t}.${r.c}`));
    out(`[Plan] Columnas que creaba el DDL de arranque o bajo demanda: ${EXTRA_COLUMNS.map(([t, c]) => `${t}.${c}=${has.has(`${t}.${c}`) ? "sí" : "NO"}`).join(", ")}`);
    return report;
  } finally {
    await conn.query("ROLLBACK");
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[Plan] Falta DATABASE_URL.");
    process.exit(2);
  }
  const raw = await mysql.createConnection(url);
  const sent: string[] = [];
  try {
    await runPlan(readOnlyGuard(raw, sent));
    console.log(`[Plan] Sentencias enviadas (${sent.length}): ${Array.from(new Set(sent)).join(" · ")}`);
    console.log("[Plan] ✓ Terminado sin escrituras.");
  } finally {
    await raw.end().catch(() => undefined);
  }
}

const isMain = typeof process !== "undefined" && !process.env.VITEST;
if (isMain) {
  main().catch((e) => {
    // Solo el código (p. ej. ER_ACCESS_DENIED_ERROR): los mensajes de conexión pueden incluir el usuario.
    const err = e as { code?: string; message?: string };
    console.error("[Plan] ✗", err?.code ?? (err?.message?.startsWith("Guarda de solo lectura") || err?.message?.startsWith("La transacción") ? err.message : "error"));
    process.exit(1);
  });
}
