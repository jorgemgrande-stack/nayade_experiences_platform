/**
 * Mensajes de error legibles para el panel (sin detalles técnicos) y aviso emergente común.
 * Lógica pura salvo `toastError`; la usan PanelStates y las pantallas del panel.
 */
import { toast } from "sonner";
import { readOnlyBlockStatus } from "@shared/subscriptionRecovery";
import { SERVER_MESSAGE_KEYS } from "@shared/i18n/serverMessages";
import { DEFAULT_LOCALE } from "@shared/i18n/core";
import { getCurrentLocale, getT } from "@/i18n/standalone";

type ErrLike = { data?: { code?: string; httpStatus?: number }; message?: string } | null | undefined;

const NETWORK_RE = /fetch|network|Failed to/i;

/** Mensaje legible a partir de un error de tRPC (sin detalles técnicos). */
export function errorMessage(err: unknown, fallback?: string): string {
  const t = getT();
  if (fallback === undefined) fallback = t("common.error.load");
  const e = err as ErrLike;
  const code = e?.data?.code;
  const status = e?.data?.httpStatus;
  if (code === "FORBIDDEN" || status === 403) return t("common.error.forbidden");
  if (code === "UNAUTHORIZED" || status === 401) return t("common.error.session");
  if (status === 503) return t("common.error.unavailable");
  if (e?.message && NETWORK_RE.test(e.message)) return t("common.error.network");
  return fallback;
}

/** Texto técnico o en inglés que no debe verse tal cual (validación, trazas, infraestructura). */
const TECHNICAL_RE =
  /^\s*[[{]|Error:|TRPC|\bundefined\b|\bnull\b|NaN|Database|not available|is not|Cannot |Unexpected|ECONN|ETIMEDOUT|\bSQL\b|\bER_|stack|Failed|Internal Server Error|Please login|permission|Invalid|Expected|Required|must |at least|characters?\b|too_(small|big)/i;

/**
 * Mensaje funcional del servidor si es legible («Ya existe un código con ese nombre»), sin el
 * código interno entre paréntesis; null si es técnico, vacío o demasiado largo.
 */
export function serverMessage(err: unknown): string | null {
  const msg = (err as ErrLike)?.message;
  if (typeof msg !== "string") return null;
  const clean = msg.replace(/\s*\(\d{5}\)\s*$/, "").trim();
  if (!clean || clean.length > 300 || TECHNICAL_RE.test(clean)) return null;
  return translateServerMessage(clean);
}

/** Traduce en el cliente un mensaje del servidor (español) si hay equivalente; sin coincidencia exacta, devuelve el original. */
export function translateServerMessage(message: string): string {
  if (getCurrentLocale() === DEFAULT_LOCALE) return message;
  const key = SERVER_MESSAGE_KEYS[message];
  return key ? getT()(key) : message;
}

/** Texto del aviso de error de una operación: el mensaje funcional del servidor o uno genérico. */
export function errorToastMessage(err: unknown, fallback?: string): string {
  const t = getT();
  if (fallback === undefined) fallback = t("errors.operationFailed");
  const e = err as ErrLike;
  const code = e?.data?.code;
  // En el panel se explica el plan; fuera (p. ej. el área de miembros) quien lo lee no gestiona la suscripción
  // Rechazo de escritura con la licencia en consulta (el aviso con la acción de reactivar lo da readOnlyBlock.ts)
  const blocked = readOnlyBlockStatus(err);
  if (blocked) return typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? t(blocked === "read_only" ? "errors.readOnly" : "errors.expired") : t("errors.actionUnavailable");
  if (code === "UNAUTHORIZED" || e?.data?.httpStatus === 401) return errorMessage(err);
  if (e?.message && NETWORK_RE.test(e.message)) return errorMessage(err);
  const fromServer = serverMessage(err);
  if (fromServer) return fromServer;
  if (code === "BAD_REQUEST") return t("errors.badRequest");
  return errorMessage(err, fallback);
}

/** Aviso emergente de error común del panel (sustituye a `toast.error(e.message)`). */
export function toastError(err: unknown, fallback?: string): void {
  toast.error(errorToastMessage(err, fallback));
}
