/**
 * Configuración del Customer Portal de Stripe: la DESEADA para que los clientes gestionen su suscripción y la
 * diferencia con la actual. Solo lectura: aplicar la configuración en Stripe live es una operación que
 * autoriza el propietario (la hace una persona o, con su aprobación, el MCP), como el catálogo.
 *
 * Deseado (decisión del propietario, 21/10/2026: portal SOLO de consulta para la persona propietaria; ver
 * ./billingPortal.ts, que además rechaza en cada apertura una configuración que no lo cumpla):
 *  - historial de facturas y actualización del método de pago: sí;
 *  - cancelación: NO (se cancela por soporte);
 *  - cambio de plan o periodicidad: NO (sin cobros ni prorrateos desde el portal);
 *  - edición de datos de facturación: NO hasta decidir cómo se rectifican (D-10);
 *  - URL de condiciones y privacidad: las publicadas (CP_TERMS_URL, CP_PRIVACY_URL); sin ellas, pendientes.
 */
import type { StripePriceLink } from "./store";

export interface GwPortalConfig {
  id: string;
  isDefault: boolean;
  active: boolean;
  invoiceHistory: boolean;
  paymentMethodUpdate: boolean;
  customerUpdate: { enabled: boolean; allowedUpdates: string[] };
  cancel: { enabled: boolean; mode: string | null; prorationBehavior: string | null };
  update: { enabled: boolean; defaultAllowedUpdates: string[]; products: Array<{ product: string; prices: string[] }>; prorationBehavior: string | null; scheduleAtPeriodEnd: string[] };
  termsUrl: string | null;
  privacyUrl: string | null;
}

export interface PortalDifference {
  field: string;
  current: unknown;
  desired: unknown;
  /** Bloqueada por una decisión pendiente (no se propone aplicarla todavía). */
  pending?: string;
}

const sorted = <T>(a: T[]) => [...a].sort();
const sameSet = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** Productos y precios que el Portal debe ofrecer: los enlazados y activos, agrupados por producto de Stripe. */
export function portalProducts(prices: StripePriceLink[]): Array<{ product: string; prices: string[] }> {
  const by = new Map<string, string[]>();
  for (const p of prices.filter((x) => x.status === "active")) by.set(p.stripeProductId, [...(by.get(p.stripeProductId) ?? []), p.stripePriceId]);
  return Array.from(by.entries())
    .map(([product, ps]) => ({ product, prices: sorted(ps) }))
    .sort((a, b) => (a.product < b.product ? -1 : a.product > b.product ? 1 : 0));
}

/** Diferencias entre la configuración por defecto actual y la deseada. Vacío: nada que cambiar. */
export function planPortal(current: GwPortalConfig | null, d: { prices: StripePriceLink[]; termsUrl: string | null; privacyUrl: string | null }): PortalDifference[] {
  const out: PortalDifference[] = [];
  if (!current) return [{ field: "configuration", current: null, desired: "configuración por defecto activa" }];
  const want = (field: string, cur: unknown, desired: unknown, equal: boolean, pending?: string) => {
    if (!equal) out.push({ field, current: cur, desired, ...(pending ? { pending } : {}) });
  };
  want("active", current.active, true, current.active);
  want("features.invoice_history.enabled", current.invoiceHistory, true, current.invoiceHistory);
  want("features.payment_method_update.enabled", current.paymentMethodUpdate, true, current.paymentMethodUpdate);
  want("features.subscription_cancel.enabled", current.cancel.enabled, false, !current.cancel.enabled);
  want("features.subscription_update.enabled", current.update.enabled, false, !current.update.enabled);
  // Datos de facturación: se mantiene desactivado hasta decidir las rectificativas (D-10)
  want("features.customer_update.enabled", current.customerUpdate.enabled, false, !current.customerUpdate.enabled);
  want("business_profile.terms_of_service_url", current.termsUrl, d.termsUrl ?? "(pendiente: textos legales)", current.termsUrl === d.termsUrl && !!d.termsUrl, d.termsUrl ? undefined : "textos legales sin publicar");
  want("business_profile.privacy_policy_url", current.privacyUrl, d.privacyUrl ?? "(pendiente: textos legales)", current.privacyUrl === d.privacyUrl && !!d.privacyUrl, d.privacyUrl ? undefined : "textos legales sin publicar");
  return out;
}

/** Parámetros para `POST /v1/billing_portal/configurations/{id}` con lo que NO está pendiente (para la persona que lo aplique). */
export function portalWriteParams(diff: PortalDifference[], d: { prices?: StripePriceLink[]; termsUrl: string | null; privacyUrl: string | null }): Record<string, unknown> | null {
  if (!diff.some((x) => !x.pending)) return null;
  return {
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
      customer_update: { enabled: false },
    },
    ...(d.termsUrl || d.privacyUrl ? { business_profile: { ...(d.termsUrl ? { terms_of_service_url: d.termsUrl } : {}), ...(d.privacyUrl ? { privacy_policy_url: d.privacyUrl } : {}) } } : {}),
  };
}
