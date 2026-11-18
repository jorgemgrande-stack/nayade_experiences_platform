/**
 * Integridad de las solicitudes de plaza: el servidor decide si un producto admite solicitudes con los datos de
 * la base, nunca con lo que mande el navegador. Un producto de precio fijo desactivado (sin contratación) no
 * acepta plaza ni información aunque se conozca el id de su convocatoria; los productos por solicitud siguen igual.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { experiences } from "../drizzle/schema";
import { isPubliclyRequestable } from "../shared/offerMode";

describe("isPubliclyRequestable (regla compartida)", () => {
  const base = { isPublished: true, isActive: true };
  it("precio fijo: solo activo y publicado", () => {
    expect(isPubliclyRequestable({ ...base, offerMode: "fixed" })).toBe(true);
    expect(isPubliclyRequestable({ ...base, isActive: false, offerMode: "fixed" })).toBe(false);
    expect(isPubliclyRequestable({ ...base, isPublished: false, offerMode: "fixed" })).toBe(false);
  });
  it("modo desconocido o ausente = precio fijo (nunca se abre por error)", () => {
    expect(isPubliclyRequestable({ ...base, isActive: false })).toBe(false);
    expect(isPubliclyRequestable({ ...base, isActive: false, offerMode: "otro" })).toBe(false);
    expect(isPubliclyRequestable({ ...base, isActive: false, offerMode: null })).toBe(false);
  });
  it("por solicitud: basta con estar publicado, esté o no activo", () => {
    for (const offerMode of ["on_request", "priced_request", "coming_soon"]) {
      expect(isPubliclyRequestable({ isPublished: true, isActive: false, offerMode })).toBe(true);
      expect(isPubliclyRequestable({ isPublished: true, isActive: true, offerMode })).toBe(true);
      expect(isPubliclyRequestable({ isPublished: false, isActive: true, offerMode })).toBe(false);
    }
  });
  it("sin producto: no", () => {
    expect(isPubliclyRequestable(null)).toBe(false);
    expect(isPubliclyRequestable(undefined)).toBe(false);
  });
});

const state = {
  product: {} as Record<string, unknown> | undefined,
  edition: null as null | Record<string, unknown>,
  editionLookups: [] as Array<[number, number]>,
  createdLeads: [] as unknown[],
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
  createLead: async (data: unknown) => { state.createdLeads.push(data); return { id: 700 + state.createdLeads.length, success: true }; },
  getVariantsByExperience: async () => [],
}));
vi.mock("./editionsDb", () => ({
  getRequestableEdition: async (editionId: number, experienceId: number) => { state.editionLookups.push([editionId, experienceId]); return state.edition; },
  isMissingEditionsSchema: () => false,
}));

describe("processProductRequest: contratación desactivada", () => {
  const ctx = { ip: "203.0.113.20", tenantId: "t9", ipSecret: "s".repeat(32), testMode: true };
  const req = { experienceId: 30, name: "Persona Prueba", consent: true, elapsedMs: 60_000, lang: "es" };
  const openEdition = { edition: { id: 9, label: "Otoño", startsAt: Date.UTC(2037, 9, 1, 9), endsAt: null, timezone: "Europe/Madrid" }, state: "open", initialStatus: "solicitada" };
  let n = 0;
  beforeEach(async () => {
    const { resetProductRequestLimits } = await import("./productRequests");
    resetProductRequestLimits();
    state.product = { id: 30, title: "Curso de precio fijo", isPublished: true, isActive: false, offerMode: "fixed", basePrice: "300.00", currency: "EUR" };
    state.edition = openEdition;
    state.editionLookups = [];
    state.createdLeads = [];
  });

  it("precio fijo desactivado + editionId directo: rechazado sin crear lead ni consultar la convocatoria", async () => {
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...req, editionId: 9, email: `x${++n}@ejemplo.example` }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.createdLeads).toHaveLength(0);
    expect(state.editionLookups).toHaveLength(0);
  });

  it("precio fijo desactivado sin convocatoria (información): también rechazado", async () => {
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...req, email: `x${++n}@ejemplo.example` }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.createdLeads).toHaveLength(0);
  });

  it("modo desconocido o ausente en un producto desactivado se trata como precio fijo", async () => {
    const { processProductRequest } = await import("./productRequests");
    for (const offerMode of [null, undefined, "raro"]) {
      state.product = { ...state.product, offerMode };
      await expect(processProductRequest({ ...req, editionId: 9, email: `x${++n}@ejemplo.example` }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(state.createdLeads).toHaveLength(0);
  });

  it("producto no publicado o inexistente: rechazado", async () => {
    const { processProductRequest } = await import("./productRequests");
    state.product = { ...state.product, isActive: true, isPublished: false };
    await expect(processProductRequest({ ...req, editionId: 9, email: `x${++n}@ejemplo.example` }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.product = undefined;
    await expect(processProductRequest({ ...req, editionId: 9, email: `x${++n}@ejemplo.example` }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.createdLeads).toHaveLength(0);
  });

  it("precio fijo activo: la solicitud legítima sigue entrando", async () => {
    state.product = { ...state.product, isActive: true };
    const { processProductRequest } = await import("./productRequests");
    const r = await processProductRequest({ ...req, editionId: 9, email: `x${++n}@ejemplo.example` }, ctx);
    expect(r).toMatchObject({ ok: true, kind: "enrollment" });
    expect(state.createdLeads).toHaveLength(1);
    expect(state.editionLookups).toEqual([[9, 30]]);
  });

  it("producto por solicitud desactivado: sigue admitiendo plaza e información", async () => {
    const { processProductRequest, resetProductRequestLimits } = await import("./productRequests");
    for (const offerMode of ["on_request", "priced_request", "coming_soon"]) {
      resetProductRequestLimits();
      state.product = { ...state.product, isActive: false, offerMode };
      const plaza = await processProductRequest({ ...req, editionId: 9, email: `p${++n}@ejemplo.example` }, ctx);
      expect(plaza).toMatchObject({ ok: true, kind: "enrollment" });
      resetProductRequestLimits();
      const info = await processProductRequest({ ...req, email: `i${++n}@ejemplo.example` }, ctx);
      expect(info).toMatchObject({ ok: true, kind: "info" });
    }
  });

  it("la convocatoria de otro producto no sirve: se busca siempre con el producto de la solicitud", async () => {
    state.product = { ...state.product, isActive: true };
    state.edition = null;
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...req, editionId: 99, email: `x${++n}@ejemplo.example` }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.editionLookups).toEqual([[99, 30]]);
    expect(state.createdLeads).toHaveLength(0);
  });
});
