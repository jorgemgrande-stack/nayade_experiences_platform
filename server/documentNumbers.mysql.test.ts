/**
 * Numeración de documentos con concurrencia real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): una base
 * de datos desechable con la baseline + db/migrations y `generateDocumentNumber` real.
 *  - N altas simultáneas de una serie existente → números únicos y consecutivos que continúan la serie.
 *  - N altas simultáneas de una serie que aún no existe → una sola serie, números 1..N.
 *  - El prefijo y el valor actual de la serie se respetan (no se reinicia ni se cambia de serie).
 *  - La migración 0005 impide dos series del mismo tipo y año, y no se aplica si ya hay duplicados.
 * Datos sintéticos.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
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

  it("las devoluciones tienen serie propia DEV: no consumen la de facturas y saltan números DEV- ya usados", async () => {
    await db.query("DELETE FROM document_counters WHERE document_type IN ('factura','devolucion') AND `year` = ?", [YEAR]);
    await db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('factura', ?, 100, 'FAC')", [YEAR]);
    const taken = new Set([`DEV-${YEAR}-0001`, `DEV-${YEAR}-0002`]); // devoluciones antiguas que ya ocupan esos números
    const exists = async (n: string) => taken.has(n);
    const refunds = await Promise.all(Array.from({ length: 5 }, () => generate("devolucion", "prueba", "1", exists)));
    expect([...refunds].sort()).toEqual([3, 4, 5, 6, 7].map((n) => `DEV-${YEAR}-${pad(n)}`));
    const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT current_number FROM document_counters WHERE document_type = 'factura' AND `year` = ?", [YEAR]);
    expect(rows[0].current_number).toBe(100); // la serie fiscal de facturas no se ha movido
    expect(await generate("factura")).toBe(`FAC-${YEAR}-0101`);
  });

  describe("devoluciones DEV: robustez ante DEV- históricos (nextRefundTransactionNumber)", () => {
    const devNo = (n: number, y = YEAR) => `DEV-${y}-${pad(n)}`;
    const insertTx = async (numbers: string[]) => {
      if (!numbers.length) return;
      await db.query(
        "INSERT INTO transactions (transactionNumber, type, amount, status) VALUES " + numbers.map(() => "(?, 'reembolso', -1.00, 'completado')").join(","),
        numbers,
      );
    };
    const counter = async (type: string, y = YEAR) => {
      const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT current_number FROM document_counters WHERE document_type = ? AND `year` = ?", [type, y]);
      return rows.length ? Number(rows[0].current_number) : null;
    };
    let nextRefund: typeof import("./refundNumber").nextRefundTransactionNumber;
    let raise: typeof import("./documentNumbers").raiseCounterToAtLeast;
    beforeEach(async () => {
      nextRefund = (await import("./refundNumber")).nextRefundTransactionNumber;
      raise = (await import("./documentNumbers")).raiseCounterToAtLeast;
      await db.query("DELETE FROM transactions WHERE transactionNumber LIKE 'DEV-%'");
      await db.query("DELETE FROM document_counters WHERE document_type IN ('factura','devolucion')");
      await db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('factura', ?, 100, 'FAC')", [YEAR]);
    });
    afterAll(async () => {
      await db?.query("DELETE FROM transactions WHERE transactionNumber LIKE 'DEV-%'").catch(() => undefined);
    });

    it("200 DEV consecutivos 1..200 ya existentes: 20 devoluciones simultáneas obtienen 201..220 sin duplicados ni huecos, y FAC no se mueve", async () => {
      await insertTx(Array.from({ length: 200 }, (_, i) => devNo(i + 1)));
      const got = await Promise.all(Array.from({ length: 20 }, (_, i) => nextRefund(`prueba:${i}`, 1)));
      expect(new Set(got).size).toBe(20);
      expect([...got].sort()).toEqual(Array.from({ length: 20 }, (_, i) => devNo(201 + i)));
      await insertTx(got); // el UNIQUE de transactionNumber no se viola
      expect(await counter("devolucion")).toBe(220);
      expect(await counter("factura")).toBe(100);
      expect(await generate("factura")).toBe(`FAC-${YEAR}-0101`);
    }, 60_000);

    it("DEV existentes no consecutivos: el contador salta al máximo y no repite ninguno", async () => {
      await insertTx([devNo(5), devNo(17), devNo(300)]);
      const got = await Promise.all(Array.from({ length: 6 }, () => nextRefund("prueba", 1)));
      expect([...got].sort()).toEqual([301, 302, 303, 304, 305, 306].map((n) => devNo(n)));
      expect(await counter("factura")).toBe(100);
    });

    it("contador por debajo del máximo existente: se adelanta; por encima: no retrocede nunca", async () => {
      await db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('devolucion', ?, 3, 'DEV')", [YEAR]);
      await insertTx([devNo(1), devNo(2), devNo(3), devNo(40)]);
      expect(await nextRefund("prueba", 1)).toBe(devNo(41));
      // contador muy por encima del máximo existente: se respeta
      await db.query("UPDATE document_counters SET current_number = 500 WHERE document_type = 'devolucion' AND `year` = ?", [YEAR]);
      expect(await nextRefund("prueba", 1)).toBe(devNo(501));
      await raise("devolucion", YEAR, 10);
      expect(await counter("devolucion")).toBe(501);
    });

    it("cambio de año: los DEV de otros años no afectan a la serie del año en curso y su contador no se toca", async () => {
      await insertTx([devNo(900, YEAR - 1), devNo(950, YEAR + 1)]);
      await db.query("INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('devolucion', ?, 7, 'DEV')", [YEAR - 1]);
      expect(await nextRefund("prueba", 1)).toBe(devNo(1)); // serie del año en curso: empieza en 1
      expect(await counter("devolucion", YEAR - 1)).toBe(7);
      expect(await counter("devolucion", YEAR + 1)).toBeNull();
    });

    it("sin DEV existentes empieza en DEV-AAAA-0001 y no consume la serie de facturas", async () => {
      expect(await nextRefund("prueba", 1)).toBe(devNo(1));
      expect(await counter("factura")).toBe(100);
    });

    it("raiseCounterToAtLeast rechaza las series fiscales y valores no válidos no hacen nada", async () => {
      await expect(raise("factura", YEAR, 5000)).rejects.toThrow(/fiscal/);
      await expect(raise("abono", YEAR, 5000)).rejects.toThrow(/fiscal/);
      expect(await counter("factura")).toBe(100);
      await raise("devolucion", YEAR, 0);
      await raise("devolucion", YEAR, -4);
      expect(await counter("devolucion")).toBeNull();
    });

    it("más de 50 números ocupados seguidos ya no bloquea (el tope antiguo era 50); a partir de 1000 falla con error explícito", async () => {
      const taken = new Set(Array.from({ length: 120 }, (_, i) => devNo(i + 1)));
      expect(await generate("devolucion", "prueba", "1", async (n) => taken.has(n))).toBe(devNo(121));
      await expect(generate("devolucion", "prueba", "1", async () => true)).rejects.toThrow(/tras 1000 intentos/);
    }, 60_000);
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
