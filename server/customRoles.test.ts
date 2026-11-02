/**
 * Roles personalizados (Business, roles-custom): sin rol propio nada cambia (permiso a permiso y rol a rol); con rol
 * propio se aplican sus diferencias sin superar nunca a administración; la lista de permisos coincide con lo que el
 * servidor comprueba hoy; licencia por plan; migración aditiva. La operación real (MySQL, dos empresas) está en
 * server/customRoles.mysql.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CUSTOM_ROLE_BASES, CUSTOM_ROLE_PERMISSIONS, basePermissions, decideAnyWithCustomRole, decideWithCustomRole, diffFromBase,
  effectivePermissions, isCustomRolePermission, normalizeCustomRoleName, type CustomRoleLicense, type CustomRoleOverride,
} from "../shared/customRoles";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { destructiveMigration, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const ALL_ROLES = ["user", "admin", "monitor", "agente", "adminrest", "controler", "partner_admin", "partner_user", "supplier", "employee", "gestoria", "readonly"];
const LICENSES: CustomRoleLicense[] = ["licensed", "unlicensed", "unknown"];
const ov = (baseRole: string, grants: string[] = [], revokes: string[] = []): CustomRoleOverride => ({ roleId: 1, baseRole, grants: new Set(grants), revokes: new Set(revokes) });

/** Comprobaciones de permiso del servidor: clave → roles de siempre (procedimientos, rutas y ficheros). */
function serverChecks(): Array<{ key: string; roles: string[]; file: string }> {
  const out: Array<{ key: string; roles: string[]; file: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
        const src = read(rel);
        for (const m of src.matchAll(/(?:permissionProcedure|checkRbacOrLegacy|checkPermission|requirePermission)\(\s*(?:[^,()]+,\s*[^,()]+,\s*)?"([a-z_.]+)"\s*,\s*\[([^\]]*)\]/g))
          out.push({ key: m[1], roles: [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]), file: rel });
        for (const m of src.matchAll(/permission:\s*"([a-z_.]+)",\s*fallbackRoles:\s*\[([^\]]*)\]/g))
          out.push({ key: m[1], roles: [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]), file: rel });
      }
    }
  };
  walk("server");
  return out;
}

describe("roles propios: catálogo", () => {
  it("ningún rol base es administración y la lista no incluye configuración, usuarios ni el acceso al equipo", () => {
    expect(CUSTOM_ROLE_BASES).not.toContain("admin");
    for (const k of CUSTOM_ROLE_PERMISSIONS.map((d) => d.key)) expect(k).not.toMatch(/^settings\.|^crm\.view$/);
    expect(isCustomRolePermission("settings.manage")).toBe(false);
  });

  it("los permisos de la lista y sus roles coinciden con lo que el servidor comprueba hoy", () => {
    const checks = serverChecks();
    for (const d of CUSTOM_ROLE_PERMISSIONS) {
      const found = checks.filter((c) => c.key === d.key);
      expect(found.length, `${d.key} no se comprueba en el servidor`).toBeGreaterThan(0);
      for (const c of found) expect([...c.roles].sort(), `${d.key} en ${c.file}`).toEqual([...d.defaultRoles].sort());
      expect(d.defaultRoles).toContain("admin");
    }
  });

  it("diferencias con el rol base: marcar exactamente lo del rol base no guarda nada", () => {
    for (const b of CUSTOM_ROLE_BASES) {
      expect(diffFromBase(b, basePermissions(b))).toEqual({ grants: [], revokes: [] });
      expect(effectivePermissions(b, [], [])).toEqual(basePermissions(b));
    }
    const d = diffFromBase("agente", [...basePermissions("agente").filter((k) => k !== "discounts.view"), "hr.view", "settings.manage"]);
    expect(d).toEqual({ grants: ["hr.view"], revokes: ["discounts.view"] });
    expect(effectivePermissions("agente", d.grants, d.revokes)).toContain("hr.view");
    expect(effectivePermissions("agente", d.grants, d.revokes)).not.toContain("discounts.view");
  });

  it("nombre obligatorio y acotado", () => {
    expect(normalizeCustomRoleName("  Comercial   sin caja ")).toEqual({ ok: true, name: "Comercial sin caja" });
    expect(normalizeCustomRoleName(" ").ok).toBe(false);
    expect(normalizeCustomRoleName("x".repeat(61)).ok).toBe(false);
  });
});

