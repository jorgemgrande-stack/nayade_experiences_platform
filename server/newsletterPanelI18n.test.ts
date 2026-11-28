/** Las pantallas de administración de la newsletter están traducidas al alemán: cada texto de interfaz tiene su entrada. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { panelText } from "../shared/i18n/panelText";

const SRC = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/newsletter/Suscriptores.tsx"), "utf8");

describe("newsletter · textos del panel en alemán", () => {
  const literales = new Set<string>();
  for (const m of SRC.matchAll(/px\("([^"]+)"\)/g)) literales.add(m[1]);
  // Etiquetas de los diccionarios del módulo (se traducen con px(...) al pintarlas)
  for (const m of SRC.matchAll(/^\s+\w+:\s*(?:\{ label: )?"([^"]+)"/gm)) if (/^[A-ZÁÉÍÓÚ]/.test(m[1]) && !/^(default|secondary|outline)$/.test(m[1])) literales.add(m[1]);
  it("hay textos que traducir", () => expect(literales.size).toBeGreaterThan(50));
  it("todos tienen traducción distinta del español", () => {
    const sin = [...literales].filter((es) => panelText(es, "de") === es);
    expect(sin).toEqual([]);
  });
  it("en español no cambia nada", () => expect(panelText("Guardar ajustes", "es")).toBe("Guardar ajustes"));
});
