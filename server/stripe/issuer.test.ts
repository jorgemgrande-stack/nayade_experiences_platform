import { describe, it, expect } from "vitest";
import { TEST_TAX_NOTICE } from "./checkout";
import { ISSUER, describeIssuer, isValidSpanishCif, issuerLine } from "./issuer";

describe("entidad emisora de Elephant Source", () => {
  it("razón social y NIF de la sociedad; el NIF es válido", () => {
    expect(ISSUER).toMatchObject({ legalName: "IRON ELEPHANT CONSULTING, S.L.", taxId: "B26987875", stripeTaxIdType: "es_cif", currency: "EUR" });
    expect(isValidSpanishCif(ISSUER.taxId)).toBe(true);
    expect(Object.isFrozen(ISSUER)).toBe(true);
  });

  it("la marca comercial no sustituye a la entidad jurídica", () => {
    expect(issuerLine()).toBe("IRON ELEPHANT CONSULTING, S.L. (NIF B26987875)");
    expect(issuerLine()).not.toMatch(/Big Elephant|Elephant Source/);
    expect(describeIssuer()).toMatchObject({ tradeName: "Big Elephant / Elephant Source", address: "Calle Corazón de María, 57, 1.º D, 28002 Madrid, España" });
  });

  it("control del NIF de persona jurídica: cifra o letra según la forma", () => {
    expect(isValidSpanishCif("B26987874")).toBe(false);
    expect(isValidSpanishCif("A58818501")).toBe(true);
    expect(isValidSpanishCif("Q2826000H")).toBe(true);
    expect(isValidSpanishCif("Q28260008")).toBe(false);
    expect(isValidSpanishCif("12345678Z")).toBe(false);
  });

  it("el aviso de la página de pago identifica al emisor por su razón social y NIF", () => {
    expect(TEST_TAX_NOTICE).toContain(issuerLine());
    expect(TEST_TAX_NOTICE).toMatch(/sin IVA/);
    expect(TEST_TAX_NOTICE.length).toBeLessThanOrEqual(1200);
  });
});
