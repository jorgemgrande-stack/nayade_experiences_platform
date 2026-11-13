/**
 * Compra en línea de ampliaciones (13/11/2026): una suscripción con condiciones comerciales personalizadas se cambia
 * desde su acuerdo. La compra en línea se rechaza antes de tocar Stripe (si no, se cobraría y el alta interna fallaría
 * por assertNoTerms); la ampliación va por «Contratar e iniciar implantación».
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SubscriptionService } from "./subscriptions/service";

describe("compra en línea con condiciones personalizadas", () => {
  it("hasCustomTerms: partidas de un acuerdo vigentes o programadas → sí; sin acuerdo o ya cerradas → no", async () => {
    const NOW = Date.UTC(2026, 10, 13, 12);
    const rows: Record<number, Array<Record<string, unknown>>> = {
      1: [{ termsId: 7, priceKind: "monthly", effectiveFrom: NOW - 1, effectiveTo: null }],
      2: [{ termsId: null, priceKind: "monthly", effectiveFrom: NOW - 1, effectiveTo: null }],
      3: [{ termsId: 7, priceKind: "monthly", effectiveFrom: NOW - 10, effectiveTo: NOW - 5 }],
      4: [{ termsId: 7, priceKind: "monthly", effectiveFrom: NOW + 10, effectiveTo: null }],
    };
    const svc = new SubscriptionService({ store: { items: async (id: number) => rows[id] ?? [] } as never, catalog: (async () => ({ products: [] })) as never, crm: {} as never, now: () => NOW });
    expect(await svc.hasCustomTerms(1)).toBe(true);
    expect(await svc.hasCustomTerms(2)).toBe(false);
    expect(await svc.hasCustomTerms(3)).toBe(false);
    expect(await svc.hasCustomTerms(4)).toBe(true);
  });

  it("la compra comprueba las condiciones antes de llamar a Stripe para cobrar", () => {
    const src = fs.readFileSync(new URL("./stripe/purchases.ts", import.meta.url), "utf8");
    const ctx = src.slice(src.indexOf("private async context("), src.indexOf("private async plan("));
    expect(ctx).toContain("await this.d.subscriptions.hasCustomTerms?.(current.subscriptionId)");
    expect(ctx).toContain("los cambios se gestionan con tu gestor");
  });
});
