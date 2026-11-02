/**
 * Elephant Studio: registro de módulos, validación por esquema, diseño de cada bloque, resumen en HTML, datos de la
 * empresa en las listas, historial de deshacer y mensajes del lienzo. Sin base de datos (la persistencia de versiones
 * y el aislamiento entre empresas están en essential.studio.mysql.test.ts).
 */
import { describe, it, expect } from "vitest";
import { BLOCK_TYPES, createBlock, defaultBlockData, isDefaultStyle, type PageBlock } from "../shared/pageBlocks";
import { MODULES, SECTION_PRESETS, availableModules, inlineFields, moduleDef, searchModules } from "../shared/studio/modules";
import { blocksToHtml, normalizeBlocks, normalizeStyle, readStoredBlocks, renderBlockTokens, PageBlocksError } from "./_core/pageBlocks";
import { docReducer, initialDoc } from "../client/src/components/admin/studio/history";
import { parseDragPayload } from "../client/src/components/admin/studio/protocol";
import { renderTokens } from "../client/src/components/admin/studio/tokens";

const one = (type: string, data: Record<string, unknown>, style?: unknown) => normalizeBlocks([{ id: "b1", type, data, ...(style ? { style } : {}) }])[0] as any;

describe("registro de módulos", () => {
  it("cada tipo de bloque tiene su módulo, y cada campo del módulo existe en sus datos iniciales", () => {
    for (const t of BLOCK_TYPES) {
      const def = moduleDef(t);
      expect(def, t).toBeTruthy();
      const initial = defaultBlockData(t) as Record<string, unknown>;
      for (const f of def!.fields) expect(Object.keys(initial), `${t}.${f.key}`).toContain(f.key);
    }
    expect(MODULES.length).toBe(BLOCK_TYPES.length);
  });

  it("los datos iniciales de cada módulo superan la validación del servidor sin cambios", () => {
    for (const t of BLOCK_TYPES) {
      const b = createBlock(t);
      const [n] = normalizeBlocks([b]);
      expect(n.data, t).toEqual(b.data);
    }
  });

  it("las secciones prediseñadas producen bloques válidos", () => {
    for (const p of SECTION_PRESETS) {
      const blocks = p.build();
      expect(blocks.length, p.key).toBeGreaterThan(0);
      expect(normalizeBlocks(blocks).map((b) => b.type)).toEqual(blocks.map((b) => b.type));
    }
  });

  it("la licencia decide qué módulos se ofrecen (productos solo con la tienda)", () => {
    expect(availableModules(() => false).map((m) => m.type)).not.toContain("products");
    expect(availableModules((c) => c === "shop-catalog").map((m) => m.type)).toContain("products");
  });

  it("el buscador encuentra por nombre y palabras clave, sin tildes", () => {
    expect(searchModules(MODULES, "galeria").map((m) => m.type)).toContain("gallery");
    expect(searchModules(MODULES, "OPINIONES").map((m) => m.type)).toEqual(["testimonials"]);
    expect(searchModules(MODULES, "  ").length).toBe(MODULES.length);
  });

  it("solo los textos marcados se editan sobre el lienzo", () => {
    expect(inlineFields("hero")).toEqual(["title", "subtitle", "buttonLabel"]);
    expect(inlineFields("image")).toEqual(["caption"]);
  });
});

