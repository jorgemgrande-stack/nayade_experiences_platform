/**
 * Embudo de ventas configurable (capacidad Business `crm-funnel-advanced`). La licencia la aplica el guardián de rutas
 * (`crmFunnel` → crm-funnel-advanced en TRPC_ROUTER_CAPABILITIES): Essential no llega aquí y sigue con los cuatro
 * estados de siempre en `crm.leads` y `crm.pipeline`.
 *
 * Roles: el equipo comercial (permiso del CRM) consulta el tablero y mueve oportunidades; configurar las etapas es de
 * administración. `readonly` solo consulta (sus mutaciones las rechaza readOnlyGuard).
 */
import { z } from "zod";
import { adminProcedure, router, staffProcedure } from "../_core/trpc";
import { LOST_REASON_MAX, STAGE_COLORS, STAGE_KINDS, STAGE_NAME_MAX } from "../../shared/crmFunnel";
import { createStage, funnelBoard, listStages, moveLeadToStage, removeStage, reorderStages, updateStage } from "../crmFunnelDb";

const id = z.number().int().positive();
const stageForm = z.object({
  name: z.string().max(STAGE_NAME_MAX * 2),
  probability: z.number().int().min(0).max(100),
  kind: z.enum(STAGE_KINDS),
  color: z.enum(STAGE_COLORS),
});

export const crmFunnelRouter = router({
  board: staffProcedure
    .input(z.object({ search: z.string().max(120).optional() }).optional())
    .query(({ input }) => funnelBoard(input ?? {})),

  stages: staffProcedure.query(() => listStages()),

  moveLead: staffProcedure
    .input(z.object({ leadId: id, stageId: id, lostReason: z.string().max(LOST_REASON_MAX).optional() }))
    .mutation(({ input, ctx }) => moveLeadToStage(input.leadId, input.stageId, input.lostReason, { id: ctx.user.id, name: ctx.user.name ?? null })),

  createStage: adminProcedure.input(stageForm).mutation(({ input }) => createStage(input)),

  updateStage: adminProcedure
    .input(stageForm.extend({ id }))
    .mutation(async ({ input }) => {
      const { id: stageId, ...form } = input;
      await updateStage(stageId, form);
      return { success: true };
    }),

  reorderStages: adminProcedure
    .input(z.object({ ids: z.array(id).min(1).max(50) }))
    .mutation(async ({ input }) => {
      await reorderStages(input.ids);
      return { success: true };
    }),

  removeStage: adminProcedure.input(z.object({ id })).mutation(({ input }) => removeStage(input.id)),
});
