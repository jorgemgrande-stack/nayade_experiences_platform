/**
 * Elephant Studio: «Sección con columnas». Operaciones del editor sobre el árbol (buscar, insertar, mover, quitar,
 * cambiar el reparto) y saneado del servidor (profundidad, módulos de ancho completo, límite total, ids únicos).
 */
import { describe, it, expect } from "vitest";
import { PAGE_LIMITS, createBlock, duplicateBlock, type PageBlock } from "../shared/pageBlocks";
import {
  countBlocks, createSection, findBlock, insertBlocks, mapBlock, moveBlock, placeProblem, relayoutColumns, removeBlock, syncSectionColumns,
} from "../shared/studio/tree";
import { blocksToHtml, normalizeBlocks, readStoredBlocks, renderBlockTokens, PageBlocksError } from "./_core/pageBlocks";
import { renderTokens } from "../client/src/components/admin/studio/tokens";

const text = (id: string, title = id): PageBlock => ({ ...createBlock("text", { title, html: `<p>${title}</p>` }), id });
const section = (id: string, columns: PageBlock[][], layout = columns.length === 1 ? "1" : columns.length === 3 ? "1-1-1" : "1-1"): PageBlock => {
  const s = createBlock("section");
  return { ...s, id, data: { ...s.data, layout: layout as any, columns: columns.map((blocks) => ({ blocks })) } } as PageBlock;
};
const cols = (b: PageBlock) => (b.type === "section" ? b.data.columns.map((c) => c.blocks.map((x) => x.id)) : null);

describe("árbol de la página", () => {
  const page = () => [text("a"), section("s", [[text("c1")], [text("c2"), section("n", [[text("d")], []])]]), text("z")];

  it("encuentra un bloque esté donde esté, con su sección, columna, posición y profundidad", () => {
    expect(findBlock(page(), "c2")).toMatchObject({ parent: "s", col: 1, index: 0, depth: 1 });
    expect(findBlock(page(), "d")).toMatchObject({ parent: "n", col: 0, index: 0, depth: 2 });
    expect(findBlock(page(), "z")).toMatchObject({ parent: null, index: 2, depth: 0 });
    expect(countBlocks(page())).toBe(7);
  });

  it("cambia, inserta y quita dentro de una columna sin tocar lo demás", () => {
    const p = page();
    const renamed = mapBlock(p, "d", (b) => ({ ...b, data: { ...b.data, title: "nuevo" } }) as PageBlock);
    expect((findBlock(renamed, "d")!.block.data as any).title).toBe("nuevo");
    expect(renamed[0]).toBe(p[0]);
    expect(mapBlock(p, "no-existe", (b) => b)).toBe(p);
    const inserted = insertBlocks(p, { parent: "s", col: 0, index: 0 }, [text("nuevo")]);
    expect(cols(inserted[1])).toEqual([["nuevo", "c1"], ["c2", "n"]]);
    expect(cols(removeBlock(p, "c2")[1])).toEqual([["c1"], ["n"]]);
  });

  it("mueve entre la página y las columnas, y dentro de la misma lista", () => {
    const p = page();
    const intoColumn = moveBlock(p, "a", { parent: "s", col: 0, index: 1 });
    expect(intoColumn.map((b) => b.id)).toEqual(["s", "z"]);
    expect(cols(intoColumn[0])).toEqual([["c1", "a"], ["c2", "n"]]);
    const out = moveBlock(p, "c1", { parent: null, col: 0, index: 3 });
    expect(out.map((b) => b.id)).toEqual(["a", "s", "z", "c1"]);
    expect(moveBlock(p, "a", { parent: null, col: 0, index: 2 }).map((b) => b.id)).toEqual(["s", "a", "z"]);
    expect(moveBlock(p, "a", { parent: null, col: 0, index: 1 })).toBe(p);
  });

  it("no mete una sección dentro de sí misma ni más allá de un nivel, ni módulos de ancho completo en columnas", () => {
    const p = page();
    expect(moveBlock(p, "s", { parent: "n", col: 1, index: 0 })).toBe(p);
    expect(moveBlock(p, "s", { parent: "s", col: 0, index: 0 })).toBe(p);
    expect(placeProblem(p, { parent: "n", col: 0, index: 0 }, [createSection()])).toMatch(/un nivel/);
    expect(placeProblem(p, { parent: "s", col: 0, index: 0 }, [createSection()])).toBeNull();
    expect(placeProblem(p, { parent: "s", col: 0, index: 0 }, [createBlock("hero")])).toMatch(/todo el ancho/);
    expect(placeProblem(p, { parent: "s", col: 5, index: 0 }, [text("x")])).toMatch(/no existe/);
  });

  it("al cambiar el reparto no se pierde contenido: lo de las columnas que sobran pasa a la última", () => {
    expect(relayoutColumns([{ blocks: [text("x")] }, { blocks: [text("y")] }, { blocks: [text("w")] }], "1-1").map((c) => c.blocks.map((b) => b.id))).toEqual([["x"], ["y", "w"]]);
    expect(relayoutColumns([{ blocks: [text("x")] }], "1-2-1").map((c) => c.blocks.length)).toEqual([1, 0, 0]);
    const s = section("s", [[text("x")], [text("y")]]);
    const one = syncSectionColumns({ ...s, data: { ...s.data, layout: "1" } } as PageBlock);
    expect(cols(one)).toEqual([["x", "y"]]);
    expect(syncSectionColumns(s)).toBe(s);
  });

  it("duplicar una sección da otros identificadores también a lo de dentro", () => {
    const s = page()[1];
    const copy = duplicateBlock(s);
    const ids = new Set<string>();
    for (const list of [[s], [copy]]) for (const b of list) ids.add(b.id);
    const inner = (b: PageBlock): string[] => (b.type === "section" ? b.data.columns.flatMap((c) => c.blocks.flatMap((x) => [x.id, ...inner(x)])) : []);
    const original = inner(s);
    expect(inner(copy).some((id) => original.includes(id))).toBe(false);
    expect(copy.id).not.toBe(s.id);
  });

  it("una sección nueva viene con texto e imagen y supera la validación del servidor", () => {
    const s = createSection();
    expect(cols(s)!.map((c) => c.length)).toEqual([1, 1]);
    expect(normalizeBlocks([s])[0]).toEqual(s);
  });
});

