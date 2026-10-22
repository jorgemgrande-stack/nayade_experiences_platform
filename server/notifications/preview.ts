/**
 * Vista previa de las comunicaciones con DATOS FICTICIOS (empresa, host y referencias de ejemplo). Usa la plantilla
 * REAL de cada aviso: el `render` del catálogo (avisos `active`) o la plantilla que usa su notificador (avisos
 * `legacy`). No envía nada, no lee la base de datos y no contiene datos de ningún cliente.
 *
 * Sin vista previa: los avisos que envía Stripe (`sentBy: stripe`) y los contratos sin disparador (`contract`).
 */
import { passwordChangedContent } from "../mail/securityTemplates";
import { EXPORT_PANEL_PATH, exportFailedContent, exportReadyContent } from "../mail/exportTemplates";
import { platformTemplates } from "../mail/templates";
import type { MailContent } from "../mail/types";
import { TEMPLATE_CATALOG, type TemplateSpec, type Vars } from "./catalog";

const DAY = 86_400_000;
/** Momento fijo de las vistas previas (fechas estables): 21/10/2026 10:00, hora de Madrid. */
export const PREVIEW_NOW = Date.UTC(2026, 9, 21, 8, 0, 0);
const HOST = "hotel-ejemplo.app.bigelephant.example";
const SAMPLE: Vars = {
  reference: "PED-2026-0042",
  host: HOST,
  plan: "Business",
  direction: "upgrade",
  effectiveFrom: PREVIEW_NOW + 2 * DAY,
  effectiveTo: PREVIEW_NOW + 30 * DAY,
  readOnlyUntil: PREVIEW_NOW + 30 * DAY,
  productName: "Hotel Net · PMS",
  metric: "users",
  quantity: 8,
  amountCents: 2900,
  currency: "EUR",
  full: false,
  paymentUrl: `https://${HOST}/admin/suscripcion`,
  documentNumber: "R-2026-0007",
  at: PREVIEW_NOW,
  approximateLocation: "Madrid (España)",
  enabled: true,
};
const SUPPORT = "soporte@bigelephant.es";
const PRICING = "https://www.bigelephant.example/precios";

