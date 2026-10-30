/**
 * Estado REAL de los circuitos comerciales, para el CRM y las operaciones (sin secretos):
 *
 *  - Stripe es UNA configuración compartida por dos circuitos:
 *      1. servicios externos (contratos de clientes externos): en live, los cobros reales tienen su propio interruptor;
 *      2. licencias y módulos SaaS (checkout del catálogo): en live exige la política fiscal; sin ella está bloqueado.
 *  - Alta comercial: registro público de pruebas y aprovisionamiento automático.
 *
 * Los interruptores los lee el arranque del plano de control (main.ts) y llegan ya resueltos: este módulo no los lee
 * ni los cambia. Solo informa: cada circuito dice si está activo, en qué modo y qué le falta.
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

export interface CircuitSwitches {
  /** Cobros reales de servicios externos habilitados (interruptor protegido). */
  externalLiveCharges: boolean;
  /** Pruebas gratuitas montadas (migraciones y base de pruebas). */
  trialsReady: boolean;
  publicTrial: boolean;
  autoProvision: boolean;
}

export function commerceCircuits(o: { stripe: StripeConfig | null; switches: CircuitSwitches; mailMode: string }): CommerceCircuits {
  const s = o.switches;
  const mode = o.stripe ? o.stripe.mode : "off";
  const noStripe = o.stripe ? [] : ["Stripe sin configurar"];

  const externalServices: CircuitState = {
    active: !!o.stripe && (mode === "test" || s.externalLiveCharges),
    mode,
    missing: [...noStripe, ...(mode === "live" && !s.externalLiveCharges ? ["Cobros reales de servicios externos sin habilitar"] : [])],
  };

  const blocked = o.stripe ? checkoutBlockedReason(o.stripe) : null;
  const saasCheckout: CircuitState = {
    active: !!o.stripe && !blocked,
    mode,
    missing: [...noStripe, ...(blocked === "tax_policy_pending" ? ["Política fiscal de Stripe live sin definir"] : [])],
  };

  const trialMissing = s.trialsReady ? [] : ["Pruebas gratuitas sin montar (migraciones del registro o base de pruebas)"];
  const flag = (on: boolean, off: string): CircuitState => ({ active: s.trialsReady && on, mode: s.trialsReady && on ? "live" : "off", missing: [...trialMissing, ...(on ? [] : [off])] });

  return {
    stripe: describeStripeConfig(o.stripe),
    externalServices,
    saasCheckout,
    publicTrial: flag(s.publicTrial, "Registro público de pruebas apagado"),
    autoProvision: flag(s.autoProvision, "Aprovisionamiento automático apagado"),
    mail: { mode: o.mailMode },
  };
}
