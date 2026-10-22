/**
 * Catálogo de comunicaciones transaccionales de Elephant Source (fase G). Cada plantilla tiene un id ESTABLE, una
 * versión, su disparador, su destinatario, las ÚNICAS variables que puede usar, cuándo se envía y cuándo se
 * suprime, y su clave de idempotencia. Tres estados:
 *
 *  - `active`: la envía el despachador de eventos comerciales (./dispatcher.ts) por la bandeja de salida.
 *  - `legacy`: ya la envía un notificador existente (orquestador, prueba gratuita, alta asistida). Se documenta
 *    aquí y NO se duplica.
 *  - `contract`: contrato del evento (soporte, seguridad, avisos sin evento propio todavía). Definida y probada su
 *    forma; no se envía hasta que exista su disparador.
 *
 * Reglas comunes: solo transaccional (nunca comercial: no hay plantillas de marketing y el despachador rechaza
 * cualquier otra audiencia); sin secretos, enlaces de recuperación ni invitaciones en ninguna plantilla de este
 * catálogo; enlaces solo a la propia plataforma (https); `MAIL_MODE` decide si sale algo (off: nada).
 */
import { PLATFORM_BRAND, platformIdentity } from "../mail/policy";
import { layout } from "../mail/templates";
import type { MailCategory, MailContent } from "../mail/types";
import type { CommercialEventType } from "../commercialEvents/types";

export type TemplateStatus = "active" | "legacy" | "contract";
export type Recipient = "billing_contact" | "trial_requester" | "ticket_requester" | "account_user" | "consumer" | "ops_team";
export type Vars = Record<string, string | number | boolean | null>;

export interface TemplateSpec {
  id: string;
  version: number;
  group: "trial" | "subscription" | "module" | "billing" | "support" | "security" | "data";
  status: TemplateStatus;
  /** Solo transaccional: el despachador rechaza cualquier otra cosa. */
  audience: "transactional";
  trigger: string;
  /** Eventos comerciales que la disparan (solo `active`). */
  events?: CommercialEventType[];
  recipient: Recipient;
  category: MailCategory;
  variables: readonly string[];
  sendWhen: string;
  suppressWhen: string;
  /** Patrón de la clave de idempotencia (una por plantilla, versión y evento). */
  idempotency: string;
  /**
   * Quién envía el aviso. `stripe`: lo envía Stripe con su configuración de correos al cliente y Elephant NO lo
   * duplica (se documenta aquí para que el catálogo sea completo). Por defecto, Elephant.
   */
  sentBy?: "elephant" | "stripe";
  render?: (v: Vars, o: { supportEmail: string | null }) => MailContent;
}

const brand = (supportEmail: string | null) => ({ name: PLATFORM_BRAND, supportEmail, ...platformIdentity() });
const panel = (host: unknown, path = "/admin/suscripcion") => (typeof host === "string" && host ? { label: "Ver mi suscripción", url: `https://${host}${path}` } : null);
const date = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }) : "el fin del periodo en curso");
const money = (cents: unknown, currency: unknown) =>
  typeof cents === "number" ? new Intl.NumberFormat("es-ES", { style: "currency", currency: typeof currency === "string" ? currency : "EUR" }).format(cents / 100) : "";
const ref = (v: Vars) => (v.reference ? ` (${v.reference})` : "");
const METRIC: Record<string, string> = { users: "usuarios", sites: "sedes", storage_gb: "GB de almacenamiento" };
const metric = (m: unknown) => METRIC[String(m)] ?? "unidades";
/** Texto de una variable, o el de respaldo si falta (nunca «undefined» ni «null»). */
const txt = (v: unknown, fallback: string) => (v === null || v === undefined || v === "" ? fallback : String(v));
const EVENT_KEY = "notif:<id>:v<versión>:<clave del evento comercial>";

const legacy = (id: string, group: TemplateSpec["group"], category: MailCategory, trigger: string, recipient: Recipient, sendWhen: string, idempotency: string): TemplateSpec => ({
  id, version: 1, group, status: "legacy", audience: "transactional", trigger, recipient, category, variables: [], sendWhen, suppressWhen: "MAIL_MODE=off, destinatario suprimido o límite de envío (bandeja de salida)", idempotency,
});
const contract = (id: string, group: TemplateSpec["group"], category: MailCategory, trigger: string, recipient: Recipient, variables: string[], sendWhen: string): TemplateSpec => ({
  id, version: 1, group, status: "contract", audience: "transactional", trigger, recipient, category, variables, sendWhen, suppressWhen: "Aún sin disparador: no se envía", idempotency: EVENT_KEY,
});

