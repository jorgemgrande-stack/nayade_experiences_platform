/**
 * Eventos de dominio de Comunidades — PUNTO DE EXTENSIÓN para recompensar la participación (Social Token Net Complete,
 * STN-4) sin que Comunidades dependa del módulo de tokens.
 *
 * Cada hecho (miembro se une, publica, comenta, reacciona; y los de gestión: ocultar, bloquear…) se registra en
 * `community_activity` con una clave única (`event_key`) y, solo si es nuevo, se entrega a los suscriptores:
 *
 *   import { onCommunityEvent } from "./communities/events";
 *   onCommunityEvent(async (e) => { if (e.type === "member.posted") await premiar(e.userId, e.key); });
 *
 *  - Se entrega una sola vez por clave (repetir la acción, o quitar y volver a dar «me gusta», no la repite): la clave
 *    sirve también de clave de idempotencia para quien premia.
 *  - Se entrega dentro del contexto de la empresa de la petición (misma base de datos), con `tenantId` informativo.
 *  - Un fallo de un suscriptor nunca rompe la acción del miembro (se registra en el log de operaciones).
 *  - Para ponerse al día (o procesar en diferido), `listCommunityEvents({ afterId })` lee los hechos en orden.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { opsLog } from "../_core/ops/log";
import { peekTenantContext } from "../_core/tenant";
import type { CommunityEventType } from "../../shared/communities";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type CommunityExec = Pick<Db, "execute">;

export interface CommunityDomainEvent {
  /** Id de la fila en community_activity (orden de los hechos en la empresa). */
  id: number;
  /** Clave única del hecho. */
  key: string;
  type: CommunityEventType;
  tenantId: string | null;
  communityId: number;
  /** Quien hace la acción (para los de participación, el miembro que participa). */
  userId: number | null;
  targetType: string | null;
  targetId: number | null;
  data: Record<string, unknown> | null;
  occurredAt: number;
}

export type CommunityEventHandler = (e: CommunityDomainEvent) => void | Promise<void>;

const handlers = new Set<CommunityEventHandler>();

/** Suscribe un manejador. Devuelve la función para darlo de baja. */
export function onCommunityEvent(handler: CommunityEventHandler): () => void {
  handlers.add(handler);
  return () => void handlers.delete(handler);
}

export interface NewCommunityEvent {
  key: string;
  type: CommunityEventType;
  communityId: number;
  userId: number | null;
  targetType?: string | null;
  targetId?: number | null;
  data?: Record<string, unknown> | null;
  now?: number;
}

/**
 * Registra el hecho (INSERT IGNORE por su clave) y devuelve el evento si es nuevo, o null si ya existía. No lo entrega:
 * `dispatchCommunityEvent` se llama cuando la operación está confirmada (fuera de la transacción).
 */
export async function recordCommunityEvent(exec: CommunityExec, e: NewCommunityEvent): Promise<CommunityDomainEvent | null> {
  const now = e.now ?? Date.now();
  const data = e.data ? JSON.stringify(e.data) : null;
  const [r] = (await exec.execute(sql`INSERT IGNORE INTO community_activity (community_id, actor_user_id, type, target_type, target_id, event_key, data, created_at)
    VALUES (${e.communityId}, ${e.userId}, ${e.type}, ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.key}, ${data}, ${now})`)) as unknown as [{ affectedRows: number; insertId: number }];
  if (!r || Number(r.affectedRows ?? 0) !== 1) return null;
  return {
    id: Number(r.insertId),
    key: e.key,
    type: e.type,
    tenantId: peekTenantContext()?.tenantId ?? null,
    communityId: e.communityId,
    userId: e.userId,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    data: e.data ?? null,
    occurredAt: now,
  };
}

/** Entrega el hecho a los suscriptores (en orden, esperando a cada uno; sus fallos no se propagan). */
export async function dispatchCommunityEvent(e: CommunityDomainEvent | null): Promise<void> {
  if (!e) return;
  for (const h of Array.from(handlers)) {
    try {
      await h(e);
    } catch (err) {
      opsLog("warn", "Communities", "event_handler_failed", { type: e.type, key: e.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Registra y entrega en un paso (operaciones sin transacción). */
export async function emitCommunityEvent(exec: CommunityExec, e: NewCommunityEvent): Promise<CommunityDomainEvent | null> {
  const ev = await recordCommunityEvent(exec, e);
  await dispatchCommunityEvent(ev);
  return ev;
}

/** Hechos registrados después de `afterId` (orden ascendente), para consumidores en diferido. */
export async function listCommunityEvents(opts: { afterId?: number; limit?: number; types?: CommunityEventType[] } = {}): Promise<CommunityDomainEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const types = opts.types?.length ? sql` AND type IN (${sql.join(opts.types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const [rows] = (await db.execute(sql`SELECT id, community_id, actor_user_id, type, target_type, target_id, event_key, data, created_at
    FROM community_activity WHERE id > ${opts.afterId ?? 0}${types} ORDER BY id ASC LIMIT ${limit}`)) as unknown as [Array<Record<string, unknown>>];
  const tenantId = peekTenantContext()?.tenantId ?? null;
  return rows.map((r) => ({
    id: Number(r.id),
    key: String(r.event_key),
    type: r.type as CommunityEventType,
    tenantId,
    communityId: Number(r.community_id),
    userId: r.actor_user_id == null ? null : Number(r.actor_user_id),
    targetType: (r.target_type as string | null) ?? null,
    targetId: r.target_id == null ? null : Number(r.target_id),
    data: parseJson(r.data),
    occurredAt: Number(r.created_at),
  }));
}

function parseJson(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "object") return v as Record<string, unknown>;
  try {
    const p = JSON.parse(String(v));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}
