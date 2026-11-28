/**
 * Escalonado RECONNECT (decisión de Indira, 27/11/2026), lógica pura: M1 día 0, M2 día 30, M3 día 60, 30 días EXACTOS por módulo.
 * Decisión documentada: «30 días» = 30 × 24 h (30 × DAY_MS), ventanas contiguas con la frontera final excluida.
 */
import { describe, expect, it } from "vitest";
import {
  DAY_MS, RECONNECT_MODULE_DAYS, RECONNECT_STAGGER_STEP_DAYS, computeModuleWindows, effectiveEnrollmentStatus, evaluateAccess, moduleAccessStates,
  reconnectStaggeredSettings, type EnrollmentView,
} from "../shared/learning";

const T0 = Date.parse("2026-12-01T10:00:00Z");
const D30 = 30 * DAY_MS;

/** Regla escalonada tal y como la guardaría saveRule con los ajustes del preset. */
function staggeredRule(moduleIds: number[]) {
  const moduleSchedule = Object.fromEntries(reconnectStaggeredSettings(moduleIds).map((s) => [s.moduleId, { unlockOffsetDays: s.unlockOffsetDays, durationDays: s.durationDays }]));
  return { moduleIds, durationDays: RECONNECT_MODULE_DAYS, moduleSchedule };
}

/** Matrícula resultante de conceder la regla en T0. */
function enrollmentFor(moduleIds: number[]): EnrollmentView {
  const rule = staggeredRule(moduleIds);
  const mw = computeModuleWindows(rule, { startsAt: T0, endsAt: T0 + RECONNECT_MODULE_DAYS * DAY_MS });
  return { id: 1, status: "active", startsAt: T0, endsAt: mw.enrollmentEndsAt, moduleIds, moduleWindows: mw.windows };
}

describe("reconnectStaggeredSettings", () => {
  it("devuelve 0/30/60 con 30 días cada uno, en el orden dado, sin repetir módulos", () => {
    expect(RECONNECT_STAGGER_STEP_DAYS).toBe(30);
    expect(RECONNECT_MODULE_DAYS).toBe(30);
    expect(reconnectStaggeredSettings([11, 12, 13])).toEqual([
      { moduleId: 11, unlockOffsetDays: 0, durationDays: 30 },
      { moduleId: 12, unlockOffsetDays: 30, durationDays: 30 },
      { moduleId: 13, unlockOffsetDays: 60, durationDays: 30 },
    ]);
    expect(reconnectStaggeredSettings([11, 11, 12])).toHaveLength(2);
  });
  it("+MODUL 1: un solo módulo, 30 días desde el día 0", () => {
    expect(reconnectStaggeredSettings([11])).toEqual([{ moduleId: 11, unlockOffsetDays: 0, durationDays: 30 }]);
  });
});

