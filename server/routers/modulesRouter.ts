/**
 * modules.* — módulos disponibles para el tenant y navegación dinámica.
 *
 * Disponible = licencia vigente + dependencias + flag operativo (ver ModuleAccess). La
 * navegación sale de los manifiestos de los módulos disponibles, filtrada por los permisos
 * del usuario. Es solo presentación: la autorización real se aplica en servidor en cada
 * operación (moduleRouteGuard / requireModule).
 */
import { protectedProcedure, router } from "../_core/trpc";
import { checkRbacOrLegacy } from "../_core/rbac";
import { getModuleAccess, getModuleRegistry } from "../_core/modules/runtime";
import { registerBuiltinModules } from "../_core/modules/builtin";

export const modulesRouter = router({
  active: protectedProcedure.query(async ({ ctx }) => {
    registerBuiltinModules();
    const access = getModuleAccess();
    const registry = getModuleRegistry();
    const ids = await access.activeModules();

    const perms = new Set<string>();
    const wanted = new Set<string>();
    for (const id of ids) for (const n of registry.get(id)?.navigation ?? []) if (n.permission) wanted.add(n.permission);
    for (const key of Array.from(wanted)) {
      if (await checkRbacOrLegacy(ctx.user.id, String(ctx.user.role), key, ["admin"])) perms.add(key);
    }
    return {
      modules: ids,
      navigation: registry.navigation(ids, (k) => perms.has(k)),
    };
  }),
});
