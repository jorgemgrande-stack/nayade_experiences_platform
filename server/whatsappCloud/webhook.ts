/**
 * Webhook de WhatsApp Cloud API (lógica pura, sin red ni BD):
 *  - verificación de la suscripción (`hub.mode=subscribe`, `hub.verify_token` de la empresa en tiempo constante);
 *  - firma `X-Hub-Signature-256` = HMAC-SHA256 del cuerpo EXACTO con el App Secret de la empresa, en tiempo constante;
 *  - lectura de los cambios `messages`: mensajes entrantes y estados de entrega, SOLO del número de la empresa
 *    (`metadata.phone_number_id` igual al de su credencial; lo demás se descarta: nunca entra en otra empresa).
 */
import crypto from "node:crypto";
import type { MessageStatus } from "../../shared/whatsappCloud";
import { usableWebhookSecret, webhookSecretMatches } from "../_core/webhookSecret";

export const WEBHOOK_MAX_BYTES = 512 * 1024;

/** ¿Firma válida? Sin App Secret no hay webhook (siempre false). */
export function signatureValid(raw: Buffer, header: unknown, appSecret: string | null | undefined): boolean {
  if (!appSecret || typeof header !== "string") return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(raw).digest();
  const given = Buffer.from(m[1].toLowerCase(), "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * Respuesta a la verificación de la suscripción: el `hub.challenge` (solo cifras, como lo envía Meta) si el token
 * coincide con el de la empresa (al menos 24 caracteres); si no, null (403).
 */
export function verifyChallenge(q: Record<string, unknown>, verifyToken: string | null | undefined): string | null {
  const token = usableWebhookSecret(verifyToken);
  if (!token) return null;
  if (q["hub.mode"] !== "subscribe") return null;
  const challenge = typeof q["hub.challenge"] === "string" ? q["hub.challenge"] : "";
  if (!/^[0-9]{1,64}$/.test(challenge)) return null;
  return webhookSecretMatches(q["hub.verify_token"], token) ? challenge : null;
}

export interface InboundMessage {
  wamid: string;
  from: string;
  name: string | null;
  at: string;
  kind: string;
  text: string;
}
/** Avisos de WhatsApp y tipos que no se muestran: se guardan, pero no cuentan como no leídos ni abren la ventana ni la IA. */
export const QUIET_KINDS: ReadonlySet<string> = new Set(["system", "unsupported"]);

export interface StatusUpdate {
  wamid: string;
  status: MessageStatus;
  at: string;
  recipient: string | null;
  errorCode: string | null;
  errorTitle: string | null;
}
export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** Cambios de otro número (descartados). */
  foreign: number;
}

const WA_ID_RE = /^\d{5,32}$/;
const tsIso = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max) : "");

/** Texto que se guarda para cada tipo de mensaje (los adjuntos no se descargan: se indica qué llegó). */
function textOf(m: any): { kind: string; text: string } {
  const type = str(m?.type, 16) || "unknown";
  switch (type) {
    case "text":
      return { kind: "text", text: str(m.text?.body, 4096) };
    case "button":
      return { kind: "button", text: str(m.button?.text, 1000) };
    case "interactive":
      return { kind: "interactive", text: str(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title, 1000) };
    case "image":
    case "video":
    case "document":
    case "audio":
    case "sticker":
      return { kind: type, text: `[${{ image: "Imagen", video: "Vídeo", document: "Documento", audio: "Audio", sticker: "Sticker" }[type]}]${m[type]?.caption ? ` ${str(m[type].caption, 1000)}` : ""}` };
    case "location":
      return { kind: "location", text: `[Ubicación] ${str(m.location?.name ?? "", 200)}`.trim() };
    case "system":
      return { kind: "system", text: `[Aviso de WhatsApp] ${str(m.system?.body ?? "", 500)}`.trim() };
    default:
      return { kind: "unsupported", text: "[Mensaje de un tipo que no se muestra aquí]" };
  }
}

const STATUS_MAP: Record<string, MessageStatus> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

export function parseWebhook(payload: any, phoneNumberId: string): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [], foreign: 0 };
  if (payload?.object !== "whatsapp_business_account") return out;
  for (const entry of Array.isArray(payload.entry) ? payload.entry.slice(0, 50) : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes.slice(0, 50) : []) {
      if (ch?.field !== "messages") continue;
      const v = ch.value ?? {};
      if (String(v.metadata?.phone_number_id ?? "") !== phoneNumberId) {
        out.foreign++;
        continue;
      }
      const names = new Map<string, string>();
      for (const c of Array.isArray(v.contacts) ? v.contacts : []) if (typeof c?.wa_id === "string") names.set(c.wa_id, str(c.profile?.name, 160));
      for (const m of Array.isArray(v.messages) ? v.messages.slice(0, 100) : []) {
        const wamid = str(m?.id, 160);
        const from = str(m?.from, 32);
        if (!wamid || !WA_ID_RE.test(from)) continue;
        // Las reacciones (un emoji sobre otro mensaje) no son mensajes: no se guardan ni cuentan
        if (m.type === "reaction") continue;
        out.messages.push({ wamid, from, name: names.get(from) || null, at: tsIso(m.timestamp), ...textOf(m) });
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses.slice(0, 200) : []) {
        const wamid = str(s?.id, 160);
        const status = STATUS_MAP[String(s?.status ?? "")];
        if (!wamid || !status) continue;
        const e = Array.isArray(s.errors) ? s.errors[0] : null;
        out.statuses.push({ wamid, status, at: tsIso(s.timestamp), recipient: str(s.recipient_id, 32) || null, errorCode: e?.code != null ? String(e.code).slice(0, 16) : null, errorTitle: e ? str(e.title ?? e.message, 200) || null : null });
      }
    }
  }
  return out;
}
