/**
 * Pie de la web de la empresa: redes sociales (validación y almacenamiento), columnas a partir del menú de pie,
 * texto del pie por idioma (solo traducción validada) y editor «Idiomas del pie».
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkSocialUrl, footerLayout, parseFooterSocial, validateFooterSocial, SOCIAL_MAX, type FooterMenuItem } from "../shared/footer";
import { buildTheme, cleanThemeValues, ThemeValueError } from "./_core/theme";
import { memoryI18nRepo } from "./i18nMemoryRepo";
import { addLocale, saveContentTranslationDraft, validateContentTranslation, validateLocale } from "./i18nService";
import { SITE_UI_TEXT } from "../shared/siteUiText";
import { switcherQuery } from "../client/src/components/LanguageSwitcher";

const OK = {
  instagram: "https://www.instagram.com/indira.soul.retreat/",
  telegram: "https://t.me/soulretreat",
  facebook: "https://www.facebook.com/indira.yogaluz",
  youtube: "https://www.youtube.com/@yoga-soulretreat/videos",
};

describe("redes sociales del pie", () => {
  it("admite las direcciones exactas de cada red", () => {
    for (const [network, url] of Object.entries(OK)) expect(checkSocialUrl(network as "instagram", url)).toEqual({ ok: true, url });
  });

  it("rechaza http, otro dominio, usuario en la dirección, espacios, scripts y direcciones vacías o largas", () => {
    const bad: Array<[string, unknown]> = [
      ["instagram", "http://www.instagram.com/x/"],
      ["instagram", "https://instagram.com.evil.example/x"],
      ["instagram", "https://evil.example/instagram.com"],
      ["instagram", "https://user:pass@instagram.com/x"],
      ["instagram", "https://instagram.com/a b"],
      ["instagram", "javascript:alert(1)"],
      ["facebook", OK.instagram],
      ["telegram", ""],
      ["youtube", "https://youtube.com/" + "x".repeat(300)],
      ["youtube", 42],
    ];
    for (const [n, u] of bad) expect(checkSocialUrl(n as "instagram", u).ok, `${n} ${String(u).slice(0, 40)}`).toBe(false);
  });

  it("se guarda como JSON validado; sin redes, lista vacía; repetidas o de más, error", () => {
    const r = validateFooterSocial([{ network: "instagram", url: OK.instagram }, { network: "telegram", url: OK.telegram }]);
    expect(r.ok && JSON.parse(r.value)).toEqual([{ network: "instagram", url: OK.instagram }, { network: "telegram", url: OK.telegram }]);
    expect(validateFooterSocial("")).toEqual({ ok: true, value: "[]" });
    expect(validateFooterSocial([{ network: "instagram", url: OK.instagram }, { network: "instagram", url: OK.instagram }]).ok).toBe(false);
    expect(validateFooterSocial([{ network: "myspace", url: "https://myspace.com/x" }]).ok).toBe(false);
    expect(validateFooterSocial("no json").ok).toBe(false);
    expect(validateFooterSocial(Array.from({ length: SOCIAL_MAX + 1 }, () => ({ network: "x", url: "https://x.com/a" }))).ok).toBe(false);
  });

  it("lo guardado se lee con tolerancia: lo inválido se descarta y nunca rompe", () => {
    expect(parseFooterSocial(undefined)).toEqual([]);
    expect(parseFooterSocial("no json")).toEqual([]);
    expect(parseFooterSocial('{"a":1}')).toEqual([]);
    expect(parseFooterSocial(JSON.stringify([{ network: "instagram", url: "http://x" }, { network: "telegram", url: OK.telegram }]))).toEqual([{ network: "telegram", url: OK.telegram }]);
  });

  it("llega al tema público y se valida al guardar los ajustes", () => {
    const theme = buildTheme((k) => ({ site_footer_social: JSON.stringify([{ network: "youtube", url: OK.youtube }]) } as Record<string, string>)[k], { multi: true });
    expect(theme.footer.social).toEqual([{ network: "youtube", url: OK.youtube }]);
    expect(buildTheme(() => undefined, { multi: true }).footer.social).toEqual([]);
    expect(JSON.parse(cleanThemeValues({ site_footer_social: JSON.stringify([{ network: "telegram", url: OK.telegram }]) }).site_footer_social)).toEqual([{ network: "telegram", url: OK.telegram }]);
    expect(() => cleanThemeValues({ site_footer_social: JSON.stringify([{ network: "telegram", url: "https://evil.example/t.me" }]) })).toThrow(ThemeValueError);
    expect(cleanThemeValues({ site_footer_social: "" }).site_footer_social).toBe("");
  });
});

describe("columnas del pie a partir del menú", () => {
  const item = (id: number, label: string, url: string | null, parentId: number | null, sortOrder: number, isActive = true): FooterMenuItem => ({ id, label, url, parentId, sortOrder, isActive });

  it("los elementos sin enlace con hijos son columnas; los de primer nivel con enlace, la franja legal", () => {
    const { columns, bottom } = footerLayout([
      item(1, "Descubrir", null, null, 10), item(11, "RECONNECT", "/reconnect", 1, 10), item(12, "Workshops", "/workshops", 1, 20),
      item(2, "Acompañamiento", null, null, 20), item(21, "Contacto", "/kontakt", 2, 10),
      item(7, "Impressum", "/impressum", null, 70), item(8, "Datenschutz", "/datenschutz", null, 80),
    ]);
    expect(columns.map((c) => [c.title, c.links.map((l) => l.label)])).toEqual([["Descubrir", ["RECONNECT", "Workshops"]], ["Acompañamiento", ["Contacto"]]]);
    expect(bottom.map((b) => b.label)).toEqual(["Impressum", "Datenschutz"]);
  });

  it("sin columnas (solo enlaces sueltos) el pie conserva el de siempre", () => {
    const { columns, bottom } = footerLayout([item(7, "Aviso legal", "/aviso-legal", null, 1), item(8, "Cookies", "/cookies", null, 2)]);
    expect(columns).toEqual([]);
    expect(bottom).toHaveLength(2);
  });

  it("ocultos fuera, columna sin enlaces activos fuera, orden por sortOrder y máximo 4 columnas", () => {
    const items: FooterMenuItem[] = [item(1, "A", null, null, 20), item(11, "a1", "/a", 1, 1), item(2, "B", null, null, 10), item(21, "b1", "/b", 2, 1), item(22, "b2", "/b2", 2, 2, false),
      item(3, "C", null, null, 30), item(31, "c1", "/c", 3, 1, false)];
    for (let i = 4; i <= 8; i++) items.push(item(i * 10, `Col${i}`, null, null, 100 + i), item(i * 10 + 1, `l${i}`, `/l${i}`, i * 10, 1));
    const { columns } = footerLayout(items);
    expect(columns.map((c) => c.title)).toEqual(["B", "A", "Col4", "Col5"]);
    expect(columns[0].links.map((l) => l.label)).toEqual(["b1"]);
  });
});

describe("textos fijos del pie por idioma", () => {
  it("todos los idiomas tienen las mismas claves y ninguno repite el español en la web alemana", () => {
    const keys = ["footerLinksLabel", "footerLegalLabel", "footerSocialLabel", "footerContactTitle", "footerWhatsapp", "footerNewTab", "poweredBy"] as const;
    for (const k of keys) {
      for (const l of ["es", "de", "en"] as const) expect(SITE_UI_TEXT[l][k], `${l}.${k}`).toBeTruthy();
    }
    for (const k of ["footerLinksLabel", "footerLegalLabel", "footerSocialLabel", "footerContactTitle", "footerNewTab", "poweredBy"] as const) expect(SITE_UI_TEXT.de[k]).not.toBe(SITE_UI_TEXT.es[k]);
  });
});

const mocks = vi.hoisted(() => ({
  rows: [{ id: 1, parentId: null, label: "Entdecken", url: null, isActive: true }, { id: 11, parentId: 1, label: "Workshops", url: "/workshops", isActive: true }],
}));
vi.mock("./db", () => ({
  getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => mocks.rows }) }) }) }),
}));
vi.mock("./config", () => ({ getSystemSetting: async (k: string) => (k === "site_footer_text" ? " Heilen und Transformieren " : "") }));

describe("texto del pie y editor «Idiomas del pie»", () => {

  it("solo se pueden traducir los ajustes de la lista cerrada, sin HTML y dentro del máximo", async () => {
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await expect(saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "stripe_secret_key", locale: "de", fields: { value: "x" } })).rejects.toThrow();
    await expect(saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "site_footer_text", locale: "de", fields: { value: "<b>x</b>" } })).rejects.toThrow();
    await expect(saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "site_footer_text", locale: "de", fields: { value: "a".repeat(241) } })).rejects.toThrow();
    await expect(saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "site_footer_text", locale: "de", fields: { value: "Heilen" } })).resolves.toEqual({ success: true });
  });

  it("el editor devuelve texto y elementos con su original y su traducción por idioma", async () => {
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await validateLocale(repo, "de", "ana");
    await saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "site_footer_text", locale: "de", fields: { value: "Sanar y transformar" } });
    await validateContentTranslation(repo, "setting", "site_footer_text", "de", "ana");
    await saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "1", locale: "de", fields: { label: "Descubrir" } });
    const { getFooterTranslationEditor } = await import("./footerTranslationsDb");
    const r = await getFooterTranslationEditor(repo);
    expect(r.multilingual).toBe(true);
    expect(r.text.principal.value).toBe("Heilen und Transformieren");
    expect(r.text.translations.de).toMatchObject({ fields: { value: "Sanar y transformar" }, status: "validated" });
    expect(r.items.map((i) => [i.id, i.parentId, i.hasUrl, i.principal.label])).toEqual([[1, null, false, "Entdecken"], [11, 1, true, "Workshops"]]);
    expect(r.items[0].translations.de).toMatchObject({ fields: { label: "Descubrir" }, status: "draft" });
    expect(r.items[1].translations.de).toBeNull();
  });

  it("sin idiomas adicionales no hay nada que traducir", async () => {
    const { getFooterTranslationEditor } = await import("./footerTranslationsDb");
    const r = await getFooterTranslationEditor(memoryI18nRepo({ pages: [], home: "inicio" }));
    expect(r).toMatchObject({ multilingual: false, locales: [], items: [] });
  });
});

describe("rutas públicas y conexión", () => {
  const guard = fs.readFileSync(path.join(__dirname, "authGuard.ts"), "utf8");
  const routers = fs.readFileSync(path.join(__dirname, "routers.ts"), "utf8");
  const footerSrc = fs.readFileSync(path.join(__dirname, "..", "client/src/components/TenantTheme.tsx"), "utf8");
  it("el texto del pie es una consulta pública autorizada (la ven los visitantes sin sesión)", () => {
    expect(guard).toContain('"public.getFooterText"');
    expect(routers).toMatch(/getFooterText: publicProcedure/);
  });
  it("el pie usa lo localizado (texto del idioma, menú del idioma) y abre las redes de forma segura", () => {
    expect(footerSrc).toContain("public.getFooterText.useQuery");
    expect(footerSrc).toContain('target="_blank"');
    expect(footerSrc).toContain('rel="noopener noreferrer"');
    expect(footerSrc).toContain("footerLayout(");
    expect(footerSrc).not.toContain("Plataforma Big Elephant");
  });
  it("el selector de idioma sigue conservando ?opcion= (sin cambios)", () => {
    expect(switcherQuery("/tienda/x", "?opcion=3")).toBe("?opcion=3");
  });
});
