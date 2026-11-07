/**
 * Care Net · bonos y reservas de SPA — reglas puras (shared/careNet.ts). El recorrido con base de datos real está en
 * careNetBonos.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import { DAY_MS, consumeProblem, daysBetween, expiresAtOf, packAppliesTo, packProblem, packSaleKey, pickPurchase, purchaseState, remainingOf, spaBookingState } from "../shared/careNet";
import { isMissingCareSchema } from "./careNetDb";
import { IDEMPOTENCY_KEY_RE } from "./tpvSaleIdempotency";

const NOW = 1_800_000_000_000;
const P = (o: Partial<{ id: number; status: string; sessionsTotal: number; sessionsUsed: number; expiresAt: number | null; treatmentIds: number[]; categoryIds: number[] }> = {}) => ({
  id: 1, status: "active", sessionsTotal: 5, sessionsUsed: 0, expiresAt: NOW + 10 * DAY_MS, treatmentIds: [], categoryIds: [], ...o,
});
const masaje = { id: 7, categoryId: 2 };

describe("validez de un bono", () => {
  it("sin tratamientos ni categorías vale para todo; si no, para los suyos o los de sus categorías", () => {
    expect(packAppliesTo({ treatmentIds: [], categoryIds: [] }, masaje)).toBe(true);
    expect(packAppliesTo({ treatmentIds: [7], categoryIds: [] }, masaje)).toBe(true);
    expect(packAppliesTo({ treatmentIds: [], categoryIds: [2] }, masaje)).toBe(true);
    expect(packAppliesTo({ treatmentIds: [8], categoryIds: [3] }, masaje)).toBe(false);
    expect(packAppliesTo({ treatmentIds: [], categoryIds: [2] }, { id: 9, categoryId: null })).toBe(false);
  });
  it("definición: sesiones, caducidad y precio dentro de rango", () => {
    expect(packProblem({ name: "Bono 5", sessions: 5, validityDays: 90, price: 200 })).toBeNull();
    expect(packProblem({ name: " ", sessions: 5, validityDays: 90, price: 200 })).toMatch(/nombre/);
    expect(packProblem({ name: "x", sessions: 0, validityDays: 90, price: 200 })).toMatch(/sesiones/);
    expect(packProblem({ name: "x", sessions: 5, validityDays: 0, price: 200 })).toMatch(/caducidad/);
    expect(packProblem({ name: "x", sessions: 5, validityDays: 90, price: 0 })).toMatch(/precio/);
  });
});

describe("estado, saldo y consumo", () => {
  it("pendiente, activo, agotado, caducado y anulado", () => {
    expect(purchaseState(P({ status: "pending" }), NOW)).toBe("pending");
    expect(purchaseState(P(), NOW)).toBe("active");
    expect(purchaseState(P({ sessionsUsed: 5 }), NOW)).toBe("exhausted");
    expect(purchaseState(P({ expiresAt: NOW }), NOW)).toBe("expired");
    expect(purchaseState(P({ status: "cancelled" }), NOW)).toBe("cancelled");
    expect(remainingOf(P({ sessionsUsed: 2 }))).toBe(3);
    expect(expiresAtOf(NOW, 30)).toBe(NOW + 30 * DAY_MS);
  });
  it("motivos para no consumir", () => {
    expect(consumeProblem(P(), masaje, NOW)).toBeNull();
    expect(consumeProblem(P({ status: "pending" }), masaje, NOW)).toMatch(/cobrado/);
    expect(consumeProblem(P({ sessionsUsed: 5 }), masaje, NOW)).toMatch(/sesiones/);
    expect(consumeProblem(P({ expiresAt: NOW - 1 }), masaje, NOW)).toMatch(/caducado/);
    expect(consumeProblem(P({ treatmentIds: [99] }), masaje, NOW)).toMatch(/no vale/);
  });
  it("elige el bono válido que caduca antes", () => {
    const list = [
      P({ id: 1, expiresAt: NOW + 30 * DAY_MS }),
      P({ id: 2, expiresAt: NOW + 5 * DAY_MS }),
      P({ id: 3, expiresAt: NOW + 1 * DAY_MS, treatmentIds: [99] }),
      P({ id: 4, expiresAt: NOW + 2 * DAY_MS, sessionsUsed: 5 }),
    ];
    expect(pickPurchase(list, masaje, NOW)?.id).toBe(2);
    expect(pickPurchase([P({ status: "pending" })], masaje, NOW)).toBeNull();
  });
});

describe("cobro, reservas y migración", () => {
  it("la clave del cobro del bono es válida para el TPV", () => {
    expect(IDEMPOTENCY_KEY_RE.test(packSaleKey(1))).toBe(true);
    expect(IDEMPOTENCY_KEY_RE.test(packSaleKey(2147483647))).toBe(true);
  });
  it("estado legible de una reserva de SPA del Core", () => {
    expect(spaBookingState({ status: "pending_payment", holdStatus: "retenida" })).toBe("pendiente");
    expect(spaBookingState({ status: "paid", holdStatus: "confirmada" })).toBe("confirmada");
    expect(spaBookingState({ status: "failed", holdStatus: "liberada" })).toBe("anulada");
    expect(spaBookingState({ status: "paid", holdStatus: "conflicto" })).toBe("conflicto");
    expect(spaBookingState({ status: "paid", holdStatus: "confirmada", statusReservation: "ANULADA" })).toBe("anulada");
  });
  it("días de un rango (con límite)", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(daysBetween("2026-03-02", "2026-03-01")).toEqual([]);
    expect(daysBetween("2026-01-01", "2026-12-31")).toHaveLength(62);
  });
  it("detecta la falta de la migración 0037", () => {
    expect(isMissingCareSchema({ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.care_pack_purchases' doesn't exist" })).toBe(true);
    expect(isMissingCareSchema({ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.clients' doesn't exist" })).toBe(false);
  });
});
