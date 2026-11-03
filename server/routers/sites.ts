/**
 * sites.* — sedes de la empresa (capacidad Business `multi-site`) desde su panel.
 *
 * Las sedes viven en el registro del plano de control (server/sitesDb.ts): aquí no se guarda ninguna lista. La licencia
 * de administración (`sites` → admin-panel en TRPC_ROUTER_CAPABILITIES) deja ver la sede principal a todos los planes;
 * añadir, desactivar o reactivar sedes y asignar usuarios exigen además `multi-site`, comprobado en cada procedimiento.
 * El límite numérico de sedes lo aplica el plano de control (plan, sedes adicionales y excepciones de cuota).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { legacyDb } from "../_core/legacyDb";
import { users } from "../../drizzle/schema";
import { SITE_ID_PATTERN } from "../../shared/sites";
import { assertMultiSite, changeSites, companySites, listUserSiteAssignments, multiSiteLicensed, setUserSiteIds, sitesManaged } from "../sitesDb";

const siteId = z.string().regex(SITE_ID_PATTERN);
const optText = (max: number) => z.string().max(max).nullable().optional();
const form = { address: optText(300), phone: optText(40), email: optText(200) };

const requester = (u: { email?: string | null; id: number }) => (u.email || `usuario-${u.id}`).slice(0, 200);

export const sitesRouter = router({
  /** Sedes de la empresa (la principal siempre). Todo el equipo del panel las ve para elegir caja o filtrar. */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "user") throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso al panel" });
    const [sites, multiSite, canWrite] = await Promise.all([companySites(), multiSiteLicensed(false), multiSiteLicensed(true)]);
    return { ...sites, multiSite, canManage: sitesManaged() && multiSite && canWrite, managed: sitesManaged() };
  }),

  create: adminProcedure.input(z.object({ name: z.string().max(160), ...form }).strict()).mutation(async ({ input, ctx }) => {
    await assertMultiSite(true);
    return changeSites((src, t) => src.create(t, { ...input, requestedBy: requester(ctx.user) }));
  }),

  /** Nombre y datos de contacto. Sin `multi-site`, solo la sede principal (la única de Essential). */
  update: adminProcedure.input(z.object({ siteId, name: z.string().max(160).optional(), ...form }).strict()).mutation(async ({ input, ctx }) => {
    const { siteId: id, ...patch } = input;
    if (!(await multiSiteLicensed(true)) && id !== (await companySites()).primarySiteId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "La gestión de varias sedes no está incluida en tu plan." });
    }
    return changeSites((src, t) => src.update(t, id, { ...patch, requestedBy: requester(ctx.user) }));
  }),

  archive: adminProcedure.input(z.object({ siteId }).strict()).mutation(async ({ input, ctx }) => {
    await assertMultiSite(true);
    return changeSites((src, t) => src.archive(t, input.siteId, { requestedBy: requester(ctx.user) }));
  }),

  restore: adminProcedure.input(z.object({ siteId }).strict()).mutation(async ({ input, ctx }) => {
    await assertMultiSite(true);
    return changeSites((src, t) => src.restore(t, input.siteId, { requestedBy: requester(ctx.user) }));
  }),

  /** Sedes en las que trabaja cada usuario (sin entrada: en todas). */
  userAssignments: adminProcedure.query(async () => {
    await assertMultiSite(false);
    return listUserSiteAssignments();
  }),

  /** Sedes de un usuario (lista vacía = todas). Solo sedes activas de la empresa. */
  setUserSites: adminProcedure.input(z.object({ userId: z.number().int().positive(), siteIds: z.array(siteId).max(50) }).strict()).mutation(async ({ input }) => {
    await assertMultiSite(true);
    const [user] = await legacyDb().select({ id: users.id }).from(users).where(eq(users.id, input.userId));
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado" });
    const active = new Set((await companySites()).sites.filter((s) => s.status === "active").map((s) => s.siteId));
    if (input.siteIds.some((s) => !active.has(s))) throw new TRPCError({ code: "BAD_REQUEST", message: "Alguna sede no existe o está desactivada" });
    await setUserSiteIds(input.userId, input.siteIds);
    return { userId: input.userId, siteIds: Array.from(new Set(input.siteIds)) };
  }),
});
