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

// ─── Modo Real (solo empresas autorizadas expresamente) ─────────────────────────────────────────────────────────────
//
// Los cobros reales con Stripe Connect están APAGADOS salvo que existan las cuatro variables siguientes. Son de una
// plataforma Connect DEDICADA (nunca las claves del Stripe corporativo `CP_STRIPE_*`):
//
//   CONNECT_STRIPE_LIVE_API_KEY         clave RESTRINGIDA real de la plataforma (`rk_…`), con permiso de escritura en «Connect
//                                       OAuth», en sesiones de Checkout y lectura de cuentas.
//   CONNECT_STRIPE_LIVE_WEBHOOK_SECRET  `whsec_…` del destino «cuentas conectadas» del modo real (misma URL central).
//   CONNECT_STRIPE_LIVE_CLIENT_ID       `ca_…` real de la plataforma (Ajustes › Connect › OAuth), con la dirección de
//                                       retorno `<host de la empresa>/admin/configuracion/cobros` registrada.
//   CONNECT_STRIPE_LIVE_TENANTS         empresas que pueden vincular su cuenta REAL, separadas por comas (identificadores
//                                       exactos; no existe el comodín). Sin lista, el modo Real queda apagado para todos.
//
// En modo Real la cuenta se VINCULA (OAuth: la empresa autoriza su cuenta de Stripe ya existente); no se crea ninguna.

export interface ConnectLiveConfig extends ConnectConfig {
  mode: "live";
  clientId: string;
  tenants: readonly string[];
}

const LIVE_KEY = /^rk_live_[A-Za-z0-9]{16,}$/;
const CLIENT_ID = /^ca_[A-Za-z0-9]{16,}$/;
const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function connectLiveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ConnectLiveConfig | null {
  const apiKey = (env.CONNECT_STRIPE_LIVE_API_KEY ?? "").trim();
  const webhookSecret = (env.CONNECT_STRIPE_LIVE_WEBHOOK_SECRET ?? "").trim();
  const clientId = (env.CONNECT_STRIPE_LIVE_CLIENT_ID ?? "").trim();
  const rawTenants = (env.CONNECT_STRIPE_LIVE_TENANTS ?? "").trim();
  if (!apiKey && !webhookSecret && !clientId && !rawTenants) return null;
  if (!apiKey || !webhookSecret || !clientId || !rawTenants) throw new ConnectConfigError("Modo Real incompleto: faltan variables CONNECT_STRIPE_LIVE_*");
  // La clave del Stripe corporativo (CP_STRIPE_API_KEY) nunca puede servir aquí
  if (env.CP_STRIPE_API_KEY && apiKey === env.CP_STRIPE_API_KEY.trim()) throw new ConnectConfigError("CONNECT_STRIPE_LIVE_API_KEY no puede ser la clave del Stripe corporativo");
  if (!LIVE_KEY.test(apiKey)) throw new ConnectConfigError("CONNECT_STRIPE_LIVE_API_KEY debe ser una clave restringida real (rk_…)");
  if (!WEBHOOK_SECRET.test(webhookSecret)) throw new ConnectConfigError("CONNECT_STRIPE_LIVE_WEBHOOK_SECRET ausente o mal formado (whsec_…)");
  if (!CLIENT_ID.test(clientId)) throw new ConnectConfigError("CONNECT_STRIPE_LIVE_CLIENT_ID ausente o mal formado (ca_…)");
  const tenants = rawTenants.split(",").map((t) => t.trim()).filter(Boolean);
  if (tenants.length === 0 || tenants.some((t) => !TENANT_ID.test(t))) throw new ConnectConfigError("CONNECT_STRIPE_LIVE_TENANTS debe listar identificadores exactos de empresa (sin comodines)");
  return { mode: "live", apiKey, webhookSecret, clientId, tenants };
}

export function connectLiveConfigState(env: NodeJS.ProcessEnv = process.env): { config: ConnectLiveConfig | null; problem: string | null } {
  try {
    return { config: connectLiveConfigFromEnv(env), problem: null };
  } catch (e) {
    return { config: null, problem: e instanceof ConnectConfigError ? e.message : "Configuración real de Stripe Connect no válida" };
  }
}

/** ¿Puede esta empresa vincular y usar su cuenta REAL en este entorno? */
export function liveAllowedFor(tenantId: string, env: NodeJS.ProcessEnv = process.env): ConnectLiveConfig | null {
  const { config } = connectLiveConfigState(env);
  return config && config.tenants.includes(tenantId) ? config : null;
}