describe("validación por esquema de los módulos nuevos", () => {
  it("ventajas: icono fuera de la lista → visto bueno; columnas fuera de la lista → las de serie; lo que sobra se descarta", () => {
    const b = one("features", { title: "  Por qué  ", columns: "7", extra: "x", items: [{ icon: "bomba", title: "A", text: "B", onclick: "x" }] });
    expect(b.data).toEqual({ title: "Por qué", intro: "", columns: "3", items: [{ icon: "check", title: "A", text: "B" }] });
  });

  it("una lista más larga que su máximo se rechaza con un mensaje para la persona", () => {
    const items = Array.from({ length: 13 }, () => ({ title: "x", text: "y", icon: "star" }));
    expect(() => one("features", { items })).toThrow(PageBlocksError);
    expect(() => one("features", { items })).toThrow(/admite hasta 12/);
  });

  it("llamada a la acción: enlaces peligrosos fuera; los de la web, correo y teléfono se conservan", () => {
    const b = one("cta", { title: "Hola", buttonLabel: "Ir", buttonUrl: "javascript:alert(1)", secondaryLabel: "Llamar", secondaryUrl: "tel:910000000" });
    expect(b.data.buttonUrl).toBe("");
    expect(b.data.secondaryUrl).toBe("tel:910000000");
  });

  it("vídeo: solo direcciones https; lo demás se vacía", () => {
    expect(one("video", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).data.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(one("video", { url: "http://vimeo.com/123456" }).data.url).toBe("");
    expect(one("video", { url: "javascript:alert(1)" }).data.url).toBe("");
  });

  it("productos: la categoría es una dirección válida o ninguna; la cantidad, una de la lista", () => {
    expect(one("products", { categorySlug: "../x", limit: "99" }).data).toMatchObject({ categorySlug: "", limit: "4" });
    expect(one("products", { categorySlug: "cafes", limit: "8" }).data).toMatchObject({ categorySlug: "cafes", limit: "8" });
  });

  it("título: nivel y alineación de la lista; por defecto, sección centrada", () => {
    expect(one("heading", { title: "Hola", level: "h6", align: "derecha" }).data).toMatchObject({ level: "h2", align: "center" });
  });

  it("un bloque de tipo desconocido sigue rechazándose; al leer lo guardado, se omite", () => {
    expect(() => normalizeBlocks([{ type: "script", data: {} }])).toThrow(PageBlocksError);
    expect(readStoredBlocks([{ type: "script", data: {} }, { id: "ok", type: "heading", data: { title: "T" } }]).map((b) => b.type)).toEqual(["heading"]);
  });
});

describe("diseño de cada bloque", () => {
  it("valores fuera de la lista vuelven a los de serie; el diseño de serie no se guarda", () => {
    expect(normalizeStyle({ background: "url(x)", padTop: "999px", hideOn: ["tv"], anchor: "<b>" })).toBeUndefined();
    expect(normalizeStyle(null)).toBeUndefined();
    expect(isDefaultStyle(undefined)).toBe(true);
  });

  it("fondo, espacios, visibilidad y ancla válidos se conservan", () => {
    const s = normalizeStyle({ background: "brand", padTop: "l", padBottom: "s", hideOn: ["mobile", "mobile", "desktop"], anchor: "servicios", color: "red" });
    expect(s).toEqual({ background: "brand", padTop: "l", padBottom: "s", hideOn: ["desktop", "mobile"], anchor: "servicios" });
  });

  it("el diseño viaja con el bloque al validar y un bloque sin diseño queda igual que antes", () => {
    expect(one("text", { title: "T", html: "<p>x</p>" }, { background: "dark" }).style).toMatchObject({ background: "dark" });
    expect("style" in one("text", { title: "T", html: "<p>x</p>" })).toBe(false);
  });
});

describe("resumen en HTML y datos de la empresa", () => {
  it("los módulos nuevos aportan su texto (escapado) a buscadores y búsqueda del panel", () => {
    const blocks = normalizeBlocks([
      createBlock("heading", { eyebrow: "Servicios", title: "Lo <b>que</b> hacemos", level: "h1" }),
      createBlock("faq", { title: "Dudas", items: [{ question: "¿Abrís en agosto?", answer: "Sí" }] }),
      createBlock("testimonials", { title: "", items: [{ quote: "Genial", author: "Ana", role: "Cliente" }] }),
    ]);
    const html = blocksToHtml(blocks);
    expect(html).toContain("<h1>Lo &lt;b&gt;que&lt;/b&gt; hacemos</h1>");
    expect(html).toContain("<h3>¿Abrís en agosto?</h3>");
    expect(html).toContain("Ana, Cliente");
    expect(html).not.toMatch(/<b>que<\/b>/);
  });

  it("los datos de la empresa se rellenan también dentro de las listas (servidor y lienzo, igual)", () => {
    const blocks = normalizeBlocks([createBlock("features", { title: "{{nombre}}", items: [{ icon: "phone", title: "Llámanos", text: "Al {{telefono}}" }] })]);
    const tokens = { nombre: "Café Luna", telefono: "910 000 000" };
    const server = renderBlockTokens(blocks, tokens) as any;
    const canvas = renderTokens(blocks, tokens) as any;
    expect(server[0].data.items[0].text).toBe("Al 910 000 000");
    expect(canvas[0].data).toEqual(server[0].data);
  });
});

describe("historial de deshacer y rehacer", () => {
  const b = (t: string) => [createBlock("heading", { title: t })] as PageBlock[];
  it("deshacer y rehacer recorren los cambios; un cambio nuevo borra lo que se podía rehacer", () => {
    let s = docReducer(initialDoc, { type: "load", blocks: b("A") });
    s = docReducer(s, { type: "change", blocks: b("B"), now: 1 });
    s = docReducer(s, { type: "change", blocks: b("C"), now: 10_000 });
    s = docReducer(s, { type: "undo" });
    expect((s.blocks[0].data as any).title).toBe("B");
    s = docReducer(s, { type: "redo" });
    expect((s.blocks[0].data as any).title).toBe("C");
    s = docReducer(s, { type: "undo" });
    s = docReducer(s, { type: "change", blocks: b("D"), now: 20_000 });
    expect(s.future).toEqual([]);
    expect(s.past.length).toBe(2);
  });

  it("escribir seguido en el mismo campo es un solo paso de deshacer", () => {
    let s = docReducer(initialDoc, { type: "load", blocks: b("") });
    for (const [i, t] of ["H", "Ho", "Hol", "Hola"].entries()) s = docReducer(s, { type: "change", blocks: b(t), coalesceKey: "x:title", now: 1000 + i * 200 });
    expect(s.past.length).toBe(1);
    s = docReducer(s, { type: "undo" });
    expect((s.blocks[0].data as any).title).toBe("");
  });

  it("cada cambio aumenta la revisión (el autoguardado sabe que hay algo pendiente)", () => {
    const s = docReducer(docReducer(initialDoc, { type: "load", blocks: [] }), { type: "change", blocks: b("x") });
    expect(s.revision).toBe(1);
  });
});

describe("mensajes del lienzo", () => {
  it("solo se aceptan arrastres de módulos, secciones o bloques con un identificador válido", () => {
    expect(parseDragPayload("module:faq")).toEqual({ what: "module", value: "faq" });
    expect(parseDragPayload("preset:portada")).toEqual({ what: "preset", value: "portada" });
    expect(parseDragPayload("block:b1x")).toEqual({ what: "block", value: "b1x" });
    expect(parseDragPayload("https://otra.web")).toBeNull();
    expect(parseDragPayload("module:<img>")).toBeNull();
  });
});
