/**
 * Modelo de bloques del constructor de la web: validación, saneado, conversión desde las páginas antiguas en HTML,
 * resumen en HTML, datos de la empresa y reglas de la dirección de la página.
 */
import { describe, it, expect } from "vitest";
import { blocksToHtml, htmlText, htmlToBlocks, normalizeBlocks, PageBlocksError, readStoredBlocks, renderBlockTokens, safeLink } from "./_core/pageBlocks";
import { STARTER_PAGES } from "./_core/templates/starterSite";
import { sanitizeRichHtml } from "./_core/htmlSanitize";
import { BLOCK_TYPES, PAGE_TEMPLATES, createBlock, duplicateBlock, pageSlugProblem, slugFromTitle, templateBlocks, type PageBlock } from "../shared/pageBlocks";

describe("validación y saneado de los bloques", () => {
  it("completa los datos que faltan y descarta los que sobran", () => {
    const [b] = normalizeBlocks([{ id: "x1", type: "hero", data: { title: "  Hola  ", extra: "nada", buttonUrl: "/contacto" } }]);
    expect(b).toEqual({ id: "x1", type: "hero", data: { title: "Hola", subtitle: "", imageUrl: "", imageAlt: "", buttonLabel: "", buttonUrl: "/contacto" } });
  });

  it("todos los tipos del catálogo se aceptan con sus valores iniciales", () => {
    const blocks = BLOCK_TYPES.map((t) => createBlock(t));
    expect(normalizeBlocks(blocks).map((b) => b.type)).toEqual([...BLOCK_TYPES]);
  });

  it("rechaza un tipo desconocido, una lista que no lo es y demasiados bloques", () => {
    expect(() => normalizeBlocks([{ type: "script", data: {} }])).toThrow(PageBlocksError);
    expect(() => normalizeBlocks({})).toThrow(PageBlocksError);
    expect(() => normalizeBlocks(Array.from({ length: 61 }, () => createBlock("separator")))).toThrow(/hasta 60 bloques/);
    expect(() => normalizeBlocks([createBlock("gallery", { images: Array.from({ length: 25 }, () => ({ url: "/a.png", alt: "" })) })])).toThrow(/24 imágenes/);
  });

  it("sanea el texto con formato: sin scripts, estilos, manejadores ni enlaces peligrosos", () => {
    const [b] = normalizeBlocks([createBlock("text", { html: '<p onclick="x()">Hola <b>mundo</b><script>alert(1)</script><a href="javascript:alert(1)">mal</a><a href="/contacto">bien</a></p><style>p{}</style>' })]);
    expect(b.type === "text" && b.data.html).toBe('<p>Hola <b>mundo</b><a>mal</a><a href="/contacto">bien</a></p>');
  });

  it("un texto vacío del editor se guarda vacío", () => {
    const [b] = normalizeBlocks([createBlock("text", { html: "<p><br></p>" })]);
    expect(b.type === "text" && b.data.html).toBe("");
  });

  it("enlaces e imágenes: solo rutas de la web, http(s), correo y teléfono", () => {
    expect(safeLink("/servicios")).toBe("/servicios");
    expect(safeLink("https://ejemplo.es/a")).toBe("https://ejemplo.es/a");
    expect(safeLink("www.ejemplo.es")).toBe("https://www.ejemplo.es");
    expect(safeLink("mailto:hola@ejemplo.es")).toBe("mailto:hola@ejemplo.es");
    expect(safeLink("tel:+34910000000")).toBe("tel:+34910000000");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "vbscript:x"]) expect(safeLink(bad)).toBe("");
    const [img] = normalizeBlocks([createBlock("image", { url: "javascript:alert(1)", alt: "x" })]);
    expect(img.type === "image" && img.data.url).toBe("");
    const [gal] = normalizeBlocks([{ type: "gallery", data: { images: ["/a.png", { url: "data:image/png;base64,AAA" }, { url: "https://cdn.example/b.jpg", alt: "B" }] } }]);
    expect(gal.type === "gallery" && gal.data.images).toEqual([{ url: "/a.png", alt: "" }, { url: "https://cdn.example/b.jpg", alt: "B" }]);
  });

  it("opciones fuera de lista toman su valor por defecto; identificadores repetidos se renuevan", () => {
    const blocks = normalizeBlocks([{ id: "a", type: "columns", data: { imagePosition: "top" } }, { id: "a", type: "button", data: { variant: "rojo", align: "x" } }]);
    expect(blocks[0].type === "columns" && blocks[0].data.imagePosition).toBe("right");
    expect(blocks[1].type === "button" && blocks[1].data).toMatchObject({ variant: "primary", align: "center" });
    expect(blocks[0].id).not.toBe(blocks[1].id);
  });

  it("la lectura de lo guardado omite los bloques que no reconoce en lugar de romper la página", () => {
    expect(readStoredBlocks([{ type: "cta", data: {} }, createBlock("separator")]).map((b) => b.type)).toEqual(["separator"]);
    expect(readStoredBlocks("no")).toEqual([]);
  });

  it("duplicar un bloque copia sus datos con otro identificador", () => {
    const b = createBlock("gallery", { images: [{ url: "/a.png", alt: "A" }] });
    const c = duplicateBlock(b);
    expect(c.id).not.toBe(b.id);
    expect(c.data).toEqual(b.data);
    (c.data as { images: unknown[] }).images.push({ url: "/b.png", alt: "" });
    expect((b.data as { images: unknown[] }).images).toHaveLength(1);
  });
});

