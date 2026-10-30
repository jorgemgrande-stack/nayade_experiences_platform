/**
 * Tipos de los scripts de despliegue (scripts/deploy, tsconfig.scripts.json): sin errores. tsconfig.json no los incluye y
 * un fallo de tipos ahí solo se veía al ejecutar la acción en GitHub (p. ej. una variable fuera de su ámbito).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("tipos de los scripts de despliegue", () => {
  it("tsc -p tsconfig.scripts.json termina sin errores", () => {
    const tsc = path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
    const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.scripts.json"], { cwd: process.cwd(), encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`.trim()).toBe("");
    expect(r.status).toBe(0);
  }, 180_000);
});
