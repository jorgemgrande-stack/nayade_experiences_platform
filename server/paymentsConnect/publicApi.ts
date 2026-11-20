/**
 * Pago con Stripe desde el enlace público de un presupuesto. Se expone a través de los procedimientos públicos que ya
 * existen (`crm.quotes.getByToken` y `crm.quotes.payWithToken`), sin rutas públicas nuevas.
 */
import { TRPCError } from "@trpc/server";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { connectConfigState } from "./config";
import { AccountIndexUnavailable } from "./accountIndex";
import { ConnectGatewayError } from "./gateway";
import { realPaymentsDeps } from "./runtime";
import { onlineAvailable, PaymentsError, startQuoteCheckout, startShopCheckout } from "./service";
import { mysqlPaymentStore, PaymentsSchemaMissing } from "./store";

/** Traduce los errores del dominio a respuestas claras; nunca devuelve el mensaje de Stripe ni claves. */
export function translatePaymentsError(e: unknown): never {
  if (e instanceof TRPCError) throw e;
  if (e instanceof PaymentsSchemaMissing) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Los cobros por empresa necesitan una actualización de la base de datos que aún no se ha aplicado" });
  if (e instanceof PaymentsError) throw new TRPCError({ code: e.code === "cannot_enable" || e.code === "account_conflict" || e.code === "quote_unavailable" || e.code === "unsupported_quote" ? "BAD_REQUEST" : "PRECONDITION_FAILED", message: e.message });
  if (e instanceof AccountIndexUnavailable) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: e.message + ". Inténtalo de nuevo en unos minutos." });
  if (e instanceof ConnectGatewayError) throw new TRPCError({ code: "BAD_GATEWAY", message: "Stripe no ha podido completar la operación. Inténtalo de nuevo en unos minutos." });
  throw e;
}

/** ¿Puede esta empresa cobrar en línea con Stripe ahora? Solo un sí/no; nunca rompe la página del presupuesto. */
export async function stripeAvailableForPublic(): Promise<boolean> {
  if (!isMultiTenant()) return false;
  const { config } = connectConfigState();
  if (!config) return false;
  try {
    return await onlineAvailable({ store: mysqlPaymentStore(), config });
  } catch {
    return false;
  }
}

/** Crea la sesión de pago en la cuenta de la empresa para el presupuesto del enlace y devuelve la dirección de Stripe. */
export async function stripeCheckoutForToken(token: string): Promise<{ url: string }> {
  if (!isMultiTenant()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Los cobros por empresa solo están disponibles en el modo multiempresa" });
  const { config, problem } = connectConfigState();
  if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: problem ?? "Los cobros con Stripe no están configurados" });
  const base = getTrustedBaseUrl();
  try {
    const r = await startQuoteCheckout(realPaymentsDeps(getTenantIdOrDefault(), config), {
      token,
      successUrl: `${base}/presupuesto/${token}?stripe=volver`,
      cancelUrl: `${base}/presupuesto/${token}?stripe=cancelado`,
    });
    return { url: r.url };
  } catch (e) {
    return translatePaymentsError(e);
  }
}

/** Crea la sesión de pago del pedido de la tienda (ya creado, con sus reservas pendientes) y devuelve la dirección de Stripe. */
export async function stripeCheckoutForShopOrder(p: { merchantOrder: string; amountCents: number; description: string; email?: string | null }): Promise<{ url: string }> {
  if (!isMultiTenant()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Los cobros por empresa solo están disponibles en el modo multiempresa" });
  const { config, problem } = connectConfigState();
  if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: problem ?? "Los cobros con Stripe no están configurados" });
  const base = getTrustedBaseUrl();
  try {
    const r = await startShopCheckout(realPaymentsDeps(getTenantIdOrDefault(), config), {
      ...p,
      successUrl: `${base}/reserva/ok?order=${p.merchantOrder}`,
      cancelUrl: `${base}/reserva/error?order=${p.merchantOrder}`,
    });
    return { url: r.url };
  } catch (e) {
    return translatePaymentsError(e);
  }
}
