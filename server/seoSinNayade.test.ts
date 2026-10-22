/**
 * Metadatos SEO (título, descripción, canonical, Open Graph): los de la empresa en cualquier modo. Ni el HTML base ni
 * el servidor llevan las rutas, el dominio o las imágenes de la instalación original.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const ORIGINAL = /n[aá]yade|skicenter|acu[aá]tic|cloudfront\.net/i;

describe("SEO sin la instalación original", () => {
  it("el HTML base solo tiene huecos que rellena el servidor", () => {
    const html = read("client/index.html");
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head.replace(/<script[\s\S]*?<\/script>/g, "")).not.toMatch(ORIGINAL);
    expect(html).toContain("<title></title>");
    expect(html).toContain('<div id="root"></div>');
  });

  it("el servidor rellena los metadatos de la empresa en cualquier modo (sin rutas SEO fijas)", () => {
    const vite = read("server/_core/vite.ts");
    expect(vite).not.toMatch(/SEO_ROUTES|resolveRouteMeta|DEFAULT_OG_IMAGE|skicenter/);
    expect(vite).toContain("const m = buildTenantMeta({");
    expect(vite).toContain("let html = injectSeoMeta(_htmlCache, seo);");
  });
});
