/**
 * Elephant Studio: ventanas emergentes (módulo «modal»). Esquema y saneado del servidor, contenido anidado, recursión
 * prohibida, identificadores y enlaces que las abren (activadores), cierres, memoria de «no volver a mostrar», operaciones
 * del editor sobre el árbol y plantilla de ejemplo. Datos de ejemplo genéricos.
 */
import { describe, it, expect } from "vitest";
import {
  PageBlocksError, blocksToHtml, normalizeBlocks, readStoredBlocks, renderBlockTokens,
} from "./_core/pageBlocks";
import { BLOCK_TYPES, NOT_NESTABLE, createBlock, defaultBlockData, duplicateBlock, templateBlocks, type BlockOf, type PageBlock } from "../shared/pageBlocks";
import { moduleDef } from "../shared/studio/modules";
import { findBlock, insertBlocks, moveBlock, placeProblem, removeBlock } from "../shared/studio/tree";
import {
  MODAL_DAY_MS, modalClosing, modalDismissalActive, modalHref, modalSessionKey, modalSlugFrom, modalSlugFromHref, modalStorageKey,
  modalTargetLabel, pageModals, uniqueModalSlug, withUniqueModalSlugs,
} from "../shared/studio/modal";

const text = (id: string, html = "<p>Hola</p>"): PageBlock => ({ ...createBlock("text", { html }), id });
const modal = (id: string, slug: string, blocks: PageBlock[] = [text(`${id}-t`)], data: Record<string, unknown> = {}): BlockOf<"modal"> => {
  const m = createBlock("modal");
  return { ...m, id, data: { ...m.data, slug, title: `Ventana ${slug}`, ...data, columns: [{ blocks }] } } as BlockOf<"modal">;
};
const inner = (b: PageBlock) => (b.type === "modal" ? b.data.columns[0].blocks : []);

describe("módulo modal: esquema y valores iniciales", () => {
  it("es un tipo de bloque más, añadido al final sin reordenar los anteriores", () => {
    // «modal» sigue a «section»; tras él solo se añaden tipos nuevos (p. ej. upcoming_dates, E-4), sin reordenar
    expect(BLOCK_TYPES.indexOf("modal")).toBe(BLOCK_TYPES.indexOf("section") + 1);
    expect(BLOCK_TYPES.slice(0, 8)).toEqual(["hero", "text", "image", "gallery", "button", "columns", "contact_form", "separator"]);
    expect(moduleDef("modal")).toBeTruthy();
  });

  it("nace cerrada, sin apertura automática y con todos los cierres", () => {
    const d = defaultBlockData("modal");
    expect(d.autoOpen).toBe("off");
    expect([d.showClose, d.closeOnOverlay, d.closeOnEsc]).toEqual(["on", "on", "on"]);
    expect(d.columns).toHaveLength(1);
    expect(d.columns[0].blocks.length).toBeGreaterThan(0);
  });

  it("los valores iniciales pasan la validación sin cambiar", () => {
    const [b] = normalizeBlocks([{ ...createBlock("modal"), id: "m1" }]);
    expect(b.type).toBe("modal");
    const d = (b as BlockOf<"modal">).data;
    expect(d.slug).toBe("ventana");
    expect(d.autoOpen).toBe("off");
    expect(d.columns[0].blocks[0].type).toBe("text");
  });

  it("no lleva cadenas fijas en el código del esquema: textos de cierre y de «no volver a mostrar» son campos", () => {
    const keys = moduleDef("modal")!.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["title", "imageAlt", "closeLabel", "rememberLabel"]));
  });
});

