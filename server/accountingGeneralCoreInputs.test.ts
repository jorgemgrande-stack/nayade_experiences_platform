/**
 * Contabilidad general — lo que el TPV guarda para ella: solo el tipo de movimiento de caja que el cajero eligió de
 * forma explícita (tpv.addCashMovement). Sin tipo, nada: el TPV se comporta como siempre. Sin BD.
 */
import { describe, expect, it } from "vitest";
import { explicitCashMoveKind } from "./cashMovementKindsDb";

describe("tipo de un movimiento manual de la caja del TPV", () => {
  it("se guarda el tipo elegido, tal cual: el motivo nunca lo cambia", () => {
    expect(explicitCashMoveKind({ type: "out", outKind: "gasto" })).toBe("gasto");
    expect(explicitCashMoveKind({ type: "out", outKind: "devolucion" })).toBe("devolucion");
    expect(explicitCashMoveKind({ type: "out", outKind: "traspaso" })).toBe("traspaso");
    expect(explicitCashMoveKind({ type: "in", inKind: "fondo" })).toBe("fondo");
    expect(explicitCashMoveKind({ type: "in", inKind: "cobro" })).toBe("cobro");
  });
  it("sin tipo elegido (API, movimientos anteriores): null, sin suponer ninguno", () => {
    expect(explicitCashMoveKind({ type: "out" })).toBeNull();
    expect(explicitCashMoveKind({ type: "in" })).toBeNull();
    expect(explicitCashMoveKind({ type: "in", outKind: "gasto" })).toBeNull();
  });
});
