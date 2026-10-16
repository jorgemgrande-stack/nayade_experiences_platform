/**
 * Logs operativos estructurados (una línea JSON por evento), con el mismo formato que el resto del
 * proyecto (`{ ctx, event, ... }`) más el identificador de correlación y el tenant cuando existen.
 *
 * Sin datos personales innecesarios ni secretos:
 *  - Claves de aspecto sensible (contraseñas, tokens, secretos, DSN, cookies…) → "[redactado]".
 *  - Direcciones de correo en cualquier texto → solo la inicial y el dominio (`a***@dominio.example`).
 *  - Cadenas largas con aspecto de token (JWT, hex/base64 largos) → "[token]".
 *  - Textos recortados a 200 caracteres; objetos anidados hasta 3 niveles.
 */
import { peekTenantContext } from "../tenant";
import { getRequestId } from "./requestContext";

export type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word|wd)?|token|secret|dsn|cookie|authorization|cipher|credential|api[-_]?key|signature|hash/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;
const MAX_TEXT = 200;

/** `ana.perez@empresa.example` → `a***@empresa.example`. */
export function maskEmail(email: string): string {
  return email.replace(EMAIL, (_m, first: string, domain: string) => `${first}***@${domain.toLowerCase()}`);
}

/** Limpia un texto libre (mensajes de error, detalles) antes de escribirlo en un log. */
export function scrubText(s: string): string {
  return maskEmail(s.replace(JWT, "[token]").replace(LONG_TOKEN, "[token]")).slice(0, MAX_TEXT);
}

export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return value.name;
  if (depth >= 3) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redactado]" : scrub(v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_TEXT);
}

export type LogSink = (level: LogLevel, line: string) => void;

const consoleSink: LogSink = (level, line) => (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
let sink: LogSink = consoleSink;

/** Solo para pruebas: captura las líneas emitidas. `null` restaura la consola. */
export function setLogSink(s: LogSink | null): void {
  sink = s ?? consoleSink;
}

/** Construye la línea de log (sin emitirla). */
export function formatOpsLog(ctx: string, event: string, data: Record<string, unknown> = {}): string {
  const requestId = getRequestId();
  const tenantId = peekTenantContext()?.tenantId;
  const body = scrub(data) as Record<string, unknown>;
  return JSON.stringify({
    ctx,
    event,
    ...body,
    ...(tenantId && body.tenantId === undefined ? { tenantId } : {}),
    ...(requestId ? { requestId } : {}),
  });
}

/** Emite un evento operativo estructurado. Nunca lanza. */
export function opsLog(level: LogLevel, ctx: string, event: string, data: Record<string, unknown> = {}): void {
  try {
    sink(level, formatOpsLog(ctx, event, data));
  } catch {
    /* un log nunca rompe la operación */
  }
}
