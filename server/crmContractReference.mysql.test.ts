/**
 * Referencias de contrato CT-AAAA-NNNNNN (D5): el relleno de la migración 0002 sigue la misma regla
 * que el código, sin truncar ids grandes, sin colisiones y sin tocar referencias existentes.
 * MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL); BD aislada creada y borrada aquí.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { CrmService, contractReference } from "./crm/service";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";

const CRM_MIGRATIONS = path.resolve(__dirname, "../db/crm/migrations");
const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("referencias de contrato (MySQL real)", () => {
  let admin: mysql.Pool;
  beforeAll(() => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
  });
  afterAll(async () => {
    await admin?.end();
  });
  it("0002: el relleno usa CT-AAAA-NNNNNN igual que el código, sin truncar ids grandes, sin colisiones y sin tocar referencias existentes", async () => {
    const db = "crm_test_ref";
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${db}`;
    const p = mysql.createPool({ uri: u.toString(), connectionLimit: 2 });
    try {
      const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
      for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await p.query(s);
      const { migrations } = loadMigrations(CRM_MIGRATIONS);
      for (const s of splitStatements(migrations[0].up)) await p.query(s); // 0001
      // Contratos ANTERIORES a la 0002 (sin columna reference), en el límite de año y con ids grandes
      await p.query("INSERT INTO crm_companies (id, name, created_at) VALUES (1, 'Previa', 1)");
      const rows: Array<[number, number]> = [
        [7, Date.UTC(2025, 11, 31, 23, 30)], // 31/12/2025 23:30 UTC (ya 2026 en Madrid): debe ser 2025
        [999999, Date.UTC(2026, 0, 1, 0, 0, 1)],
        [1000000, Date.UTC(2026, 5, 15)],
        [1234567, Date.UTC(2024, 1, 29, 12)],
      ];
      for (const [id, at] of rows) await p.query("INSERT INTO crm_contracts (id, company_id, modules, created_at) VALUES (?, 1, '[]', ?)", [id, at]);
      // 0002 en una conexión cuya zona horaria NO es UTC: no debe influir en el año
      const one = await p.getConnection();
      try {
        await one.query("SET time_zone = '+05:00'");
        for (const s of splitStatements(migrations[1].up)) await one.query(s);
      } finally {
        one.release();
      }
      const [got] = await p.query<mysql.RowDataPacket[]>("SELECT id, reference FROM crm_contracts ORDER BY id");
      expect(got.map((r) => [Number(r.id), r.reference])).toEqual([
        [7, "CT-2025-000007"],
        [999999, "CT-2026-999999"],
        [1000000, "CT-2026-1000000"],
        [1234567, "CT-2024-1234567"],
      ]);
      // Misma regla que el código
      for (const [id, at] of rows) expect(got.find((r) => Number(r.id) === id)!.reference).toBe(contractReference(id, at));
      // El relleno no toca referencias ya asignadas
      await p.query("UPDATE crm_contracts SET reference = 'CT-MANUAL-1' WHERE id = 7");
      await p.query("UPDATE crm_contracts SET reference = NULL WHERE id = 999999");
      const backfill = splitStatements(migrations[1].up).find((s) => s.startsWith("UPDATE crm_contracts"))!;
      await p.query(backfill);
      const [again] = await p.query<mysql.RowDataPacket[]>("SELECT id, reference FROM crm_contracts WHERE id IN (7, 999999) ORDER BY id");
      expect(again.map((r) => r.reference)).toEqual(["CT-MANUAL-1", "CT-2026-999999"]);
      // Un contrato nuevo (código) tras los rellenados: id siguiente y sin colisión
      const svc = new CrmService({
        store: new MysqlCrmStore(p),
        activation: { activate: async () => ({ tenantId: "x" }) },
        now: () => Date.UTC(2026, 9, 15),
      });
      const c = await svc.createContract({ companyId: 1, planId: "base", modules: [] }, "t");
      expect(c.id).toBe(1234568);
      expect(c.reference).toBe("CT-2026-1234568");
      // Una colisión forzada la rechaza la clave única
      await expect(p.query("UPDATE crm_contracts SET reference = 'CT-2026-1234568' WHERE id = 1000000")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      const [[dups]] = (await p.query<mysql.RowDataPacket[]>("SELECT COUNT(*) - COUNT(DISTINCT reference) AS d FROM crm_contracts")) as any;
      expect(Number(dups.d)).toBe(0);
    } finally {
      await p.end();
      await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    }
  });
});
