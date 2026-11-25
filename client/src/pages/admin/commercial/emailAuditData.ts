/**
 * Datos de la «Auditoría de plantillas de correo» (solo lectura). Los textos (nombre y disparador de cada plantilla,
 * notas) están en shared/i18n/locales/<idioma>/emailAudit.ts y commMap.ts; aquí solo hay claves y banderas.
 */
export type AuditStatus = "ok" | "warning" | "unknown";
export type Recipient = "client" | "admin" | "both" | "user";
export type TriggerType = "event" | "cron" | "manual" | "unknown";

export interface AuditEntry {
  id: string;
  /** Clave de categoría (commMap.cat.<id>). */
  category: string;
  functionName: string;
  triggerType: TriggerType;
  recipient: Recipient;
  isCronDriven: boolean;
  cronAutomation?: boolean;
  status: AuditStatus;
  hasNote?: boolean;
}

const e = (id: string, category: string, functionName: string, triggerType: TriggerType, recipient: Recipient, extra: Partial<AuditEntry> = {}): AuditEntry =>
  ({ id, category, functionName, triggerType, recipient, isCronDriven: false, status: "ok", ...extra });

const REM = { isCronDriven: true, cronAutomation: true } as const;

export const AUDIT_DATA: AuditEntry[] = [
  e("budget_request_user", "leads", "buildBudgetRequestUserHtml", "event", "client"),
  e("budget_request_admin", "leads", "buildBudgetRequestAdminHtml", "event", "admin"),
  e("quote", "presupuestos", "buildQuoteHtml", "event", "client", { isCronDriven: true, hasNote: true }),
  e("proposal", "presupuestos", "buildProposalHtml", "manual", "client"),
  e("commercial_reminder_1", "presupuestos", "buildCommercialReminder1Html", "cron", "client", REM),
  e("commercial_reminder_2", "presupuestos", "buildCommercialReminder2Html", "cron", "client", REM),
  e("commercial_reminder_3", "presupuestos", "buildCommercialReminder3Html", "cron", "client", REM),
  e("reservation_confirm", "reservas", "buildReservationConfirmHtml", "event", "client"),
  e("reservation_failed", "reservas", "buildReservationFailedHtml", "event", "client"),
  e("confirmation", "reservas", "buildConfirmationHtml", "event", "client"),
  e("transfer_confirmation", "pagos", "buildTransferConfirmationHtml", "event", "admin"),
  e("pending_payment", "pagos", "buildPendingPaymentHtml", "event", "client"),
  e("pending_payment_reminder", "pagos", "buildPendingPaymentReminderHtml", "event", "client"),
  e("installment_reminder", "pagos", "buildInstallmentReminderHtml", "event", "client"),
  e("cancellation_received", "anulaciones", "buildCancellationReceivedHtml", "event", "client"),
  e("cancellation_rejected", "anulaciones", "buildCancellationRejectedHtml", "event", "client"),
  e("cancellation_accepted_refund", "anulaciones", "buildCancellationAcceptedRefundHtml", "event", "client"),
  e("cancellation_accepted_voucher", "anulaciones", "buildCancellationAcceptedVoucherHtml", "event", "client"),
  e("cancellation_documentation", "anulaciones", "buildCancellationDocumentationHtml", "unknown", "client", { status: "warning", hasNote: true }),
  e("cancellation_refund_executed", "anulaciones", "buildCancellationRefundExecutedHtml", "event", "client"),
  e("coupon_received", "cupones", "buildCouponRedemptionReceivedHtml", "event", "both"),
  e("coupon_postponed", "cupones", "buildCouponPostponedHtml", "event", "client"),
  e("coupon_internal_alert", "cupones", "buildCouponInternalAlertHtml", "event", "admin"),
  e("restaurant_confirm", "restaurantes", "buildRestaurantConfirmHtml", "event", "client"),
  e("restaurant_payment_link", "restaurantes", "buildRestaurantPaymentLinkHtml", "event", "client"),
  e("tpv_ticket", "operaciones", "buildTpvTicketHtml", "event", "admin"),
  e("cash_open", "operaciones", "buildCashOpenHtml", "event", "admin"),
  e("cash_close", "operaciones", "buildCashCloseHtml", "event", "admin"),
  e("invite", "administracion", "buildInviteHtml", "event", "user"),
  e("password_reset", "administracion", "buildPasswordResetHtml", "event", "user"),
];

export const AUDIT_CATEGORIES = Array.from(new Set(AUDIT_DATA.map((x) => x.category)));
