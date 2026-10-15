/**
 * Comprobación de esquema del arranque (solo lectura) y mantenimiento explícito, sin base de datos.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  KNOWN_ABSENT_TABLES,
  checkAppSchema,
  compareSchema,
  describeSchemaReport,
  expectedSchema,
  pendingDrizzle,
  readDrizzleMigrations,
  type SchemaReport,
} from "./_core/schemaCheck";
import { runSchemaMaintenance, schemaCheckMode, type MaintenanceStep } from "./_core/schemaMaintenance";

const DRIZZLE = path.resolve(__dirname, "../drizzle");

describe("migraciones de drizzle pendientes (mismo criterio que el migrador)", () => {
  const files = [
    { tag: "0001_a", folderMillis: 100, hash: "a" },
    { tag: "0002_b", folderMillis: 200, hash: "b" },
    { tag: "0003_c", folderMillis: 300, hash: "c" },
  ];
  it("sin registro, todas; con registro, solo las posteriores al último created_at", () => {
    expect(pendingDrizzle(files, null).map((m) => m.tag)).toEqual(["0001_a", "0002_b", "0003_c"]);
    expect(pendingDrizzle(files, 200).map((m) => m.tag)).toEqual(["0003_c"]);
    expect(pendingDrizzle(files, 300)).toEqual([]);
  });
  it("lee el journal real del repositorio con sus etiquetas", () => {
    const real = readDrizzleMigrations(DRIZZLE);
    const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"));
    expect(real.map((m) => m.tag)).toEqual(journal.entries.map((e: { tag: string }) => e.tag));
  });
});

describe("comparación con drizzle/schema.ts", () => {
  it("detecta tablas y columnas ausentes; las RBAC documentadas no cuentan como fallo", () => {
    const expected = new Map([
      ["users", ["id", "email"]],
      ["bookings", ["id", "total"]],
      ["rbac_roles", ["id"]],
    ]);
    const actual = new Map([["users", new Set(["id"])]]);
    expect(compareSchema(expected, actual)).toEqual({
      missingTables: ["bookings"],
      missingColumns: ["users.email"],
      knownAbsentTables: ["rbac_roles"],
    });
  });
  it("schema.ts declara las tablas RBAC que producción no tiene a propósito", () => {
    const names = new Set(expectedSchema().keys());
    for (const t of Array.from(KNOWN_ABSENT_TABLES)) expect(names.has(t)).toBe(true);
  });
});

/** Conexión simulada que registra cada consulta y devuelve un esquema completo y al día. */
function fakeConn(opts: { lastCreatedAt?: number | null; dropColumn?: string } = {}) {
  const queries: string[] = [];
  const files = readDrizzleMigrations(DRIZZLE);
  const last = opts.lastCreatedAt === undefined ? files[files.length - 1].folderMillis : opts.lastCreatedAt;
  const cols: Array<{ t: string; c: string }> = [];
  for (const [t, cs] of Array.from(expectedSchema().entries())) {
    if (KNOWN_ABSENT_TABLES.has(t)) continue;
    for (const c of cs) if (`${t}.${c}` !== opts.dropColumn) cols.push({ t, c });
  }
  if (last !== null) cols.push({ t: "__drizzle_migrations", c: "id" });
  return {
    queries,
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("DATABASE() AS db")) return [[{ db: "app" }], []];
      if (sql.includes("information_schema.COLUMNS")) return [cols, []];
      if (sql.includes("ORDER BY created_at DESC")) return [last === null ? [] : [{ created_at: last }], []];
      if (sql.includes("SELECT hash")) return [files.map((f) => ({ hash: f.hash })), []];
      throw new Error(`consulta inesperada: ${sql}`);
    },
  };
}

describe("checkAppSchema (arranque)", () => {
  it("esquema al día → ok, y SOLO ejecuta SELECT", async () => {
    const conn = fakeConn();
    const r = await checkAppSchema(conn as any, { migrationsFolder: DRIZZLE });
    expect(r).toMatchObject({ ok: true, pendingMigrations: [], missingTables: [], missingColumns: [], unmatchedHashes: 0 });
    expect(r.knownAbsentTables.sort()).toEqual(Array.from(KNOWN_ABSENT_TABLES).sort());
    expect(conn.queries.every((q) => /^\s*SELECT\b/i.test(q))).toBe(true);
  });
  it("migraciones pendientes → no ok y las enumera (lo que antes se aplicaba en silencio)", async () => {
    const files = readDrizzleMigrations(DRIZZLE);
    const conn = fakeConn({ lastCreatedAt: files[files.length - 3].folderMillis });
    const r = await checkAppSchema(conn as any, { migrationsFolder: DRIZZLE });
    expect(r.ok).toBe(false);
    expect(r.pendingMigrations).toEqual(files.slice(-2).map((f) => f.tag));
    expect(describeSchemaReport(r).join("\n")).toMatch(/2 migración\(es\) de drizzle pendiente/);
  });
  it("columna ausente → no ok; sin registro de drizzle → todas pendientes", async () => {
    const r = await checkAppSchema(fakeConn({ dropColumn: "users.email" }) as any, { migrationsFolder: DRIZZLE });
    expect(r).toMatchObject({ ok: false, missingColumns: ["users.email"] });
    const r2 = await checkAppSchema(fakeConn({ lastCreatedAt: null }) as any, { migrationsFolder: DRIZZLE });
    expect(r2.ledgerMissing).toBe(true);
    expect(r2.pendingMigrations.length).toBe(readDrizzleMigrations(DRIZZLE).length);
  });
});

