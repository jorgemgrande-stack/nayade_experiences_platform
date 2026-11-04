/**
 * Elephant Studio: mensajes entre el editor y su lienzo.
 *
 * El lienzo es la propia web de la empresa (cabecera, pie, colores y tipografía) dentro de un marco del mismo
 * origen, para que el ancho de tableta o móvil active su diseño adaptable real. El editor le envía el documento y el
 * lienzo le devuelve lo que la persona hace sobre la página. Solo se aceptan mensajes del mismo origen y de la
 * ventana esperada (el marco o su editor).
 */
import type { Device, PageBlock } from "@shared/pageBlocks";
import type { SiteTokens } from "./tokens";

export const STUDIO_CANVAS_PATH = "/admin/studio-lienzo";
/** Tipo de los datos que arrastra la biblioteca (módulo o sección prediseñada). */
export const DRAG_MIME = "application/x-elephant-studio";

/** edit/design: abrir el inspector en Contenido o Diseño; save: guardar en Mis diseños */
export type BlockAction = "duplicate" | "delete" | "up" | "down" | "edit" | "design" | "save";

/** Del editor al lienzo */
export type ToCanvas = {
  kind: "state";
  blocks: PageBlock[];
  selectedId: string | null;
  device: Device;
  tokens: SiteTokens;
  pageTitle: string;
  readOnly: boolean;
};

/** Del lienzo al editor */
export type FromCanvas =
  | { kind: "ready" }
  | { kind: "select"; id: string | null }
  | { kind: "text"; id: string; key: string; value: string }
  /** Elegir una imagen de la biblioteca multimedia para el campo `key` del bloque (pulsando la imagen o su hueco) */
  | { kind: "pickImage"; id: string; key: string }
  | { kind: "action"; id: string; action: BlockAction }
  /** `parent` null: la página; si no, la columna `col` de esa sección */
  | { kind: "drop"; payload: string; index: number; parent: string | null; col: number }
  | { kind: "move"; id: string; index: number; parent: string | null; col: number }
  | { kind: "navigate"; href: string }
  /** Abrir el selector rápido para añadir un módulo en ese sitio (el «+» entre bloques o una zona vacía) */
  | { kind: "addAt"; index: number; parent: string | null; col: number }
  | { kind: "key"; key: string; ctrl: boolean; shift: boolean };

export function isFromCanvas(v: unknown): v is FromCanvas {
  return !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string" && (v as { studio?: unknown }).studio === 1;
}

export function isToCanvas(v: unknown): v is ToCanvas {
  return !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "state" && (v as { studio?: unknown }).studio === 1;
}

/** Datos del arrastre: `module:<tipo>`, `preset:<clave>` o `block:<id>` (reordenar). */
/** `saved:<id>` es un bloque de «Mis bloques» (se inserta una copia). */
export function parseDragPayload(p: string): { what: "module" | "preset" | "block" | "saved"; value: string } | null {
  const m = /^(module|preset|block|saved):([a-z0-9_-]{1,64})$/i.exec(p);
  return m ? { what: m[1] as "module" | "preset" | "block" | "saved", value: m[2] } : null;
}
