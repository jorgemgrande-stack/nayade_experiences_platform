/**
 * Cobro online (createAndPay y cartCheckout): una opción con precio 0 no se cobra a 0 € y no crea reservas.
 * Adaptado de Skicenter (86731055). BD, pasarela y correo simulados: no hay cobros ni escritura real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({ created: [] as any[] }));

vi.mock("./db", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getExperienceById: async (id: number) =>
      id === 1 ? { id: 1, title: "Servicio de prueba", basePrice: "50.00", pricingType: "per_person", isActive: true } : undefined,
    // Opción 10: precio fijo sin configurar (0); opción 11: precio fijo 30
    getVariantsByExperience: async () => [
      { id: 10, priceType: "fixed", priceModifier: "0" },
      { id: 11, priceType: "fixed", priceModifier: "30" },
    ],
    createReservation: async (r: any) => {
      state.created.push(r);
      return { id: state.created.length };
    },
    getDb: async () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: async () => ({}) }),
    }),
  };
});

vi.mock("./redsys", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateMerchantOrder: () => "TEST000002",
    isRedsysConfigured: () => true,
    buildRedsysForm: (p: { amount: number }) => ({ url: "https://sandbox.invalid", fields: { amount: p.amount } }),
  };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const caller = () =>
  appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: {}, socket: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  });
const customer = { customerName: "Cliente de Prueba", customerEmail: "cliente@example.invalid", origin: "https://example.invalid" };
const line = (variantId?: number) => ({ productId: 1, bookingDate: "2026-12-01", people: 2, extras: [] as any, variantId });

beforeEach(() => {
  state.created.length = 0;
});

describe("cobro online sin líneas a 0 €", () => {
  it("cartCheckout: una línea a 0 € junto a otra con precio bloquea todo el carrito y no crea reservas", async () => {
    await expect(caller().reservations.cartCheckout({ ...customer, items: [line(11), line(10)] })).rejects.toThrow(/no se ha realizado ningún cobro/);
    expect(state.created).toHaveLength(0);
  });

  it("createAndPay: una opción con precio 0 se bloquea", async () => {
    await expect(caller().reservations.createAndPay({ ...customer, ...line(10) })).rejects.toThrow(/«Servicio de prueba»/);
    expect(state.created).toHaveLength(0);
  });

  it("con precio se cobra como siempre", async () => {
    const r = await caller().reservations.cartCheckout({ ...customer, items: [line(11), line()] });
    expect(r.totalAmountCents).toBe(30 * 2 * 100 + 50 * 2 * 100);
    expect(state.created).toHaveLength(2);
  });
});