/** Texto visible de un HTML (para comprobar que la conversión no pierde contenido). */
const visible = (html: string) => htmlText(sanitizeRichHtml(html).replace(/<img\b[^>]*alt="([^"]*)"[^>]*>/g, " [img $1] "));

describe("páginas antiguas en HTML → bloques", () => {
  it("cada título de sección abre un bloque; las imágenes y las líneas pasan a sus bloques", () => {
    const html = '<h1>Quiénes somos</h1><p>Somos una <strong>asesoría</strong>.</p><p><img src="/f.jpg" alt="Equipo"></p><h2>Servicios</h2><ul><li>Fiscal</li><li>Laboral</li></ul><hr><p><img src="/a.jpg" alt="A"><img src="/b.jpg" alt="B"></p><h3>Detalle</h3><p>Más.</p>';
    const blocks = htmlToBlocks(html);
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text", "separator", "gallery", "text"]);
    expect(blocks[0]).toMatchObject({ type: "text", data: { title: "Quiénes somos", html: "<p>Somos una <strong>asesoría</strong>.</p>" } });
    expect(blocks[1]).toMatchObject({ type: "image", data: { url: "/f.jpg", alt: "Equipo" } });
    expect(blocks[2]).toMatchObject({ type: "text", data: { title: "Servicios", html: "<ul><li>Fiscal</li><li>Laboral</li></ul>" } });
    expect(blocks[4]).toMatchObject({ type: "gallery", data: { images: [{ url: "/a.jpg", alt: "A" }, { url: "/b.jpg", alt: "B" }] } });
    // El h3 y su párrafo se conservan en un texto sin título
    expect(blocks[5]).toMatchObject({ type: "text", data: { title: "", html: "<h3>Detalle</h3><p>Más.</p>" } });
  });

  it("no pierde contenido: las páginas iniciales (portada y textos legales) conservan todo su texto y sus datos", () => {
    for (const p of STARTER_PAGES) {
      const blocks = htmlToBlocks(p.content);
      expect(blocks.length).toBeGreaterThan(0);
      expect(visible(blocksToHtml(blocks)), p.slug).toBe(visible(p.content));
      // Los datos de la empresa siguen como marcadores, para rellenarse al servir
      expect(JSON.stringify(blocks)).toContain("{{nombre}}");
    }
  });

  it("texto sin etiquetas, tablas y enlaces se conservan; un texto suelto pasa a párrafo", () => {
    const html = 'Hola suelto<table><tr><td>Celda</td></tr></table><p><a href="/x">enlace</a></p>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type === "text" && blocks[0].data.html).toBe('<p>Hola suelto</p><table><tr><td>Celda</td></tr></table><p><a href="/x">enlace</a></p>');
  });

  it("lo peligroso de una página antigua no pasa a los bloques", () => {
    const blocks = htmlToBlocks('<h2 onclick="x">T</h2><script>alert(1)</script><p>ok</p><img src="javascript:1">');
    expect(JSON.stringify(blocks)).not.toMatch(/script|javascript|onclick/);
    expect(blocks[0]).toMatchObject({ type: "text", data: { title: "T", html: "<p>ok</p>" } });
  });

  it("una página vacía no tiene bloques", () => {
    expect(htmlToBlocks("")).toEqual([]);
  });
});

