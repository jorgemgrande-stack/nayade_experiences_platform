/**
 * adminrest.test.ts
 * Tests para el rol adminrest: middleware, acceso a procedimientos y restricciones.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Mock del middleware adminrestProcedure ───────────────────────────────────

/**
 * Simula la lógica del middleware adminrestProcedure:
 * acepta 'admin' y 'adminrest', rechaza cualquier otro rol.
 */
function checkAdminrestAccess(role: string | undefined): void {
  if (!role || !["admin", "adminrest"].includes(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acceso restringido al módulo de restaurantes",
    });
  }
}

// ─── Mock de assertRestaurantAccess ──────────────────────────────────────────

async function assertRestaurantAccess(
  role: string,
  userId: number,
  restaurantId: number,
  assignedRestaurants: number[]
): Promise<void> {
  if (role === "admin") return; // admin global tiene acceso total
  if (role === "adminrest") {
    if (!assignedRestaurants.includes(restaurantId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este restaurante" });
    }
    return;
  }
  throw new TRPCError({ code: "FORBIDDEN" });
}

// ─── Tests del middleware adminrestProcedure ──────────────────────────────────

describe("adminrestProcedure middleware", () => {
  it("permite acceso a usuarios con rol 'admin'", () => {
    expect(() => checkAdminrestAccess("admin")).not.toThrow();
  });

  it("permite acceso a usuarios con rol 'adminrest'", () => {
    expect(() => checkAdminrestAccess("adminrest")).not.toThrow();
  });

  it("rechaza usuarios con rol 'user'", () => {
    expect(() => checkAdminrestAccess("user")).toThrow(TRPCError);
  });

  it("rechaza usuarios con rol 'agente'", () => {
    expect(() => checkAdminrestAccess("agente")).toThrow(TRPCError);
  });

  it("rechaza usuarios con rol 'monitor'", () => {
    expect(() => checkAdminrestAccess("monitor")).toThrow(TRPCError);
  });

  it("rechaza usuarios sin rol (undefined)", () => {
    expect(() => checkAdminrestAccess(undefined)).toThrow(TRPCError);
  });

  it("rechaza usuarios con rol vacío", () => {
    expect(() => checkAdminrestAccess("")).toThrow(TRPCError);
  });

  it("lanza error FORBIDDEN con el mensaje correcto", () => {
    try {
      checkAdminrestAccess("user");
      expect.fail("Debería haber lanzado un error");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
      expect((e as TRPCError).message).toBe("Acceso restringido al módulo de restaurantes");
    }
  });
});

// ─── Tests de assertRestaurantAccess ─────────────────────────────────────────

describe("assertRestaurantAccess — control de acceso por restaurante", () => {
  it("admin global puede acceder a cualquier restaurante", async () => {
    await expect(assertRestaurantAccess("admin", 1, 99, [])).resolves.toBeUndefined();
    await expect(assertRestaurantAccess("admin", 1, 1, [2, 3])).resolves.toBeUndefined();
  });

  it("adminrest puede acceder a restaurantes asignados", async () => {
    await expect(assertRestaurantAccess("adminrest", 5, 1, [1, 2, 3])).resolves.toBeUndefined();
    await expect(assertRestaurantAccess("adminrest", 5, 3, [1, 2, 3])).resolves.toBeUndefined();
  });

  it("adminrest no puede acceder a restaurantes no asignados", async () => {
    await expect(assertRestaurantAccess("adminrest", 5, 4, [1, 2, 3])).rejects.toThrow(TRPCError);
    await expect(assertRestaurantAccess("adminrest", 5, 99, [1, 2])).rejects.toThrow(TRPCError);
  });

  it("adminrest sin restaurantes asignados no puede acceder a ninguno", async () => {
    await expect(assertRestaurantAccess("adminrest", 5, 1, [])).rejects.toThrow(TRPCError);
  });

  it("usuario normal no puede acceder a ningún restaurante", async () => {
    await expect(assertRestaurantAccess("user", 1, 1, [1, 2, 3])).rejects.toThrow(TRPCError);
  });

  it("el error de acceso denegado tiene código FORBIDDEN", async () => {
    try {
      await assertRestaurantAccess("adminrest", 5, 99, [1, 2]);
      expect.fail("Debería haber lanzado un error");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
  });
});

// ─── Tests de lógica de roles en el sidebar ──────────────────────────────────

describe("filtrado de navegación por rol", () => {
  const navItems = [
    { label: "Dashboard",    href: "/admin",              roles: ["admin", "agente", "monitor"] },
    { label: "Restaurantes", href: "/admin/restaurantes", roles: ["admin", "adminrest"] },
    { label: "Usuarios",     href: "/admin/usuarios",     roles: ["admin"] },
    { label: "Productos",    href: "/admin/productos",    roles: ["admin"] },
  ];

  function filterNav(role: string) {
    return navItems.filter(item => item.roles.includes(role));
  }

  it("adminrest solo ve la sección Restaurantes", () => {
    const items = filterNav("adminrest");
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe("/admin/restaurantes");
  });

  it("admin ve todas las secciones", () => {
    const items = filterNav("admin");
    expect(items).toHaveLength(4);
  });

  it("agente no ve Restaurantes ni Usuarios", () => {
    const items = filterNav("agente");
    expect(items.some(i => i.href === "/admin/restaurantes")).toBe(false);
    expect(items.some(i => i.href === "/admin/usuarios")).toBe(false);
  });

  it("monitor no ve Restaurantes", () => {
    const items = filterNav("monitor");
    expect(items.some(i => i.href === "/admin/restaurantes")).toBe(false);
  });

  it("adminrest no ve Dashboard general", () => {
    const items = filterNav("adminrest");
    expect(items.some(i => i.href === "/admin")).toBe(false);
  });
});

// ─── Tests de redirect automático para adminrest ─────────────────────────────

describe("lógica de redirect para adminrest", () => {
  function shouldRedirectToRestaurants(role: string, currentPath: string): boolean {
    if (role !== "adminrest") return false;
    return currentPath === "/admin" || !currentPath.startsWith("/admin/restaurantes");
  }

  it("adminrest en /admin debe redirigir a /admin/restaurantes", () => {
    expect(shouldRedirectToRestaurants("adminrest", "/admin")).toBe(true);
  });

  it("adminrest en /admin/usuarios debe redirigir a /admin/restaurantes", () => {
    expect(shouldRedirectToRestaurants("adminrest", "/admin/usuarios")).toBe(true);
  });

  it("adminrest en /admin/restaurantes NO debe redirigir", () => {
    expect(shouldRedirectToRestaurants("adminrest", "/admin/restaurantes")).toBe(false);
  });

  it("adminrest en /admin/restaurantes/reservas NO debe redirigir", () => {
    expect(shouldRedirectToRestaurants("adminrest", "/admin/restaurantes/reservas")).toBe(false);
  });

  it("admin en /admin NO debe redirigir", () => {
    expect(shouldRedirectToRestaurants("admin", "/admin")).toBe(false);
  });

  it("agente en /admin NO debe redirigir (tiene su propio guard)", () => {
    expect(shouldRedirectToRestaurants("agente", "/admin")).toBe(false);
  });
});

// ─── Tests de asignación de restaurantes ─────────────────────────────────────

describe("asignación de restaurantes a adminrest", () => {
  it("un usuario adminrest puede tener múltiples restaurantes asignados", () => {
    const assignments = [
      { userId: 10, restaurantId: 1 },
      { userId: 10, restaurantId: 2 },
      { userId: 10, restaurantId: 3 },
    ];
    const userRestaurants = assignments
      .filter(a => a.userId === 10)
      .map(a => a.restaurantId);
    expect(userRestaurants).toEqual([1, 2, 3]);
  });

  it("dos adminrest pueden tener acceso al mismo restaurante", () => {
    const assignments = [
      { userId: 10, restaurantId: 1 },
      { userId: 11, restaurantId: 1 },
    ];
    const user10 = assignments.filter(a => a.userId === 10).map(a => a.restaurantId);
    const user11 = assignments.filter(a => a.userId === 11).map(a => a.restaurantId);
    expect(user10).toContain(1);
    expect(user11).toContain(1);
  });

  it("un adminrest sin asignaciones no tiene acceso a ningún restaurante", () => {
    const assignments: { userId: number; restaurantId: number }[] = [];
    const userRestaurants = assignments
      .filter(a => a.userId === 10)
      .map(a => a.restaurantId);
    expect(userRestaurants).toHaveLength(0);
  });
});