describe("roles propios: decisión de permisos", () => {
  const checks = serverChecks();
  const keys = Array.from(new Set([...checks.map((c) => c.key), "settings.manage", "crm.view"]));

  it("sin rol propio, cada usuario decide exactamente como hoy (todas las claves, roles y licencias)", () => {
    for (const role of ALL_ROLES)
      for (const c of [...checks, { key: "settings.manage", roles: ["admin"] }])
        for (const baseAllowed of [true, false])
          for (const license of LICENSES) {
            expect(decideWithCustomRole({ baseAllowed, key: c.key, fallbackRoles: c.roles, override: null, userRole: role, license })).toBe(baseAllowed);
            expect(decideAnyWithCustomRole({ baseAllowed, keys: [c.key], fallbackRoles: c.roles, override: null, userRole: role, license })).toBe(baseAllowed);
          }
  });

  it("un rol propio cuyo rol base no es el del usuario no se aplica (p. ej. tras cambiarle el rol)", () => {
    const o = ov("agente", ["hr.view"], ["discounts.view"]);
    for (const role of ALL_ROLES.filter((r) => r !== "agente"))
      for (const key of keys)
        for (const baseAllowed of [true, false])
          expect(decideWithCustomRole({ baseAllowed, key, fallbackRoles: ["admin", "agente"], override: o, userRole: role, license: "licensed" })).toBe(baseAllowed);
  });

  it("un rol propio sin diferencias es idéntico a su rol base", () => {
    for (const b of CUSTOM_ROLE_BASES)
      for (const c of checks)
        for (const baseAllowed of [true, false])
          expect(decideWithCustomRole({ baseAllowed, key: c.key, fallbackRoles: c.roles, override: ov(b), userRole: b, license: "licensed" })).toBe(baseAllowed);
  });

  it("quitar deniega; añadir concede solo donde administración tiene acceso y solo permisos de la lista", () => {
    const o = ov("agente", ["hr.view", "settings.manage", "crm.view"], ["discounts.view"]);
    const d = (key: string, fallbackRoles: string[], baseAllowed: boolean, license: CustomRoleLicense = "licensed") =>
      decideWithCustomRole({ baseAllowed, key, fallbackRoles, override: o, userRole: "agente", license });
    expect(d("discounts.view", ["admin", "agente"], true)).toBe(false);
    expect(d("hr.view", ["admin"], false)).toBe(true);
    // Nunca más que administración: donde ni admin entra, añadir no concede
    expect(d("hr.view", ["monitor"], false)).toBe(false);
    // Permisos fuera de la lista: un rol propio no los puede dar
    expect(d("settings.manage", ["admin"], false)).toBe(false);
    // El resto, como el rol base
    expect(d("tpv.access", ["admin", "agente"], true)).toBe(true);
    expect(d("accounting.cash.view", ["admin"], false)).toBe(false);
  });

  it("sin la capacidad no se aplica nada; si no puede verificarse, solo las restricciones", () => {
    const o = ov("agente", ["hr.view"], ["discounts.view"]);
    const d = (key: string, fallbackRoles: string[], baseAllowed: boolean, license: CustomRoleLicense) =>
      decideWithCustomRole({ baseAllowed, key, fallbackRoles, override: o, userRole: "agente", license });
    expect(d("hr.view", ["admin"], false, "unlicensed")).toBe(false);
    expect(d("discounts.view", ["admin", "agente"], true, "unlicensed")).toBe(true);
    expect(d("hr.view", ["admin"], false, "unknown")).toBe(false);
    expect(d("discounts.view", ["admin", "agente"], true, "unknown")).toBe(false);
  });

  it("varios permisos: basta uno concedido; si se quitan todos, se deniega", () => {
    const o = ov("agente", ["accounting.cash.view"], ["discounts.view", "discounts.manage"]);
    const any = (keys: string[], baseAllowed: boolean) =>
      decideAnyWithCustomRole({ baseAllowed, keys, fallbackRoles: ["admin"], override: o, userRole: "agente", license: "licensed" });
    expect(any(["accounting.cash.view", "accounting.cash.manage"], false)).toBe(true);
    expect(any(["discounts.view", "discounts.manage"], true)).toBe(false);
    expect(any(["tpv.access", "discounts.view"], true)).toBe(true);
  });
});

// ── Capa en el servidor: administración y sin rol propio, ni una consulta más ni un resultado distinto ──────────────

const base = vi.fn<(...a: unknown[]) => Promise<boolean>>();
const userRole = vi.fn<(id: number) => Promise<CustomRoleOverride | null>>();
const capCheck = vi.fn<(...a: unknown[]) => Promise<{ allowed: boolean }>>();
vi.mock("./_core/rbac", () => ({ checkRbacOrLegacy: (...a: unknown[]) => base(...a) }));
vi.mock("./customRolesDb", () => ({ getUserCustomRole: (id: number) => userRole(id) }));
vi.mock("./_core/capabilities/access", () => ({ getCapabilityAccess: () => ({ check: (...a: unknown[]) => capCheck(...a) }) }));

