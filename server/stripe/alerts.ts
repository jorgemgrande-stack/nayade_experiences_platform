/**
 * Reglas de alerta de Stripe Billing para `FailureAlerts` (incidencias `rate.stripe.*`, deduplicadas).
 * `recordFailure` descarta cualquier tipo sin regla: cada tipo que se anote en el código debe estar aquí
 * (lo comprueba `alerts.test.ts`). Las incidencias no se cierran solas: las resuelve un operador.
 */
import type { FailureRule } from "../_core/ops/failureAlerts";

const MIN = 60_000;
const once = (title: string, severity: FailureRule["severity"] = "critical"): FailureRule => ({ threshold: 1, windowMs: 60 * MIN, severity, title });
const repeated = (threshold: number, minutes: number, title: string, severity: FailureRule["severity"] = "warning"): FailureRule => ({ threshold, windowMs: minutes * MIN, severity, title });

export const STRIPE_FAILURE_RULES: Record<string, FailureRule> = {
  // Datos que no corresponden o posibles intentos de engaño: basta una vez
  "stripe.live_event_rejected": once("Stripe: se ha recibido un evento o un objeto live en modo pruebas (rechazado)"),
  "stripe.test_event_rejected": once("Stripe: se ha recibido un evento o un objeto de pruebas en modo live (rechazado)"),
  "stripe.event_mismatch": once("Stripe: un evento apunta a datos que no corresponden (ignorado)"),
  "stripe.session_mismatch": once("Stripe: una sesión de Checkout no corresponde a su pedido o empresa"),
  "stripe.event_failed": once("Stripe: un evento agotó sus reintentos sin aplicarse"),
  "stripe.catalog_conflict": once("Stripe: el catálogo enlazado no coincide con el de Stripe"),
  "stripe.portal_unsafe": once("Stripe: el portal de facturación se ha bloqueado porque su configuración permite cambios o cancelaciones"),
  // Cobertura económica: reembolsos y disputas
  "stripe.coverage_lost": once("Stripe: cobro revertido (reembolso total o disputa perdida): revisar el pedido"),
  "stripe.namespace_mismatch": once("Stripe: objetos de un pedido con otro prefijo de entorno (se ignoran): revisar CP_STRIPE_NAMESPACE"),
  "stripe.dispute_open": once("Stripe: disputa abierta en el cobro de una suscripción", "warning"),
  "stripe.partial_refund": once("Stripe: reembolso parcial en el cobro de una suscripción (revisar)", "warning"),
  "orders.stripe_contract_cancelled": once("Contrato cancelado en el CRM con la suscripción viva en Stripe", "warning"),
  "orders.tenant_sync_failed": once("No se pudo llevar el estado de la empresa en el registro a su situación comercial (lo reintenta la revisión)", "warning"),
  // Perfil fiscal del comprador frente a la factura (el pago ya está cobrado: revisar el tratamiento fiscal)
  "stripe.buyer_territory_mismatch": once("Stripe: la dirección de la factura no corresponde al territorio fiscal declarado por el comprador"),
  "stripe.buyer_tax_id_missing": once("Stripe: empresa facturada sin identificador fiscal en la factura", "warning"),
  "stripe.vat_no_longer_valid": once("Stripe: el NIF-IVA de un cliente con inversión del sujeto pasivo ya no es válido en VIES (revisar antes de la próxima factura)"),
  "stripe.invoice_tax_mismatch": once("Stripe: el impuesto de una factura cobrada no corresponde al tratamiento fiscal aprobado para su escenario"),
  // Facturación por líneas y conciliación de partidas (nunca se corrige solo: lo revisa el equipo)
  "stripe.items_drift": once("Stripe: las partidas de una suscripción no coinciden con lo contratado para el próximo periodo"),
  "stripe.refund_unallocated": once("Stripe: un reembolso supera lo cobrado en las líneas de su factura (revisar)", "warning"),
  // Partidas mensuales de un plan anual (primer mes cobrado en el Checkout; recurrentes al activarse)
  "stripe.deferred_items_pending": once("Stripe: no se pudieron añadir las partidas mensuales de un plan anual (la conciliación lo reintenta; hasta entonces no se renuevan)", "warning"),
  "stripe.deferred_items_blocked": once("Stripe: las partidas mensuales de un plan anual no se añadieron y requieren revisión (no se renovarán solas)"),
  // Compras y reducciones desde la plataforma
  "purchases.reduction_stuck": once("Compra de módulos: una reducción no quedó activa (revisar el pedido)"),
  "purchases.reduction_stripe_pending": once("Compra de módulos: Stripe no aplicó una reducción ya programada (la conciliación la reenvía; revisar)"),
  "purchases.failed": repeated(3, 30, "Compra de módulos: errores repetidos", "critical"),
  "stripe.fiscal_document_failed": once("Facturación: el sistema de facturación legal rechazó un documento (queda en la cola para revisión)"),
  // Activación sin pago de Stripe en el entorno real: cada una queda a la vista del equipo (auditoría)
  "orders.admin_approval_live": once("Pedido activado por aprobación administrativa (sin pago de Stripe) en el entorno real: revisar la justificación", "warning"),
  // Fallos técnicos repetidos
  "stripe.webhook_store_failed": repeated(3, 15, "Stripe: no se pueden guardar los webhooks recibidos", "critical"),
  "stripe.webhook_invalid_signature": repeated(10, 15, "Stripe: webhooks con firma no válida repetidos"),
  "stripe.gateway_error": repeated(5, 30, "Stripe: errores repetidos al llamar a la API"),
  "stripe.worker_failed": repeated(3, 30, "Stripe: la tarea periódica falla repetidamente", "critical"),
  "stripe.reconcile_backlog": repeated(3, 60, "Stripe: la conciliación no alcanza a revisar todos los eventos"),
  "stripe.reconcile_refresh_failed": repeated(3, 60, "Stripe: la conciliación no puede releer suscripciones"),
  "stripe.self_service_failed": repeated(3, 30, "Stripe: errores repetidos en la contratación por autoservicio", "critical"),
  "stripe.events_purge_failed": repeated(3, 24 * 60, "Stripe: la purga de eventos antiguos falla"),
  "stripe.failed": repeated(3, 30, "Stripe: errores repetidos en las operaciones de Stripe"),
};
