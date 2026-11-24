import { describe, expect, it } from "vitest";
import { DAY_MS, computeModuleWindows, effectiveEnrollmentStatus, evaluateAccess, extendedEnd, extensionKey, modulesWithoutDuration, type EnrollmentView } from "../shared/learning";

const T0 = Date.parse("2026-12-01T10:00:00Z");
const base = { startsAt: T0, endsAt: T0 + 90 * DAY_MS };

describe("calendario por módulo (reglas puras)", () => {
  it("sin calendario no hay ventanas propias: todo hereda la de la matrícula", () => {
    expect(computeModuleWindows({ moduleIds: [1, 2], durationDays: 90 }, base)).toEqual({ windows: {}, enrollmentEndsAt: base.endsAt });
  });
  it("desbloqueo progresivo: la duración cuenta desde el desbloqueo y la matrícula acaba con su último módulo", () => {
    const r = computeModuleWindows({ moduleIds: [1, 2, 3], durationDays: 90, moduleSchedule: { 2: { unlockOffsetDays: 30, durationDays: null }, 3: { unlockOffsetDays: 60, durationDays: null } } }, base);
    expect(r.windows[1]).toEqual({ startsAt: null, endsAt: T0 + 90 * DAY_MS });
    expect(r.windows[2]).toEqual({ startsAt: T0 + 30 * DAY_MS, endsAt: T0 + 120 * DAY_MS });
    expect(r.windows[3]).toEqual({ startsAt: T0 + 60 * DAY_MS, endsAt: T0 + 150 * DAY_MS });
    expect(r.enrollmentEndsAt).toBe(T0 + 150 * DAY_MS);
  });
  it("módulo sin duración (ni propia ni heredada) no caduca y hace que la matrícula tampoco", () => {
    const rule = { moduleIds: [1, 2], durationDays: null, moduleSchedule: { 1: { unlockOffsetDays: null, durationDays: 30 } } };
    expect(modulesWithoutDuration(rule)).toEqual([2]);
    expect(computeModuleWindows(rule, { startsAt: T0, endsAt: null }).enrollmentEndsAt).toBeNull();
  });
  it("evaluación por módulo: aún no desbloqueado (con fecha), vigente y caducado", () => {
    const e: EnrollmentView = { status: "active", startsAt: T0, endsAt: T0 + 120 * DAY_MS, moduleIds: [1, 2], moduleWindows: { 1: { startsAt: null, endsAt: T0 + 30 * DAY_MS }, 2: { startsAt: T0 + 30 * DAY_MS, endsAt: T0 + 120 * DAY_MS } } };
    expect(evaluateAccess(e, 2, T0 + 29 * DAY_MS)).toEqual({ allowed: false, reason: "not_started", unlocksAt: T0 + 30 * DAY_MS });
    expect(evaluateAccess(e, 1, T0 + 29 * DAY_MS).allowed).toBe(true);
    expect(evaluateAccess(e, 1, T0 + 30 * DAY_MS)).toEqual({ allowed: false, reason: "expired" });
    expect(evaluateAccess(e, 2, T0 + 30 * DAY_MS).allowed).toBe(true);
    expect(evaluateAccess(e, 3, T0).reason).toBe("module_not_granted");
    expect(effectiveEnrollmentStatus(e, T0 + 60 * DAY_MS)).toBe("active");
    expect(effectiveEnrollmentStatus(e, T0 + 121 * DAY_MS)).toBe("expired");
  });
  it("ampliación: desde el mayor entre el fin actual y ahora; la clave incluye pedido, módulo y días", () => {
    expect(extendedEnd(T0 + 10 * DAY_MS, T0, 30)).toBe(T0 + 40 * DAY_MS);
    expect(extendedEnd(T0 - 10 * DAY_MS, T0, 60)).toBe(T0 + 60 * DAY_MS);
    expect(extensionKey({ ref: "PED-1", moduleId: 5, days: 30 })).not.toBe(extensionKey({ ref: "PED-1", moduleId: 5, days: 60 }));
  });
});
