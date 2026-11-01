/**
 * Diagnóstico del desglose de facturas emitidas contra MySQL de pruebas (opt-in, REGISTRY_TEST_DATABASE_URL):
 * señala las facturas a revisar y no escribe nada (ni en la transacción de solo lectura).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33381/registro_test \
 *     pnpm vitest run server/invoiceBreakdownDiagnosis.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { diagnoseInvoices, diagnoseInvoice, formatDiagnosis } from "./invoiceBreakdownDiagnosis";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `diag_desglose_${process.pid}`;

describe("diagnoseInvoice (sin BD)", () => {
  const base = { invoiceNumber: "F", invoiceType: "factura", status: "cobrada", issuedAt: "2026-05-01", quoteId: null, quoteDiscount: null, discount: 0, taxRate: 21, taxBreakdown: null };
  it("factura correcta: sin señales", () => {
    expect(diagnoseInvoice({ ...base, itemsJson: [{ total: 121, taxRate: 21 }], subtotal: 100, taxAmount: 21, total: 121, taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] }).issues).toEqual([]);
  });
  it("presupuesto con descuento cuyo IVA salió de las líneas sin descontar", () => {
    expect(diagnoseInvoice({ ...base, quoteId: 3, quoteDiscount: "12.10", itemsJson: [{ total: 121, taxRate: 21 }], subtotal: 90, taxAmount: 21, total: 108.9 }).issues)
      .toEqual(["base_mas_iva_distinto_total", "presupuesto_con_descuento"]);
  });
});

describe.skipIf(!URL_)("diagnóstico de facturas emitidas (MySQL de pruebas)", () => {
  let root: mysql.Connection;
  let conn: mysql.Connection;
  const checksum = async () => (await root.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${DB}\`.invoices, \`${DB}\`.quotes`))[0].map((r) => String(r.Checksum)).join(",");

  beforeAll(async () => {
    root = await mysql.createConnection({ uri: URL_! });
    await root.query(`CREATE DATABASE \`${DB}\``);
    await root.query(`CREATE TABLE \`${DB}\`.quotes (id INT PRIMARY KEY, discount DECIMAL(10,2) DEFAULT 0)`);
    await root.query(`CREATE TABLE \`${DB}\`.invoices (
      id INT AUTO_INCREMENT PRIMARY KEY, invoiceNumber VARCHAR(50), invoiceType VARCHAR(20) DEFAULT 'factura', status VARCHAR(20) DEFAULT 'cobrada',
      issuedAt DATETIME, quoteId INT NULL, itemsJson JSON, subtotal DECIMAL(10,2), discount DECIMAL(10,2) DEFAULT 0, taxRate DECIMAL(5,2) DEFAULT 21,
      taxAmount DECIMAL(10,2), taxBreakdown JSON NULL, total DECIMAL(10,2))`);
    await root.query(`INSERT INTO \`${DB}\`.quotes VALUES (1, 12.10), (2, 0), (3, 23.10)`);
    // Como las emitía el código anterior: IVA de las líneas sin descontar, total = subtotal + IVA, sin desglose…
    const rows: unknown[][] = [
      ["FAC-2026-0001", 1, '[{"total":121,"taxRate":21}]', 90, 21, null, 108.9],                                   // descuento, base + IVA ≠ total
      ["FAC-2026-0002", 2, '[{"total":145.2,"taxRate":21}]', 120, 25.2, null, 145.2],                                // correcta
      ["FAC-2026-0003", 3, '[{"total":121,"taxRate":21},{"total":110,"taxRate":10}]', 180, 31, null, 211],           // descuento, mixta sin desglose, total inflado
      ["FAC-2026-0004", null, '[{"total":121,"taxRate":21},{"total":110,"taxRate":10}]', 200, 31, '[{"rate":21,"base":100,"amount":21},{"rate":10,"base":100,"amount":10}]', 231], // mixta con desglose: correcta
      ["FAC-2026-0005", null, '[{"total":60.5,"taxRate":21},{"total":33,"taxRate":10}]', 80, 13.5, null, 93.5],     // mixta sin desglose
    ];
    for (const r of rows) {
      await root.query(`INSERT INTO \`${DB}\`.invoices (invoiceNumber, quoteId, itemsJson, subtotal, taxAmount, taxBreakdown, total, issuedAt) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-05-02 10:00:00')`, r);
    }
    conn = await mysql.createConnection({ uri: URL_!.replace(/\/[^/]*$/, `/${DB}`) });
    await conn.query("SET SESSION TRANSACTION READ ONLY");
  });

  afterAll(async () => {
    await conn?.end();
    await root?.query(`DROP DATABASE IF EXISTS \`${DB}\``);
    await root?.end();
  });

  it("señala las facturas a revisar y no escribe nada", async () => {
    const before = await checksum();
    const r = await diagnoseInvoices(conn);
    expect(await checksum()).toBe(before);
    expect(r.checked).toBe(5);
    expect(r.findings.map((f) => [f.invoiceNumber, f.issues])).toEqual([
      ["FAC-2026-0001", ["base_mas_iva_distinto_total", "presupuesto_con_descuento"]],
      ["FAC-2026-0003", ["varios_tipos_sin_desglose", "presupuesto_con_descuento"]],
      ["FAC-2026-0005", ["varios_tipos_sin_desglose"]],
    ]);
    expect(r.byIssue).toEqual({ base_mas_iva_distinto_total: 1, varios_tipos_sin_desglose: 2, presupuesto_con_descuento: 2, desglose_supera_total: 0 });
    const text = formatDiagnosis(r);
    expect(text).toContain("Documentos revisados: 5. Con algo que revisar: 3.");
    expect(text).toContain("FAC-2026-0003");
    console.log(text);
  });

  it("la sesión de solo lectura impide escribir aunque se intentara", async () => {
    await expect(conn.query("UPDATE invoices SET total = 0")).rejects.toThrow(/READ ONLY/i);
  });
});
