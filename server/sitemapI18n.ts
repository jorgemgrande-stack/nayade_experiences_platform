/**
 * Multidioma en el sitemap (épica E-1): las URL de cada idioma público con sus alternativas `xhtml:link`.
 *
 * Solo entran versiones VALIDADAS (idioma y traducción). Sin idiomas adicionales, o sin traducciones validadas, el plan
 * es `null` y el sitemap queda idéntico al de siempre.
 */
import { alternateLinksHtml, buildAlternates, localizedPath, type Alternate } from "../shared/i18n";
import { sitemapAlternates, type I18nRepo } from "./i18nService";

export interface SitemapI18nPlan {
  /** Alternativas de las URL del principal que ya emite el sitemap (clave: ruta). */
  alternatesFor: Map<string, Alternate[]>;
  /** URL de los idiomas adicionales, con sus alternativas. */
  extra: Array<{ loc: string; alternates: Alternate[]; lastmod?: string }>;
}

export async function i18nSitemapPlan(repo: I18nRepo, origin: string): Promise<SitemapI18nPlan | null> {
  const { cfg, entries } = await sitemapAlternates(repo);
  if (!entries.length) return null;
  const base = origin.replace(/\/+$/, "");
  const alternatesFor = new Map<string, Alternate[]>();
  const extra: SitemapI18nPlan["extra"] = [];
  for (const e of entries) {
    const alts = buildAlternates(cfg, origin, e.versions);
    if (alts.length < 2) continue;
    alternatesFor.set(localizedPath(e.rest, cfg.defaultLocale, cfg), alts);
    for (const v of e.versions) {
      if (v.locale === cfg.defaultLocale) continue;
      extra.push({ loc: localizedPath(v.rest, v.locale, cfg), alternates: alts, lastmod: e.lastmod });
    }
  }
  return alternatesFor.size ? { alternatesFor, extra } : null;
}

/** `<xhtml:link>` de una entrada (mismos valores que `hreflang` del HTML). */
export function xhtmlLinks(alts: Alternate[]): string {
  return alternateLinksHtml(alts).replace(/<link rel="alternate"/g, "<xhtml:link rel=\"alternate\"").replace(/ \/>/g, " />").split("\n").map((l) => `    ${l.trim()}`).join("\n");
}
