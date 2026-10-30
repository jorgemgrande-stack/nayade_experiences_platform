/**
 * Catálogo maestro de las comunicaciones de Big Elephant (fuente del Centro de Plantillas, de las vistas previas y
 * del envío de pruebas): TODAS las plantillas, cada una con su familia editorial, servicio responsable, evento que la
 * activa, estado (conectada a un evento real, sin disparador o interna) y un render con DATOS FICTICIOS. No envía
 * nada ni lee la base de datos. Los enlaces de muestra apuntan a dominios de ejemplo (.example), nunca a una cuenta.
 */
import { previewTemplate, PREVIEW_NOW } from "../notifications/preview";
import type { Family } from "./design";
import { platformTemplates } from "./templates";
import { inviteContent, passwordResetContent } from "./accountTemplates";
import { emailChangeVerifyContent, emailChangedContent } from "./accountSecurityTemplates";
import { extraTemplates as x } from "./extraTemplates";
import type { MailContent } from "./types";
import { ADMIN_ALERTS } from "../adminAlerts/catalog";
import { alertPreview } from "../adminAlerts/service";

/** `externa`: la comunicación la envía un proveedor (Stripe) y Elephant no la duplica; se conserva como referencia. */
export type TemplateState = "conectada" | "sin_disparador" | "interna" | "externa";
/**
 * Circuito operativo de cada plantilla:
 *  - automatica: la envía un hecho real del producto (evento, notificador o alerta);
 *  - manual: la envía una persona del equipo desde el CRM (con selección de destinatarios y confirmación);
 *  - programada: la envía una tarea periódica del plano de control o del Core;
 *  - externa: la envía otro proveedor (Stripe) y Elephant no la duplica;
 *  - pendiente: solo si depende de algo externo que no podemos construir (con su motivo).
 */
export type TemplateCircuit = "automatica" | "manual" | "programada" | "externa" | "pendiente";
export type TemplateGroup = "acceso" | "onboarding" | "contratacion" | "facturacion" | "empresas" | "producto" | "soporte" | "comercial" | "interna" | "administracion";
export interface TemplateEntry {
  id: string;
  name: string;
  group: TemplateGroup;
  family: Family;
  service: "controlplane" | "core" | "crm";
  event: string;
  state: TemplateState;
  circuit: TemplateCircuit;
  /** Sin disparador: por qué (hecho que todavía no existe en el producto). */
  pending?: string;
  /** Externa: quién la envía y por qué Elephant no la duplica. */
  managedBy?: string;
  render: () => MailContent;
}
export interface TestEmail extends Omit<TemplateEntry, "render"> {
  subject: string;
  html: string;
  text: string;
}

const DAY = 86_400_000;
const HOST = "empresa-demo.app.bigelephant.example";
const t = platformTemplates({ supportEmail: "soporte@bigelephant.es" });
const P = (id: string) => () => {
  const p = previewTemplate(id);
  if (!p) throw new Error(`Sin vista previa: ${id}`);
  return p;
};
const ext = { companyName: "Empresa Demo, S.L.", serviceName: "Servicio Demo — Mantenimiento gestionado", signerName: "Laura Demo", amountCents: 100_000, taxRateBp: 2100, currency: "EUR", firstChargeAt: Date.UTC(2026, 10, 1, 7) };
/** Excepciones al circuito por defecto (conectada o interna: automática; externa: externa; sin disparador: pendiente). */
export const CIRCUIT: Readonly<Record<string, TemplateCircuit>> = {
  // Tareas periódicas
  "trial.reminder": "programada",
  "trial.reminder_2": "programada",
  "trial.ended": "programada",
  "usage.near_limit": "programada",
  "usage.limit_reached": "programada",
  "access.archive_notice": "programada",
  "onboarding.reminder": "programada",
  // Alertas internas de la revisión periódica (gracia a punto de vencer y tickets sin respuesta)
  "admin.suspension_near": "programada",
  "admin.ticket_unanswered": "programada",
  "admin.ticket_escalated": "programada",
  // Envíos de una persona del equipo desde el CRM
  "contract.invitation": "manual",
  "contract.payment_setup": "manual",
};
export function circuitOf(id: string, state: TemplateState): TemplateCircuit {
  return CIRCUIT[id] ?? (state === "externa" ? "externa" : state === "sin_disparador" ? "pendiente" : "automatica");
}
const e = (id: string, name: string, group: TemplateGroup, family: Family, service: TemplateEntry["service"], event: string, state: TemplateState, render: () => MailContent): TemplateEntry => ({
  id,
  name,
  group,
  family,
  service,
  event,
  state,
  circuit: circuitOf(id, state),
  render,
});

