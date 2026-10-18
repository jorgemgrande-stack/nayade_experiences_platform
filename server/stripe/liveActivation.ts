/**
 * Comprobaciones previas a la activación de Stripe en modo live (docs/runbooks/ACTIVACION_STRIPE_LIVE.md).
 *
 * Trabaja sobre las variables del `controlplane` del entorno live tal y como las devuelve Railway y,
 * con la clave restringida de esas variables, sobre la cuenta real de Stripe (solo lecturas).
 * Ningún resultado incluye el valor de una clave, un secreto ni el texto de un error de Stripe (puede
 * llevar los últimos caracteres de la clave): solo nombres, estados y códigos.
 */
import { checkoutUrlsFromEnv } from "./checkout";
import { STRIPE_API_VERSION, StripeConfigError, describeStripeConfig, liveStartupProblem, stripeConfigFromEnv } from "./config";

/** Eventos del destino del webhook: los mismos 18 que el del sandbox. */
export const LIVE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "charge.refunded",
  "charge.refund.updated",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.dispute.funds_reinstated",
  "charge.dispute.updated",
] as const;

/** Precios de la cuenta real creados el 18/10/2026 (docs/elephant-source/STRIPE_PRODUCCION.md §2). */
export const LIVE_PRICE_IDS = ["price_1URvF69RzfmCBuaiFWdFedMo", "price_1URvF69RzfmCBuaiO4hmktlD", "price_1URvF79RzfmCBuaiZEzlexLf", "price_1URvF79RzfmCBuaixUnQ3Pj6"] as const;

/** Variables que abren la venta: la activación de Stripe no las enciende (es otra autorización). */
export const OPENING_FLAGS = ["CP_STRIPE_CHECKOUT_ENABLED", "CP_PUBLIC_CHECKOUT_ENABLED", "CP_PUBLIC_SELF_SERVICE_ENABLED"] as const;
/** Pagos simulados: no pueden convivir con el modo live. */
export const FORBIDDEN_IN_LIVE = ["CP_PAYMENTS_PROVIDER", "CP_PAYMENTS_TEST_WEBHOOK_SECRET"] as const;

export interface Check {
  id: string;
  ok: boolean;
  /** Un fallo bloqueante impide `activar`; uno informativo solo se muestra. */
  blocking: boolean;
  detail: string;
}

const on = (v: string | undefined) => (v ?? "").trim() === "1" || (v ?? "").trim().toLowerCase() === "true";