describe("módulo modal: saneado", () => {
  it("valores fuera de la lista cerrada vuelven al de serie (apertura automática, tamaño, cierres)", () => {
    const [b] = normalizeBlocks([modal("m1", "uno", [], { autoOpen: "siempre", size: "enorme", autoDelay: "0", rememberDays: "9999", showClose: "quizás" })]);
    const d = (b as BlockOf<"modal">).data;
    expect(d.autoOpen).toBe("off");
    expect(d.size).toBe("m");
    expect(d.autoDelay).toBe("5");
    expect(d.rememberDays).toBe("30");
    expect(d.showClose).toBe("on");
  });

  it("acepta los activadores válidos", () => {
    const [b] = normalizeBlocks([modal("m1", "uno", [], { autoOpen: "exit", autoDelay: "20", rememberOption: "off", rememberDays: "90" })]);
    expect((b as BlockOf<"modal">).data).toMatchObject({ autoOpen: "exit", autoDelay: "20", rememberOption: "off", rememberDays: "90" });
  });

  it("sanea el HTML del contenido anidado y las direcciones: sin scripts ni javascript:", () => {
    const [b] = normalizeBlocks([
      modal("m1", "uno", [
        text("t1", '<p onclick="x()">Hola</p><script>alert(1)</script><img src=x onerror=alert(1)>'),
        { ...createBlock("button", { label: "Ir", url: "javascript:alert(1)" }), id: "b1" } as PageBlock,
        { ...createBlock("image", { url: "javascript:alert(2)" }), id: "i1" } as PageBlock,
      ], { imageUrl: "javascript:alert(3)", title: "<img src=x onerror=alert(1)>" }),
    ]);
    const m = b as BlockOf<"modal">;
    const html = (m.data.columns[0].blocks[0] as BlockOf<"text">).data.html;
    expect(html).not.toMatch(/script|onclick|onerror/i);
    expect((m.data.columns[0].blocks[1] as BlockOf<"button">).data.url).toBe("");
    expect((m.data.columns[0].blocks[2] as BlockOf<"image">).data.url).toBe("");
    expect(m.data.imageUrl).toBe("");
    // El título es texto simple (React lo escapa al pintarlo) y el resumen en HTML lo escapa
    expect(blocksToHtml([m])).not.toMatch(/<img src=x onerror/i);
  });

  it("no admite HTML crudo: un campo `html` o `script` en la ventana se descarta", () => {
    const [b] = normalizeBlocks([modal("m1", "uno", [], { html: "<script>1</script>", script: "x", embed: "<iframe>" })]);
    expect(Object.keys((b as BlockOf<"modal">).data).sort()).toEqual(Object.keys(defaultBlockData("modal")).sort());
  });

  it("el identificador del enlace es válido y único en la página", () => {
    const out = normalizeBlocks([
      modal("a", "oferta"), modal("b", "oferta"), modal("c", "Mal Id!"), modal("d", ""), modal("e", "oferta"),
    ]).map((b) => (b as BlockOf<"modal">).data.slug);
    expect(new Set(out).size).toBe(5);
    expect(out[0]).toBe("oferta");
    expect(out[1]).toBe("oferta-2");
    expect(out[4]).toBe("oferta-3");
    for (const s of out) expect(s).toMatch(/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/);
  });

  it("un identificador vacío se genera a partir del título", () => {
    const [b] = normalizeBlocks([modal("a", "", [], { title: "¡Oferta de Otoño!" })]);
    expect((b as BlockOf<"modal">).data.slug).toBe("oferta-de-otono");
  });
});

