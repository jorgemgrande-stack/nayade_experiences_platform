/**
 * Atributos para los campos de credenciales de SERVICIOS EXTERNOS del panel (correo IMAP/SMTP, pasarelas de pago,
 * Postmark, Vapi, WhatsApp…). No son el inicio de sesión del administrador, pero Chrome y los gestores de contraseñas
 * los tratan como tales y los rellenan con el correo o la contraseña del administrador. Si se guardara eso, la
 * credencial del servicio quedaría mal (y la contraseña del administrador acabaría en una integración).
 *
 * Qué se hace y qué no se puede garantizar:
 *  - Secretos: `type="password"` + `autoComplete="new-password"` (Chrome no ofrece la contraseña guardada).
 *  - Usuarios e identificadores del servicio: `autoComplete="off"` + `name`/`id` específicos (nunca `username`,
 *    `password` ni `email`) + pistas de gestores: `data-lpignore` (LastPass), `data-1p-ignore` (1Password),
 *    `data-bwignore` (Bitwarden) y `data-form-type="other"` (Dashlane).
 *  - `autoComplete="off"` por sí solo NO obliga a Chrome ni a los gestores a ignorar el campo: la combinación reduce
 *    el riesgo, no lo elimina.
 */
export const MANAGER_HINTS = {
  autoComplete: "off",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/** Usuario, terminal, FUC, identificador… de un servicio externo (texto, nunca precargado con datos del administrador). */
export function serviceFieldProps(name: string) {
  return { ...MANAGER_HINTS, name, id: name } as const;
}

/** Secreto de un servicio externo (contraseña, clave, token, secreto de webhook). */
export function serviceSecretProps(name: string) {
  return { ...MANAGER_HINTS, autoComplete: "new-password", name, id: name } as const;
}
