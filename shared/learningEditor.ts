/**
 * Elephant Learning · editor de formación (reglas puras, sin BD ni React).
 *
 * El editor trabaja sobre un «árbol editable» del curso: títulos, textos y orden. Cada elemento conserva su `id` de siempre, así que
 * ni el progreso (`learning_progress`), ni las matrículas por módulo, ni `last_block_id` dejan de valer al publicar. En el lote 1 el
 * borrador no puede añadir, quitar ni mover elementos entre padres: solo editar textos y reordenar dentro de cada padre.
 */

export interface EditorBlock { id: number; title: string; body: string | null; attribution: string | null }
export interface EditorLesson { id: number; title: string; blocks: EditorBlock[] }
export interface EditorModule { id: number; title: string; lessons: EditorLesson[] }
export interface EditorTree {
  course: { title: string; description: string | null };
  modules: EditorModule[];
}

export const LIMITS = { courseTitle: 300, courseDescription: 5_000, title: 300, body: 100_000, attribution: 300 } as const;

/** Representación canónica (orden de claves fijo): la misma estructura da siempre el mismo texto, y por tanto la misma huella. */
export function canonicalJson(t: EditorTree): string {
  return JSON.stringify({
    course: { title: t.course.title, description: t.course.description ?? null },
    modules: t.modules.map((m) => ({
      id: m.id, title: m.title,
      lessons: m.lessons.map((l) => ({
        id: l.id, title: l.title,
        blocks: l.blocks.map((b) => ({ id: b.id, title: b.title, body: b.body ?? null, attribution: b.attribution ?? null })),
      })),
    })),
  });
}

const blankToNull = (s: string | null | undefined): string | null => (s == null || s.trim() === "" ? null : s);

