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

describe("enlaces internos del CRM con contrato de URL (UX-05)", () => {
  const crm = read("pages/admin/crm/CRMDashboard.tsx");
  it("CRMDashboard acepta los alias de pestaña que emiten otras pantallas", () => {
    expect(crm).toMatch(/raw === "reservas" \? "reservations"/);
    expect(crm).toMatch(/raw === "presupuestos" \? "quotes"/);
  });
  it("CRMDashboard abre la reserva con ?tab=reservas&id= además de ?resId=", () => {
    expect(crm).toMatch(/p\.get\("resId"\) \?\? \(tabParam === "reservas"/);
  });
  it("ningún enlace interno apunta a una pestaña inexistente (?tab=clients)", () => {
    const emailInbox = read("pages/admin/commercial/EmailInbox.tsx");
    expect(emailInbox).not.toMatch(/\/admin\/crm\?tab=clients/);
    expect(emailInbox).toMatch(/\/admin\/crm\/clientes\/\$\{email\.crmClient\.id\}/);
  });
});
