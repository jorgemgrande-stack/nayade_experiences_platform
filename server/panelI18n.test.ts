import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  catalogFromModules,
  createFormatters,
  createTranslator,
  flatCatalog,
  format,
  normalizeLocale,
  placeholderNames,
  resolveLocale,
  type Messages,
} from "../shared/i18n/core";
import { NAV_LABELS_DE, localizeNav, navLabel } from "../shared/i18n/navLabels";
import { TASK_NAV, LEGACY_SECTIONS } from "../shared/adminNav";
import * as extensions from "../shared/panelExtensions";

/** Contrato de la internacionalización del panel (docs/i18n/README.md): sistema común, paridad es/de y sin textos sueltos. */
const modules = import.meta.glob("../shared/i18n/locales/*/*.ts", { eager: true }) as Record<string, { default: Messages }>;
const catalog = catalogFromModules(modules);
const flat = flatCatalog(catalog);

describe("idiomas", () => {
  it("normaliza etiquetas de idioma y resuelve la prioridad usuario > navegador > español", () => {
    expect(normalizeLocale("de-DE")).toBe("de");
    expect(normalizeLocale("ES")).toBe("es");
    expect(normalizeLocale("fr")).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(resolveLocale({ saved: "de", stored: "es" })).toBe("de");
    expect(resolveLocale({ saved: null, stored: "de" })).toBe("de");
    expect(resolveLocale({ saved: "fr", stored: "xx" })).toBe("es");
    expect(resolveLocale({})).toBe("es");
  });
});

describe("traductor", () => {
  const dicts = { es: { "a.hola": "Hola {name}", "a.solo": "Solo español", "a.n": "{count, plural, =0 {Ninguno} one {# cliente} other {# clientes}}" }, de: { "a.hola": "Hallo {name}", "a.n": "{count, plural, =0 {Keine} one {# Kunde} other {# Kunden}}" } };
  it("interpola parámetros", () => {
    expect(createTranslator("de", dicts).t("a.hola", { name: "Indira" })).toBe("Hallo Indira");
  });
  it("cae al español si falta la traducción y avisa; si falta en todo, devuelve la clave", () => {
    const missing: string[] = [];
    const tr = createTranslator("de", dicts, (k) => missing.push(k));
    expect(tr.t("a.solo")).toBe("Solo español");
    expect(tr.t("a.no.existe")).toBe("a.no.existe");
    expect(missing).toEqual(["a.solo", "a.no.existe"]);
    expect(tr.has("a.solo")).toBe(false);
  });
  it("aplica plurales por idioma, con el número formateado", () => {
    const de = createTranslator("de", dicts).t;
    expect(de("a.n", { count: 0 })).toBe("Keine");
    expect(de("a.n", { count: 1 })).toBe("1 Kunde");
    expect(de("a.n", { count: 1234 })).toBe("1.234 Kunden");
    expect(createTranslator("es", dicts).t("a.n", { count: 1234 })).toBe("1234 clientes");
  });
  it("un parámetro ausente se deja a la vista, sin romper", () => {
    expect(format("Hola {name}", {}, "es")).toBe("Hola {name}");
  });
  it("detecta los parámetros de una plantilla, también dentro de plurales", () => {
    expect(placeholderNames("{n, plural, one {# de {total}} other {# de {total}}} {name}")).toEqual(["n", "name", "total"]);
  });
});

describe("formatos locales", () => {
  const d = new Date(Date.UTC(2026, 10, 21, 12, 5));
  it("fechas, horas, números y monedas por idioma", () => {
    const es = createFormatters("es");
    const de = createFormatters("de");
    expect(es.date(d, { timeZone: "UTC" })).toBe("21/11/2026");
    expect(de.date(d, { timeZone: "UTC" })).toBe("21.11.2026");
    expect(de.number(1234567.891)).toBe("1.234.567,891");
    expect(de.currency(62.92)).toMatch(/^62,92\s€$/);
    expect(es.currency(1234.5)).toMatch(/^1234,50\s€$/);
    expect(de.currency(1234.5)).toMatch(/^1\.234,50\s€$/);
    expect(de.percent(0.21)).toMatch(/^21[\s ]%$/);
    expect(de.date(null)).toBe("—");
    expect(de.number(NaN)).toBe("—");
  });
  it("ordena con las reglas del idioma", () => {
    expect(["Zoe", "Ärger", "Anna"].sort(createFormatters("de").collator.compare)).toEqual(["Anna", "Ärger", "Zoe"]);
  });
});

describe("paridad de los diccionarios", () => {
  const namespaces = Object.keys(catalog.es);
  it("hay diccionario alemán para cada espacio en español, y viceversa", () => {
    expect(Object.keys(catalog.de).sort()).toEqual(namespaces.sort());
  });
  it("mismas claves y mismos parámetros en es y de, sin textos vacíos", () => {
    const missing: string[] = [];
    const extra: string[] = [];
    const params: string[] = [];
    const empty: string[] = [];
    for (const [k, v] of Object.entries(flat.es)) {
      const de = flat.de[k];
      if (de === undefined) missing.push(k);
      else if (placeholderNames(v).join() !== placeholderNames(de).join()) params.push(k);
      if (v.trim() === "" || de?.trim() === "") empty.push(k);
    }
    for (const k of Object.keys(flat.de)) if (!(k in flat.es)) extra.push(k);
    expect({ missing, extra, params, empty }).toEqual({ missing: [], extra: [], params: [], empty: [] });
  });
});

describe("menú del panel", () => {
  const labels = new Set<string>();
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    if (typeof o.label === "string") labels.add(o.label);
    for (const v of Object.values(o)) walk(v);
  };
  walk(TASK_NAV);
  walk(LEGACY_SECTIONS);
  walk(Object.values(extensions));

  it("todas las etiquetas del menú tienen traducción alemana", () => {
    expect([...labels].filter((l) => !(l in NAV_LABELS_DE))).toEqual([]);
  });
  it("localizeNav traduce etiquetas y respeta rutas, claves y permisos; el español no se toca", () => {
    const sections = [{ id: "s", label: "Clientes y ventas", items: [{ label: "Presupuestos", href: "/x", key: "k", children: [{ label: "Propuestas", href: "/y" }] }] }];
    const out = localizeNav(sections, "de");
    expect(out[0].label).toBe("Kunden und Verkauf");
    expect(out[0].items[0]).toMatchObject({ label: "Angebote", href: "/x", key: "k" });
    expect(out[0].items[0].children?.[0]).toMatchObject({ label: "Vorschläge", href: "/y" });
    expect(localizeNav(sections, "es")).toBe(sections);
    expect(navLabel("Etiqueta nueva sin traducir", "de")).toBe("Etiqueta nueva sin traducir");
  });
});

/** Recorre el código del cliente buscando `t("espacio.clave")`: toda clave usada debe existir en español. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("uso de t() en el código", () => {
  it("toda clave literal usada en el cliente existe en el diccionario español", () => {
    const root = join(__dirname, "..", "client", "src");
    const unknown: string[] = [];
    for (const f of sourceFiles(root)) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/\bt\(\s*["']([a-zA-Z][\w]*(?:\.[\w]+)+)["']/g)) {
        if (!(m[1] in flat.es)) unknown.push(`${relative(root, f)}: ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
