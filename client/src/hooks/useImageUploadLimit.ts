import { trpc } from "@/lib/trpc";

const DEFAULT_BYTES = 10 * 1024 * 1024;

/**
 * Máximo por imagen que aceptará el servidor para esta empresa (10 MB general; más si tiene una condición negociada).
 * Mientras llega la respuesta (o si falla) se usa el valor general: el servidor es quien decide en cualquier caso.
 */
export function useImageUploadLimit(): { bytes: number; mb: number } {
  const q = trpc.storage.uploadLimits.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const bytes = q.data?.imageMaxBytes ?? DEFAULT_BYTES;
  return { bytes, mb: Math.floor(bytes / (1024 * 1024)) };
}
