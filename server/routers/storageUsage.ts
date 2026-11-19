/**
 * Consumo de almacenamiento de la empresa en curso, separado por ámbito (Elephant Resource Manager, vista de empresa):
 *  - general: imágenes, documentos y adjuntos (cuota `storage_gb`);
 *  - learning: contenido de Elephant Learning (cuota `learning_storage_gb`, por defecto 0).
 * Todo se calcula de los objetos guardados (stored_objects): no hay contadores que pierdan consistencia al borrar,
 * duplicar o migrar. Solo administradores de la empresa; nunca datos de otras.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { DEFAULT_GRACE_MS, MAX_APPLY, RECONCILABLE_CATEGORIES, ReconcileError, storageReconciler } from "../_core/files/reconcile";
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

  /**
   * Reconciliación (solo lectura): inventario de objetos, referencias activas, huérfanos, protegidos y objetos
   * referenciados que faltan en el almacén. Devuelve `planHash`, que `reconcileApply` exige para borrar.
   */
  reconcile: adminProcedure
    .input(z.object({ graceHours: z.number().min(1 / 6).max(24 * 365).optional(), limit: z.number().int().min(1).max(MAX_APPLY).optional(), categories: z.array(z.enum(["learning-content", "media"])).optional(), checkProvider: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      try {
        return await storageReconciler().plan({ graceMs: input?.graceHours ? input.graceHours * 3600_000 : DEFAULT_GRACE_MS, limit: input?.limit, categories: input?.categories, checkProvider: input?.checkProvider });
      } catch (e) {
        if (e instanceof ReconcileError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
        throw e;
      }
    }),

  /** Borra EXCLUSIVAMENTE los huérfanos indicados, si su huella coincide con la del informe previo. */
  reconcileApply: adminProcedure
    .input(z.object({ objectIds: z.array(z.string().length(26)).min(1).max(MAX_APPLY), planHash: z.string().length(64), graceHours: z.number().min(1 / 6).max(24 * 365).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageReconciler().apply({ objectIds: input.objectIds, planHash: input.planHash, graceMs: input.graceHours ? input.graceHours * 3600_000 : DEFAULT_GRACE_MS, actor: `admin:${ctx.user?.id ?? "?"}` });
      } catch (e) {
        if (e instanceof ReconcileError) throw new TRPCError({ code: e.code === "PLAN_STALE" ? "CONFLICT" : e.code === "BAD_REQUEST" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR", message: e.message });
        throw e;
      }
    }),

  /** Reintenta retirar del almacén los bytes de objetos ya borrados cuyo proveedor falló. */
  reconcileRetryRemovals: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional()).mutation(({ input }) => storageReconciler().retryRemovals(input?.limit ?? 100)),

  /** Categorías que la reconciliación puede proponer para borrado (el resto solo se contabiliza). */
  reconcilableCategories: adminProcedure.query(() => [...RECONCILABLE_CATEGORIES]),
});
