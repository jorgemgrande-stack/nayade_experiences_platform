/**
 * Plantillas de email del sistema → capacidad que las usa. En el panel de cada empresa con licencias por
 * capacidad solo se listan (y se envían como prueba) las de las funciones que tiene; las de sistema (invitación,
 * contraseña) y las personalizadas, siempre.
 */
export const EMAIL_TEMPLATE_CAPABILITY: Record<string, string> = {
  reservation_confirm: "shop-orders",
  reservation_failed: "shop-orders",
  confirmation: "shop-orders",
  transfer_confirmation: "shop-orders",
  cancellation_received: "shop-orders",
  cancellation_rejected: "shop-orders",
  cancellation_accepted_refund: "shop-orders",
  cancellation_accepted_voucher: "shop-orders",
  cancellation_documentation: "shop-orders",
  cancellation_refund_executed: "shop-orders",
  restaurant_confirm: "restaurant-net",
  restaurant_payment_link: "restaurant-net",
  budget_request_user: "crm-quotes",
  budget_request_admin: "crm-quotes",
  quote: "crm-quotes",
  proposal: "crm-quotes",
  installment_reminder: "crm-quotes",
  commercial_reminder_1: "crm-tasks",
  commercial_reminder_2: "crm-tasks",
  commercial_reminder_3: "crm-tasks",
  pending_payment: "bill-payments",
  pending_payment_reminder: "bill-payments",
  tpv_ticket: "bill-cash",
  cash_open: "bill-cash",
  cash_close: "bill-cash",
  coupon_received: "deals-coupons",
  coupon_postponed: "deals-coupons",
  coupon_internal_alert: "deals-coupons",
};

/** Plantillas visibles según las capacidades de la empresa (`can`: sin licencias por capacidad, todo visible). */
export function templatesForCapabilities<T extends { id: string }>(rows: T[], can: (capabilityId: string) => boolean): T[] {
  return rows.filter((r) => {
    const cap = EMAIL_TEMPLATE_CAPABILITY[r.id];
    return !cap || can(cap);
  });
}
