// Regression tests for importExcel dedup failures.
// T1 + T2 FAIL with the old makeDuplicateKey formula (they document the bug).
// T3 PASS (genuinely different operations are correctly distinguished).
// T4-T7 test the tpv_sales fallback window logic in tryAutoLink.
// All tests PASS after fix/cardops-dedup-key + fix/cardops-tpv-sales-link.

import { describe, expect, it } from "vitest";
import { makeDuplicateKey, isWithinTpvWindow } from "./routers/cardTerminalOperations";

const DT     = new Date("2026-05-01T13:00:00.000Z");
const DT_1M  = new Date("2026-05-01T13:01:00.000Z"); // 1 minute later

describe("makeDuplicateKey — dedup regression", () => {
  it("T1: misma operación con commerceCode ausente vs presente → misma clave (dedup debe funcionar)", () => {
    // Excel 1 exported without commerce code column → commerceCode=""
    const keyWithout = makeDuplicateKey("",      "01510839", "906800", 30.00, DT);
    // Excel 2 exported with commerce code → commerceCode="12345"
    const keyWith    = makeDuplicateKey("12345", "01510839", "906800", 30.00, DT);

    // Should be equal so the second import is detected as a duplicate.
    // FAILS with current formula: "|01510839|..." !== "12345|01510839|..."
    expect(keyWithout).toBe(keyWith);
  });

  it("T2: misma operación con datetime difiriendo 1 minuto → misma clave (dedup debe funcionar)", () => {
    // Two exports of the same physical operation, captured at slightly different seconds/minutes.
    const key1 = makeDuplicateKey("", "01510839", "906800", 30.00, DT);
    const key2 = makeDuplicateKey("", "01510839", "906800", 30.00, DT_1M);

    // Should be equal so the second import is detected as a duplicate.
    // FAILS with current formula: "...T13:00" !== "...T13:01"
    expect(key1).toBe(key2);
  });

  it("T3: operaciones genuinamente distintas → claves distintas (no debe deduplicar)", () => {
    const keyA = makeDuplicateKey("", "01510839", "906800", 30.00, DT);
    const keyB = makeDuplicateKey("", "01510839", "906801", 50.00, new Date("2026-05-01T14:00:00.000Z"));

    // Different operations must produce different keys. PASSES with current formula.
    expect(keyA).not.toBe(keyB);
  });
});

describe("isWithinTpvWindow — ventana temporal [-2h, +30min]", () => {
  const OP_DT = new Date("2026-05-01T13:00:00.000Z");
  const OP_MS = OP_DT.getTime();

  it("T4: createdAt igual a operation_datetime → dentro de la ventana", () => {
    expect(isWithinTpvWindow(OP_MS, OP_DT)).toBe(true);
  });

  it("T5: createdAt exactamente en el límite inferior (-2h) → dentro de la ventana", () => {
    expect(isWithinTpvWindow(OP_MS - 2 * 60 * 60 * 1000, OP_DT)).toBe(true);
  });

  it("T6: createdAt 1ms antes del límite inferior (-2h - 1ms) → fuera de la ventana", () => {
    expect(isWithinTpvWindow(OP_MS - 2 * 60 * 60 * 1000 - 1, OP_DT)).toBe(false);
  });

  it("T7: createdAt 1ms después del límite superior (+30min + 1ms) → fuera de la ventana", () => {
    expect(isWithinTpvWindow(OP_MS + 30 * 60 * 1000 + 1, OP_DT)).toBe(false);
  });
});
