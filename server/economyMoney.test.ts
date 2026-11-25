/** Formato único de euros del panel de Economía (client/src/lib/money.ts). Solo presentación. */
import { describe, expect, it } from "vitest";
import { formatAmount, formatEur, formatEurCents, toAmount } from "../client/src/lib/money";

const NB = " ";
const M = "−";

describe("formatEur", () => {
  it("agrupa siempre los miles y usa dos decimales con el símbolo detrás", () => {
    expect(formatEur(1234567.89)).toBe(`1.234.567,89${NB}€`);
    expect(formatEur(98765.4)).toBe(`98.765,40${NB}€`);
    expect(formatEur(0)).toBe(`0,00${NB}€`);
    expect(formatEur(7)).toBe(`7,00${NB}€`);
  });
  it("agrupa también con cuatro cifras (es-ES lo omitiría)", () => {
    expect(formatEur(2673.86)).toBe(`2.673,86${NB}€`);
    expect(formatEur(6543.21)).toBe(`6.543,21${NB}€`);
    expect(formatEur(1000)).toBe(`1.000,00${NB}€`);
    expect(formatEur(999.99)).toBe(`999,99${NB}€`);
  });
  it("pone el signo menos delante de la cifra, nunca el símbolo", () => {
    expect(formatEur(-1234.5)).toBe(`${M}1.234,50${NB}€`);
    expect(formatEur(-6074.58)).toBe(`${M}6.074,58${NB}€`);
    expect(formatEur(-0.004)).toBe(`0,00${NB}€`);
    expect(formatEur(-0)).toBe(`0,00${NB}€`);
  });
  it("redondea a dos decimales sin tocar el valor de origen", () => {
    expect(formatEur(0.005)).toBe(`0,01${NB}€`);
    expect(formatEur(2.004)).toBe(`2,00${NB}€`);
    expect(formatEur(2.006)).toBe(`2,01${NB}€`);
    expect(formatEur(-0.005)).toBe(`${M}0,01${NB}€`);
  });
  it("admite texto decimal del servidor y trata lo vacío como cero (o como el texto pedido)", () => {
    expect(formatEur("1409062.76")).toBe(`1.409.062,76${NB}€`);
    expect(formatEur("-12.5")).toBe(`${M}12,50${NB}€`);
    expect(formatEur(null)).toBe(`0,00${NB}€`);
    expect(formatEur(undefined)).toBe(`0,00${NB}€`);
    expect(formatEur("")).toBe(`0,00${NB}€`);
    expect(formatEur("abc")).toBe(`0,00${NB}€`);
    expect(formatEur(Number.NaN)).toBe(`0,00${NB}€`);
    expect(formatEur(null, { nullAs: "—" })).toBe("—");
    expect(formatEur(5, { nullAs: "—" })).toBe(`5,00${NB}€`);
  });
  it("muestra «+» solo si se pide y el importe es positivo", () => {
    expect(formatEur(12.3, { plus: true })).toBe(`+12,30${NB}€`);
    expect(formatEur(0, { plus: true })).toBe(`0,00${NB}€`);
    expect(formatEur(-3, { plus: true })).toBe(`${M}3,00${NB}€`);
  });
  it("en alemán el patrón es el mismo", () => {
    expect(formatEur(1234567.89, { locale: "de" })).toBe(`1.234.567,89${NB}€`);
    expect(formatEur(2673.86, { locale: "de" })).toBe(`2.673,86${NB}€`);
    expect(formatEur(-1234.5, { locale: "de" })).toBe(`${M}1.234,50${NB}€`);
  });
});

describe("céntimos e importe sin símbolo", () => {
  it("convierte céntimos a euros solo para mostrarlos", () => {
    expect(formatEurCents(123456)).toBe(`1.234,56${NB}€`);
    expect(formatEurCents(-5)).toBe(`${M}0,05${NB}€`);
    expect(formatEurCents(0)).toBe(`0,00${NB}€`);
    expect(formatEurCents(123456789)).toBe(`1.234.567,89${NB}€`);
    expect(formatEurCents(null, { nullAs: "–" })).toBe("–");
  });
  it("formatAmount no lleva símbolo", () => {
    expect(formatAmount(2673.86)).toBe("2.673,86");
    expect(formatAmount(-1000)).toBe(`${M}1.000,00`);
  });
  it("toAmount distingue número de no número", () => {
    expect(toAmount("3.5")).toBe(3.5);
    expect(toAmount(null)).toBeNull();
    expect(toAmount("x")).toBeNull();
  });
});
