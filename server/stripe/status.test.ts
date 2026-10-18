/** Estado público del alta: la relectura en Stripe se limita por sesión (una cada 30 s). */
import { describe, it, expect } from "vitest";
import type { CommercialOrder } from "../orchestrator/types";
import { RECHECK_EVERY_MS, SESSION_ID_RE, checkoutStatus, sessionIdRe } from "./status";
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

  it("ids de sesión según el modo: cs_test_ en pruebas y cs_live_ en live, nunca el del otro", async () => {
    const LIVE = "cs_live_abcdefgh12345678";
    expect(sessionIdRe()).toBe(SESSION_ID_RE);
    expect([sessionIdRe("test").test(SID), sessionIdRe("test").test(LIVE), sessionIdRe("live").test(LIVE), sessionIdRe("live").test(SID)]).toEqual([true, false, true, false]);
    let reads = 0;
    const deps = (mode?: "test" | "live") => ({
      store: { session: async (id: string) => (reads++, { ...row, stripeSessionId: id }) },
      orders: { get: async () => ({ id: 9, state: "contracted" }) as unknown as CommercialOrder },
      platformDomain: null,
      mode,
    });
    expect(await checkoutStatus(deps("live"), SID)).toBeNull();
    expect(await checkoutStatus(deps(), LIVE)).toBeNull();
    expect(reads).toBe(0);
    expect(await checkoutStatus(deps("live"), LIVE)).toMatchObject({ state: "pending_payment" });
  });
});
