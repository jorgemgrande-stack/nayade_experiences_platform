/**
 * Datos de la empresa ({{nombre}}, {{telefono}}…) en el lienzo de Elephant Studio, para que la página se vea como en
 * la web mientras se edita. Reproduce lo que hace el servidor al servirla (server/_core/pageBlocks.ts,
 * `renderBlockTokens`): en el texto simple se sustituye el dato; en el texto con formato, además, el elemento de lista
 * con un dato que falta no se muestra. La vista previa y la web usan siempre el resultado del servidor.
 */
import type { PageBlock } from "@shared/pageBlocks";

export type SiteTokens = Partial<Record<string, string | null | undefined>>;

const TOKENS = ["nombre", "razon_social", "nif", "domicilio", "email", "telefono", "direccion"];
const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function plain(s: string, t: SiteTokens): string {
  return s.replace(TOKEN_RE, (all, k: string) => (TOKENS.includes(k) ? String(t[k] ?? "").trim() : all));
}

function rich(html: string, t: SiteTokens): string {
  const value = (k: string) => String(t[k] ?? "").trim();
  const missing = (fragment: string) => Array.from(fragment.matchAll(TOKEN_RE)).some((m) => TOKENS.includes(m[1]) && !value(m[1]));
  let out = html.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (li) => (missing(li) ? "" : li));
  out = out.replace(/<(ul|ol)\b[^>]*>\s*<\/\1>/gi, "");
  return out.replace(TOKEN_RE, (all, k: string) => (TOKENS.includes(k) ? escapeHtml(value(k)) : all));
}

export const hasTokens = (s: unknown): boolean => typeof s === "string" && /\{\{\s*[a-z_]+\s*\}\}/.test(s);

export function renderTokens(blocks: PageBlock[], t: SiteTokens): PageBlock[] {
  return blocks.map((b) => {
    if (b.type === "section") return { ...b, data: { ...b.data, columns: b.data.columns.map((c) => ({ blocks: renderTokens(c.blocks, t) })) } };
    const d: Record<string, unknown> = { ...b.data };
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "string") d[k] = k === "html" ? rich(v, t) : plain(v, t);
      else if (Array.isArray(v)) d[k] = v.map((it) => (it && typeof it === "object" ? Object.fromEntries(Object.entries(it).map(([ik, iv]) => [ik, typeof iv === "string" ? plain(iv, t) : iv])) : it));
    }
    return { ...b, data: d } as PageBlock;
  });
}
