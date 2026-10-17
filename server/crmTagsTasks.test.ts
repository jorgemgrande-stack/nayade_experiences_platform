/**
 * Etiquetas (crm-tags) y tareas (crm-tasks) del CRM: reglas compartidas, licencia por procedimiento,
 * menú por tareas, rutas del panel y coherencia entre la migración 0008 y drizzle/schema.ts.
 * La operación real (MySQL, roles, aislamiento) está en server/essential.crm.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import {
  isTaskDueToday, isTaskOverdue, isValidYmd, localYmd, normalizeTagName, tagKey, taskEntityHref, validateTagForm, validateTaskForm,
} from "../shared/crmTagsTasks";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV, resolveNav, type NavContext } from "../shared/adminNav";
import { crmTagLinks, crmTags, crmTasks } from "../drizzle/schema";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("etiquetas: validación", () => {
  it("normaliza espacios y compara sin mayúsculas ni acentos", () => {
    expect(normalizeTagName("  Cliente   VIP ")).toBe("Cliente VIP");
    expect(tagKey("Málaga")).toBe(tagKey("MALAGA"));
  });

  it("nombre obligatorio, longitud, duplicado y color de la paleta", () => {
    expect(validateTagForm({ name: "  " }).name).toBe("Indica el nombre de la etiqueta.");
    expect(validateTagForm({ name: "x".repeat(61) }).name).toMatch(/60/);
    expect(validateTagForm({ name: "vip" }, [{ id: 1, name: "VIP" }]).name).toBe("Ya existe una etiqueta con ese nombre.");
    // La propia etiqueta no cuenta como duplicado al editarla
    expect(validateTagForm({ name: "VIP" }, [{ id: 1, name: "VIP" }], 1)).toEqual({});
    expect(validateTagForm({ name: "Rojo", color: "#ff0000" }).color).toBeDefined();
    expect(validateTagForm({ name: "Rojo", color: "rojo" })).toEqual({});
  });
});

describe("tareas: validación y vencimiento", () => {
  it("fechas reales en formato AAAA-MM-DD", () => {
    expect(isValidYmd("2026-10-16")).toBe(true);
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("16/10/2026")).toBe(false);
    expect(localYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("título obligatorio, fecha válida y vínculo completo", () => {
    expect(validateTaskForm({ title: " " }).title).toBe("Indica el título de la tarea.");
    expect(validateTaskForm({ title: "x".repeat(201) }).title).toMatch(/200/);
    expect(validateTaskForm({ title: "Llamar", dueDate: "2026-13-01" }).dueDate).toBeDefined();
    expect(validateTaskForm({ title: "Llamar", entityType: "client" }).entity).toBeDefined();
    expect(validateTaskForm({ title: "Llamar", entityId: 3 }).entity).toBeDefined();
    expect(validateTaskForm({ title: "Llamar", entityType: "factura", entityId: 3 }).entity).toBeDefined();
    expect(validateTaskForm({ title: "Llamar", dueDate: "2026-10-16", entityType: "quote", entityId: 3 })).toEqual({});
  });

  it("vencida = pendiente con fecha anterior a hoy; hecha nunca está vencida", () => {
    const today = "2026-10-16";
    expect(isTaskOverdue({ status: "pendiente", dueDate: "2026-10-15" }, today)).toBe(true);
    expect(isTaskOverdue({ status: "pendiente", dueDate: "2026-10-16" }, today)).toBe(false);
    expect(isTaskOverdue({ status: "hecha", dueDate: "2026-10-01" }, today)).toBe(false);
    expect(isTaskOverdue({ status: "pendiente", dueDate: null }, today)).toBe(false);
    expect(isTaskDueToday({ status: "pendiente", dueDate: "2026-10-16" }, today)).toBe(true);
  });

  it("enlace a la entidad vinculada", () => {
    expect(taskEntityHref("client", 7)).toBe("/admin/crm/clientes?clientId=7");
    expect(taskEntityHref("lead", 3, "Ana López")).toBe("/admin/crm?tab=leads&search=Ana%20L%C3%B3pez");
    expect(taskEntityHref("quote", 3, "PRES-2026-0001")).toBe("/admin/crm?tab=quotes&search=PRES-2026-0001");
    expect(taskEntityHref(null, null)).toBeNull();
  });
});

describe("licencia por procedimiento", () => {
  it("crmTags.* exige crm-tags y crmTasks.* exige crm-tasks", () => {
    for (const p of ["crmTags.list", "crmTags.create", "crmTags.assign", "crmTags.forEntities"]) expect(capabilityForProcedure(p), p).toBe("crm-tags");
    for (const p of ["crmTasks.list", "crmTasks.create", "crmTasks.setStatus", "crmTasks.summary"]) expect(capabilityForProcedure(p), p).toBe("crm-tasks");
  });

  it("los procedimientos que usa el panel existen en el servidor", async () => {
    const { appRouter } = await import("./routers");
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    const src = ["client/src/pages/admin/crm/CrmTags.tsx", "client/src/pages/admin/crm/CrmTasks.tsx", "client/src/components/admin/crm/CrmParts.tsx", "client/src/pages/admin/crm/ClientsManager.tsx", "client/src/pages/admin/home/EssentialHome.tsx"].map(read).join("\n");
    const used = Array.from(new Set(Array.from(src.matchAll(/trpc\.(crmTags|crmTasks)\.([a-zA-Z]+)\.use(?:Query|Mutation)/g), (m) => `${m[1]}.${m[2]}`)));
    expect(used.length).toBeGreaterThanOrEqual(10);
    expect(used.filter((p) => !procedures[p])).toEqual([]);
  }, 60_000); // importa el router completo: con la máquina cargada supera los 5 s por defecto
});

describe("menú por tareas y rutas", () => {
  const ctx = (role: string, caps: Record<string, "active" | "read_only" | null>): NavContext => ({
    role,
    isFlagVisible: () => true,
    isModuleVisible: () => true,
    capabilityState: (c) => caps[c] ?? null,
  });
  const items = (c: NavContext) => resolveNav(TASK_NAV, c).flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));

  it("Tareas y Etiquetas aparecen en «Clientes y ventas» solo con su capacidad", () => {
    const all = items(ctx("agente", { "crm-tasks": "active", "crm-tags": "active" }));
    expect(all.find((i) => i.href === "/admin/crm/tareas")).toMatchObject({ section: "Clientes y ventas", readOnly: false });
    expect(all.find((i) => i.href === "/admin/crm/etiquetas")).toMatchObject({ section: "Clientes y ventas", readOnly: false });
    const none = items(ctx("agente", {}));
    expect(none.find((i) => i.href === "/admin/crm/tareas")).toBeUndefined();
    expect(none.find((i) => i.href === "/admin/crm/etiquetas")).toBeUndefined();
    // Licencia en solo lectura y rol de solo lectura: visibles pero marcadas
    expect(items(ctx("agente", { "crm-tags": "read_only" })).find((i) => i.href === "/admin/crm/etiquetas")?.readOnly).toBe(true);
    expect(items(ctx("readonly", { "crm-tasks": "active" })).find((i) => i.href === "/admin/crm/tareas")?.readOnly).toBe(true);
    // Sin rol comercial no aparecen
    expect(items(ctx("controler", { "crm-tasks": "active" })).find((i) => i.href === "/admin/crm/tareas")).toBeUndefined();
  });

  it("las rutas existen en el panel", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('<Route path="/admin/crm/etiquetas">');
    expect(app).toContain('<Route path="/admin/crm/tareas">');
  });
});

describe("migración 0008 coherente con drizzle/schema.ts", () => {
  const up = read("db/migrations/0008_crm_tags_tasks.sql");
  const down = read("db/migrations/0008_crm_tags_tasks.down.sql");
  const columnsInSql = (table: string) => {
    const body = up.split(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`))[1].split(/\) ENGINE=/)[0];
    return body.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c) && !["PRIMARY", "UNIQUE", "KEY", "CONSTRAINT"].includes(c));
  };

  it("cada tabla tiene en SQL las mismas columnas que en el esquema", () => {
    for (const t of [crmTags, crmTagLinks, crmTasks]) {
      const cfg = getTableConfig(t);
      expect(columnsInSql(cfg.name).sort(), cfg.name).toEqual(cfg.columns.map((c) => c.name).sort());
    }
  });

  it("es aditiva y reversible", () => {
    expect(up).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE)\b/im);
    expect(up).not.toMatch(/ALTER TABLE/i);
    for (const t of ["crm_tasks", "crm_tag_links", "crm_tags"]) expect(down).toContain(`DROP TABLE IF EXISTS ${t};`);
    // Las asignaciones se borran antes que el catálogo (clave foránea)
    expect(down.indexOf("crm_tag_links")).toBeLessThan(down.indexOf("DROP TABLE IF EXISTS crm_tags;"));
  });
});
