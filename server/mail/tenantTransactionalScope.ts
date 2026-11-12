/**
 * Correo operativo de las empresas (12/11/2026).
 *
 * Categorías transaccionales que las empresas envían a SUS clientes (confirmaciones, cambios, cancelaciones,
 * recordatorios de algo ya contratado, cobros, facturas, presupuestos y devoluciones) y que se añaden al alcance
 * del Core en producción (`MAIL_SCOPE_CATEGORIES`) además de las de acceso que ya estaban.
 *
 * Fuera a propósito: «marketing», «survey», «service_notice» (comunicaciones masivas o comerciales) y «legacy»
 * (cualquier envío sin clasificar sigue bloqueado: el alcance falla cerrado). La comprobación del alcance sigue en
 * `server/mail/policy.ts` (`scopeAllows`); este fichero solo documenta y fija la lista que se abre.
 */
import type { MailCategory } from "./types";

export const TENANT_TRANSACTIONAL_SCOPE: readonly MailCategory[] = [
  "operational",
  "quote_sent",
  "payment_confirmed",
  "invoice_available",
  "refund_recorded",
  "cancellation",
] as const;

/** Valor de `MAIL_SCOPE_CATEGORIES` que se añade en producción (separado por comas). */
export const TENANT_TRANSACTIONAL_SCOPE_ENV = TENANT_TRANSACTIONAL_SCOPE.join(",");
