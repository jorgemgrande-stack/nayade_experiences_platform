/**
 * Cobro del TPV sin duplicados (migración 0018, `tpv_sales.idempotencyKey`).
 *
 * El TPV genera una clave por intento de cobro. Un doble clic o un reintento (red lenta, pestaña recargada) reenvía la
 * misma clave y recibe la venta ya grabada en lugar de crear otra. Dos garantías:
 *  - Un bloqueo con nombre por empresa y clave (GET_LOCK) serializa los intentos simultáneos ANTES de numerar el ticket,
 *    así que el que llega segundo nunca consume un número (la numeración no deja huecos).
 *  - El índice único de la columna es la última barrera aunque el bloqueo no estuviera disponible.
 * Adaptado de Skicenter (commit 0a6a535b, migración 0332), que solo tenía la segunda y respondía con un error.
 */
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { legacyPool } from "./_core/legacyDb";
import { getCurrentPoolSync } from "./_core/dbRegistry";

/** Clave aceptada: la genera el navegador (UUID); se limita a caracteres seguros y 64 posiciones. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

const LOCK_WAIT_SECONDS = 15;

/**
 * Nombre de un bloqueo con nombre: global al servidor MySQL, así que incluye la base de datos de la empresa (MD5: máx.
 * 64). El de la venta del TPV es `es_tpv_sale:<bd>:<clave>`.
 */
const lockName = (scope: string) => `MD5(CONCAT('es_${scope}:', DATABASE(), ':', ?))`;

const LOCK_POLL_MS = 150;

/** Semáforo en memoria con cola FIFO y espera con límite (false si se agota). */
class Gate {
  active = 0;
  private waiters: Array<{ wake: () => void }> = [];
  constructor(readonly capacity: number) {}
  get idle() {
    return this.active === 0 && this.waiters.length === 0;
  }
  async enter(deadline: number): Promise<boolean> {
    if (this.active < this.capacity) {
      this.active++;
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const w = { wake: () => (clearTimeout(t), resolve(true)) };
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(false);
      }, Math.max(0, deadline - Date.now()));
      this.waiters.push(w);
    });
  }
  /** El hueco pasa al primero de la cola (sin bajar `active`) o queda libre. */
  leave() {
    const next = this.waiters.shift();
    if (next) next.wake();
    else this.active--;
  }
}

/**
 * Límites en memoria por proceso y por pool de empresa (las empresas no comparten pool, así que nunca se estorban):
 *  - Por clave: los intentos con la misma clave del mismo proceso (doble clic) hacen cola sin coger ninguna conexión.
 *  - Por grupo (la parte del ámbito antes del primer «_»: «tpv», «ski»): cuántos bloqueos de claves DISTINTAS se
 *    retienen a la vez. Quien tiene un bloqueo con nombre retiene una conexión del pool y necesita otra para trabajar;
 *    sin límite, con tantas ventas simultáneas como conexiones (4 por empresa en multiempresa) cada una retenía una y
 *    esperaba otra para siempre (interbloqueo dentro del pool). El límite deja siempre al menos una conexión libre
 *    para trabajar (ningún dueño de un bloqueo necesita dos de trabajo a la vez): «ski» (cargo o fianza, que dentro
 *    coge el de la venta) 1; «tpv», conexiones − 2, al menos 1. Así «ski» + «tpv» ≤ conexiones − 1.
 *  - Con menos de 3 conexiones no caben los dos bloqueos anidados más una de trabajo: «ski» se queda en la cola en
 *    memoria de este proceso (sin GET_LOCK) y solo la venta usa el bloqueo de MySQL.
 *  Entre procesos, el bloqueo de MySQL sigue siendo el que manda.
 */
const gates = new WeakMap<object, Map<string, Gate>>();
const NO_POOL = {};

function poolLimit(pool: unknown): number {
  const n = Number((pool as { pool?: { config?: { connectionLimit?: unknown } } } | null)?.pool?.config?.connectionLimit);
  return Number.isInteger(n) && n > 0 ? n : 4;
}
export function groupCapacity(group: string, connectionLimit: number): number {
  return group === "tpv" ? Math.max(1, connectionLimit - 2) : 1;
}

/**
 * Ejecuta `fn` con el bloqueo con nombre `scope` + `key` de la empresa en curso, en una conexión propia. Si no se
 * obtiene en `waitSeconds`, CONFLICT con `busyMessage` y `fn` no se ejecuta (error recuperable: no ha hecho nada).
 *
 * Quien espera NO retiene ninguna conexión: hace cola en memoria y, si el bloqueo lo tiene otro proceso, lo intenta sin
 * espera, devuelve la conexión y lo reintenta en un momento.
 */
