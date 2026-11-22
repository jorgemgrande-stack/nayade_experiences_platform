/**
 * Toda pantalla enlazada desde el menú del panel debe renderizarse dentro de `AdminLayout` (menú, cabecera, guardas de rol).
 * UX-07 de la auditoría: `/admin/numeracion` se mostraba sin marco y el usuario quedaba atrapado.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "../client/src", p), "utf8");

describe("pantallas del menú con el marco del panel", () => {
  for (const file of ["pages/admin/DocumentNumbersAdmin.tsx"]) {
    it(`${file} usa AdminLayout`, () => {
      const src = read(file);
      expect(src).toMatch(/import AdminLayout from "@\/components\/AdminLayout"/);
      expect(src).toMatch(/<AdminLayout[\s>]/);
    });
  }
});
