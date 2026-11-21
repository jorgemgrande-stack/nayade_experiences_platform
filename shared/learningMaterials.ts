/**
 * Elephant Learning · materiales (lote 2): reglas puras de validación de subida y presentación del espacio.
 * Las usa el servidor (para decidir) y la pantalla (para avisar antes de subir). El servidor es quien manda.
 */
import { mimeMatchesKind } from "./learning";

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

export type UploadProblem = "NO_QUOTA" | "QUOTA_EXCEEDED" | "TOO_LARGE" | "WRONG_TYPE" | "EMPTY";
export interface UploadCheck { ok: boolean; problem?: UploadProblem; message?: string }

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 1 : 2).replace(".", ",")} GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1).replace(".", ",")} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * ¿Se puede subir este fichero a un recurso de este tipo? `replacingBytes` es lo que ocupa el fichero vigente: al sustituir
 * NO se libera hasta una limpieza protegida (se conserva la versión anterior), así que el espacio nuevo se suma entero.
 */
export function checkUpload(i: { kind: string; mimeType: string; sizeBytes: number; maxBytes: number; usedBytes: number; limitGb: number | null }): UploadCheck {
  if (!(i.sizeBytes > 0)) return { ok: false, problem: "EMPTY", message: "El fichero está vacío." };
  if (!mimeMatchesKind(i.kind, i.mimeType)) return { ok: false, problem: "WRONG_TYPE", message: `El fichero (${i.mimeType || "tipo desconocido"}) no corresponde a un recurso de tipo ${KIND_ES[i.kind] ?? i.kind}.` };
  if (i.sizeBytes > i.maxBytes) return { ok: false, problem: "TOO_LARGE", message: `El fichero (${formatBytes(i.sizeBytes)}) supera el máximo permitido (${formatBytes(i.maxBytes)}).` };
  if (i.limitGb == null || i.limitGb <= 0) return { ok: false, problem: "NO_QUOTA", message: "Esta empresa no tiene espacio de formación concedido." };
  const free = Math.max(0, i.limitGb * GB - i.usedBytes);
  if (i.sizeBytes > free) return { ok: false, problem: "QUOTA_EXCEEDED", message: `No hay espacio: el fichero ocupa ${formatBytes(i.sizeBytes)} y quedan ${formatBytes(free)} disponibles.` };
  return { ok: true };
}

export const KIND_ES: Record<string, string> = { video: "vídeo", audio: "audio", pdf: "PDF", document: "documento", image: "imagen" };

/** Estado de un fichero del historial, en lenguaje de administración. */
export const FILE_STATUS_ES: Record<string, string> = { staged: "Pendiente de publicar", active: "Vigente", replaced: "Sustituido (conservado)" };

export type SpaceLevel = "ok" | "warning" | "critical" | "exceeded" | "none";
export function spaceLevel(usedBytes: number, limitGb: number | null | undefined): SpaceLevel {
  if (limitGb == null || limitGb <= 0) return "none";
  const limit = limitGb * GB;
  if (usedBytes > limit) return "exceeded";
  if (usedBytes >= limit * 0.95) return "critical";
  if (usedBytes >= limit * 0.8) return "warning";
  return "ok";
}

export interface MaterialFile { id: number; status: "staged" | "active" | "replaced"; objectId: string; sha256: string; sizeBytes: number; mimeType: string; originalName: string | null; createdAt: number; activatedAt: number | null; replacedAt: number | null }
export interface MaterialView {
  resourceId: number;
  kind: string;
  status: string;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  objectId: string | null;
  uses: Array<{ courseId: number; courseTitle: string; moduleTitle: string; lessonTitle: string; blockTitle: string }>;
  staged: MaterialFile | null;
  history: MaterialFile[];
  sharedWith: number[];
}
