/**
 * Email de relleno para un contacto que llega sin email (llamada del agente de voz, contacto de una integración).
 * Usa el dominio reservado `.invalid` (RFC 2606): nunca recibe correo ni pertenece a ninguna empresa.
 * Los contactos antiguos conservan el sufijo heredado `@noreply.nayade`, que también se reconoce.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "sin-email.invalid";
const LEGACY_PLACEHOLDER_DOMAIN = "noreply.nayade";

export function placeholderEmail(source: string, id: string | number): string {
  return `${source}-${id}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  return domain === PLACEHOLDER_EMAIL_DOMAIN || domain === LEGACY_PLACEHOLDER_DOMAIN;
}
