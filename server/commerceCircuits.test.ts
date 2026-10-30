/**
 * Estado de los circuitos comerciales (server/controlPlane/commerceCircuits.ts): Stripe compartido por servicios
 * externos y licencias SaaS, cada uno con su interruptor; pruebas y aprovisionamiento. Sin secretos.
 */
import { describe, it, expect } from "vitest";
import { commerceCircuits } from "./controlPlane/commerceCircuits";
import type { StripeConfig } from "./stripe/config";

const KEY = "ci-only-placeholder-not-a-secret-1";
const live = { mode: "live", apiKey: KEY, webhookSecret: KEY, keyKind: "secret", apiVersion: "x", namespace: "live", eventsRetentionDays: 180, taxPolicy: undefined } as unknown as StripeConfig;

describe("circuitos comerciales", () => {
  it("Stripe live: servicios externos solo con su interruptor; SaaS bloqueado sin política fiscal", () => {
    const c = commerceCircuits({ stripe: live, env: {}, trialsReady: true, mailMode: "live" });
    expect(c.externalServices).toMatchObject({ active: false, mode: "live" });
    expect(c.externalServices.missing.join(" ")).toMatch(/CP_EXTERNAL_LIVE_ENABLED/);
    expect(c.saasCheckout).toMatchObject({ active: false, mode: "live" });
    expect(c.saasCheckout.missing.join(" ")).toMatch(/CP_STRIPE_TAX_POLICY/);
    const on = commerceCircuits({ stripe: { ...live, taxPolicy: "stripe_tax_exclusive" } as StripeConfig, env: { CP_EXTERNAL_LIVE_ENABLED: "1" }, trialsReady: true, mailMode: "live" });
    expect(on.externalServices).toMatchObject({ active: true, missing: [] });
    expect(on.saasCheckout).toMatchObject({ active: true, missing: [] });
    expect(JSON.stringify(on)).not.toContain(KEY);
  });

  it("alta comercial: registro público y aprovisionamiento con sus interruptores; sin Stripe, todo apagado", () => {
    const c = commerceCircuits({ stripe: null, env: { CP_PUBLIC_TRIAL_ENABLED: "1" }, trialsReady: true, mailMode: "sandbox" });
    expect(c.publicTrial).toMatchObject({ active: true, mode: "live" });
    expect(c.autoProvision).toMatchObject({ active: false, mode: "off" });
    expect(c.saasCheckout).toMatchObject({ active: false, mode: "off" });
    expect(c.stripe).toEqual({ enabled: false });
    expect(commerceCircuits({ stripe: null, env: { CP_PUBLIC_TRIAL_ENABLED: "1" }, trialsReady: false, mailMode: "off" }).publicTrial.active).toBe(false);
  });
});
