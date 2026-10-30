/**
 * Estado de los circuitos comerciales (server/controlPlane/commerceCircuits.ts): Stripe compartido por servicios
 * externos y licencias SaaS, cada uno con su interruptor; pruebas y aprovisionamiento. Sin secretos.
 */
import { describe, it, expect } from "vitest";
import { commerceCircuits, type CircuitSwitches } from "./controlPlane/commerceCircuits";
import type { StripeConfig } from "./stripe/config";

const KEY = "ci-only-placeholder-not-a-secret-1";
const live = { mode: "live", apiKey: KEY, webhookSecret: KEY, keyKind: "secret", apiVersion: "x", namespace: "live", eventsRetentionDays: 180, taxPolicy: undefined } as unknown as StripeConfig;
const off: CircuitSwitches = { externalLiveCharges: false, trialsReady: true, publicTrial: false, autoProvision: false };

describe("circuitos comerciales", () => {
  it("Stripe live: servicios externos solo con su interruptor; SaaS bloqueado sin política fiscal", () => {
    const c = commerceCircuits({ stripe: live, switches: off, mailMode: "live" });
    expect(c.externalServices).toMatchObject({ active: false, mode: "live" });
    expect(c.externalServices.missing.join(" ")).toMatch(/servicios externos sin habilitar/);
    expect(c.saasCheckout).toMatchObject({ active: false, mode: "live" });
    expect(c.saasCheckout.missing.join(" ")).toMatch(/Política fiscal/);
    const on = commerceCircuits({ stripe: { ...live, taxPolicy: "stripe_tax_exclusive" } as StripeConfig, switches: { ...off, externalLiveCharges: true }, mailMode: "live" });
    expect(on.externalServices).toMatchObject({ active: true, missing: [] });
    expect(on.saasCheckout).toMatchObject({ active: true, missing: [] });
    expect(JSON.stringify(on)).not.toContain(KEY);
  });

  it("alta comercial: registro público y aprovisionamiento con sus interruptores; sin Stripe, todo apagado", () => {
    const c = commerceCircuits({ stripe: null, switches: { ...off, publicTrial: true }, mailMode: "sandbox" });
    expect(c.publicTrial).toMatchObject({ active: true, mode: "live" });
    expect(c.autoProvision).toMatchObject({ active: false, mode: "off" });
    expect(c.saasCheckout).toMatchObject({ active: false, mode: "off" });
    expect(c.stripe).toEqual({ enabled: false });
    expect(commerceCircuits({ stripe: null, switches: { ...off, publicTrial: true, trialsReady: false }, mailMode: "off" }).publicTrial.active).toBe(false);
  });
  it("recorrido de venta: con la configuración de production de hoy no se puede vender y se dice qué falta; con todo encendido, sí", () => {
    const today = commerceCircuits({ stripe: live, switches: { ...off, termsPublished: false, checkoutMounted: false, trialScheduler: false, lifecycle: { enabled: false, mode: "plan" }, notificationsDispatch: false, railwayDomains: false }, mailMode: "live" });
    expect(today.readyToSell.ready).toBe(false);
    const missing = today.readyToSell.missing.join(" | ");
    for (const m of [/Registro público/, /Aprovisionamiento automático/, /CP_TRIALS_SCHEDULER_ENABLED/, /Política fiscal/, /CP_TERMS_VERSION/, /CP_PANEL_CONVERSION_ENABLED/, /CP_LIFECYCLE_MODE=apply/, /Despachador/]) expect(missing).toMatch(m);
    // El dominio propio sin la integración funciona (alta manual): no impide vender
    expect(today.customDomains).toMatchObject({ active: true, mode: "off" });
    expect(missing).not.toMatch(/CP_RAILWAY_DOMAIN_TOKEN/);
    const all = commerceCircuits({
      stripe: { ...live, taxPolicy: "stripe_tax_exclusive" } as StripeConfig,
      switches: { externalLiveCharges: false, trialsReady: true, publicTrial: true, autoProvision: true, panelConversion: true, termsPublished: true, checkoutMounted: true, trialScheduler: true, lifecycle: { enabled: true, mode: "apply" }, notificationsDispatch: true, railwayDomains: true },
      mailMode: "live",
    });
    expect(all.readyToSell).toEqual({ ready: true, missing: [] });
    expect(all.panelConversion).toMatchObject({ active: true, mode: "live" });
    expect(all.dunning.active && all.notifications.active && all.trialScheduler.active && all.customDomains.mode === "live").toBe(true);
    // Los servicios externos no forman parte del recorrido SaaS
    expect(all.externalServices.active).toBe(false);
  });
});
