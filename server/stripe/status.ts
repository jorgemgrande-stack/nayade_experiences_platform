/**
 * Estado PÚBLICO del alta tras volver de Stripe Checkout (`GET /cp/v1/public/checkout/status?session_id=`).
 * En modo pruebas o live (solo sesiones de su modo: `cs_test_` o `cs_live_`) y apagado salvo
 * CP_PUBLIC_CHECKOUT_ENABLED=1.
 *
 *  - Solo progreso, sin datos personales: estado, mensaje y, cuando el alta ha terminado de verdad
 *    (pedido `active`), la dirección de acceso de la empresa.
 *  - Nunca dice «listo» por haber vuelto de Checkout: lo decide el pedido, que solo avanza con el pago
 *    verificado en Stripe (webhook o conciliación).
 *  - Mientras el pedido espera el pago, relee la sesión en Stripe como mucho una vez cada 30 s por sesión
 *    (como recomienda Stripe para la página de éxito); el efecto es el mismo que el del webhook. Así un
 *    visitante que consulta cada pocos segundos no multiplica las llamadas a la API de Stripe.
 *  - Contrato acordado con la web (bigelephant-web, docs de la página `/contratacion/estado`):
 *    pending_payment | payment_processing | provisioning | ready | failed | expired.
 *    Respuesta 200 { state, message, accessUrl?, retryAfterSeconds? }; 400 si el id está mal formado;
 *    404 si la sesión es desconocida (o el seguimiento está apagado).
 */
import type { OrderStore } from "../orchestrator/store";
import type { StripeMode } from "./config";
import type { StripeEventProcessor } from "./events";
import type { StripeStore } from "./store";

export type CheckoutStatus = "pending_payment" | "payment_processing" | "provisioning" | "ready" | "failed" | "expired";

export interface CheckoutStatusView {
  state: CheckoutStatus;
  message: string;
  /** Solo con `ready`. */
  accessUrl?: string;
  /** En los estados en curso: cuándo volver a consultar. */
  retryAfterSeconds?: number;
}

const RETRY: Partial<Record<CheckoutStatus, number>> = { pending_payment: 5, payment_processing: 3, provisioning: 5 };

const MESSAGES: Record<CheckoutStatus, string> = {
  pending_payment: "Aún no hemos recibido la confirmación del pago.",
  payment_processing: "Pago recibido. Estamos confirmándolo con Stripe.",
  provisioning: "Pago confirmado. Estamos preparando la instalación de tu empresa.",
  ready: "Tu empresa está lista.",
  failed: "No hemos podido completar el alta. Nuestro equipo ya lo sabe y te contactará.",
  expired: "La sesión de pago caducó sin completarse. No se ha cobrado nada.",
};

/** Id de una Checkout Session de pruebas (compatibilidad: el modo por defecto). */
export const SESSION_ID_RE = /^cs_test_[A-Za-z0-9]{8,240}$/;
const LIVE_SESSION_ID_RE = /^cs_live_[A-Za-z0-9]{8,240}$/;
/** Id de una Checkout Session admitido en un modo: `cs_test_` en pruebas, `cs_live_` en live; nunca el del otro. */
export const sessionIdRe = (mode: StripeMode = "test") => (mode === "live" ? LIVE_SESSION_ID_RE : SESSION_ID_RE);

export interface StatusDeps {
  store: Pick<StripeStore, "session">;
  orders: Pick<OrderStore, "get">;
  processor?: Pick<StripeEventProcessor, "process">;
  platformDomain: string | null;
  /** Última relectura por sesión (compartido entre peticiones del proceso). */
  rechecks?: Map<string, number>;
  now?: () => number;
  /** Modo del entorno (por defecto «test»): solo se aceptan ids de sesión de ese modo. */
  mode?: StripeMode;
}

export const RECHECK_EVERY_MS = 30_000;
const MAX_TRACKED = 5000;

export async function checkoutStatus(d: StatusDeps, sessionId: string): Promise<CheckoutStatusView | null> {
  if (!sessionIdRe(d.mode).test(sessionId)) return null;
  const row = await d.store.session(sessionId);
  if (!row) return null;
  let o = await d.orders.get(row.orderId);
  if (!o) return null;
  // Pago hecho pero sin confirmar aún: una relectura verificada (idempotente, igual que el webhook)
  const now = (d.now ?? Date.now)();
  const last = d.rechecks?.get(sessionId);
  if (o.state === "contracted" && d.processor && row.status !== "expired" && (last === undefined || now - last >= RECHECK_EVERY_MS)) {
    if (d.rechecks) {
      if (d.rechecks.size >= MAX_TRACKED) d.rechecks.clear();
      d.rechecks.set(sessionId, now);
    }
    await d.processor.process({ eventId: "status-page", type: "checkout.session.completed", objectId: sessionId }).catch(() => undefined);
    o = (await d.orders.get(row.orderId)) ?? o;
  }
  const fresh = await d.store.session(sessionId);
  const view = (state: CheckoutStatus, accessUrl?: string): CheckoutStatusView => ({ state, message: MESSAGES[state], ...(accessUrl ? { accessUrl } : {}), ...(RETRY[state] ? { retryAfterSeconds: RETRY[state] } : {}) });
  if (o.state === "active" || o.state === "past_due" || o.state === "cancel_scheduled") {
    return o.tenantId && d.platformDomain ? view("ready", `https://${o.tenantId}.${d.platformDomain}`) : view("ready");
  }
  if (o.state === "confirmed" || o.state === "subscribed" || o.state === "licensed") return view("provisioning");
  if (o.state === "rejected" || o.state === "cancelled" || o.state === "superseded" || o.state === "suspended") return view("failed");
  // contracted: depende de la sesión
  if (fresh?.status === "complete") return view("payment_processing");
  if (fresh?.status === "expired") return view("expired");
  return view("pending_payment");
}
