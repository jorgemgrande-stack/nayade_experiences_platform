/**
 * Verificación de esquema de la exportación (backup-job check-data-exports) contra MySQL real (opt-in,
 * REGISTRY_TEST_DATABASE_URL): sin tabla, solo 0011, 0011+0012 y completa. Solo lectura.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { splitStatements } from "../scripts/db/migrationLib";
import { dataExportSchemaStatus } from "./_core/ops/dataExportCheck";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "data_export_check_test";
const MIG = (f: string) => fs.readFileSync(path.resolve(__dirname, "../db/migrations", f), "utf8");

describe.skipIf(!URL_)("verificación del esquema de exportación (MySQL real)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  const run = async (f: string) => {
    for (const s of splitStatements(MIG(f))) await pool.query(s);
  };
  const status = () => dataExportSchemaStatus(async (q, p) => (await pool.query(q, p))[0] as Array<Record<string, unknown>>);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 2 });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("indica exactamente qué falta en cada paso y cuántas hay en curso", async () => {
    expect(await status()).toEqual({ table: false, jobColumns: false, purgeColumn: false, missing: ["0011_data_exports", "0012_data_export_jobs", "0013_data_export_purge"], pending: null, ok: false });
    await run("0011_data_exports.sql");
    expect((await status()).missing).toEqual(["0012_data_export_jobs", "0013_data_export_purge"]);
    await run("0012_data_export_jobs.sql");
    expect((await status()).missing).toEqual(["0013_data_export_purge"]);
    await run("0013_data_export_purge.sql");
    await pool.query("INSERT INTO data_exports (requested_by, status, requested_at) VALUES (1, 'pending', 1)");
    expect(await status()).toEqual({ table: true, jobColumns: true, purgeColumn: true, missing: [], pending: 1, ok: true });
  });
});
