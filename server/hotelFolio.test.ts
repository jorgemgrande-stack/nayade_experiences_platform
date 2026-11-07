/**
 * Hotel Net · folio de estancia y cierre del día — lógica pura: reparto del alojamiento, saldo, líneas y forma de pago de
 * la factura, cuándo se edita y se cierra el folio, e indicadores (ocupación, ADR, RevPAR) por noche y por periodo.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ACCOMMODATION_TAX_BP,
  chargeAmount,
  folioCloseBlocker,
  folioEditBlocker,
  folioInvoiceLines,
  folioTotals,
  invoicePaymentMethod,
  normalizeTaxBp,
  splitAccommodation,
  type FolioItem,
} from "./hotelFolio";
import { nightKpis, nightRevenueCents, periodKpis, type AuditStay } from "./hotelAudit";
import { chargedInvoiceAmounts } from "./invoiceCalc";
import { nightAuditBusinessDate } from "./hotelNightAuditJob";

const night = (d: string, cents: number, bp = 1000): FolioItem => ({ kind: "cargo", category: "alojamiento", description: `Noche ${d}`, quantity: 1, unitPriceCents: cents, amountCents: cents, taxRateBp: bp, nightDate: d });
const extra = (desc: string, qty: number, unit: number, bp = 2100, category = "extra"): FolioItem => ({ kind: "cargo", category, description: desc, quantity: qty, unitPriceCents: unit, amountCents: qty * unit, taxRateBp: bp, nightDate: null });
const pay = (category: string, cents: number): FolioItem => ({ kind: "pago", category, description: null, quantity: 1, unitPriceCents: cents, amountCents: cents, taxRateBp: null, nightDate: null });

describe("alojamiento por noche", () => {
  it("reparte el total sin perder céntimos (el resto en las primeras noches)", () => {
    expect(splitAccommodation(10000, ["a", "b", "c"]).map((n) => n.cents)).toEqual([3334, 3333, 3333]);
    expect(splitAccommodation(10000, ["a", "b", "c"]).reduce((s, n) => s + n.cents, 0)).toBe(10000);
    expect(splitAccommodation(500, [])).toEqual([]);
    expect(splitAccommodation(-5, ["a"])).toEqual([{ night: "a", cents: 0 }]);
  });
  it("IVA por defecto del 10 % y validación del configurable", () => {
    expect(DEFAULT_ACCOMMODATION_TAX_BP).toBe(1000);
    expect(normalizeTaxBp(2100)).toBe(2100);
    expect(normalizeTaxBp(0)).toBe(0);
    expect(normalizeTaxBp(-1)).toBeNull();
    expect(normalizeTaxBp(3100)).toBeNull();
    expect(normalizeTaxBp(10.5)).toBeNull();
  });
});

describe("saldo y factura del folio", () => {
  const list = [night("2026-09-10", 6000), night("2026-09-11", 6000), extra("Cena", 2, 2500, 1000, "restaurante"), extra("Minibar", 1, 450), pay("tarjeta", 10000), pay("efectivo", 7450)];
  it("cargos, pagos y saldo", () => {
    expect(folioTotals(list)).toEqual({ chargesCents: 17450, paymentsCents: 17450, balanceCents: 0 });
    expect(chargeAmount(3, 1250)).toBe(3750);
    expect(chargeAmount(0, 1250)).toBe(1250);
  });
  it("agrupa el alojamiento en una línea por IVA y deja cada extra en la suya", () => {
    const lines = folioInvoiceLines(list, { roomName: "Doble", defaultTaxBp: 1000 });
    expect(lines[0]).toEqual({ description: "Alojamiento · Doble · 2 noches (10/09–11/09)", quantity: 2, unitPrice: 60, total: 120, fiscalRegime: "general", taxRate: 10 });
    expect(lines.slice(1).map((l) => [l.description, l.quantity, l.unitPrice, l.total, l.taxRate])).toEqual([
      ["Cena", 2, 25, 50, 10],
      ["Minibar", 1, 4.5, 4.5, 21],
    ]);
  });
  it("el desglose de IVA de la factura cuadra con el total cobrado", () => {
    const a = chargedInvoiceAmounts(folioInvoiceLines(list, { roomName: null, defaultTaxBp: 1000 }), 174.5);
    expect(a.total).toBe(174.5);
    expect(a.taxBreakdown.map((b) => b.rate)).toEqual([21, 10]);
    const ten = a.taxBreakdown.find((b) => b.rate === 10)!;
    expect(ten.base + ten.amount).toBeCloseTo(170, 2);
    expect(a.subtotal + a.taxAmount).toBeCloseTo(174.5, 2);
  });
  it("un cargo sin IVA propio usa el del alojamiento", () => {
    const l = folioInvoiceLines([{ ...night("2026-09-10", 5000), taxRateBp: null }], { roomName: null, defaultTaxBp: 2100 });
    expect(l[0].taxRate).toBe(21);
  });
  it("forma de pago: la del mayor pago; el pago previo de la reserva conserva su método", () => {
    expect(invoicePaymentMethod([{ category: "tarjeta", amountCents: 10000 }, { category: "efectivo", amountCents: 500 }])).toBe("tarjeta_fisica");
    expect(invoicePaymentMethod([{ category: "transferencia", amountCents: 100 }])).toBe("transferencia");
    expect(invoicePaymentMethod([{ category: "pago_reserva", amountCents: 9000 }], "redsys")).toBe("redsys");
    expect(invoicePaymentMethod([{ category: "pago_reserva", amountCents: 9000 }], null)).toBe("otro");
    expect(invoicePaymentMethod([])).toBe("otro");
  });
});

describe("edición y cierre del folio", () => {
  const ok = { chargesCents: 100, paymentsCents: 100, balanceCents: 0 };
  it("no se edita un folio cerrado ni el de una reserva cancelada", () => {
    expect(folioEditBlocker("cerrado", { status: "paid", statusReservation: "EN_CURSO" })).toMatch(/cerrado/);
    expect(folioEditBlocker("abierto", { status: "cancelled", statusReservation: "CONFIRMADA" })).toMatch(/cancelada/);
    expect(folioEditBlocker("abierto", { status: "paid", statusReservation: "ANULADA" })).toMatch(/cancelada/);
    expect(folioEditBlocker("abierto", { status: "pending_payment", statusReservation: "CONFIRMADA" })).toBeNull();
  });
  it("se cierra con el huésped dentro o tras la salida, y solo con saldo 0", () => {
    expect(folioCloseBlocker("abierto", { status: "paid", statusReservation: "CONFIRMADA" }, ok)).toMatch(/tras el check-in/);
    expect(folioCloseBlocker("abierto", { status: "paid", statusReservation: "EN_CURSO" }, ok)).toBeNull();
    expect(folioCloseBlocker("abierto", { status: "paid", statusReservation: "FINALIZADA" }, ok)).toBeNull();
    expect(folioCloseBlocker("abierto", { status: "paid", statusReservation: "FINALIZADA" }, { chargesCents: 1000, paymentsCents: 400, balanceCents: 600 })).toMatch(/pendiente de 6.00 €/);
    expect(folioCloseBlocker("abierto", { status: "paid", statusReservation: "FINALIZADA" }, { chargesCents: 400, paymentsCents: 1000, balanceCents: -600 })).toMatch(/de más/);
    expect(folioCloseBlocker("cerrado", { status: "paid", statusReservation: "FINALIZADA" }, ok)).toMatch(/cerrado/);
  });
});

describe("cierre del día: ocupación, ADR y RevPAR", () => {
  const st = (over: Partial<AuditStay>): AuditStay => ({ id: 1, checkIn: "2026-09-10", checkOut: "2026-09-12", statusReservation: "CONFIRMADA", occupies: true, amountTotalCents: 20000, ...over });
  const stays = [
    st({ id: 1 }), // 2 noches · 100 €/noche
    st({ id: 2, checkIn: "2026-09-09", checkOut: "2026-09-10", statusReservation: "FINALIZADA", amountTotalCents: 8000 }), // sale el 10
    st({ id: 3, checkIn: "2026-09-10", checkOut: "2026-09-11", statusReservation: "NO_SHOW", occupies: false }), // no-show
    st({ id: 4, checkIn: "2026-09-10", checkOut: "2026-09-13", amountTotalCents: 30000, statusReservation: "EN_CURSO" }),
    st({ id: 5, status: "cancelled", occupies: false } as any), // cancelada: no cuenta
    st({ id: 6, checkIn: "2026-09-08", checkOut: "2026-09-12", effectiveCheckOut: "2026-09-10", statusReservation: "FINALIZADA", amountTotalCents: 40000 }), // salida anticipada el 10
  ];
  it("una noche: llegadas, salidas, alojados, no-shows e ingresos", () => {
    const k = nightKpis(stays, "2026-09-10", 4);
    expect(k).toMatchObject({ arrivals: 2, departures: 2, inHouse: 2, noShows: 1, roomsOccupied: 2, capacity: 4, occupancyBp: 5000, roomRevenueCents: 20000, adrCents: 10000, revparCents: 5000 });
  });
  it("ingreso por noche y salida anticipada", () => {
    expect(nightRevenueCents(stays[0], "2026-09-11")).toBe(10000);
    expect(nightRevenueCents(stays[0], "2026-09-12")).toBe(0);
    expect(nightRevenueCents(stays[5], "2026-09-09")).toBe(10000);
    expect(nightRevenueCents(stays[5], "2026-09-10")).toBe(0);
  });
  it("sin capacidad ni ocupación no divide por cero", () => {
    expect(nightKpis([], "2026-09-10", 0)).toMatchObject({ occupancyBp: 0, adrCents: 0, revparCents: 0 });
  });
  it("periodo: ocupación, ADR y RevPAR sobre noches vendidas y disponibles", () => {
    const days = ["2026-09-10", "2026-09-11"].map((d) => nightKpis(stays, d, 4));
    const p = periodKpis(days);
    expect(p).toMatchObject({ nights: 2, roomNightsSold: 4, roomNightsAvailable: 8, occupancyBp: 5000, roomRevenueCents: 40000, adrCents: 10000, revparCents: 5000 });
    expect(periodKpis([])).toMatchObject({ occupancyBp: 0, adrCents: 0, revparCents: 0 });
  });
  it("la pasada automática cierra el día anterior en la hora de Madrid", () => {
    expect(nightAuditBusinessDate(new Date("2026-09-11T03:30:00Z"))).toBe("2026-09-10");
    expect(nightAuditBusinessDate(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });
});
