/**
 * Exportación de datos contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; dos BD de empresa aisladas, creadas
 * y borradas aquí, con 0009 stored_objects, 0011 data_exports y 0012 trabajo asíncrono):
 *  - una exportación en curso por empresa (también a la vez); otra empresa no se ve afectada;
 *  - el trabajo reclama una sola vez aunque dos procesos lo intenten a la vez; un arriendo caducado se retoma; las
 *    que agotan sus intentos quedan fallidas; el límite diario cuenta las solicitudes;
 *  - lectura por lotes (clave primaria y compuesta) dentro de una INSTANTÁNEA coherente: lo que se escribe durante
 *    la exportación no aparece en ella; ficheros activos (no los borrados ni las exportaciones previas); sin secretos;
 *  - ida y vuelta de las migraciones 0011 y 0012; sin 0012 la exportación avisa de que falta actualizar la base.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import JSZip from "jszip";
import { splitStatements } from "../scripts/db/migrationLib";
import { buildExport } from "./dataExport/build";
import { MAX_ATTEMPTS, MysqlDataExportStore, MysqlExportSource } from "./dataExport/service";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DBS = ["data_export_test_a", "data_export_test_b"];
const MIG = (f: string) => fs.readFileSync(path.resolve(__dirname, "../db/migrations", f), "utf8");
const NOW = Date.UTC(2026, 9, 20, 9);
const run = async (pool: mysql.Pool, f: string) => {
  for (const s of splitStatements(MIG(f))) await pool.query(s);
};

describe.skipIf(!URL_)("exportación de datos con MySQL real (0011 + 0012)", () => {
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
      for (const f of ["0009_stored_objects.sql", "0011_data_exports.sql", "0012_data_export_jobs.sql"]) await run(pool, f);
      await pool.query("CREATE TABLE clients (id INT PRIMARY KEY, name VARCHAR(80), passwordHash VARCHAR(80))");
      await pool.query("CREATE TABLE line_items (order_id INT, line INT, qty INT, PRIMARY KEY (order_id, line))");
      await pool.query("CREATE TABLE password_reset_tokens (id INT PRIMARY KEY, token VARCHAR(80))");
      const rows = Array.from({ length: 25 }, (_, k) => [k + 1, `Cliente ${String.fromCharCode(65 + i)}${k + 1}`, "hash-secreto"]);
      await pool.query("INSERT INTO clients VALUES ?", [rows]);
      await pool.query("INSERT INTO line_items VALUES ?", [Array.from({ length: 23 }, (_, k) => [Math.floor(k / 5) + 1, k % 5, k])]);
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
    expect((await b.insertPending(9, NOW)).status).toBe("pending");
    expect((await b.list(10)).map((x) => x.requestedBy)).toEqual([9]);
    expect(await a.countSince(NOW - 1)).toBe(1);
    expect(await a.countSince(NOW + 1)).toBe(0);
  });

  it("reclamo atómico (dos procesos a la vez: uno solo gana); arriendo caducado se retoma; intentos agotados → fallida", async () => {
    const a = new MysqlDataExportStore(() => pools[0]);
    const claims = await Promise.all([a.claim(NOW, NOW - 1, MAX_ATTEMPTS), a.claim(NOW, NOW - 1, MAX_ATTEMPTS)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const row = claims.find(Boolean)!;
    expect(row).toMatchObject({ attempts: 1, heartbeatAt: NOW, startedAt: NOW });
    // Latido vigente: nadie la reclama
    expect(await a.claim(NOW + 1000, NOW, MAX_ATTEMPTS)).toBeNull();
    await a.heartbeat(row.id, NOW + 2000);
    expect(await a.claim(NOW + 3000, NOW + 1000, MAX_ATTEMPTS)).toBeNull();
    // Caducado: segundo y tercer intento
    expect((await a.claim(NOW + 10_000, NOW + 5000, MAX_ATTEMPTS))?.attempts).toBe(2);
    expect((await a.claim(NOW + 20_000, NOW + 15_000, MAX_ATTEMPTS))?.attempts).toBe(3);
    expect(await a.claim(NOW + 30_000, NOW + 25_000, MAX_ATTEMPTS)).toBeNull();
    expect(await a.failExhausted(NOW + 25_000, MAX_ATTEMPTS, "Interrumpida", NOW + 30_000)).toEqual([row.id]);
    expect(await a.get(row.id)).toMatchObject({ status: "failed", error: "Interrumpida" });
    // La de la otra empresa sigue en curso
    expect((await new MysqlDataExportStore(() => pools[1]).list(10))[0].status).toBe("pending");
  });

  it("lista con sus métricas; incompleta con aviso (no error); markReady solo si seguía en curso", async () => {
    const a = new MysqlDataExportStore(() => pools[0]);
    const e = await a.insertPending(7, NOW + 40_000);
    await a.claim(NOW + 40_000, NOW, MAX_ATTEMPTS);
    expect(await a.markReady(e.id, { objectId: "9".repeat(26), sizeBytes: 10, tableCount: 1, rowCount: 1, fileCount: 0, expiresAt: NOW + 5, warning: "1 fichero no estaba", durationMs: 1234, uncompressedBytes: 999, missingFiles: 1 }, NOW + 41_000)).toBe(true);
    expect(await a.get(e.id)).toMatchObject({ status: "ready", warning: "1 fichero no estaba", error: null, durationMs: 1234, uncompressedBytes: 999, missingFiles: 1 });
    expect(await a.markReady(e.id, { objectId: "8".repeat(26), sizeBytes: 1, tableCount: 0, rowCount: 0, fileCount: 0, expiresAt: 0 }, NOW)).toBe(false);
    expect(await a.markFailed(e.id, "x", NOW)).toBe(false);
  });

  it("instantánea coherente: lo escrito durante la exportación no aparece; lotes por clave simple y compuesta; sin secretos", async () => {
    const files = new Map([["t/a/o/invoice/1.pdf", Buffer.from("%PDF")], ["t/a/o/invoice/2.pdf", Buffer.from("%PDF")]]);
    await objectRow(pools[0], "1".repeat(26), "invoice", "active", "t/a/o/invoice/1.pdf");
    await objectRow(pools[0], "2".repeat(26), "invoice", "deleted", "t/a/o/invoice/2.pdf");
    await objectRow(pools[0], "3".repeat(26), "data-export", "active", "t/a/o/data-export/3.zip");
    const src = await new MysqlExportSource(() => pools[0], async (k) => files.get(k) ?? null, 10).open();
    try {
      expect(await src.tables()).toEqual(expect.arrayContaining(["clients", "line_items", "data_exports", "password_reset_tokens", "stored_objects"]));
      // Escritura concurrente (otra conexión) DESPUÉS de abrir la instantánea
      await pools[0].query("INSERT INTO clients VALUES (999, 'Cliente posterior', 'x')");
      const batches: number[] = [];
      for await (const b of src.rows("clients")) batches.push(b.length);
      expect(batches).toEqual([10, 10, 5]);
      let li = 0;
      for await (const b of src.rows("line_items")) li += b.length;
      expect(li).toBe(23);
      await expect((async () => { for await (const _ of src.rows("clients; DROP TABLE clients")) void _; })()).rejects.toThrow(/no válido/);
      expect((await src.files()).map((f) => f.objectId)).toEqual(["1".repeat(26)]);
      expect(await src.estimate()).toBeGreaterThan(0);
      const r = await buildExport(src, { tenantId: "a", requestedBy: 7, now: NOW, maxBytes: 10 * 1048576 });
      const zip = await JSZip.loadAsync(r.zip);
      const csv = await zip.file("data/clients.csv")!.async("string");
      expect(csv).toContain("Cliente A25");
      expect(csv).not.toContain("Cliente posterior");
      expect(csv).not.toContain("Cliente B");
      expect(csv).not.toContain("hash-secreto");
      expect(zip.file("data/password_reset_tokens.csv")).toBeNull();
      expect(zip.file("data/data_exports.csv")).toBeNull();
      expect(r.fileCount).toBe(1);
    } finally {
      await src.close();
      await pools[0].query("DELETE FROM clients WHERE id = 999");
    }
  });

  it("migraciones: sin 0012 la exportación avisa de la actualización pendiente; 0012 y 0011 se revierten y se vuelven a aplicar", async () => {
    const b = () => new MysqlDataExportStore(() => pools[1]);
    await run(pools[1], "0012_data_export_jobs.down.sql");
    await expect(b().claim(NOW, NOW, MAX_ATTEMPTS)).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/actualización/) });
    await run(pools[1], "0011_data_exports.down.sql");
    await expect(b().list(1)).rejects.toMatchObject({ code: "unavailable" });
    expect(await b().downloaded("x", NOW)).toBe(false);
    await run(pools[1], "0011_data_exports.sql");
    await run(pools[1], "0012_data_export_jobs.sql");
    expect(await b().list(1)).toEqual([]);
    expect(await b().claim(NOW, NOW, MAX_ATTEMPTS)).toBeNull();
  });
});
