/**
 * Secretos compartidos de webhooks entrantes (GHL, VAPI…).
 *
 * Reglas:
 *  - Nunca hay un valor por defecto: sin un secreto configurado y suficientemente largo el
 *    webhook queda INACTIVO (rechaza) — no se procesa nada «abierto».
 *  - Los valores que han estado publicados como predeterminados se tratan como no configurados.
 *  - La comparación es en tiempo constante.
 *
 * No afecta al arranque: se evalúa en cada petición.
 */
import { createHash, timingSafeEqual } from "crypto";

export const MIN_WEBHOOK_SECRET_LENGTH = 24;

/** Valores que estuvieron como predeterminados en el código: públicos, nunca válidos. */
const PUBLISHED_DEFAULTS = new Set(["NAYADE2026_ULTRA"]);

/** Devuelve el secreto si es utilizable; si no, `null` (webhook inactivo). */
export function usableWebhookSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length < MIN_WEBHOOK_SECRET_LENGTH) return null;
  if (PUBLISHED_DEFAULTS.has(v)) return null;
  return v;
}

/** ¿Es un valor publicado como predeterminado (o vacío)? Se ignora al guardar credenciales. */
export function isPublishedDefaultSecret(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "" || PUBLISHED_DEFAULTS.has(value.trim());
}

/** Comparación en tiempo constante (compara hashes de igual longitud). */
export function webhookSecretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided === "" || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type WebhookAuthResult = "ok" | "inactive" | "invalid";

/**
 * Verifica la petición contra el primer secreto configurado de la lista (en orden de prioridad).
 * Un secreto configurado pero demasiado corto deja el webhook inactivo (no se cae al siguiente).
 */
export function checkWebhookSecret(provided: unknown, configured: unknown): WebhookAuthResult {
  const secret = usableWebhookSecret(configured);
  if (!secret) return "inactive";
  return webhookSecretMatches(provided, secret) ? "ok" : "invalid";
}
