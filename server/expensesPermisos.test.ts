/**
 * Gastos del panel de empresa: leer exige accounting.expenses.view y TODA escritura accounting.expenses.manage
 * (antes el permiso de lectura bastaba también para crear, editar y borrar).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "routers/expenses.ts"), "utf8").replace(/\r\n/g, "\n");

/** Cada procedimiento con su guarda y si es consulta o mutación. */
function procedures() {
  const out: Array<{ name: string; guard: string; kind: "query" | "mutation" }> = [];
  const re = /\n\s+([A-Za-z0-9_]+):\s*(adminProcedure|manageProcedure)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    const q = rest.search(/\.query\(/);
    const mu = rest.search(/\.mutation\(/);
    out.push({ name: m[1], guard: m[2], kind: mu >= 0 && (q < 0 || mu < q) ? "mutation" : "query" });
  }
  return out;
}

describe("permisos de gastos", () => {
  it("las mutaciones exigen gestionar y las consultas, ver", () => {
    const p = procedures();
    expect(p.length).toBeGreaterThan(20);
    expect(p.filter((x) => x.kind === "mutation" && x.guard !== "manageProcedure").map((x) => x.name)).toEqual([]);
    expect(p.filter((x) => x.kind === "query" && x.guard !== "adminProcedure").map((x) => x.name)).toEqual([]);
    expect(src).toContain('permissionProcedure("accounting.expenses.manage", ["admin"])');
  });
});
