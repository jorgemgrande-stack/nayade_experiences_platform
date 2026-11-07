/**
 * Elephant Net · enlaces públicos con token opaco (migración db/migrations/0046_net_rutas_publicas, tabla
 * `net_public_links`). Los usan la carta QR de cada mesa (Restaurant Net), el check-in online (Hotel Net) y la firma
 * remota del contrato de alquiler (Ski Net).
 *
 *  - Token: 32 bytes aleatorios en base64url (43 caracteres): no se puede adivinar ni enumerar.
 *  - Solo se guarda la huella: SHA-256 de `net-link:<empresa>:<token>`. Un token de otra empresa no coincide nunca
 *    (aunque se probara en su dominio), y una copia de la base de datos no permite reconstruir los enlaces.
 *  - Un enlace activo por objeto (mesa, reserva o contrato): emitir uno nuevo revoca el anterior en la misma
 *    transacción; la BD lo garantiza además con el índice único sobre `active_key`.
 *  - Revocable desde el panel; los de un solo uso pasan a `used` al consumirse; los caducados dejan de valer solos.
 *  - Sin la migración, ninguna operación funciona: `NetLinksNotInstalled` (la ruta pública responde «no disponible»).
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getTenantIdOrDefault } from "../_core/tenant";

export const LINK_KINDS = ["restaurant_table", "hotel_checkin", "ski_contract"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Formato del token en la URL (32 bytes en base64url). Cualquier otra cosa se descarta sin consultar la BD. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export class NetLinksNotInstalled extends Error {
  constructor() {
    super("Los enlaces públicos aún no están instalados en esta empresa (falta la actualización 0046_net_rutas_publicas).");
    this.name = "NetLinksNotInstalled";
  }
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Huella del token ligada a la empresa en curso. */
export function tokenHash(token: string, tenantId: string = getTenantIdOrDefault()): string {
  return crypto.createHash("sha256").update(`net-link:${tenantId}:${token}`).digest("hex");
}

export interface NetLink {
  id: number;
  kind: LinkKind;
  targetId: number;
  siteId: string | null;
  status: "active" | "revoked" | "used";
  expiresAt: number | null;
  uses: number;
  lastUsedAt: number | null;
  usedAt: number | null;
  createdBy: string;
  createdAt: number;
}

const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const toLink = (r: any): NetLink => ({
  id: Number(r.id),
  kind: r.kind,
  targetId: Number(r.target_id),
  siteId: r.site_id ?? null,
  status: r.status,
  expiresAt: numOrNull(r.expires_at),
  uses: Number(r.uses ?? 0),
  lastUsedAt: numOrNull(r.last_used_at),
  usedAt: numOrNull(r.used_at),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
});

export function isMissingLinksSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    const msg = String(x.sqlMessage ?? x.message ?? "");
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /net_public_links|restaurant_table_requests|hotel_online_checkins/.test(msg)) return true;
  }
  return false;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}

export async function rows<T = any>(exec: Exec, q: ReturnType<typeof sql>): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

export async function affected(exec: Exec, q: ReturnType<typeof sql>): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r.affectedRows ?? 0), insertId: Number(r.insertId ?? 0) };
}

/** Ejecuta con la BD de la empresa; sin la migración 0046, `NetLinksNotInstalled`. */
export async function withLinksDb<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await fn(await database());
  } catch (e) {
    if (isMissingLinksSchema(e)) throw new NetLinksNotInstalled();
    throw e;
  }
}

/**
 * Emite un enlace nuevo para el objeto y revoca el que hubiera (rotación). Devuelve el token EN CLARO una sola vez:
 * no se guarda y no se puede volver a mostrar.
 */