describe("resumen en HTML y datos de la empresa", () => {
  it("el resumen recoge títulos, textos, imágenes y botones; el formulario solo con su título", () => {
    const blocks = normalizeBlocks([
      createBlock("hero", { title: "Asesoría López", subtitle: "Impuestos sin líos", imageUrl: "/h.jpg", imageAlt: "Oficina", buttonLabel: "Contacta", buttonUrl: "/contacto" }),
      createBlock("columns", { title: "Fiscal", html: "<p>Declaraciones</p>", imageUrl: "/c.jpg", imageAlt: "C" }),
      createBlock("contact_form", { title: "Escríbenos" }),
      createBlock("separator"),
    ]);
    const html = blocksToHtml(blocks);
    expect(html).toBe('<h1>Asesoría López</h1><p>Impuestos sin líos</p><img src="/h.jpg" alt="Oficina"><p><a href="/contacto">Contacta</a></p><h2>Fiscal</h2><p>Declaraciones</p><img src="/c.jpg" alt="C"><h2>Escríbenos</h2><p>Déjanos tus datos y te responderemos lo antes posible.</p><hr>');
  });

  it("los datos de la empresa se rellenan al servir; un dato que falta quita su línea, sin marcadores a la vista", () => {
    const blocks: PageBlock[] = [
      createBlock("hero", { title: "{{nombre}}", subtitle: "Llámanos al {{telefono}}" }),
      createBlock("text", { title: "Contacto", html: "<ul><li>Teléfono: {{telefono}}</li><li>Correo electrónico: {{email}}</li></ul>" }),
    ];
    const out = renderBlockTokens(blocks, { nombre: "López & Hijos", telefono: "910 000 000", email: "" });
    expect(out[0].data).toMatchObject({ title: "López & Hijos", subtitle: "Llámanos al 910 000 000" });
    expect(out[1].type === "text" && out[1].data.html).toBe("<ul><li>Teléfono: 910 000 000</li></ul>");
    // Sin tocar los bloques originales (los del borrador)
    expect(blocks[0].data).toMatchObject({ title: "{{nombre}}" });
  });
});

describe("dirección de la página y plantillas", () => {
  it("la dirección se genera del título y se valida", () => {
    expect(slugFromTitle("¿Quiénes somos?")).toBe("quienes-somos");
    expect(slugFromTitle("Página de Servicios & Precios 2026")).toBe("pagina-de-servicios-precios-2026");
    expect(slugFromTitle("a".repeat(80))).toHaveLength(64);
    expect(pageSlugProblem("quienes-somos")).toBeNull();
    expect(pageSlugProblem("contacto")).toBeNull();
    expect(pageSlugProblem("")).toMatch(/Indica/);
    expect(pageSlugProblem("Quiénes")).toMatch(/minúsculas/);
    expect(pageSlugProblem("-a")).toMatch(/minúsculas/);
    for (const r of ["admin", "tienda", "login", "presupuesto", "blog"]) expect(pageSlugProblem(r)).toMatch(/ya la usa/);
  });

  it("las plantillas son válidas, genéricas y sin términos de otro sector", () => {
    for (const t of PAGE_TEMPLATES) {
      const blocks = normalizeBlocks(templateBlocks(t.key, "Mi página"));
      expect(blocks.length).toBeGreaterThan(0);
      expect(JSON.stringify(blocks)).not.toMatch(/n[aá]yade|experiencia|actividad|reserva|hotel|spa\b|kayak|esqu[ií]/i);
    }
    expect(templateBlocks("contact", "Contacto").some((b) => b.type === "contact_form")).toBe(true);
    expect(templateBlocks("services", "Servicios").some((b) => b.type === "columns")).toBe(true);
  });
});
