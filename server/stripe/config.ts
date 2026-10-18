/**
 * Configuración de Stripe Billing del plano de control. Dos modos EXPLÍCITOS: pruebas (sandbox) y live.
 *
 * Variables (solo en Railway, nunca en Git ni en logs):
 *   CP_STRIPE_MODE            «test» o «live» activa la integración. Cualquier otro valor impide arrancar.
 *   CP_STRIPE_API_KEY         en «test»: clave restringida de pruebas `rk_test_…` (o `sk_test_…` solo en
 *                             desarrollo local). En «live»: SOLO clave restringida `rk_live_…`, nunca
 *                             `sk_live_`. Permisos mínimos: docs/elephant-source/STRIPE_FASE_A.md §5.
 *   CP_STRIPE_WEBHOOK_SECRET  secreto del destino de webhooks `whsec_…`.
 *   CP_STRIPE_API_VERSION     opcional: versión fijada de la API (por defecto STRIPE_API_VERSION).
 *   CP_STRIPE_NAMESPACE       prefijo del entorno (2–16 minúsculas o cifras) en las claves de idempotencia y
 *                             en `metadata.es_env`. En «test» es opcional: sin él se deriva del proyecto y del
 *                             entorno de Railway; en local vale «local»; «live» no se admite. Dos entornos que
 *                             compartan sandbox no chocan: cada uno ignora los objetos del otro. En «live» es
 *                             OBLIGATORIO y vale exactamente «live».
 *   CP_STRIPE_TAX_POLICY      solo en «live»: política fiscal del cobro. Ausente = «política fiscal pendiente»
 *                             (Checkout no cobra). Valores: `stripe_tax_exclusive` (Stripe Tax con
 *                             `automatic_tax` y precios sin IVA). En «test» se ignora: `test_net_no_tax`.
 *   CP_STRIPE_EVENTS_RETENTION_DAYS  opcional: días que se conservan los eventos terminados (35–3650; 180).
 *
 * Garantías:
 *  - En «test», una clave o un secreto «live» impiden arrancar. En «live», una clave de pruebas o una clave
 *    secreta (`sk_live_`) también. La clave live va en la MISMA `CP_STRIPE_API_KEY`, en otro entorno de
 *    Railway con su propia base de datos: no existe ninguna variable con LIVE ni ADMIN en el nombre.
 *  - No se mezcla con el motor antiguo (`server/_core/billing`, variables STRIPE_* y BILLING_*): si
 *    ese motor está configurado para usar Stripe, no se arranca.
 *  - Sin CP_STRIPE_MODE la integración está apagada (null) y nada llama a Stripe.
 *  - Un objeto o evento de Stripe solo se acepta si su `livemode` coincide con el modo (`assertModeObject`).
 */

import crypto from "node:crypto";

/** Versión de la API con la que se diseña y prueba la integración (docs.stripe.com/api/versioning). */
export const STRIPE_API_VERSION = "2026-09-30.endive";

export type StripeMode = "test" | "live";
/**
 * Tratamiento fiscal del cobro. `test_net_no_tax`: modo pruebas, importe neto sin IVA y sin factura fiscal.
 * `stripe_tax_exclusive`: live con Stripe Tax (`automatic_tax`) sobre precios sin IVA.
 */
export type StripeTaxPolicy = "test_net_no_tax" | "stripe_tax_exclusive";
/** Políticas fiscales admitidas en live (por ahora, solo una). */
export const LIVE_TAX_POLICIES: readonly StripeTaxPolicy[] = ["stripe_tax_exclusive"];
/** Prefijo obligatorio del entorno live. */
export const LIVE_NAMESPACE = "live";

export interface StripeConfig {
  mode: StripeMode;
  apiKey: string;
  webhookSecret: string;
  apiVersion: string;
  /** Tipo de clave: restringida (recomendada; la única en live) o secreta (solo desarrollo local en pruebas). */
  keyKind: "restricted" | "secret";
  /** Prefijo del entorno: claves de idempotencia `es-<ns>-…` y `metadata.es_env`. */
  namespace: string;
  /** Días que se conservan los eventos ya procesados o ignorados antes de purgarlos. */
  eventsRetentionDays: number;
  /** En «test», siempre `test_net_no_tax`. En «live», null = política fiscal pendiente: no se cobra. */
  taxPolicy: StripeTaxPolicy | null;
}

const NAMESPACE = /^[a-z0-9]{2,16}$/;
export const DEFAULT_EVENTS_RETENTION_DAYS = 180;
/** Más que los 30 días que Stripe conserva los eventos: la conciliación nunca vuelve a pedir uno purgado. */
export const MIN_EVENTS_RETENTION_DAYS = 35;

