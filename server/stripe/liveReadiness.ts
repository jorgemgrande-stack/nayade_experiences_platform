/**
 * Comprobaciones de ARRANQUE del modo live sobre la BD del CRM (solo lectura). Las usa
 * `server/controlPlane/main.ts`; aquí se pueden probar contra MySQL real.
 *
 *  - `liveSchemaProblem`: la migración 0013 está entera en la BD (las seis restricciones `chk_*_livemode` y
 *    `commercial_payments.mode` con 'live') y, si existe el registro del ejecutor, consta como aplicada y no
 *    hay ninguna migración a medias.
 *  - `liveOrdersProblem`: la BD no trae datos del entorno de pruebas (pagos de prueba cobrados en pedidos
 *    vivos, o un prefijo de entorno guardado distinto del configurado). Entonces no se montan pedidos ni
 *    pagos aunque Stripe no se monte.
 *
 * Devuelven un motivo corto para el log (sin datos personales) o null.
 */
import type mysql from "mysql2/promise";

type Q = Pick<mysql.Pool, "query">;
type Row = mysql.RowDataPacket & Record<string, unknown>;

export const LIVE_CHECK_CONSTRAINTS = [
  "chk_stripe_adj_livemode",
  "chk_stripe_checkout_livemode",
  "chk_stripe_customer_livemode",
  "chk_stripe_event_livemode",
  "chk_stripe_price_livemode",
  "chk_stripe_sub_livemode",
] as const;
const MIGRATION_0013 = "0013_stripe_livemode";
const LEDGER = "__elephant_migrations";
const LEDGER_META = "__elephant_migrations_meta";
const TERMINAL = ["cancelled", "superseded", "rejected"];

const rows = async (pool: Q, sql: string, params: unknown[] = []) => ((await pool.query<Row[]>(sql, params))[0] ?? []) as Row[];

export async function liveSchemaProblem(pool: Q): Promise<string | null> {
  const checks = await rows(pool, "SELECT constraint_name AS c FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name IN (?)", [[...LIVE_CHECK_CONSTRAINTS]]);
  const found = new Set(checks.map((r) => String(r.c)));
  if (LIVE_CHECK_CONSTRAINTS.some((c) => !found.has(c))) return "migration_0013_missing";
  const col = await rows(pool, "SELECT column_type AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'commercial_payments' AND column_name = 'mode'");
  if (!col[0] || !/'live'/.test(String(col[0].t))) return "migration_0013_missing";
  // Registro del ejecutor de migraciones (si existe: en producción siempre)
  const tables = new Set((await rows(pool, "SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?)", [LEDGER, LEDGER_META])).map((r) => String(r.n)));
  if (tables.has(LEDGER_META) && (await rows(pool, `SELECT 1 FROM \`${LEDGER_META}\` WHERE k = 'in_progress'`)).length) return "migration_in_progress";
  if (tables.has(LEDGER) && !(await rows(pool, `SELECT 1 FROM \`${LEDGER}\` WHERE id = ?`, [MIGRATION_0013])).length) return "migration_0013_not_recorded";
  return null;
}

export async function liveOrdersProblem(pool: Q, namespace: string): Promise<string | null> {
  const testPaid = await rows(
    pool,
    `SELECT 1 FROM commercial_payments p JOIN commercial_orders o ON o.id = p.order_id
      WHERE p.mode = 'test' AND p.status = 'succeeded' AND o.state NOT IN (?) LIMIT 1`,
    [TERMINAL],
  );
  if (testPaid.length) return "test_payments_in_live";
  // Sin la tabla de Stripe (0012 sin aplicar) no hay prefijo guardado que comparar
  const saved = await rows(pool, "SELECT value_json AS v FROM stripe_sync_state WHERE name = 'namespace'").catch(() => [] as Row[]);
  if (saved[0]) {
    const v = typeof saved[0].v === "string" ? JSON.parse(saved[0].v) : saved[0].v;
    if ((v as { namespace?: unknown })?.namespace !== namespace) return "namespace_mismatch";
  }
  return null;
}
