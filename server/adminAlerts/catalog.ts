/**
 * Catálogo de las alertas administrativas (familia D · Administración Big Elephant). Cada alerta tiene un id
 * ESTABLE, su número del catálogo aprobado (1–42), el hecho que la activa, la fuente técnica de ese hecho, la
 * prioridad por defecto, si requiere intervención, la frecuencia por defecto y unos datos FICTICIOS para la vista
 * previa y las pruebas.
 *
 * Las críticas (`locked`) no se pueden desactivar ni rebajar desde el CRM. Las `pendiente` no se envían: el hecho
 * que las activaría todavía no existe en el producto (`pending` dice por qué).
 *
 * Reutiliza los avisos internos que ya existían (`adapts`): nuevo cliente, ticket, desistimiento, incidencia y
 * contrato aceptado salen ahora por aquí, con el diseño de la familia D, en lugar de duplicarse.
 */
import type { Tone } from "../mail/design";
import type { MailCategory } from "../mail/types";
import type { AlertSection, AlertSeverity } from "./templates";

/** Un hecho confirmado, tal y como lo describe quien lo detecta. Sin datos sensibles. */
export interface AlertFacts {
  /** Identidad del hecho (idempotencia): el mismo hecho, la misma clave. */
  key: string;
  occurredAt: number;
  tenantId?: string | null;
  companyId?: number | null;
  company?: string | null;
  /** Qué ha sucedido, en una frase. */
  summary: string;
  /** Estado REAL de la operación. */
  status: { label: string; tone: Tone };
  amount?: { cents: number; currency: string } | null;
  reference?: string | null;
  details?: Array<{ label: string; value: string }>;
  /** Ruta del expediente en el CRM («#/comercial/contrataciones/12»). */
  link?: string | null;
  intervention?: boolean;
  /** Prioridad de este hecho concreto (p. ej. una incidencia escalada), por encima de la configurada. */
  severity?: AlertSeverity;
  escalated?: string | null;
  /** Direcciones que ya reciben otro aviso del mismo hecho (no se repite). */
  skipRecipients?: string[];
}

export interface AdminAlertSpec {
  id: string;
  n: number;
  section: AlertSection;
  name: string;
  /** Hecho de negocio que la activa. */
  trigger: string;
  /** Fuente técnica del hecho. */
  source: string;
  severity: AlertSeverity;
  /** Crítica: siempre activa y crítica. */
  locked: boolean;
  intervention: boolean;
  /** Minutos entre correos de la misma alerta (0 = cada hecho). */
  frequencyMinutes: number;
  category: MailCategory;
  state: "conectada" | "pendiente";
  pending?: string;
  /** Aviso interno anterior que esta alerta sustituye. */
  adapts?: string;
  sample: AlertFacts;
}

const T0 = Date.UTC(2026, 9, 30, 9, 15);
const DEMO = { tenantId: "empresa-demo", companyId: 42, company: "Empresa Demo, S.L." };
const ok = (label: string) => ({ label, tone: "success" as const });
const info = (label: string) => ({ label, tone: "info" as const });
const warn = (label: string) => ({ label, tone: "warning" as const });
const bad = (label: string) => ({ label, tone: "error" as const });

type Def = Omit<AdminAlertSpec, "locked" | "category" | "state" | "frequencyMinutes" | "sample"> & Partial<Pick<AdminAlertSpec, "category" | "state" | "frequencyMinutes">> & { sample: Omit<AlertFacts, "key" | "occurredAt"> };
const a = (d: Def): AdminAlertSpec => ({
  category: "operational",
  state: "conectada",
  frequencyMinutes: 0,
  ...d,
  locked: d.severity === "critical",
  sample: { key: `muestra:${d.id}`, occurredAt: T0, ...d.sample },
});

