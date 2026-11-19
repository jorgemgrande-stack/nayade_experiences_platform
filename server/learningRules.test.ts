import { describe, expect, it } from "vitest";
import {
  DAY_MS, DEMO_MS, LearningRuleError, assertPaymentConfirmed, assertReason, computeWindow, effectiveStatus, evaluateAccess, evaluateAny, matchRules,
  mergeModules, mimeMatchesKind, paymentKey, progressPercent, type AccessRule, type EnrollmentView,
} from "../shared/learning";

const rule = (p: Partial<AccessRule>): AccessRule => ({ id: 1, experienceId: 1, variantId: null, courseId: 1, moduleIds: [1], durationDays: 90, startMode: "on_grant", fixedStart: null, active: true, ...p });
const T0 = Date.parse("2026-12-01T10:00:00Z");
const enr = (p: Partial<EnrollmentView> = {}): EnrollmentView => ({ status: "active", startsAt: T0, endsAt: T0 + 90 * DAY_MS, moduleIds: [1, 2, 3], ...p });

describe("reglas por modalidad (RECONNECT)", () => {
  const rules = [
    rule({ id: 1, variantId: 13, moduleIds: [1] }), // + MÓDULO 1
    rule({ id: 2, variantId: 10, moduleIds: [1, 2, 3] }), // ONLINE promo
    rule({ id: 3, variantId: 9, moduleIds: [1, 2, 3] }), // ONLINE
    rule({ id: 4, variantId: 14, moduleIds: [1, 2, 3] }), // INTENSIV promo
    rule({ id: 5, variantId: 11, moduleIds: [1, 2, 3] }), // INTENSIV
  ];
  it("LIVE (variante 8) no concede nada: sin regla no hay acceso", () => expect(matchRules(rules, 1, 8)).toEqual([]));
  it("+ MÓDULO 1 concede solo el módulo 1", () => expect(matchRules(rules, 1, 13).map((r) => r.moduleIds)).toEqual([[1]]));
  it("ONLINE e INTENSIV conceden los tres módulos", () => {
    expect(matchRules(rules, 1, 9)[0].moduleIds).toEqual([1, 2, 3]);
    expect(matchRules(rules, 1, 11)[0].moduleIds).toEqual([1, 2, 3]);
  });
  it("una regla genérica del producto solo se usa si no hay una de la variante", () => {
    const g = [rule({ id: 9, variantId: null, moduleIds: [1] }), rule({ id: 10, variantId: 5, moduleIds: [2] })];
    expect(matchRules(g, 1, 5).map((r) => r.id)).toEqual([10]);
    expect(matchRules(g, 1, 6).map((r) => r.id)).toEqual([9]);
  });
  it("ignora reglas inactivas y de otros productos", () => {
    expect(matchRules([rule({ active: false }), rule({ experienceId: 2 })], 1, null)).toEqual([]);
  });
});

describe("ventana de la matrícula", () => {
  it("inicio desde la concesión + 3 meses (90 días)", () => {
    const w = computeWindow({ startMode: "on_grant", fixedStart: null, durationDays: 90, grantedAt: T0 });
    expect(w).toEqual({ startsAt: T0, endsAt: T0 + 90 * DAY_MS });
  });
  it("inicio en fecha fija configurada", () => {
    const fixed = Date.parse("2026-11-29T00:00:00Z");
    expect(computeWindow({ startMode: "fixed_date", fixedStart: fixed, durationDays: 90, grantedAt: T0 })).toEqual({ startsAt: fixed, endsAt: fixed + 90 * DAY_MS });
  });
  it("sin duración = sin caducidad; fecha fija sin fecha cae al momento de la concesión", () => {
    expect(computeWindow({ startMode: "on_grant", fixedStart: null, durationDays: null, grantedAt: T0 }).endsAt).toBeNull();
    expect(computeWindow({ startMode: "fixed_date", fixedStart: null, durationDays: 10, grantedAt: T0 }).startsAt).toBe(T0);
  });
  it("la demostración dura 60 minutos", () => expect(DEMO_MS).toBe(3_600_000));
});

