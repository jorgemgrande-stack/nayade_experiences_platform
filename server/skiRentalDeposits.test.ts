/**
 * Ski Net · Fianzas del alquiler — lógica pura (shared/skiDeposits.ts): importes en céntimos, estados, cálculo de la
 * devolución o la retención, movimientos de caja de cada caso y totales del día para el cierre.
 */
import { describe, expect, it } from "vitest";
import {
  DepositRuleError,
  assertCents,
  assertChargeTransition,
  assertDepositTransition,
  assertSettlementReason,
  chargeSaleKey,
  collectMovements,
  dayTotals,
  madridDay,
  needsCashSession,
  parseEurosToCents,
  planSettlement,
  retentionPayMethod,
  retentionSaleKey,
  ruleKey,
  settlementMovements,
  suggestDamage,
  suggestDeposit,
  type DepositRow,
} from "../shared/skiDeposits";
import { IDEMPOTENCY_KEY_RE } from "./tpvSaleIdempotency";
import { imageTypeOf } from "./skiRental/depositService";

describe("importes en céntimos", () => {
  it("solo enteros positivos dentro del tope", () => {
    expect(assertCents(5000, "Fianza")).toBe(5000);
    expect(assertCents(0, "Daños", 0)).toBe(0);
    for (const bad of [0, -1, 12.5, Number.NaN, 10_000_001, "50" as unknown as number]) expect(() => assertCents(bad, "Fianza")).toThrow(DepositRuleError);
  });
  it("convierte lo tecleado en euros sin errores de coma flotante", () => {
    expect(parseEurosToCents("12,50")).toBe(1250);
    expect(parseEurosToCents("0.1")).toBe(10);
    expect(parseEurosToCents(" 150 € ")).toBe(15000);
    expect(parseEurosToCents("19.99")).toBe(1999);
    expect(parseEurosToCents("1,234")).toBeNull();
    expect(parseEurosToCents("abc")).toBeNull();
    expect(parseEurosToCents("-5")).toBeNull();
  });
});

describe("importe sugerido por modelo o tipo", () => {
  const rules = [
    { modelId: null, assetType: "ski", amountCents: 5000, active: true },
    { modelId: 7, assetType: null, amountCents: 12000, active: true },
    { modelId: null, assetType: "boots", amountCents: 2000, active: false },
  ];
  it("la regla del modelo gana a la del tipo; sin regla activa, 0", () => {
    const r = suggestDeposit(
      [
        { modelId: 7, assetType: "ski" },
        { modelId: 3, assetType: "ski" },
        { modelId: 4, assetType: "boots" },
      ],
      rules,
    );
    expect(r.perLine).toEqual([12000, 5000, 0]);
    expect(r.totalCents).toBe(17000);
  });
  it("claves de regla únicas por modelo o tipo", () => {
    expect(ruleKey({ modelId: 7 })).toBe("model:7");
    expect(ruleKey({ assetType: "ski" })).toBe("type:ski");
    expect(() => ruleKey({})).toThrow(DepositRuleError);
  });
  it("daños sugeridos: el valor de reposición de lo perdido", () => {
    expect(
      suggestDamage([
        { returnCondition: "ok", replacementValueCents: 30000 },
        { returnCondition: "lost", replacementValueCents: 25000 },
        { returnCondition: "damaged", replacementValueCents: 40000 },
        { returnCondition: "lost", replacementValueCents: null },
      ]),
    ).toBe(25000);
  });
});

describe("liquidación de la fianza", () => {
  it("sin daños: devolución total", () => {
    expect(planSettlement(10000, 0)).toEqual({ damageCents: 0, refundCents: 10000, retainedCents: 0, extraChargeCents: 0, status: "refunded" });
  });
  it("daños menores que la fianza: retención parcial", () => {
    expect(planSettlement(10000, 3550)).toEqual({ damageCents: 3550, refundCents: 6450, retainedCents: 3550, extraChargeCents: 0, status: "retained_partial" });
  });
  it("daños iguales a la fianza: retención total sin cargo adicional", () => {
    expect(planSettlement(10000, 10000)).toMatchObject({ refundCents: 0, retainedCents: 10000, extraChargeCents: 0, status: "retained_total" });
  });
  it("daños mayores: retención total y cargo pendiente por la diferencia", () => {
    expect(planSettlement(10000, 25000)).toMatchObject({ refundCents: 0, retainedCents: 10000, extraChargeCents: 15000, status: "retained_total" });
  });
  it("devuelto + retenido = fianza siempre, y retenido + adicional = daños", () => {
    for (const [dep, dmg] of [
      [1, 0],
      [1, 1],
      [999, 1000],
      [5000, 1],
      [12345, 6789],
    ]) {
      const p = planSettlement(dep, dmg);
      expect(p.refundCents + p.retainedCents).toBe(dep);
      expect(p.retainedCents + p.extraChargeCents).toBe(dmg);
    }
  });
  it("importes no válidos", () => {
    expect(() => planSettlement(0, 0)).toThrow(DepositRuleError);
    expect(() => planSettlement(1000, -1)).toThrow(DepositRuleError);
    expect(() => planSettlement(1000, 1.5)).toThrow(DepositRuleError);
  });
  it("retener exige motivo; devolver todo, no", () => {
    expect(() => assertSettlementReason(planSettlement(1000, 0), null)).not.toThrow();
    expect(() => assertSettlementReason(planSettlement(1000, 200), null)).toThrow(/motivo/);
    expect(() => assertSettlementReason(planSettlement(1000, 200), "  ")).toThrow(/motivo/);
    expect(() => assertSettlementReason(planSettlement(1000, 200), "Canto roto")).not.toThrow();
  });
});