export const ADMIN_ALERTS: readonly AdminAlertSpec[] = [
  // ── A. Contrataciones y clientes ──
  a({ id: "admin.lead_request", n: 1, section: "contratacion", name: "Nueva solicitud comercial desde la web", trigger: "Solicitud registrada en el formulario de la web", source: "WebRequestService → LeadNoticeService.onCreated", severity: "important", intervention: true, category: "lead_request_notice", adapts: "ops.lead_request", sample: { ...DEMO, tenantId: null, summary: "Solicitud de demostración desde /precios.", status: info("Pendiente de atender"), reference: "SOL-2026-0042", link: "#/comercial/leads/7" } }),
  a({ id: "admin.customer_registered", n: 2, section: "contratacion", name: "Nuevo cliente registrado", trigger: "Correo verificado en el alta de la prueba", source: "Evento comercial trial.verified", severity: "info", intervention: false, sample: { ...DEMO, tenantId: null, summary: "Una empresa nueva ha verificado su correo en el alta.", status: ok("Correo verificado"), link: "#/operacion/pruebas" } }),
  a({ id: "admin.trial_started", n: 3, section: "contratacion", name: "Nueva prueba gratuita activada", trigger: "Plataforma de la prueba aprovisionada", source: "Evento comercial trial.started", severity: "info", intervention: false, sample: { ...DEMO, summary: "Se ha activado una prueba gratuita de 15 días.", status: ok("Prueba activa"), link: "#/clientes/empresa-demo" } }),
  a({ id: "admin.trial_ending", n: 4, section: "contratacion", name: "Prueba próxima a finalizar: oportunidad de conversión", trigger: "Aviso de vencimiento de la prueba (3 o menos días)", source: "TrialNotifier.expiryNotice", severity: "important", intervention: true, sample: { ...DEMO, summary: "La prueba termina en 3 días y la empresa aún no ha contratado.", status: warn("Termina en 3 días"), link: "#/operacion/pruebas" } }),
  a({ id: "admin.plan_contracted", n: 5, section: "contratacion", name: "Nuevo plan SaaS contratado", trigger: "Pedido de alta o conversión confirmado (pago o firma verificados)", source: "Evento comercial order.confirmed", severity: "important", intervention: false, sample: { ...DEMO, summary: "Contratación del plan Business (mensual) confirmada.", status: ok("Contratación confirmada"), reference: "PED-2026-0042", amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.contract_sent", n: 6, section: "contratacion", name: "Contrato enviado al cliente", trigger: "Invitación al contrato de un servicio enviada al firmante", source: "ExternalService.requestAcceptance (acceptance_requested)", severity: "info", intervention: false, sample: { ...DEMO, summary: "Contrato de «Servicio Demo» enviado para su revisión y firma.", status: info("Pendiente de firma"), reference: "CT-2026-000099", link: "#/comercial/servicios-externos/9" } }),
  a({ id: "admin.contract_accepted", n: 7, section: "contratacion", name: "Contrato aceptado y firmado electrónicamente", trigger: "Aceptación electrónica del contrato (servicio externo) o condiciones firmadas en la web", source: "ExternalService.accept · evento comercial order.contracted", severity: "important", intervention: false, adapts: "external-accepted (aviso interno anterior)", sample: { ...DEMO, summary: "El firmante ha aceptado el contrato. Falta autorizar el método de pago: la suscripción todavía no existe en Stripe.", status: ok("Contrato aceptado"), reference: "CT-2026-000099", link: "#/comercial/servicios-externos/9" } }),
  a({ id: "admin.payment_method_authorized", n: 8, section: "contratacion", name: "Método de pago autorizado", trigger: "Stripe confirma la autorización del método de pago (SetupIntent)", source: "ExternalService.handleSetupSession (payment_method_authorized)", severity: "info", intervention: false, sample: { ...DEMO, summary: "Stripe ha confirmado la autorización de la tarjeta. Aún no se ha cobrado nada.", status: ok("Tarjeta autorizada"), link: "#/comercial/servicios-externos/9" } }),
  a({ id: "admin.subscription_created", n: 9, section: "contratacion", name: "Suscripción creada y programada en Stripe", trigger: "Suscripción creada en Stripe (SaaS) o programada con su primer cargo (servicio externo)", source: "Evento comercial order.subscribed · ExternalService.schedule (scheduled)", severity: "important", intervention: false, sample: { ...DEMO, summary: "Suscripción programada en Stripe; primer cargo el 1 de noviembre de 2026.", status: info("Programada en Stripe"), amount: { cents: 121000, currency: "EUR" }, link: "#/comercial/servicios-externos/9" } }),
  a({ id: "admin.subscription_activated", n: 10, section: "contratacion", name: "Suscripción activada", trigger: "Pedido de alta o conversión activado (licencias y acceso en marcha)", source: "OrderNotifier: activate", severity: "important", intervention: false, adapts: "ops.new_customer", sample: { ...DEMO, summary: "Nuevo cliente activo: plan Business mensual.", status: ok("Activa"), reference: "PED-2026-0042", link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.plan_changed", n: 11, section: "contratacion", name: "Cambio de plan o ampliación de módulos", trigger: "Cambio de plan, módulo añadido o ampliación de usuarios, sedes o almacenamiento", source: "Eventos comerciales subscription.plan_changed · module_added · quantity_changed", severity: "info", intervention: false, sample: { ...DEMO, summary: "Módulo añadido a la suscripción: Hotel Net · PMS.", status: ok("Aplicado"), link: "#/comercial/suscripciones/12" } }),
  a({ id: "admin.subscription_cancelled", n: 12, section: "contratacion", name: "Cancelación de suscripción", trigger: "Baja programada de una suscripción", source: "Evento comercial order.cancel_scheduled", severity: "important", intervention: true, sample: { ...DEMO, summary: "El cliente ha programado la baja de su suscripción a fin de periodo.", status: warn("Baja programada"), reference: "PED-2026-0042", link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.external_contracted", n: 13, section: "contratacion", name: "Nuevo servicio externo contratado", trigger: "Alta de un servicio externo en el CRM", source: "ExternalService.create (created)", severity: "info", intervention: false, sample: { ...DEMO, summary: "Alta del servicio «Servicio Demo — Mantenimiento gestionado».", status: info("Pendiente de contrato"), amount: { cents: 100000, currency: "EUR" }, link: "#/comercial/servicios-externos/9" } }),
  a({ id: "admin.external_changed", n: 14, section: "contratacion", name: "Modificación o renovación de un servicio externo", trigger: "Modificación confirmada de un servicio externo: decisión registrada sobre el primer cargo (nueva fecha; pendiente de decisión → programado) o aceptación de una versión nueva del contrato. La renovación es el cobro mensual, que ya avisa «Renovación cobrada»", source: "ExternalService.decideFirstCharge · ExternalService.accept (hecho changed del historial)", severity: "important", intervention: false, sample: { ...DEMO, summary: "Condiciones del servicio actualizadas.", status: info("Actualizado"), link: "#/comercial/servicios-externos/9" } }),
  // ── B. Facturación y cobros ──
  a({ id: "admin.first_charge", n: 15, section: "facturacion", name: "Primer cobro realizado", trigger: "Primer cobro verificado en Stripe", source: "Evento comercial payment.succeeded (inicial) · primera factura cobrada de un servicio externo", severity: "important", intervention: false, sample: { ...DEMO, summary: "Stripe ha cobrado el primer recibo.", status: ok("Cobrado"), reference: "PED-2026-0042", amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.renewal_paid", n: 16, section: "facturacion", name: "Renovación cobrada", trigger: "Cobro de una renovación verificado en Stripe", source: "Evento comercial renewal.paid · factura mensual cobrada de un servicio externo", severity: "info", intervention: false, frequencyMinutes: 60, sample: { ...DEMO, summary: "Renovación mensual cobrada.", status: ok("Cobrado"), amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.invoice_issued", n: 17, section: "facturacion", name: "Factura emitida", trigger: "Factura o rectificativa expedida con número", source: "InvoicingService.issue", severity: "info", intervention: false, frequencyMinutes: 60, sample: { ...DEMO, summary: "Factura expedida.", status: ok("Expedida"), reference: "BE-2026-000123", amount: { cents: 121000, currency: "EUR" }, link: "#/comercial/facturacion" } }),
  a({ id: "admin.payment_failed", n: 18, section: "facturacion", name: "Pago fallido", trigger: "Stripe no ha podido cobrar un recibo", source: "Eventos comerciales payment.failed · renewal.failed · impago de un servicio externo", severity: "important", intervention: true, sample: { ...DEMO, summary: "Stripe no ha podido cobrar el recibo de renovación.", status: bad("Impagado"), amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/cobros-en-riesgo" } }),
  a({ id: "admin.grace_started", n: 19, section: "facturacion", name: "Cliente en periodo de gracia", trigger: "La suscripción pasa a impagada con plazo de gracia", source: "Evento comercial order.past_due", severity: "important", intervention: true, sample: { ...DEMO, summary: "La suscripción ha entrado en el periodo de gracia de 7 días.", status: warn("En gracia"), reference: "PED-2026-0042", details: [{ label: "Fin de la gracia", value: "6 de noviembre de 2026" }], link: "#/comercial/cobros-en-riesgo" } }),
  a({ id: "admin.suspension_near", n: 20, section: "facturacion", name: "Cliente próximo a suspensión", trigger: "Quedan 48 horas o menos de gracia sin cobro", source: "Revisión periódica de pedidos y servicios externos impagados", severity: "important", intervention: true, sample: { ...DEMO, summary: "Si no se regulariza el pago, la suscripción se suspenderá en menos de 48 horas.", status: warn("Suspensión inminente"), reference: "PED-2026-0042", link: "#/comercial/cobros-en-riesgo" } }),
  a({ id: "admin.subscription_suspended", n: 21, section: "facturacion", name: "Suscripción suspendida", trigger: "Suscripción suspendida por impago o cobro revertido", source: "Evento comercial order.suspended · servicio externo vencido sin cobro", severity: "critical", intervention: true, sample: { ...DEMO, summary: "La suscripción se ha suspendido: el acceso está en pausa.", status: bad("Suspendida"), reference: "PED-2026-0042", link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.payment_recovered", n: 22, section: "facturacion", name: "Pago recuperado", trigger: "Cobro recuperado tras un impago", source: "Evento comercial order.recovered", severity: "info", intervention: false, sample: { ...DEMO, summary: "El cobro pendiente se ha recuperado y el servicio sigue activo.", status: ok("Al corriente"), link: "#/comercial/contrataciones/42" } }),
  a({ id: "admin.refund", n: 23, section: "facturacion", name: "Reembolso realizado", trigger: "Reembolso registrado en Stripe", source: "Evento comercial refund.recorded · reembolso de un servicio externo", severity: "important", intervention: true, sample: { ...DEMO, summary: "Reembolso registrado. Falta expedir la factura rectificativa.", status: info("Reembolsado"), amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/facturacion" } }),
  a({ id: "admin.dispute", n: 24, section: "facturacion", name: "Disputa o contracargo recibido", trigger: "Disputa abierta o actualizada en Stripe", source: "Evento comercial dispute.status_changed · disputa de un servicio externo", severity: "critical", intervention: true, sample: { ...DEMO, summary: "El titular de la tarjeta ha abierto una disputa. Hay plazo para aportar pruebas en Stripe.", status: bad("Disputa abierta"), amount: { cents: 12100, currency: "EUR" }, link: "#/comercial/cobros-en-riesgo" } }),
  a({ id: "admin.billing_error", n: 25, section: "facturacion", name: "Error de conciliación o facturación", trigger: "Incidencia de cobro, conciliación o documento fiscal", source: "Incidencias stripe.* · orders.* · purchases.*", severity: "critical", intervention: true, adapts: "ops.incident (cobros)", sample: { ...DEMO, summary: "Las partidas de Stripe no coinciden con las de la suscripción.", status: bad("Incidencia abierta"), link: "#/clientes/empresa-demo" } }),
  // ── C. Soporte y atención al cliente ──
  a({ id: "admin.ticket_created", n: 26, section: "soporte", name: "Nuevo ticket de soporte", trigger: "Ticket creado", source: "TicketNotifier: received", severity: "important", intervention: true, adapts: "ops.ticket_created", sample: { ...DEMO, summary: "Nuevo ticket T-137: «No veo las reservas de ayer» (prioridad normal).", status: info("Abierto"), reference: "T-137", link: "#/soporte" } }),
  a({ id: "admin.ticket_urgent", n: 27, section: "soporte", name: "Ticket marcado como urgente", trigger: "Ticket creado como urgente o cambiado a urgente", source: "TicketService.create · setPriority", severity: "critical", intervention: true, sample: { ...DEMO, summary: "El ticket T-137 tiene prioridad urgente.", status: bad("Urgente"), reference: "T-137", link: "#/soporte" } }),
  a({ id: "admin.ticket_unanswered", n: 28, section: "soporte", name: "Ticket sin respuesta dentro del plazo", trigger: "Ticket abierto sin respuesta del equipo en el plazo configurado (24 h)", source: "Revisión periódica de tickets", severity: "important", intervention: true, sample: { ...DEMO, summary: "El ticket T-137 lleva 24 horas sin respuesta del equipo.", status: warn("Sin respuesta"), reference: "T-137", link: "#/soporte" } }),
  a({ id: "admin.ticket_escalated", n: 29, section: "soporte", name: "Ticket escalado", trigger: "Ticket sin respuesta al doble del plazo: se escala a crítico", source: "Revisión periódica de tickets", severity: "critical", intervention: true, sample: { ...DEMO, summary: "El ticket T-137 lleva 48 horas sin respuesta: escalado.", status: bad("Escalado"), reference: "T-137", link: "#/soporte" } }),
  a({ id: "admin.ticket_reopened", n: 30, section: "soporte", name: "Ticket reabierto", trigger: "Ticket resuelto que vuelve a abrirse", source: "TicketNotifier: reopened", severity: "important", intervention: true, sample: { ...DEMO, summary: "El ticket T-137 se ha reabierto.", status: warn("Reabierto"), reference: "T-137", link: "#/soporte" } }),
  a({ id: "admin.withdrawal_requested", n: 31, section: "soporte", name: "Solicitud de cancelación o desistimiento", trigger: "Solicitud de desistimiento registrada", source: "WithdrawalNotifier.receipt", severity: "critical", intervention: true, adapts: "ops.withdrawal_requested", sample: { ...DEMO, summary: "Solicitud de desistimiento dentro de plazo, pendiente de resolver.", status: warn("Pendiente de resolución"), reference: "DS-20261030-AB12CD", link: "#/soporte/desistimientos" } }),
  a({ id: "admin.data_request", n: 32, section: "soporte", name: "Solicitud de eliminación o exportación de datos", trigger: "Solicitud de supresión o exportación que requiera gestión", source: "—", severity: "important", intervention: true, state: "pendiente", pending: "No existe la solicitud de eliminación de datos en el producto. La exportación la genera el propio cliente desde su panel sin intervención del equipo, y el Core no informa al plano de control.", sample: { ...DEMO, summary: "Solicitud de supresión de datos.", status: warn("Pendiente"), link: "#/clientes/empresa-demo" } }),
  // ── D. Operaciones e infraestructura ──
  a({ id: "admin.critical_incident", n: 33, section: "operaciones", name: "Incidencia técnica crítica", trigger: "Incidencia crítica abierta, reabierta o escalada", source: "IncidentService (severidad crítica)", severity: "critical", intervention: true, adapts: "ops.incident", sample: { ...DEMO, tenantId: null, company: null, summary: "Fallos de envío de correo repetidos (5 en 15 minutos).", status: bad("Abierta"), reference: "Incidencia #88", link: "#/dashboard" } }),
  a({ id: "admin.customer_down", n: 34, section: "operaciones", name: "Servicio de un cliente no disponible", trigger: "La plataforma de un cliente deja de responder (3 comprobaciones seguidas fallidas en 5 minutos o más); aviso aparte al recuperarse", source: "UptimeMonitor: sonda periódica de /readyz en el dominio de cada empresa en servicio", severity: "critical", intervention: true, sample: { ...DEMO, summary: "La plataforma no responde.", status: bad("Caída"), link: "#/clientes/empresa-demo" } }),
  a({ id: "admin.integration_error", n: 35, section: "operaciones", name: "Error persistente de integración externa", trigger: "Fallos repetidos de Stripe, del proveedor de correo o del recolector de consumo", source: "Incidencias rate:stripe.gateway_error · webhook · worker · mail.* · notifications.dead · erm.collector_stale", severity: "important", intervention: true, frequencyMinutes: 60, sample: { ...DEMO, tenantId: null, company: null, summary: "Errores repetidos al llamar a la API de Stripe (5 en 30 minutos).", status: bad("Abierta"), reference: "Incidencia #91", link: "#/dashboard" } }),
  a({ id: "admin.quota_near", n: 36, section: "operaciones", name: "Consumo de recursos próximo al límite", trigger: "Consumo de un recurso al 80 % del límite del plan", source: "Incidencia quota:* (aviso)", severity: "info", intervention: false, frequencyMinutes: 240, sample: { ...DEMO, summary: "Almacenamiento al 82 % del límite del plan.", status: warn("Cerca del límite"), link: "#/clientes/empresa-demo" } }),
  a({ id: "admin.quota_reached", n: 37, section: "operaciones", name: "Límite de recursos alcanzado", trigger: "Consumo de un recurso al 100 % del límite del plan", source: "Incidencia quota:* (crítica)", severity: "important", intervention: true, sample: { ...DEMO, summary: "Usuarios al 100 % del límite del plan: no se pueden crear más.", status: bad("Límite alcanzado"), link: "#/clientes/empresa-demo" } }),
  a({ id: "admin.backup_failed", n: 38, section: "operaciones", name: "Fallo de copia de seguridad", trigger: "Copia de seguridad atrasada o fallida (destino principal o secundario)", source: "Incidencias backup.stale · backup.secondary_stale · backup.secondary_failed", severity: "critical", intervention: true, sample: { ...DEMO, summary: "La última copia de seguridad tiene más de 36 horas.", status: bad("Copia atrasada"), link: "#/clientes/empresa-demo" } }),
  a({ id: "admin.restore_drill_failed", n: 39, section: "operaciones", name: "Fallo de restauración de prueba", trigger: "Restauración de prueba fallida o sin terminar 6 horas después de empezar", source: "RestoreDrillWatcher: registro de restauraciones (backup_restores) que escribe backup-job", severity: "critical", intervention: true, sample: { ...DEMO, tenantId: null, company: null, summary: "La restauración de prueba ha fallado.", status: bad("Fallida"), link: "#/dashboard" } }),
  a({ id: "admin.security_incident", n: 40, section: "operaciones", name: "Incidencia de seguridad", trigger: "Firmas de webhook no válidas en serie, eventos de otra cuenta o configuración insegura del portal", source: "Incidencias rate:stripe.webhook_invalid_signature · live/test_event_rejected · namespace_mismatch · portal_unsafe", severity: "critical", intervention: true, sample: { ...DEMO, tenantId: null, company: null, summary: "10 webhooks con firma no válida en 15 minutos.", status: bad("Abierta"), reference: "Incidencia #93", link: "#/dashboard" } }),
  a({ id: "admin.provisioning_failed", n: 41, section: "operaciones", name: "Error de aprovisionamiento de un nuevo tenant", trigger: "Fallo al crear la plataforma de una prueba o un alta", source: "Evento comercial trial.provisioning_failed · incidencia rate:provisioning.failed", severity: "critical", intervention: true, sample: { ...DEMO, summary: "No se ha podido crear la plataforma de la prueba.", status: bad("Alta fallida"), link: "#/operacion/errores" } }),
  a({ id: "admin.deploy_failed", n: 42, section: "operaciones", name: "Error de despliegue que afecte a clientes", trigger: "Fallo de la publicación automática en live o en production", source: "DeployWatcher: API pública de GitHub Actions (publicacion.yml y ci.yml, trabajos «Publicar en live/production»)", severity: "critical", intervention: true, sample: { ...DEMO, tenantId: null, company: null, summary: "La publicación en production ha fallado.", status: bad("Fallida"), link: "#/dashboard" } }),
];

const BY_ID = new Map(ADMIN_ALERTS.map((x) => [x.id, x]));
export const alertById = (id: string) => BY_ID.get(id) ?? null;
