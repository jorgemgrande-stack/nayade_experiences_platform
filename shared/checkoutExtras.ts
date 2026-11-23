/**
 * Datos añadidos al pedido de la tienda al pagar (23/11/2026), todos aditivos y sin tocar precios ni catálogo:
 *
 *  - Aceptación de condiciones: casilla obligatoria ANTES de pagar, solo cuando la empresa la ha configurado
 *    (direcciones de condiciones, privacidad o cancelación, o el interruptor `checkout_consent_required`). Sin
 *    configuración no cambia nada (Náyade, Skicenter…). El texto lo compone el servidor con el diccionario de la web
 *    (shared/siteUiText.ts), así lo guardado es exactamente lo que se enseñó. NO es texto legal: es neutro y editable;
 *    el contenido de las condiciones y los plazos de cancelación son de la empresa (pendiente de Quantum/Dirección).
 *  - Idioma de quien compra: el de la web en que compró, para los correos y las páginas de retorno.
 *  - Participantes: nombre de cada participante cuando la cantidad es mayor que 1 (opcional y activable).
 *
 * Todo se guarda en el historial de cada línea del pedido (`reservations.changes_log`), como los datos fiscales
 * (shared/shopOrders.ts): sin columnas nuevas y sin migración de esquema.
 */
import { fillUiText, type SiteUiText } from "./siteUiText";

export const CHECKOUT_SETTINGS = {
  termsUrl: "checkout_terms_url",
  privacyUrl: "checkout_privacy_url",
  cancellationUrl: "checkout_cancellation_url",
  consentRequired: "checkout_consent_required",
  participants: "checkout_participants_enabled",
} as const;

export interface CheckoutConfig {
  /** ¿Hay que aceptar las condiciones antes de pagar? Solo si la empresa lo ha configurado. */
  consentRequired: boolean;
  termsUrl: string;
  privacyUrl: string;
  cancellationUrl: string;
  /** ¿Se piden los nombres de los participantes (cantidad mayor que 1)? */
  participantsEnabled: boolean;
}

/** Sin configuración: no se exige nada (comportamiento de siempre). */
export const DEFAULT_CHECKOUT_CONFIG: CheckoutConfig = { consentRequired: false, termsUrl: "", privacyUrl: "", cancellationUrl: "", participantsEnabled: false };

/** Dirección de un texto legal: ruta de la propia web («/condiciones») o dirección https. Otra cosa, nada. */
export function safeLegalUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 500) return "";
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const isTrue = (v: unknown) => String(v ?? "").trim().toLowerCase() === "true";

/** Configuración del pago a partir de los ajustes de la empresa (`system_settings`). */
export function checkoutConfigFrom(settings: Record<string, string | null | undefined>): CheckoutConfig {
  const termsUrl = safeLegalUrl(settings[CHECKOUT_SETTINGS.termsUrl]);
  const privacyUrl = safeLegalUrl(settings[CHECKOUT_SETTINGS.privacyUrl]);
  const cancellationUrl = safeLegalUrl(settings[CHECKOUT_SETTINGS.cancellationUrl]);
  return {
    consentRequired: isTrue(settings[CHECKOUT_SETTINGS.consentRequired]) || !!(termsUrl || privacyUrl || cancellationUrl),
    termsUrl,
    privacyUrl,
    cancellationUrl,
    participantsEnabled: isTrue(settings[CHECKOUT_SETTINGS.participants]),
  };
}

export interface ConsentItem {
  kind: "terms" | "privacy" | "cancellation";
  label: string;
  href: string | null;
}

/**
 * Lo que se acepta: con direcciones configuradas, solo lo que tiene dirección; con el interruptor y sin direcciones,
 * las tres cosas sin enlace (texto neutro por completar).
 */
export function consentItems(cfg: CheckoutConfig, t: SiteUiText): ConsentItem[] {
  const all: ConsentItem[] = [
    { kind: "terms", label: t.coConsentTerms, href: cfg.termsUrl || null },
    { kind: "privacy", label: t.coConsentPrivacy, href: cfg.privacyUrl || null },
    { kind: "cancellation", label: t.coConsentCancellation, href: cfg.cancellationUrl || null },
  ];
  const withUrl = all.filter((i) => i.href);
  return withUrl.length ? withUrl : all;
}