/**
 * Prefijo del entorno (B9). En «test»: explícito, derivado de Railway o «local» (en producción no se admite
 * «local») y nunca «live». En «live»: explícito y exactamente «live».
 */
export function stripeNamespaceFromEnv(env: NodeJS.ProcessEnv = process.env, mode: StripeMode = "test"): string {
  const explicit = (env.CP_STRIPE_NAMESPACE ?? "").trim();
  if (mode === "live") {
    if (explicit !== LIVE_NAMESPACE) throw new StripeConfigError(`En modo live hace falta CP_STRIPE_NAMESPACE=${LIVE_NAMESPACE} explícito`);
    return explicit;
  }
  if (explicit) {
    if (!NAMESPACE.test(explicit)) throw new StripeConfigError("CP_STRIPE_NAMESPACE debe tener 2–16 minúsculas o cifras");
    if (explicit === LIVE_NAMESPACE) throw new StripeConfigError(`CP_STRIPE_NAMESPACE=${LIVE_NAMESPACE} está reservado al modo live`);
    return explicit;
  }
  const project = (env.RAILWAY_PROJECT_ID ?? "").trim();
  const environment = (env.RAILWAY_ENVIRONMENT_ID ?? "").trim();
  if (project && environment) return "r" + crypto.createHash("sha256").update(`${project}:${environment}`).digest("hex").slice(0, 10);
  if (env.NODE_ENV === "production") throw new StripeConfigError("En producción hace falta CP_STRIPE_NAMESPACE (o las variables de Railway) para separar entornos");
  return "local";
}

function retentionDaysFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = (env.CP_STRIPE_EVENTS_RETENTION_DAYS ?? "").trim();
  if (!raw) return DEFAULT_EVENTS_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_EVENTS_RETENTION_DAYS || n > 3650) throw new StripeConfigError(`CP_STRIPE_EVENTS_RETENTION_DAYS debe ser un entero entre ${MIN_EVENTS_RETENTION_DAYS} y 3650`);
  return n;
}

/** Política fiscal de live: ausente = pendiente (null); un valor no admitido impide arrancar. */
function taxPolicyFromEnv(env: NodeJS.ProcessEnv): StripeTaxPolicy | null {
  const raw = (env.CP_STRIPE_TAX_POLICY ?? "").trim();
  if (!raw) return null;
  if (!(LIVE_TAX_POLICIES as readonly string[]).includes(raw)) throw new StripeConfigError(`CP_STRIPE_TAX_POLICY no admitida: solo ${LIVE_TAX_POLICIES.join(", ")}`);
  return raw as StripeTaxPolicy;
}

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

const TEST_KEY = /^(rk|sk)_test_[A-Za-z0-9]{16,}$/;
const LIVE_KEY = /^rk_live_[A-Za-z0-9]{16,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]{16,}$/;
const API_VERSION = /^\d{4}-\d{2}-\d{2}\.[a-z]+$/;

/** Indica si un valor parece una credencial «live» de Stripe (sin revelarlo). */
export function looksLive(value: string): boolean {
  return /_live_/i.test(value);
}

/** Indica si un valor parece una credencial de pruebas de Stripe (sin revelarlo). */
export function looksTest(value: string): boolean {
  return /_test_/i.test(value);
}

