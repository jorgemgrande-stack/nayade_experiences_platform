/**
 * Línea base de TypeScript (scripts/ci/tsc-baseline.mjs): normalización por fichero:código y comparación.
 * Un error nuevo hace fallar; mover código (otra línea) o corregir errores no.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error: módulo .mjs sin declaraciones de tipos
import { parseTscOutput, parseBaseline, formatBaseline, compare } from "../scripts/ci/tsc-baseline.mjs";

const OUT = [
  "server/a.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'.",
  "  Detalle de la línea anterior que no es un error.",
  "server/a.ts(20,1): error TS2339: Property 'z' does not exist on type 'Y'.",
  "client\\src\\b.tsx(3,9): error TS7006: Parameter 'p' implicitly has an 'any' type.",
].join("\n");

describe("línea base de tsc", () => {
  it("normaliza por fichero:código, sin línea ni columna y con barras /", () => {
    const m = parseTscOutput(OUT);
    expect(Object.fromEntries(m)).toEqual({ "server/a.ts:TS2339": 2, "client/src/b.tsx:TS7006": 1 });
  });

  it("formato de ida y vuelta estable", () => {
    const m = parseTscOutput(OUT);
    expect(Object.fromEntries(parseBaseline(formatBaseline(m)))).toEqual(Object.fromEntries(m));
  });

  it("un error nuevo (o de un código nuevo) falla; mover o corregir no", () => {
    const base = parseTscOutput(OUT);
    const moved = parseTscOutput(OUT.replace("(10,5)", "(99,1)"));
    expect(compare(base, moved).worse).toEqual([]);
    const fixed = parseTscOutput(OUT.split("\n").slice(1).join("\n"));
    expect(compare(base, fixed).worse).toEqual([]);
    expect(compare(base, fixed).better).toEqual([["server/a.ts:TS2339", 2, 1]]);
    const extra = parseTscOutput(`${OUT}\nserver/a.ts(30,1): error TS2322: Type 'a' is not assignable to type 'b'.`);
    expect(compare(base, extra).worse).toEqual([["server/a.ts:TS2322", 0, 1]]);
  });

  it("la línea base versionada es válida", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../docs/ci/TSC_BASELINE.txt"), "utf8");
    const m = parseBaseline(text);
    const total = Number(/# Total: (\d+)/.exec(text)?.[1]);
    expect([...m.values()].reduce((a: number, b: number) => a + b, 0)).toBe(total);
  });
});