describe("mantenimiento explícito (--schema-maintenance)", () => {
  afterEach(() => vi.restoreAllMocks());
  const okReport = { ok: true, database: "app", pendingMigrations: [], ledgerMissing: false, unmatchedHashes: 0, missingTables: [], missingColumns: [], knownAbsentTables: [], tablesChecked: 1 } as SchemaReport;

  function setup(o: { db?: string; lock?: number; reports?: SchemaReport[]; steps?: MaintenanceStep[] } = {}) {
    const queries: string[] = [];
    const ran: string[] = [];
    const conn = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("DATABASE() AS db")) return [[{ db: o.db ?? "app", host: "h", port: 3306 }], []];
        if (sql.includes("GET_LOCK")) return [[{ l: o.lock ?? 1 }], []];
        return [[], []];
      },
      async end() {},
    };
    const reports = [...(o.reports ?? [okReport, okReport])];
    const steps = o.steps ?? [
      { name: "drizzle", run: async () => void ran.push("drizzle") },
      { name: "ensureX", run: async () => void ran.push("ensureX") },
    ];
    const run = (argv: string[], url = "mysql://u:p@127.0.0.1:3306/app") =>
      runSchemaMaintenance({ argv, databaseUrl: url, connect: async () => conn, steps, check: async () => reports.shift() ?? okReport, log: () => undefined });
    return { run, ran, queries };
  }

  it("sin --apply es un plan: no ejecuta ningún paso ni toma el bloqueo", async () => {
    const s = setup();
    expect(await s.run(["--schema-maintenance"])).toBe(0);
    expect(s.ran).toEqual([]);
    expect(s.queries.some((q) => q.includes("GET_LOCK"))).toBe(false);
  });
  it("escribir exige --confirm-database con el nombre real, y --allow-remote si no es local", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = setup();
    expect(await s.run(["--schema-maintenance", "--apply"])).toBe(2);
    expect(await s.run(["--schema-maintenance", "--apply", "--confirm-database", "produccion"])).toBe(2);
    expect(await s.run(["--schema-maintenance", "--apply", "--confirm-database", "app"], "mysql://u:p@db.railway.internal:3306/app")).toBe(2);
    expect(s.ran).toEqual([]);
    expect(await s.run(["--schema-maintenance", "--apply", "--confirm-database", "app", "--allow-remote"], "mysql://u:p@db.railway.internal:3306/app")).toBe(0);
    expect(s.ran).toEqual(["drizzle", "ensureX"]);
  });
  it("sin bloqueo (otro mantenimiento en marcha) no ejecuta nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = setup({ lock: 0 });
    expect(await s.run(["--schema-maintenance", "--apply", "--confirm-database", "app"])).toBe(1);
    expect(s.ran).toEqual([]);
  });
  it("un paso que registra un error detiene la secuencia (los pasos heredados no lanzan)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ran: string[] = [];
    const s = setup({
      steps: [
        { name: "drizzle", run: async () => void console.error("[DB] Error al aplicar migraciones") },
        { name: "ensureX", run: async () => void ran.push("ensureX") },
      ],
    });
    expect(await s.run(["--schema-maintenance", "--apply", "--confirm-database", "app"])).toBe(1);
    expect(ran).toEqual([]);
    expect(s.queries.some((q) => q.includes("RELEASE_LOCK"))).toBe(true);
  });
  it("si tras el mantenimiento el esquema sigue incompleto, sale con error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = setup({ reports: [okReport, { ...okReport, ok: false, missingColumns: ["users.email"] }] });
    expect(await s.run(["--schema-maintenance", "--apply", "--confirm-database", "app"])).toBe(1);
  });
  it("política del arranque: warn por defecto; strict y off explícitos", () => {
    expect(schemaCheckMode(undefined)).toBe("warn");
    expect(schemaCheckMode("cualquier")).toBe("warn");
    expect(schemaCheckMode("strict")).toBe("strict");
    expect(schemaCheckMode("off")).toBe("off");
  });
});
