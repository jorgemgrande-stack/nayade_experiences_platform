/**
 * Seguridad de precios en el checkout público (S10):
 *  - el precio de los extras no puede venir del cliente,
 *  - un descuento por id exige conocer el código.
 *
 * BD, Redsys y correo simulados: no hay cobros, ni comunicaciones, ni escritura real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  created: [] as any[],
  discountRows: [] as any[],
}));

vi.mock("./db", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getExperienceById: async (id: number) =>
      id === 1
        ? { id: 1, title: "Actividad de prueba", basePrice: "50.00", pricingType: "per_person", isActive: true }
        : undefined,
    getVariantsByExperience: async () => [],
    createReservation: async (r: any) => {
      state.created.push(r);
      return { id: state.created.length };
    },
    getDb: async () => ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => state.discountRows }),
        }),
      }),
      insert: () => ({ values: async () => ({}) }),
    }),
  };
});

vi.mock("./redsys", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateMerchantOrder: () => "TEST000001",
    // La pasarela se da por configurada: aquí se prueba el cálculo del precio
    isRedsysConfigured: () => true,
    buildRedsysForm: (p: { amount: number }) => ({ url: "https://sandbox.invalid", fields: { amount: p.amount } }),
  };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, socket: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const caller = () => appRouter.createCaller(ctx());

const baseCart = {
  customerName: "Cliente de Prueba",
  customerEmail: "cliente@example.invalid",
  origin: "https://example.invalid",
};
const item = (extras: unknown[] = []) => ({
  productId: 1,
  bookingDate: "2026-12-01",
  people: 2,
  extras: extras as any,
});

beforeEach(() => {
  state.created.length = 0;
  state.discountRows = [];
});

describe("extras: el precio no puede venir del cliente", () => {
  it("createAndPay rechaza extras con precio negativo y no crea reserva", async () => {
    await expect(
      caller().reservations.createAndPay({
        productId: 1,
        bookingDate: "2026-12-01",
        people: 2,
        extras: [{ name: "Descuento falso", price: -90, quantity: 1 }],
        customerName: "Cliente de Prueba",
        customerEmail: "cliente@example.invalid",
        origin: "https://example.invalid",
      }),
    ).rejects.toThrow(/extras no están disponibles/i);
    expect(state.created).toHaveLength(0);
  });

  it("createAndPay rechaza cualquier extra con precio del cliente", async () => {
    await expect(
      caller().reservations.createAndPay({
        productId: 1,
        bookingDate: "2026-12-01",
        people: 1,
        extras: [{ name: "Neopreno", price: 5, quantity: 1 }],
        customerName: "Cliente de Prueba",
        customerEmail: "cliente@example.invalid",
        origin: "https://example.invalid",
      }),
    ).rejects.toThrow(/extras no están disponibles/i);
    expect(state.created).toHaveLength(0);
  });

  it("cartCheckout rechaza extras negativos y no crea reservas", async () => {
    await expect(
      caller().reservations.cartCheckout({
        ...baseCart,
        items: [item([{ name: "x", price: -1000, quantity: 1 }])],
      }),
    ).rejects.toThrow(/extras no están disponibles/i);
    expect(state.created).toHaveLength(0);
  });

  it("cartCheckout con extras vacíos (lo que envía el cliente real) funciona y calcula en servidor", async () => {
    const r = await caller().reservations.cartCheckout({ ...baseCart, items: [item([])] });
    expect(r.merchantOrder).toBe("TEST000001");
    expect(r.totalAmountCents).toBe(50 * 2 * 100);
    expect(state.created).toHaveLength(1);
    expect(state.created[0].extrasJson).toBe("[]");
    expect(state.created[0].amountTotal).toBe(10000);
  });

  it("cartCheckout sin campo extras sigue siendo válido (valor por defecto)", async () => {
    const r = await caller().reservations.cartCheckout({
      ...baseCart,
      items: [{ productId: 1, bookingDate: "2026-12-01", people: 1 } as any],
    });
    expect(r.totalAmountCents).toBe(5000);
  });
});

describe("descuento: el id numérico no basta", () => {
  const row = {
    code: "VERANO10",
    discountType: "percent",
    discountPercent: "10",
    discountAmount: null,
    status: "active",
    expiresAt: null,
    maxUses: null,
    currentUses: 0,
  };

  it("id sin código → rechazado y no se crea ninguna reserva", async () => {
    state.discountRows = [row];
    await expect(
      caller().reservations.cartCheckout({ ...baseCart, items: [item()], discountCodeId: 7 }),
    ).rejects.toThrow(/código de descuento no es válido/i);
    expect(state.created).toHaveLength(0);
  });

  it("id con código que no coincide → rechazado", async () => {
    state.discountRows = [row];
    await expect(
      caller().reservations.cartCheckout({
        ...baseCart,
        items: [item()],
        discountCodeId: 7,
        discountCode: "OTROCODIGO",
      }),
    ).rejects.toThrow(/código de descuento no es válido/i);
    expect(state.created).toHaveLength(0);
  });

  it("id con su código (sin importar mayúsculas ni espacios) → descuento aplicado", async () => {
    state.discountRows = [row];
    const r = await caller().reservations.cartCheckout({
      ...baseCart,
      items: [item()],
      discountCodeId: 7,
      discountCode: "  verano10 ",
    });
    expect(r.totalAmountCents).toBe(10000);
    expect((r.redsysForm as any).fields.amount).toBe(9000);
    expect(state.created).toHaveLength(1);
  });

  it("sin discountCodeId no se exige código (flujo normal)", async () => {
    const r = await caller().reservations.cartCheckout({ ...baseCart, items: [item()] });
    expect((r.redsysForm as any).fields.amount).toBe(10000);
  });

  it("id inexistente → se ignora, como hasta ahora (sin descuento ni error)", async () => {
    state.discountRows = [];
    const r = await caller().reservations.cartCheckout({
      ...baseCart,
      items: [item()],
      discountCodeId: 99999,
      discountCode: "LOQUESEA",
    });
    expect((r.redsysForm as any).fields.amount).toBe(10000);
  });
});
