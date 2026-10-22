/**
 * Teléfonos de contacto en las páginas que ven los clientes de cada empresa (aceptación de presupuesto, propuesta,
 * detalle de restaurante, portal de empleados): los de la empresa, nunca el número ni el email de la instalación
 * original fijados en el código.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../client/src/pages", rel), "utf8");

describe("teléfono y email de contacto de la empresa", () => {
  it.each(["QuoteAcceptance.tsx", "ProposalView.tsx", "RestauranteDetail.tsx"])("%s no fija el teléfono ni el email de la instalación original", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\+?34 ?639 ?57 ?66 ?27|34639576627/);
    expect(src).not.toMatch(/skicenter\.es|N[aá]yade Experiences/);
    expect(src).toContain("usePublicContact()");
  });

  it("portal de empleados: el teléfono de la instalación original solo fuera de la web neutra", () => {
    const src = read("employee/EmployeeLayout.tsx");
    expect(src).toContain("const contactPhone = neutral ? phone : NAYADE_PHONE;");
    expect(src).not.toMatch(/\{NAYADE_PHONE\}|tel:\$\{NAYADE_PHONE\}/);
  });
});
