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

/** Clave aceptada: la genera el navegador (UUID); se limita a caracteres seguros y 64 posiciones. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

const LOCK_WAIT_SECONDS = 15;

/** Nombre del bloqueo: global al servidor MySQL, así que incluye la base de datos de la empresa (MD5: máx. 64). */
const LOCK_NAME = "MD5(CONCAT('es_tpv_sale:', DATABASE(), ':', ?))";

/** Ejecuta `fn` con el bloqueo de esa clave en una conexión propia que se libera siempre. */
export async function withSaleKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const conn: mysql.PoolConnection = await legacyPool().getConnection();
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT GET_LOCK(${LOCK_NAME}, ?) AS got`, [key, LOCK_WAIT_SECONDS]);
    if (Number(rows[0]?.got) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "Este cobro ya se está registrando. Espera unos segundos y revisa las ventas de la caja antes de repetirlo." });
    }
    try {
      return await fn();
    } finally {
      await conn.query(`SELECT RELEASE_LOCK(${LOCK_NAME})`, [key]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
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