export async function withTenantLock<T>(scope: string, key: string, waitSeconds: number, busyMessage: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[a-z]+_[a-z_]+$/.test(scope)) throw new Error("Ámbito de bloqueo no válido");
  const name = lockName(scope);
  const group = scope.slice(0, scope.indexOf("_"));
  const pool = getCurrentPoolSync();
  const poolKey = pool ?? NO_POOL;
  let byName = gates.get(poolKey);
  if (!byName) gates.set(poolKey, (byName = new Map()));
  const gateOf = (id: string, capacity: number) => {
    let g = byName!.get(id);
    if (!g) byName!.set(id, (g = new Gate(capacity)));
    return g;
  };
  const keyId = `k:${scope}:${key}`;
  const keyGate = gateOf(keyId, 1);
  const limit = poolLimit(pool);
  const groupGate = gateOf(`g:${group}`, groupCapacity(group, limit));
  const inMemoryOnly = group !== "tpv" && limit < 3;
  const busy = () => new TRPCError({ code: "CONFLICT", message: busyMessage });
  // Cola local agotada: el cobro ni siquiera ha empezado
  const crowded = () => new TRPCError({ code: "CONFLICT", message: "Hay muchos cobros a la vez en esta empresa: no se ha cobrado nada; repítelo en unos segundos." });
  const deadline = Date.now() + waitSeconds * 1000;
  if (!(await keyGate.enter(deadline))) throw busy();
  try {
    for (;;) {
      if (!(await groupGate.enter(deadline))) throw crowded();
      try {
        if (inMemoryOnly) return await fn();
        const conn: mysql.PoolConnection = await legacyPool().getConnection();
        let released = true;
        try {
          const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT GET_LOCK(${name}, 0) AS got`, [key]);
          if (Number(rows[0]?.got) === 1) {
            try {
              return await fn();
            } finally {
              released = await conn.query(`SELECT RELEASE_LOCK(${name})`, [key]).then(() => true, () => false);
            }
          }
        } finally {
          // Una conexión que no pudo soltar el bloqueo no vuelve al pool: al cerrarla, MySQL lo libera
          if (released) conn.release();
          else conn.destroy();
        }
      } finally {
        groupGate.leave();
      }
      // Lo tiene otro proceso: se reintenta sin retener nada
      if (Date.now() >= deadline) throw busy();
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  } finally {
    keyGate.leave();
    if (keyGate.idle) byName.delete(keyId);
  }
}

/** Ejecuta `fn` con el bloqueo de esa clave de venta. */
export function withSaleKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return withTenantLock("tpv_sale", key, LOCK_WAIT_SECONDS, "Este cobro ya se está registrando. Espera unos segundos y revisa las ventas de la caja antes de repetirlo.", fn);
}

/** Antigüedad a partir de la cual una venta «pendiente» se da por abandonada (proceso caído a mitad del cobro). */
export const STALE_PENDING_SALE_MS = 15 * 60_000;

/**
 * Venta «pendiente» abandonada: el proceso cayó entre numerarla y grabar su núcleo (sin líneas, cobros ni asientos; lo
 * grabado va todo en la transacción que la pasa a cobrada). Con el bloqueo de su clave, se anula con motivo y se le
 * quita la clave, igual que hace el propio cobro cuando falla, para que el reintento pueda cobrar. Solo si sigue
 * pendiente y tiene más de STALE_PENDING_SALE_MS. Devuelve si la ha anulado.
 */
export function abandonStalePendingSale(key: string, now = Date.now()): Promise<boolean> {
  return withSaleKeyLock(key, async () => {
    const [r] = await legacyPool().query<mysql.ResultSetHeader>(
      `UPDATE tpv_sales SET status_ts = 'cancelled', idempotencyKey = NULL,
         notes = CONCAT_WS(' · ', NULLIF(notes, ''), CONCAT('[VENTA NO REGISTRADA] ', ticketNumber, ': cobro interrumpido sin grabarse; anulada al reintentar (sin líneas, cobros, reservas ni asientos).'))
       WHERE idempotencyKey = ? AND status_ts = 'pending' AND createdAt < ?`,
      [key, now - STALE_PENDING_SALE_MS],
    );
    return r.affectedRows > 0;
  });
}

export interface KeyedSale {
  id: number;
  sessionId: number;
  status: string;
}

/** Venta ya grabada con esa clave (o null). */
export async function findSaleByIdempotencyKey(key: string): Promise<KeyedSale | null> {
  const [rows] = await legacyPool().query<mysql.RowDataPacket[]>(
    "SELECT id, sessionId, status_ts AS status FROM tpv_sales WHERE idempotencyKey = ? LIMIT 1",
    [key]
  );
  const r = rows[0];
  return r ? { id: Number(r.id), sessionId: Number(r.sessionId), status: String(r.status) } : null;
}

/**
 * Qué hacer con una venta que ya tiene la clave:
 *  - otra caja → error (la clave es de otro cobro);
 *  - en curso → esperar a que termine (el primer intento sigue grabándola) y volver a decidir;
 *  - grabada (cobrada, devuelta o anulada después) → devolver esa misma venta (su id);
 *  - falló al grabarse (createSale libera la clave) → null: el reintento crea una venta nueva.
 */
export async function resolveExistingSale(
  key: string,
  existing: KeyedSale,
  sessionId: number,
  opts: { waitMs?: number; pollMs?: number } = {}
): Promise<number | null> {
  if (existing.sessionId !== sessionId) {
    throw new TRPCError({ code: "CONFLICT", message: "Este cobro pertenece a otra caja. Recarga la pantalla del TPV y vuelve a intentarlo." });
  }
  const deadline = Date.now() + (opts.waitMs ?? 20_000);
  let current: KeyedSale | null = existing;
  while (current && current.status === "pending") {
    if (Date.now() >= deadline) {
      throw new TRPCError({ code: "CONFLICT", message: "Este cobro ya se está registrando. Espera unos segundos y revisa las ventas de la caja antes de repetirlo." });
    }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 200));
    const [rows] = await legacyPool().query<mysql.RowDataPacket[]>(
      "SELECT id, sessionId, status_ts AS status, idempotencyKey FROM tpv_sales WHERE id = ?",
      [existing.id]
    );
    const r = rows[0];
    // Sin fila o sin la clave: el primer intento falló y la liberó
    current = r && r.idempotencyKey === key ? { id: Number(r.id), sessionId: Number(r.sessionId), status: String(r.status) } : null;
  }
  return current ? current.id : null;
}

/** ¿Es el error del índice único de la clave? (carrera sin bloqueo disponible) */
export function isIdempotencyKeyConflict(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code;
  const msg = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  return code === "ER_DUP_ENTRY" && msg.includes("uq_tpv_sales_idempotency_key");
}
