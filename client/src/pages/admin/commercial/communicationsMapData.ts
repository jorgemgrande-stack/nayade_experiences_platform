/**
 * Catálogo de plantillas del sistema que muestra «Mapa de comunicaciones». Aquí solo viven los datos que no son texto
 * (claves, función que genera el HTML, a quién se envía); los nombres, disparadores y notas están en
 * shared/i18n/locales/<idioma>/commMap.ts bajo `commMap.tpl.<clave>`.
 */
import { AlertTriangle, Calendar, CreditCard, FileText, Gift, ShieldCheck, Users, Utensils, Wrench } from "lucide-react";
import type { ElementType } from "react";
import type { Tone } from "@/components/admin/PanelUi";

export type TemplateEntry = {
  key: string;
  function: string;
  sendToCustomer: boolean;
  sendToAdmin: boolean;
  reminderCount?: number;
  hasNotes?: boolean;
  status: "active" | "inactive" | "manual_only";
};

export type CategoryEntry = { id: string; icon: ElementType; tone: Tone; templates: TemplateEntry[] };

const t = (key: string, fn: string, c: boolean, a: boolean, extra: Partial<TemplateEntry> = {}): TemplateEntry =>
  ({ key, function: fn, sendToCustomer: c, sendToAdmin: a, status: "active", ...extra });

export const CATALOG: CategoryEntry[] = [
  { id: "leads", icon: Users, tone: "info", templates: [
    t("budget_request_user", "buildBudgetRequestUserHtml", true, false),
    t("budget_request_admin", "buildBudgetRequestAdminHtml", false, true),
  ] },
  { id: "presupuestos", icon: FileText, tone: "brand", templates: [
    t("quote", "buildQuoteHtml", true, false, { reminderCount: 2, hasNotes: true }),
    t("commercial_reminder_1", "buildCommercialReminder1Html", true, false),
    t("commercial_reminder_2", "buildCommercialReminder2Html", true, false),
    t("commercial_reminder_3", "buildCommercialReminder3Html", true, false),
    t("proposal", "buildProposalHtml", true, false),
  ] },
  { id: "reservas", icon: Calendar, tone: "success", templates: [
    t("reservation_confirm", "buildReservationConfirmHtml", true, true),
    t("reservation_failed", "buildReservationFailedHtml", true, false),
    t("confirmation", "buildConfirmationHtml", true, false),
  ] },
  { id: "pagos", icon: CreditCard, tone: "warning", templates: [
    t("pending_payment", "buildPendingPaymentHtml", true, false, { reminderCount: 1 }),
    t("pending_payment_reminder", "buildPendingPaymentReminderHtml", true, false),
    t("transfer_confirmation", "buildTransferConfirmationHtml", true, false),
    t("installment_reminder", "buildInstallmentReminderHtml", true, false),
  ] },
  { id: "anulaciones", icon: AlertTriangle, tone: "danger", templates: [
    t("cancellation_received", "buildCancellationReceivedHtml", true, true),
    t("cancellation_rejected", "buildCancellationRejectedHtml", true, false),
    t("cancellation_accepted_refund", "buildCancellationAcceptedRefundHtml", true, false),
    t("cancellation_accepted_voucher", "buildCancellationAcceptedVoucherHtml", true, false),
    t("cancellation_documentation", "buildCancellationDocumentationHtml", true, false),
    t("cancellation_refund_executed", "buildCancellationRefundExecutedHtml", true, false),
  ] },
  { id: "cupones", icon: Gift, tone: "info", templates: [
    t("coupon_received", "buildCouponRedemptionReceivedHtml", true, true),
    t("coupon_postponed", "buildCouponPostponedHtml", true, false),
    t("coupon_internal_alert", "buildCouponInternalAlertHtml", false, true),
  ] },
  { id: "restaurantes", icon: Utensils, tone: "brand", templates: [
    t("restaurant_confirm", "buildRestaurantConfirmHtml", true, true),
    t("restaurant_payment_link", "buildRestaurantPaymentLinkHtml", true, false),
  ] },
  { id: "operaciones", icon: Wrench, tone: "neutral", templates: [
    t("tpv_ticket", "buildTpvTicketHtml", true, false),
    t("cash_open", "buildCashOpenHtml", false, true),
    t("cash_close", "buildCashCloseHtml", false, true),
  ] },
  { id: "administracion", icon: ShieldCheck, tone: "success", templates: [
    t("invite", "buildInviteHtml", false, false, { hasNotes: true }),
    t("password_reset", "buildPasswordResetHtml", false, false, { hasNotes: true }),
  ] },
];
