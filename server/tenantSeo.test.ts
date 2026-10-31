import { describe, it, expect } from "vitest";
import { buildTenantMeta, escapeHtml, pageMetaOverride, safeUrl } from "./_core/tenantSeo";

describe("SEO por tenant", () => {
  it("escapa HTML y metacaracteres de reemplazo", () => {
    const m = buildTenantMeta({
      settings: { brandName: `Hotel <script>alert(1)</script> "Sol" $& $1`, description: "a & b" },
      host: "hotelsol.elephantsource.es",
      pathname: "/",
    });
    expect(m.title).not.toContain("<");
    expect(m.title).toContain("&lt;script&gt;");
    expect(m.title).not.toContain("$");
    expect(m.description).toBe("a &amp; b");
  });

  it("canonical con el host del tenant, no con dominios ajenos", () => {
    const m = buildTenantMeta({ settings: { brandName: "X" }, host: "Mi-Hotel.Example.com:443", pathname: "/habitaciones?x=1" });
    expect(m.canonical).toBe("https://mi-hotel.example.com/habitaciones");
    expect(buildTenantMeta({ settings: {}, host: "a.example.com", pathname: "/" }).canonical).toBe("https://a.example.com");
  });

  it("no contiene datos de otra empresa si faltan ajustes", () => {
    const m = buildTenantMeta({ settings: {}, host: "nuevo.elephantsource.es", pathname: "/" });
    expect(m.title).toBe("nuevo.elephantsource.es");
    expect(JSON.stringify(m).toLowerCase()).not.toContain("náyade");
  });

  it("solo acepta URL http(s) para imágenes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html;base64,AAAA")).toBeUndefined();
    expect(safeUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    const m = buildTenantMeta({ settings: { brandName: "X", logoUrl: "javascript:alert(1)" }, host: "a.example.com", pathname: "/" });
    expect(m.image).toBeUndefined();
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
});

describe("metadatos de una página de la empresa", () => {
  it("portada: título propio de la página o el de la empresa; descripción propia si la hay", () => {
    expect(pageMetaOverride({ title: "Inicio", metaTitle: null, metaDescription: null }, "Empresa A", true)).toEqual({});
    expect(pageMetaOverride({ title: "Inicio", metaTitle: "A <la> mejor", metaDescription: "Hacemos cosas" }, "Empresa A", true)).toEqual({
      title: "A &lt;la&gt; mejor",
      description: "Hacemos cosas",
    });
  });

  it("portada con descripción SEO de la empresa: manda la de la empresa", () => {
    expect(pageMetaOverride({ title: "Inicio", metaDescription: "Empresa A" }, "Empresa A", true, { keepDescription: true })).toEqual({});
  });

  it("otra página: «Página | Empresa» y su encabezado", () => {
    expect(pageMetaOverride({ title: "Servicios", metaTitle: "", metaDescription: "" }, "Empresa A", false)).toEqual({ title: "Servicios | Empresa A", h1: "Servicios" });
    expect(pageMetaOverride({ title: "Servicios" }, "", false).title).toBe("Servicios");
  });
});
