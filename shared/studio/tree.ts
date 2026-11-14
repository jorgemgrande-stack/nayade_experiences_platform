/**
 * Elephant Studio: la página como árbol. Una «Sección con columnas» guarda en cada columna su propia lista de bloques
 * (`data.columns[i].blocks`), así que un bloque puede estar en la página o dentro de una columna. Estas funciones
 * buscan, cambian, quitan, insertan y mueven bloques estén donde estén, sin mutar nada (devuelven una lista nueva).
 *
 * Un sitio se indica con `{ parent, col, index }`: `parent` null es la propia página; si no, el id de la sección y el
 * número de su columna.
 */
import {
  createBlock, NOT_NESTABLE, SECTION_MAX_DEPTH, sectionColumnCount, type BlockOf, type BlockType, type PageBlock, type SectionColumn,
} from "../pageBlocks";

export interface Place {
  parent: string | null;
  col: number;
  index: number;
}

export interface Found {
  block: PageBlock;
  parent: string | null;
  col: number;
  index: number;
  /** 0 en la página, 1 dentro de una sección, 2 dentro de una sección anidada */
  depth: number;
}

/** Columnas de un bloque con módulos dentro: una sección, o la ventana emergente (que tiene una sola). */
const columnsOf = (b: PageBlock): SectionColumn[] | null => (b.type === "section" || b.type === "modal" ? b.data.columns : null);

function withColumns(b: PageBlock, columns: SectionColumn[]): PageBlock {
  return { ...b, data: { ...b.data, columns } } as PageBlock;
}

/** Cada bloque del árbol, en el orden en que se ve. */
export function walk(blocks: PageBlock[], visit: (f: Found) => void, parent: string | null = null, col = 0, depth = 0): void {
  blocks.forEach((block, index) => {
    visit({ block, parent, col, index, depth });
    columnsOf(block)?.forEach((c, i) => walk(c.blocks, visit, block.id, i, depth + 1));
  });
}

export function findBlock(blocks: PageBlock[], id: string): Found | null {
  let hit: Found | null = null;
  walk(blocks, (f) => {
    if (!hit && f.block.id === id) hit = f;
  });
  return hit;
}

/** Todos los bloques del árbol (las secciones y lo que llevan dentro cuentan uno a uno). */
export function countBlocks(blocks: PageBlock[]): number {
  let n = 0;
  walk(blocks, () => n++);
  return n;
}

/** Profundidad de secciones que lleva un bloque dentro (0 si no es una sección o está vacía de secciones). */
export function sectionDepth(b: PageBlock): number {
  const cols = columnsOf(b);
  if (!cols) return 0;
  return 1 + Math.max(0, ...cols.flatMap((c) => c.blocks.map(sectionDepth)));
}

/** Cambia el bloque `id` con `fn`, esté donde esté. */
export function mapBlock(blocks: PageBlock[], id: string, fn: (b: PageBlock) => PageBlock): PageBlock[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (b.id === id) {
      changed = true;
      return fn(b);
    }
    const cols = columnsOf(b);
    if (!cols) return b;
    const inner = cols.map((c) => mapBlock(c.blocks, id, fn));
    if (inner.every((list, i) => list === cols[i].blocks)) return b;
    changed = true;
    return withColumns(b, inner.map((list) => ({ blocks: list })));
  });
  return changed ? next : blocks;
}

/** La lista de bloques de un sitio (la página o una columna), o null si ese sitio no existe. */
function listAt(blocks: PageBlock[], parent: string | null, col: number): PageBlock[] | null {
  if (parent === null) return blocks;
  const f = findBlock(blocks, parent);
  const cols = f ? columnsOf(f.block) : null;
  return cols && cols[col] ? cols[col].blocks : null;
}

/** Sustituye la lista de un sitio. */
function setListAt(blocks: PageBlock[], parent: string | null, col: number, list: PageBlock[]): PageBlock[] {
  if (parent === null) return list;
  return mapBlock(blocks, parent, (s) => {
    const cols = columnsOf(s);
    if (!cols) return s;
    return withColumns(s, cols.map((c, i) => (i === col ? { blocks: list } : c)));
  });
}

