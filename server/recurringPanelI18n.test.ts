/** La pantalla «Sesiones recurrentes» está traducida al alemán: cada texto de interfaz tiene su entrada. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { panelText } from "../shared/i18n/panelText";

const SRC = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/recurring/SesionesRecurrentes.tsx"), "utf8");

describe("sesiones recurrentes · textos del panel en alemán", () => {
  const literales = new Set<string>();
  for (const m of SRC.matchAll(/px\("([^"]+)"\)/g)) literales.add(m[1]);
  for (const d of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) literales.add(d);
  for (const m of SRC.matchAll(/^\s+\w+:\s*\{ label: "([^"]+)"/gm)) literales.add(m[1]);
  it("hay textos que traducir", () => expect(literales.size).toBeGreaterThan(40));
  it("todos tienen traducción distinta del español", () => {
    expect([...literales].filter((es) => panelText(es, "de") === es)).toEqual([]);
  });
  it("en español no cambia nada", () => expect(panelText("Guardar oferta", "es")).toBe("Guardar oferta"));
});
