/**
 * Estado REAL de los circuitos comerciales, para el CRM y las operaciones (sin secretos):
 *
 *  - Stripe es UNA configuración compartida por dos circuitos:
 *      1. servicios externos (contratos de clientes externos): en live, los cobros reales tienen su propio interruptor;
 *      2. licencias y módulos SaaS (checkout del catálogo): en live exige la política fiscal; sin ella está bloqueado.
 *  - Alta comercial: registro público de pruebas y aprovisionamiento automático.
 *  - Recorrido completo de venta: contratación desde el panel, vencimiento de pruebas, impagos (gracia y
 *    suspensión), comunicaciones comerciales y dominios propios. `readyToSell` resume qué falta para vender a una
 *    empresa nueva de principio a fin (sin contar el catálogo: un plan «available» lo informa
 *    /commerce/conversion/status).
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
  /** Contratación desde el panel de una empresa en prueba (Stripe Checkout). */
  panelConversion: CircuitState;
  /** Vencimiento automático de pruebas y sus avisos (y reintento de altas incompletas). */
  trialScheduler: CircuitState;
  /** Impagos: recordatorios de la gracia y suspensión al terminarla (motor del ciclo de vida en «apply»). */
  dunning: CircuitState;
  /** Correos de los eventos comerciales (despachador). */
  notifications: CircuitState;
  /** Dominios propios: alta automática en Railway o manual. */
  customDomains: CircuitState;
  mail: { mode: string };
  /** ¿Se puede vender a una empresa nueva de principio a fin? Y qué falta, en orden. */
  readyToSell: { ready: boolean; missing: string[] };
}

export interface CircuitSwitches {
  /** Cobros reales de servicios externos habilitados (interruptor protegido). */
  externalLiveCharges: boolean;
  /** Pruebas gratuitas montadas (migraciones y base de pruebas). */
  trialsReady: boolean;
  publicTrial: boolean;
  autoProvision: boolean;
  /** CP_PANEL_CONVERSION_ENABLED. */
  panelConversion?: boolean;
  /** Condiciones de contratación publicadas (CP_TERMS_VERSION). */
  termsPublished?: boolean;
  /** Checkout montado (interruptor y URL de vuelta); en live, además, política fiscal. */
  checkoutMounted?: boolean;
  /** CP_TRIALS_SCHEDULER_ENABLED. */
  trialScheduler?: boolean;
  /** Motor del ciclo de vida: encendido y modo («apply» aplica; «plan» solo planifica). */
  lifecycle?: { enabled: boolean; mode: "plan" | "apply" };
  /** Despachador de correos de eventos comerciales configurado. */
  notificationsDispatch?: boolean;
  /** Integración de dominios con Railway (CP_RAILWAY_DOMAIN_TOKEN). */
  railwayDomains?: boolean;
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

  const conversionMissing = [
    ...trialMissing,
    ...saasCheckout.missing,
    ...(s.checkoutMounted === false && !saasCheckout.missing.length ? ["Checkout de Stripe sin montar (CP_STRIPE_CHECKOUT_ENABLED y URL de vuelta)"] : []),
    ...(s.termsPublished ? [] : ["Condiciones de contratación sin publicar (CP_TERMS_VERSION)"]),
    ...(s.panelConversion ? [] : ["Contratación desde el panel apagada (CP_PANEL_CONVERSION_ENABLED)"]),
  ];
  const panelConversion: CircuitState = { active: conversionMissing.length === 0, mode: conversionMissing.length ? "off" : mode, missing: conversionMissing };
  const state = (missing: string[], on: CircuitState["mode"] = "live"): CircuitState => ({ active: missing.length === 0, mode: missing.length ? "off" : on, missing });
  const trialScheduler = state([...trialMissing, ...(s.trialScheduler ? [] : ["Vencimiento y avisos de pruebas apagados (CP_TRIALS_SCHEDULER_ENABLED)"])]);
  const lc = s.lifecycle ?? { enabled: false, mode: "plan" as const };
  const dunning = state([
    ...(lc.enabled ? [] : ["Motor del ciclo de vida apagado (CP_LIFECYCLE_SCHEDULER_ENABLED)"]),
    ...(lc.mode === "apply" ? [] : ["Motor del ciclo de vida solo planifica (CP_LIFECYCLE_MODE=apply; en live, también CP_LIFECYCLE_LIVE_APPLY)"]),
  ]);
  const notifications = state([
    ...(o.mailMode === "off" ? ["Correo apagado (MAIL_MODE=off)"] : []),
    ...(s.notificationsDispatch ? [] : ["Despachador de comunicaciones comerciales apagado"]),
  ], o.mailMode === "live" ? "live" : "test");
  // Sin la integración, el dominio propio funciona igual pero lo da de alta una persona en Railway
  const customDomains: CircuitState = s.railwayDomains ? { active: true, mode: "live", missing: [] } : { active: true, mode: "off", missing: ["Alta en Railway manual (falta CP_RAILWAY_DOMAIN_TOKEN)"] };
  const publicTrial = flag(s.publicTrial, "Registro público de pruebas apagado");
  const autoProvision = flag(s.autoProvision, "Aprovisionamiento automático apagado");
  const sell = [publicTrial, autoProvision, trialScheduler, panelConversion, dunning, notifications];
  return {
    stripe: describeStripeConfig(o.stripe),
    externalServices,
    saasCheckout,
    publicTrial,
    autoProvision,
    panelConversion,
    trialScheduler,
    dunning,
    notifications,
    customDomains,
    mail: { mode: o.mailMode },
    readyToSell: { ready: sell.every((c) => c.active), missing: Array.from(new Set(sell.flatMap((c) => c.missing))) },
  };
}
