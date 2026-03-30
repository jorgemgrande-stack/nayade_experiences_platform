/**
 * Tests para el helper centralizado calcularREAVSimple
 * Cubre los 3 canales: CRM, TPV y Online (Redsys IPN)
 */
import { describe, it, expect } from "vitest";
import { calcularREAVSimple, validarConfiguracionREAV } from "./reav";

// Helper para construir un objeto ProductoFiscal de prueba
function makeProducto(fiscalRegime: string, providerPercent: number | null, agencyMarginPercent: number | null) {
  return { fiscalRegime, providerPercent, agencyMarginPercent };
}

describe("calcularREAVSimple — fórmulas REAV", () => {
  it("calcula correctamente con porcentajes estándar 60%/40%", () => {
    const result = calcularREAVSimple(100, 60, 40);
    expect(result.costeProveedor).toBeCloseTo(60, 2);
    expect(result.margenAgencia).toBeCloseTo(40, 2);
    expect(result.baseImponible).toBeCloseTo(40 / 1.21, 2);
    expect(result.iva).toBeCloseTo(40 - 40 / 1.21, 2);
  });

  it("calcula correctamente con porcentajes 70%/30%", () => {
    const result = calcularREAVSimple(200, 70, 30);
    expect(result.costeProveedor).toBeCloseTo(140, 2);
    expect(result.margenAgencia).toBeCloseTo(60, 2);
    expect(result.baseImponible).toBeCloseTo(60 / 1.21, 2);
    expect(result.iva).toBeCloseTo(60 - 60 / 1.21, 2);
  });

  it("costeProveedor + margenAgencia = precioVenta", () => {
    const precio = 150;
    const result = calcularREAVSimple(precio, 65, 35);
    expect(result.costeProveedor + result.margenAgencia).toBeCloseTo(precio, 2);
  });

  it("baseImponible + iva = margenAgencia", () => {
    const result = calcularREAVSimple(100, 60, 40);
    expect(result.baseImponible + result.iva).toBeCloseTo(result.margenAgencia, 2);
  });

  it("maneja precio 0 sin errores", () => {
    const result = calcularREAVSimple(0, 60, 40);
    expect(result.costeProveedor).toBe(0);
    expect(result.margenAgencia).toBe(0);
    expect(result.baseImponible).toBe(0);
    expect(result.iva).toBe(0);
  });

  it("maneja porcentajes decimales correctamente", () => {
    const result = calcularREAVSimple(54.45, 60, 40);
    expect(result.costeProveedor).toBeCloseTo(32.67, 2);
    expect(result.margenAgencia).toBeCloseTo(21.78, 2);
  });

  // Canal CRM — caso Rata Maravillada (54.45€, Day Pass)
  it("[Canal CRM] Rata Maravillada: 54.45€ con 60%/40%", () => {
    const result = calcularREAVSimple(54.45, 60, 40);
    expect(result.costeProveedor).toBeCloseTo(32.67, 2);
    expect(result.margenAgencia).toBeCloseTo(21.78, 2);
    expect(result.baseImponible).toBeCloseTo(21.78 / 1.21, 2);
    expect(result.iva).toBeCloseTo(21.78 - 21.78 / 1.21, 2);
  });

  // Canal TPV — venta directa en taquilla
  it("[Canal TPV] Venta directa 120€ con 65%/35%", () => {
    const result = calcularREAVSimple(120, 65, 35);
    expect(result.costeProveedor).toBeCloseTo(78, 2);
    expect(result.margenAgencia).toBeCloseTo(42, 2);
    expect(result.baseImponible).toBeCloseTo(42 / 1.21, 2);
  });

  // Canal Online — reserva Redsys
  it("[Canal Online] Reserva online 89.90€ con 60%/40%", () => {
    const result = calcularREAVSimple(89.90, 60, 40);
    expect(result.costeProveedor).toBeCloseTo(53.94, 2);
    expect(result.margenAgencia).toBeCloseTo(35.96, 2);
    expect(result.baseImponible).toBeCloseTo(35.96 / 1.21, 2);
    expect(result.iva).toBeCloseTo(35.96 - 35.96 / 1.21, 2);
  });
});

describe("validarConfiguracionREAV — validación de producto", () => {
  it("valida producto correctamente configurado", () => {
    const errores = validarConfiguracionREAV(makeProducto("reav", 60, 40));
    expect(errores).toHaveLength(0);
  });

  it("rechaza producto REAV sin porcentajes", () => {
    const errores = validarConfiguracionREAV(makeProducto("reav", null, null));
    expect(errores.length).toBeGreaterThan(0);
  });

  it("rechaza porcentajes que no suman 100", () => {
    const errores = validarConfiguracionREAV(makeProducto("reav", 60, 30));
    expect(errores.some(e => e.includes("100"))).toBe(true);
  });

  it("acepta producto general_21 sin porcentajes REAV (devuelve array vacío)", () => {
    const errores = validarConfiguracionREAV(makeProducto("general_21", null, null));
    expect(errores).toHaveLength(0);
  });

  it("rechaza porcentajes negativos", () => {
    const errores = validarConfiguracionREAV(makeProducto("reav", -10, 110));
    expect(errores.length).toBeGreaterThan(0);
  });
});
