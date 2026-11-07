/**
 * Restaurant Net · sala y comandas — reglas puras (shared/restaurantNet.ts) y forma de la venta del TPV
 * (server/restaurantNetDb.ts saleLinesOf). El recorrido con base de datos real está en restaurantNetSala.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  checkoutIdempotencyKey,
  mergePlan,
  mergeProblem,
  normalizeAllergens,
  orderTotals,
  paymentsProblem,
  tableStates,
} from "../shared/restaurantNet";
import { saleLinesOf, isMissingSalaSchema, type HospoOrderItem } from "./restaurantNetDb";
import { IDEMPOTENCY_KEY_RE } from "./tpvSaleIdempotency";

const line = (o: Partial<HospoOrderItem> = {}): HospoOrderItem => ({
  id: 1, orderId: 1, productType: "restaurant", productId: 7, name: "Croquetas", quantity: 1, unitPrice: 9.5, taxRate: 10, station: null,
  course: 1, seat: null, status: "pending", notes: null, voidReason: null, createdAt: 0, ...o,
});

describe("totales e IVA de la comanda", () => {
  it("IVA incluido, desglose por tipo que cuadra al céntimo y líneas anuladas fuera", () => {
    const t = orderTotals([
      { quantity: 3, unitPrice: 9.5, taxRate: 10, status: "pending" },
      { quantity: 1, unitPrice: "3.00", taxRate: "21", status: "sent" },
      { quantity: 2, unitPrice: 4, taxRate: 21, status: "void" },
    ]);
    expect(t.total).toBe(31.5);
    expect(t.taxBreakdown).toEqual([{ rate: 21, base: 2.48, amount: 0.52 }, { rate: 10, base: 25.91, amount: 2.59 }]);
    expect(t.subtotal + t.taxAmount).toBeCloseTo(t.total, 10);
    expect(t.units).toBe(4);
  });

  it("comanda vacía o solo con anuladas: cero", () => {
    expect(orderTotals([])).toEqual({ total: 0, subtotal: 0, taxAmount: 0, taxBreakdown: [], units: 0 });
    expect(orderTotals([{ quantity: 1, unitPrice: 5, taxRate: 10, status: "void" }]).total).toBe(0);
  });

  it("sin tipo de IVA usa el 10 % de hostelería; 0 % sin cuota", () => {
    expect(orderTotals([{ quantity: 1, unitPrice: 11, taxRate: null, status: "pending" }]).taxBreakdown).toEqual([{ rate: 10, base: 10, amount: 1 }]);
    expect(orderTotals([{ quantity: 2, unitPrice: 5, taxRate: 0, status: "pending" }]).taxBreakdown).toEqual([{ rate: 0, base: 10, amount: 0 }]);
  });
});

describe("estado de las mesas", () => {
  const tables = [{ id: 1, mergedInto: null }, { id: 2, mergedInto: 1 }, { id: 3, mergedInto: null }, { id: 4, mergedInto: null }];
  it("libre, ocupada o pide la cuenta según la comanda abierta; la unida, como su principal", () => {
    const s = tableStates(tables, [
      { id: 10, tableId: 1, status: "bill_requested" },
      { id: 11, tableId: 3, status: "open" },
      { id: 12, tableId: 4, status: "paid" },
    ]);
    expect(s.get(1)).toEqual({ state: "cuenta", orderId: 10 });
    expect(s.get(2)).toEqual({ state: "cuenta", orderId: 10 });
    expect(s.get(3)).toEqual({ state: "ocupada", orderId: 11 });
    expect(s.get(4)).toEqual({ state: "libre", orderId: null });
  });
  it("cobrando cuenta como «pide la cuenta» (sigue ocupada)", () => {
    expect(tableStates([{ id: 1, mergedInto: null }], [{ id: 9, tableId: 1, status: "paying" }]).get(1)?.state).toBe("cuenta");
  });
});

describe("unir mesas", () => {
  const T = (id: number, o: Partial<{ restaurantId: number; mergedInto: number | null; isActive: boolean }> = {}) => ({ id, restaurantId: 1, mergedInto: null, isActive: true, ...o });
  it("rechaza la misma mesa, restaurantes distintos, archivadas y uniones encadenadas", () => {
    expect(mergeProblem(T(1), T(1), false)).toMatch(/distintas/);
    expect(mergeProblem(T(1), T(2, { restaurantId: 2 }), false)).toMatch(/restaurantes distintos/);
    expect(mergeProblem(T(1), T(2, { isActive: false }), false)).toMatch(/archivada/);
    expect(mergeProblem(T(1, { mergedInto: 5 }), T(2), false)).toMatch(/principal ya está unida/);
    expect(mergeProblem(T(1), T(2, { mergedInto: 5 }), false)).toMatch(/ya está unida/);
    expect(mergeProblem(T(1), T(2), true)).toMatch(/otras unidas/);
    expect(mergeProblem(null, T(2), false)).toMatch(/No encontramos/);
    expect(mergeProblem(T(1), T(2), false)).toBeNull();
  });
  it("plan de comandas: mover platos, cambiar de mesa, cerrar la vacía o nada", () => {
    expect(mergePlan(10, 11, 2)).toBe("move");
    expect(mergePlan(null, 11, 2)).toBe("retable");
    expect(mergePlan(10, 11, 0)).toBe("cancelEmpty");
    expect(mergePlan(10, null, 0)).toBe("none");
  });
});

describe("cobro", () => {
  it("la clave de idempotencia de la comanda es válida para el TPV y estable", () => {
    expect(checkoutIdempotencyKey(1)).toBe(checkoutIdempotencyKey(1));
    expect(checkoutIdempotencyKey(1)).not.toBe(checkoutIdempotencyKey(2));
    for (const id of [1, 42, 2147483647]) expect(IDEMPOTENCY_KEY_RE.test(checkoutIdempotencyKey(id))).toBe(true);
  });

  it("los pagos deben cuadrar con el total, sin importes a cero", () => {
    expect(paymentsProblem(28.5, [{ amount: 20 }, { amount: 8.5 }])).toBeNull();
    expect(paymentsProblem(28.5, [{ amount: 10 }])).toMatch(/no coinciden/);
    expect(paymentsProblem(28.5, [])).toMatch(/cómo paga/);
    expect(paymentsProblem(28.5, [{ amount: 28.5 }, { amount: 0 }])).toMatch(/mayor que cero/);
    expect(paymentsProblem(0, [{ amount: 1 }])).toMatch(/libera la mesa/);
  });

  it("líneas de la venta: sin anuladas ni importes a 0 €, como platos de restaurante del TPV", () => {
    const lines = saleLinesOf([
      line({ quantity: 3 }),
      line({ id: 2, name: "Vino", productId: 8, unitPrice: 3, status: "void" }),
      line({ id: 3, name: "Pan", productId: 9, unitPrice: 0 }),
      line({ id: 4, name: "Arroz", productId: 10, unitPrice: 14.9, notes: "Sin gluten" }),
    ]);
    expect(lines).toEqual([
      { productType: "restaurant", productId: 7, productName: "Croquetas", quantity: 3, unitPrice: 9.5, discountPercent: 0, participants: 1 },
      { productType: "restaurant", productId: 10, productName: "Arroz", quantity: 1, unitPrice: 14.9, discountPercent: 0, participants: 1, notes: "Sin gluten" },
    ]);
  });
});

describe("carta y migración", () => {
  it("alérgenos: solo los 14 oficiales, sin repetir y en orden", () => {
    expect(normalizeAllergens(["lacteos", "gluten", "lacteos", "inventado"])).toEqual(["gluten", "lacteos"]);
    expect(normalizeAllergens(null)).toEqual([]);
  });
  it("detecta la falta de la migración 0033 sin confundirla con otras tablas", () => {
    expect(isMissingSalaSchema({ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.hospo_orders' doesn't exist" })).toBe(true);
    expect(isMissingSalaSchema({ cause: { errno: 1054, sqlMessage: "Unknown column 'seated_at' in 'field list'" } })).toBe(true);
    expect(isMissingSalaSchema({ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.clients' doesn't exist" })).toBe(false);
    expect(isMissingSalaSchema(new Error("otra cosa"))).toBe(false);
  });
});