/** Comprobaciones de las variables del controlplane de live (sin red). */
export function checkLiveVariables(vars: Record<string, string | undefined>): Check[] {
  const out: Check[] = [];
  const add = (id: string, ok: boolean, blocking: boolean, detail: string) => out.push({ id, ok, blocking, detail });
  const mode = (vars.CP_STRIPE_MODE ?? "").trim();

  add("clave", !!vars.CP_STRIPE_API_KEY?.trim(), true, vars.CP_STRIPE_API_KEY?.trim() ? "CP_STRIPE_API_KEY presente" : "Falta CP_STRIPE_API_KEY (clave restringida rk_live_, la introduce el propietario)");
  add("secreto_webhook", !!vars.CP_STRIPE_WEBHOOK_SECRET?.trim(), true, vars.CP_STRIPE_WEBHOOK_SECRET?.trim() ? "CP_STRIPE_WEBHOOK_SECRET presente" : "Falta CP_STRIPE_WEBHOOK_SECRET (whsec_ del destino live, lo introduce el propietario)");
  add("modo", mode === "" || mode === "live", true, mode === "live" ? "CP_STRIPE_MODE=live (ya activado)" : mode === "" ? "CP_STRIPE_MODE ausente: Stripe sin montar hasta activar" : `CP_STRIPE_MODE=${mode}: en el entorno live solo vale «live»`);

  // Dockerfile.controlplane fija ENV NODE_ENV=production: solo cuenta si Railway lo sustituye por otro valor
  const nodeEnv = vars.NODE_ENV ?? "production";
  add("node_env", nodeEnv === "production", true, nodeEnv !== "production" ? `NODE_ENV=${nodeEnv}: el modo live de Stripe exige production` : vars.NODE_ENV ? "NODE_ENV=production" : "NODE_ENV=production (de la imagen, Dockerfile.controlplane)");
  add("prefijo", (vars.CP_STRIPE_NAMESPACE ?? "").trim() === "live", true, (vars.CP_STRIPE_NAMESPACE ?? "").trim() === "live" ? "CP_STRIPE_NAMESPACE=live" : "Falta CP_STRIPE_NAMESPACE=live");

  // La misma validación que hará el servidor al arrancar, como si ya estuviera en modo live
  try {
    const c = stripeConfigFromEnv({ ...vars, CP_STRIPE_MODE: "live" } as NodeJS.ProcessEnv);
    const startup = liveStartupProblem(c, { ...vars, NODE_ENV: nodeEnv } as NodeJS.ProcessEnv);
    add("configuracion", !startup, true, startup ?? `Configuración live válida: ${JSON.stringify(describeStripeConfig(c))}`);
  } catch (e) {
    add("configuracion", false, true, e instanceof StripeConfigError ? e.message : "Configuración de Stripe no válida");
  }

  try {
    const urls = checkoutUrlsFromEnv(vars as NodeJS.ProcessEnv);
    add("urls_vuelta", !!urls, true, urls ? "CP_STRIPE_SUCCESS_URL, CP_STRIPE_CANCEL_URL y CP_STRIPE_PORTAL_RETURN_URL válidas" : "Faltan las URL de vuelta de Checkout y del Portal");
  } catch (e) {
    add("urls_vuelta", false, true, e instanceof Error ? e.message : "URL de vuelta no válidas");
  }

  for (const k of FORBIDDEN_IN_LIVE) add(`sin_${k}`, !vars[k], true, vars[k] ? `${k} existe: los pagos simulados no pueden montarse en live` : `${k} ausente`);
  for (const k of OPENING_FLAGS) add(`cerrado_${k}`, !on(vars[k]), true, on(vars[k]) ? `${k} está encendida: activar Stripe no abre la venta (requiere autorización aparte)` : `${k} apagada`);

  const tax = (vars.CP_STRIPE_TAX_POLICY ?? "").trim();
  add("politica_fiscal", !!tax, false, tax ? `CP_STRIPE_TAX_POLICY=${tax}` : "CP_STRIPE_TAX_POLICY ausente: Checkout bloqueado (tax_policy_pending) hasta aprobar la política fiscal");
  return out;
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Código de error de Stripe sin su mensaje (el mensaje puede llevar parte de la clave). */
async function stripeErrorCode(r: { status: number; json(): Promise<unknown> }): Promise<string> {
  try {
    const b = (await r.json()) as { error?: { type?: string; code?: string } };
    return [r.status, b.error?.type, b.error?.code].filter(Boolean).join(" ");
  } catch {
    return String(r.status);
  }
}

/**
 * Lecturas en la cuenta real con la clave restringida: los cuatro precios (modo live, activos) y el
 * destino del webhook (URL, estado, eventos y versión de la API). Si la clave no puede leer los
 * destinos del webhook, se informa sin bloquear: entonces se comprueba en el Dashboard.
 */
export async function checkLiveStripe(apiKey: string, webhookUrl: string, fetchFn: FetchLike, apiBase = "https://api.stripe.com"): Promise<Check[]> {
  const out: Check[] = [];
  const headers = { Authorization: `Bearer ${apiKey}`, "Stripe-Version": STRIPE_API_VERSION };
  for (const id of LIVE_PRICE_IDS) {
    const r = await fetchFn(`${apiBase}/v1/prices/${id}`, { headers });
    if (r.status !== 200) {
      out.push({ id: `precio_${id}`, ok: false, blocking: true, detail: `No se puede leer el precio ${id} (${await stripeErrorCode(r)}): la clave no es de la cuenta real o le falta el permiso de lectura de Prices` });
      continue;
    }
    const p = (await r.json()) as { livemode?: unknown; active?: unknown };
    const ok = p.livemode === true && p.active === true;
    out.push({ id: `precio_${id}`, ok, blocking: true, detail: ok ? `Precio ${id}: live y activo` : `Precio ${id}: livemode=${String(p.livemode)} active=${String(p.active)}` });
  }

  const r = await fetchFn(`${apiBase}/v1/webhook_endpoints?limit=100`, { headers });
  if (r.status === 401 || r.status === 403) {
    out.push({ id: "webhook", ok: false, blocking: false, detail: "La clave restringida no puede leer los destinos del webhook: comprueba en el Dashboard la URL, que está activo y los 18 eventos" });
    return out;
  }
  if (r.status !== 200) {
    out.push({ id: "webhook", ok: false, blocking: true, detail: `No se pudieron leer los destinos del webhook (${await stripeErrorCode(r)})` });
    return out;
  }
  const list = ((await r.json()) as { data?: Array<{ url?: string; status?: string; enabled_events?: string[]; api_version?: string | null; livemode?: boolean }> }).data ?? [];
  const mine = list.filter((w) => w.url === webhookUrl);
  if (mine.length !== 1) {
    out.push({ id: "webhook", ok: false, blocking: true, detail: mine.length ? `Hay ${mine.length} destinos con la URL ${webhookUrl}: debe haber uno solo` : `No existe ningún destino del webhook con la URL ${webhookUrl}` });
    return out;
  }
  const w = mine[0];
  const events = new Set(w.enabled_events ?? []);
  const missing = LIVE_WEBHOOK_EVENTS.filter((e) => !events.has(e));
  const extra = Array.from(events).filter((e) => !(LIVE_WEBHOOK_EVENTS as readonly string[]).includes(e));
  out.push({ id: "webhook_activo", ok: w.status === "enabled", blocking: true, detail: `Destino del webhook: ${w.status ?? "?"}` });
  out.push({
    id: "webhook_eventos",
    ok: missing.length === 0 && extra.length === 0,
    blocking: true,
    detail: missing.length || extra.length ? `Eventos: faltan [${missing.join(", ")}], sobran [${extra.join(", ")}]` : "Los 18 eventos exactos",
  });
  out.push({ id: "webhook_version", ok: w.api_version === STRIPE_API_VERSION, blocking: false, detail: `Versión de la API del destino: ${w.api_version ?? "la de la cuenta"} (esperada ${STRIPE_API_VERSION})` });
  return out;
}

/** ¿Se puede activar? Solo si no hay ningún fallo bloqueante. */
export const canActivate = (checks: Check[]) => checks.every((c) => c.ok || !c.blocking);
