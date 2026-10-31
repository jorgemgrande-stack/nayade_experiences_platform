/**
 * «Primeros pasos»: el precio del primer producto se pide en la moneda elegida en el paso «Empresa», no siempre en euros.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// El asistente y sus pasos (PrimerosPasosSteps.tsx)
const src = ["PrimerosPasos.tsx", "PrimerosPasosSteps.tsx"].map((f) => fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/setup", f), "utf8")).join("\n");

describe("Primeros pasos: moneda del primer producto", () => {
  it("el paso de producto recibe la moneda de la empresa y la muestra en la etiqueta del precio", () => {
    expect(src).toContain('currency={d.company.currency || "EUR"}');
    expect(src).not.toContain('label="Precio (€, impuestos incluidos)"');
    expect(src).toContain('label={`Precio (${currency === "EUR" ? "€" : currency}, impuestos incluidos)`}');
  });
});
