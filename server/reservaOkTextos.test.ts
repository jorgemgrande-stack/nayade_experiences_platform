/**
 * Página de retorno del pago (/reserva/ok): no promete un correo de confirmación que puede no salir (p. ej. en la
 * prueba gratuita, sin correo activado) ni usa textos de un sector concreto en sus botones.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/ReservaOk.tsx"), "utf8");

describe("textos de /reserva/ok", () => {
  it("sin promesas de correo de confirmación", () => {
    expect(src).not.toMatch(/recibirás un email/i);
    expect(src).not.toMatch(/disponible en el email/i);
    expect(src).not.toContain("Email de confirmación");
  });

  it("sin «Ver más experiencias» ni condiciones de cancelación inventadas", () => {
    expect(src).not.toContain("Ver más experiencias");
    expect(src).not.toContain("Ver experiencias");
    expect(src).not.toContain("Cancelación gratuita");
    expect(src).toContain("Seguir comprando");
  });

  it("el pago confirmado remite a la referencia de pago", () => {
    expect(src).toContain("Tu pago se ha registrado correctamente. Guarda la referencia de pago para cualquier consulta.");
  });
});
