/**
 * Elephant Studio › Cabecera y pie: botón destacado de la cabecera y estilo, texto y contacto del pie. Ajustes de tema
 * validados por el servidor (listas cerradas, textos sin HTML, enlaces seguros) y su salida en el tema público.
 */
import { describe, it, expect } from "vitest";
import { buildTheme, cleanThemeValues, siteLink, ThemeValueError, PUBLIC_THEME_KEYS, SITE_CHROME_KEYS, THEME_EDITABLE_KEYS } from "./_core/theme";

const theme = (vals: Record<string, string>) => buildTheme((k) => vals[k], { multi: true });

describe("cabecera y pie: ajustes", () => {
  it("son editables por la empresa y llegan al tema público", () => {
    for (const k of SITE_CHROME_KEYS) {
      expect(THEME_EDITABLE_KEYS as readonly string[]).toContain(k);
      expect(PUBLIC_THEME_KEYS as readonly string[]).toContain(k);
    }
  });

  it("valores de la lista y textos válidos se guardan; el enlace se normaliza", () => {
    expect(
      cleanThemeValues({
        site_header_cta: "custom", site_header_cta_label: "Reserva tu clase", site_header_cta_url: " /reservas ",
        site_footer_style: "brand", site_footer_text: "Escuela de esquí desde 1998.", site_footer_contact: "false",
      }),
    ).toEqual({
      site_header_cta: "custom", site_header_cta_label: "Reserva tu clase", site_header_cta_url: "/reservas",
      site_footer_style: "brand", site_footer_text: "Escuela de esquí desde 1998.", site_footer_contact: "false",
    });
  });

  it("rechaza opciones fuera de la lista, HTML, textos largos y enlaces peligrosos", () => {
    const bad: Array<Record<string, string>> = [
      { site_header_cta: "popup" },
      { site_footer_style: "neon" },
      { site_header_style: "flotante" },
      { site_header_tone: "rojo" },
      { site_footer_contact: "si" },
      { site_header_cta_label: "<b>Hola</b>" },
      { site_header_cta_label: "x".repeat(41) },
      { site_footer_text: "y".repeat(241) },
      { site_header_cta_url: "javascript:alert(1)" },
      { site_header_cta_url: "//evil.example" },
    ];
    for (const v of bad) expect(() => cleanThemeValues(v), JSON.stringify(v)).toThrow(ThemeValueError);
  });

  it("enlaces admitidos: páginas de la web, anclas, https, correo y teléfono", () => {
    expect(siteLink("/contacto")).toBe("/contacto");
    expect(siteLink("#reservas")).toBe("#reservas");
    expect(siteLink("https://ejemplo.es/a")).toBe("https://ejemplo.es/a");
    expect(siteLink("mailto:hola@ejemplo.es")).toBe("mailto:hola@ejemplo.es");
    expect(siteLink("tel:+34600000000")).toBe("tel:+34600000000");
    expect(siteLink("data:text/html,x")).toBeNull();
  });
});

describe("cabecera y pie: tema público", () => {
  it("sin ajustes: botón de serie, pie oscuro con contacto (como hasta ahora)", () => {
    const t = theme({});
    expect(t.header).toEqual({ cta: "auto", ctaLabel: null, ctaUrl: null, style: "classic", tone: "dark", logoLight: null, showCart: true });
    expect(t.footer).toEqual({ style: "dark", text: null, showContact: true });
  });

  it("botón propio completo; sin texto o sin enlace válido se comporta como el de serie", () => {
    expect(theme({ site_header_cta: "custom", site_header_cta_label: "Reserva", site_header_cta_url: "/reservas" }).header).toEqual({ cta: "custom", ctaLabel: "Reserva", ctaUrl: "/reservas", style: "classic", tone: "dark", logoLight: null, showCart: true });
    expect(theme({ site_header_cta: "custom", site_header_cta_label: "Reserva" }).header.cta).toBe("auto");
    expect(theme({ site_header_cta: "custom", site_header_cta_label: "Reserva", site_header_cta_url: "javascript:x" }).header.cta).toBe("auto");
    expect(theme({ site_header_cta: "none", site_header_cta_label: "Reserva", site_header_cta_url: "/r" }).header).toEqual({ cta: "none", ctaLabel: null, ctaUrl: null, style: "classic", tone: "dark", logoLight: null, showCart: true });
    expect(theme({ site_header_style: "centered", site_header_tone: "light" }).header).toMatchObject({ style: "centered", tone: "light" });
    expect(theme({ site_header_style: "raro", site_header_tone: "x" }).header).toMatchObject({ style: "classic", tone: "dark", logoLight: null });
    expect(theme({ site_header_logo_light: "https://x.test/l.png" }).header.logoLight).toBe("https://x.test/l.png");
    expect(theme({ site_header_logo_light: "javascript:alert(1)" }).header.logoLight).toBeNull();
    // Carrito: visible salvo que la web lo oculte (una web solo por solicitud)
    expect(theme({ site_header_cart: "false" }).header.showCart).toBe(false);
    expect(() => cleanThemeValues({ site_header_cart: "quizá" })).toThrow(ThemeValueError);
    expect(cleanThemeValues({ site_header_cart: "false" })).toEqual({ site_header_cart: "false" });
  });

  it("pie: estilo de la lista, texto y contacto oculto; un valor guardado no válido vuelve al de serie", () => {
    expect(theme({ site_footer_style: "light", site_footer_text: "Hola", site_footer_contact: "false" }).footer).toEqual({ style: "light", text: "Hola", showContact: false });
    expect(theme({ site_footer_style: "neon" }).footer.style).toBe("dark");
  });
});

describe("acabado de la web", () => {
  it("por defecto es el de serie; solo acepta valores de la lista", () => {
    expect(theme({}).finish).toBe("standard");
    expect(theme({ site_finish: "editorial" }).finish).toBe("editorial");
    expect(theme({ site_finish: "raro" }).finish).toBe("standard");
    expect(cleanThemeValues({ site_finish: "editorial" })).toEqual({ site_finish: "editorial" });
    expect(() => cleanThemeValues({ site_finish: "raro" })).toThrow(ThemeValueError);
  });
});
