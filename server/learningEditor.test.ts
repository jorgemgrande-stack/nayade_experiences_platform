import { describe, expect, it } from "vitest";
import { canonicalJson, diffTrees, normalizeTree, reconcileSnapshot, summarizeChanges, validateDraft, type EditorTree } from "../shared/learningEditor";

const live = (): EditorTree => ({
  course: { title: "RECONNECT", description: "Curso" },
  modules: [
    { id: 1, title: "Teil 1", lessons: [
      { id: 11, title: "L1", blocks: [{ id: 111, title: "Intro", body: "Hola", attribution: null }, { id: 112, title: "Vídeo", body: null, attribution: "Autora" }] },
      { id: 12, title: "L2", blocks: [{ id: 121, title: "PDF", body: null, attribution: null }] },
    ] },
    { id: 2, title: "Teil 2", lessons: [{ id: 21, title: "L3", blocks: [] }] },
  ],
});
const clone = (t: EditorTree): EditorTree => JSON.parse(JSON.stringify(t));

describe("editor de formación: reglas puras", () => {
  it("un borrador idéntico es válido y no tiene diferencias", () => {
    expect(validateDraft(live(), clone(live()))).toEqual([]);
    expect(diffTrees(live(), normalizeTree(clone(live())))).toEqual([]);
    expect(summarizeChanges([])).toBe("Sin cambios");
  });

  it("la huella canónica no depende del orden de las claves y cambia con cualquier edición", () => {
    const a = live();
    const reordered = JSON.parse(JSON.stringify(a, ["course", "description", "title", "modules", "lessons", "blocks", "attribution", "body", "id"])) as EditorTree;
    expect(canonicalJson(reordered)).toBe(canonicalJson(a));
    const b = clone(a);
    b.modules[0].lessons[0].blocks[0].body = "Hola!";
    expect(canonicalJson(b)).not.toBe(canonicalJson(a));
  });

  it("detecta ediciones de texto y reordenaciones, y las cuenta por separado", () => {
    const d = clone(live());
    d.course.title = "RECONNECT ONLINE";
    d.modules[0].lessons[0].blocks[0].body = "Hallo";
    d.modules[0].lessons.reverse();
    d.modules.reverse();
    const ch = diffTrees(live(), normalizeTree(d));
    expect(ch.find((c) => c.level === "course")?.fields).toEqual(["título"]);
    expect(ch.find((c) => c.level === "block" && c.id === 111)?.fields).toEqual(["texto"]);
    expect(ch.filter((c) => c.level === "module" && c.moved).length).toBe(2);
    expect(ch.filter((c) => c.level === "lesson" && c.moved).length).toBe(2);
    expect(summarizeChanges(ch)).toMatch(/editado.*reordenado/);
  });

  it("rechaza títulos vacíos o demasiado largos y textos desmesurados", () => {
    const d = clone(live());
    d.modules[0].title = "   ";
    d.modules[0].lessons[0].title = "x".repeat(301);
    d.modules[0].lessons[0].blocks[0].body = "y".repeat(100_001);
    const errs = validateDraft(live(), d);
    expect(errs.some((e) => /título no puede estar vacío/.test(e))).toBe(true);
    expect(errs.some((e) => /supera 300/.test(e))).toBe(true);
    expect(errs.some((e) => /texto supera/.test(e))).toBe(true);
  });

  it("no admite añadir, quitar, duplicar ni mover elementos a otro padre", () => {
    const added = clone(live());
    added.modules[0].lessons.push({ id: 99, title: "Nueva", blocks: [] });
    expect(validateDraft(live(), added).join(" ")).toMatch(/no coinciden/);

    const removed = clone(live());
    removed.modules[0].lessons[0].blocks.pop();
    expect(validateDraft(live(), removed).join(" ")).toMatch(/bloques no coinciden/);

    const moved = clone(live());
    const [l] = moved.modules[0].lessons.splice(1, 1);
    moved.modules[1].lessons.push(l);
    expect(validateDraft(live(), moved).length).toBeGreaterThan(0);

    const dup = clone(live());
    dup.modules.push(clone(dup.modules[0]));
    expect(validateDraft(live(), dup).length).toBeGreaterThan(0);
  });

  it("normaliza espacios y deja los textos vacíos como nulos, sin tocar ids ni orden", () => {
    const d = clone(live());
    d.modules[0].title = "  Teil 1  ";
    d.modules[0].lessons[0].blocks[0].body = "   ";
    const n = normalizeTree(d);
    expect(n.modules[0].title).toBe("Teil 1");
    expect(n.modules[0].lessons[0].blocks[0].body).toBeNull();
    expect(n.modules.map((m) => m.id)).toEqual([1, 2]);
  });

  it("restaurar una versión conserva sus textos y orden y no pierde lo creado después", () => {
    const snapshot = clone(live());
    const now = clone(live());
    now.modules[0].lessons.push({ id: 13, title: "Creada después", blocks: [] }); // algo nuevo tras la versión
    now.modules[0].title = "Título actual";
    const snap = clone(snapshot);
    snap.modules[0].title = "Título antiguo";
    snap.modules[0].lessons.reverse();
    const r = reconcileSnapshot(now, snap);
    expect(r.modules[0].title).toBe("Título antiguo");
    expect(r.modules[0].lessons.map((l) => l.id)).toEqual([12, 11, 13]); // orden antiguo y lo nuevo, al final
    expect(validateDraft(now, r)).toEqual([]);
  });
});
