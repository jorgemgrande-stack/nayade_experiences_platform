/**
 * Elephant Studio: registro de módulos, validación por esquema, diseño de cada bloque, resumen en HTML, datos de la
 * empresa en las listas, historial de deshacer y mensajes del lienzo. Sin base de datos (la persistencia de versiones
 * y el aislamiento entre empresas están en essential.studio.mysql.test.ts).
 */
import { describe, it, expect } from "vitest";
import { BLOCK_TYPES, createBlock, cssUrl, DEFAULT_BLOCK_STYLE, defaultBlockData, isDefaultStyle, type PageBlock } from "../shared/pageBlocks";
import { LIBRARY_ELEMENTS, LIBRARY_SECTIONS, MODULES, SECTION_PRESETS, availableModules, fieldTab, inlineFields, libraryMatch, moduleDef, searchModules } from "../shared/studio/modules";
import { blocksToHtml, normalizeBlocks, normalizeStyle, readStoredBlocks, renderBlockTokens, PageBlocksError } from "./_core/pageBlocks";
import { docReducer, initialDoc } from "../client/src/components/admin/studio/history";
import { parseDragPayload } from "../client/src/components/admin/studio/protocol";
import { renderTokens } from "../client/src/components/admin/studio/tokens";
import { imageUploadProblem, siteRelativeFileUrl, uploadErrorMessage } from "../shared/imageUpload";

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

  it("las entradas del blog solo se ofrecen con el blog en la licencia", () => {
    expect(availableModules(() => false).map((m) => m.type)).not.toContain("blog_posts");
    expect(availableModules((c) => c === "cms-blog").map((m) => m.type)).toContain("blog_posts");
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

describe("biblioteca agrupada", () => {
  it("cada módulo y cada sección prediseñada aparece una sola vez (elementos o una categoría de secciones)", () => {
    const types = [...LIBRARY_ELEMENTS, ...LIBRARY_SECTIONS.flatMap((c) => c.types)];
    expect([...types].sort()).toEqual(MODULES.map((m) => m.type).sort());
    const presets = LIBRARY_SECTIONS.flatMap((c) => c.presets);
    expect([...presets].sort()).toEqual(SECTION_PRESETS.map((p) => p.key).sort());
  });
  it("inspector: cada opción en su pestaña; las avanzadas solo en el modo profesional", () => {
    const tabOf = (type: string, key: string, pro: boolean) => fieldTab(moduleDef(type as any)!.fields.find((f) => f.key === key)!, pro);
    expect(tabOf("heading", "title", false)).toBe("content");
    expect(tabOf("heading", "align", false)).toBe("design");
    expect(tabOf("heading", "level", false)).toBeNull();
    expect(tabOf("heading", "level", true)).toBe("advanced");
    expect(tabOf("slideshow", "autoplay", false)).toBe("behavior");
    expect(tabOf("slideshow", "transition", false)).toBeNull();
    expect(tabOf("slideshow", "transition", true)).toBe("behavior");
    expect(tabOf("form", "redirectUrl", true)).toBe("behavior");
    expect(tabOf("section", "mobile", true)).toBe("advanced");
    expect(tabOf("button", "url", false)).toBe("content");
    // En el modo profesional ninguna opción se queda sin pestaña
    for (const m of MODULES) for (const f of m.fields) expect(fieldTab(f, true)).not.toBeNull();
  });
  it("el buscador ignora tildes y mayúsculas", () => {
    expect(libraryMatch("galeria", "Galería", "fotos")).toBe(true);
    expect(libraryMatch("  ", "lo que sea")).toBe(true);
    expect(libraryMatch("precio", "Opiniones")).toBe(false);
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

  it("entradas del blog: cantidad y opciones de la lista; textos recortados; lo que sobra se descarta", () => {
    const b = one("blog_posts", { title: "  Novedades ", limit: "50", showExcerpt: "quizá", layout: "carousel", buttonLabel: "Ver el blog", posts: [{ slug: "x" }] });
    expect(b.data).toEqual({ title: "Novedades", intro: "", limit: "3", showExcerpt: "on", buttonLabel: "Ver el blog", layout: "carousel" });
    expect(blocksToHtml([b])).toContain('href="/blog"');
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
    expect(s).toEqual({ ...DEFAULT_BLOCK_STYLE, background: "brand", padTop: "l", padBottom: "s", hideOn: ["desktop", "mobile"], anchor: "servicios" });
  });

  it("tipografía, caja, espacios y móvil: valores de la lista se conservan; los demás vuelven a los de serie", () => {
    const s = normalizeStyle({
      headingFont: "serif", textFont: "comic-sans", headingSize: "xl", textSize: "l", align: "center", headingColor: "brand",
      border: "thin", radius: "m", shadow: "l", marginTop: "s", marginBottom: "huge", padTop: "xl", mobileAlign: "left", mobileSpacing: "less",
    });
    expect(s).toMatchObject({
      headingFont: "serif", textFont: "auto", headingSize: "xl", textSize: "l", align: "center", headingColor: "brand",
      border: "thin", radius: "m", shadow: "l", marginTop: "s", marginBottom: "0", padTop: "xl", mobileAlign: "left", mobileSpacing: "less",
    });
  });

  it("degradado e imagen: solo se guardan con su fondo; la imagen, saneada como las de los módulos", () => {
    expect(normalizeStyle({ background: "gradient", gradient: "night" })).toMatchObject({ background: "gradient", gradient: "night" });
    expect(normalizeStyle({ background: "gradient", gradient: "rainbow" })).toMatchObject({ gradient: "brand" });
    // Sin su fondo, degradado, imagen y capa no cuentan: el diseño queda de serie y no se guarda
    expect(normalizeStyle({ background: "none", gradient: "night", bgImage: "https://x.es/a.jpg", overlay: "light" })).toBeUndefined();
    const img = normalizeStyle({ background: "image", bgImage: "javascript:alert(1)", overlay: "brand" });
    expect(img).toMatchObject({ background: "image", bgImage: "", overlay: "brand" });
    expect(normalizeStyle({ background: "image", bgImage: "https://cdn.example.com/fondo.jpg", overlay: "x" })).toMatchObject({ bgImage: "https://cdn.example.com/fondo.jpg", overlay: "dark" });
  });

  it("la dirección de la imagen de fondo no puede salirse de url(…) en el CSS", () => {
    expect(cssUrl('https://x.es/a")%3B b(c).jpg')).toBe("https://x.es/a%22%29%3B%20b%28c%29.jpg");
    expect(cssUrl("/files/01/foto.jpg")).toBe("/files/01/foto.jpg");
  });

  it("un diseño guardado antes de los estilos nuevos se lee igual (lo que falta toma su valor de serie)", () => {
    expect(normalizeStyle({ background: "dark", padTop: "m", padBottom: "0", hideOn: [], anchor: "", animation: "fade" })).toEqual({ ...DEFAULT_BLOCK_STYLE, background: "dark", padTop: "m", animation: "fade" });
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

describe("regresiones de la revisión funcional (imágenes y guardado)", () => {
  const ID = "01hzx0v6k2m8q9r3s4t5u6v7w8";
  it("una imagen de Multimedia se guarda como ruta propia (sirve en cualquier dominio de la empresa)", () => {
    expect(siteRelativeFileUrl(`https://skibox.app.bigelephant.es/files/${ID}/BAQUEIRA.jpg`)).toBe(`/files/${ID}/BAQUEIRA.jpg`);
    expect(siteRelativeFileUrl("https://cdn.otra.web/foto.jpg")).toBe("https://cdn.otra.web/foto.jpg");
    expect(one("image", { url: `https://app.bigelephant.es/files/${ID}/BAQUEIRA.jpg` }).data.url).toBe(`/files/${ID}/BAQUEIRA.jpg`);
    expect(one("hero", { imageUrl: `https://skibox.es/files/${ID}/x.png` }).data.imageUrl).toBe(`/files/${ID}/x.png`);
    expect(one("gallery", { images: [{ url: `https://skibox.es/files/${ID}/a.jpg`, alt: "A" }] }).data.images[0].url).toBe(`/files/${ID}/a.jpg`);
    // Un fichero privado o una ruta que no es de Multimedia no se toca
    expect(one("image", { url: `/api/files/${ID}` }).data.url).toBe(`/api/files/${ID}`);
  });

  it("la subida explica por qué no se admite un fichero, igual que el servidor", () => {
    expect(imageUploadProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(imageUploadProblem({ type: "image/bmp", size: 1000 })).toMatch(/formato no se admite/);
    expect(imageUploadProblem({ type: "text/plain", size: 4 })).toMatch(/formato no se admite/);
    expect(imageUploadProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/más de 10 MB/);
    expect(uploadErrorMessage(413)).toMatch(/más de 10 MB/);
    expect(uploadErrorMessage(400, "Tipo de archivo no permitido")).toBe("Tipo de archivo no permitido");
    expect(uploadErrorMessage(401)).toMatch(/sesión/);
    expect(uploadErrorMessage(502)).toMatch(/servidor/);
  });

  it("un cambio que llega tarde (subida, diálogo) se aplica sobre el documento vigente y no deshace lo editado", () => {
    let s = docReducer(initialDoc, { type: "load", blocks: [createBlock("image", { caption: "" })] as PageBlock[] });
    const id = s.blocks[0].id;
    // Mientras sube la imagen, la persona escribe el pie de foto
    s = docReducer(s, { type: "apply", fn: (bs) => bs.map((b) => (b.id === id ? ({ ...b, data: { ...b.data, caption: "Pistas" } } as PageBlock) : b)) });
    // Termina la subida: solo cambia la imagen
    s = docReducer(s, { type: "apply", fn: (bs) => bs.map((b) => (b.id === id ? ({ ...b, data: { ...b.data, url: "/files/x/a.jpg" } } as PageBlock) : b)) });
    expect(s.blocks[0].data).toMatchObject({ caption: "Pistas", url: "/files/x/a.jpg" });
    // Un cambio sobre un bloque que ya no existe no altera nada ni ensucia el historial
    const same = docReducer(s, { type: "apply", fn: (bs) => bs });
    expect(same).toBe(s);
  });

  it("la subida responde en JSON aunque multer la rechace (antes era una página de error)", async () => {
    const { singleImage } = await import("./uploadRoutes");
    const express = (await import("express")).default;
    const app = express();
    app.post("/subir", singleImage("image"), (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const run = async (type: string, size: number) => {
      const fd = new FormData();
      fd.append("image", new Blob([new Uint8Array(size)], { type }), "f");
      const r = await fetch(`http://127.0.0.1:${port}/subir`, { method: "POST", body: fd });
      return { status: r.status, body: (await r.json()) as { error?: string; ok?: boolean } };
    };
    try {
      expect((await run("text/plain", 4)).status).toBe(400);
      const big = await run("image/jpeg", 10 * 1024 * 1024 + 10);
      expect(big.status).toBe(413);
      expect(big.body.error).toMatch(/10 MB/);
      expect(await run("image/png", 100)).toEqual({ status: 200, body: { ok: true } });
    } finally {
      server.close();
    }
  }, 30_000);
});

describe("presentaciones, carruseles y animaciones", () => {
  const ID = "01hzx0v6k2m8q9r3s4t5u6v7w8";
  it("diapositivas: enlaces e imágenes saneados, opciones de la lista y máximo de 10", () => {
    const b = one("slideshow", {
      slides: [{ title: "Hola", imageUrl: `https://skibox.es/files/${ID}/a.jpg`, buttonLabel: "Ir", buttonUrl: "javascript:alert(1)", button2Url: "/tienda", align: "derecha", valign: "bottom", onload: "x" }],
      height: "gigante", transition: "fade", autoplay: "off", interval: "7",
    });
    expect(b.data.slides[0]).toMatchObject({ title: "Hola", imageUrl: `/files/${ID}/a.jpg`, buttonUrl: "", button2Url: "/tienda", align: "left", valign: "bottom" });
    expect(b.data.slides[0]).not.toHaveProperty("onload");
    expect(b.data).toMatchObject({ height: "l", transition: "fade", autoplay: "off", interval: "6" });
    expect(() => one("slideshow", { slides: Array.from({ length: 11 }, () => ({ title: "x" })) })).toThrow(/hasta 10/);
  });

  it("galería guardada antes de Studio: rejilla y ampliar por defecto; mosaico y carrusel válidos", () => {
    expect(one("gallery", { title: "", images: [{ url: "/x.jpg", alt: "" }] }).data).toMatchObject({ layout: "grid", lightbox: "on" });
    expect(one("gallery", { images: [], layout: "masonry", lightbox: "off" }).data).toMatchObject({ layout: "masonry", lightbox: "off" });
    expect(one("gallery", { images: [], layout: "<script>" }).data.layout).toBe("grid");
  });

  it("opiniones: foto y valoración; tarjetas y carrusel con sus opciones", () => {
    const t = one("testimonials", { layout: "carousel", items: [{ quote: "Bien", author: "Ana", photoUrl: "javascript:x", rating: "9" }] });
    expect(t.data.layout).toBe("carousel");
    expect(t.data.items[0]).toMatchObject({ photoUrl: "", rating: "0" });
    const c = one("cards", { layout: "carousel", columns: "4", items: [{ title: "T", buttonUrl: "www.ejemplo.es" }] });
    expect(c.data).toMatchObject({ layout: "carousel", columns: "4" });
    expect(c.data.items[0].buttonUrl).toBe("https://www.ejemplo.es");
    expect(one("carousel", { perView: "5", autoplay: "on" }).data).toMatchObject({ perView: "3", autoplay: "on", lightbox: "on" });
  });

  it("animación al aparecer: lista cerrada; sin animación no se guarda diseño", () => {
    expect(normalizeStyle({ animation: "up" })).toMatchObject({ animation: "up" });
    expect(normalizeStyle({ animation: "explosion" })).toBeUndefined();
    expect(isDefaultStyle({ animation: "none" })).toBe(true);
  });

  it("resumen en HTML de diapositivas y tarjetas; datos de la empresa también en las diapositivas", () => {
    const blocks = normalizeBlocks([createBlock("slideshow", { slides: [{ ...defaultBlockData("slideshow").slides[0], title: "Bienvenidos a {{nombre}}" }] }), createBlock("cards")]);
    const html = blocksToHtml(blocks);
    expect(html).toContain("<h1>Bienvenidos a {{nombre}}</h1>");
    expect(html).toContain("<h3>Primera tarjeta</h3>");
    const rendered = renderBlockTokens(blocks, { nombre: "Skibox" }) as any;
    expect(rendered[0].data.slides[0].title).toBe("Bienvenidos a Skibox");
  });
});

describe("tabla de precios, cifras y logos", () => {
  it("precios: textos libres saneados, enlaces seguros, destacado de la lista y máximo de 6 planes", () => {
    const b = one("pricing", { plans: [{ name: "Pro", price: "49 €", features: "Uno\nDos", buttonUrl: "javascript:x", highlighted: "quizá" }] });
    expect(b.data.plans[0]).toMatchObject({ name: "Pro", price: "49 €", features: "Uno\nDos", buttonUrl: "", highlighted: "off" });
    expect(() => one("pricing", { plans: Array.from({ length: 7 }, () => ({ name: "x" })) })).toThrow(/hasta 6/);
  });

  it("cifras y logos: valores de la lista y resumen en HTML", () => {
    const s = one("stats", { animate: "no", items: [{ value: "2500", suffix: "+", label: "clientes" }] });
    expect(s.data.animate).toBe("on");
    const l = one("logos", { logos: [{ url: "javascript:x", alt: "" }, { url: "/files/x.png", alt: "Marca" }], grayscale: "off" });
    expect(l.data.logos).toEqual([{ url: "/files/x.png", alt: "Marca" }]);
    const html = blocksToHtml(normalizeBlocks([createBlock("pricing"), createBlock("stats")]));
    expect(html).toContain("<h3>Completo</h3>");
    expect(html).toContain("<li>Todo lo del plan básico</li>");
    expect(html).toContain("2500+ clientes atendidos");
  });
});

describe("mensajes del lienzo", () => {
  it("solo se aceptan arrastres de módulos, secciones o bloques con un identificador válido", () => {
    expect(parseDragPayload("module:faq")).toEqual({ what: "module", value: "faq" });
    expect(parseDragPayload("preset:portada")).toEqual({ what: "preset", value: "portada" });
    expect(parseDragPayload("block:b1x")).toEqual({ what: "block", value: "b1x" });
    expect(parseDragPayload("saved:bmw11g3qb1tc")).toEqual({ what: "saved", value: "bmw11g3qb1tc" });
    expect(parseDragPayload("https://otra.web")).toBeNull();
    expect(parseDragPayload("module:<img>")).toBeNull();
  });
});
