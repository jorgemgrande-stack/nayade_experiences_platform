/** Estado público del alta: la relectura en Stripe se limita por sesión (una cada 30 s). */
import { describe, it, expect } from "vitest";
import type { CommercialOrder } from "../orchestrator/types";
import { RECHECK_EVERY_MS, checkoutStatus } from "./status";
import type { StripeSessionRow } from "./store";

const SID = "cs_test_abcdefgh12345678";
const row: StripeSessionRow = { orderId: 9, stripeSessionId: SID, idempotencyKey: "k", priceIds: [], status: "open", paymentStatus: null, expiresAt: 0, createdAt: 0, completedAt: null };

describe("estado público del alta", () => {
  it("varios sondeos seguidos: una sola relectura en Stripe cada 30 s por sesión", async () => {
    let now = 1_800_000_000_000;
    let calls = 0;
    const deps = {
      store: { session: async () => row },
      orders: { get: async () => ({ id: 9, state: "contracted" }) as unknown as CommercialOrder },
      processor: { process: async () => (calls++, { outcome: "processed" as const, detail: null }) },
      platformDomain: null,
      rechecks: new Map<string, number>(),
      now: () => now,
    };
    for (let i = 0; i < 5; i++) expect(await checkoutStatus(deps, SID)).toMatchObject({ state: "pending_payment" });
    expect(calls).toBe(1);
    now += RECHECK_EVERY_MS;
    await checkoutStatus(deps, SID);
    expect(calls).toBe(2);
  });
});
