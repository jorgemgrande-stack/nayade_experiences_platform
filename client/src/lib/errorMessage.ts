/**
 * Mensajes de error legibles para el panel (sin detalles técnicos) y aviso emergente común.
 * Lógica pura salvo `toastError`; la usan PanelStates y las pantallas del panel.
 */
import { toast } from "sonner";

type ErrLike = { data?: { code?: string; httpStatus?: number }; message?: string } | null | undefined;

const NETWORK_RE = /fetch|network|Failed to/i;

/** Mensaje legible a partir de un error de tRPC (sin detalles técnicos). */
export function errorMessage(err: unknown, fallback = "No se han podido cargar los datos."): string {
  const e = err as ErrLike;
  const code = e?.data?.code;
  const status = e?.data?.httpStatus;
  if (code === "FORBIDDEN" || status === 403) return "Tu plan o tu usuario no tienen acceso a esta sección.";
  if (code === "UNAUTHORIZED" || status === 401) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  if (status === 503) return "El servicio no está disponible en este momento. Inténtalo de nuevo en unos minutos.";
  if (e?.message && NETWORK_RE.test(e.message)) return "No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
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
  return clean;
}

/** Texto del aviso de error de una operación: el mensaje funcional del servidor o uno genérico. */
export function errorToastMessage(err: unknown, fallback = "No se ha podido completar la operación. Inténtalo de nuevo."): string {
  const e = err as ErrLike;
  const code = e?.data?.code;
  if (code === "UNAUTHORIZED" || e?.data?.httpStatus === 401) return errorMessage(err);
  if (e?.message && NETWORK_RE.test(e.message)) return errorMessage(err);
  const fromServer = serverMessage(err);
  if (fromServer) return fromServer;
  if (code === "BAD_REQUEST") return "Revisa los datos: hay campos incompletos o con un formato no válido.";
  return errorMessage(err, fallback);
}

/** Aviso emergente de error común del panel (sustituye a `toast.error(e.message)`). */
export function toastError(err: unknown, fallback?: string): void {
  toast.error(errorToastMessage(err, fallback));
}
