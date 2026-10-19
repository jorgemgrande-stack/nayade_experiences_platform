/**
 * Facturación por líneas: producto de cada línea, reparto exacto de reembolsos parciales y totales (nunca más que
 * una línea, céntimos por resto mayor) y descuadre de partidas entre Stripe y lo contratado.
 */
import { describe, it, expect } from "vitest";
import { allocateRefund, itemsDrift, linesOf, MemoryInvoiceLineStore, type InvoiceLineRow } from "./invoiceLines";

const resolve = async (p: string) => ({ price_plan: { webPriceId: 11, productKey: "essential" }, price_mod: { webPriceId: 21, productKey: "connect-people" }, price_users: { webPriceId: 31, productKey: "addon-user-essential" } })[p] ?? null;
const line = (id: string, amountCents: number, taxCents: number | null = null, refundedCents = 0) => ({ stripeLineId: id, amountCents, taxCents, refundedCents });

describe("líneas de factura", () => {
  it("cada línea con su precio aprobado y producto; periodos en ms; Price desconocido sin producto", async () => {
    const rows = await linesOf("in_1", 7, [
      { id: "il_1", subscriptionItemId: "si_1", priceId: "price_mod", quantity: 1, amount: 950, taxCents: 200, proration: true, periodStart: 100, periodEnd: 200 },
      { id: "il_2", subscriptionItemId: null, priceId: "price_otro", quantity: null, amount: -50, taxCents: null, proration: true, periodStart: null, periodEnd: null },
    ], resolve);
    expect(rows[0]).toEqual({ stripeLineId: "il_1", stripeInvoiceId: "in_1", orderId: 7, subscriptionItemId: "si_1", stripePriceId: "price_mod", webPriceId: 21, productKey: "connect-people", quantity: 1, amountCents: 950, taxCents: 200, proration: true, periodStart: 100_000, periodEnd: 200_000, refundedCents: 0 });
    expect(rows[1]).toMatchObject({ webPriceId: null, productKey: null, amountCents: -50 });
  });

  it("reembolso parcial repartido en proporción y con suma exacta; nunca por encima de una línea", () => {
    const { allocation, unallocated } = allocateRefund([line("a", 2900, 609), line("b", 1900, 399), line("abono", -500)], 1000);
    const sum = Array.from(allocation.values()).reduce((x, y) => x + y, 0);
    expect(sum).toBe(1000);
    expect(unallocated).toBe(0);
    expect(allocation.has("abono")).toBe(false);
    expect(allocation.get("a")).toBe(604);
    expect(allocation.get("b")).toBe(396);
    // Lo ya reembolsado cuenta: el resto va a lo que queda por reembolsar
    const second = allocateRefund([line("a", 2900, 609, 3509), line("b", 1900, 399, 0)], 500);
    expect(Array.from(second.allocation.entries())).toEqual([["b", 500]]);
    // Más de lo cobrado: se asigna hasta el máximo y el resto queda sin asignar (alerta)
    const over = allocateRefund([line("a", 100, 21)], 200);
    expect(over.allocation.get("a")).toBe(121);
    expect(over.unallocated).toBe(79);
    expect(allocateRefund([line("a", 100)], 0).allocation.size).toBe(0);
  });

  it("el almacén no admite reembolsar más que la línea; idempotente por línea de Stripe", async () => {
    const s = new MemoryInvoiceLineStore();
    const r = (await linesOf("in_1", 7, [{ id: "il_1", subscriptionItemId: null, priceId: "price_mod", quantity: 1, amount: 100, taxCents: 21, proration: false, periodStart: null, periodEnd: null }], resolve)) as InvoiceLineRow[];
    expect(await s.upsertLines(r, 1)).toBe(1);
    expect(await s.upsertLines(r, 2)).toBe(0);
    await s.addRefunded(new Map([["il_1", 121]]), 3);
    await expect(s.addRefunded(new Map([["il_1", 1]]), 4)).rejects.toThrow(/encima/);
  });

  it("descuadre de partidas: producto o cantidad distintos y Prices fuera del catálogo", async () => {
    const contracted = new Map([["essential", 1], ["connect-people", 1], ["addon-user-essential", 2]]);
    expect(await itemsDrift([{ id: "si_1", priceId: "price_plan", quantity: 1 }, { id: "si_2", priceId: "price_mod", quantity: 1 }, { id: "si_3", priceId: "price_users", quantity: 2 }], contracted, resolve)).toEqual({ differences: [], unknownPrices: [] });
    expect(await itemsDrift([{ id: "si_1", priceId: "price_plan", quantity: 1 }, { id: "si_3", priceId: "price_users", quantity: 3 }, { id: "si_9", priceId: "price_raro", quantity: 1 }], contracted, resolve)).toEqual({
      differences: [
        { productKey: "addon-user-essential", stripe: 3, contracted: 2 },
        { productKey: "connect-people", stripe: null, contracted: 1 },
      ],
      unknownPrices: ["price_raro"],
    });
  });
});
