import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { checkRbacOrLegacy, getUserPermissions } from "./rbac";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * staffProcedure: acepta 'admin' o 'agente'.
 * Usado para TPV, CRM, bookings — operaciones de equipo comercial.
 */
export const staffProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || !['admin', 'agente'].includes(ctx.user.role as string)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido al equipo" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);

/**
 * permissionProcedure(permissionKey, fallbackRoles)
 *
 * Middleware RBAC progresivo. Primero intenta resolver el acceso mediante RBAC;
 * si falla (tabla inexistente, sin asignaciones, cualquier error), cae al
 * comportamiento legacy basado en users.role.
 *
 * Nunca deja inaccesible un endpoint por error en RBAC.
 *
 * @param permissionKey  Clave de permiso RBAC (ej. "settings.view")
 * @param fallbackRoles  Roles legacy que tienen acceso si RBAC falla
 */
export function permissionProcedure(permissionKey: string, fallbackRoles: string[]) {
  return t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const allowed = await checkRbacOrLegacy(
      ctx.user.id,
      ctx.user.role as string,
      permissionKey,
      fallbackRoles,
    );
    if (!allowed) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acceso denegado" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * anyPermissionProcedure(permissionKeys, fallbackRoles)
 *
 * Como permissionProcedure pero concede acceso si el usuario tiene CUALQUIERA
 * de los permisos indicados. Útil para endpoints mixtos (view O manage).
 */
export function anyPermissionProcedure(permissionKeys: string[], fallbackRoles: string[]) {
  return t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    let allowed: boolean;
    try {
      const perms = await getUserPermissions(ctx.user.id, ctx.user.role as string);
      allowed = permissionKeys.some(k => perms.includes(k));
    } catch {
      allowed = fallbackRoles.includes(ctx.user.role as string);
    }
    if (!allowed) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acceso denegado" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * adminrestProcedure: acepta usuarios con rol 'admin' o 'adminrest'.
 * Usado para todos los procedimientos del módulo de restaurantes.
 * El rol adminrest tiene acceso completo al gestor de reservas pero
 * solo a los restaurantes que tiene asignados.
 */
export const adminrestProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !['admin', 'adminrest'].includes(ctx.user.role as string)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Acceso restringido al módulo de restaurantes",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
