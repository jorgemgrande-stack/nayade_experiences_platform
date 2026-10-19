/**
 * Exportación de datos contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; dos BD de empresa aisladas, creadas
 * y borradas aquí, con 0009 stored_objects y 0011 data_exports): una exportación en curso por empresa (también a
 * la vez); lectura por páginas de todas las tablas; ficheros activos (no los borrados ni las exportaciones
 * previas); cada empresa solo ve lo suyo; ida y vuelta de la migración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import JSZip from "jszip";
import { splitStatements } from "../scripts/db/migrationLib";
import { buildExport } from "./dataExport/build";
import { MysqlDataExportStore, MysqlExportSource } from "./dataExport/service";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DBS = ["data_export_test_a", "data_export_test_b"];
const MIG = (f: string) => fs.readFileSync(path.resolve(__dirname, "../db/migrations", f), "utf8");
const NOW = Date.UTC(2026, 9, 20, 9);

describe.skipIf(!URL_)("exportación de datos con MySQL real (0011)", () => {
  let admin: mysql.Pool;
  const pools: mysql.Pool[] = [];

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    for (const [i, db] of DBS.entries()) {
      await admin.query(`DROP DATABASE IF EXISTS ${db}`);
      await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4`);
      const u = new URL(URL_!);
      u.pathname = `/${db}`;
      const pool = mysql.createPool({ uri: u.toString(), connectionLimit: 6 });
      pools.push(pool);
      for (const s of [...splitStatements(MIG("0009_stored_objects.sql")), ...splitStatements(MIG("0011_data_exports.sql"))]) await pool.query(s);
      await pool.query("CREATE TABLE clients (id INT PRIMARY KEY, name VARCHAR(80), passwordHash VARCHAR(80))");
      await pool.query("CREATE TABLE password_reset_tokens (id INT PRIMARY KEY, token VARCHAR(80))");
      const rows = Array.from({ length: 25 }, (_, k) => [k + 1, `Cliente ${String.fromCharCode(65 + i)}${k + 1}`, "hash-secreto"]);
      await pool.query("INSERT INTO clients VALUES ?", [rows]);
      await pool.query("INSERT INTO password_reset_tokens VALUES (1, 'tok-secreto')");
    }
  }, 120_000);

  afterAll(async () => {
    for (const p of pools) await p.end();
    for (const db of DBS) await admin?.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin?.end();
  });

  const objectRow = async (pool: mysql.Pool, id: string, category: string, status: string, key: string) => {
    const [cols] = await pool.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME c, IS_NULLABLE n, COLUMN_DEFAULT d, DATA_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stored_objects'");
    const v: Record<string, unknown> = { object_id: id, storage_key: key, visibility: "private", category, content_type: "application/pdf", size_bytes: 4, sha256: "0".repeat(64), status, created_at: NOW, updated_at: NOW };
    for (const c of cols) if (!(c.c in v) && c.n === "NO" && c.d === null) v[c.c] = /int/.test(c.t) ? 0 : "x";
    await pool.query("INSERT INTO stored_objects SET ?", [v]);
  };

  it("una exportación en curso por empresa, también con solicitudes simultáneas; otra empresa no se ve afectada", async () => {
    const [a, b] = pools.map((p) => new MysqlDataExportStore(() => p));
    const r = await Promise.allSettled([a.insertPending(7, NOW), a.insertPending(7, NOW)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.code).toBe("conflict");
    const other = await b.insertPending(9, NOW);
    expect(other.status).toBe("pending");
    const mine = (await a.list(10))[0];
    await a.markReady(mine.id, { objectId: "e".repeat(26), sizeBytes: 10, tableCount: 1, rowCount: 25, fileCount: 0, expiresAt: NOW + 1 }, NOW);
    await a.linkIssued(mine.id, NOW);
    expect(await a.downloaded("e".repeat(26), NOW)).toBe(true);
    expect(await b.downloaded("e".repeat(26), NOW)).toBe(false);
    expect(await a.get(mine.id)).toMatchObject({ status: "ready", linkCount: 1, downloadCount: 1 });
    expect((await b.list(10)).map((x) => x.requestedBy)).toEqual([9]);
    // Lista ya: se puede pedir otra en la misma empresa
    expect((await a.insertPending(7, NOW + 1)).status).toBe("pending");
  });

  it("lee todas las tablas por páginas y solo los ficheros activos de su empresa; sin secretos en el ZIP", async () => {
    const files = new Map([["t/a/o/invoice/1.pdf", Buffer.from("%PDF")], ["t/a/o/invoice/2.pdf", Buffer.from("%PDF")]]);
    await objectRow(pools[0], "1".repeat(26), "invoice", "active", "t/a/o/invoice/1.pdf");
    await objectRow(pools[0], "2".repeat(26), "invoice", "deleted", "t/a/o/invoice/2.pdf");
    await objectRow(pools[0], "3".repeat(26), "data-export", "active", "t/a/o/data-export/3.zip");
    const src = new MysqlExportSource(() => pools[0], async (k) => files.get(k) ?? null, 10);
    expect(await src.tables()).toEqual(expect.arrayContaining(["clients", "data_exports", "password_reset_tokens", "stored_objects"]));
    expect((await src.dump("clients")).rows).toHaveLength(25);
    await expect(src.dump("clients; DROP TABLE clients")).rejects.toThrow(/no válido/);
    expect((await src.files()).map((f) => f.objectId)).toEqual(["1".repeat(26)]);
    const r = await buildExport(src, { tenantId: "a", requestedBy: 7, now: NOW, maxBytes: 10 * 1048576 });
    const zip = await JSZip.loadAsync(r.zip);
    const csv = await zip.file("data/clients.csv")!.async("string");
    expect(csv).toContain("Cliente A25");
    expect(csv).not.toContain("Cliente B");
    expect(csv).not.toContain("hash-secreto");
    expect(zip.file("data/password_reset_tokens.csv")).toBeNull();
    expect(zip.file("data/data_exports.csv")).toBeNull();
    expect(r.fileCount).toBe(1);
  });

  it("la migración 0011 se revierte y se vuelve a aplicar", async () => {
    for (const s of splitStatements(MIG("0011_data_exports.down.sql"))) await pools[1].query(s);
    await expect(new MysqlDataExportStore(() => pools[1]).list(1)).rejects.toMatchObject({ code: "unavailable" });
    expect(await new MysqlDataExportStore(() => pools[1]).downloaded("x", NOW)).toBe(false);
    for (const s of splitStatements(MIG("0011_data_exports.sql"))) await pools[1].query(s);
    expect(await new MysqlDataExportStore(() => pools[1]).list(1)).toEqual([]);
  });
});
