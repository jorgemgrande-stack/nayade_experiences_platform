/**
 * Configuración de Stripe Connect para los cobros de cada empresa. SEPARADA del Stripe corporativo de Big Elephant
 * (`CP_STRIPE_*`, que cobra suscripciones y licencias): variables, claves y webhook propios, y nunca se mezclan.
 *
 *   CONNECT_STRIPE_MODE            «test». «live» está RECHAZADO en esta entrega (los cobros reales no se activan).
 *   CONNECT_STRIPE_API_KEY         clave de la plataforma Connect (`rk_test_…` restringida; `sk_test_` solo en local).
 *   CONNECT_STRIPE_WEBHOOK_SECRET  secreto `whsec_…` del destino de webhook «cuentas conectadas» (un único destino
 *                                  central: POST <host central>/api/stripe/connect/webhook).
 *
 * Sin CONNECT_STRIPE_MODE la función está apagada: la pantalla lo explica y nada llama a Stripe.
 */
import type { PaymentMode } from "../../shared/paymentAccounts";

export class ConnectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectConfigError";
  }
}

export interface ConnectConfig {
  mode: PaymentMode;
  apiKey: string;
  webhookSecret: string;
}

const TEST_KEY = /^(rk|sk)_test_[A-Za-z0-9]{8,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]{16,}$/;

export function connectConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ConnectConfig | null {
  const mode = (env.CONNECT_STRIPE_MODE ?? "").trim().toLowerCase();
  const apiKey = (env.CONNECT_STRIPE_API_KEY ?? "").trim();
  const webhookSecret = (env.CONNECT_STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!mode) {
    if (apiKey || webhookSecret) throw new ConnectConfigError("Hay credenciales CONNECT_STRIPE_* pero falta CONNECT_STRIPE_MODE");
    return null;
  }
  if (mode === "live") throw new ConnectConfigError("Los cobros reales con Stripe Connect no están activados: CONNECT_STRIPE_MODE solo admite «test»");
  if (mode !== "test") throw new ConnectConfigError("CONNECT_STRIPE_MODE no está soportado (solo «test»)");
  if (/live/i.test(apiKey) || /live/i.test(webhookSecret)) throw new ConnectConfigError("Credenciales live prohibidas en modo pruebas");
  if (!TEST_KEY.test(apiKey)) throw new ConnectConfigError("CONNECT_STRIPE_API_KEY ausente o no es una clave de pruebas (rk_test_… / sk_test_…)");
  if (!WEBHOOK_SECRET.test(webhookSecret)) throw new ConnectConfigError("CONNECT_STRIPE_WEBHOOK_SECRET ausente o mal formado (whsec_…)");
  if (env.NODE_ENV === "production" && !apiKey.startsWith("rk_test_")) throw new ConnectConfigError("En producción solo se admite una clave RESTRINGIDA de pruebas (rk_test_…)");
  return { mode: "test", apiKey, webhookSecret };
}

/** Lectura que no lanza: la pantalla muestra el motivo en vez de romperse. */
export function connectConfigState(env: NodeJS.ProcessEnv = process.env): { config: ConnectConfig | null; problem: string | null } {
  try {
    return { config: connectConfigFromEnv(env), problem: null };
  } catch (e) {
    return { config: null, problem: e instanceof ConnectConfigError ? e.message : "Configuración de Stripe Connect no válida" };
  }
}