/** Aviso que envía Stripe (configuración de correos al cliente en el Dashboard): Elephant no lo duplica. */
const stripe = (id: string, group: TemplateSpec["group"], category: MailCategory, trigger: string, sendWhen: string): TemplateSpec => ({
  ...legacy(id, group, category, trigger, "billing_contact", sendWhen, "Stripe (sin bandeja de Elephant)"),
  sentBy: "stripe",
});

export const TEMPLATE_CATALOG: readonly TemplateSpec[] = [
  // ── Pruebas gratuitas ──
  legacy("trial.verification", "trial", "email_verification", "Alta de la prueba (TrialNotifier.verification)", "trial_requester", "Al solicitar la prueba o reenviar la verificación", "trial:<id>:verification:<hash del token>"),
  legacy("trial.started", "trial", "trial_activated", "Prueba activada (TrialNotifier.welcome): bienvenida con fecha de fin", "trial_requester", "Al aprovisionar la plataforma de la prueba", "trial-welcome:<tenant>:<hash>"),
  legacy("trial.reminder", "trial", "trial_expiry", "Motor temporal (D-16): 7, 3 y 1 días antes del fin", "trial_requester", "En cada umbral; con activación tardía solo el más cercano", "trial:<id>:expiry:<fin>:<días>"),
  // El fin de la prueba lo cubre el aviso de vencimiento con 0 días (TrialNotifier.expiryNotice): un único correo
  legacy("trial.ended", "trial", "trial_expiry", "Motor temporal: aviso de vencimiento con 0 días (TrialNotifier.expiryNotice, plantilla trialExpiry)", "trial_requester", "Al vencer la prueba sin convertir (solo lectura; sin conversión automática)", "trial:<id>:expiry:<fin>:0"),
  // ── Suscripción ──
  legacy("subscription.signup_received", "subscription", "signup_received", "Pedido firmado en la web (orderNotifier: sign web-terms)", "billing_contact", "Al aceptar las condiciones en la contratación en línea", "order:<id>:sign:<versión>"),
  legacy("subscription.contract_confirmed", "subscription", "contract_confirmed", "Pedido activado (orderNotifier: activate)", "billing_contact", "Al activar el pedido", "order:<id>:activate:<versión>"),
  legacy("subscription.initial_payment", "subscription", "payment_confirmed", "Pago inicial verificado (orderNotifier: confirm basis=payment)", "billing_contact", "Al confirmar el pedido por pago (texto de prueba fuera de live)", "order:<id>:confirm:<versión>"),
  legacy("subscription.renewal_paid", "subscription", "renewal_confirmed", "Renovación mensual o anual cobrada (orderNotifier: payment_recorded)", "billing_contact", "Por cada cobro de renovación verificado", "order:<id>:renewal_confirmed:p<pago>"),
  legacy("subscription.payment_failed", "subscription", "payment_failed", "Impago (orderNotifier: payment_failed); día 0 de la gracia (D-15)", "billing_contact", "Al entrar en gracia", "order:<id>:payment_failed:<versión>"),
  legacy("subscription.recovered", "subscription", "subscription_reactivated", "Cobro recuperado o baja deshecha (orderNotifier)", "billing_contact", "Al recuperar el cobro o deshacer la baja", "order:<id>:<acción>:<versión>"),
  legacy("subscription.cancellation", "subscription", "cancellation", "Baja programada (orderNotifier: cancel)", "billing_contact", "Al programar la baja", "order:<id>:cancel:<versión>"),
  stripe("subscription.payment_action_required", "subscription", "payment_failed", "invoice.payment_action_required: Stripe envía el enlace para autenticar el pago (3DS)", "Settings → Customer emails → «Send a reminder email when a payment requires 3D Secure»"),
  stripe("subscription.dunning_reminder", "subscription", "payment_failed", "Reintentos de Stripe (Smart Retries): Stripe avisa de cada intento fallido; Elephant solo avisa el día 0", "Settings → Customer emails → «Send emails when card payments fail» y reintentos de Billing"),
  stripe("billing.invoice_document", "billing", "invoice_available", "Factura y recibo de Stripe (PDF): los envía Stripe; Elephant solo avisa de que está disponible", "Settings → Customer emails → «Successful payments» y «Finalized invoices»"),
  {
    id: "subscription.suspended",
    version: 1,
    group: "subscription",
    status: "active",
    audience: "transactional",
    trigger: "Pedido suspendido (gracia vencida o cobro revertido)",
    events: ["order.suspended"],
    recipient: "billing_contact",
    category: "subscription_suspended",
    variables: ["reference", "host"],
    sendWhen: "Al suspender el pedido",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación; destinatario suprimido",
    idempotency: EVENT_KEY,
    render: (v, o) => layout(brand(o.supportEmail), "Tu suscripción está suspendida", [`Hemos suspendido el acceso de tu suscripción${ref(v)} porque el cobro no se ha completado.`, "Tus datos se conservan. En cuanto se regularice el pago, el acceso vuelve a activarse."], panel(v.host)),
  },
  {
    id: "subscription.plan_changed",
    version: 1,
    group: "subscription",
    status: "active",
    audience: "transactional",
    trigger: "Cambio de plan aplicado a la suscripción",
    events: ["subscription.plan_changed"],
    recipient: "billing_contact",
    category: "plan_changed",
    variables: ["plan", "direction", "effectiveFrom", "host"],
    sendWhen: "Al registrar el cambio de plan (subida inmediata; bajada a fin de periodo)",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) =>
      layout(brand(o.supportEmail), "Hemos cambiado tu plan", [v.direction === "down" ? `Tu plan pasará a ${txt(v.plan, "el nuevo plan")} a partir del ${date(v.effectiveFrom)}. Hasta entonces mantienes el actual.` : `Tu plan ya es ${txt(v.plan, "el nuevo plan")}.`], panel(v.host)),
  },
  {
    id: "subscription.ended",
    version: 1,
    group: "subscription",
    status: "active",
    audience: "transactional",
    trigger: "Fin efectivo de la suscripción (pedido cancelado)",
    events: ["order.cancelled"],
    recipient: "billing_contact",
    category: "subscription_ended",
    variables: ["reference", "host"],
    sendWhen: "Al terminar el periodo pagado de una suscripción dada de baja",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) =>
      layout(brand(o.supportEmail), "Tu suscripción ha terminado", [`La suscripción${ref(v)} ha llegado a su fin.`, "Durante los próximos 30 días puedes consultar tus datos y exportarlos en solo lectura. No borramos nada automáticamente."], panel(v.host)),
  },
  {
    id: "access.read_only_started",
    version: 1,
    group: "subscription",
    status: "active",
    audience: "transactional",
    trigger: "Empieza el periodo de solo lectura (30 días tras el fin)",
    events: ["access.read_only_started"],
    recipient: "billing_contact",
    category: "access_read_only",
    variables: ["readOnlyUntil", "host"],
    sendWhen: "Al pasar las licencias a solo lectura",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) =>
      layout(brand(o.supportEmail), "Tu cuenta está en solo lectura", [`Hasta el ${date(v.readOnlyUntil)} puedes consultar y exportar tus datos (ZIP con CSV, JSON y ficheros) desde el panel.`, "Para volver a usarla con normalidad, reactiva tu suscripción."], panel(v.host)),
  },
  {
    id: "access.read_only_ended",
    version: 1,
    group: "subscription",
    status: "active",
    audience: "transactional",
    trigger: "Termina el periodo de solo lectura",
    events: ["access.read_only_ended"],
    recipient: "billing_contact",
    category: "access_read_only",
    variables: ["host"],
    sendWhen: "Al terminar los 30 días de solo lectura (la exportación sigue disponible hasta el archivado)",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) =>
      layout(
        brand(o.supportEmail),
        "Ha terminado el periodo de solo lectura",
        [
          "Han pasado los 30 días de solo lectura: tu cuenta ya no se puede usar con normalidad. Tus datos no se han borrado.",
          "Mientras la cuenta no se archive, la persona propietaria puede seguir descargando una exportación completa de sus datos desde el panel (Suscripción › Exportar mis datos). Te recomendamos hacerlo cuanto antes.",
          "Si quieres reactivar la cuenta, escríbenos.",
        ],
        panel(v.host, "/admin/suscripcion/exportar"),
      ),
  },
  // ── Módulos y ampliaciones ──
  contract("module.purchase_requested", "module", "module_change", "Compra enviada a Stripe con cobro pendiente (purchases.ts: payment_pending)", "billing_contact", ["productName", "paymentUrl"], "Si el cobro necesita autenticación o falló"),
  {
    id: "module.activated",
    version: 1,
    group: "module",
    status: "active",
    audience: "transactional",
    trigger: "Módulo añadido a la suscripción (tras cobro verificado o aprobación)",
    events: ["subscription.module_added"],
    recipient: "billing_contact",
    category: "module_activated",
    variables: ["productName", "host"],
    sendWhen: "Al añadir el módulo a la suscripción",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) => layout(brand(o.supportEmail), `${txt(v.productName, "Tu módulo")} ya está activo`, [`Hemos activado ${txt(v.productName, "el módulo")} en tu plataforma. El cargo proporcional de este periodo aparece en tu factura.`], panel(v.host)),
  },
  {
    id: "module.quantity_changed",
    version: 1,
    group: "module",
    status: "active",
    audience: "transactional",
    trigger: "Ampliación aplicada o reducción programada (usuarios, sedes, almacenamiento)",
    events: ["subscription.quantity_changed"],
    recipient: "billing_contact",
    category: "module_change",
    variables: ["metric", "quantity", "direction", "effectiveFrom", "host"],
    sendWhen: "Al cambiar la cantidad contratada",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) =>
      v.direction === "down"
        ? layout(brand(o.supportEmail), "Reducción programada", [`A partir del ${date(v.effectiveFrom)} tendrás contratadas ${txt(v.quantity, "menos")} unidades adicionales de ${metric(v.metric)}. Hasta entonces mantienes las actuales. No hay abonos por la parte del periodo ya pagada.`], panel(v.host))
        : layout(brand(o.supportEmail), "Ampliación aplicada", [`Ya tienes contratadas ${txt(v.quantity, "más")} unidades adicionales de ${metric(v.metric)}.`], panel(v.host)),
  },
  {
    id: "module.removal_scheduled",
    version: 1,
    group: "module",
    status: "active",
    audience: "transactional",
    trigger: "Baja de un módulo a fin de periodo",
    events: ["subscription.module_removed"],
    recipient: "billing_contact",
    category: "module_change",
    variables: ["productName", "effectiveTo", "host"],
    sendWhen: "Al programar la baja del módulo",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) => layout(brand(o.supportEmail), `Baja de ${txt(v.productName, "un módulo")} programada`, [`${txt(v.productName, "El módulo")} seguirá activo hasta el ${date(v.effectiveTo)} y no se renovará. Tus datos se conservan.`], panel(v.host)),
  },
  {
    id: "module.purchase_failed",
    version: 1,
    group: "module",
    status: "active",
    audience: "transactional",
    trigger: "Compra no completada (el cambio caducó sin cobro)",
    events: ["order.rejected"],
    recipient: "billing_contact",
    category: "module_change",
    variables: ["reference", "host"],
    sendWhen: "Solo si el pedido rechazado es una compra desde la plataforma",
    suppressWhen: "Otros rechazos; MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) => layout(brand(o.supportEmail), "No hemos podido completar tu compra", ["El pago no se completó a tiempo y no se ha hecho ningún cargo ni ningún cambio en tu suscripción. Puedes intentarlo de nuevo cuando quieras."], panel(v.host)),
  },
  contract("module.removal_effective", "module", "module_change", "Fin efectivo de la baja de un módulo (renovación)", "billing_contact", ["productName"], "En la renovación que aplica la baja"),
  // ── Facturación ──
  legacy("billing.invoice_available", "billing", "invoice_available", "Factura de Stripe cobrada (orderNotifier)", "billing_contact", "Por cada cobro verificado en Stripe", "order:<id>:invoice_available:p<pago>"),
  {
    id: "billing.refund_recorded",
    version: 1,
    group: "billing",
    status: "active",
    audience: "transactional",
    trigger: "Reembolso registrado en Stripe",
    events: ["refund.recorded"],
    recipient: "billing_contact",
    category: "refund_recorded",
    variables: ["amountCents", "currency", "full", "host"],
    sendWhen: "Por cada importe reembolsado nuevo",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) =>
      layout(brand(o.supportEmail), "Hemos registrado un reembolso", [`Se ha reembolsado ${money(v.amountCents, v.currency)}${v.full ? " (el importe completo del cobro)" : ""}. Lo verás en tu medio de pago en unos días.`, "La factura rectificativa la emite nuestro sistema de facturación."]),
  },
  contract("billing.credit_note", "billing", "refund_recorded", "Rectificativa emitida por el sistema de facturación aprobado", "billing_contact", ["documentNumber"], "Al registrar el número de la rectificativa"),
  {
    id: "billing.incident",
    version: 1,
    group: "billing",
    status: "active",
    audience: "transactional",
    trigger: "Cobro revertido (reembolso total o disputa perdida)",
    events: ["coverage.lost"],
    recipient: "billing_contact",
    category: "billing_incident",
    variables: ["host"],
    sendWhen: "Al perderse la cobertura del periodo pagado",
    suppressWhen: "MAIL_MODE=off; sin contacto de facturación",
    idempotency: EVENT_KEY,
    render: (v, o) => layout(brand(o.supportEmail), "Incidencia en el cobro de tu suscripción", ["El cobro de tu suscripción se ha revertido y el acceso queda en pausa hasta regularizarlo. Tus datos se conservan."], panel(v.host)),
  },
  // ── Soporte (contratos; el CRM de soporte no se reestructura) ──
  legacy("support.ticket_received", "support", "operational", "Ticket creado (TicketService → PlatformMailer.ticketNotifier)", "ticket_requester", "Al crear el ticket, si quien lo abre es un correo", "ticket:<id>:received:<n>"),
  legacy("support.ticket_replied", "support", "operational", "Respuesta pública del equipo (TicketService.comment, nunca las notas internas)", "ticket_requester", "Por cada respuesta visible de alguien distinto del solicitante", "ticket:<id>:replied:<n>"),
  legacy("support.ticket_resolved", "support", "operational", "Ticket resuelto (TicketService.setStatus → resolved)", "ticket_requester", "Al resolver", "ticket:<id>:resolved:<n>"),
  legacy("support.ticket_reopened", "support", "operational", "Ticket reabierto (TicketService.setStatus → open desde resolved)", "ticket_requester", "Al reabrir", "ticket:<id>:reopened:<n>"),
  // ── Consumidores: desistimiento (server/withdrawals) ──
  legacy("consumer.withdrawal_receipt", "support", "withdrawal_receipt", "Solicitud de desistimiento (WithdrawalService.request → withdrawalNotifier.receipt)", "consumer", "Al registrar la solicitud: acuse con referencia, fecha y hora (soporte duradero)", "withdrawal:<referencia>:receipt"),
  legacy("consumer.withdrawal_resolution", "support", "withdrawal_resolution", "Resolución del desistimiento (WithdrawalService.decide: accept, reject o complete)", "consumer", "Al aceptar, rechazar (con motivo) o completar", "withdrawal:<referencia>:<estado>"),
  // ── Equipo (avisos INTERNOS a CP_ALERT_EMAIL; sin datos sensibles ni enlaces con token) ──
  legacy("ops.incident", "support", "operational", "Incidencia operativa abierta, reabierta o escalada (IncidentService → incidentNotifier; incluye fallos de cobro rate:stripe.*)", "ops_team", "Al abrir, reabrir o escalar (no en cada repetición); también por webhook", "ops:incident:<id>:<evento>:<n>:<destinatario>"),
  legacy("ops.new_customer", "support", "operational", "Pedido activado de alta o conversión (orderNotifier: activate)", "ops_team", "Al activar un cliente nuevo (un cambio de plan no)", "ops:customer:<pedido>:<destinatario>"),
  legacy("ops.withdrawal_requested", "support", "operational", "Solicitud de desistimiento registrada (withdrawalNotifier.receipt)", "ops_team", "Al registrar cada solicitud", "ops:withdrawal:<referencia>:<destinatario>"),
  legacy("ops.ticket_created", "support", "operational", "Ticket creado (ticketNotifier: received)", "ops_team", "Al crear cada ticket", "ops:ticket:<id>:created:<destinatario>"),
  // ── Seguridad (contratos; la autenticación no se modifica) ──
  legacy("security.password_changed", "security", "security_notice", "Contraseña restablecida en el Core (POST /api/auth/reset-password → passwordChangedEmail)", "account_user", "Tras cada cambio (sin enlaces; sin copia global)", "bandeja de la empresa (una por cambio)"),
  contract("security.new_login", "security", "operational", "Inicio de sesión desde un dispositivo nuevo", "account_user", ["at", "approximateLocation"], "Al detectar un dispositivo nuevo"),
  contract("security.mfa_changed", "security", "operational", "Segundo factor activado o desactivado", "account_user", ["at", "enabled"], "Tras cada cambio"),
  // ── Datos de la empresa: exportación (server/dataExport; marca de la empresa, sin el enlace de descarga) ──
  legacy("data.export_ready", "data", "data_export", "Exportación generada (DataExportService → dataExport.notify); con avisos si está incompleta", "account_user", "Al terminar la generación, a la persona propietaria que la pidió (sin copia global)", "data-export:<id>:ready (bandeja de la empresa)"),
  legacy("data.export_failed", "data", "data_export", "Exportación fallida o demasiado grande (DataExportService → dataExport.notify)", "account_user", "Al fallar la generación, a la persona propietaria que la pidió (sin copia global)", "data-export:<id>:failed (bandeja de la empresa)"),
];

export const activeTemplates = (type: CommercialEventType) => TEMPLATE_CATALOG.filter((t) => t.status === "active" && t.events?.includes(type));

/** Vista del catálogo sin funciones (API de operadores). */
export const catalogView = () => TEMPLATE_CATALOG.map(({ render: _r, ...t }) => t);
