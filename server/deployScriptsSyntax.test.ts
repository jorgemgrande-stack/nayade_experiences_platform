/**
 * Los scripts de despliegue (scripts/deploy) no entran en tsc: un error de sintaxis solo aparecía al ejecutar el flujo
 * en Railway (23/10/2026, «Unterminated regular expression»). Aquí se compilan todos con el mismo esbuild que usa tsx.
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../scripts/deploy");

describe("scripts de despliegue", () => {
  it.each(fs.readdirSync(DIR).filter((f) => f.endsWith(".ts")))("%s compila", (f) => {
    expect(() => transformSync(fs.readFileSync(path.join(DIR, f), "utf8"), { loader: "ts", format: "esm" })).not.toThrow();
  });
});
