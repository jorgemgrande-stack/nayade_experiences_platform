/**
 * Lista blanca de claves de `site_settings` que pueden publicarse en /kb y /kb.json.
 *
 * Esos endpoints son públicos y sin autenticación. `site_settings` es una tabla de
 * clave/valor de propósito general en la que también viven credenciales de integración
 * (tokens y secretos de webhook de GHL/VAPI, datos bancarios, etc.), así que NUNCA se
 * debe volcar entera: solo se publica lo que esté listado aquí de forma explícita.
 *
 * Para publicar una clave nueva hay que añadirla a mano a KB_PUBLIC_SETTING_KEYS.
 * Como red de seguridad adicional, una clave cuyo nombre parezca sensible se rechaza
 * aunque alguien la añada por error a la lista.
 */

export const KB_PUBLIC_SETTING_KEYS = [
  // Información general del negocio
  "company_name",
  "tagline",
  "about",
  "phone",
  "email",
  "whatsapp",
  "address",
  "schedule",
  "cancellation_policy",
  "booking_policy",
  "faqs",
  // Identificación legal que ya es pública en el aviso legal y las facturas
  "legalCompanyName",
  "legalCompanyCif",
  "legalCompanyAddress",
  "legalCompanyCity",
  "legalCompanyZip",
  "legalCompanyProvince",
  "legalCompanyEmail",
  "legalCompanyPhone",
] as const;

/** Nombres de clave que nunca deben publicarse, aunque figuren en la lista blanca. */
const SENSITIVE_KEY_PATTERN =
  /(token|secret|api[_-]?key|password|passwd|iban|webhook|credential|private|bearer|signature)/i;

const ALLOWED = new Set<string>(KB_PUBLIC_SETTING_KEYS);

export function isPublicKbSettingKey(key: string): boolean {
  return ALLOWED.has(key) && !SENSITIVE_KEY_PATTERN.test(key);
}

/** Devuelve solo las filas publicables, como mapa clave → valor (omite vacíos y nulos). */
export function pickPublicKbSettings(
  rows: ReadonlyArray<{ key: string; value: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!isPublicKbSettingKey(row.key)) continue;
    if (typeof row.value !== "string" || row.value === "") continue;
    out[row.key] = row.value;
  }
  return out;
}
