/**
 * Conexiones de arranque: no deben quedar abiertas ante una excepción, y el arranque no puede
 * volver a abrir conexiones directas a DATABASE_URL sin pasar por el helper.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  closeStartupConnections,
  openStartupConnection,
  openStartupConnectionCount,
  setStartupConnectionFactory,
} from "./_core/startupConnections";

afterEach(async () => {
  await closeStartupConnections();
  setStartupConnectionFactory(null);
});

function fakeConn(log: string[], name: string) {
  return {
    end: async () => void log.push(`end:${name}`),
    execute: async () => {
      throw new Error("ALTER fallido");
    },
  } as any;
}

describe("conexiones de arranque", () => {
  it("una excepción a mitad de un paso no deja la conexión abierta", async () => {
    const log: string[] = [];
    setStartupConnectionFactory(async () => fakeConn(log, "a"));
    const step = async () => {
      try {
        const conn = await openStartupConnection("mysql://x");
        await conn.execute("ALTER TABLE t"); // lanza antes de conn.end() (patrón histórico)
        await conn.end();
      } catch {
        /* el paso registra el error y continúa */
      }
    };
    await step();
    expect(openStartupConnectionCount()).toBe(1);
    expect(await closeStartupConnections()).toBe(1);
    expect(log).toEqual(["end:a"]);
    expect(openStartupConnectionCount()).toBe(0);
  });

  it("camino feliz: end() la da de baja y no se cierra dos veces", async () => {
    const log: string[] = [];
    setStartupConnectionFactory(async () => fakeConn(log, "b"));
    const c = await openStartupConnection("mysql://x");
    await c.end();
    expect(openStartupConnectionCount()).toBe(0);
    expect(await closeStartupConnections()).toBe(0);
    expect(log).toEqual(["end:b"]);
  });

  it("un fallo al cerrar no impide cerrar el resto", async () => {
    const log: string[] = [];
    let n = 0;
    setStartupConnectionFactory(async () => {
      const id = ++n;
      return id === 1
        ? ({ end: async () => { throw new Error("socket"); } } as any)
        : fakeConn(log, `c${id}`);
    });
    await openStartupConnection("mysql://x");
    await openStartupConnection("mysql://x");
    expect(await closeStartupConnections()).toBe(2);
    expect(log).toEqual(["end:c2"]);
  });

  it("guarda de regresión: index.ts no abre conexiones directas a DATABASE_URL", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "_core/index.ts"), "utf8");
    expect(src).not.toMatch(/createConnection\(\s*process\.env\.DATABASE_URL/);
    expect(src).toContain("closeStartupConnections");
  });
});
