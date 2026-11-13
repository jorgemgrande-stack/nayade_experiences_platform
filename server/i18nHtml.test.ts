import { describe, expect, it } from "vitest";
import { applyLocaleSeo } from "./_core/i18nHtml";

const HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>x</title>
    <link rel="canonical" href="https://a.test/nosotros" />
    <meta property="og:url" content="https://a.test/nosotros" />
    <meta property="og:locale" content="es_ES" />
  </head>
</html>`;

describe("SEO por idioma en el HTML", () => {
  it("lang, canonical, og, hreflang y x-default", () => {
    const out = applyLocaleSeo(HTML, {
      htmlLang: "de", canonical: "https://a.test/de/ueber-uns", noindex: false,
      alternates: [{ hreflang: "es", href: "https://a.test/nosotros" }, { hreflang: "de", href: "https://a.test/de/ueber-uns" }, { hreflang: "x-default", href: "https://a.test/nosotros" }],
    });
    expect(out).toContain('<html lang="de"');
    expect(out).toContain('<link rel="canonical" href="https://a.test/de/ueber-uns" />');
    expect(out).toContain('<meta property="og:url" content="https://a.test/de/ueber-uns"');
    expect(out).toContain('<meta property="og:locale" content="de"');
    expect(out).toContain('<link rel="alternate" hreflang="es" href="https://a.test/nosotros" />');
    expect(out).toContain('<link rel="alternate" hreflang="x-default" href="https://a.test/nosotros" />');
    expect(out).toContain('<meta property="og:locale:alternate" content="es"');
    expect(out).not.toContain("noindex");
  });
  it("noindex en el fallback", () => {
    const out = applyLocaleSeo(HTML, { htmlLang: "es", canonical: "https://a.test/nosotros", noindex: true, alternates: [] });
    expect(out).toContain('<meta name="robots" content="noindex" />');
    expect(out).not.toContain("hreflang");
  });
  it("escapa valores hostiles", () => {
    const out = applyLocaleSeo(HTML, { htmlLang: 'de"><script>', canonical: 'https://a.test/"><script>$&', noindex: false, alternates: [{ hreflang: "de", href: 'https://a.test/"><b>$1' }, { hreflang: "es", href: "https://a.test/" }] });
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>");
  });
});
