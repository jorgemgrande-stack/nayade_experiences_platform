/**
 * Resúmenes del filtro completo (Transacciones y Gastos): composición del filtro sin base de datos y reglas de
 * lectura. Los totales contra MySQL real están en economiaResumen.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { buildExpenseConditions, escapeLike } from "./expensesQuery";

const dialect = new MySqlDialect();
const q = (f: Parameters<typeof buildExpenseConditions>[0]) => {
  const w = buildExpenseConditions(f);
  return w ? dialect.sqlToQuery(w) : null;
};
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("filtro de gastos (listado y resumen comparten el mismo where)", () => {
  it("sin filtros no hay where", () => {
    expect(q({})).toBeNull();
    expect(q({ treatment: "all", search: "  " })).toBeNull();
  });
  it("la búsqueda es parametrizada y escapa comodines", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
    const r = q({ search: "luz%" })!;
    expect(r.sql).toContain("like");
    expect(r.sql).not.toContain("luz");
    expect(r.params).toEqual(["%luz\\%%", "%luz\\%%"]);
  });
  it("cada filtro añade su condición con parámetros", () => {
    const r = q({ status: "pending", treatment: "tax_only", source: "email", attachment: "missing", dateFrom: "2026-01-01", dateTo: "2026-02-01", categoryId: 3 })!;
    expect(r.params).toEqual(expect.arrayContaining(["pending", "email", "2026-01-01", "2026-02-01", 3]));
    expect((r.sql.match(/ and /g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe("solo lectura y permisos", () => {
  it("el resumen y el listado de gastos exigen el permiso de lectura y no escriben", () => {
    const src = read("expensesQuery.ts");
    expect(src).not.toMatch(/\.(insert|update|delete)\(/);
    const router = read("routers/expenses.ts");
    expect(router).toMatch(/filterSummary: adminProcedure/);
    expect(router).toContain("summarizeExpenses(db, input)");
  });
  it("el resumen de transacciones usa el mismo where que el listado y es una consulta de administración", () => {
    const db = read("db.ts");
    const body = db.slice(db.indexOf("export async function summarizeTransactions"), db.indexOf("export async function getTransactionsSummary"));
    expect(body).toContain("buildTxWhere(db, params)");
    expect(body).not.toMatch(/\.(insert|update|delete)\(/);
    expect(read("routers.ts")).toMatch(/getTransactionsSummary: adminProcedure/);
  });
});
