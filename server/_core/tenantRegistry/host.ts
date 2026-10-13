/**
 * Normalización y validación de nombres de host.
 *
 * La resolución de tenant depende de que el mismo dominio se escriba siempre igual y de que
 * una cabecera `Host` maliciosa nunca se interprete como algo distinto de lo que es.
 */
import { domainToASCII } from "node:url";

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export type HostOptions = {
  /** Permite `localhost` y `*.localhost` (solo desarrollo). */
  allowLocalhost?: boolean;
};

/**
 * Devuelve el host normalizado (minúsculas, punycode, sin puerto ni punto final) o `null`
 * si no es un nombre de dominio válido. Nunca lanza.
 */
export function normalizeHost(raw: unknown, opts: HostOptions = {}): string | null {
  if (typeof raw !== "string") return null;
  let h = raw.trim().toLowerCase();
  if (!h || h.length > 300) return null;

  // Rechazar cualquier cosa que no sea un host: esquema, ruta, credenciales, espacios, comodines
  if (/[\s/\\@?#*]/.test(h)) return null;

  // IPv6 entre corchetes: no es un dominio registrable
  if (h.startsWith("[")) return null;

  // Quitar puerto
  const colon = h.lastIndexOf(":");
  if (colon !== -1) {
    const port = h.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) return null;
    h = h.slice(0, colon);
  }
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (!h) return null;

  const ascii = domainToASCII(h);
  if (!ascii || ascii.length > 253) return null;
  if (IPV4_RE.test(ascii)) return null;

  const labels = ascii.split(".");
  if (!labels.every((l) => LABEL_RE.test(l))) return null;

  const isLocalhost = ascii === "localhost" || ascii.endsWith(".localhost");
  if (isLocalhost) return opts.allowLocalhost ? ascii : null;

  // Un nombre de dominio real tiene al menos dos etiquetas
  if (labels.length < 2) return null;
  return ascii;
}

/** Subdominio de plataforma para un tenant: `<tenantId>.<baseDomain>`. */
export function platformSubdomain(tenantId: string, baseDomain: string): string | null {
  const base = normalizeHost(baseDomain);
  if (!base) return null;
  return normalizeHost(`${tenantId}.${base}`);
}

/** ¿El host es un subdominio directo del dominio base de la plataforma? */
export function isPlatformSubdomain(host: string, baseDomain: string): boolean {
  const base = normalizeHost(baseDomain);
  const h = normalizeHost(host);
  if (!base || !h || !h.endsWith(`.${base}`)) return false;
  return !h.slice(0, -(base.length + 1)).includes(".");
}
