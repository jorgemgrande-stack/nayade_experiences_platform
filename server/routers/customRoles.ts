/**
 * Roles personalizados (capacidad Business `roles-custom`). La licencia la aplica el guardián de rutas (`customRoles` →
 * roles-custom en TRPC_ROUTER_CAPABILITIES) y, además, cada procedimiento en el servidor: Essential no llega aquí y
 * sigue con los roles de siempre.
 *
 * Solo administración (permiso de configuración, que ningún rol propio puede dar) consulta, crea, renombra, elimina y
 * asigna roles propios.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { CUSTOM_ROLE_BASES, CUSTOM_ROLE_NAME_MAX, CUSTOM_ROLE_PERMISSIONS } from "../../shared/customRoles";
import { assertCustomRolesLicensed } from "../customRolesAccess";
import { assignCustomRole, createCustomRole, listCustomRoles, removeCustomRole, updateCustomRole } from "../customRolesDb";

const id = z.number().int().positive();
const permissionKeys = z.array(z.string().max(128)).max(CUSTOM_ROLE_PERMISSIONS.length);
const name = z.string().max(CUSTOM_ROLE_NAME_MAX * 2);

export const customRolesRouter = router({
  list: adminProcedure.query(async () => {
    await assertCustomRolesLicensed(false);
    return { roles: await listCustomRoles(), catalog: CUSTOM_ROLE_PERMISSIONS, bases: CUSTOM_ROLE_BASES };
  }),

  create: adminProcedure
    .input(z.object({ name, baseRole: z.string().max(32), permissions: permissionKeys }))
    .mutation(async ({ input, ctx }) => {
      await assertCustomRolesLicensed(true);
      return createCustomRole(input, ctx.user.id);
    }),

  update: adminProcedure
    .input(z.object({ id, name, permissions: permissionKeys }))
    .mutation(async ({ input }) => {
      await assertCustomRolesLicensed(true);
      await updateCustomRole(input);
      return { success: true };
    }),

  remove: adminProcedure.input(z.object({ id })).mutation(async ({ input }) => {
    await assertCustomRolesLicensed(true);
    return removeCustomRole(input.id);
  }),

  assign: adminProcedure
    .input(z.object({ userId: id, roleId: id.nullable() }))
    .mutation(async ({ input, ctx }) => {
      await assertCustomRolesLicensed(true);
      return assignCustomRole(input.userId, input.roleId, ctx.user.id);
    }),
});