/** «a, b y c» en el idioma de la página. */
export function joinList(labels: string[], and: string): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} ${and} ${labels[labels.length - 1]}`;
}

/** Frase de aceptación en texto plano (la que se guarda con el pedido). */
export function consentSentenceText(cfg: CheckoutConfig, t: SiteUiText): string {
  return fillUiText(t.coConsentTemplate, { list: joinList(consentItems(cfg, t).map((i) => i.label), t.coConsentAnd) });
}

/** Frase de aceptación en piezas (texto y enlaces) para pintarla con enlaces reales. */
export function consentSentenceParts(cfg: CheckoutConfig, t: SiteUiText): Array<{ text: string; href: string | null }> {
  const items = consentItems(cfg, t);
  const [before, after = ""] = t.coConsentTemplate.split("{list}");
  const parts: Array<{ text: string; href: string | null }> = [];
  if (before) parts.push({ text: before, href: null });
  items.forEach((it, i) => {
    if (i > 0) parts.push({ text: i === items.length - 1 ? ` ${t.coConsentAnd} ` : ", ", href: null });
    parts.push({ text: it.label, href: it.href });
  });
  if (after) parts.push({ text: after, href: null });
  return parts;
}

// ─── Historial del pedido ────────────────────────────────────────────────────

export const CONSENT_LOG_ACTION = "aceptacion_condiciones";
export const LOCALE_LOG_ACTION = "idioma_comprador";
export const PARTICIPANTS_LOG_ACTION = "participantes";

export interface OrderConsent {
  /** Frase exacta que se enseñó y se aceptó. */
  text: string;
  /** Huella SHA-256 (hexadecimal) del texto y las direcciones: identifica la versión aceptada. */
  textHash: string;
  locale: string;
  acceptedAt: number;
  ip: string | null;
  urls: { terms?: string; privacy?: string; cancellation?: string };
}

type LogEntry = { ts: number; actor: string; action: string; to: string };

export function consentLogEntry(c: OrderConsent): LogEntry {
  return { ts: c.acceptedAt, actor: "Comprador", action: CONSENT_LOG_ACTION, to: JSON.stringify(c) };
}

function lastEntry(log: unknown, action: string): string | null {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i] as { action?: string; to?: string } | null;
    if (e?.action === action && typeof e.to === "string") return e.to;
  }
  return null;
}

export function consentFromLog(log: unknown): OrderConsent | null {
  const raw = lastEntry(log, CONSENT_LOG_ACTION);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<OrderConsent>;
    if (typeof c.text !== "string" || typeof c.textHash !== "string") return null;
    return { text: c.text, textHash: c.textHash, locale: String(c.locale ?? ""), acceptedAt: Number(c.acceptedAt) || 0, ip: c.ip ? String(c.ip) : null, urls: c.urls ?? {} };
  } catch {
    return null;
  }
}

export function localeLogEntry(locale: string, now: number): LogEntry {
  return { ts: now, actor: "Comprador", action: LOCALE_LOG_ACTION, to: locale };
}

/** Idioma en que compró la persona, o null. */
export function localeFromLog(log: unknown): string | null {
  const v = lastEntry(log, LOCALE_LOG_ACTION);
  return v && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v) ? v : null;
}

export const MAX_PARTICIPANTS = 100;
export const MAX_PARTICIPANT_NAME = 120;

/** Nombres válidos: sin vacíos, recortados, sin pasar de la cantidad de la línea. */
export function cleanParticipants(names: unknown, quantity: number): string[] {
  if (!Array.isArray(names)) return [];
  const limit = Math.max(0, Math.min(MAX_PARTICIPANTS, Math.floor(Number(quantity) || 0)));
  return names
    .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, MAX_PARTICIPANT_NAME) : ""))
    .filter(Boolean)
    .slice(0, limit);
}

export function participantsLogEntry(names: string[], now: number): LogEntry {
  return { ts: now, actor: "Comprador", action: PARTICIPANTS_LOG_ACTION, to: JSON.stringify(names) };
}

export function participantsFromLog(log: unknown): string[] {
  const raw = lastEntry(log, PARTICIPANTS_LOG_ACTION);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, MAX_PARTICIPANTS) : [];
  } catch {
    return [];
  }
}

/** Primera pieza del idioma («de-AT» → «de»), o null si no es un código de idioma. */
export function normalizeBuyerLocale(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(s) ? s : null;
}
