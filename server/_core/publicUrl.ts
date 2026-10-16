/**
 * URL base de confianza para construir enlaces enviados por e-mail (recuperación de
 * contraseña, invitaciones…).
 *
 * NUNCA debe derivarse de un dato que controle el cliente (cuerpo de la petición,
 * `Origin`, `Host`): un atacante pediría un enlace para la cuenta de otra persona con su
 * propio dominio y recibiría el token cuando la víctima pulsase el enlace legítimo.
 *
 * Multiempresa: la URL pública de la empresa en curso según el registro (dominio propio
 * verificado o subdominio de plataforma), que tampoco controla el cliente. Sin ella, la
 * configurada para la instalación.
 */
import { tenantPublicUrl } from "./tenantIdentity";

export function getTrustedBaseUrl(): string {
  const tenantUrl = tenantPublicUrl();
  if (tenantUrl) return tenantUrl;

  const configured = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  if (process.env.NODE_ENV !== "production") {
    return `http://localhost:${process.env.PORT ?? 3000}`;
  }
  // En producción sin APP_URL no se improvisa una URL: se falla de forma visible.
  throw new Error("APP_URL no está configurada: no se puede construir un enlace seguro.");
}
