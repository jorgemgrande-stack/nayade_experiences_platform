/**
 * Elephant Studio: espacio vertical propio de la sección con columnas (`vspace`). Desactivado por defecto: una página
 * guardada sin la opción se sanea a «normal» (se ve igual que siempre); la opción solo admite sus tres valores y se
 * ofrece en la pestaña Diseño. El envoltorio de la sección toma su relleno de esa opción.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createBlock, type PageBlock } from "../shared/pageBlocks";
import { moduleDef, fieldTab } from "../shared/studio/modules";
import { normalizeBlocks } from "./_core/pageBlocks";

const sectionWith = (extra: Record<string, unknown>): PageBlock => {
  const s = createBlock("section");
  return { ...s, id: "s1", data: { ...s.data, columns: [{ blocks: [] }, { blocks: [] }], ...extra } } as PageBlock;
};
const vspaceOf = (blocks: PageBlock[]) => (normalizeBlocks(blocks)[0].data as { vspace: string }).vspace;

describe("espacio vertical de la sección", () => {
  it("nace en «normal»: una sección nueva no cambia de aspecto", () => {
    expect((createBlock("section").data as { vspace: string }).vspace).toBe("normal");
  });

  it("una página guardada antes de la opción se sanea a «normal»", () => {
    const old = sectionWith({});
    delete (old.data as Record<string, unknown>).vspace;
    expect(vspaceOf([old])).toBe("normal");
  });

  it("admite «reducido» y «sin espacio» y descarta cualquier otro valor", () => {
    expect(vspaceOf([sectionWith({ vspace: "compact" })])).toBe("compact");
    expect(vspaceOf([sectionWith({ vspace: "none" })])).toBe("none");
    expect(vspaceOf([sectionWith({ vspace: "enorme" })])).toBe("normal");
    expect(vspaceOf([sectionWith({ vspace: 5 })])).toBe("normal");
  });

  it("se ofrece en la pestaña Diseño, también fuera del modo profesional", () => {
    const f = moduleDef("section")!.fields.find((x) => x.key === "vspace")!;
    expect(f.kind).toBe("select");
    expect(fieldTab(f, false)).toBe("design");
    expect(fieldTab(f, true)).toBe("design");
  });

  it("el envoltorio de la sección lee la opción y conserva el relleno de siempre por defecto", () => {
    const src = readFileSync("client/src/components/site/PageBlocksView.tsx", "utf8");
    expect(src).toMatch(/SECTION_VSPACE[^=]*=\s*\{\s*normal: "py-8 md:py-10", compact: "py-3 md:py-4", none: "py-0"/);
    expect(src).toContain("SECTION_VSPACE[b.data.vspace] ?? SECTION_VSPACE.normal");
  });
});
