import { describe, it, expect } from "vitest";
import { buildTheme, contrastOn, safeColor, safeHttpUrl } from "./_core/theme";
import { sanitizeRichHtml } from "./_core/htmlSanitize";

const get = (o: Record<string, string>) => (k: string) => o[k];

describe("tema por tenant", () => {
  it("sanea colores, fuentes y URLs", () => {
    const t = buildTheme(
      get({
        theme_primary_color: "red; background:url(javascript:alert(1))",
        theme_accent_color: "#ff8800",
        theme_font_family: "Inter, sans-serif",
        theme_radius: "12px",
        brand_logo_url: "javascript:alert(1)",
        brand_favicon_url: "https://cdn.example.com/f.ico",
        brand_name: "Hotel <b>Sol</b>",
      }),
      { multi: true },
    );
    expect(t.primaryColor).toBeNull();
    expect(t.accentColor).toBe("#ff8800");
    expect(t.fontFamily).toBe("Inter, sans-serif");
    expect(t.radius).toBe("12px");
    expect(t.logoUrl).toBeNull();
    expect(t.faviconUrl).toBe("https://cdn.example.com/f.ico");
    expect(t.brandName).toBe("Hotel bSol/b");
  });

  it("fuente con inyección de CSS se descarta", () => {
    expect(buildTheme(get({ theme_font_family: "x; } body { display:none" }), { multi: true }).fontFamily).toBeNull();
  });

  it("single no cambia el sitio: sin sitio neutro ni marca de plataforma por defecto", () => {
    const t = buildTheme(get({}), { multi: false });
    expect(t.neutralSite).toBe(false);
    expect(t.poweredBy).toBeNull();
    expect(t.primaryColor).toBeNull();
  });

  it("multi: sitio neutro y marca discreta de Big Elephant, desactivable por ajuste", () => {
    expect(buildTheme(get({}), { multi: true })).toMatchObject({ neutralSite: true, poweredBy: { label: "Plataforma Big Elephant" } });
    expect(buildTheme(get({ brand_show_powered_by: "false" }), { multi: true }).poweredBy).toBeNull();
  });

  it("colores y contraste", () => {
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("oklch(0.5 0.1 200)")).toBe("oklch(0.5 0.1 200)");
    expect(safeColor("url(x)")).toBeNull();
    expect(contrastOn("#ffffff")).toBe("#111111");
    expect(contrastOn("#101820")).toBe("#ffffff");
    expect(safeHttpUrl("//evil.example/x")).toBeNull();
    expect(safeHttpUrl("/img/logo.png")).toBe("/img/logo.png");
  });
});

describe("saneado de HTML de páginas", () => {
  it("elimina scripts, manejadores, iframes y URL peligrosas", () => {
    const out = sanitizeRichHtml(
      `<h1 onclick="x()">Hola</h1><script>alert(1)</script><a href="javascript:alert(1)">mal</a>` +
        `<a href="https://ok.example" target="_blank">bien</a><img src="data:text/html;base64,AAA" onerror="x()">` +
        `<iframe src="https://evil"></iframe><style>body{display:none}</style><p style="x">t</p>`,
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe|style|data:/i);
    expect(out).toContain("<h1>Hola</h1>");
    expect(out).toContain('<a href="https://ok.example" target="_blank" rel="noopener noreferrer">bien</a>');
  });

  it("mantiene estructura básica y cierra etiquetas abiertas", () => {
    expect(sanitizeRichHtml("<ul><li>a<li>b</ul>")).toBe("<ul><li>a<li>b</li></li></ul>");
    expect(sanitizeRichHtml("<p>1 < 2 y 3 > 2</p>")).toBe("<p>1 &lt; 2 y 3 &gt; 2</p>");
  });

  it("etiquetas desconocidas se descartan sin romper el texto", () => {
    expect(sanitizeRichHtml("<form><input name=x>texto</form>")).toBe("texto");
  });
});
