/**
 * SEO por tenant (modo multi).
 *
 * El HTML público inyecta título, descripción, canonical y Open Graph. Estos valores salen de
 * los ajustes del propio tenant, nunca de constantes de otra empresa, y SIEMPRE se escapan:
 * son texto editable por el cliente y acaban dentro de atributos HTML.
 */
import { normalizeHost } from "./tenantRegistry/host";

export interface TenantSeoSettings {
  brandName: string;
  description: string;
  logoUrl: string;
  /** Imagen Open Graph específica; si falta, se usa el logo. */
  ogImageUrl?: string;
}

export interface TenantMeta {
  title: string;
  description: string;
  h1: string;
  body: string;
  image?: string;
  canonical: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    // `$` tiene significado especial en String.replace: se neutraliza para la inyección
    .replace(/\$/g, "&#36;");
}

/** Solo http(s) absolutas; cualquier otra cosa (javascript:, data:…) se descarta. */
export function safeUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : undefined;
  } catch {
    return undefined;
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Construye el SEO de una página. Los valores devueltos ya están escapados para HTML. */
export function buildTenantMeta(input: {
  settings: Partial<TenantSeoSettings>;
  host: unknown;
  pathname: string;
  fallbackName?: string;
}): TenantMeta {
  const host = normalizeHost(input.host) ?? "";
  const name = clip((input.settings.brandName ?? "").trim() || input.fallbackName || host || "Sitio web", 120);
  const description = clip((input.settings.description ?? "").trim(), 300);
  const path = input.pathname.split("?")[0].replace(/[^A-Za-z0-9_\-./~%]/g, "");
  const canonical = host ? `https://${host}${path === "/" ? "" : path}` : "";
  const image = safeUrl(input.settings.ogImageUrl) ?? safeUrl(input.settings.logoUrl);
  return {
    title: escapeHtml(name),
    description: escapeHtml(description || name),
    h1: escapeHtml(name),
    body: escapeHtml(description),
    image: image ? escapeHtml(image) : undefined,
    canonical: escapeHtml(canonical),
  };
}