/**
 * Lee y valida la configuración. Devuelve `null` si la integración está apagada. Lanza
 * `StripeConfigError` (el servicio no arranca) ante cualquier configuración insegura o incompleta. Los
 * mensajes nunca incluyen el valor de las credenciales.
 */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  for (const k of Object.keys(env)) {
    // La clave live va en la MISMA CP_STRIPE_API_KEY, en otro entorno: ninguna variable «autoriza» live
    if (/^CP_STRIPE_.*LIVE/i.test(k) || /^STRIPE_LIVE/i.test(k)) throw new StripeConfigError(`${k} no está permitido: el modo solo se elige con CP_STRIPE_MODE`);
    // Ningún servicio guarda credenciales administrativas de Stripe (catálogo y Portal los gestiona una persona)
    if (/^CP_STRIPE_ADMIN/i.test(k)) throw new StripeConfigError(`${k} no está permitido en un servicio: las operaciones administrativas no usan claves guardadas`);
  }
  const mode = (env.CP_STRIPE_MODE ?? "").trim().toLowerCase();
  const apiKey = (env.CP_STRIPE_API_KEY ?? "").trim();
  const webhookSecret = (env.CP_STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!mode) {
    if (apiKey && looksLive(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY es una clave live sin CP_STRIPE_MODE=live: prohibida");
    if (apiKey || webhookSecret) throw new StripeConfigError("Hay credenciales CP_STRIPE_* pero falta CP_STRIPE_MODE (test o live)");
    return null;
  }
  if (mode !== "test" && mode !== "live") throw new StripeConfigError(`CP_STRIPE_MODE=${mode.slice(0, 20)} no está soportado: solo «test» o «live»`);
  if (mode === "test") {
    if (apiKey && looksLive(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY es una clave live: prohibida en modo pruebas");
    if (webhookSecret && /live/i.test(webhookSecret)) throw new StripeConfigError("CP_STRIPE_WEBHOOK_SECRET no parece de pruebas");
    if (!TEST_KEY.test(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY ausente o no es una clave de pruebas (rk_test_… / sk_test_…)");
  } else {
    if (apiKey && looksTest(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY es una clave de pruebas: prohibida en modo live");
    if (/^sk_live_/i.test(apiKey)) throw new StripeConfigError("En modo live solo se admite una clave RESTRINGIDA (rk_live_…), nunca una clave secreta");
    if (!LIVE_KEY.test(apiKey)) throw new StripeConfigError("CP_STRIPE_API_KEY ausente o no es una clave restringida live (rk_live_…)");
  }
  if (!WEBHOOK_SECRET.test(webhookSecret)) throw new StripeConfigError("CP_STRIPE_WEBHOOK_SECRET ausente o mal formado (whsec_…)");
  if (mode === "test" && env.NODE_ENV === "production" && !apiKey.startsWith("rk_test_")) throw new StripeConfigError("En producción solo se admite una clave RESTRINGIDA de pruebas (rk_test_…)");
  const apiVersion = (env.CP_STRIPE_API_VERSION ?? "").trim() || STRIPE_API_VERSION;
  if (!API_VERSION.test(apiVersion)) throw new StripeConfigError("CP_STRIPE_API_VERSION mal formada (AAAA-MM-DD.nombre)");
  if ((env.BILLING_PROVIDER ?? "").toLowerCase() === "stripe") {
    throw new StripeConfigError("El motor antiguo (BILLING_PROVIDER=stripe) no puede convivir con Stripe Billing");
  }
  return {
    mode,
    apiKey,
    webhookSecret,
    apiVersion,
    keyKind: apiKey.startsWith("rk_") ? "restricted" : "secret",
    namespace: stripeNamespaceFromEnv(env, mode),
    eventsRetentionDays: retentionDaysFromEnv(env),
    // En pruebas la variable se ignora: el tratamiento es siempre el neto sin IVA de pruebas
    taxPolicy: mode === "test" ? "test_net_no_tax" : taxPolicyFromEnv(env),
  };
}

/**
 * Condiciones de ARRANQUE del modo live (además de la configuración): solo en un despliegue de producción.
 * Devuelve el motivo por el que no se puede arrancar, o null.
 */
export function liveStartupProblem(c: StripeConfig | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!c || c.mode !== "live") return null;
  if (env.NODE_ENV !== "production") return "El modo live de Stripe exige NODE_ENV=production";
  return null;
}

/** Motivo por el que Checkout no puede cobrar con esta configuración (null si puede). */
export function checkoutBlockedReason(c: Pick<StripeConfig, "mode" | "taxPolicy">): "tax_policy_pending" | null {
  return c.mode === "live" && !c.taxPolicy ? "tax_policy_pending" : null;
}

/** Descripción segura para logs y diagnóstico: nunca la clave ni el secreto. */
export function describeStripeConfig(c: StripeConfig | null): Record<string, unknown> {
  return c
    ? { enabled: true, mode: c.mode, keyKind: c.keyKind, apiVersion: c.apiVersion, namespace: c.namespace, eventsRetentionDays: c.eventsRetentionDays, taxPolicy: c.taxPolicy ?? "pending" }
    : { enabled: false };
}

/** ¿El `livemode` de un objeto o evento de Stripe es el de este modo? Solo valen `true` o `false` exactos. */
export function livemodeMatches(livemode: unknown, mode: StripeMode): boolean {
  return livemode === (mode === "live");
}

/** Un objeto o evento de Stripe solo se acepta si su `livemode` coincide con el modo configurado. */
export function assertModeObject(o: { livemode?: unknown } | null | undefined, mode: StripeMode): void {
  if (!o || !livemodeMatches(o.livemode, mode)) throw new StripeConfigError(`Objeto de Stripe rechazado: livemode distinto de ${mode === "live"} (modo ${mode})`);
}

/** Alias del modo pruebas (compatibilidad): un objeto o evento solo se acepta si es de pruebas. */
export function assertTestObject(o: { livemode?: unknown } | null | undefined): void {
  assertModeObject(o, "test");
}
