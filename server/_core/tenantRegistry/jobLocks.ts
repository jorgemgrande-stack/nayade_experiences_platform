/**
 * Exclusión entre réplicas de las tareas en segundo plano: una tarea de una empresa corre en UNA sola réplica a la vez.
 *
 *  - Producción: bloqueos con nombre de MySQL (`GET_LOCK`/`RELEASE_LOCK`) en la base del REGISTRO, sobre UNA conexión
 *    dedicada por proceso (fuera del pool del registro). No necesita tablas ni permisos de escritura (el Core lee el
 *    registro en solo lectura). Si la réplica muere, MySQL cierra su sesión y libera sus bloqueos: la tarea se
 *    recupera en otra réplica sin intervención. El nombre incluye la base del registro y va resumido (SHA-1) para
 *    no superar los 64 caracteres ni chocar con otros entornos del mismo servidor.
 *  - Arrendamientos con caducidad (`LeaseStore` + `leaseLockProvider`): el mismo contrato con un almacén de
 *    arrendamientos que se renuevan mientras la ejecución vive; si la réplica muere, el arrendamiento caduca y otra
 *    lo recupera. Implementación en memoria para pruebas y para un proceso único; un almacén en tabla puede
 *    implementarlo después sin tocar el programador.
 *  - El bloqueo se suelta cuando la ejecución TERMINA DE VERDAD (también la abandonada por tiempo): una ejecución
 *    colgada sigue ocupando su empresa y ninguna otra réplica la duplica.
 */
import type mysql from "mysql2/promise";
import { opsLog } from "../ops/log";

export interface JobLock {
  release(): Promise<void>;
}

export interface JobLockProvider {
  /** Bloqueo de `key` sin esperar: `null` si lo tiene otra réplica. Lanza si el almacén no responde. */
  tryAcquire(key: string): Promise<JobLock | null>;
}

export const jobLockKey = (job: string, tenantId: string) => `job:${job}:${tenantId}`;

// ── Arrendamientos con caducidad ───────────────────────────────────────────────

export interface LeaseStore {
  /** Toma el arrendamiento si está libre, caducado o ya es de `owner`. */
  tryAcquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Prolonga un arrendamiento propio; `false` si ya no es de `owner` (caducó y otro lo tomó). */
  renew(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

export class MemoryLeaseStore implements LeaseStore {
  private leases = new Map<string, { owner: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async tryAcquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const cur = this.leases.get(key);
    const now = this.now();
    if (cur && cur.owner !== owner && cur.expiresAt > now) return false;
    this.leases.set(key, { owner, expiresAt: now + ttlMs });
    return true;
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const cur = this.leases.get(key);
    if (!cur || cur.owner !== owner) return false;
    cur.expiresAt = this.now() + ttlMs;
    return true;
  }

  async release(key: string, owner: string): Promise<void> {
    if (this.leases.get(key)?.owner === owner) this.leases.delete(key);
  }

  holder(key: string): string | null {
    const cur = this.leases.get(key);
    return cur && cur.expiresAt > this.now() ? cur.owner : null;
  }
}

/** Bloqueos sobre arrendamientos: se renuevan cada `ttlMs / 3` mientras la ejecución vive. */
export function leaseLockProvider(store: LeaseStore, owner: string, ttlMs = 60_000): JobLockProvider {
  return {
    async tryAcquire(key) {
      if (!(await store.tryAcquire(key, owner, ttlMs))) return null;
      const timer = setInterval(() => {
        store
          .renew(key, owner, ttlMs)
          .then((ok) => {
            if (!ok) opsLog("warn", "Jobs", "lock_lost", { key, owner });
          })
          .catch(() => opsLog("warn", "Jobs", "lock_renew_failed", { key }));
      }, Math.max(10, Math.floor(ttlMs / 3)));
      timer.unref?.();
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          clearInterval(timer);
          await store.release(key, owner).catch(() => undefined);
        },
      };
    },
  };
}

// ── MySQL: GET_LOCK / RELEASE_LOCK ─────────────────────────────────────────────

const LOCK_NAME_SQL = "CONCAT('es-job:', SHA1(CONCAT(IFNULL(DATABASE(), ''), '|', ?)))";

type LockConnection = Pick<mysql.Connection, "query" | "on"> & { destroy?: () => void };

/**
 * Bloqueos con nombre de MySQL sobre una conexión dedicada (se crea al primer uso y se rehace si se pierde).
 * Si la conexión se pierde, MySQL libera TODOS sus bloqueos: se registra `locks_lost` para las ejecuciones en curso.
 */
export function mysqlJobLockProvider(connect: () => Promise<LockConnection>): JobLockProvider {
  let conn: Promise<LockConnection> | null = null;
  const held = new Set<string>();
  const drop = (reason: string) => {
    if (held.size) opsLog("warn", "Jobs", "locks_lost", { reason, held: held.size });
    held.clear();
    conn = null;
  };
  const connection = () => {
    if (!conn) {
      const c = connect().then((cn) => {
        cn.on("error", () => drop("connection_error"));
        cn.on("end", () => drop("connection_end"));
        return cn;
      });
      c.catch(() => {
        if (conn === c) conn = null;
      });
      conn = c;
    }
    return conn;
  };
  return {
    async tryAcquire(key) {
      const cn = await connection();
      const [rows] = (await cn.query(`SELECT GET_LOCK(${LOCK_NAME_SQL}, 0) AS got`, [key])) as unknown as [Array<{ got: number | null }>];
      const got = rows[0]?.got;
      if (got === null || got === undefined) throw new Error("GET_LOCK sin respuesta");
      if (Number(got) !== 1) return null;
      held.add(key);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          if (!held.delete(key)) return; // la sesión se perdió: MySQL ya lo liberó
          await cn.query(`SELECT RELEASE_LOCK(${LOCK_NAME_SQL}) AS rel`, [key]).catch(() => undefined);
        },
      };
    },
  };
}
