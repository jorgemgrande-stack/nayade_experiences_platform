/**
 * Web pública de cada empresa: las páginas funcionales (contacto, presupuesto, cupones, reservas, aceptación de
 * presupuesto, registro de gastos) toman nombre, teléfono, email y dirección de usePublicContact, que en la web neutra
 * solo devuelve los datos de la empresa; los de la instalación original quedan para su propia web.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const hook = read("client/src/hooks/usePublicPhone.ts");

describe("contacto de la web pública de cada empresa", () => {
  it.each([
    "Contact.tsx",
    "ReservaOk.tsx",
    "ReservaError.tsx",
    "BudgetRequest.tsx",
    "CanjearCupon.tsx",
    "QuoteAcceptance.tsx",
    "RegistrarGasto.tsx",
    "RestauranteReservaOk.tsx",
    "RestauranteReservaKo.tsx",
    "RestauranteDetail.tsx",
    "SolicitarAnulacion.tsx",
    "ExperienceDetail.tsx",
    "partner/PartnerLayout.tsx",
    "partner/PartnerLeadNuevo.tsx",
    "partner/PartnerReservaNueva.tsx",
    "supplier/SupplierDashboard.tsx",
  ])("%s no escribe a mano el email ni el nombre de la instalación original", (file) => {
    const src = read(`client/src/pages/${file}`);
    expect(src).toContain("usePublicContact()");
    expect(src).not.toContain("reservas@nayadeexperiences.es");
    expect(src).not.toMatch(/N[aá]yade Experiences/);
  });

  it("usePublicContact: en la web neutra (o mientras no se sabe), nunca los datos de la instalación original", () => {
    const body = hook.slice(hook.indexOf("export function usePublicContact"), hook.indexOf("export function usePublicPhone"));
    expect(body).toMatch(/const neutral = t \? t\.neutralSite : true;/);
    for (const field of ["brandName", "email", "address"]) {
      expect(body).toMatch(new RegExp(`${field}: neutral \\? \\(t\\?\\.[\\w.]+ \\?\\? ""\\) : SINGLE_CONTACT\\.${field}`));
    }
    expect(body).toMatch(/const phone = neutral \? \(t\?\.contact\.phone \?\? ""\) :/);
  });

  it("usePublicPhone reutiliza usePublicContact (el teléfono de la instalación original no llega a la web neutra)", () => {
    const body = hook.slice(hook.indexOf("export function usePublicPhone"));
    expect(body).toContain("usePublicContact()");
  });
});
