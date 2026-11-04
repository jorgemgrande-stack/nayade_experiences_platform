/**
 * Encuestas y propuestas de comunidades — lógica pura (shared/communityPolls.ts). Pruebas portadas de Segolife
 * (communityQuestionTypeValidation.test.ts, communityResponseService.test.ts::buildValueRows/sanitizeOpenText/
 * canStudentRespondAgain, communityIntentService.test.ts, communityScoreService.test.ts) y las nuevas de ventana
 * efectiva sin planificador y visibilidad de resultados.
 */
import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_CODES,
  MAX_OPTIONS,
  MIN_OPTIONS,
  QUESTION_TYPES_WITH_OPTIONS,
  ResponseError,
  attendanceFromCode,
  buildValueRows,
  canRespondAgain,
  canSupportProposal,
  communityScore,
  effectiveStatus,
  isOpenForResponses,
  isPositiveRespondent,
  medianMinutes,
  resultsVisible,
  sanitizeOpenText,
  validateQuestionOptions,
} from "../shared/communityPolls";

describe("validateQuestionOptions — tipos con opciones (Segolife)", () => {
  for (const type of QUESTION_TYPES_WITH_OPTIONS) {
    it(`${type}: mínimo ${MIN_OPTIONS}, máximo ${MAX_OPTIONS}, sin vacías y recortadas`, () => {
      expect(validateQuestionOptions(type, [])).toMatchObject({ ok: false });
      expect(validateQuestionOptions(type, ["Jueves"])).toMatchObject({ ok: false });
      expect(validateQuestionOptions(type, ["Jueves", "   ", ""])).toMatchObject({ ok: false });
      expect(validateQuestionOptions(type, ["  Jueves  ", "Viernes"])).toEqual({ ok: true, cleanOptions: ["Jueves", "Viernes"] });
      expect(validateQuestionOptions(type, Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `Opción ${i}`))).toMatchObject({ ok: false });
    });
  }
  it("rechaza opciones repetidas y quita etiquetas", () => {
    expect(validateQuestionOptions("single_choice", ["Sí", "sí"])).toMatchObject({ ok: false, error: "Hay opciones repetidas" });
    expect(validateQuestionOptions("multiselect", ["<b>A</b>", "B"]).cleanOptions).toEqual(["A", "B"]);
  });
});

describe("validateQuestionOptions — tipos sin opciones (Segolife)", () => {
  for (const type of ["yes_no", "scale_1_5", "attendance_intention", "me_apunto", "open_text"] as const) {
    it(`${type}: sin opciones sí; con opciones arbitrarias, no`, () => {
      expect(validateQuestionOptions(type, [])).toEqual({ ok: true, cleanOptions: [] });
      expect(validateQuestionOptions(type, null)).toEqual({ ok: true, cleanOptions: [] });
      expect(validateQuestionOptions(type, ["Jueves", "Viernes"])).toMatchObject({ ok: false });
    });
  }
});