export const TEMPLATES: readonly TemplateEntry[] = [
  // ── A. Acceso, identidad y seguridad ──
  e("trial.verification", "Verificación del correo (alta de prueba)", "acceso", "security", "controlplane", "Solicitud de prueba gratuita en la web", "conectada", P("trial.verification")),
  e("trial.verification_resent", "Nuevo enlace de verificación", "acceso", "security", "controlplane", "Reenvío del enlace de verificación", "conectada", () => t.emailVerificationResent({ verifyUrl: "https://www.bigelephant.example/prueba-gratuita/verificar?muestra=2" })),
  e("account.password_reset", "Restablecimiento de contraseña (usuarios de empresa)", "acceso", "security", "core", "POST /api/auth/forgot-password", "conectada", () => passwordResetContent({ name: "Ana Demo", url: `https://${HOST}/nueva-contrasena?muestra=1`, minutes: 60, account: "Big Elephant CRM (Empresa Demo)" })),
  e("operator.password_reset", "Restablecimiento de contraseña (administración central)", "acceso", "security", "controlplane", "POST /cp/v1/auth/password-reset/request", "conectada", () => passwordResetContent({ name: null, url: "https://admin.bigelephant.example/#/restablecer?muestra=1", minutes: 30, account: "Big Elephant CRM (administración central)" })),
  e("security.password_changed", "Contraseña modificada", "acceso", "security", "core", "Contraseña restablecida (POST /api/auth/reset-password)", "conectada", P("security.password_changed")),
  e("security.new_login", "Inicio de sesión desde un dispositivo nuevo", "acceso", "security", "core", "Inicio de sesión desde un dispositivo no visto antes (POST /api/auth/login y acceso centralizado)", "conectada", P("security.new_login")),
  e("security.mfa_changed", "Verificación en dos pasos modificada", "acceso", "security", "controlplane", "Activación o retirada del segundo factor de un operador del CRM (las empresas aún no tienen segundo factor)", "conectada", P("security.mfa_changed")),
  e("account.invite", "Invitación a un usuario de la empresa", "acceso", "security", "core", "Alta de usuario con invitación (sendInviteEmail)", "conectada", () => inviteContent({ name: "Pablo Demo", company: "Empresa Demo", role: "manager", url: `https://${HOST}/establecer-contrasena?muestra=1`, hours: 72 })),
  e("account.email_changed", "Cambio de dirección de correo", "acceso", "security", "core", "Cambio del correo de acceso confirmado (accountSecurity.confirmEmailChange): aviso al correo anterior", "conectada", () => emailChangedContent({ brand: "Empresa Demo", name: "Ana Demo", oldEmail: "ana.antigua@empresa-demo.example", newEmail: "ana@empresa-demo.example", at: new Date(PREVIEW_NOW) })),
  e("account.email_verify", "Verificación del nuevo correo de acceso", "acceso", "security", "core", "Solicitud de cambio del correo de acceso (accountSecurity.requestEmailChange): enlace al correo nuevo", "conectada", () => emailChangeVerifyContent({ brand: "Empresa Demo", name: "Ana Demo", newEmail: "ana@empresa-demo.example", url: `https://${HOST}/admin/verificar-correo?muestra=1`, minutes: 60 })),
  // ── B. Onboarding y periodo de prueba ──
  e("trial.started", "Bienvenida a Big Elephant (prueba activada)", "onboarding", "experiential", "controlplane", "Prueba aprovisionada", "conectada", P("trial.started")),
  e("tenant.welcome", "Bienvenida (alta asistida)", "onboarding", "experiential", "controlplane", "Plataforma creada desde el CRM", "conectada", () => t.tenantWelcome({ companyName: "Empresa Demo, S.L.", host: HOST, setPasswordUrl: `https://${HOST}/establecer-contrasena?muestra=1` })),
  e("onboarding.steps", "Primeros pasos de configuración", "onboarding", "experiential", "core", "Primer acceso al asistente de Primeros pasos sin ningún paso dado", "conectada", () => x.onboardingSteps({ name: "Ana Demo", host: HOST })),
  e("onboarding.progress", "Progreso de la configuración", "onboarding", "experiential", "core", "La configuración cruza la mitad de los pasos", "conectada", () => x.onboardingProgress({ name: "Ana Demo", host: HOST, done: 3, total: 5 })),
  e("onboarding.reminder", "Recordatorio de configuración incompleta", "onboarding", "experiential", "core", "Primeros pasos sin terminar a los 3 días del primer acceso (tarea programada onboarding-reminder, con los pasos reales)", "conectada", () => x.onboardingReminder({ name: "Ana Demo", host: HOST, pending: ["Datos de tu empresa", "Invitar a tu equipo"] })),
  e("trial.reminder", "Prueba: quedan 7 días", "onboarding", "experiential", "controlplane", "Planificador de pruebas (aviso a 7 días)", "conectada", P("trial.reminder")),
  e("trial.reminder_2", "Prueba: quedan 2 días", "onboarding", "experiential", "controlplane", "Planificador de pruebas (umbral configurable)", "conectada", () => t.trialExpiry({ endsAt: PREVIEW_NOW + 2 * DAY, daysLeft: 2, pricingUrl: "https://www.bigelephant.example/precios" })),
  e("trial.ended", "Prueba finalizada", "onboarding", "experiential", "controlplane", "Fin de la prueba", "conectada", P("trial.ended")),
  e("trial.extended", "Prueba ampliada", "onboarding", "experiential", "controlplane", "Ampliación desde el Control Center", "conectada", P("trial.extended")),
  e("trial.suspended", "Prueba en pausa", "onboarding", "security", "controlplane", "Pausa desde el Control Center", "conectada", P("trial.suspended")),
  e("trial.reactivated", "Prueba reactivada", "onboarding", "experiential", "controlplane", "Reactivación desde el Control Center", "conectada", P("trial.reactivated")),
  e("subscription.signup_received", "Solicitud de alta recibida (conversión)", "onboarding", "transactional", "controlplane", "Alta en línea pendiente de pago", "conectada", P("subscription.signup_received")),
  e("signup.received", "Alta recibida (preparando el espacio)", "onboarding", "experiential", "controlplane", "Alta registrada", "conectada", () => t.signupConfirmation({ companyName: "Empresa Demo, S.L." })),
  // ── C. Contratación y suscripciones ──
  e("contract.invitation", "Contrato disponible para revisión", "contratacion", "transactional", "controlplane", "Envío del contrato desde el CRM", "conectada", () => t.contractInvitation({ ...ext, url: "https://admin.bigelephant.example/cp/v1/public/contract-acceptance?token=MUESTRA", expiresAt: PREVIEW_NOW + 14 * DAY })),
  e("contract.payment_setup", "Acceso a la autorización del método de pago", "contratacion", "transactional", "controlplane", "Reenvío manual desde el CRM", "conectada", () => t.contractPaymentSetup({ ...ext, contractReference: "CT-2026-000099", url: "https://admin.bigelephant.example/cp/v1/public/contract-acceptance/autorizar?t=MUESTRA", expiresAt: PREVIEW_NOW + 30 * DAY })),
  e("contract.scheduled", "Servicio contratado: suscripción creada y programada", "contratacion", "transactional", "controlplane", "Stripe confirma la autorización y se programa la suscripción", "conectada", () => t.externalScheduled({ ...ext, acceptedAt: PREVIEW_NOW, authorizedAt: PREVIEW_NOW })),
  e("subscription.contract_confirmed", "Contratación confirmada y activa", "contratacion", "transactional", "controlplane", "Pedido activado", "conectada", P("subscription.contract_confirmed")),
  e("subscription.plan_changed", "Cambio de plan", "contratacion", "transactional", "controlplane", "subscription.plan_changed", "conectada", P("subscription.plan_changed")),
  e("module.quantity_changed", "Ampliación de usuarios, sedes o almacenamiento", "contratacion", "transactional", "controlplane", "subscription.quantity_changed", "conectada", P("module.quantity_changed")),
  e("module.removal_scheduled", "Baja de un módulo programada", "contratacion", "transactional", "controlplane", "subscription.module_removed", "conectada", P("module.removal_scheduled")),
  e("module.removal_effective", "Baja de un módulo aplicada", "contratacion", "transactional", "controlplane", "subscription.module_removal_effective", "conectada", P("module.removal_effective")),
  e("module.purchase_requested", "Compra de módulo pendiente de pago", "contratacion", "transactional", "controlplane", "Compra enviada a Stripe con el cobro pendiente (autenticación o pago fallido)", "conectada", P("module.purchase_requested")),
  e("module.purchase_failed", "Compra no completada", "contratacion", "transactional", "controlplane", "order.rejected (compra desde la plataforma)", "conectada", P("module.purchase_failed")),
  e("subscription.renewal_paid", "Renovación de la suscripción", "contratacion", "transactional", "controlplane", "Renovación cobrada", "conectada", P("subscription.renewal_paid")),
  e("subscription.cancellation", "Cancelación confirmada", "contratacion", "transactional", "controlplane", "Baja programada", "conectada", P("subscription.cancellation")),
  e("subscription.ended", "Fin de la suscripción", "contratacion", "transactional", "controlplane", "order.cancelled", "conectada", P("subscription.ended")),
  e("consumer.withdrawal_receipt", "Desistimiento recibido", "contratacion", "security", "controlplane", "Solicitud de desistimiento", "conectada", P("consumer.withdrawal_receipt")),
  e("consumer.withdrawal_resolution", "Resolución del desistimiento", "contratacion", "security", "controlplane", "Resolución del desistimiento", "conectada", P("consumer.withdrawal_resolution")),
  // ── D. Facturación y pagos ──
  e("billing.invoice_available", "Factura emitida", "facturacion", "transactional", "controlplane", "Factura de Stripe cobrada", "conectada", P("billing.invoice_available")),
  e("subscription.initial_payment", "Pago realizado correctamente", "facturacion", "transactional", "controlplane", "Primer cobro verificado en Stripe", "conectada", P("subscription.initial_payment")),
  e("payment.test_confirmed", "Pago de prueba registrado (entorno de pruebas)", "facturacion", "transactional", "controlplane", "Pago con el proveedor simulado o Stripe en pruebas", "conectada", () => t.testPaymentConfirmed({ reference: "PED-2026-0042", amountCents: 2900, currency: "EUR" })),
  e("billing.upcoming_charge", "Próximo cargo programado", "facturacion", "transactional", "controlplane", "Aviso previo a la renovación (lo envía Stripe: «upcoming renewal» del Dashboard)", "externa", () => x.upcomingCharge({ reference: "PED-2026-0042", amountCents: 121_000, currency: "EUR", at: PREVIEW_NOW + 7 * DAY, host: HOST })),
  e("subscription.payment_failed", "Incidencia en el cobro", "facturacion", "transactional", "controlplane", "Renovación impagada (inicio de la gracia de 7 días)", "conectada", P("subscription.payment_failed")),
  e("billing.payment_reminder", "Recordatorio de pago pendiente", "facturacion", "transactional", "controlplane", "Recordatorios de la gracia (los envía Stripe en cada reintento de Smart Retries)", "externa", () => x.paymentReminder({ reference: "PED-2026-0042", amountCents: 121_000, currency: "EUR", graceEndsAt: PREVIEW_NOW + 4 * DAY, host: HOST })),
  e("subscription.suspended", "Último aviso: suscripción suspendida", "facturacion", "transactional", "controlplane", "order.suspended", "conectada", P("subscription.suspended")),
  e("subscription.recovered", "Pago regularizado y servicio restablecido", "facturacion", "transactional", "controlplane", "Pago recuperado", "conectada", P("subscription.recovered")),
  e("billing.incident", "Cobro revertido", "facturacion", "transactional", "controlplane", "coverage.lost", "conectada", P("billing.incident")),
  e("billing.refund_recorded", "Reembolso registrado", "facturacion", "transactional", "controlplane", "refund.recorded", "conectada", P("billing.refund_recorded")),
  e("billing.credit_note", "Factura rectificativa", "facturacion", "transactional", "controlplane", "Factura rectificativa expedida con número", "conectada", P("billing.credit_note")),
  // ── E. Empresas y servicios ──
  e("access.read_only_started", "Cuenta en solo lectura", "empresas", "security", "controlplane", "access.read_only_started", "conectada", P("access.read_only_started")),
  e("access.read_only_ended", "Fin del periodo de solo lectura", "empresas", "security", "controlplane", "access.read_only_ended", "conectada", P("access.read_only_ended")),
  e("access.archive_notice", "Aviso de archivado", "empresas", "security", "controlplane", "access.archive_notice", "conectada", P("access.archive_notice")),
  e("tenant.domain_connected", "Dominio propio conectado", "empresas", "transactional", "controlplane", "Dominio propio activado en la plataforma", "conectada", () => x.domainConnected({ domain: "www.empresa-demo.example" })),
  e("tenant.domain_pending", "Dominio pendiente de validación", "empresas", "transactional", "controlplane", "Alta de un dominio propio pendiente de validar", "conectada", () => x.domainPending({ domain: "www.empresa-demo.example", record: "CNAME", value: "empresa-demo.app.bigelephant.example" })),
  e("external.changed", "Servicio externo modificado o renovado", "empresas", "transactional", "controlplane", "Cambio confirmado del servicio: decisión sobre la fecha del primer cargo o versión nueva del contrato aceptada", "conectada", () => x.externalChanged({ ...ext, effectiveAt: PREVIEW_NOW + 10 * DAY, change: "first_charge", contractVersion: null })),
  e("data.export_ready", "Exportación de datos lista", "empresas", "security", "core", "Exportación generada", "conectada", P("data.export_ready")),
  e("data.export_failed", "Exportación de datos fallida", "empresas", "security", "core", "Exportación fallida", "conectada", P("data.export_failed")),
  // ── F. Producto y operaciones ──
  e("module.activated", "Nuevo módulo activado", "producto", "experiential", "controlplane", "subscription.module_added", "conectada", P("module.activated")),
  e("usage.near_limit", "Consumo cerca del límite", "producto", "security", "controlplane", "Consumo al 80 % (Resource Manager)", "conectada", P("usage.near_limit")),
  e("usage.limit_reached", "Límite de consumo alcanzado", "producto", "security", "controlplane", "Consumo al 100 % (Resource Manager)", "conectada", P("usage.limit_reached")),
  e("product.update", "Actualización importante del producto", "producto", "experiential", "controlplane", "Publicación de una versión", "sin_disparador", () => x.productUpdate({ title: "Nuevos informes de ventas", points: ["Panel de ventas en tiempo real", "Exportación a Excel", "Filtros por equipo"], url: "https://www.bigelephant.example/novedades" })),
  e("ops.maintenance", "Mantenimiento programado", "producto", "security", "controlplane", "Ventana de mantenimiento", "sin_disparador", () => x.maintenance({ start: PREVIEW_NOW + 3 * DAY, minutes: 30 })),
  e("ops.customer_incident", "Incidencia técnica y resolución", "producto", "security", "controlplane", "Incidencia de servicio comunicada a clientes", "sin_disparador", () => x.incident({ title: "Envío de correos restablecido", resolved: true, detail: "Entre las 10:00 y las 10:40 algunos correos se enviaron con retraso. El servicio funciona con normalidad." })),
  // ── G. Soporte ──
  e("support.ticket_received", "Ticket recibido", "soporte", "security", "controlplane", "Ticket creado", "conectada", P("support.ticket_received")),
  e("support.ticket_replied", "Respuesta a un ticket", "soporte", "security", "controlplane", "Respuesta pública del equipo", "conectada", P("support.ticket_replied")),
  e("support.ticket_resolved", "Ticket resuelto", "soporte", "security", "controlplane", "Ticket resuelto", "conectada", P("support.ticket_resolved")),
  e("support.ticket_reopened", "Ticket reabierto", "soporte", "security", "controlplane", "Ticket reabierto", "conectada", P("support.ticket_reopened")),
  e("support.survey", "Encuesta de satisfacción", "soporte", "security", "controlplane", "Ticket resuelto (encuesta posterior)", "sin_disparador", () => x.survey({ ticketRef: "SOP-0137", url: "https://www.bigelephant.example/encuesta?muestra=1" })),
  // ── H. Comerciales (exigen consentimiento; baja en el pie) ──
  e("marketing.news", "Novedades y funcionalidades", "comercial", "experiential", "crm", "Campaña manual con consentimiento", "sin_disparador", () => x.news({ url: "https://www.bigelephant.example/novedades" })),
  e("marketing.recommendation", "Recomendación personalizada de módulos", "comercial", "experiential", "crm", "Campaña manual con consentimiento", "sin_disparador", () => x.recommendation({ module: "Reservas online", reason: "Por la actividad de tu empresa, este módulo puede ahorrarte horas de gestión cada semana.", url: "https://www.bigelephant.example/modulos" })),
  e("marketing.campaign", "Campaña promocional o lanzamiento", "comercial", "experiential", "crm", "Campaña manual con consentimiento", "sin_disparador", () => x.campaign({ title: "Lleva tu negocio más lejos", text: "Descubre la nueva generación de Big Elephant: más automatización, más control y una experiencia pensada para crecer.", url: "https://www.bigelephant.example/" })),
  // ── Avisos internos del equipo ──
  e("ops.lead_request", "Nueva solicitud desde la web (interno)", "interna", "security", "controlplane", "Formulario de la web comercial", "interna", () => t.leadRequestNotice({ typeLabel: "Solicitud de demostración", reference: "SOL-2026-0042", receivedAt: PREVIEW_NOW, company: "Empresa Demo, S.L.", name: "Laura Demo", email: "laura@empresa-demo.example", phone: "+34 600 000 000", sector: "Servicios", product: "Big Elephant Business", message: "Nos gustaría ver una demostración del CRM.", sourcePage: "/precios", owner: null, crmUrl: "https://admin.bigelephant.example/#/comercial/leads" })),
  // ── D. Administración Big Elephant (alertas internas; sustituyen a los avisos ops.incident, ops.new_customer,
  //    ops.withdrawal_requested y ops.ticket_created, que solo quedan como respaldo sin la migración 0030) ──
  ...ADMIN_ALERTS.map((a) => e(a.id, a.name, "administracion", "admin", "controlplane", a.trigger, a.state === "conectada" ? "conectada" : "sin_disparador", () => alertPreview(a.id)!)),
];

