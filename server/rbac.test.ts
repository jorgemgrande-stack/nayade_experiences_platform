/**
 * RBAC: resolución de permisos y fallback al rol heredado.
 *
 * Contexto verificado: en producción NO existen las tablas rbac_* (la consulta falla), de
 * modo que toda comprobación cae al fallback por rol heredado. Estas pruebas fijan ese
 * comportamiento y el de «RBAC primero» cuando las tablas existen, para que activar RBAC
 * en el futuro sea una decisión consciente y no un cambio silencioso de acceso.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Scenario =
  | { kind: "no-db" }
  | { kind: "tables-missing" }
  | { kind: "no-assignments"; legacyPerms: string[] }
  | { kind: "assigned"; perms: string[] };

const state = vi.hoisted(() => ({ scenario: { kind: "tables-missing" } as any }));

vi.mock("./db", () => ({
  getDb: async () => {
    const s = state.scenario as Scenario;
    if (s.kind === "no-db") return null;
    return {
      execute: async (query: any) => {
        if (s.kind === "tables-missing") {
          const e: any = new Error("Table 'railway.rbac_user_roles' doesn't exist");
          e.code = "ER_NO_SUCH_TABLE";
          throw e;
        }
        // drizzle `sql` template: se inspecciona el texto de la consulta
        const text = JSON.stringify(query?.queryChunks ?? query).toLowerCase();
        if (text.includes("count(*)")) {
          return [[{ cnt: s.kind === "assigned" ? 1 : 0 }]];
        }
        if (s.kind === "assigned") return [s.perms.map((key) => ({ key }))];
        if (s.kind === "no-assignments") return [s.legacyPerms.map((key) => ({ key }))];
        return [[]];
      },
    };
  },
}));

import { checkRbacOrLegacy, getUserPermissions } from "./_core/rbac";

beforeEach(() => {
  state.scenario = { kind: "tables-missing" };
});

describe("producción: tablas rbac_* inexistentes", () => {
  it("getUserPermissions lanza (para que el llamador use el fallback)", async () => {
    await expect(getUserPermissions(1, "admin")).rejects.toThrow();
  });

  it("checkRbacOrLegacy concede según el rol heredado", async () => {
    expect(await checkRbacOrLegacy(1, "admin", "crm.view", ["admin", "agente"])).toBe(true);
    expect(await checkRbacOrLegacy(2, "agente", "crm.view", ["admin", "agente"])).toBe(true);
  });

  it("checkRbacOrLegacy deniega a roles que no están en la lista heredada", async () => {
    for (const role of ["user", "partner_admin", "supplier", "employee", "monitor", "gestoria"]) {
      expect(await checkRbacOrLegacy(9, role, "crm.view", ["admin", "agente"]), role).toBe(false);
    }
  });

  it("sin base de datos usa también el rol heredado", async () => {
    state.scenario = { kind: "no-db" };
    expect(await checkRbacOrLegacy(1, "admin", "settings.manage", ["admin"])).toBe(true);
    expect(await checkRbacOrLegacy(1, "agente", "settings.manage", ["admin"])).toBe(false);
  });
});

describe("con tablas RBAC", () => {
  it("usuario con roles RBAC: solo cuentan los permisos RBAC, no el rol heredado", async () => {
    state.scenario = { kind: "assigned", perms: ["crm.view"] };
    expect(await checkRbacOrLegacy(1, "admin", "crm.view", ["admin"])).toBe(true);
    // Un admin heredado SIN el permiso en sus roles RBAC queda denegado (RBAC-first)
    expect(await checkRbacOrLegacy(1, "admin", "settings.manage", ["admin"])).toBe(false);
  });

  it("usuario sin asignaciones: permisos derivados del rol heredado", async () => {
    state.scenario = { kind: "no-assignments", legacyPerms: ["crm.view", "crm.reservations.manage"] };
    expect(await checkRbacOrLegacy(2, "agente", "crm.view", ["admin"])).toBe(true);
    expect(await checkRbacOrLegacy(2, "agente", "hr.view", ["admin"])).toBe(false);
  });

  it("una tabla creada pero SIN sembrar deniega (por eso no se debe crear sin sembrar antes)", async () => {
    state.scenario = { kind: "no-assignments", legacyPerms: [] };
    expect(await checkRbacOrLegacy(1, "admin", "crm.view", ["admin", "agente"])).toBe(false);
  });
});
