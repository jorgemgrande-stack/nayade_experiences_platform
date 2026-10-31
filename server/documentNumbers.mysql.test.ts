/**
 * Numeración de documentos con concurrencia real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): una base
 * de datos desechable con la baseline + db/migrations y `generateDocumentNumber` real.
 *  - N altas simultáneas de una serie existente → números únicos y consecutivos que continúan la serie.
 *  - N altas simultáneas de una serie que aún no existe → una sola serie, números 1..N.
 *  - El prefijo y el valor actual de la serie se respetan (no se reinicia ni se cambia de serie).
 *  - La migración 0005 impide dos series del mismo tipo y año, y no se aplica si ya hay duplicados.
 * Datos sintéticos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const DB = `docnum_${run}`;
const DB_DUP = `docnum_dup_${run}`;
const YEAR = madridYear(); // el año de la numeración (Madrid)
const N = 40;

describe.skipIf(!URL_)("numeración de documentos (MySQL real, concurrencia)", () => {
  let admin: mysql.Pool;
  let db: mysql.Pool;
  let generate: typeof import("./documentNumbers").generateDocumentNumber;
  let closeAll: () => Promise<void>;
  const prevEnv = { DATABASE_URL: process.env.DATABASE_URL, TENANT_MODE: process.env.TENANT_MODE };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE DATABASE \`${DB}\``);
    await admin.query(`CREATE DATABASE \`${DB_DUP}\``);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    const { MysqlSchemaApplier } = await import("./_core/provisioning/mysqlAdapters");
    await new MysqlSchemaApplier({
      baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"),
      migrationsDir: path.resolve(__dirname, "../db/migrations"),
    }).apply(u.toString());
    db = mysql.createPool({ uri: u.toString(), connectionLimit: 2 });

    // Modo de una sola empresa: el acceso heredado usa DATABASE_URL (pool compartido de 10 conexiones).
    delete process.env.TENANT_MODE;
    process.env.DATABASE_URL = u.toString();
    generate = (await import("./documentNumbers")).generateDocumentNumber;
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    closeAll = closeAllDatabases;
  }, 120_000);

  afterAll(async () => {
    await closeAll?.().catch(() => undefined);
    await db?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS \`${DB_DUP}\``).catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (prevEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    if (prevEnv.TENANT_MODE !== undefined) process.env.TENANT_MODE = prevEnv.TENANT_MODE;
  });

  const pad = (n: number) => String(n).padStart(4, "0");

  it(`${N} altas simultáneas de una serie existente: números únicos, consecutivos y a continuación de los emitidos`, async () => {
    await db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('reserva', ?, 41, 'RES')", [YEAR]);
    const nums = await Promise.all(Array.from({ length: N }, (_, i) => generate("reserva", `prueba:${i}`, "test")));
    expect(new Set(nums).size).toBe(N);
    const expected = Array.from({ length: N }, (_, i) => `RES-${YEAR}-${pad(42 + i)}`);
    expect([...nums].sort()).toEqual(expected);
    const [[c]] = await db.query<mysql.RowDataPacket[]>("SELECT current_number FROM document_counters WHERE document_type = 'reserva' AND `year` = ?", [YEAR]);
    expect(c.current_number).toBe(41 + N);
    const [logs] = await db.query<mysql.RowDataPacket[]>("SELECT document_number FROM document_number_logs WHERE document_type = 'reserva'");
    expect(logs.map((l) => l.document_number).sort()).toEqual(expected);
    // La serie continúa tras la ráfaga
    expect(await generate("reserva")).toBe(`RES-${YEAR}-${pad(42 + N)}`);
  });

  it(`${N} altas simultáneas de una serie nueva: una sola serie y números 1..${N}`, async () => {
    const nums = await Promise.all(Array.from({ length: N }, () => generate("tpv")));
    expect([...nums].sort()).toEqual(Array.from({ length: N }, (_, i) => `TPV-${YEAR}-${pad(i + 1)}`));
    const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT current_number, prefix FROM document_counters WHERE document_type = 'tpv' AND `year` = ?", [YEAR]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ current_number: N, prefix: "TPV" });
  });

  it("respeta el prefijo personalizado y el valor de la serie; otras series no se ven afectadas", async () => {
    await db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('factura', ?, 7, 'FV')", [YEAR]);
    const [a, b] = await Promise.all([generate("factura"), generate("presupuesto")]);
    expect(a).toBe(`FV-${YEAR}-0008`);
    expect(b).toBe(`PRES-${YEAR}-0001`);
    const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT document_type, current_number FROM document_counters WHERE `year` = ? ORDER BY document_type", [YEAR]);
    expect(Object.fromEntries(rows.map((r) => [r.document_type, r.current_number]))).toEqual({ factura: 8, presupuesto: 1, reserva: 42 + N, tpv: N });
  });

  it("la migración 0005 impide una segunda serie del mismo tipo y año", async () => {
    await expect(
      db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('reserva', ?, 0, 'RES')", [YEAR]),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("la migración 0005 no se aplica (ni deja nada a medias) si ya hay series duplicadas", async () => {
    const { splitStatements } = await import("../scripts/db/migrationLib");
    const up = splitStatements(fs.readFileSync(path.resolve(__dirname, "../db/migrations/0005_document_counters_unique.sql"), "utf8"));
    expect(up).toHaveLength(1);
    const u = new URL(URL_!);
    u.pathname = `/${DB_DUP}`;
    const conn = await mysql.createConnection({ uri: u.toString() });
    try {
      await conn.query(
        "CREATE TABLE document_counters (id int AUTO_INCREMENT PRIMARY KEY, document_type varchar(32) NOT NULL, `year` int NOT NULL, current_number int NOT NULL DEFAULT 0, prefix varchar(16) NOT NULL)",
      );
      await conn.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('reserva', 2026, 5, 'RES'), ('reserva', 2026, 5, 'RES')");
      await expect(conn.query(up[0])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      const [idx] = await conn.query<mysql.RowDataPacket[]>("SHOW INDEX FROM document_counters WHERE Key_name = 'uq_document_counters_type_year'");
      expect(idx).toHaveLength(0);
      const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, SUM(current_number) AS s FROM document_counters");
      expect(rows[0]).toMatchObject({ n: 2 });
      expect(Number(rows[0].s)).toBe(10);
    } finally {
      await conn.end();
    }
  });
});
