/**
 * Petición de fecha de inicio en productos «bajo petición» sin convocatoria (Quantum: Viaje del Alma y Retiro Naturaleza).
 *  - El periodo admitido y la duración son DATOS del producto (migración 0088), no texto editorial ni reglas del código.
 *  - Una fecha pedida es una petición: nunca disponibilidad ni reserva. Sin duración como dato no se calcula ningún fin.
 *  - La solicitud entra en el CRM como oportunidad ligada al producto, con consentimiento RGPD, participantes y opción.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { experiences } from "../drizzle/schema";
import { formatIsoDayShort, parseIsoDay, plannedEndDay, requestedStartProblem } from "../shared/requestDates";

const NOW = Date.UTC(2026, 10, 24, 10, 0, 0); // 24/11/2026
const RULES = { from: null, until: "2027-06-30", durationDays: null };

describe("requestedStartProblem (regla pura)", () => {
  it("acepta una fecha futura dentro del periodo, incluido el último día", () => {
    expect(requestedStartProblem("2026-12-15", RULES, NOW)).toBeNull();
    expect(requestedStartProblem("2027-06-30", RULES, NOW)).toBeNull();
  });
  it("rechaza hoy, el pasado, el día posterior al periodo y fechas inexistentes", () => {
    expect(requestedStartProblem("2026-11-24", RULES, NOW)).toBe("past");
    expect(requestedStartProblem("2026-01-10", RULES, NOW)).toBe("past");
    expect(requestedStartProblem("2027-07-01", RULES, NOW)).toBe("after_window");
    expect(requestedStartProblem("2027-02-30", RULES, NOW)).toBe("invalid");
    expect(requestedStartProblem("15/12/2026", RULES, NOW)).toBe("invalid");
    expect(requestedStartProblem(undefined, RULES, NOW)).toBe("invalid");
  });
  it("respeta el primer día admitido cuando la empresa lo fija", () => {
    const r = { ...RULES, from: "2027-01-10" };
    expect(requestedStartProblem("2027-01-09", r, NOW)).toBe("before_window");
    expect(requestedStartProblem("2027-01-10", r, NOW)).toBeNull();
  });
  it("sin último día fijado el producto NO admite petición de fechas (comportamiento de siempre)", () => {
    expect(requestedStartProblem("2026-12-15", { from: null, until: null, durationDays: null }, NOW)).toBe("not_enabled");
  });
  it("la duración solo cuenta si es un dato entero válido; nunca se lee de un texto", () => {
    expect(plannedEndDay("2026-12-15", null)).toBeNull();
    expect(plannedEndDay("2026-12-15", 0)).toBeNull();
    expect(plannedEndDay("2026-12-15", 6)).toBe("2026-12-20");
    expect(plannedEndDay("2026-12-30", 7)).toBe("2027-01-05");
    expect(parseIsoDay("2027-02-30")).toBeNull();
    expect(formatIsoDayShort("2026-12-05")).toBe("05/12/2026");
  });
});

const state = {
  product: {} as Record<string, unknown> | undefined,
  createdLeads: [] as Array<Record<string, any>>,
  variants: [] as Array<Record<string, unknown>>,
};
const fakeDb = {
  select: () => ({
    from: (t: unknown) => {
      const result = t === experiences ? (state.product ? [state.product] : []) : [];
      const chain: any = { where: () => chain, limit: async () => result, then: (r: any) => r(result) };
      return chain;
    },
  }),
  execute: async () => [[]],
};
vi.mock("./db", () => ({
  getDb: async () => fakeDb,
  createLead: async (data: Record<string, any>) => { state.createdLeads.push(data); return { id: 800 + state.createdLeads.length, success: true }; },
  getVariantsByExperience: async () => state.variants,
}));
vi.mock("./editionsDb", () => ({ getRequestableEdition: async () => null, isMissingEditionsSchema: () => false }));

describe("processProductRequest con fecha de inicio", () => {
  const ctx = { ip: "203.0.113.30", tenantId: "t12", ipSecret: "s".repeat(32), testMode: true, now: () => NOW };
  const base = { experienceId: 26, name: "Persona Prueba", consent: true, elapsedMs: 60_000, lang: "es" };
  let n = 0;
  const email = () => `fecha${++n}@ejemplo.invalid`;
  beforeEach(async () => {
    const { resetProductRequestLimits } = await import("./productRequests");
    resetProductRequestLimits();
    state.createdLeads = [];
    state.product = { id: 26, title: "Seelenreise", isPublished: true, isActive: true, offerMode: "priced_request", basePrice: "1290.00", currency: "EUR", minPersons: 1, maxPersons: 5, durationDays: null, requestDatesFrom: null, requestDatesUntil: "2027-06-30" };
    state.variants = [
      { id: 15, name: "Einzel-Retreat", priceModifier: "1290.00", priceType: "fixed", minQty: 1, maxQty: 1 },
      { id: 16, name: "Ab 2 Teilnehmenden", priceModifier: "1190.00", priceType: "fixed", minQty: 2, maxQty: 5 },
    ];
  });

  it("registra la oportunidad con producto, opción, participantes, fecha deseada y consentimiento; sin fin si no hay duración", async () => {
    const { processProductRequest } = await import("./productRequests");
    const r = await processProductRequest({ ...base, email: email(), variantId: 16, seats: 3, startDate: "2026-12-15" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("info");
    const lead = state.createdLeads[0];
    expect(lead.experienceId).toBe(26);
    expect(lead.variantId).toBe(16);
    expect(lead.numberOfPersons).toBe(3);
    expect(lead.preferredDate).toBe("2026-12-15T00:00:00.000Z");
    expect(lead.message).toContain("Fecha de inicio deseada: 15/12/2026");
    expect(lead.message).toContain("NO es una reserva");
    expect(lead.message).toContain("Consentimiento RGPD");
    expect(lead.message).not.toContain("fin previsto");
    expect(lead.isTest).toBe(true);
  });

  it("con la duración como dato añade solo un fin PREVISTO", async () => {
    state.product = { ...state.product, durationDays: 6 };
    const { processProductRequest } = await import("./productRequests");
    await processProductRequest({ ...base, email: email(), variantId: 15, seats: 1, startDate: "2026-12-15" }, ctx);
    expect(state.createdLeads[0].message).toContain("fin previsto: 20/12/2026");
  });

  it("rechaza fecha pasada, fuera del periodo, inexistente y producto sin calendario", async () => {
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...base, email: email(), startDate: "2026-11-20" }, ctx)).rejects.toThrow(/futura/);
    await expect(processProductRequest({ ...base, email: email(), startDate: "2027-07-01" }, ctx)).rejects.toThrow(/entre el/);
    await expect(processProductRequest({ ...base, email: email(), startDate: "2027-02-30" }, ctx)).rejects.toThrow(/válida/);
    state.product = { ...state.product, requestDatesUntil: null };
    await expect(processProductRequest({ ...base, email: email(), startDate: "2026-12-15" }, ctx)).rejects.toThrow(/no admite peticiones de fecha/);
    expect(state.createdLeads).toHaveLength(0);
  });

  it("aplica los límites de la opción y del producto a los participantes", async () => {
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...base, email: email(), variantId: 15, seats: 2, startDate: "2026-12-15" }, ctx)).rejects.toThrow(/máximo 1/);
    await expect(processProductRequest({ ...base, email: email(), variantId: 16, seats: 1, startDate: "2026-12-15" }, ctx)).rejects.toThrow(/al menos 2/);
    await expect(processProductRequest({ ...base, email: email(), variantId: 16, seats: 6, startDate: "2026-12-15" }, ctx)).rejects.toThrow(/máximo 5/);
    await expect(processProductRequest({ ...base, email: email(), variantId: 999, seats: 2, startDate: "2026-12-15" }, ctx)).rejects.toThrow();
    expect(state.createdLeads).toHaveLength(0);
  });

  it("sin fecha, la solicitud de información sigue como siempre (sin participantes ni fecha)", async () => {
    const { processProductRequest } = await import("./productRequests");
    await processProductRequest({ ...base, email: email() }, ctx);
    const lead = state.createdLeads[0];
    expect(lead.numberOfPersons).toBeUndefined();
    expect(lead.preferredDate).toBeUndefined();
    expect(lead.message).not.toContain("Fecha de inicio deseada");
  });

  it("el consentimiento sigue siendo obligatorio y no se crea nada sin él", async () => {
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...base, email: email(), consent: false, startDate: "2026-12-15" }, ctx)).rejects.toThrow();
    expect(state.createdLeads).toHaveLength(0);
  });
});
