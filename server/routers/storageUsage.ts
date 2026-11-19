/**
 * Consumo de almacenamiento de la empresa en curso, separado por ámbito (Elephant Resource Manager, vista de empresa):
 *  - general: imágenes, documentos y adjuntos (cuota `storage_gb`);
 *  - learning: contenido de Elephant Learning (cuota `learning_storage_gb`, por defecto 0).
 * Todo se calcula de los objetos guardados (stored_objects): no hay contadores que pierdan consistencia al borrar,
 * duplicar o migrar. Solo administradores de la empresa; nunca datos de otras.
 */
import { adminProcedure, router } from "../_core/trpc";
import { categoryInScope } from "../storedObjectsDb";
import { fileService, generalStorageLimitGb } from "../_core/files/service";
import { GB, MB, DEFAULT_IMAGE_MAX_MB, imageMaxBytes, learningStorageLimit } from "../_core/files/limits";

export type UsageLevel = "ok" | "warning" | "critical" | "exceeded";

export function usageLevel(usedBytes: number, limitGb: number | null | undefined): UsageLevel {
  if (typeof limitGb !== "number") return "ok";
  const limit = limitGb * GB;
  if (usedBytes > limit) return "exceeded";
  if (limit > 0 && usedBytes >= limit * 0.95) return "critical";
  if (limit > 0 && usedBytes >= limit * 0.8) return "warning";
  return "ok";
}

const scopeView = (usedBytes: number, objects: number, limitGb: number | null | undefined, source: string) => ({
  usedBytes,
  objects,
  limitGb: limitGb ?? null,
  source,
  availableBytes: typeof limitGb === "number" ? Math.max(0, limitGb * GB - usedBytes) : null,
  level: usageLevel(usedBytes, limitGb),
});

export const storageUsageRouter = router({
  /** Máximo efectivo por imagen de esta empresa: lo que el servidor aceptará de verdad (el panel lo muestra en vez de un número fijo). */
  uploadLimits: adminProcedure.query(async () => ({
    imageMaxBytes: await imageMaxBytes(),
    imageDefaultMaxBytes: DEFAULT_IMAGE_MAX_MB * MB,
  })),

  overview: adminProcedure.query(async () => {
    const meta = fileService().meta;
    if (!meta.usageBreakdown || !meta.usedBytes) return null;
    const [general, learning, breakdown, gl, ll] = await Promise.all([
      meta.usedBytes("general"),
      meta.usedBytes("learning"),
      meta.usageBreakdown(),
      generalStorageLimitGb(),
      learningStorageLimit(),
    ]);
    const objectsIn = (scope: "general" | "learning") => breakdown.categories.filter((c) => categoryInScope(c.category, scope)).reduce((a, c) => a + c.objects, 0);
    return {
      general: scopeView(general, objectsIn("general"), gl.limitGb, gl.source),
      learning: scopeView(learning, objectsIn("learning"), ll?.limitGb, ll?.source ?? "none"),
      categories: breakdown.categories.map((c) => ({ ...c, scope: categoryInScope(c.category, "all") ? (categoryInScope(c.category, "learning") ? "learning" : "general") : "excluded" })),
      duplicates: breakdown.duplicates,
      imageMaxBytes: await imageMaxBytes(),
      // El tráfico de reproducción no se mide todavía: el almacén lo sirve (o redirige) sin contador propio
      traffic: { measurable: false },
    };
  }),
});
