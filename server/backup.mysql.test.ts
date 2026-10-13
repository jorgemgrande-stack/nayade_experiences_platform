/**
 * Copias de seguridad con restauración verificada (MySQL real, opt-in).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/backup.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import mysql from "mysql2/promise";
import { backupDatabase, verifyBackup } from "./_core/ops/backup";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("copias de seguridad", () => {
  let admin: mysql.Pool;
  let dir: string;
  const dsnFor = (db: string) => {
    const u = new URL(URL_!);
    u.pathname = `/${db}`;
    return u.toString();
  };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 3 });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "es-backup-"));
    for (const d of ["bk_source", "bk_scratch", "bk_scratch2"]) {
      await admin.query(`DROP DATABASE IF EXISTS ${d}`);
      await admin.query(`CREATE DATABASE ${d} CHARACTER SET utf8mb4`);
    }
    const src = await mysql.createConnection({ uri: dsnFor("bk_source"), multipleStatements: true });
    await src.query(`
      CREATE TABLE customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, notes TEXT,
        meta JSON, created_at DATETIME(3) NOT NULL, balance DECIMAL(12,2) NOT NULL DEFAULT 0, big BIGINT UNSIGNED);
      CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT NOT NULL, doc BLOB,
        CONSTRAINT fk_o FOREIGN KEY (customer_id) REFERENCES customers (id));
      CREATE TABLE empty_table (id INT PRIMARY KEY);
    `);
    await src.query("INSERT INTO customers (name, notes, meta, created_at, balance, big) VALUES (?,?,?,?,?,?)", [
      "Ñandú «Ó» 'comillas' \"dobles\" \\ barra",
      "línea 1\nlínea 2\t tab; punto y coma\n-- @@\nfalso separador",
      JSON.stringify({ a: [1, 2, { b: "ç" }], c: null }),
      "2026-10-13 10:11:12.345",
      "1234567.89",
      "18446744073709551615",
    ]);
    for (let i = 0; i < 1200; i++) {
      await src.query("INSERT INTO customers (name, created_at, balance) VALUES (?, NOW(3), ?)", [`cliente ${i}`, i / 100]);
    }
    await src.query("INSERT INTO orders (customer_id, doc) VALUES (1, ?)", [Buffer.from([0, 1, 2, 255, 254])]);
    await src.end();
  }, 60_000);

  afterAll(async () => {
    for (const d of ["bk_source", "bk_scratch", "bk_scratch2"]) await admin?.query(`DROP DATABASE IF EXISTS ${d}`);
    await admin?.end();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("copia y restaura: filas y checksum por tabla coinciden con el origen", async () => {
    const m = await backupDatabase(dsnFor("bk_source"), { tenantId: "t-bk", outDir: dir, batchRows: 100 });
    expect(m.tables.customers.rows).toBe(1201);
    expect(m.tables.orders.rows).toBe(1);
    expect(m.tables.empty_table.rows).toBe(0);
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);

    const manifestPath = path.join(dir, m.file.replace(/\.sql\.gz$/, ".manifest.json"));
    const rep = await verifyBackup(dsnFor("bk_scratch"), manifestPath);
    expect(rep).toMatchObject({ ok: true, problems: [], tables: 3, rows: 1202 });

    // Contenido exacto de los casos difíciles
    const c = await mysql.createConnection({ uri: dsnFor("bk_scratch"), dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
    const [r] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM customers WHERE id = 1");
    expect(r[0].name).toBe("Ñandú «Ó» 'comillas' \"dobles\" \\ barra");
    expect(r[0].notes).toContain("-- @@\nfalso separador");
    expect(r[0].big).toBe("18446744073709551615");
    expect(r[0].balance).toBe("1234567.89");
    expect(r[0].created_at).toBe("2026-10-13 10:11:12.345");
    const [o] = await c.query<mysql.RowDataPacket[]>("SELECT doc FROM orders");
    expect(Buffer.from(o[0].doc as Buffer)).toEqual(Buffer.from([0, 1, 2, 255, 254]));
    await c.end();
  }, 120_000);

  it("una copia alterada se detecta en la verificación", async () => {
    const m = await backupDatabase(dsnFor("bk_source"), { tenantId: "t-bk2", outDir: dir });
    const file = path.join(dir, m.file);
    const sql = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").replace("cliente 7'", "cliente 7-ALTERADO'");
    fs.writeFileSync(file, zlib.gzipSync(sql));
    const rep = await verifyBackup(dsnFor("bk_scratch2"), path.join(dir, m.file.replace(/\.sql\.gz$/, ".manifest.json")));
    expect(rep.ok).toBe(false);
    expect(rep.problems.join(" ")).toMatch(/SHA-256|checksum/);
  }, 120_000);
});
