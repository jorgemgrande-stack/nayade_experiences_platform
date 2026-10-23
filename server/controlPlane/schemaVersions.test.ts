import path from "node:path";
import { describe, expect, it } from "vitest";
import { pendingCount, schemaState, tenantMigrations } from "./schemaVersions";

describe("versiones de esquema de las empresas", () => {
  const known = tenantMigrations(path.resolve(__dirname, "../../db/migrations"));
  it("lee las migraciones de empresa del código, en orden y sin las de vuelta atrás", () => {
    expect(known.length).toBeGreaterThan(5);
    expect([...known].sort()).toEqual(known);
    expect(known.some((x) => x.endsWith(".down"))).toBe(false);
    expect(known.at(-1)).toMatch(/^\d{4}_/);
  });
  it("estado de cada empresa frente a la última migración", () => {
    const k = ["0011_a", "0012_b", "0013_c"];
    expect(schemaState("0013_c", "0013_c", k)).toBe("up_to_date");
    expect(schemaState("0011_a", "0013_c", k)).toBe("behind");
    expect(pendingCount("0011_a", k)).toBe(2);
    expect(schemaState("0014_x", "0013_c", k)).toBe("ahead");
    expect(schemaState(null, "0013_c", k)).toBe("unknown");
    expect(pendingCount(null, k)).toBeNull();
  });
  it("sin directorio de migraciones no inventa versiones", () => {
    expect(tenantMigrations(path.resolve(__dirname, "no-existe"))).toEqual([]);
  });
});