describe("buildValueRows — validación por tipo de pregunta (Segolife)", () => {
  const opts = [11, 12, 13];
  const bad = (f: () => unknown) => expect(f).toThrow(ResponseError);
  it("single_choice: opción válida, una fila; ajena, error", () => {
    expect(buildValueRows({ questionType: "single_choice", optionId: 12 }, opts)).toEqual([{ optionId: 12, valueText: null, valueNumber: null }]);
    bad(() => buildValueRows({ questionType: "single_choice", optionId: 99 }, opts));
  });
  it("yes_no: solo yes/no", () => {
    expect(buildValueRows({ questionType: "yes_no", value: "yes" }, [])[0].valueText).toBe("yes");
    bad(() => buildValueRows({ questionType: "yes_no", value: "quizá" as "yes" }, []));
  });
  it("percentage_scale: enteros 0-100 por criterio, sin repetir", () => {
    expect(buildValueRows({ questionType: "percentage_scale", values: [{ optionId: 11, value: 0 }, { optionId: 12, value: 100 }] }, opts)).toHaveLength(2);
    bad(() => buildValueRows({ questionType: "percentage_scale", values: [{ optionId: 11, value: 101 }] }, opts));
    bad(() => buildValueRows({ questionType: "percentage_scale", values: [{ optionId: 11, value: 5.5 }] }, opts));
    bad(() => buildValueRows({ questionType: "percentage_scale", values: [] }, opts));
    bad(() => buildValueRows({ questionType: "percentage_scale", values: [{ optionId: 11, value: 1 }, { optionId: 11, value: 2 }] }, opts));
  });
  it("scale_1_5: solo enteros 1-5", () => {
    expect(buildValueRows({ questionType: "scale_1_5", value: 5 }, [])[0].valueNumber).toBe(5);
    bad(() => buildValueRows({ questionType: "scale_1_5", value: 0 }, []));
    bad(() => buildValueRows({ questionType: "scale_1_5", value: 3.5 }, []));
  });
  it("multiselect: rechaza vacío y duplicados", () => {
    expect(buildValueRows({ questionType: "multiselect", optionIds: [11, 13] }, opts)).toHaveLength(2);
    bad(() => buildValueRows({ questionType: "multiselect", optionIds: [] }, opts));
    bad(() => buildValueRows({ questionType: "multiselect", optionIds: [11, 11] }, opts));
  });
  it("ranking: todas las opciones, sin duplicados, posición desde 1", () => {
    expect(buildValueRows({ questionType: "ranking", orderedOptionIds: [13, 11, 12] }, opts).map((r) => [r.optionId, r.valueNumber])).toEqual([[13, 1], [11, 2], [12, 3]]);
    bad(() => buildValueRows({ questionType: "ranking", orderedOptionIds: [13, 11] }, opts));
    bad(() => buildValueRows({ questionType: "ranking", orderedOptionIds: [13, 13, 11] }, opts));
  });
  it("attendance_intention: código numérico; me_apunto: fila fija", () => {
    expect(buildValueRows({ questionType: "attendance_intention", value: "probably" }, [])[0]).toEqual({ optionId: null, valueText: "probably", valueNumber: ATTENDANCE_CODES.probably });
    expect(buildValueRows({ questionType: "me_apunto" }, [])).toEqual([{ optionId: null, valueText: "me_apunto", valueNumber: null }]);
  });
  it("open_text: rechaza vacío tras sanear (solo HTML)", () => {
    bad(() => buildValueRows({ questionType: "open_text", text: "<p></p>" }, []));
    expect(buildValueRows({ questionType: "open_text", text: " <i>Hola</i> " }, [])[0].valueText).toBe("Hola");
  });
  it("sanitizeOpenText: sin etiquetas y acotado", () => {
    expect(sanitizeOpenText("<script>x</script>y")).toBe("xy");
    expect(sanitizeOpenText("a".repeat(2000))).toHaveLength(1000);
  });
});

describe("canRespondAgain (canStudentRespondAgain de Segolife)", () => {
  it("me_apunto nunca se cambia; el resto según la configuración", () => {
    expect(canRespondAgain({ questionType: "me_apunto", allowChangeResponse: true })).toBe(false);
    expect(canRespondAgain({ questionType: "yes_no", allowChangeResponse: true })).toBe(true);
    expect(canRespondAgain({ questionType: "yes_no", allowChangeResponse: false })).toBe(false);
  });
});

describe("intención y respondente positivo (communityIntentService de Segolife)", () => {
  it("códigos y semántica por tipo; null donde no hay regla", () => {
    expect(attendanceFromCode(3)).toBe("definitely");
    expect(attendanceFromCode(99)).toBe("no");
    expect(isPositiveRespondent("yes_no", [{ optionId: null, valueText: "yes", valueNumber: null }], new Set())).toBe(true);
    expect(isPositiveRespondent("attendance_intention", [{ optionId: null, valueText: "maybe", valueNumber: 1 }], new Set())).toBe(false);
    expect(isPositiveRespondent("attendance_intention", [{ optionId: null, valueText: "probably", valueNumber: 2 }], new Set())).toBe(true);
    expect(isPositiveRespondent("me_apunto", [{ optionId: null, valueText: "me_apunto", valueNumber: null }], new Set())).toBe(true);
    expect(isPositiveRespondent("single_choice", [{ optionId: 7, valueText: null, valueNumber: null }], new Set([7]))).toBe(true);
    expect(isPositiveRespondent("single_choice", [{ optionId: 8, valueText: null, valueNumber: null }], new Set([7]))).toBe(false);
    expect(isPositiveRespondent("ranking", [], new Set())).toBeNull();
    expect(isPositiveRespondent("open_text", [], new Set())).toBeNull();
  });
});

