/** Fuente única de los datos fiscales (lógica pura): qué ajustes mandan y para qué documentos. */
import { describe, it, expect } from "vitest";
import { preferOwnLegalSettings } from "./tenantBrand";
import { ownLegalSettingsPrevail } from "./invoiceHtml";

describe("preferOwnLegalSettings", () => {
  it("lo guardado en el asistente manda; lo antiguo solo rellena lo vacío", () => {
    const out = preferOwnLegalSettings(
      { legalCompanyName: "Antigua SL", legalCompanyCif: "B9", legalCompanyIban: "ES00", legalCompanyPhone: "600" },
      { legalCompanyName: "Nueva SL", legalCompanyCif: "  ", legalCompanyIban: "ES11", legalCompanyEmail: "a@b.example" },
    );
    expect(out).toEqual({ legalCompanyName: "Nueva SL", legalCompanyCif: "B9", legalCompanyIban: "ES11", legalCompanyPhone: "600", legalCompanyEmail: "a@b.example" });
  });
  it("no añade claves ajenas", () => {
    expect(preferOwnLegalSettings({}, { otra: "x" } as Record<string, string>)).toEqual({});
  });
});

describe("ownLegalSettingsPrevail", () => {
  const since = Date.parse("2026-11-01T00:00:00Z");
  it("documento nuevo (sin fecha) o emitido desde el cambio: sí", () => {
    expect(ownLegalSettingsPrevail(undefined, since)).toBe(true);
    expect(ownLegalSettingsPrevail(new Date("2026-11-01T00:00:00Z"), since)).toBe(true);
    expect(ownLegalSettingsPrevail("2026-12-01T10:00:00Z", since)).toBe(true);
  });
  it("emitido antes del cambio: no (se ve como se emitió)", () => {
    expect(ownLegalSettingsPrevail(new Date("2026-10-31T23:59:59Z"), since)).toBe(false);
  });
  it("sin constancia del cambio: comportamiento anterior", () => {
    expect(ownLegalSettingsPrevail(undefined, null)).toBe(false);
    expect(ownLegalSettingsPrevail(new Date(), null)).toBe(false);
  });
});
