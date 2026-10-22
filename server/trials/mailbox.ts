/**
 * Buzón de un correo: lo que identifica a la persona detrás de sus alias. Se usa para impedir varias pruebas
 * abiertas a la vez con variantes del mismo buzón (antiabuso del alta autoservicio).
 */

/** Buzón (minúsculas): sin la etiqueta `+loquesea` del usuario. */
export function mailboxOf(email: string): { base: string; domain: string } {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  return { base: plus > 0 ? local.slice(0, plus) : local, domain: email.slice(at + 1) };
}

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * Buzón canónico: minúsculas, sin `+etiqueta` y, en Gmail, sin puntos y con googlemail.com como gmail.com
 * («a.na+x@googlemail.com» → «ana@gmail.com»). Es EXACTAMENTE la expresión de la columna `open_mailbox`
 * (db/crm/migrations/0023), que impone en la BD una sola prueba abierta por buzón.
 */
export function canonicalMailbox(email: string): string {
  const { base, domain } = mailboxOf(email.toLowerCase());
  return GMAIL.has(domain) ? `${base.replace(/\./g, "")}@gmail.com` : `${base}@${domain}`;
}
