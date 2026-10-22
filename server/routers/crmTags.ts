/**
 * Etiquetas del CRM (capacidad `crm-tags`). Equipo comercial: admin y agente consultan y modifican;
 * `readonly` solo consulta (sus mutaciones las rechaza readOnlyGuard). La licencia la aplica el
 * guardián de rutas (`crmTags` → crm-tags en TRPC_ROUTER_CAPABILITIES).
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { TAG_COLORS, TAG_ENTITY_TYPES, TAG_NAME_MAX, normalizeTagName } from "../../shared/crmTagsTasks";
import { assignTag, createTag, deleteTag, listTags, tagsForEntities, unassignTag, updateTag } from "../crmTagsDb";

const tagName = z
  .string()
  .transform(normalizeTagName)
  .pipe(z.string().min(1, "Indica el nombre de la etiqueta").max(TAG_NAME_MAX, `El nombre admite como máximo ${TAG_NAME_MAX} caracteres`));
const tagColor = z.enum(TAG_COLORS, { message: "Elige un color de la lista" }).nullable();
const id = z.number().int().positive();
const entityType = z.enum(TAG_ENTITY_TYPES);

export const crmTagsRouter = router({
  list: staffProcedure.query(() => listTags()),

  create: staffProcedure
    .input(z.object({ name: tagName, color: tagColor.optional() }))
    .mutation(({ input, ctx }) => createTag(input, ctx.user.id)),

  update: staffProcedure
    .input(z.object({ id, name: tagName.optional(), color: tagColor.optional() }))
    .mutation(async ({ input }) => {
      await updateTag(input.id, { name: input.name, color: input.color });
      return { success: true };
    }),

  delete: staffProcedure.input(z.object({ id })).mutation(async ({ input }) => {
    await deleteTag(input.id);
    return { success: true };
  }),

  /** Etiquetas de los clientes u oportunidades indicados (p. ej. la página visible de un listado). */
  forEntities: staffProcedure
    .input(z.object({ entityType, ids: z.array(id).max(200) }))
    .query(({ input }) => tagsForEntities(input.entityType, input.ids)),

  assign: staffProcedure
    .input(z.object({ tagId: id, entityType, entityId: id }))
    .mutation(async ({ input, ctx }) => {
      await assignTag(input.tagId, input.entityType, input.entityId, ctx.user.id);
      return { success: true };
    }),

  unassign: staffProcedure
    .input(z.object({ tagId: id, entityType, entityId: id }))
    .mutation(async ({ input }) => {
      await unassignTag(input.tagId, input.entityType, input.entityId);
      return { success: true };
    }),
});
