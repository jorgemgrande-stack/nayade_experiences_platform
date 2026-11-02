/**
 * Elephant Studio: historial de deshacer y rehacer del documento (los bloques de la página). Puro, sin React.
 * Los cambios seguidos sobre el mismo texto (escribir en el inspector) se agrupan en un solo paso.
 */
import type { PageBlock } from "@shared/pageBlocks";

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1200;

export interface DocState {
  blocks: PageBlock[];
  past: PageBlock[][];
  future: PageBlock[][];
  /** Número de cambios: el autoguardado compara con el último guardado */
  revision: number;
  coalesceKey: string | null;
  coalesceAt: number;
}

export type DocAction =
  | { type: "load"; blocks: PageBlock[] }
  | { type: "change"; blocks: PageBlock[]; coalesceKey?: string; now?: number }
  /** Cambio calculado sobre el documento VIGENTE (no sobre una copia antigua de quien lo pide: subidas, diálogos) */
  | { type: "apply"; fn: (blocks: PageBlock[]) => PageBlock[]; coalesceKey?: string; now?: number }
  | { type: "undo" }
  | { type: "redo" };

export const initialDoc: DocState = { blocks: [], past: [], future: [], revision: 0, coalesceKey: null, coalesceAt: 0 };

export function docReducer(s: DocState, a: DocAction): DocState {
  switch (a.type) {
    case "load":
      return { ...initialDoc, blocks: a.blocks };
    case "apply": {
      const blocks = a.fn(s.blocks);
      return blocks === s.blocks ? s : docReducer(s, { type: "change", blocks, coalesceKey: a.coalesceKey, now: a.now });
    }
    case "change": {
      const now = a.now ?? Date.now();
      const merge = !!a.coalesceKey && a.coalesceKey === s.coalesceKey && now - s.coalesceAt < COALESCE_MS;
      return {
        blocks: a.blocks,
        past: merge ? s.past : [...s.past, s.blocks].slice(-HISTORY_LIMIT),
        future: [],
        revision: s.revision + 1,
        coalesceKey: a.coalesceKey ?? null,
        coalesceAt: now,
      };
    }
    case "undo": {
      if (!s.past.length) return s;
      return { ...s, blocks: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.blocks, ...s.future], revision: s.revision + 1, coalesceKey: null };
    }
    case "redo": {
      if (!s.future.length) return s;
      return { ...s, blocks: s.future[0], past: [...s.past, s.blocks], future: s.future.slice(1), revision: s.revision + 1, coalesceKey: null };
    }
  }
}
