/**
 * Conexiones del DDL/semillas de arranque (modo single).
 *
 * Cada paso de arranque abría su propia conexión y solo la cerraba en el camino feliz: ante una
 * excepción (p. ej. un ALTER que falla) la conexión quedaba abierta hasta el cierre del
 * proceso. Aquí se registran y `closeStartupConnections()` cierra las que sigan abiertas al
 * terminar la cadena de arranque.
 */
import type mysql from "mysql2/promise";

type Conn = mysql.Connection;
type Factory = (url: string) => Promise<Conn>;

const open = new Set<Conn>();
let factory: Factory = async (url) => {
  const m = await import("mysql2/promise");
  return m.default.createConnection(url);
};

/** Solo para pruebas. */
export function setStartupConnectionFactory(f: Factory | null): void {
  factory =
    f ??
    (async (url) => {
      const m = await import("mysql2/promise");
      return m.default.createConnection(url);
    });
}

export async function openStartupConnection(url: string = process.env.DATABASE_URL!): Promise<Conn> {
  const conn = await factory(url);
  open.add(conn);
  const end = conn.end.bind(conn);
  conn.end = (async (...a: Parameters<Conn["end"]>) => {
    open.delete(conn);
    return end(...a);
  }) as Conn["end"];
  return conn;
}

/** Cierra las conexiones de arranque que sigan abiertas; devuelve cuántas había. */
export async function closeStartupConnections(): Promise<number> {
  const pending = Array.from(open);
  open.clear();
  await Promise.all(pending.map((c) => c.end().catch(() => undefined)));
  return pending.length;
}

export const openStartupConnectionCount = (): number => open.size;