describe("validación del servidor de las secciones", () => {
  it("una sección anidada un nivel se conserva tal cual", () => {
    const p = [section("s", [[text("c1")], [section("n", [[text("d")], []])]])];
    expect(normalizeBlocks(p)).toEqual(p);
  });

  it("rechaza dos niveles de anidación y los módulos de ancho completo dentro de una columna", () => {
    const deep = [section("s", [[section("n", [[section("x", [[]])], []])], []])];
    expect(() => normalizeBlocks(deep)).toThrow(/un nivel/);
    const hero = [section("s", [[createBlock("hero")], []])];
    expect(() => normalizeBlocks(hero)).toThrow(PageBlocksError);
  });

  it("el límite de bloques cuenta también los de dentro de las columnas", () => {
    const many = Array.from({ length: PAGE_LIMITS.blocks }, (_, i) => text(`t${i}`));
    expect(() => normalizeBlocks([section("s", [many.slice(0, 30), many.slice(30)])])).toThrow(/hasta/);
    expect(normalizeBlocks([section("s", [many.slice(0, 30), many.slice(31)])]).length).toBe(1);
  });

  it("los identificadores repetidos en el árbol se cambian; columnas de más pasan a la última", () => {
    const raw = [text("x"), { ...section("s", [[text("x")], [text("y")], [text("w")]]), data: { ...section("s", []).data, layout: "1-1", columns: [{ blocks: [text("x")] }, { blocks: [text("y")] }, { blocks: [text("w")] }] } }];
    const [first, s] = normalizeBlocks(raw);
    const c = cols(s)!;
    expect(c.map((l) => l.length)).toEqual([1, 2]);
    expect(c[0][0]).not.toBe(first.id);
    expect(c[1]).toEqual(["y", "w"]);
  });

  it("al leer lo guardado, un bloque dañado dentro de una columna se omite sin perder el resto", () => {
    const stored = [section("s", [[{ id: "mal", type: "no-existe", data: {} } as any, text("ok")], [createBlock("hero")]])];
    expect(cols(readStoredBlocks(stored)[0])).toEqual([["ok"], []]);
  });

  it("los textos de dentro de las columnas llegan al HTML de buscadores y los datos de la empresa se rellenan dentro", () => {
    const p = normalizeBlocks([section("s", [[text("c1", "Clases de esquí")], [text("c2", "Llama al {{telefono}}")]])]);
    const html = blocksToHtml(p);
    expect(html).toContain("Clases de esquí");
    const vars = { nombre: "Skibox", telefono: "600 000 000" };
    const server = renderBlockTokens(p, vars);
    const client = renderTokens(p, vars);
    expect(JSON.stringify(server)).toContain("600 000 000");
    expect(client).toEqual(server);
  });
});
