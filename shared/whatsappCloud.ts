/**
 * Elephant WhatsApp AI — lógica pura compartida (servidor, panel y pruebas): WhatsApp Cloud API de Meta con el número
 * PROPIO de cada empresa, ventana de atención de 24 h, plantillas aprobadas y modos de la IA (apagada por defecto).
 */
import { hoursProblem, isValidTimezone, type HoursRange } from "./receptionAi";

export const WHATSAPP_CAPABILITY = "whatsapp-ai";
/** Proveedor de la bóveda de cada empresa (server/_core/credentials/catalog.ts). */
export const WHATSAPP_PROVIDER = "whatsapp_cloud";
/** Ruta pública del webhook (en el dominio de la empresa) que se configura en la app de Meta. */
export const WHATSAPP_WEBHOOK_PATH = "/api/whatsapp/webhook";
export const GRAPH_VERSION = "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** off: sin IA · suggest: la IA propone y el agente revisa y envía · auto: además responde sola en su horario y con tope. */
export const WHATSAPP_AI_MODES = ["off", "suggest", "auto"] as const;
export type WhatsappAiMode = (typeof WHATSAPP_AI_MODES)[number];
export const WHATSAPP_AI_MODE_LABELS: Record<WhatsappAiMode, string> = {
  off: "Apagada",
  suggest: "Sugerencias (el equipo revisa y envía)",
  auto: "Sugerencias y respuesta automática en su horario",
};

export type MessageDirection = "in" | "out";
/** customer: el cliente · agent: el equipo · ai_suggested: sugerencia de la IA revisada y enviada por el equipo · ai_auto: la IA, sola. */
export type MessageOrigin = "customer" | "agent" | "ai_suggested" | "ai_auto";
export const MESSAGE_ORIGIN_LABELS: Record<MessageOrigin, string> = { customer: "Cliente", agent: "Equipo", ai_suggested: "Sugerencia de la IA revisada", ai_auto: "IA (automática)" };
export const MESSAGE_STATUSES = ["received", "pending", "sent", "delivered", "read", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = { received: "Recibido", pending: "Enviando", sent: "Enviado", delivered: "Entregado", read: "Leído", failed: "No entregado" };

export type AiLogMode = "suggest" | "auto";
/** suggested: propuesta al agente · sent: enviada sola · handoff: pasó a una persona · skipped_*: no respondió · error. */
export const AI_LOG_OUTCOMES = ["suggested", "sent", "handoff", "skipped_hours", "skipped_quota", "skipped_window", "error"] as const;
export type AiLogOutcome = (typeof AI_LOG_OUTCOMES)[number];
export const AI_LOG_OUTCOME_LABELS: Record<AiLogOutcome, string> = {
  suggested: "Sugerencia al equipo",
  sent: "Respondida sola",
  handoff: "Pasada a una persona",
  skipped_hours: "Fuera de su horario",
  skipped_quota: "Tope diario alcanzado",
  skipped_window: "Fuera de la ventana de 24 h",
  error: "La IA no respondió",
};

export const WHATSAPP_LIMITS = {
  textMax: 4096,
  /** Ventana de atención: desde el último mensaje del cliente se puede responder con texto libre durante 24 h. */
  windowMs: 24 * 60 * 60 * 1000,
  autoDailyMin: 1,
  autoDailyMax: 2000,
  autoDailyDefault: 50,
  /** Respuestas automáticas por conversación (después pasa a una persona). */
  autoPerConversation: 5,
  /** Mensajes anteriores que se envían a la IA. */
  historyMax: 12,
  keywordsMax: 400,
  extraRulesMax: 1500,
  templateParamsMax: 10,
  templateParamMax: 300,
} as const;

/** Sin «persona» suelta: «personas», «por persona» o «para 4 personas» son preguntas normales de reserva. */
export const DEFAULT_HANDOFF_KEYWORDS = "hablar con una persona, persona real, humano, agente, reclamación, queja";

export interface WhatsappSettings {
  aiMode: WhatsappAiMode;
  autoHours: HoursRange[];
  autoDailyLimit: number;
  handoffKeywords: string | null;
  extraRules: string | null;
  timezone: string;
  updatedAt: string | null;
}

export const DEFAULT_WHATSAPP_SETTINGS: WhatsappSettings = {
  aiMode: "off",
  autoHours: [],
  autoDailyLimit: WHATSAPP_LIMITS.autoDailyDefault,
  handoffKeywords: DEFAULT_HANDOFF_KEYWORDS,
  extraRules: null,
  timezone: "Europe/Madrid",
  updatedAt: null,
};

export type WhatsappSettingsInput = Omit<WhatsappSettings, "updatedAt">;

/** Problema de la configuración (texto para el panel) o null si se puede guardar. */
export function whatsappSettingsProblem(s: WhatsappSettingsInput): string | null {
  if (!WHATSAPP_AI_MODES.includes(s.aiMode)) return "Modo de la IA no válido.";
  if (!Number.isInteger(s.autoDailyLimit) || s.autoDailyLimit < WHATSAPP_LIMITS.autoDailyMin || s.autoDailyLimit > WHATSAPP_LIMITS.autoDailyMax)
    return `El máximo de respuestas automáticas al día va de ${WHATSAPP_LIMITS.autoDailyMin} a ${WHATSAPP_LIMITS.autoDailyMax}.`;
  if (!isValidTimezone(s.timezone)) return "Zona horaria no válida.";
  const h = hoursProblem(s.autoHours);
  if (h) return h;
  if (s.aiMode === "auto" && !s.autoHours.length) return "Para que la IA responda sola, indica en qué horario puede hacerlo.";
  if ((s.handoffKeywords ?? "").length > WHATSAPP_LIMITS.keywordsMax) return `Las palabras de traspaso ocupan como mucho ${WHATSAPP_LIMITS.keywordsMax} caracteres.`;
  if ((s.extraRules ?? "").length > WHATSAPP_LIMITS.extraRulesMax) return `Las indicaciones ocupan como mucho ${WHATSAPP_LIMITS.extraRulesMax} caracteres.`;
  return null;
}

// ─── Ventana de 24 h ─────────────────────────────────────────────────────────

/** Fin de la ventana de atención (ISO) o null si el cliente nunca ha escrito. */
export function windowEndsAt(lastInboundAt: string | null): string | null {
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) ? new Date(t + WHATSAPP_LIMITS.windowMs).toISOString() : null;
}

