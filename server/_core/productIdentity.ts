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
 * Pendiente (multiempresa): URL pública de la empresa en curso desde el registro.
 */
import { isMultiTenant } from "./tenant";

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
 *  - Sin APP_URL: el respaldo heredado, exactamente como antes. Varios routers la leen AL IMPORTARSE,
 *    así que no puede lanzar: un error aquí impediría arrancar.
 * Pendiente (multiempresa): la URL de la empresa en curso (su dominio en el registro), resuelta por
 * petición y no al importar. Mientras tanto, en multi se avisa una vez si falta APP_URL.
 */
export function publicBaseUrl(): string {
  const configured = (process.env.APP_URL ?? "").trim();
  if (configured) return configured;
  if (isMultiTenant() && !warned) {
    warned = true;
    console.warn(JSON.stringify({ ctx: "ProductIdentity", event: "app_url_missing_in_multi", fallback: "legacy" }));
  }
  return LEGACY_PUBLIC_URL_FALLBACK;
}
let warned = false;
