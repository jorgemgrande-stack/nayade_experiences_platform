/**
 * Web de cada empresa: nunca la analítica (Google Analytics) ni el pixel (Meta) de la instalación original, y su
 * nombre como `og:site_name`. La instalación original conserva los suyos.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../vite.config", () => ({ default: {} }));
vi.mock("vite", () => ({ createServer: vi.fn() }));

const { tenantSiteHtml } = await import("./_core/vite");
const indexHtml = fs.readFileSync(path.join(__dirname, "../client/index.html"), "utf8");
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("analítica en la web de cada empresa", () => {
  it("el HTML de la empresa no carga la etiqueta de Google Analytics y lleva su nombre y la marca de web de empresa", () => {
    // El HTML base ya no la lleva (GA4 la añade solo con un identificador configurado); si la llevara, se quita
    expect(indexHtml).not.toMatch(/googletagmanager\.com\/gtag\/js/);
    const withTag = indexHtml.replace("</head>", '    <script async src="https://www.googletagmanager.com/gtag/js?id=G-OTRA0000"></script>\n</head>');
    const out = tenantSiteHtml(withTag, "Aventuras Sierra");
    expect(out).not.toMatch(/googletagmanager\.com\/gtag\/js/);
    expect(out).toContain('<meta property="og:site_name" content="Aventuras Sierra"');
    expect(out).toContain('<meta name="elephant-tenant-site" content="multi" />');
  });

  it("solo se aplica en multiempresa (con metadatos de la empresa)", () => {
    const vite = read("server/_core/vite.ts");
    expect(vite).toContain("if (isMultiTenant()) html = tenantSiteHtml(html, escapeHtml(brandName));");
  });

  it("GA4 y Meta Pixel no se inician en la web de una empresa sin su propio identificador", () => {
    const ga4 = read("client/src/lib/ga4/client.ts");
    const init = ga4.slice(ga4.indexOf("export function initGA4"));
    expect(init.indexOf("if (isTenantSite() && !tenantMeasurementId) return;")).toBeGreaterThan(-1);
    expect(init.indexOf("if (isTenantSite() && !tenantMeasurementId) return;")).toBeLessThan(init.indexOf("window.gtag('config'"));
    const pixel = read("client/src/components/MetaPixelLoader.tsx");
    expect(pixel.indexOf("if (!PIXEL_ID) return;")).toBeGreaterThan(-1);
    expect(pixel.indexOf("if (!PIXEL_ID) return;")).toBeLessThan(pixel.indexOf("window.fbq('init', PIXEL_ID)"));
  });
});

describe("analítica de la instalación de una sola empresa", () => {
  it("sin identificadores configurados, ninguna: ni GA4 ni pixel ni cookie con el dominio de otra web", () => {
    const ga4 = read("client/src/lib/ga4/client.ts");
    const pixel = read("client/src/components/MetaPixelLoader.tsx");
    for (const src of [ga4, pixel, read("client/index.html")]) expect(src).not.toMatch(/G-8E7HXCGN3P|1542400900841433|skicenter/);
    expect(ga4).toContain("if (!MEASUREMENT_ID) return;");
  });
});