export function issueLink(input: { kind: LinkKind; targetId: number; siteId?: string | null; expiresAt?: number | null; actor: string; now?: number }): Promise<{ link: NetLink; token: string }> {
  const now = input.now ?? Date.now();
  return withLinksDb((d) =>
    d.transaction(async (tx) => {
      await tx.execute(sql`UPDATE net_public_links SET status = 'revoked', revoked_at = ${now}, revoked_by = ${input.actor.slice(0, 100)}
        WHERE kind = ${input.kind} AND target_id = ${input.targetId} AND status = 'active'`);
      const token = newToken();
      const r = await affected(tx, sql`INSERT INTO net_public_links (kind, target_id, site_id, token_hash, status, expires_at, created_by, created_at)
        VALUES (${input.kind}, ${input.targetId}, ${input.siteId ?? null}, ${tokenHash(token)}, 'active', ${input.expiresAt ?? null}, ${input.actor.slice(0, 100)}, ${now})`);
      const [row] = await rows(tx, sql`SELECT * FROM net_public_links WHERE id = ${r.insertId}`);
      return { link: toLink(row), token };
    }),
  );
}

/** Revoca el enlace activo del objeto (si lo hay). Devuelve cuántos se revocaron. */
export function revokeLink(kind: LinkKind, targetId: number, actor: string, now = Date.now()): Promise<number> {
  return withLinksDb(async (d) =>
    (await affected(d, sql`UPDATE net_public_links SET status = 'revoked', revoked_at = ${now}, revoked_by = ${actor.slice(0, 100)}
      WHERE kind = ${kind} AND target_id = ${targetId} AND status = 'active'`)).affectedRows,
  );
}

/** Enlace activo del objeto (sin token: solo su estado para el panel). Caducado = null. */
export function activeLink(kind: LinkKind, targetId: number, now = Date.now()): Promise<NetLink | null> {
  return withLinksDb(async (d) => {
    const [r] = await rows(d, sql`SELECT * FROM net_public_links WHERE kind = ${kind} AND target_id = ${targetId} AND status = 'active' LIMIT 1`);
    if (!r) return null;
    const l = toLink(r);
    return l.expiresAt != null && l.expiresAt <= now ? null : l;
  });
}

/** Enlaces activos y vigentes de un tipo para varios objetos (estado de las mesas en el panel). */
export function activeLinks(kind: LinkKind, targetIds: readonly number[], now = Date.now()): Promise<NetLink[]> {
  if (!targetIds.length) return Promise.resolve([]);
  return withLinksDb(async (d) =>
    (await rows(d, sql`SELECT * FROM net_public_links WHERE kind = ${kind} AND status = 'active' AND target_id IN (${sql.join(targetIds.map((i) => sql`${i}`), sql`, `)})`))
      .map(toLink)
      .filter((l) => l.expiresAt == null || l.expiresAt > now),
  );
}

/**
 * Enlace de un token: activo, del tipo pedido y sin caducar. Cualquier otro caso (formato, inexistente, de otra empresa,
 * revocado, usado o caducado) es null, sin distinguir: la ruta pública responde siempre lo mismo.
 */
export async function resolveLink(kind: LinkKind, token: unknown, now = Date.now()): Promise<NetLink | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  return withLinksDb(async (d) => {
    const [r] = await rows(d, sql`SELECT * FROM net_public_links WHERE token_hash = ${tokenHash(token)} LIMIT 1`);
    if (!r) return null;
    const l = toLink(r);
    if (l.kind !== kind || l.status !== "active") return null;
    if (l.expiresAt != null && l.expiresAt <= now) return null;
    return l;
  });
}

/** Anota un uso (contador y último uso). */
export function touchLink(id: number, now = Date.now()): Promise<void> {
  return withLinksDb(async (d) => {
    await d.execute(sql`UPDATE net_public_links SET uses = uses + 1, last_used_at = ${now} WHERE id = ${id}`);
  });
}

/** Consume un enlace de un solo uso. Devuelve si lo consumió ESTA llamada (dos a la vez: solo una). */
export function consumeLink(id: number, now = Date.now()): Promise<boolean> {
  return withLinksDb(async (d) =>
    (await affected(d, sql`UPDATE net_public_links SET status = 'used', used_at = ${now}, uses = uses + 1, last_used_at = ${now} WHERE id = ${id} AND status = 'active'`)).affectedRows === 1,
  );
}
