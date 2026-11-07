import { describe, expect, it } from "vitest";
import { EMPTY_SITEMAP, robotsTxt, withNoindexMeta } from "./searchIndexing";

describe("ocultar la web a los buscadores", () => {
  it("robots.txt: normal con su sitemap; oculta, nada se rastrea", () => {
    expect(robotsTxt("https://acme.example", false)).toBe("User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://acme.example/sitemap.xml\n");
    expect(robotsTxt("https://acme.example", true)).toBe("User-agent: *\nDisallow: /\n");
  });
  it("sitemap vacío válido y meta noindex sin duplicar la del 404", () => {
    expect(EMPTY_SITEMAP).toContain("<urlset");
    expect(EMPTY_SITEMAP).not.toContain("<url>");
    const base = '<head>\n    <meta charset="UTF-8" />\n  </head>';
    expect(withNoindexMeta(base)).toContain('<meta name="robots" content="noindex, nofollow" />');
    const del404 = '<meta charset="UTF-8" />\n    <meta name="robots" content="noindex" />';
    const r = withNoindexMeta(del404);
    expect(r.match(/name="robots"/g)).toHaveLength(1);
    expect(r).toContain('content="noindex, nofollow"');
  });
});
