/**
 * Suplementos opcionales: reglas puras (tramo individual / desde 2, por persona o fijo, nunca por defecto) y la solicitud
 * de un producto «solo por solicitud» (el suplemento llega al lead, sin cobro y sin mezclarse con el precio del programa).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { experiences } from "../drizzle/schema";
import { isSupplementVariant, resolveSupplements, supplementLineText, supplementOffers, supplementsTotalCents, SupplementError } from "./supplements";
import { checkoutFingerprint } from "./shopCheckoutRules";

const IND = { id: 31, name: "Alimentación ayurvédica", priceModifier: "120.00", priceType: "per_person", minQty: 1, maxQty: 1, supplementGroup: "alim" };
const GRP = { id: 32, name: "Alimentación ayurvédica (desde 2)", priceModifier: "90.00", priceType: "per_person", minQty: 2, maxQty: 5, supplementGroup: "alim" };
const PROG = { id: 15, name: "Individual", priceModifier: "1290.00", priceType: "fixed", minQty: 1, maxQty: 1, supplementGroup: null };
const ALL = [PROG, IND, GRP];

describe("resolveSupplements (regla pura)", () => {
  it("no marcado = sin suplemento: total intacto", () => {
    expect(resolveSupplements(undefined, ALL, 2)).toEqual([]);
    expect(resolveSupplements([], ALL, 2)).toEqual([]);
    expect(supplementsTotalCents(resolveSupplements([], ALL, 2))).toBe(0);
  });
  it("una opción del programa NO es un suplemento", () => {
    expect(isSupplementVariant(PROG)).toBe(false);
    expect(() => resolveSupplements([PROG.id], ALL, 1)).toThrow(SupplementError);
  });
  it("participante único: 120 € por persona, aunque envíe el id del tramo de grupo", () => {
    for (const id of [IND.id, GRP.id]) {
      const [l] = resolveSupplements([id], ALL, 1);
      expect(l).toMatchObject({ variantId: 31, unitCents: 12000, quantity: 1, totalCents: 12000 });
    }
  });
  it("desde 2 participantes: 90 € por persona, aunque envíe el id del tramo individual", () => {
    for (const id of [IND.id, GRP.id]) {
      const [l] = resolveSupplements([id], ALL, 2);
      expect(l).toMatchObject({ variantId: 32, unitCents: 9000, quantity: 2, totalCents: 18000 });
    }
    expect(resolveSupplements([IND.id], ALL, 5)[0].totalCents).toBe(45000);
  });
  it("respeta maxQty: 6 participantes no tienen tramo y se rechaza", () => {
    expect(() => resolveSupplements([GRP.id], ALL, 6)).toThrow(/no está disponible para 6 participantes/);
  });
  it("dos ids del mismo grupo cuentan una sola vez; un id ajeno o inexistente se rechaza", () => {
    expect(resolveSupplements([IND.id, GRP.id], ALL, 2)).toHaveLength(1);
    expect(() => resolveSupplements([999], ALL, 2)).toThrow(/ya no está disponible/);
    expect(() => resolveSupplements([IND.id], [PROG], 2)).toThrow(SupplementError);
  });
  it("importe fijo: una vez por pedido; porcentaje o importe vacío: rechazado", () => {
    const fijo = { id: 40, name: "Traslado", priceModifier: "30", priceType: "fixed", supplementGroup: "tras" };
    expect(resolveSupplements([40], [fijo], 4)[0]).toMatchObject({ quantity: 1, totalCents: 3000, perPerson: false });
    expect(() => resolveSupplements([41], [{ ...fijo, id: 41, priceType: "percentage" }], 2)).toThrow(/importe válido/);
    expect(() => resolveSupplements([42], [{ ...fijo, id: 42, priceModifier: "0" }], 2)).toThrow(/importe válido/);
  });
  it("texto para el mensaje y ofertas para la ficha (tramos ordenados, sin suplementos sin importe)", () => {
    expect(supplementLineText(resolveSupplements([GRP.id], ALL, 2)[0])).toBe("Alimentación ayurvédica (desde 2): 90,00 € por persona × 2 = 180,00 €");
    const o = supplementOffers([...ALL, { id: 50, name: "Roto", priceModifier: "0", priceType: "per_person", supplementGroup: "roto" }]);
    expect(o).toHaveLength(1);
    expect(o[0].tiers.map((t) => t.id)).toEqual([31, 32]);
  });
  it("la huella del pedido solo cambia cuando hay suplemento (los pedidos de siempre mantienen su huella)", () => {
    const base = { email: "a@b.example", finalCents: 1000, items: [{ productId: 1, bookingDate: "", people: 2 }] };
    const sin = checkoutFingerprint(base);
    expect(checkoutFingerprint({ ...base, items: [{ ...base.items[0], supplementIds: [] }] })).toBe(sin);
    expect(checkoutFingerprint({ ...base, items: [{ ...base.items[0], supplementIds: [31] }] })).not.toBe(sin);
  });
});

const NOW = Date.UTC(2026, 10, 24, 10, 0, 0);
const state = { product: {} as Record<string, unknown> | undefined, createdLeads: [] as Array<Record<string, any>>, variants: [] as Array<Record<string, unknown>> };
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
  createLead: async (data: Record<string, any>) => { state.createdLeads.push(data); return { id: 900 + state.createdLeads.length, success: true }; },
  getVariantsByExperience: async () => state.variants,
}));
vi.mock("./editionsDb", () => ({ getRequestableEdition: async () => null, isMissingEditionsSchema: () => false }));

describe("processProductRequest con suplementos", () => {
  const ctx = { ip: "203.0.113.50", tenantId: "t77", ipSecret: "s".repeat(32), testMode: true, now: () => NOW };
  const base = { experienceId: 26, name: "Persona Prueba", consent: true, elapsedMs: 60_000, lang: "es" };
  let n = 0;
  const email = () => `sup${++n}@ejemplo.invalid`;
  beforeEach(async () => {
    const { resetProductRequestLimits } = await import("./productRequests");
    resetProductRequestLimits();
    state.createdLeads = [];
    state.product = { id: 26, title: "Viaje del Alma", isPublished: true, isActive: true, offerMode: "priced_request", basePrice: "1290.00", currency: "EUR", minPersons: 1, maxPersons: 5, durationDays: null, requestDatesFrom: null, requestDatesUntil: null };
    state.variants = [PROG, IND, GRP];
  });

  it("sin marcar: el lead es el de siempre, sin suplemento", async () => {
    const { processProductRequest } = await import("./productRequests");
    await processProductRequest({ ...base, email: email(), variantId: 15, seats: 1 }, ctx);
    const lead = state.createdLeads[0];
    expect(lead.message).not.toContain("Suplementos");
    expect(lead.message).toContain("Modalidad elegida: Individual · precio publicado: 1290,00 €");
    expect(lead.numberOfPersons).toBeUndefined();
  });

  it("marcado: el suplemento llega al lead con tramo e importe del servidor, separado del precio del programa y sin cobro", async () => {
    const { processProductRequest } = await import("./productRequests");
    const r = await processProductRequest({ ...base, email: email(), seats: 3, supplementIds: [IND.id], ...({ supplementPrice: 1, total: 1 } as any) }, ctx);
    expect(r.ok).toBe(true);
    const lead = state.createdLeads[0];
    expect(lead.message).toContain("Suplementos opcionales elegidos (NO incluidos en el precio del programa; sin cobro");
    expect(lead.message).toContain("Alimentación ayurvédica (desde 2): 90,00 € por persona × 3 = 270,00 €");
    expect(lead.message).toContain("Precio publicado (producto): 1290,00 €");
    expect(lead.numberOfPersons).toBe(3);
    expect(lead.shownPrice).toBe("1290.00"); // el precio mostrado sigue siendo el del programa
    expect(lead.variantId).toBeUndefined(); // el suplemento no es la modalidad del lead
  });

  it("participante único no obtiene la tarifa de grupo; un suplemento no vale como modalidad; ids ajenos se rechazan", async () => {
    const { processProductRequest } = await import("./productRequests");
    await processProductRequest({ ...base, email: email(), seats: 1, supplementIds: [GRP.id] }, ctx);
    expect(state.createdLeads[0].message).toContain("120,00 € por persona × 1 = 120,00 €");
    expect(state.createdLeads[0].message).not.toContain(" 90,00 € por persona");
    await processProductRequest({ ...base, email: email(), seats: 2, variantId: IND.id }, ctx);
    expect(state.createdLeads[1].variantId).toBeUndefined();
    await expect(processProductRequest({ ...base, email: email(), seats: 2, supplementIds: [4242] }, ctx)).rejects.toThrow(/ya no está disponible/);
    await expect(processProductRequest({ ...base, email: email(), seats: 6, supplementIds: [IND.id] }, ctx)).rejects.toThrow(/6 participantes/);
    expect(state.createdLeads).toHaveLength(2);
  });

  it("un producto sin precio visible no admite suplementos", async () => {
    state.product = { ...state.product, offerMode: "on_request" };
    const { processProductRequest } = await import("./productRequests");
    await expect(processProductRequest({ ...base, email: email(), seats: 2, supplementIds: [IND.id] }, ctx)).rejects.toThrow(/suplementos/);
  });
});
