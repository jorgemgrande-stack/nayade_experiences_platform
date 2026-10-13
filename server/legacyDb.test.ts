/**
 * Acceso heredado a la BD (puente de migración) y codemod de consolidación de pools.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";

const created = vi.hoisted(() => ({ opts: [] as any[], pools: [] as any[] }));

vi.mock("mysql2/promise", () => {
  const createPool = (opts: any) => {
    created.opts.push(opts);
    const pool = { __id: created.pools.length, execute: vi.fn(async function (this: any) { return [[{ id: this?.__id }]]; }), end: vi.fn() };
    created.pools.push(pool);
    return pool;
  };
  return { default: { createPool }, createPool };
});
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: (pool: any) => ({ __pool: pool, select: function (this: any) { return this.__pool.__id; } }),
}));

import { legacyDb, legacyPool } from "./_core/legacyDb";
import { _resetRegistryForTests } from "./_core/dbRegistry";
import { TenantResolutionError } from "./_core/tenant";

const ENV = { ...process.env };
beforeEach(() => {
  created.opts.length = 0;
  created.pools.length = 0;
  _resetRegistryForTests();
  delete process.env.TENANT_MODE;
  process.env.DATABASE_URL = "mysql://u:p@db.invalid:3306/app";
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("legacyDb / legacyPool", () => {
  it("es perezoso: crear los accesos no abre ningún pool", () => {
    legacyPool();
    legacyDb();
    expect(created.pools).toHaveLength(0);
  });

  it("muchos consumidores comparten un único pool de 10 conexiones", async () => {
    const consumers = Array.from({ length: 40 }, () => ({ pool: legacyPool(), db: legacyDb() }));
    for (const c of consumers) {
      await c.pool.execute("SELECT 1");
      c.db.select();
    }
    expect(created.pools).toHaveLength(1);
    expect(created.opts[0]).toMatchObject({ uri: "mysql://u:p@db.invalid:3306/app", connectionLimit: 10 });
  });

  it("conserva el `this` de los métodos (bind al pool real)", async () => {
    const [[row]] = (await legacyPool().execute("SELECT 1")) as any;
    expect(row.id).toBe(0);
  });

  it("sin DATABASE_URL falla al usarse, con un mensaje claro, no al importarse", () => {
    delete process.env.DATABASE_URL;
    const p = legacyPool();
    expect(() => p.execute("SELECT 1")).toThrow(/no configurada/);
  });

  it("en modo multi-tenant falla de forma explícita (nunca sirve 'alguna' BD)", () => {
    process.env.TENANT_MODE = "multi";
    const p = legacyPool();
    expect(() => p.execute("SELECT 1")).toThrow(TenantResolutionError);
    expect(() => legacyDb().select()).toThrow(/multi-tenant/);
    expect(created.pools).toHaveLength(0);
  });
});

describe("codemod consolidateDbPool", () => {
  const require = createRequire(import.meta.url);
  const { transform, relImport } = require("../scripts/codemods/consolidateDbPool.cjs");

  const SIMPLE = `import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

export async function f() {
  return db.select();
}
`;

  it("sustituye pool y drizzle y retira los imports que quedan sin uso", () => {
    const r = transform(SIMPLE, "./_core/legacyDb");
    expect(r.changed).toBe(true);
    expect(r.out).toContain("const _pool = legacyPool();");
    expect(r.out).toContain("const db = legacyDb();");
    expect(r.out).toContain('import { legacyDb, legacyPool } from "./_core/legacyDb";');
    expect(r.out).not.toContain("mysql2/promise");
    expect(r.out).not.toContain('from "drizzle-orm/mysql2"');
    expect(r.out).toContain('import { eq } from "drizzle-orm";'); // lo demás se conserva
  });

  it("es idempotente", () => {
    const once = transform(SIMPLE, "./_core/legacyDb").out;
    const twice = transform(once, "./_core/legacyDb");
    expect(twice.changed).toBe(false);
    expect(twice.out).toBe(once);
  });

  it("conserva el import de mysql si se sigue usando (p. ej. tipos o transacciones)", () => {
    const src = SIMPLE.replace("export async function f()", "export type P = mysql.Pool;\nexport async function f()");
    const r = transform(src, "./_core/legacyDb");
    expect(r.changed).toBe(true);
    expect(r.out).toContain('import mysql from "mysql2/promise";');
  });

  it("respeta los saltos de línea CRLF", () => {
    const r = transform(SIMPLE.replace(/\n/g, "\r\n"), "./_core/legacyDb");
    expect(r.changed).toBe(true);
    expect(r.out).toContain("\r\n");
    expect(r.out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("no toca patrones que no reconoce", () => {
    const odd = `import mysql from "mysql2/promise";\nconst pool = mysql.createPool({ uri: x, connectionLimit: 3 });\n`;
    expect(transform(odd, "./_core/legacyDb").changed).toBe(false);
    const noDrizzle = `import mysql from "mysql2/promise";\nconst p = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });\n`;
    expect(transform(noDrizzle, "./_core/legacyDb").reason).toMatch(/drizzle/);
  });

  it("calcula la ruta relativa al módulo desde cualquier carpeta", () => {
    expect(relImport("server/kbRoute.ts")).toBe("./_core/legacyDb");
    expect(relImport("server/routers/hr.ts")).toBe("../_core/legacyDb");
    expect(relImport("server/db/reviewsDb.ts")).toBe("../_core/legacyDb");
  });
});
