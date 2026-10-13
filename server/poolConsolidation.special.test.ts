/**
 * Casos especiales de consolidación de pools: estos módulos ya no pueden crear conexiones
 * propias (en modo multi-tenant no sabrían a qué tenant pertenecen) ni cerrar el pool
 * compartido del registro.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "documentNumbers.ts",
  "restaurantsDb.ts",
  "routers/emailAccounts.ts",
  "routers/emailInbox.ts",
  "services/commercialEmailService.ts",
  "services/expenseEmailIngestionService.ts",
];

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, f), "utf8");

describe("pools: casos especiales", () => {
  for (const f of FILES) {
    it(`${f} no crea pools ni conexiones propias`, () => {
      const src = read(f);
      expect(src).not.toMatch(/createPool\s*\(/);
      expect(src).not.toMatch(/createConnection\s*\(/);
      expect(src).not.toMatch(/process\.env\.DATABASE_URL/);
      expect(src).toMatch(/_core\/legacyDb/);
    });
  }

  it("la ingesta de gastos nunca cierra el pool compartido", () => {
    expect(read("services/expenseEmailIngestionService.ts")).not.toMatch(/\bpool\.end\(\)|\brawPool\.end\(\)/);
  });
});
