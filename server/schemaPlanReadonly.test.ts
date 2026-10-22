/**
 * Plan de esquema de solo lectura (scripts/schema-plan-readonly.ts): la guarda bloquea toda
 * sentencia que no sea de lectura antes de enviarla y, con MySQL real (opt-in), el servidor
 * rechaza escrituras en la sesión de solo lectura.
 */
import { describe, it, expect } from "vitest";
import mysql from "mysql2/promise";
import { readOnlyGuard } from "../scripts/schema-plan-readonly";

function fake() {
  const sent: string[] = [];
  return { sent, conn: { query: async (sql: string) => (sent.push(sql), [[], []]), execute: async () => [[], []] } };
}

describe("guarda de solo lectura", () => {
  it("deja pasar SELECT, SHOW y la transacción de solo lectura", async () => {
    const f = fake();
    const g = readOnlyGuard(f.conn);
    for (const s of ["SELECT 1", "  show tables", "SET SESSION TRANSACTION READ ONLY", "START TRANSACTION READ ONLY", "ROLLBACK"]) await g.query(s);
    expect(f.sent).toHaveLength(5);
  });
  it.each([
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t",
    "CREATE TABLE x (id INT)",
    "ALTER TABLE t ADD COLUMN c INT",
    "DROP TABLE t",
    "TRUNCATE t",
    "SET SESSION sql_mode = ''",
    "START TRANSACTION",
    "COMMIT",
    "CALL p()",
    "/* SELECT */ DELETE FROM t",
  ])("bloquea sin enviarla: %s", async (s) => {
    const f = fake();
    await expect(readOnlyGuard(f.conn).query(s)).rejects.toThrow(/Guarda de solo lectura/);
    expect(f.sent).toEqual([]);
  });
  it("execute() (sentencias preparadas) también está bloqueado", async () => {
    const f = fake();
    await expect(readOnlyGuard(f.conn).execute("SELECT 1")).rejects.toThrow(/execute/);
  });
});

const url = process.env.REGISTRY_TEST_DATABASE_URL;
describe.skipIf(!url)("sesión de solo lectura con MySQL real", () => {
  it("el servidor rechaza escrituras aunque se saltara la guarda", async () => {
    const admin = await mysql.createConnection(url!);
    await admin.query("CREATE DATABASE IF NOT EXISTS plan_ro_test");
    await admin.query("CREATE TABLE IF NOT EXISTS plan_ro_test.t (id INT)");
    const conn = await mysql.createConnection(url!);
    try {
      await conn.query("SET SESSION TRANSACTION READ ONLY");
      await conn.query("START TRANSACTION READ ONLY");
      const [[ro]] = (await conn.query("SELECT @@transaction_read_only AS ro")) as any;
      expect(Number(ro.ro)).toBe(1);
      await expect(conn.query("INSERT INTO plan_ro_test.t VALUES (1)")).rejects.toMatchObject({ code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" });
      await conn.query("ROLLBACK");
      const [[n]] = (await admin.query("SELECT COUNT(*) AS n FROM plan_ro_test.t")) as any;
      expect(Number(n.n)).toBe(0);
    } finally {
      await conn.end();
      await admin.query("DROP DATABASE IF EXISTS plan_ro_test");
      await admin.end();
    }
  });
});