/** Quita espacios sobrantes de los títulos y convierte los textos vacíos en nulos. No cambia ni el orden ni los ids. */
export function normalizeTree(t: EditorTree): EditorTree {
  return {
    course: { title: t.course.title.trim(), description: blankToNull(t.course.description) },
    modules: t.modules.map((m) => ({
      id: m.id, title: m.title.trim(),
      lessons: m.lessons.map((l) => ({
        id: l.id, title: l.title.trim(),
        blocks: l.blocks.map((b) => ({ id: b.id, title: b.title.trim(), body: blankToNull(b.body), attribution: blankToNull(b.attribution)?.trim() ?? null })),
      })),
    })),
  };
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

/**
 * Comprueba un borrador contra lo publicado. Devuelve los errores en español (vacío = válido). Reglas:
 *  - mismos módulos, lecciones y bloques que lo publicado (el lote 1 no crea ni borra; tampoco mueve entre padres);
 *  - sin ids repetidos; títulos con texto y longitudes razonables.
 */
export function validateDraft(live: EditorTree, draft: EditorTree): string[] {
  const errors: string[] = [];
  const title = (what: string, s: string, max: number) => {
    if (!s.trim()) errors.push(`${what}: el título no puede estar vacío.`);
    else if (s.trim().length > max) errors.push(`${what}: el título supera ${max} caracteres.`);
  };
  title("Curso", draft.course.title, LIMITS.courseTitle);
  if ((draft.course.description ?? "").length > LIMITS.courseDescription) errors.push(`Curso: la descripción supera ${LIMITS.courseDescription} caracteres.`);

  if (!sameSet(draft.modules.map((m) => m.id), live.modules.map((m) => m.id))) errors.push("Los módulos del borrador no coinciden con los publicados (en este lote no se pueden añadir ni quitar).");
  for (const m of draft.modules) {
    const lm = live.modules.find((x) => x.id === m.id);
    if (!lm) continue;
    title(`Módulo ${m.id}`, m.title, LIMITS.title);
    if (!sameSet(m.lessons.map((l) => l.id), lm.lessons.map((l) => l.id))) errors.push(`Módulo «${lm.title}»: las lecciones no coinciden con las publicadas (no se pueden añadir, quitar ni mover a otro módulo).`);
    for (const l of m.lessons) {
      const ll = lm.lessons.find((x) => x.id === l.id);
      if (!ll) continue;
      title(`Lección ${l.id}`, l.title, LIMITS.title);
      if (!sameSet(l.blocks.map((b) => b.id), ll.blocks.map((b) => b.id))) errors.push(`Lección «${ll.title}»: los bloques no coinciden con los publicados (no se pueden añadir, quitar ni mover a otra lección).`);
      for (const b of l.blocks) {
        if (!ll.blocks.some((x) => x.id === b.id)) continue;
        title(`Bloque ${b.id}`, b.title, LIMITS.title);
        if ((b.body ?? "").length > LIMITS.body) errors.push(`Bloque «${b.title}»: el texto supera ${LIMITS.body} caracteres.`);
        if ((b.attribution ?? "").length > LIMITS.attribution) errors.push(`Bloque «${b.title}»: la atribución supera ${LIMITS.attribution} caracteres.`);
      }
    }
  }
  return errors;
}

export interface TreeChange { level: "course" | "module" | "lesson" | "block"; id: number | null; label: string; fields: string[]; moved: boolean }

/** Diferencias entre lo publicado (`live`) y el borrador, ya normalizado: qué cambia y qué solo se reordena. */
export function diffTrees(live: EditorTree, draft: EditorTree): TreeChange[] {
  const out: TreeChange[] = [];
  const cf: string[] = [];
  if (live.course.title !== draft.course.title) cf.push("título");
  if ((live.course.description ?? null) !== (draft.course.description ?? null)) cf.push("descripción");
  if (cf.length) out.push({ level: "course", id: null, label: draft.course.title, fields: cf, moved: false });

  const pos = (ids: number[], id: number) => ids.indexOf(id);
  const liveMods = live.modules.map((m) => m.id);
  draft.modules.forEach((m, mi) => {
    const lm = live.modules.find((x) => x.id === m.id);
    if (!lm) return;
    const f = lm.title !== m.title ? ["título"] : [];
    const moved = pos(liveMods, m.id) !== mi;
    if (f.length || moved) out.push({ level: "module", id: m.id, label: m.title, fields: f, moved });
    const liveLessons = lm.lessons.map((l) => l.id);
    m.lessons.forEach((l, li) => {
      const ll = lm.lessons.find((x) => x.id === l.id);
      if (!ll) return;
      const lf = ll.title !== l.title ? ["título"] : [];
      const lmoved = pos(liveLessons, l.id) !== li;
      if (lf.length || lmoved) out.push({ level: "lesson", id: l.id, label: l.title, fields: lf, moved: lmoved });
      const liveBlocks = ll.blocks.map((b) => b.id);
      l.blocks.forEach((b, bi) => {
        const lb = ll.blocks.find((x) => x.id === b.id);
        if (!lb) return;
        const bf: string[] = [];
        if (lb.title !== b.title) bf.push("título");
        if ((lb.body ?? null) !== (b.body ?? null)) bf.push("texto");
        if ((lb.attribution ?? null) !== (b.attribution ?? null)) bf.push("atribución");
        const bmoved = pos(liveBlocks, b.id) !== bi;
        if (bf.length || bmoved) out.push({ level: "block", id: b.id, label: b.title, fields: bf, moved: bmoved });
      });
    });
  });
  return out;
}

/** Resumen corto para el historial de versiones. */
export function summarizeChanges(changes: TreeChange[]): string {
  if (!changes.length) return "Sin cambios";
  const edited = changes.filter((c) => c.fields.length).length;
  const moved = changes.filter((c) => c.moved).length;
  const parts: string[] = [];
  if (edited) parts.push(`${edited} elemento${edited === 1 ? "" : "s"} editado${edited === 1 ? "" : "s"}`);
  if (moved) parts.push(`${moved} reordenado${moved === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Convierte el estado guardado en una versión en un borrador aplicable HOY: conserva textos y orden de la versión para lo que aún
 * existe y deja lo nuevo (creado después) con sus textos actuales al final de su padre. No pierde nada de lo publicado ahora.
 */
export function reconcileSnapshot(live: EditorTree, snapshot: EditorTree): EditorTree {
  const orderBy = <T extends { id: number }>(current: T[], old: T[]): T[] => {
    const known = old.filter((o) => current.some((c) => c.id === o.id));
    return [...known.map((o) => current.find((c) => c.id === o.id)!), ...current.filter((c) => !old.some((o) => o.id === c.id))];
  };
  return {
    course: { ...snapshot.course },
    modules: orderBy(live.modules, snapshot.modules).map((lm) => {
      const sm = snapshot.modules.find((x) => x.id === lm.id);
      if (!sm) return lm;
      return {
        id: lm.id, title: sm.title,
        lessons: orderBy(lm.lessons, sm.lessons).map((ll) => {
          const sl = sm.lessons.find((x) => x.id === ll.id);
          if (!sl) return ll;
          return {
            id: ll.id, title: sl.title,
            blocks: orderBy(ll.blocks, sl.blocks).map((lb) => {
              const sb = sl.blocks.find((x) => x.id === lb.id);
              return sb ? { id: lb.id, title: sb.title, body: sb.body, attribution: sb.attribution } : lb;
            }),
          };
        }),
      };
    }),
  };
}
