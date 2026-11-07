/**
 * Hotel Net · fichas de huésped (RD 933/2021), conservación y planes de tarifa — lógica pura.
 */
import { describe, it, expect } from "vitest";
import {
  ageAt,
  applyPlanToNight,
  applyPlanToStay,
  guestDisplayName,
  guestRegistryErrors,
  normalizeDocNumber,
  ratePlanError,
  retentionCutoff,
  retentionError,
  validSpanishId,
  type GuestInput,
} from "./hotelGuests";

const adult: GuestInput = {
  firstName: "Ana", lastName: "Prueba", sex: "M", birthDate: "1990-05-10", nationality: "España", docType: "DNI", docNumber: "12345678Z",
  docSupportNumber: "ABC123456", address: "Calle Ejemplo 1", country: "España",
};

describe("registro de viajeros", () => {
  it("edad en años cumplidos", () => {
    expect(ageAt("2012-06-15", "2026-06-14")).toBe(13);
    expect(ageAt("2012-06-15", "2026-06-15")).toBe(14);
    expect(ageAt("2030-01-01", "2026-01-01")).toBeNull();
    expect(ageAt("no", "2026-01-01")).toBeNull();
  });
  it("DNI y NIE con letra de control", () => {
    expect(validSpanishId("DNI", "12345678-z")).toBe(true);
    expect(validSpanishId("DNI", "12345678A")).toBe(false);
    expect(validSpanishId("NIE", "X1234567L")).toBe(true);
    expect(validSpanishId("NIE", "X1234567A")).toBe(false);
    expect(validSpanishId("PASAPORTE", "XX000")).toBe(true);
    expect(normalizeDocNumber(" 12.345.678-z ")).toBe("12345678Z");
    expect(normalizeDocNumber("   ")).toBeNull();
  });
  it("ficha completa de un adulto", () => {
    expect(guestRegistryErrors(adult, "2026-08-01")).toEqual([]);
  });
  it("adulto sin documento, con DNI erróneo o sin soporte, o sin dirección", () => {
    expect(guestRegistryErrors({ ...adult, docNumber: null }, "2026-08-01")).toEqual(["Falta el documento de identidad (obligatorio desde los 14 años)."]);
    expect(guestRegistryErrors({ ...adult, docNumber: "12345678A" }, "2026-08-01")).toEqual(["El número de DNI no es válido."]);
    expect(guestRegistryErrors({ ...adult, docSupportNumber: "" }, "2026-08-01")).toEqual(["Falta el número de soporte del documento."]);
    expect(guestRegistryErrors({ ...adult, docType: "PASAPORTE", docNumber: "P123", docSupportNumber: null }, "2026-08-01")).toEqual([]);
    expect(guestRegistryErrors({ ...adult, address: "" }, "2026-08-01")).toEqual(["Falta la dirección (calle y país)."]);
  });
  it("menor de 14: sin documento pero con parentesco; de 14 a 17, documento y parentesco", () => {
    const kid: GuestInput = { firstName: "Leo", lastName: "Prueba", sex: "H", birthDate: "2020-01-01", nationality: "España" };
    expect(guestRegistryErrors(kid, "2026-08-01")).toEqual(["Falta el parentesco del menor con el adulto que lo acompaña."]);
    expect(guestRegistryErrors({ ...kid, kinship: "Hijo" }, "2026-08-01")).toEqual([]);
    const teen: GuestInput = { ...adult, birthDate: "2010-01-01" };
    expect(guestRegistryErrors(teen, "2026-08-01")).toEqual(["Falta el parentesco del menor con el adulto que lo acompaña."]);
  });
  it("faltan los datos básicos", () => {
    expect(guestRegistryErrors({ firstName: null, lastName: null, birthDate: null, nationality: null }, "2026-08-01")).toEqual([
      "Falta el nombre.", "Falta el primer apellido.", "Falta el sexo.", "Falta la fecha de nacimiento.", "Falta la nacionalidad.",
    ]);
    expect(guestDisplayName({ firstName: "Ana", lastName: "Prueba", secondLastName: "Ejemplo" })).toBe("Ana Prueba Ejemplo");
    expect(guestDisplayName({ firstName: null, lastName: null })).toBe("Huésped sin nombre");
  });
});

describe("conservación de las fichas", () => {
  it("desactivada por defecto: sin fecha de corte", () => {
    expect(retentionCutoff(null, "2026-11-07")).toBeNull();
    expect(retentionError(null)).toBeNull();
  });
  it("plazo entre 12 y 240 meses", () => {
    expect(retentionError(6)).toMatch(/entre 12 y 240/);
    expect(retentionError(300)).toMatch(/entre 12 y 240/);
    expect(retentionError(36)).toBeNull();
    expect(retentionCutoff(36, "2026-11-07")).toBe("2023-11-07");
    expect(retentionCutoff(6, "2026-11-07")).toBeNull();
  });
});

describe("planes de tarifa", () => {
  it("sin plan o «none», el precio de siempre", () => {
    expect(applyPlanToNight(10000, null)).toBe(10000);
    expect(applyPlanToNight(10000, { adjustType: "none", adjustValue: 500 })).toBe(10000);
    expect(applyPlanToStay([10000, 12000], undefined)).toBe(22000);
  });
  it("porcentaje (no reembolsable −10 %) e importe fijo por noche (desayuno +12 €)", () => {
    expect(applyPlanToNight(10000, { adjustType: "percent", adjustValue: -1000 })).toBe(9000);
    expect(applyPlanToNight(10000, { adjustType: "fixed", adjustValue: 1200 })).toBe(11200);
    expect(applyPlanToStay([10000, 12000], { adjustType: "fixed", adjustValue: 1200 })).toBe(24400);
    expect(applyPlanToNight(1000, { adjustType: "fixed", adjustValue: -5000 })).toBe(0);
  });
  it("valida el plan", () => {
    expect(ratePlanError({ name: "BAR", adjustType: "none", adjustValue: 0 })).toBeNull();
    expect(ratePlanError({ name: "x", adjustType: "none", adjustValue: 0 })).toMatch(/nombre/);
    expect(ratePlanError({ name: "Rara", adjustType: "raro", adjustValue: 0 })).toMatch(/Tipo/);
    expect(ratePlanError({ name: "Mucho", adjustType: "percent", adjustValue: -9500 })).toMatch(/−90 %/);
  });
});