/** ¿Se puede responder con texto libre? Solo dentro de las 24 h desde el último mensaje del cliente. */
export function windowOpen(lastInboundAt: string | null, now: Date): boolean {
  const end = windowEndsAt(lastInboundAt);
  return !!end && now.getTime() < Date.parse(end);
}

// ─── Traspaso a una persona ──────────────────────────────────────────────────

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** ¿Pide el cliente hablar con una persona? (palabras de traspaso separadas por comas, sin mayúsculas ni tildes). */
export function wantsHuman(text: string, keywords: string | null): boolean {
  const t = ` ${fold(text)} `;
  return (keywords ?? "")
    .split(",")
    .map(fold)
    .filter((k) => k.length >= 3)
    .some((k) => t.includes(` ${k} `));
}

// ─── Plantillas ──────────────────────────────────────────────────────────────

export interface WhatsappTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  /** Texto del cuerpo con {{1}}, {{2}}… */
  body: string;
  /** Número de variables del cuerpo. */
  params: number;
}

/** Variables {{n}} del texto del cuerpo (la API exige tantas como la mayor). */
export function templateParamCount(body: string): number {
  let max = 0;
  for (const m of Array.from(body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g))) max = Math.max(max, Number(m[1]));
  return max;
}

/** Texto de la plantilla con sus variables rellenas (lo que se guarda en el registro). */
export function renderTemplate(body: string, params: readonly string[]): string {
  return body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/** Orden de los estados de entrega: un estado nunca vuelve atrás (p. ej. «leído» no pasa a «entregado»). */
export const STATUS_RANK: Record<MessageStatus, number> = { received: 0, pending: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
export function nextStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  if (current === "failed" || current === "read") return current;
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}

/** Fecha y hora («dd/mm/aa, hh:mm») en la zona horaria de la empresa; Europe/Madrid si no hay otra válida. */
export function formatInZone(iso: string | null, timeZone?: string | null): string {
  if (!iso) return "—";
  const fmt = (tz: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(iso));
  try {
    return fmt(timeZone || "Europe/Madrid");
  } catch {
    return fmt("Europe/Madrid");
  }
}