describe("ventanas contiguas de 30 × 24 h exactas", () => {
  it("M1 [T0, T0+30d), M2 [T0+30d, T0+60d), M3 [T0+60d, T0+90d); la matrícula acaba con el M3", () => {
    const e = enrollmentFor([1, 2, 3]);
    expect(e.moduleWindows).toEqual({
      1: { startsAt: null, endsAt: T0 + D30 },
      2: { startsAt: T0 + D30, endsAt: T0 + 2 * D30 },
      3: { startsAt: T0 + 2 * D30, endsAt: T0 + 3 * D30 },
    });
    expect(e.endsAt).toBe(T0 + 90 * DAY_MS);
    expect(T0 + 3 * D30 - T0).toBe(90 * 24 * 60 * 60 * 1000); // ms exactos, sin días naturales
  });

  it("en cada frontera: permitido justo antes, denegado justo en ella, y el módulo siguiente abre en ese mismo instante", () => {
    const e = enrollmentFor([1, 2, 3]);
    // M1
    expect(evaluateAccess(e, 1, T0).allowed).toBe(true);
    expect(evaluateAccess(e, 1, T0 + D30 - 1).allowed).toBe(true);
    expect(evaluateAccess(e, 1, T0 + D30)).toEqual({ allowed: false, reason: "expired" });
    // M2
    expect(evaluateAccess(e, 2, T0 + D30 - 1)).toEqual({ allowed: false, reason: "not_started", unlocksAt: T0 + D30 });
    expect(evaluateAccess(e, 2, T0 + D30).allowed).toBe(true);
    expect(evaluateAccess(e, 2, T0 + 2 * D30 - 1).allowed).toBe(true);
    expect(evaluateAccess(e, 2, T0 + 2 * D30)).toEqual({ allowed: false, reason: "expired" });
    // M3
    expect(evaluateAccess(e, 3, T0 + 2 * D30 - 1)).toEqual({ allowed: false, reason: "not_started", unlocksAt: T0 + 2 * D30 });
    expect(evaluateAccess(e, 3, T0 + 2 * D30).allowed).toBe(true);
    expect(evaluateAccess(e, 3, T0 + 3 * D30 - 1).allowed).toBe(true);
    expect(evaluateAccess(e, 3, T0 + 3 * D30)).toEqual({ allowed: false, reason: "expired" });
    // en todo momento hay exactamente un módulo abierto hasta los 90 días
    for (const t of [T0, T0 + D30 - 1, T0 + D30, T0 + 2 * D30 - 1, T0 + 2 * D30, T0 + 3 * D30 - 1]) expect([1, 2, 3].filter((m) => evaluateAccess(e, m, t).allowed)).toHaveLength(1);
    expect([1, 2, 3].filter((m) => evaluateAccess(e, m, T0 + 3 * D30).allowed)).toHaveLength(0);
  });

  it("estado global y por módulo para la administración: activo / futuro / caducado", () => {
    const e = enrollmentFor([1, 2, 3]);
    expect(moduleAccessStates(e, T0 + 10 * DAY_MS)).toEqual([
      { moduleId: 1, state: "active", startsAt: T0, endsAt: T0 + D30 },
      { moduleId: 2, state: "scheduled", startsAt: T0 + D30, endsAt: T0 + 2 * D30 },
      { moduleId: 3, state: "scheduled", startsAt: T0 + 2 * D30, endsAt: T0 + 3 * D30 },
    ]);
    expect(moduleAccessStates(e, T0 + 45 * DAY_MS).map((m) => m.state)).toEqual(["expired", "active", "scheduled"]);
    expect(moduleAccessStates(e, T0 + 95 * DAY_MS).map((m) => m.state)).toEqual(["expired", "expired", "expired"]);
    expect(effectiveEnrollmentStatus(e, T0 + 45 * DAY_MS)).toBe("active");
    expect(effectiveEnrollmentStatus(e, T0 + 3 * D30)).toBe("expired");
    expect(effectiveEnrollmentStatus({ ...e, startsAt: T0 + DAY_MS, moduleWindows: { 2: { startsAt: T0 + 5 * DAY_MS, endsAt: T0 + 10 * DAY_MS } }, moduleIds: [2] }, T0)).toBe("scheduled");
    // pendiente de activar y suspendida
    expect(moduleAccessStates({ ...e, pendingActivationDays: 30 }, T0).map((m) => m.state)).toEqual(["pending_activation", "pending_activation", "pending_activation"]);
    expect(moduleAccessStates({ ...e, status: "suspended" }, T0).map((m) => m.state)).toEqual(["inactive", "inactive", "inactive"]);
  });

  it("+MODUL 1: solo M1, 30 días exactos; M2 y M3 no están concedidos", () => {
    const e = enrollmentFor([1]);
    expect(e.endsAt).toBe(T0 + D30);
    expect(evaluateAccess(e, 1, T0 + D30 - 1).allowed).toBe(true);
    expect(evaluateAccess(e, 1, T0 + D30)).toEqual({ allowed: false, reason: "expired" });
    expect(evaluateAccess(e, 2, T0)).toEqual({ allowed: false, reason: "module_not_granted" });
    expect(evaluateAccess(e, 3, T0)).toEqual({ allowed: false, reason: "module_not_granted" });
  });
});
