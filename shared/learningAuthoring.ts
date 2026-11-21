/**
 * Elephant Learning · creación de formaciones (lote 3): reglas puras compartidas entre servidor y pantalla.
 */

/** Tipos de bloque que se pueden crear desde la interfaz (el ejercicio interactivo llega con el importador). */
export const BLOCK_KINDS = ["text", "video", "audio", "pdf", "external_link"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
/** Los que llevan un fichero de la biblioteca de materiales. */
export const RESOURCE_KINDS = ["video", "audio", "pdf"] as const;

export const BLOCK_KIND_ES: Record<BlockKind, string> = { text: "Texto", video: "Vídeo", audio: "Audio", pdf: "Documento PDF", external_link: "Enlace" };

/** Identificador legible para la URL: sin acentos, minúsculas, guiones. Nunca vacío. */
export function slugify(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 78)
    .replace(/-+$/g, "");
  return s || "curso";
}
