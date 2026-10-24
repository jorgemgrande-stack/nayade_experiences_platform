/**
 * Estado real de las integraciones de la empresa en curso (tablas de 0015_integration_health): última comprobación,
 * última sincronización, último error e historial de incidencias. Nunca guarda ni devuelve secretos: solo el resultado,
 * un mensaje genérico y el autor.
 *
 * Estados (`connection`):
 *  - `connected`: la última comprobación o sincronización fue correcta;
 *  - `disconnected`: el proveedor rechazó las credenciales;
 *  - `error`: no se pudo completar (red, respuesta inesperada, configuración inválida);
 *  - `not_checked`: nunca se ha comprobado ni sincronizado.
 * Tener credenciales guardadas NO cuenta como conectado.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../dbRegistry";

export type CheckOutcome = "connected" | "rejected" | "error";
export type Connection = "connected" | "disconnected" | "error" | "not_checked";

export interface IntegrationHealth {
  provider: string;
  connection: Connection;
  /** Instante del dato que decide el estado (comprobación o sincronización más reciente). */
  stateAt: string | null;
  lastCheck: { at: string; outcome: CheckOutcome; message: string; by: string | null } | null;
  lastSync: { at: string; ok: boolean; message: string } | null;
  lastOkSyncAt: string | null;
  lastError: { at: string; message: string } | null;
  incidents: Array<{ at: string; kind: string; outcome: string; message: string; actor: string | null }>;
}

const MSG_MAX = 300;
const clip = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, MSG_MAX);
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

/** Estado a partir de lo último ocurrido: la comprobación o la sincronización más reciente manda. */
export function connectionOf(lastCheck: IntegrationHealth["lastCheck"], lastSync: IntegrationHealth["lastSync"]): { connection: Connection; at: string | null } {
  const c = lastCheck ? Date.parse(lastCheck.at) : -1;
  const s = lastSync ? Date.parse(lastSync.at) : -1;
  if (c < 0 && s < 0) return { connection: "not_checked", at: null };
  if (c >= s && lastCheck) return { connection: lastCheck.outcome === "connected" ? "connected" : lastCheck.outcome === "rejected" ? "disconnected" : "error", at: lastCheck.at };
  return { connection: lastSync!.ok ? "connected" : "error", at: lastSync!.at };
}

type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
async function db(): Promise<Db | null> {
  return getTenantDatabase().catch(() => null);
}
/** Sin la tabla (empresa aún sin 0015) no se rompe nada: se ignora. */
const tolerant = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(String((e as { code?: string; message?: string }).code ?? "") + String((e as Error).message))) return fallback;
    throw e;
  }
};

/** Registra una comprobación (manual o del operador): estado actual + entrada en el historial. */
export async function recordCheck(provider: string, outcome: CheckOutcome, message: string, actor: string): Promise<void> {
  const d = await db();
  if (!d) return;
  const m = clip(message);
  const a = actor.slice(0, 100);
  await tolerant(async () => {
    await d.execute(sql`INSERT INTO integration_status (provider, last_check_at, last_check_outcome, last_check_message, last_check_by${outcome === "connected" ? sql`` : sql`, last_error_at, last_error_message`})
      VALUES (${provider}, CURRENT_TIMESTAMP(3), ${outcome}, ${m}, ${a}${outcome === "connected" ? sql`` : sql`, CURRENT_TIMESTAMP(3), ${m}`})
      ON DUPLICATE KEY UPDATE last_check_at = VALUES(last_check_at), last_check_outcome = VALUES(last_check_outcome), last_check_message = VALUES(last_check_message), last_check_by = VALUES(last_check_by)${outcome === "connected" ? sql`` : sql`, last_error_at = VALUES(last_error_at), last_error_message = VALUES(last_error_message)`}`);
    await d.execute(sql`INSERT INTO integration_events (provider, kind, outcome, message, actor) VALUES (${provider}, 'check', ${outcome}, ${m}, ${a})`);
  }, undefined);
}

