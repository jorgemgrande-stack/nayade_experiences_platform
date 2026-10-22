/**
 * Servicio de correo transaccional centralizado (Core y plano de control). Tipos comunes.
 *
 * Estados de un mensaje y QUÉ significan (no confundirlos):
 *  - pending      en la bandeja de salida, esperando envío (o reintento con espera).
 *  - sending      reservado por un despachador (bloqueo con caducidad).
 *  - accepted     la API del proveedor ACEPTÓ el mensaje (HTTP 201 con `messageId`). No implica que el
 *                 proveedor lo haya procesado ni que haya llegado a nadie.
 *  - delivered    evento `delivered` del proveedor: el SERVIDOR DE DESTINO aceptó el mensaje. Tampoco
 *                 prueba que el destinatario lo haya visto: «recibido» solo lo confirma una persona en su buzón.
 *  - soft_bounced rebote temporal (el proveedor reintenta por su cuenta).
 *  - bounced      rebote duro (dirección inexistente o inválida): el destinatario queda suprimido.
 *  - blocked      el proveedor bloqueó el envío (destinatario en su lista de bloqueo, etc.).
 *  - complained   el destinatario lo marcó como spam: queda suprimido.
 *  - failed       fallo definitivo nuestro o de la API (rechazo 4xx, reintentos agotados).
 *  - skipped      NO se envió por decisión propia: modo off, sandbox sin autorización, suprimido, límite…
 *                 (`reason` dice cuál). Nada sale.
 */
export const MAIL_STATUSES = ["pending", "sending", "accepted", "delivered", "soft_bounced", "bounced", "blocked", "complained", "failed", "skipped"] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

/** Estados en los que el envío ya no se intentará más (el cuerpo y la dirección se borran). */
export const SETTLED: ReadonlySet<MailStatus> = new Set<MailStatus>(["accepted", "delivered", "soft_bounced", "bounced", "blocked", "complained", "failed", "skipped"]);

export type MailMode = "off" | "sandbox" | "live";

/** Carril de la bandeja de salida: base de la empresa o base del CRM comercial (plataforma). */
export type MailLane = "tenant" | "platform";

/** Categoría del aviso (plantilla), para trazas y límites. Sin datos personales. */
export type MailCategory =
  | "email_verification"
  | "tenant_welcome"
  | "user_invite"
  | "password_reset"
  | "signup_confirmation"
  | "signup_received"
  | "trial_activated"
  | "trial_expiry"
  // Ampliación, pausa o reactivación de la prueba decidida por el equipo
  | "trial_status"
  | "contract_confirmed"
  | "test_payment_confirmed"
  | "payment_confirmed"
  | "invoice_available"
  | "renewal_confirmed"
  | "subscription_reactivated"
  | "payment_failed"
  | "cancellation"
  // Desistimiento de consumidores: acuse de recibo y resolución (server/withdrawals)
  | "withdrawal_receipt"
  // Aviso de seguridad a la propia persona (contraseña cambiada): nunca con enlaces ni copia global
  | "security_notice"
  // Exportación de datos de la empresa (disponible o fallida): solo a quien la pidió, sin copia global
  | "data_export"
  | "withdrawal_resolution"
  // Catálogo de comunicaciones transaccionales (server/notifications/catalog.ts)
  | "subscription_suspended"
  | "subscription_ended"
  | "plan_changed"
  | "access_read_only"
  | "module_activated"
  | "module_change"
  | "refund_recorded"
  | "billing_incident"
  | "quote_sent"
  | "operational"
  | "legacy";

/** Clave de la plantilla del gestor de comunicaciones del Core → categoría del servicio. */
export function categoryForTemplate(templateKey: string | null | undefined): MailCategory {
  const k = (templateKey ?? "").toLowerCase();
  if (k === "quote" || k.startsWith("quote_")) return "quote_sent";
  if (k === "invite") return "user_invite";
  if (k === "password_reset") return "password_reset";
  return "operational";
}

/** Adjunto por URL pública o, si es un fichero privado del almacenamiento, con su contenido en base64. */
export interface MailAttachment {
  name: string;
  url: string;
  content?: string;
}

export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailContent {
  subject: string;
  html: string;
  text?: string;
}

export interface EnqueueInput extends MailContent {
  /** Empresa a la que pertenece (o a la que se refiere, en plataforma). «platform» si no hay. */
  tenantId: string;
  /** Clave de idempotencia: el mismo aviso con la misma clave se envía UNA vez. */
  idempotencyKey: string;
  category: MailCategory;
  to: string;
  cc?: string[];
  attachments?: MailAttachment[];
}

export interface OutboxRow {
  id: number;
  tenantId: string;
  idempotencyKey: string;
  category: string;
  status: MailStatus;
  reason: string | null;
  recipientHash: string;
  recipientMasked: string;
  toEmail: string | null;
  cc: string[];
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  attachments: MailAttachment[];
  provider: string | null;
  providerMessageId: string | null;
  attempts: number;
  nextAttemptAt: number | null;
  lockedUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Mensaje tal y como lo recibe un proveedor. `ref` es opaco (sin datos personales) y vuelve en los webhooks. */
export interface ProviderMessage {
  from: MailAddress;
  replyTo?: string | null;
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
  tag: string;
  ref: string;
  idempotencyKey: string;
}

export interface MailProviderPort {
  readonly name: string;
  send(m: ProviderMessage): Promise<{ messageId: string | null }>;
}

/** Fallo del proveedor. `retryable`: red, 5xx o límite de tasa; el resto (4xx) es definitivo. */
export class MailProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly httpStatus: number | null = null,
  ) {
    super(`Proveedor de correo: ${code}`);
    this.name = "MailProviderError";
  }
}

export type ProviderEventKind = "delivered" | "soft_bounce" | "hard_bounce" | "blocked" | "spam" | "invalid" | "unsubscribed" | "deferred" | "error";

export interface ProviderEvent {
  kind: ProviderEventKind;
  /** Referencia opaca que pusimos al enviar (cabecera X-Mailin-custom). */
  ref: string | null;
  messageId: string | null;
  /** Dirección del destinatario según el proveedor: solo para calcular la huella de supresión. */
  email: string | null;
  /** Identificador del evento para no aplicarlo dos veces. */
  eventId: string;
  reason: string | null;
}