export function removeBlock(blocks: PageBlock[], id: string): PageBlock[] {
  const f = findBlock(blocks, id);
  if (!f) return blocks;
  const list = listAt(blocks, f.parent, f.col)!;
  return setListAt(blocks, f.parent, f.col, list.filter((b) => b.id !== id));
}

/** Por qué no se pueden poner estos bloques en ese sitio, o null si se puede. */
export function placeProblem(blocks: PageBlock[], place: Place, added: PageBlock[]): string | null {
  if (place.parent === null) return null;
  const host = findBlock(blocks, place.parent);
  if (!host || !columnsOf(host.block)?.[place.col]) return "Esa columna ya no existe.";
  for (const b of added) {
    if (b.type === "modal") return "Una ventana emergente va a nivel de página: no dentro de columnas ni de otra ventana.";
    if (NOT_NESTABLE.includes(b.type)) return "Este módulo ocupa todo el ancho: ponlo fuera de las columnas.";
    // La sección de destino está a profundidad host.depth + 1; lo que se mete, por debajo
    if (host.depth + 1 + sectionDepth(b) > SECTION_MAX_DEPTH) return "Solo se puede poner una sección con columnas dentro de otra (un nivel).";
  }
  return null;
}

/** Inserta bloques en un sitio (si el sitio no existe, al final de la página). */
export function insertBlocks(blocks: PageBlock[], place: Place, added: PageBlock[]): PageBlock[] {
  const list = listAt(blocks, place.parent, place.col);
  if (!list) return [...blocks, ...added];
  const at = Math.max(0, Math.min(place.index, list.length));
  return setListAt(blocks, place.parent, place.col, [...list.slice(0, at), ...added, ...list.slice(at)]);
}

/**
 * Mueve un bloque a otro sitio. No hace nada si el destino está dentro del propio bloque, o si la sección quedaría
 * más anidada de lo permitido. El índice se refiere a la lista de destino ANTES de quitar el bloque.
 */
export function moveBlock(blocks: PageBlock[], id: string, place: Place): PageBlock[] {
  const f = findBlock(blocks, id);
  if (!f) return blocks;
  if (place.parent !== null) {
    if (place.parent === id) return blocks;
    let inside = false;
    walk([f.block], (x) => {
      if (x.block.id === place.parent) inside = true;
    });
    if (inside) return blocks;
  }
  if (placeProblem(blocks, place, [f.block])) return blocks;
  const sameList = f.parent === place.parent && f.col === place.col;
  const index = sameList && f.index < place.index ? place.index - 1 : place.index;
  if (sameList && index === f.index) return blocks;
  return insertBlocks(removeBlock(blocks, id), { ...place, index }, [f.block]);
}

/** Sección nueva lista para editar: texto en la primera columna e imagen en la segunda. */
export function createSection(): BlockOf<"section"> {
  const s = createBlock("section");
  return {
    ...s,
    data: {
      ...s.data,
      columns: [
        { blocks: [createBlock("text", { title: "Título de la columna", html: "<p>Escribe aquí el texto. Arrastra más módulos a cualquier columna.</p>" })] },
        { blocks: [createBlock("image")] },
      ],
    },
  };
}

/**
 * Cambia el reparto de columnas sin perder contenido: si hay menos columnas, lo de las que sobran pasa a la última que
 * queda; si hay más, las nuevas empiezan vacías.
 */
export function relayoutColumns(columns: SectionColumn[], layout: string): SectionColumn[] {
  const n = sectionColumnCount(layout);
  if (columns.length === n) return columns;
  if (columns.length < n) return [...columns, ...Array.from({ length: n - columns.length }, () => ({ blocks: [] as PageBlock[] }))];
  const kept = columns.slice(0, n).map((c) => ({ blocks: [...c.blocks] }));
  kept[n - 1].blocks.push(...columns.slice(n).flatMap((c) => c.blocks));
  return kept;
}

/** Si un tipo de módulo puede ir dentro de una columna. */
export const nestable = (type: BlockType): boolean => !NOT_NESTABLE.includes(type);

/** Una sección con tantas columnas como pide su reparto (tras cambiar «Columnas» en el inspector). */
export function syncSectionColumns(b: PageBlock): PageBlock {
  if (b.type !== "section") return b;
  const columns = relayoutColumns(b.data.columns, b.data.layout);
  return columns === b.data.columns ? b : withColumns(b, columns);
}