describe("módulo modal: contenido anidado y recursión", () => {
  it("guarda módulos de texto, imagen, botón, formulario, columnas y tarjetas dentro, con sus datos saneados", () => {
    const [b] = normalizeBlocks([
      modal("m1", "uno", [text("t1"), createBlock("image"), createBlock("button"), createBlock("form"), createBlock("columns"), createBlock("cards"), createBlock("contact_form")]),
    ]);
    expect(inner(b).map((x) => x.type)).toEqual(["text", "image", "button", "form", "columns", "cards", "contact_form"]);
  });

  it("el formulario de dentro es el bloque de formulario de siempre (no una lógica aparte)", () => {
    const [b] = normalizeBlocks([modal("m1", "uno", [createBlock("form", { title: "Pide información" })])]);
    const f = inner(b)[0] as BlockOf<"form">;
    expect(f.type).toBe("form");
    expect(f.data.fields.map((x) => x.role)).toEqual(["name", "email", "phone", "none"]);
  });

  it("una ventana dentro de otra ventana se rechaza (sin recursión)", () => {
    expect(() => normalizeBlocks([modal("m1", "uno", [modal("m2", "dos")])])).toThrow(PageBlocksError);
    expect(() => normalizeBlocks([modal("m1", "uno", [modal("m2", "dos")])])).toThrow(/nivel de página/);
  });

  it("una ventana dentro de una sección o de una columna se rechaza", () => {
    const s = createBlock("section");
    const section = { ...s, data: { ...s.data, columns: [{ blocks: [modal("m1", "uno")] }, { blocks: [] }] } } as PageBlock;
    expect(() => normalizeBlocks([section])).toThrow(/nivel de página/);
  });

  it("dentro de una ventana no caben los módulos de ancho completo", () => {
    expect(() => normalizeBlocks([modal("m1", "uno", [createBlock("hero")])])).toThrow(/ancho/);
    expect(() => normalizeBlocks([modal("m1", "uno", [createBlock("slideshow")])])).toThrow(/ancho/);
    expect(NOT_NESTABLE).toContain("modal");
  });

  it("dentro de una ventana cabe una sección con columnas, pero no una sección dentro de ella", () => {
    const sec = (children: PageBlock[]): PageBlock => {
      const s = createBlock("section");
      return { ...s, data: { ...s.data, columns: [{ blocks: children }, { blocks: [] }] } } as PageBlock;
    };
    expect(() => normalizeBlocks([modal("m1", "uno", [sec([text("t")])])])).not.toThrow();
    expect(() => normalizeBlocks([modal("m1", "uno", [sec([sec([])])])])).toThrow(/un nivel/);
  });

  it("los módulos de dentro cuentan para el límite de bloques de la página y sus identificadores son únicos", () => {
    const many = Array.from({ length: 60 }, (_, i) => text(`t${i}`));
    expect(() => normalizeBlocks([modal("m1", "uno", many)])).toThrow(/hasta 60 bloques/);
    const [a, b] = normalizeBlocks([modal("m1", "uno", [text("igual")]), modal("m2", "dos", [text("igual")])]);
    expect(inner(a)[0].id).not.toBe(inner(b)[0].id);
  });

  it("si llegan varias columnas se juntan en una (no se pierde contenido)", () => {
    const m = modal("m1", "uno");
    const raw = { ...m, data: { ...m.data, columns: [{ blocks: [text("a")] }, { blocks: [text("b")] }] } };
    const [b] = normalizeBlocks([raw]);
    expect((b as BlockOf<"modal">).data.columns).toHaveLength(1);
    expect(inner(b).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("lo guardado se lee con tolerancia: un bloque dañado dentro no tumba la ventana", () => {
    const m = modal("m1", "uno", [text("t1")]);
    const raw = [{ ...m, data: { ...m.data, columns: [{ blocks: [{ type: "viejo", data: {} }, text("t2")] }] } }];
    const [b] = readStoredBlocks(raw);
    expect(inner(b).map((x) => x.id)).toEqual(["t2"]);
  });

  it("las páginas sin ventanas no cambian: mismos bloques y mismo resumen", () => {
    const blocks = normalizeBlocks([text("a"), createBlock("faq"), createBlock("button")]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "faq", "button"]);
    expect(blocksToHtml(blocks)).not.toMatch(/Ventana/);
  });
});

describe("módulo modal: resumen para buscadores y datos de la empresa", () => {
  it("el contenido de la ventana (título, imagen y módulos de dentro) va en el resumen en HTML", () => {
    const html = blocksToHtml([modal("m1", "uno", [text("t1", "<p>Detalle de la ficha</p>")], { title: "Ficha uno", imageUrl: "/files/1/a.png", imageAlt: "Foto" })]);
    expect(html).toContain("<h2>Ficha uno</h2>");
    expect(html).toContain("Detalle de la ficha");
    expect(html).toContain('alt="Foto"');
  });

  it("los datos de la empresa ({{telefono}}…) también se sustituyen dentro de la ventana", () => {
    const [b] = renderBlockTokens([modal("m1", "uno", [text("t1", "<p>Llama al {{telefono}}</p>")], { title: "Hola {{nombre}}" })], { nombre: "Mi Empresa", telefono: "900000000" } as never);
    expect((b as BlockOf<"modal">).data.title).toBe("Hola Mi Empresa");
    expect((inner(b)[0] as BlockOf<"text">).data.html).toContain("900000000");
  });
});

describe("activadores: enlaces #modal-<identificador>", () => {
  it("la dirección que abre una ventana se arma y se reconoce", () => {
    expect(modalHref("oferta")).toBe("#modal-oferta");
    expect(modalSlugFromHref("#modal-oferta")).toBe("oferta");
    expect(modalSlugFromHref("/tarifas#modal-oferta-2")).toBe("oferta-2");
    expect(modalSlugFromHref("#oferta")).toBeNull();
    expect(modalSlugFromHref("/contacto")).toBeNull();
    expect(modalSlugFromHref("#modal-")).toBeNull();
    expect(modalSlugFromHref("#modal-Mal Id")).toBeNull();
    expect(modalSlugFromHref("##modal-x")).toBeNull();
    expect(modalSlugFromHref("")).toBeNull();
    expect(modalSlugFromHref(undefined)).toBeNull();
  });

  it("un botón, una tarjeta o un CTA conservan la dirección #modal-… tras el saneado (no hace falta campo nuevo)", () => {
    const [btn, cards, cta, hero] = normalizeBlocks([
      createBlock("button", { url: "#modal-oferta" }),
      createBlock("cards", { items: [{ imageUrl: "", imageAlt: "", title: "T", text: "x", buttonLabel: "Ver", buttonUrl: "#modal-oferta" }] }),
      createBlock("cta", { buttonUrl: "#modal-oferta", secondaryUrl: "#modal-otra" }),
      createBlock("hero", { buttonUrl: "#modal-oferta" }),
    ]);
    expect((btn as BlockOf<"button">).data.url).toBe("#modal-oferta");
    expect((cards as BlockOf<"cards">).data.items[0].buttonUrl).toBe("#modal-oferta");
    expect((cta as BlockOf<"cta">).data).toMatchObject({ buttonUrl: "#modal-oferta", secondaryUrl: "#modal-otra" });
    expect((hero as BlockOf<"hero">).data.buttonUrl).toBe("#modal-oferta");
  });

  it("el editor ofrece cada ventana por su nombre, no por su identificador", () => {
    const page = [text("a"), modal("m1", "oferta", undefined, { title: "Oferta de otoño" }), modal("m2", "otra", undefined, { title: "" })];
    expect(pageModals(page)).toEqual([
      { id: "m1", slug: "oferta", title: "Oferta de otoño" },
      { id: "m2", slug: "otra", title: "" },
    ]);
    expect(modalTargetLabel("Oferta de otoño", "oferta")).toBe("Abrir la ventana «Oferta de otoño»");
    expect(modalTargetLabel("  ", "otra")).toBe("Abrir la ventana «otra»");
  });

  it("identificadores: se generan del texto y no chocan al insertar, duplicar o pegar", () => {
    expect(modalSlugFrom("Ficha técnica nº 1")).toBe("ficha-tecnica-n-1");
    expect(modalSlugFrom("¡¡")).toBe("ventana");
    expect(uniqueModalSlug("a", new Set(["a", "a-2"]))).toBe("a-3");
    expect(uniqueModalSlug("x".repeat(40), new Set(["x".repeat(40)])).length).toBeLessThanOrEqual(40);
    const page = [modal("m1", "ventana")];
    const [copy] = withUniqueModalSlugs([createBlock("modal")], page);
    expect((copy as BlockOf<"modal">).data.slug).toBe("ventana-2");
    const dup = duplicateBlock(page[0]) as BlockOf<"modal">;
    expect(dup.id).not.toBe("m1");
    expect(dup.data.slug).not.toBe("ventana");
    expect(dup.data.columns[0].blocks[0].id).not.toBe(page[0].data.columns[0].blocks[0].id);
  });
});

describe("cierres y apertura automática (sin dark patterns)", () => {
  it("una ventana nunca queda sin salida en el móvil: si no se cierra pulsando fuera, el botón se mantiene", () => {
    expect(modalClosing({ showClose: "off", closeOnOverlay: "off", closeOnEsc: "off" })).toEqual({ button: true, overlay: false, esc: false });
    expect(modalClosing({ showClose: "off", closeOnOverlay: "off", closeOnEsc: "on" }).button).toBe(true);
    expect(modalClosing({ showClose: "off", closeOnOverlay: "on", closeOnEsc: "off" })).toEqual({ button: false, overlay: true, esc: false });
    expect(modalClosing({ showClose: "on", closeOnOverlay: "on", closeOnEsc: "on" })).toEqual({ button: true, overlay: true, esc: true });
  });

  it("«no volver a mostrar»: se recuerda hasta la fecha y caduca; sin dato, no hay descarte", () => {
    const now = 1_700_000_000_000;
    expect(modalDismissalActive(String(now + 30 * MODAL_DAY_MS), now)).toBe(true);
    expect(modalDismissalActive(String(now - 1), now)).toBe(false);
    expect(modalDismissalActive(null, now)).toBe(false);
    expect(modalDismissalActive("basura", now)).toBe(false);
  });

  it("las claves del navegador son propias de cada ventana", () => {
    expect(modalStorageKey("a")).not.toBe(modalStorageKey("b"));
    expect(modalSessionKey("a")).not.toBe(modalStorageKey("a"));
  });

  it("la apertura automática es opt-in: ninguna plantilla ni valor inicial la activa", () => {
    const all = [createBlock("modal"), ...templateBlocks("modal-cards", "Fichas")].filter((b) => b.type === "modal") as BlockOf<"modal">[];
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(m.data.autoOpen).toBe("off");
  });
});

describe("editor: el árbol de la página con ventanas", () => {
  const page = () => [text("a"), modal("m", "uno", [text("c1")]), text("z")];

  it("encuentra, inserta, mueve y quita módulos dentro de la ventana", () => {
    expect(findBlock(page(), "c1")).toMatchObject({ parent: "m", col: 0, index: 0, depth: 1 });
    const inserted = insertBlocks(page(), { parent: "m", col: 0, index: 1 }, [text("nuevo")]);
    expect(inner(inserted[1]).map((b) => b.id)).toEqual(["c1", "nuevo"]);
    const moved = moveBlock(page(), "a", { parent: "m", col: 0, index: 0 });
    expect(moved.map((b) => b.id)).toEqual(["m", "z"]);
    expect(inner(moved[0]).map((b) => b.id)).toEqual(["a", "c1"]);
    expect(inner(removeBlock(page(), "c1")[1])).toEqual([]);
  });

  it("no deja meter una ventana en una ventana ni en una columna, ni un módulo de ancho completo en una ventana", () => {
    const p = page();
    expect(placeProblem(p, { parent: "m", col: 0, index: 0 }, [modal("x", "otra")])).toMatch(/nivel de página/);
    expect(moveBlock([...p, modal("m2", "dos")], "m2", { parent: "m", col: 0, index: 0 }).map((b) => b.id)).toEqual(["a", "m", "z", "m2"]);
    expect(placeProblem(p, { parent: "m", col: 0, index: 0 }, [createBlock("hero")])).toMatch(/ancho/);
    expect(placeProblem(p, { parent: "m", col: 0, index: 0 }, [text("ok")])).toBeNull();
    const s = createBlock("section");
    const sec = { ...s, id: "s", data: { ...s.data, columns: [{ blocks: [] }, { blocks: [] }] } } as PageBlock;
    expect(placeProblem([sec], { parent: "s", col: 0, index: 0 }, [modal("x", "otra")])).toMatch(/nivel de página/);
    expect(placeProblem(p, { parent: "m", col: 3, index: 0 }, [text("ok")])).toMatch(/no existe/);
  });
});

describe("plantilla «Fichas en ventana»", () => {
  it("es genérica, valida y cada botón de tarjeta abre la ventana de su ficha", () => {
    const blocks = normalizeBlocks(templateBlocks("modal-cards", "Nuestras fichas"));
    const slugs = new Set(pageModals(blocks).map((m) => m.slug));
    expect(slugs.size).toBe(3);
    const cards = blocks.find((b) => b.type === "cards") as BlockOf<"cards">;
    expect(cards.data.items).toHaveLength(3);
    for (const it of cards.data.items) expect(slugs.has(modalSlugFromHref(it.buttonUrl) ?? "")).toBe(true);
    const html = JSON.stringify(blocks);
    expect(html).not.toMatch(/quantum|soulrise|nayade|n[aá]yade/i);
  });
});