/**
 * Registra el final de una sincronización real (p. ej. la lectura del buzón cada 5 minutos). El estado se actualiza
 * siempre; al historial solo va un CAMBIO (correcta → error o error → correcta), no cada pasada.
 */
export async function recordSync(provider: string, ok: boolean, message: string): Promise<void> {
  const d = await db();
  if (!d) return;
  const m = clip(message);
  await tolerant(async () => {
    const [rows] = (await d.execute(sql`SELECT last_sync_outcome FROM integration_status WHERE provider = ${provider}`)) as unknown as [Array<{ last_sync_outcome: string | null }>];
    const prev = rows[0]?.last_sync_outcome ?? null;
    const now = ok ? "ok" : "error";
    await d.execute(sql`INSERT INTO integration_status (provider, last_sync_at, last_sync_outcome, last_sync_message${ok ? sql`, last_ok_sync_at` : sql`, last_error_at, last_error_message`})
      VALUES (${provider}, CURRENT_TIMESTAMP(3), ${now}, ${m}, CURRENT_TIMESTAMP(3)${ok ? sql`` : sql`, ${m}`})
      ON DUPLICATE KEY UPDATE last_sync_at = VALUES(last_sync_at), last_sync_outcome = VALUES(last_sync_outcome), last_sync_message = VALUES(last_sync_message)${ok ? sql`, last_ok_sync_at = VALUES(last_ok_sync_at)` : sql`, last_error_at = VALUES(last_error_at), last_error_message = VALUES(last_error_message)`}`);
    if (prev !== now && !(prev === null && ok)) {
      await d.execute(sql`INSERT INTO integration_events (provider, kind, outcome, message, actor) VALUES (${provider}, 'sync', ${now}, ${m}, ${"sistema"})`);
    }
  }, undefined);
}

/** Estado de todos los proveedores con datos, con sus últimas incidencias (90 días, máximo 10 por proveedor). */
export async function integrationHealth(): Promise<{ available: boolean; providers: IntegrationHealth[] }> {
  const d = await db();
  if (!d) return { available: false, providers: [] };
  return tolerant<{ available: boolean; providers: IntegrationHealth[] }>(
    async () => {
      const [st] = (await d.execute(sql`SELECT * FROM integration_status`)) as unknown as [Array<Record<string, unknown>>];
      const [ev] = (await d.execute(
        sql`SELECT provider, kind, outcome, message, actor, created_at FROM integration_events
            WHERE created_at >= CURRENT_TIMESTAMP(3) - INTERVAL 90 DAY AND outcome <> 'connected' AND outcome <> 'ok'
            ORDER BY created_at DESC, id DESC LIMIT 200`,
      )) as unknown as [Array<Record<string, unknown>>];
      const providers = st.map((r): IntegrationHealth => {
        const provider = String(r.provider);
        const lastCheck = r.last_check_at ? { at: iso(r.last_check_at)!, outcome: String(r.last_check_outcome) as CheckOutcome, message: String(r.last_check_message ?? ""), by: r.last_check_by ? String(r.last_check_by) : null } : null;
        const lastSync = r.last_sync_at ? { at: iso(r.last_sync_at)!, ok: r.last_sync_outcome === "ok", message: String(r.last_sync_message ?? "") } : null;
        const s = connectionOf(lastCheck, lastSync);
        return {
          provider,
          connection: s.connection,
          stateAt: s.at,
          lastCheck,
          lastSync,
          lastOkSyncAt: iso(r.last_ok_sync_at),
          lastError: r.last_error_at ? { at: iso(r.last_error_at)!, message: String(r.last_error_message ?? "") } : null,
          incidents: ev
            .filter((e) => e.provider === provider)
            .slice(0, 10)
            .map((e) => ({ at: iso(e.created_at)!, kind: String(e.kind), outcome: String(e.outcome), message: String(e.message), actor: e.actor ? String(e.actor) : null })),
        };
      });
      return { available: true, providers };
    },
    { available: false, providers: [] },
  );
}