/** Motivo funcional de cada plantilla sin disparador (lo que tendría que existir en el producto). */
export const PENDING_REASON: Readonly<Record<string, string>> = {
  "product.update": "No existe una herramienta de comunicados de servicio con selección de destinatarios y aprobación; un envío masivo automático no está permitido.",
  "ops.maintenance": "No existen ventanas de mantenimiento ni página de estado en el producto.",
  "ops.customer_incident": "No hay comunicados de incidencias a clientes: requiere la herramienta de comunicados de servicio con aprobación.",
  "support.survey": "No existe la recogida de valoraciones de soporte (página de encuesta y almacenamiento).",
  "marketing.news": "Comunicación comercial: requiere un registro de consentimiento por contacto y gestión de bajas en el CRM, y un envío manual aprobado. No se activa sola.",
  "marketing.recommendation": "Comunicación comercial: requiere un registro de consentimiento por contacto y gestión de bajas en el CRM, y un envío manual aprobado. No se activa sola.",
  "marketing.campaign": "Comunicación comercial: requiere un registro de consentimiento por contacto y gestión de bajas en el CRM, y un envío manual aprobado. No se activa sola.",
  ...Object.fromEntries(ADMIN_ALERTS.filter((a) => a.pending).map((a) => [a.id, a.pending!])),
};

/** Comunicaciones que envía un proveedor externo: quién y por qué Elephant no las duplica. */
export const MANAGED_BY: Readonly<Record<string, string>> = {
  "billing.upcoming_charge": "Gestionada por Stripe: su aviso de renovación próxima incluye el importe exacto (impuestos y prorrateos), que solo conoce Stripe. Elephant no la duplica.",
  "billing.payment_reminder": "Gestionada por Stripe: los recordatorios durante la gracia salen en cada reintento de cobro (Smart Retries). Elephant avisa el día 0 y no los duplica.",
};

/** Todas las comunicaciones renderizadas con datos ficticios. */
export function allTestEmails(): TestEmail[] {
  return TEMPLATES.map(({ render, ...m }) => {
    const c = render();
    return { ...m, ...(m.state === "sin_disparador" ? { pending: PENDING_REASON[m.id] ?? "Sin hecho que la active todavía en el producto" } : {}), ...(m.state === "externa" ? { managedBy: MANAGED_BY[m.id] } : {}), subject: c.subject, html: c.html, text: c.text ?? "" };
  });
}
