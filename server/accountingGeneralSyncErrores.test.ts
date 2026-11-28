/**
 * Contabilidad general — lectura de caja: solo se tolera «tabla inexistente» (ER_NO_SUCH_TABLE / 1146, también en
 * `cause`); cualquier otro error se propaga para que el grupo cash quede en failedGroups y no se reemplacen asientos
 * de fianza con el tipo equivocado. Sin BD: ejecutor simulado.
 */
import { describe, expect, it } from "vitest";
import { ACC_DEFAULT_MAP } from "../shared/accountingGeneral";
import { isMissingTableError, readCash, type SourceRead } from "./accountingGeneral/sources";

const noTable = () => Object.assign(new Error("Table 'x.ski_deposit_events' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
const otherError = () => Object.assign(new Error("Lock wait timeout"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });

/** Simula Db: select() encadenable que resuelve las filas en orden (sesiones, movimientos, gastos); execute() según el orden. */
function fakeDb(executes: Array<() => unknown>) {
  const rows: unknown[][] = [[], [{ id: 7, type: "in", amount: "10.00", reason: "Fianza", createdAt: Date.now() }], []];
  let s = 0;
  let x = 0;
  const chain: any = new Proxy({}, { get: (_t, p) => (p === "then" ? (res: any) => res(rows[s++] ?? []) : () => chain) });
  return { select: () => chain, execute: async () => executes[x++]!() } as any;
}
const fresh = (): SourceRead => ({ desired: new Map(), groups: [], failed: [], problems: [], review: [] });
const ctx = { startDate: "2020-01-01", map: ACC_DEFAULT_MAP, categoryAccounts: new Map<number, string>() };
const kindsOk = () => [[]];
const emptyRows = () => [[]];

describe("isMissingTableError", () => {
  it("reconoce el código, el errno y la causa envuelta", () => {
    expect(isMissingTableError(noTable())).toBe(true);
    expect(isMissingTableError({ errno: 1146 })).toBe(true);
    expect(isMissingTableError(new Error("Failed query", { cause: noTable() }))).toBe(true);
    expect(isMissingTableError(otherError())).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("readCash: errores de las lecturas opcionales", () => {
  it("fianzas: tabla inexistente -> como antes (sigue y lee las correcciones)", async () => {
    const out = fresh();
    await readCash(fakeDb([kindsOk, () => { throw noTable(); }, emptyRows]), ctx, out);
    expect(out.desired.has("cajamov:7")).toBe(true);
  });
  it("fianzas: otro error -> se propaga", async () => {
    await expect(readCash(fakeDb([kindsOk, () => { throw otherError(); }, emptyRows]), ctx, fresh())).rejects.toMatchObject({ code: "ER_LOCK_WAIT_TIMEOUT" });
  });
  it("correcciones: tabla inexistente (en cause) -> como antes", async () => {
    const out = fresh();
    await readCash(fakeDb([kindsOk, emptyRows, () => { throw new Error("Failed query", { cause: noTable() }); }]), ctx, out);
    expect(out.desired.has("cajamov:7")).toBe(true);
  });
  it("correcciones: otro error -> se propaga", async () => {
    await expect(readCash(fakeDb([kindsOk, emptyRows, () => { throw otherError(); }]), ctx, fresh())).rejects.toMatchObject({ code: "ER_LOCK_WAIT_TIMEOUT" });
  });
});