describe("autorización de módulo", () => {
  it("anónimo o sin matrícula: denegado", () => {
    expect(evaluateAccess(null, 1, T0)).toEqual({ allowed: false, reason: "no_enrollment" });
    expect(evaluateAny([], 1, T0)).toEqual({ allowed: false, reason: "no_enrollment" });
  });
  it("alumno de módulo 1 no abre 2 ni 3; ONLINE abre los tres", () => {
    const m1 = enr({ moduleIds: [1] });
    expect(evaluateAccess(m1, 1, T0 + 1).allowed).toBe(true);
    expect(evaluateAccess(m1, 2, T0 + 1)).toEqual({ allowed: false, reason: "module_not_granted" });
    expect(evaluateAccess(m1, 3, T0 + 1)).toEqual({ allowed: false, reason: "module_not_granted" });
    for (const m of [1, 2, 3]) expect(evaluateAccess(enr(), m, T0 + 1).allowed).toBe(true);
  });
  it("caduca exactamente al llegar a endsAt, aunque la tarea de caducidad no haya corrido", () => {
    const e = enr();
    expect(evaluateAccess(e, 1, e.endsAt! - 1).allowed).toBe(true);
    expect(evaluateAccess(e, 1, e.endsAt!)).toEqual({ allowed: false, reason: "expired" });
  });
  it("aún no empezada, suspendida y revocada: denegado", () => {
    expect(evaluateAccess(enr({ startsAt: T0 + 1000 }), 1, T0)).toEqual({ allowed: false, reason: "not_started" });
    expect(evaluateAccess(enr({ status: "suspended" }), 1, T0 + 1)).toEqual({ allowed: false, reason: "inactive" });
    expect(evaluateAccess(enr({ status: "revoked" }), 1, T0 + 1)).toEqual({ allowed: false, reason: "inactive" });
  });
  it("una prórroga (nuevo endsAt) restaura el acceso", () => {
    const e = enr({ status: "active", endsAt: T0 + 10 });
    expect(evaluateAccess(e, 1, T0 + 20).allowed).toBe(false);
    expect(evaluateAccess({ ...e, endsAt: T0 + 100 }, 1, T0 + 20).allowed).toBe(true);
  });
  it("basta una matrícula que abra el módulo (ampliación en curso)", () => {
    expect(evaluateAny([enr({ moduleIds: [1] }), enr({ moduleIds: [2] })], 2, T0 + 1).allowed).toBe(true);
  });
  it("estado efectivo", () => {
    expect(effectiveStatus(enr(), T0 + 1)).toBe("active");
    expect(effectiveStatus(enr(), T0 + 91 * DAY_MS)).toBe("expired");
    expect(effectiveStatus(enr({ startsAt: T0 + 5 }), T0)).toBe("scheduled");
    expect(effectiveStatus(enr({ status: "revoked" }), T0)).toBe("revoked");
  });
});

describe("el pago confirmado es obligatorio", () => {
  it("rechaza pagos sin referencia, sin importe o sin verificador", () => {
    for (const p of [null, {}, { reference: "", amountCents: 100, verifiedBy: "x" }, { reference: "r", amountCents: 0, verifiedBy: "x" }, { reference: "r", amountCents: 100, verifiedBy: " " }, { reference: "r", amountCents: NaN, verifiedBy: "x" }]) {
      expect(() => assertPaymentConfirmed(p as any)).toThrow(LearningRuleError);
    }
  });
  it("acepta un pago verificado", () => expect(assertPaymentConfirmed({ reference: " TRF-77 ", amountCents: 33300, verifiedBy: "Soporte" })).toEqual({ reference: "TRF-77", amountCents: 33300, verifiedBy: "Soporte" }));
  it("la concesión administrativa exige motivo", () => {
    expect(() => assertReason("")).toThrow(LearningRuleError);
    expect(() => assertReason("corto")).toThrow(LearningRuleError);
    expect(assertReason("  Acuerdo con Indira por correo  ")).toBe("Acuerdo con Indira por correo");
  });
});

describe("idempotencia, progreso y ampliación", () => {
  it("la misma compra y regla producen siempre la misma clave", () => {
    const a = paymentKey({ operationKind: "enrollment", operationId: 7, ruleId: 3, userId: 12 });
    expect(a).toBe(paymentKey({ operationKind: "enrollment", operationId: 7, ruleId: 3, userId: 12 }));
    expect(a).not.toBe(paymentKey({ operationKind: "enrollment", operationId: 7, ruleId: 4, userId: 12 }));
  });
  it("progreso", () => {
    expect(progressPercent(21, 0)).toBe(0);
    expect(progressPercent(21, 7)).toBe(33);
    expect(progressPercent(21, 21)).toBe(100);
    expect(progressPercent(0, 0)).toBe(0);
  });
  it("ampliar añade módulos sin perder los anteriores", () => expect(mergeModules([1], [1, 2, 3])).toEqual([1, 2, 3]));
});

describe("tipo MIME por tipo de recurso", () => {
  it("un recurso audio acepta audio/* y los contenedores video/mp4 y video/webm (así llegan los «Audio» de Articulate)", () => {
    for (const m of ["audio/mpeg", "audio/mp4", "video/mp4", "video/webm"]) expect(mimeMatchesKind("audio", m)).toBe(true);
    expect(mimeMatchesKind("audio", "video/quicktime")).toBe(false);
    expect(mimeMatchesKind("audio", "application/pdf")).toBe(false);
  });
  it("el resto de tipos no cambia: un PDF no vale para vídeo ni audio, y un vídeo no vale para un PDF", () => {
    expect(mimeMatchesKind("pdf", "video/mp4")).toBe(false);
    expect(mimeMatchesKind("pdf", "application/pdf")).toBe(true);
    expect(mimeMatchesKind("video", "application/pdf")).toBe(false);
    expect(mimeMatchesKind("video", "video/mp4")).toBe(true);
    expect(mimeMatchesKind("video", "audio/mpeg")).toBe(false);
    expect(mimeMatchesKind("desconocido", "video/mp4")).toBe(false);
  });
});