/** Plantilla real de cada aviso `legacy` (la que usa su notificador), con datos ficticios. */
const LEGACY: Record<string, () => MailContent> = (() => {
  const t = platformTemplates({ supportEmail: SUPPORT });
  const order = { reference: "PED-2026-0042" };
  return {
    "trial.verification": () => t.emailVerification({ verifyUrl: "https://www.bigelephant.example/prueba-gratuita/verificar?muestra=1" }),
    "trial.started": () => t.trialActivated({ host: HOST, setPasswordUrl: `https://${HOST}/establecer-contrasena?muestra=1`, endsAt: PREVIEW_NOW + 15 * DAY }),
    "trial.reminder": () => t.trialExpiry({ endsAt: PREVIEW_NOW + 7 * DAY, daysLeft: 7, pricingUrl: PRICING }),
    "trial.ended": () => t.trialExpiry({ endsAt: PREVIEW_NOW, daysLeft: 0, pricingUrl: PRICING }),
    "trial.extended": () => t.trialStatus({ kind: "extended", endsAt: PREVIEW_NOW + 20 * DAY, host: HOST }),
    "trial.suspended": () => t.trialStatus({ kind: "suspended", endsAt: null, host: HOST }),
    "trial.reactivated": () => t.trialStatus({ kind: "reactivated", endsAt: PREVIEW_NOW + 10 * DAY, host: HOST }),
    "subscription.signup_received": () => t.signupReceived({ companyName: "Hotel Ejemplo, S.L.", ...order, test: false }),
    "subscription.contract_confirmed": () => t.contractConfirmed({ companyName: "Hotel Ejemplo, S.L.", ...order, host: HOST }),
    "subscription.initial_payment": () => t.paymentConfirmed({ ...order, amountCents: 2900, currency: "EUR" }),
    "subscription.renewal_paid": () => t.renewalConfirmed({ ...order, amountCents: 2900, currency: "EUR", periodStart: PREVIEW_NOW, host: HOST, test: false }),
    "subscription.payment_failed": () => t.paymentFailed({ ...order, graceEndsAt: PREVIEW_NOW + 7 * DAY, host: HOST }),
    "subscription.recovered": () => t.subscriptionReactivated({ ...order, reason: "payment_recovered", host: HOST }),
    "subscription.cancellation": () => t.cancellation({ ...order, cancelAt: PREVIEW_NOW + 20 * DAY }),
    "billing.invoice_available": () => t.invoiceAvailable({ ...order, invoiceRef: "in_ejemplo_0042", amountCents: 2900, currency: "EUR", test: false }),
    "support.ticket_received": () => t.supportTicket({ kind: "received", ticketRef: "SOP-0137", subject: "No veo las reservas de ayer" }),
    "support.ticket_replied": () => t.supportTicket({ kind: "replied", ticketRef: "SOP-0137", subject: "No veo las reservas de ayer" }),
    "support.ticket_resolved": () => t.supportTicket({ kind: "resolved", ticketRef: "SOP-0137", subject: "No veo las reservas de ayer" }),
    "support.ticket_reopened": () => t.supportTicket({ kind: "reopened", ticketRef: "SOP-0137", subject: "No veo las reservas de ayer" }),
    "consumer.withdrawal_receipt": () => t.withdrawalReceipt({ reference: "DS-20261021-AB12CD", requestedAt: PREVIEW_NOW, withinTerm: true, deadlineAt: PREVIEW_NOW + 10 * DAY }),
    "consumer.withdrawal_resolution": () => t.withdrawalResolution({ reference: "DS-20261021-AB12CD", status: "accepted", note: "Reembolsaremos la parte no consumida por el mismo medio de pago." }),
    "ops.incident": () => t.opsNotice({ title: "Incidencia crítica: fallos de envío de correo repetidos", lines: ["Tipo: rate.mail.send_failed · 5 fallos en 15 minutos.", "Abierta el 21/10/2026 a las 10:00 (hora de Madrid)."] }),
    "ops.new_customer": () => t.opsNotice({ title: "Nuevo cliente activado", lines: ["Empresa: Hotel Ejemplo, S.L. · Pedido PED-2026-0042 · Plan Essential mensual."] }),
    "ops.withdrawal_requested": () => t.opsNotice({ title: "Solicitud de desistimiento", lines: ["Referencia DS-20261021-AB12CD · dentro de plazo. Revísala en Atención al cliente → Desistimientos."] }),
    "ops.ticket_created": () => t.opsNotice({ title: "Nuevo ticket de soporte", lines: ["SOP-0137 · «No veo las reservas de ayer»."] }),
    "security.password_changed": () => passwordChangedContent("Hotel Ejemplo", "Ana", new Date(PREVIEW_NOW)),
    "data.export_ready": () => exportReadyContent("Hotel Ejemplo", { name: "Ana", tables: 84, rows: 15230, files: 312, warning: null, expiresAt: PREVIEW_NOW + DAY, panelUrl: `https://${HOST}${EXPORT_PANEL_PATH}` }),
    "data.export_failed": () => exportFailedContent("Hotel Ejemplo", { name: "Ana", reason: "No se pudo generar la exportación. Inténtalo de nuevo o contacta con soporte.", panelUrl: `https://${HOST}${EXPORT_PANEL_PATH}` }),
  };
})();

export interface Preview {
  id: string;
  subject: string;
  html: string;
  text: string;
  /** Siempre `true`: datos ficticios, nunca un envío real. */
  sample: true;
}

/** ¿Tiene vista previa? (lo envía Elephant y existe su plantilla). */
export const hasPreview = (t: TemplateSpec) => t.sentBy !== "stripe" && (!!t.render || !!LEGACY[t.id]);

/** Vista previa de un aviso del catálogo, o `null` si no la tiene. */
export function previewTemplate(id: string): Preview | null {
  const t = TEMPLATE_CATALOG.find((x) => x.id === id);
  if (!t || !hasPreview(t)) return null;
  const c = t.render ? t.render(Object.fromEntries(t.variables.map((k) => [k, SAMPLE[k] ?? null])), { supportEmail: SUPPORT }) : LEGACY[t.id]();
  return { id, subject: c.subject, html: c.html, text: c.text ?? "", sample: true };
}

/** Todas las vistas previas, en el orden del catálogo. */
export const allPreviews = (): Preview[] => TEMPLATE_CATALOG.filter(hasPreview).map((t) => previewTemplate(t.id)!);
