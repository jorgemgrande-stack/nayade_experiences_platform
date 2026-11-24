/**
 * Equivalencia y rendimiento de `latestAttempts` (inventario y copias): consulta anterior (subconsulta
 * correlacionada) frente a la nueva (JOIN contra agregación). Solo corre con MySQL de prueba:
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:…@127.0.0.1:3432/registry_test pnpm vitest run server/backupLatestAttempts.mysql.test.ts
 * Cada prueba crea sus tablas en una base nueva de nombre unico (`la_test_<n>`) en el MySQL de prueba, sin tocar
 * tablas reales; no se borran bases (el MySQL de prueba es desechable).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { LATEST_ATTEMPTS_SQL, LATEST_ATTEMPTS_SQL_LEGACY, MysqlBackupInventory } from "./_core/ops/backupInventory";
import { COPIES_LATEST_ATTEMPTS_SQL, COPIES_LATEST_ATTEMPTS_SQL_LEGACY, MysqlBackupCopyLedger } from "./_core/ops/backupCopies";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("latestAttempts: consulta nueva equivale a la anterior", () => {
  let pool: mysql.Pool;
  let seq = 0;

  // Base nueva por prueba: las tablas se crean con el DDL real de las migraciones 0010 y 0011.
  const fresh = async (file: string, table: string) => {
    const db = `la_test_${process.pid}_${Date.now()}_${++seq}`;
    await pool.query(`CREATE DATABASE ${db}`);
    await pool.query(`USE ${db}`);
    const sql = readFileSync(new URL(`../db/registry/${file}`, import.meta.url), "utf8");
    await pool.query(sql.split(";").find((x) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} *\\(`, "i").test(x))!);
  };

  // Una sola conexion para que USE valga para todas las consultas de la prueba.
  beforeAll(async () => {
    pool = mysql.createPool({ uri: URL_!, connectionLimit: 1 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const norm = (rows: mysql.RowDataPacket[]) => rows.map((r) => JSON.stringify(r)).sort();

  const ins = (kind: string, id: string, status: string, startedAt: number, runId: string) =>
    pool.query(
      "INSERT INTO backup_inventory (run_id, target_kind, target_id, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)",
      [runId, kind, id, status, startedAt, status === "running" ? null : startedAt + 5],
    );

  it("inventario: varios intentos, empates de started_at, pruned y elementos solo pruned", async () => {
    await fresh("0010_backup_inventory.sql", "backup_inventory");
    // a: varios intentos, el último es failed
    await ins("tenant", "a", "ok", 100, "r1");
    await ins("tenant", "a", "ok", 200, "r2");
    await ins("tenant", "a", "failed", 300, "r3");
    // b: empate de started_at -> gana el id mayor
    await ins("tenant", "b", "ok", 500, "r4");
    await ins("tenant", "b", "failed", 500, "r5");
    // c: el más reciente está pruned -> debe ignorarse
    await ins("tenant", "c", "ok", 100, "r6");
    await ins("tenant", "c", "pruned", 900, "r7");
    // d: solo pruned -> no aparece
    await ins("tenant", "d", "pruned", 100, "r8");
    // e: mismo id en otro tipo de destino
    await ins("registry", "a", "running", 50, "r9");
    await ins("crm", "crm", "ok", 10, "r10");
    const [oldRows] = await pool.query<mysql.RowDataPacket[]>(LATEST_ATTEMPTS_SQL_LEGACY);
    const [newRows] = await pool.query<mysql.RowDataPacket[]>(LATEST_ATTEMPTS_SQL);
    expect(norm(newRows)).toEqual(norm(oldRows));
    expect(newRows).toHaveLength(5); // tenant a,b,c + registry a + crm
    const got = await new MysqlBackupInventory(pool).latestAttempts();
    const by = (k: string, i: string) => got.find((r) => r.targetKind === k && r.targetId === i);
    expect(by("tenant", "a")?.runId).toBe("r3");
    expect(by("tenant", "b")?.runId).toBe("r5");
    expect(by("tenant", "c")?.runId).toBe("r6");
    expect(by("tenant", "d")).toBeUndefined();
  });

  it("copias: equivalencia por destino con empates y pruned", async () => {
    await fresh("0011_backup_copies.sql", "backup_copies");
    const c = (backup: number, dest: string, kind: string, id: string, status: string, startedAt: number, run: string) =>
      pool.query(
        "INSERT INTO backup_copies (backup_id, destination, run_id, target_kind, target_id, status, started_at, finished_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
        [backup, dest, run, kind, id, status, startedAt, startedAt + 1],
      );
    await c(1, "secondary", "tenant", "a", "ok", 100, "c1");
    await c(2, "secondary", "tenant", "a", "failed", 200, "c2");
    await c(3, "secondary", "tenant", "b", "ok", 300, "c3");
    await c(4, "secondary", "tenant", "b", "failed", 300, "c4");
    await c(5, "secondary", "tenant", "c", "pruned", 400, "c5");
    await c(6, "other", "tenant", "a", "ok", 999, "c6");
    for (const dest of ["secondary", "other", "vacio"]) {
      const [o] = await pool.query<mysql.RowDataPacket[]>(COPIES_LATEST_ATTEMPTS_SQL_LEGACY, [dest]);
      const [n] = await pool.query<mysql.RowDataPacket[]>(COPIES_LATEST_ATTEMPTS_SQL, [dest, dest]);
      expect(norm(n)).toEqual(norm(o));
    }
    const sec = await new MysqlBackupCopyLedger(pool).latestAttempts("secondary");
    expect(sec.map((r) => r.runId).sort()).toEqual(["c2", "c4"]);
  });

  it("volumen: mismo resultado y plan sin subconsulta correlacionada", { timeout: 60_000 }, async () => {
    await fresh("0010_backup_inventory.sql", "backup_inventory");
    // 100 empresas x 40 intentos = 4 000 filas (cada tanda inserta 1 000)
    const rows: unknown[][] = [];
    for (let t = 0; t < 100; t++) {
      for (let k = 0; k < 40; k++) rows.push([`v${t}-${k}`, "tenant", `t${t}`, k % 7 === 0 ? "failed" : k % 11 === 0 ? "pruned" : "ok", 1000 + (k % 30) * 10, 1010 + (k % 30) * 10]);
    }
    for (let i = 0; i < rows.length; i += 1000) {
      await pool.query("INSERT INTO backup_inventory (run_id, target_kind, target_id, status, started_at, finished_at) VALUES ?", [rows.slice(i, i + 1000)]);
    }
    const [o] = await pool.query<mysql.RowDataPacket[]>(LATEST_ATTEMPTS_SQL_LEGACY);
    const [n] = await pool.query<mysql.RowDataPacket[]>(LATEST_ATTEMPTS_SQL);
    expect(n).toHaveLength(100);
    expect(norm(n)).toEqual(norm(o));
    const [plan] = await pool.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${LATEST_ATTEMPTS_SQL}`);
    const text = String(Object.values(plan[0])[0]);
    expect(text).not.toMatch(/dependent subquery|correlated/i);
  });
});