describe("roles propios: checkPermission", () => {
  beforeEach(() => {
    base.mockReset();
    userRole.mockReset();
    capCheck.mockReset();
    capCheck.mockResolvedValue({ allowed: true });
  });

  it("administración y roles que no pueden ser base: resultado de siempre sin consultar roles propios", async () => {
    const { checkPermission } = await import("./customRolesAccess");
    for (const role of ["admin", "user", "employee", "supplier", "gestoria"]) {
      for (const r of [true, false]) {
        base.mockResolvedValueOnce(r);
        expect(await checkPermission(1, role, "hr.view", ["admin"])).toBe(r);
      }
    }
    expect(userRole).not.toHaveBeenCalled();
  });

  it("sin rol propio asignado: resultado de siempre, sin consultar la licencia", async () => {
    const { checkPermission } = await import("./customRolesAccess");
    userRole.mockResolvedValue(null);
    for (const r of [true, false]) {
      base.mockResolvedValueOnce(r);
      expect(await checkPermission(2, "agente", "discounts.view", ["admin", "agente"])).toBe(r);
    }
    expect(capCheck).not.toHaveBeenCalled();
  });

  it("con rol propio y la capacidad: se aplican sus diferencias", async () => {
    const { checkPermission } = await import("./customRolesAccess");
    userRole.mockResolvedValue(ov("agente", ["hr.view"], ["discounts.view"]));
    base.mockResolvedValue(true);
    expect(await checkPermission(2, "agente", "discounts.view", ["admin", "agente"])).toBe(false);
    base.mockResolvedValue(false);
    expect(await checkPermission(2, "agente", "hr.view", ["admin"])).toBe(true);
    capCheck.mockResolvedValue({ allowed: false });
    expect(await checkPermission(2, "agente", "hr.view", ["admin"])).toBe(false);
    capCheck.mockRejectedValue(new Error("registro caído"));
    base.mockResolvedValue(true);
    expect(await checkPermission(2, "agente", "discounts.view", ["admin", "agente"])).toBe(false);
  });

  it("las comprobaciones por permiso del panel usan la capa (y la de siempre no cambia)", () => {
    const trpc = read("server/_core/trpc.ts");
    expect(trpc).toMatch(/const allowed = await checkPermission\(\s*ctx\.user\.id,\s*ctx\.user\.role as string,\s*permissionKey,/);
    expect(trpc).toMatch(/applyCustomRoleAny\(/);
    for (const f of ["server/fileRoutes.ts", "server/routers/ticketing.ts", "server/routers/modulesRouter.ts", "server/routers/panelRouter.ts"])
      expect(read(f), f).not.toMatch(/checkRbacOrLegacy\(/);
  });
});

describe("roles propios: licencia y migración", () => {
  it("Business, no Essential; el guardián de rutas exige roles-custom", () => {
    expect(capabilitiesOfTier("business")).toContain("roles-custom");
    expect(capabilitiesOfTier("essential")).not.toContain("roles-custom");
    for (const p of ["customRoles.list", "customRoles.create", "customRoles.update", "customRoles.remove", "customRoles.assign"])
      expect(capabilityForProcedure(p)).toBe("roles-custom");
    const router = read("server/routers/customRoles.ts");
    expect((router.match(/assertCustomRolesLicensed\(/g) ?? []).length).toBe(5);
    expect(router).not.toMatch(/staffProcedure|protectedProcedure|publicProcedure/);
  });

  it("el panel solo muestra los roles propios con la capacidad", () => {
    expect(read("client/src/components/admin/UsersManager.tsx")).toMatch(/sub\.can\("roles-custom"\) && <CustomRolesPanel/);
  });

  const up = "db/migrations/0022_custom_roles.sql";
  it("la migración es aditiva y la publicación la trata como ordinaria", () => {
    const sql = read(up);
    expect(destructiveMigration(sql)).toBeNull();
    expect(extraordinaryChanges([up, "db/migrations/0022_custom_roles.down.sql"], "", (f) => read(f))).toEqual([]);
    for (const t of ["custom_roles", "custom_role_permissions", "custom_role_users"]) expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} `));
    // Ni toca usuarios ni crea o rellena las tablas rbac_*
    expect(sql).not.toMatch(/^s*(ALTER|INSERT|UPDATE)|CREATE TABLE IF NOT EXISTS rbac_/im);
    expect(read("db/migrations/0022_custom_roles.down.sql")).toMatch(/custom_roles/);
  });

  it("el código nuevo no contiene nada que la publicación trate como destructivo o de autenticación", () => {
    const files = ["shared/customRoles.ts", "server/customRolesDb.ts", "server/customRolesAccess.ts", "server/routers/customRoles.ts", "client/src/components/admin/CustomRolesPanel.tsx"];
    const diff = files.map((f) => `diff --git a/${f} b/${f}\n` + read(f).replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`).join("\n")).join("\n");
    expect(extraordinaryChanges(files, diff, () => null)).toEqual([]);
  });
});
