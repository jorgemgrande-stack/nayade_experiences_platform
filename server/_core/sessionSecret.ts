/**
 * Clave de firma de sesiones y enlaces firmados (JWT_SECRET).
 *
 * En producción no hay valor por defecto: sin JWT_SECRET (o con el valor de desarrollo publicado)
 * no se emiten ni aceptan sesiones — el inicio de sesión responde 503 y el arranque no se rompe.
 * Fuera de producción se mantiene el valor de desarrollo para no estorbar en local.
 */
const DEV_FALLBACK = "local-dev-secret-change-me";

export function sessionSecret(): string | null {
  const raw = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!raw || raw === DEV_FALLBACK) return null;
    return raw;
  }
  return raw || DEV_FALLBACK;
}

export class SessionSecretMissingError extends Error {
  constructor() {
    super("JWT_SECRET no configurado: sesiones desactivadas");
    this.name = "SessionSecretMissingError";
  }
}

export function requireSessionSecret(): string {
  const s = sessionSecret();
  if (!s) throw new SessionSecretMissingError();
  return s;
}
