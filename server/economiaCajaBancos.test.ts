/**
 * Lote E3 de Economía (Caja y Movimientos bancarios), sin base de datos: composición de los filtros, reglas de solo
 * lectura y permisos de las consultas nuevas. Los totales contra MySQL real están en economiaCajaBancos.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { buildBankConditions } from "./bankQuery";
import { buildCashMovementConditions } from "./cashQuery";

const dialect = new MySqlDialect();
const bank = (f: Parameters<typeof buildBankConditions>[0]) => { const w = buildBankConditions(f); return w ? dialect.sqlToQuery(w) : null; };
const cash = (f: Parameters<typeof buildCashMovementConditions>[0]) => { const w = buildCashMovementConditions(f); return w ? dialect.sqlToQuery(w) : null; };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("filtro de movimientos bancarios (listado y resumen comparten el mismo where)", () => {
  it("sin filtros no hay where", () => {
    expect(bank({})).toBeNull();
    expect(bank({ status: "todos", conciliation: "todos", search: "  " })).toBeNull();
  });
  it("la búsqueda es parametrizada, escapa comodines y mira movimiento y más datos", () => {
    const r = bank({ search: "luz%" })!;
    expect(r.sql).toContain("like");
    expect(r.sql).not.toContain("luz");
    expect(r.params).toEqual(["%luz\\%%", "%luz\\%%"]);
    expect(r.sql).toContain("`movimiento`");
    expect(r.sql).toContain("`mas_datos`");
  });
  it("cada estado de conciliación añade sus condiciones", () => {
    expect(bank({ conciliation: "sin_conciliar" })!.params).toEqual(["pendiente", "pendiente"]);
    const c = bank({ conciliation: "conciliado" })!;
    expect(c.params).toEqual(["pendiente", "conciliado", "0"]);
    expect(c.sql).toContain(">=");
    const g = bank({ conciliation: "gasto_vinculado" })!;
    expect(g.params).toEqual(["pendiente", "conciliado", "0"]);
    expect(g.sql).toContain("<");
    expect(bank({ conciliation: "ignorado" })!.params).toEqual(["ignorado"]);
  });
  it("el resto de filtros viajan como parámetros", () => {
    const r = bank({ importId: 3, fechaFrom: "2026-01-01", fechaTo: "2026-02-01", status: "pendiente" })!;
    expect(r.params).toEqual(expect.arrayContaining([3, "2026-01-01", "2026-02-01", "pendiente"]));
  });
});

describe("filtro de movimientos de caja (listado paginado y resumen comparten el mismo where)", () => {
  it("sin filtros no hay where", () => {
    expect(cash({})).toBeNull();
    expect(cash({ search: " " })).toBeNull();
  });
  it("la búsqueda mira concepto, contraparte y notas con parámetros", () => {
    const r = cash({ search: "50%" })!;
    expect(r.params).toEqual(["%50\\%%", "%50\\%%", "%50\\%%"]);
    for (const col of ["concept", "counterparty", "notes"]) expect(r.sql).toContain(`\`${col}\``);
  });
  it("cuenta y fechas", () => {
    expect(cash({ accountId: 2, dateFrom: "2026-01-01", dateTo: "2026-03-01" })!.params).toEqual([2, "2026-01-01", "2026-03-01"]);
  });
});

describe("solo lectura y permisos", () => {
  it("las consultas nuevas no escriben en la base de datos", () => {
    for (const f of ["bankQuery.ts", "cashQuery.ts"]) expect(read(f), f).not.toMatch(/\.(insert|update|delete)\(/);
  });
  it("Movimientos bancarios: el resumen y el listado usan el mismo filtro y la misma guarda de administración", () => {
    const r = read("routers/bankMovements.ts");
    expect(r).toMatch(/movementsSummary: adminProc/);
    expect(r).toMatch(/listMovements: adminProc\s+\.input\(bankListInput\)/);
    expect(r).toContain("listBankMovements(db, input)");
    expect(r).toContain("summarizeBankMovements(db, input)");
    // La búsqueda ya no se hace en memoria sobre todo el extracto
    expect(r).not.toContain("Client-side search filter");
  });
  it("Caja: las consultas nuevas exigen el permiso de lectura de caja", () => {
    const r = read("routers/cashRegister.ts");
    for (const p of ["listMovementsPage", "movementsSummary", "overview"]) expect(r, p).toMatch(new RegExp(`${p}: cashViewProc`));
    expect(r).toContain("listCashMovementsPage(db, input)");
    expect(r).toContain("summarizeCashMovements(db, input)");
  });
  it("las operaciones económicas de Caja y Banco no se han tocado", () => {
    const r = read("routers/cashRegister.ts");
    // Mismo mapa de saldo: el ajuste (adjustment) no mueve el saldo y el dato no guarda signo
    expect(r).toMatch(/function balanceDelta[\s\S]*?return 0;/);
    expect(r).toContain('const INCOME_TYPES = ["income", "transfer_in", "opening_balance"] as const;');
    expect(r).toContain('const EXPENSE_TYPES = ["expense", "transfer_out"] as const;');
    const b = read("routers/bankMovements.ts");
    for (const p of ["findMatches", "rejectLink", "unlinkMovement", "manuallyConciliate", "updateMovementStatus"]) expect(b, p).toContain(`${p}: adminProc`);
  });
});
