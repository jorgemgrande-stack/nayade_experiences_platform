/**
 * Multidioma (épica E-1): aplica el SEO de un idioma al HTML ya preparado de la web de una empresa.
 *
 * `lang` de `<html>`, `canonical` y `og:url` del idioma servido, `og:locale`, las alternativas `hreflang` (con
 * `x-default`) y `noindex` cuando el idioma o la traducción no están validados o se sirve el fallback. Todos los
 * valores se escapan. Sin idiomas adicionales no se llama: el HTML queda como siempre.
 */
import { alternateLinksHtml, ogLocale, type Alternate } from "../../shared/i18n";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\$/g, "&#36;");

export function applyLocaleSeo(html: string, seo: { htmlLang: string; canonical: string; noindex: boolean; alternates: Alternate[] }): string {
  const canonical = esc(seo.canonical);
  let out = html
    .replace(/<html lang="[^"]*"/, `<html lang="${esc(seo.htmlLang)}"`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${canonical}"`)
    .replace(/<meta property="og:locale" content="[^"]*"/, `<meta property="og:locale" content="${esc(ogLocale(seo.htmlLang))}"`);
  const alternates = alternateLinksHtml(seo.alternates);
  if (alternates) {
    out = out.replace(/(<link rel="canonical" href="[^"]*" \/>)/, `$1\n    ${alternates.replace(/\$/g, "$$$$")}`);
    const others = seo.alternates.filter((a) => a.hreflang !== "x-default" && a.hreflang !== seo.htmlLang).map((a) => `<meta property="og:locale:alternate" content="${esc(ogLocale(a.hreflang))}" />`);
    if (others.length) out = out.replace(/(<meta property="og:locale" content="[^"]*" \/>)/, `$1\n    ${others.join("\n    ")}`);
  }
  if (seo.noindex) {
    out = /<meta name="robots"/.test(out)
      ? out.replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex" />')
      : out.replace(/<meta charset="UTF-8" \/>/, '<meta charset="UTF-8" />\n    <meta name="robots" content="noindex" />');
  }
  return out;
}