describe("communityScore (communityScoreService de Segolife)", () => {
  const base = { totalAudience: 10, positiveRespondents: 2, strongIntentRespondents: 1, medianResponseMinutes: 30 };
  it("menos de 3 respuestas: datos insuficientes, sin dimensiones", () => {
    expect(communityScore({ ...base, totalResponses: 2 })).toEqual({ score: 0, insufficientData: true, dimensions: [] });
    expect(communityScore({ ...base, totalResponses: 3 }).insufficientData).toBe(false);
  });
  it("sin intención (null) se omiten esas dimensiones sin penalizar; audiencia 0 no da NaN", () => {
    const r = communityScore({ totalResponses: 5, totalAudience: 0, positiveRespondents: null, strongIntentRespondents: null, medianResponseMinutes: null });
    expect(r.dimensions.map((d) => d.key)).toEqual(["participation", "sampleQuality"]);
    expect(Number.isFinite(r.score)).toBe(true);
  });
  it("la muestra satura en 100; misma proporción, misma participación", () => {
    const s20 = communityScore({ ...base, totalResponses: 20, totalAudience: 40 }).dimensions.find((d) => d.key === "sampleQuality")!;
    const s2000 = communityScore({ ...base, totalResponses: 2000, totalAudience: 4000 }).dimensions.find((d) => d.key === "sampleQuality")!;
    expect(s20.normalizedScore).toBe(100);
    expect(s2000.normalizedScore).toBe(100);
    const small = communityScore({ ...base, totalResponses: 5, totalAudience: 10 }).dimensions[0];
    const large = communityScore({ ...base, totalResponses: 500, totalAudience: 1000 }).dimensions[0];
    expect(small.normalizedScore).toBe(large.normalizedScore);
  });
  it("mediana de minutos de respuesta", () => {
    expect(medianMinutes(null, [1])).toBeNull();
    expect(medianMinutes(0, [])).toBeNull();
    expect(medianMinutes(0, [60_000, 180_000, 120_000])).toBe(2);
    expect(medianMinutes(0, [60_000, 180_000])).toBe(2);
  });
});

describe("ventana efectiva sin planificador y visibilidad de resultados", () => {
  const now = 1_000_000;
  it("abierta, programada, cerrada por fecha; borradores y canceladas tal cual", () => {
    expect(effectiveStatus({ status: "active", startsAt: null, endsAt: null }, now)).toBe("active");
    expect(effectiveStatus({ status: "active", startsAt: now + 1, endsAt: null }, now)).toBe("scheduled");
    expect(effectiveStatus({ status: "active", startsAt: null, endsAt: now - 1 }, now)).toBe("closed");
    expect(effectiveStatus({ status: "draft", startsAt: null, endsAt: null }, now)).toBe("draft");
    expect(isOpenForResponses({ status: "closed", startsAt: null, endsAt: null }, now)).toBe(false);
    expect(isOpenForResponses({ status: "active", startsAt: now - 10, endsAt: now + 10 }, now)).toBe(true);
  });
  it("resultados: siempre, tras responder (o al cerrar), al cerrar, nunca", () => {
    const open = { status: "active" as const, startsAt: null, endsAt: null };
    const closed = { status: "closed" as const, startsAt: null, endsAt: null };
    expect(resultsVisible({ ...open, resultsVisibility: "immediate" }, false, now)).toBe(true);
    expect(resultsVisible({ ...open, resultsVisibility: "after_vote" }, false, now)).toBe(false);
    expect(resultsVisible({ ...open, resultsVisibility: "after_vote" }, true, now)).toBe(true);
    expect(resultsVisible({ ...closed, resultsVisibility: "after_vote" }, false, now)).toBe(true);
    expect(resultsVisible({ ...open, resultsVisibility: "after_close" }, true, now)).toBe(false);
    expect(resultsVisible({ ...closed, resultsVisibility: "after_close" }, false, now)).toBe(true);
    expect(resultsVisible({ ...closed, resultsVisibility: "never" }, true, now)).toBe(false);
  });
  it("propuestas: solo se apoyan pendientes o aprobadas", () => {
    expect(canSupportProposal("pending")).toBe(true);
    expect(canSupportProposal("approved")).toBe(true);
    expect(canSupportProposal("rejected")).toBe(false);
    expect(canSupportProposal("converted")).toBe(false);
  });
});