describe("movimientos de caja", () => {
  it("cobro en efectivo: entrada en la caja; con tarjeta o retención externa, nada", () => {
    expect(collectMovements("cash", 5000, 12)).toEqual([{ type: "in", cents: 5000, reason: "Fianza alquiler #12" }]);
    expect(collectMovements("card", 5000, 12)).toEqual([]);
    expect(collectMovements("external", 5000, 12)).toEqual([]);
  });
  it("devolución total en efectivo: una salida por toda la fianza", () => {
    expect(settlementMovements("cash", planSettlement(5000, 0), 12)).toEqual([{ type: "out", cents: 5000, reason: "Devolución fianza alquiler #12" }]);
  });
  it("retención parcial en efectivo: el cajón queda con lo retenido, que entra como venta", () => {
    const plan = planSettlement(5000, 1500);
    const moves = settlementMovements("cash", plan, 12);
    expect(moves.map((m) => [m.type, m.cents])).toEqual([
      ["out", 3500],
      ["out", 1500],
    ]);
    // entrada al cobrar − salidas + venta de daños en efectivo = lo que de verdad queda en el cajón
    const drawer = 5000 - moves.reduce((a, m) => a + m.cents, 0) + plan.retainedCents;
    expect(drawer).toBe(1500);
    expect(retentionPayMethod("cash")).toBe("cash");
  });
  it("retención total en efectivo: sin devolución, solo la aplicación a la venta", () => {
    expect(settlementMovements("cash", planSettlement(5000, 9000), 3).map((m) => m.cents)).toEqual([5000]);
  });
  it("tarjeta o retención externa: sin efectivo; la venta va con tarjeta u «otro»", () => {
    expect(settlementMovements("card", planSettlement(5000, 1500), 12)).toEqual([]);
    expect(settlementMovements("external", planSettlement(5000, 1500), 12)).toEqual([]);
    expect(retentionPayMethod("card")).toBe("card");
    expect(retentionPayMethod("external")).toBe("other");
  });
  it("caja abierta: siempre en efectivo; con tarjeta solo si hay venta de daños", () => {
    expect(needsCashSession("cash")).toBe(true);
    expect(needsCashSession("card", planSettlement(5000, 0))).toBe(false);
    expect(needsCashSession("card", planSettlement(5000, 1))).toBe(true);
    expect(needsCashSession("external", planSettlement(5000, 0))).toBe(false);
  });
});

