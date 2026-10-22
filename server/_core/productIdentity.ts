/**
 * Identidad del PRODUCTO (Elephant Source), separada de la marca de cada empresa cliente.
 *
 * La marca que ve el cliente final (nombre, logotipo, dominio, textos legales) es de cada empresa y
 * sale de su configuración (`site_settings`). Aquí solo está la identidad del producto y la URL
 * pública de la instalación.
 *
 * `publicBaseUrl()` es el único punto de la URL pública de la instalación (antes, ~25 respaldos fijos al dominio de la
 * instalación original, retirados el 23/10/2026).
 * Multiempresa: la URL de la empresa en curso sale del registro (ver `tenantIdentity.ts`).
 */
import { isMultiTenant } from "./tenant";
import { tenantPublicUrl } from "./tenantIdentity";

export const PRODUCT = {
  name: "Elephant Source",
  core: "Elephant Core",
  vendor: "Big Elephant",
} as const;

/**
 * URL pública de la instalación para enlaces (pagos, presupuestos, correos).
 *  - Con APP_URL: esa URL (sin espacios).
 *  - Sin APP_URL: cadena vacía (enlaces relativos) y un aviso en el registro. Nunca el dominio de otra instalación:
 *    llevaría a sus clientes (o los avisos de pago) a otra web. No puede lanzar.
 *  - Multi: la URL de la empresa en curso (su dominio propio verificado y activo, o su subdominio de
 *    plataforma), resuelta por petición desde la instantánea precargada del registro. Sin instantánea, APP_URL.
 */
export function publicBaseUrl(): string {
  if (isMultiTenant()) {
    const tenantUrl = tenantPublicUrl();
    if (tenantUrl) return tenantUrl;
  }
  const configured = (process.env.APP_URL ?? "").trim();
  if (configured) return configured;
  if (!warned) {
    warned = true;
    console.warn(JSON.stringify({ ctx: "ProductIdentity", event: "app_url_missing", fallback: "relative" }));
  }
  return "";
}
let warned = false;
