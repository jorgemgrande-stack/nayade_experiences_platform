/**
 * Configuración de Stripe Billing del plano de control. SOLO MODO PRUEBAS (sandbox).
 *
 * Variables (solo en Railway, nunca en Git ni en logs):
 *   CP_STRIPE_MODE            «test» activa la integración. Cualquier otro valor impide arrancar.
 *   CP_STRIPE_API_KEY         clave restringida de pruebas `rk_test_…` (o `sk_test_…` solo en desarrollo
 *                             local). Permisos mínimos: docs/elephant-source/STRIPE_FASE_A.md §5.
 *   CP_STRIPE_WEBHOOK_SECRET  secreto del destino de webhooks `whsec_…`.
 *   CP_STRIPE_API_VERSION     opcional: versión fijada de la API (por defecto STRIPE_API_VERSION).
 *
 * Garantías:
 *  - Una clave o un secreto «live» impiden arrancar. No existe ninguna variable que autorice live.
 *  - No se mezcla con el motor antiguo (`server/_core/billing`, variables STRIPE_* y BILLING_*): si
 *    ese motor está configurado para usar Stripe, no se arranca.
 *  - Sin CP_STRIPE_MODE la integración está apagada (null) y nada llama a Stripe.
 */

/** Versión de la API con la que se diseña y prueba la integración (docs.stripe.com/api/versioning). */
export const STRIPE_API_VERSION = "2026-09-30.endive";

export interface StripeConfig {
  mode: "test";
  apiKey: string;
  webhookSecret: string;
  apiVersion: string;
  /** Tipo de clave: restringida (recomendada) o secreta (solo desarrollo local). */
  keyKind: "restricted" | "secret";
}

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

const TEST_KEY = /^(rk|sk)_test_[A-Za-z0-9]{16,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]{16,}$/;
const API_VERSION = /^\d{4}-\d{2}-\d{2}\.[a-z]+$/;

/** Indica si un valor parece una credencial «live» de Stripe (sin revelarlo). */
export function looksLive(value: string): boolean {
  return /_live_/i.test(value);
}

/**
 * Lee y valida la configuración. Devuelve `null` si la integración está apagada. Lanza
 * `StripeConfigError` (el servicio no arranca) ante cualquier configuración insegura o incompleta. Los
 * mensajes nunca incluyen el valor de las credenciales.
 */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  for (const k of Object.keys(env)) {
    if (/^CP_STRIPE_.*LIVE/i.test(k) || /^STRIPE_LIVE/i.test(k)) throw new StripeConfigError(`${k} no está permitido: solo modo pruebas`);
    // Ningún servicio guarda credenciales administrativas de Stripe (catálogo y Portal los gestiona una persona)
    if (/^CP_STRIPE_ADMIN/i.test(k)) throw new StripeConfigError(`${k} no está permitido en un servicio: las operaciones administrativas no usan claves guardadas`);
  }
  const mode = (env.CP_STRIPE_MODE ?? "").trim().toLowerCase();
  const apiKey = (env.CP_STRIPE_API_KEY ?? "").trim();
  const webhookSecret = (env.CP_STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (apiKey && looksLive(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY es una clave live: prohibida");
  if (webhookSecret && /live/i.test(webhookSecret)) throw new StripeConfigError("CP_STRIPE_WEBHOOK_SECRET no parece de pruebas");
  if (!mode) {
    if (apiKey || webhookSecret) throw new StripeConfigError("Hay credenciales CP_STRIPE_* pero falta CP_STRIPE_MODE=test");
    return null;
  }
  if (mode !== "test") throw new StripeConfigError(`CP_STRIPE_MODE=${mode} no está soportado: solo «test»`);
  if (!TEST_KEY.test(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY ausente o no es una clave de pruebas (rk_test_… / sk_test_…)");
  if (!WEBHOOK_SECRET.test(webhookSecret)) throw new StripeConfigError("CP_STRIPE_WEBHOOK_SECRET ausente o mal formado (whsec_…)");
  if (env.NODE_ENV === "production" && !apiKey.startsWith("rk_test_")) throw new StripeConfigError("En producción solo se admite una clave RESTRINGIDA de pruebas (rk_test_…)");
  const apiVersion = (env.CP_STRIPE_API_VERSION ?? "").trim() || STRIPE_API_VERSION;
  if (!API_VERSION.test(apiVersion)) throw new StripeConfigError("CP_STRIPE_API_VERSION mal formada (AAAA-MM-DD.nombre)");
  if ((env.BILLING_PROVIDER ?? "").toLowerCase() === "stripe") {
    throw new StripeConfigError("El motor antiguo (BILLING_PROVIDER=stripe) no puede convivir con Stripe Billing");
  }
  return { mode: "test", apiKey, webhookSecret, apiVersion, keyKind: apiKey.startsWith("rk_") ? "restricted" : "secret" };
}

/** Descripción segura para logs y diagnóstico: nunca la clave ni el secreto. */
export function describeStripeConfig(c: StripeConfig | null): Record<string, unknown> {
  return c ? { enabled: true, mode: c.mode, keyKind: c.keyKind, apiVersion: c.apiVersion } : { enabled: false };
}

/** Un objeto o evento de Stripe solo se acepta si es de pruebas. */
export function assertTestObject(o: { livemode?: unknown } | null | undefined): void {
  if (!o || o.livemode !== false) throw new StripeConfigError("Objeto de Stripe rechazado: livemode distinto de false");
}
