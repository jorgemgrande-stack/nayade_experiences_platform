/** Kit visual (parte pura): logotipo absoluto, pila tipográfica y enlaces por idioma a las páginas publicadas. */
import { describe, expect, it } from "vitest";
import { SINGLE_LANGUAGE_CONFIG, type I18nConfig } from "../../shared/i18n";
import { absoluteLogoUrl, bodyFontStack, minimalKit, pageRole, resolveKitPages } from "./tenantVisualKit";

describe("tenantVisualKit · piezas puras", () => {
  it("logotipo: https tal cual, ruta propia sobre la URL pública, nada si es inseguro o no hay URL", () => {
    expect(absoluteLogoUrl("https://cdn.example/l.png", "https://q.example")).toBe("https://cdn.example/l.png");
    expect(absoluteLogoUrl("/files/l.png", "https://q.example/")).toBe("https://q.example/files/l.png");
    expect(absoluteLogoUrl("/files/l.png", "")).toBeNull();
    expect(absoluteLogoUrl("http://cdn.example/l.png", "https://q.example")).toBeNull();
    expect(absoluteLogoUrl("javascript:alert(1)", "https://q.example")).toBeNull();
  });

  it("tipografía del cuerpo: la de la empresa delante de una pila segura", () => {
    expect(bodyFontStack(null)).toBe("'Helvetica Neue', Helvetica, Arial, sans-serif");
    expect(bodyFontStack("Cormorant Garamond, serif")).toBe("'Cormorant Garamond', 'Helvetica Neue', Helvetica, Arial, sans-serif");
    expect(bodyFontStack("Arial")).toBe("'Helvetica Neue', Helvetica, Arial, sans-serif");
    expect(bodyFontStack("x;url(")).toBe("'Helvetica Neue', Helvetica, Arial, sans-serif");
  });

  it("papel de una página por su slug", () => {
    expect(pageRole("datenschutz")).toBe("privacy");
    expect(pageRole("politica-de-privacidad")).toBe("privacy");
    expect(pageRole("impressum")).toBe("imprint");
    expect(pageRole("aviso-legal")).toBe("imprint");
    expect(pageRole("kontakt")).toBe("contact");
    expect(pageRole("inicio")).toBeNull();
  });

  const pages = [
    { id: 1, slug: "datenschutz", content: "Texto real", isPublished: true },
    { id: 2, slug: "aviso-legal", content: "Complete en este apartado los datos identificativos", isPublished: true },
    { id: 3, slug: "kontakt", content: "", isPublished: true },
    { id: 4, slug: "cookie-richtlinie", content: "x", isPublished: false },
  ];
  const cfg: I18nConfig = {
    defaultLocale: "de",
    defaultPrefix: false,
    fallback: "hide",
    negotiate: false,
    locales: [
      { locale: "de", isDefault: true, status: "validated", sortOrder: 0 },
      { locale: "es", isDefault: false, status: "validated", sortOrder: 1 },
      { locale: "en", isDefault: false, status: "draft", sortOrder: 2 },
    ],
  };

  it("solo páginas publicadas y sin texto de relleno; el idioma principal sin prefijo, el traducido con su slug validado", () => {
    const r = resolveKitPages(pages, cfg, (id, locale) => (id === 1 && locale === "es" ? "politica-de-privacidad" : null));
    expect(r.byLocale.de).toEqual({ privacy: "/datenschutz", contact: "/kontakt" });
    expect(r.byLocale.es).toEqual({ privacy: "/es/politica-de-privacidad", contact: "/kontakt" });
    expect(r.byLocale.en).toBeUndefined();
    expect(r.byLocale["*"]).toEqual(r.byLocale.de);
    expect(r.sitePaths).toEqual({ de: "/", es: "/es" });
  });

  it("una sola lengua: todo sin prefijo", () => {
    const r = resolveKitPages(pages, SINGLE_LANGUAGE_CONFIG, () => null);
    expect(r.byLocale.es).toEqual({ privacy: "/datenschutz", contact: "/kontakt" });
    expect(r.sitePaths).toEqual({ es: "/" });
  });

  it("minimalKit resuelve los enlaces por idioma sobre la URL pública y cae al principal", () => {
    const k = minimalKit({ brand: "Q", legalLine: "L", siteUrl: "https://q.example/", pages: { de: { privacy: "/datenschutz" }, "*": { privacy: "/datenschutz" } }, sitePaths: { de: "/", es: "/es" } });
    expect(k.links.site("de")).toBe("https://q.example/");
    expect(k.links.site("es")).toBe("https://q.example/es");
    expect(k.links.site("en")).toBe("https://q.example/");
    expect(k.links.privacy("en")).toBe("https://q.example/datenschutz");
    expect(k.links.contact("de")).toBeNull();
    expect(k.logoUrl).toBeNull();
    expect(k.legal).toEqual({ line: "L", name: "Q" });
  });
});
