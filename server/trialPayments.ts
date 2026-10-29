/**
 * Cobros reales durante la prueba gratuita: BLOQUEADOS en el servidor.
 *
 * Una empresa en prueba (o sin contratar) no puede cobrar dinero real a sus clientes: solo contra el entorno de
 * pruebas de la pasarela (Redsys `sis-t`, donde no se mueve dinero). La regla se aplica en el único punto por el que
 * pasan todos los cobros online (`buildRedsysForm`), así que no la salta una llamada directa a la API, un permiso de
 * administrador de la empresa ni un ajuste de credenciales.
 *
 * Quién puede cobrar de verdad:
 *  - Con el estado del registro (lo fija el middleware de cada petición): `active` y `grace` sí (contratada,
 *    también con un recibo pendiente); `trial` solo si tiene una licencia de pago (alta asistida por un operador,
 *    sin pedido en el orquestador, que el registro no mueve de `trial`); `suspended`, `provisioning`… no.
 *  - Sin estado (trabajos, webhooks): por las licencias. Licencias con caducidad y ninguna de pago = prueba.
 *  - Si no se puede verificar (registro caído sin caché): no (falla cerrado).
 *  - Fuera de multiempresa (instalación propia): sin cambios.
 *
 * Los cobros de la SUSCRIPCIÓN SaaS (Stripe del plano de control) son otra cosa y no pasan por aquí: los limita
 * el plano de control (pedido contratado y suscripción activa).
 */
import { TRPCError } from "@trpc/server";
import { getTenantMode, peekTenantContext } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import type { CapabilityGrant } from "./_core/capabilities/model";

export const TRIAL_PAYMENTS_MESSAGE =
  "Durante la prueba gratuita no se pueden cobrar pagos reales. Puedes probar los cobros con el entorno de pruebas de Redsys; los cobros reales se activan al contratar un plan.";

/** Estados del registro con cobros reales permitidos. */
const PAYING_STATUSES = new Set(["active", "grace"]);

type GrantView = Pick<CapabilityGrant, "source" | "status" | "validUntil">;

/** ¿Alguna licencia de pago (sin caducidad, de una suscripción o concedida por un operador)? */
export function grantsShowPaid(grants: GrantView[]): boolean {
  return grants.some((g) => g.validUntil === null && g.status === "active" && (g.source.startsWith("subscription:") || g.source === "operator"));
}

/** ¿Las licencias indican una empresa en prueba o sin contratar? Pura. Sin licencias (empresas anteriores): no. */
export function grantsShowTrial(grants: GrantView[]): boolean {
  return grants.some((g) => g.validUntil !== null && g.status !== "cancelled") && !grantsShowPaid(grants);
}

/** Decisión pura: ¿se permite un cobro real? */
export function realPaymentsAllowed(o: { multi: boolean; status?: string | null; grants: Parameters<typeof grantsShowTrial>[0] | null | "unavailable" }): { allowed: boolean; reason: string } {
  if (!o.multi) return { allowed: true, reason: "single" };
  if (o.status && PAYING_STATUSES.has(o.status)) return { allowed: true, reason: `status:${o.status}` };
  if (o.status && o.status !== "trial") return { allowed: false, reason: `status:${o.status}` };
  if (o.grants === "unavailable") return { allowed: false, reason: "unverifiable" };
  if (o.status === "trial") return o.grants && grantsShowPaid(o.grants) ? { allowed: true, reason: "status:trial+paid" } : { allowed: false, reason: "status:trial" };
  if (o.grants && grantsShowTrial(o.grants)) return { allowed: false, reason: "grants:trial" };
  return { allowed: true, reason: "grants" };
}

/**
 * Comprueba la empresa en curso antes de un cobro contra el entorno `environment` de la pasarela. El entorno de
 * pruebas siempre se permite. Lanza FORBIDDEN (con causa `trial_real_payments_blocked`) si el cobro sería real.
 */
export async function assertRealPaymentAllowed(environment: string): Promise<void> {
  if (environment !== "production") return;
  const multi = getTenantMode() === "multi";
  let grants: Parameters<typeof realPaymentsAllowed>[0]["grants"] = null;
  const status = peekTenantContext()?.status ?? null;
  if (multi && (!status || status === "trial")) {
    try {
      grants = await getCapabilityAccess().grants();
    } catch {
      grants = "unavailable";
    }
  }
  const d = realPaymentsAllowed({ multi, status, grants });
  if (!d.allowed) {
    console.warn(JSON.stringify({ ctx: "TrialPayments", event: "real_payment_blocked", tenant: peekTenantContext()?.tenantId ?? null, reason: d.reason }));
    throw new TRPCError({ code: "FORBIDDEN", message: TRIAL_PAYMENTS_MESSAGE, cause: new Error("trial_real_payments_blocked") });
  }
}

/**
 * ¿La empresa en curso está en prueba (o sin contratar)? Para las operaciones económicas del panel (compras y bajas
 * de módulos): en prueba no hay suscripción que ampliar. Sin poder verificarlo, se trata como prueba (falla cerrado).
 */
export async function isTrialTenant(): Promise<boolean> {
  if (getTenantMode() !== "multi") return false;
  const status = peekTenantContext()?.status ?? null;
  let grants: GrantView[] | "unavailable";
  try {
    grants = (await getCapabilityAccess().grants()) ?? [];
  } catch {
    grants = "unavailable";
  }
  return !realPaymentsAllowed({ multi: true, status, grants }).allowed;
}

export const TRIAL_PURCHASES_MESSAGE = "Durante la prueba gratuita no se pueden comprar ni dar de baja módulos: elige tu plan y los módulos al contratar.";
