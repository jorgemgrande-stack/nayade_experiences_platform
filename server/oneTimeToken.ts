import { createHash } from "crypto";

/**
 * Tokens de un solo uso (recuperación de contraseña e invitaciones): en la BD se guarda SOLO su hash SHA-256;
 * el valor en claro viaja únicamente en el enlace del correo. Quien lea la tabla (un volcado, una copia de
 * seguridad, una inyección de lectura) no puede usar lo que ve como enlace válido.
 *
 * Adaptado de Skicenter (server/oneTimeToken.ts, 83623238 y 7599aa3f). Diferencia: el valor guardado lleva el
 * prefijo `sha256:` para distinguirlo sin ambigüedad de un token antiguo en claro (algunos tokens antiguos son
 * 64 caracteres hexadecimales, con la misma forma que un hash). Los tokens tienen 192-384 bits de entropía,
 * así que un hash rápido sin sal basta (no son contraseñas elegidas por personas).
 */
export const HASHED_TOKEN_PREFIX = "sha256:";

/** Valor que se guarda en la BD para un token en claro. */
export function hashOneTimeToken(raw: string): string {
  return HASHED_TOKEN_PREFIX + createHash("sha256").update(String(raw), "utf8").digest("hex");
}

/**
 * Valores guardados que aceptan el token presentado. Ventana de compatibilidad: los enlaces emitidos antes de
 * este cambio están en claro en la BD y siguen valiendo hasta que caduquen (60 minutos la recuperación, días
 * la invitación). Un valor con el prefijo del hash NUNCA se compara literalmente: si no, el hash que ve quien
 * lea la tabla serviría como token.
 */
export function oneTimeTokenCandidates(raw: string): string[] {
  const token = String(raw);
  const candidates = [hashOneTimeToken(token)];
  if (!token.startsWith(HASHED_TOKEN_PREFIX)) candidates.push(token);
  return candidates;
}
