/**
 * Identidad del PRODUCTO (Elephant Source), separada de la marca de cada empresa cliente.
 *
 * La marca que ve el cliente final (nombre, logotipo, dominio, textos legales) es de cada empresa y
 * sale de su configuración (`site_settings`). Aquí solo está la identidad del producto y la URL
 * pública de la instalación.
 *
 * Compatibilidad: la instalación histórica (una sola empresa) construía sus enlaces con
 * `process.env.APP_URL ?? "https://www.skicenter.es"` en ~25 sitios. `publicBaseUrl()` centraliza ese
 * comportamiento SIN cambiarlo (mismo respaldo heredado) para poder retirarlo en un único punto.
 * Multiempresa: la URL de la empresa en curso sale del registro (ver `tenantIdentity.ts`).
 */
import { isMultiTenant } from "./tenant";
import { tenantPublicUrl } from "./tenantIdentity";

export const PRODUCT = {
  name: "Elephant Source",
  core: "Elephant Core",
  vendor: "Big Elephant",
} as const;

/** Respaldo heredado de la instalación histórica. Se retira cuando todas tengan APP_URL. */
export const LEGACY_PUBLIC_URL_FALLBACK = "https://www.skicenter.es";

/**
 * URL pública de la instalación para enlaces (pagos, presupuestos, correos).
 *  - Con APP_URL: esa URL (sin espacios).
 *  - Sin APP_URL: el respaldo heredado, exactamente como antes. No puede lanzar: un error aquí
 *    rompería el envío de enlaces.
 *  - Multi: la URL de la empresa en curso (su dominio propio verificado y activo, o su subdominio de
 *    plataforma), resuelta por petición desde la instantánea precargada del registro. Sin
 *    instantánea, el comportamiento anterior (y se avisa una vez si falta APP_URL).
 */
export function publicBaseUrl(): string {
  if (isMultiTenant()) {
    const tenantUrl = tenantPublicUrl();
    if (tenantUrl) return tenantUrl;
  }
  const configured = (process.env.APP_URL ?? "").trim();
  if (configured) return configured;
  if (isMultiTenant() && !warned) {
    warned = true;
    console.warn(JSON.stringify({ ctx: "ProductIdentity", event: "app_url_missing_in_multi", fallback: "legacy" }));
  }
  return LEGACY_PUBLIC_URL_FALLBACK;
}
let warned = false;