describe("estados", () => {
  it("cobrada → liquidándose → devuelta / retenida; cerrada no cambia", () => {
    expect(() => assertDepositTransition("held", "settling")).not.toThrow();
    expect(() => assertDepositTransition("settling", "retained_partial")).not.toThrow();
    expect(() => assertDepositTransition("settling", "held")).not.toThrow();
    for (const closed of ["refunded", "retained_partial", "retained_total"] as const) {
      expect(() => assertDepositTransition(closed, "held")).toThrow(DepositRuleError);
      expect(() => assertDepositTransition(closed, "settling")).toThrow(DepositRuleError);
    }
  });
  it("cargo: pendiente → cobrándose → cobrado, o anulado", () => {
    expect(() => assertChargeTransition("pending", "paying")).not.toThrow();
    expect(() => assertChargeTransition("pending", "cancelled")).not.toThrow();
    expect(() => assertChargeTransition("paying", "paid")).not.toThrow();
    expect(() => assertChargeTransition("paid", "cancelled")).toThrow(DepositRuleError);
    expect(() => assertChargeTransition("cancelled", "paying")).toThrow(DepositRuleError);
  });
  it("las claves de idempotencia cumplen el formato del TPV", () => {
    for (const k of [retentionSaleKey(1, 1), retentionSaleKey(4294967295, 10_000_000), chargeSaleKey(1), chargeSaleKey(4294967295)]) expect(IDEMPOTENCY_KEY_RE.test(k)).toBe(true);
    expect(retentionSaleKey(5, 100)).not.toBe(chargeSaleKey(5));
    // Una liquidación nueva con otro importe retenido nunca reutiliza la venta de la anterior
    expect(retentionSaleKey(5, 100)).not.toBe(retentionSaleKey(5, 200));
    expect(retentionSaleKey(5, 100)).toBe(retentionSaleKey(5, 100));
  });
  it("cargo: el primer cobro usa la clave de siempre; tras una venta anulada en el TPV, la siguiente", () => {
    expect(chargeSaleKey(7)).toBe("skichg-7-pay");
    expect(chargeSaleKey(7, 1)).toBe("skichg-7-pay");
    expect(chargeSaleKey(7, 2)).toBe("skichg-7-pay-2");
    expect(IDEMPOTENCY_KEY_RE.test(chargeSaleKey(4294967295, 999))).toBe(true);
    // Las claves de un cargo nunca empiezan por las de otro (se buscan por prefijo «skichg-<id>-pay»)
    expect(chargeSaleKey(12).startsWith(chargeSaleKey(1))).toBe(false);
  });
});

describe("fotos: tipo real por la firma del contenido", () => {
  it("JPEG, PNG y WebP por sus bytes; lo demás, no", () => {
    expect(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(imageTypeOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(imageTypeOf(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(imageTypeOf(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageTypeOf(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(imageTypeOf(Buffer.alloc(0))).toBeNull();
  });
});

describe("totales del día (cierre de caja)", () => {
  // 2026-12-20 10:00 en Madrid = 09:00 UTC
  const at = (iso: string) => Date.parse(iso);
  const day = "2026-12-20";
  const rows: DepositRow[] = [
    { method: "cash", status: "held", amountCents: 5000, refundedCents: null, retainedCents: null, collectedAt: at("2026-12-20T09:00:00Z"), settledAt: null },
    { method: "card", status: "refunded", amountCents: 8000, refundedCents: 8000, retainedCents: 0, collectedAt: at("2026-12-19T09:00:00Z"), settledAt: at("2026-12-20T16:00:00Z") },
    { method: "cash", status: "retained_partial", amountCents: 6000, refundedCents: 4000, retainedCents: 2000, collectedAt: at("2026-12-20T08:00:00Z"), settledAt: at("2026-12-20T15:00:00Z") },
    // Cobrada a las 23:30 UTC del 20 = 00:30 del 21 en Madrid: no es de hoy
    { method: "external", status: "held", amountCents: 3000, refundedCents: null, retainedCents: null, collectedAt: at("2026-12-20T23:30:00Z"), settledAt: null },
  ];
  it("cobrado, devuelto, retenido y en custodia por forma de cobro", () => {
    const t = dayTotals(day, rows, [
      { status: "pending", amountCents: 1500, payMethod: null, createdAt: at("2026-12-20T15:00:00Z"), paidAt: null },
      { status: "paid", amountCents: 900, payMethod: "card", createdAt: at("2026-12-18T15:00:00Z"), paidAt: at("2026-12-20T12:00:00Z") },
      { status: "cancelled", amountCents: 700, payMethod: null, createdAt: at("2026-12-20T15:00:00Z"), paidAt: null },
    ]);
    expect(t.collected).toMatchObject({ cash: 11000, card: 0, external: 0, count: 2, total: 11000 });
    expect(t.refunded).toMatchObject({ cash: 4000, card: 8000, count: 2, total: 12000 });
    expect(t.retained).toMatchObject({ cash: 2000, count: 1, total: 2000 });
    expect(t.open).toMatchObject({ cash: 5000, external: 3000, count: 2, total: 8000 });
    expect(t.chargesPending).toEqual({ count: 1, total: 1500 });
    expect(t.chargesPaid).toEqual({ count: 1, total: 900 });
    // Efectivo de fianzas en la caja hoy: 11000 cobrados − 4000 devueltos − 2000 aplicados a la venta de daños
    expect(t.netCashCents).toBe(5000);
  });
  it("día de Madrid", () => {
    expect(madridDay(at("2026-12-20T23:30:00Z"))).toBe("2026-12-21");
    expect(madridDay(at("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
    expect(madridDay(at("2026-07-01T22:00:00Z"))).toBe("2026-07-02");
  });
});
