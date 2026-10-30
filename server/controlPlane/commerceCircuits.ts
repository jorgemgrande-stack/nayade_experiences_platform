/**
 * Estado REAL de los circuitos comerciales, leído de la configuración (sin secretos) para el CRM y las operaciones:
 *
 *  - Stripe es UNA configuración (`CP_STRIPE_MODE`) compartida por dos circuitos:
 *      1. servicios externos (contratos de clientes externos): cobros reales solo con `CP_EXTERNAL_LIVE_ENABLED=1`;
 *      2. licencias y módulos SaaS (checkout del catálogo): en live exige la política fiscal (`CP_STRIPE_TAX_POLICY`);
 *         sin ella el checkout está bloqueado (`tax_policy_pending`).
 *  - Alta comercial: registro público de pruebas (`CP_PUBLIC_TRIAL_ENABLED`) y aprovisionamiento automático
 *    (`CP_TRIAL_AUTO_PROVISION`).
 *
 * Solo informa: no activa nada. Cada circuito dice si está activo, en qué modo y qué le falta.
 */
import { checkoutBlockedReason, describeStripeConfig, type StripeConfig } from "../stripe/config";

export interface CircuitState {
  active: boolean;
  mode: "live" | "test" | "off";
  /** Qué falta para activarlo (vacío si está activo). */
  missing: string[];
}

export interface CommerceCircuits {
  stripe: Record<string, unknown>;
  externalServices: CircuitState;
  saasCheckout: CircuitState;
  publicTrial: CircuitState;
  autoProvision: CircuitState;
  mail: { mode: string };
}

export function commerceCircuits(o: { stripe: StripeConfig | null; env: Record<string, string | undefined>; trialsReady: boolean; mailMode: string }): CommerceCircuits {
  const mode = o.stripe ? o.stripe.mode : "off";
  const noStripe = o.stripe ? [] : ["Stripe sin configurar (CP_STRIPE_MODE, CP_STRIPE_API_KEY, CP_STRIPE_WEBHOOK_SECRET)"];

  const extLive = o.env.CP_EXTERNAL_LIVE_ENABLED === "1";
  const externalServices: CircuitState = {
    active: !!o.stripe && (mode === "test" || extLive),
    mode,
    missing: [...noStripe, ...(mode === "live" && !extLive ? ["Cobros reales de servicios externos sin habilitar (CP_EXTERNAL_LIVE_ENABLED=1)"] : [])],
  };

  const blocked = o.stripe ? checkoutBlockedReason(o.stripe) : null;
  const saasCheckout: CircuitState = {
    active: !!o.stripe && !blocked,
    mode,
    missing: [...noStripe, ...(blocked === "tax_policy_pending" ? ["Política fiscal de Stripe live sin definir (CP_STRIPE_TAX_POLICY)"] : [])],
  };

  const trialMissing = o.trialsReady ? [] : ["Pruebas gratuitas sin montar (migraciones del registro o base de pruebas)"];
  const publicTrial: CircuitState = {
    active: o.trialsReady && o.env.CP_PUBLIC_TRIAL_ENABLED === "1",
    mode: o.trialsReady && o.env.CP_PUBLIC_TRIAL_ENABLED === "1" ? "live" : "off",
    missing: [...trialMissing, ...(o.env.CP_PUBLIC_TRIAL_ENABLED === "1" ? [] : ["Registro público de pruebas apagado (CP_PUBLIC_TRIAL_ENABLED=1)"])],
  };
  const autoProvision: CircuitState = {
    active: o.trialsReady && o.env.CP_TRIAL_AUTO_PROVISION === "1",
    mode: o.trialsReady && o.env.CP_TRIAL_AUTO_PROVISION === "1" ? "live" : "off",
    missing: [...trialMissing, ...(o.env.CP_TRIAL_AUTO_PROVISION === "1" ? [] : ["Aprovisionamiento automático apagado (CP_TRIAL_AUTO_PROVISION=1)"])],
  };

  return { stripe: describeStripeConfig(o.stripe), externalServices, saasCheckout, publicTrial, autoProvision, mail: { mode: o.mailMode } };
}
