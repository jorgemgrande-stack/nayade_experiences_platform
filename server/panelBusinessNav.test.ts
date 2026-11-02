/**
 * Menú Business: «Agenda y reservas» (bookings-generic), «Gastos y compras» (purchasing-basic) y «Cuenta de resultados»
 * (reports-advanced) solo aparecen con su capacidad; Essential no las ve en el menú pero conserva el acceso por ruta
 * que ya tenía. Las rutas enlazadas existen en el panel.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TASK_NAV, capabilityStateFrom, resolveNav, routeAccess } from "../shared/adminNav";
import { capabilitiesOfTier } from "./catalog/capabilities";

const ESSENTIAL = capabilitiesOfTier("essential");
const BUSINESS = [...ESSENTIAL, ...capabilitiesOfTier("business")];
const state = (visible: string[]) => capabilityStateFrom({ licensing: "capabilities", visible, readOnly: [] });
const menu = (visible: string[], role = "admin") =>
  resolveNav(TASK_NAV, { role, isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: state(visible) });
const keys = (visible: string[], role = "admin") =>
  menu(visible, role).flatMap((s) => s.items.flatMap((i) => [i.key ?? i.href, ...(i.children ?? []).map((c) => c.key ?? c.href)]));

const BUSINESS_ROUTES = [
  "/admin/operaciones/calendario",
  "/admin/operaciones/reservas",
  "/admin/contabilidad/gastos",
  "/admin/contabilidad/gastos/proveedores",
  "/admin/contabilidad/gastos/recurrentes",
  "/admin/contabilidad/gastos/categorias",
  "/admin/contabilidad/gastos/centros-coste",
  "/admin/contabilidad/cuenta-resultados",
];

describe("menú Business", () => {
  it("Business ve agenda, gastos y cuenta de resultados en su sección", () => {
    const sections = menu(BUSINESS);
    const section = (id: string) => sections.find((s) => s.id === id)!.items.map((i) => i.key);
    expect(section("ventas")).toContain("b-agenda");
    expect(section("facturacion")).toEqual(expect.arrayContaining(["b-gastos", "b-resultados"]));
    expect(keys(BUSINESS)).toEqual(expect.arrayContaining(["b-agenda-calendario", "b-agenda-reservas", "b-gastos-lista", "b-gastos-proveedores", "b-gastos-recurrentes", "b-gastos-categorias", "b-resultados-informe", "b-centros-coste"]));
  });

  it("Essential no las ve en el menú", () => {
    expect(keys(ESSENTIAL).filter((k) => k.startsWith("b-"))).toEqual([]);
  });

  it("cada entrada aparece solo con su capacidad", () => {
    expect(keys([...ESSENTIAL, "bookings-generic"]).filter((k) => k.startsWith("b-"))).toEqual(["b-agenda", "b-agenda-calendario", "b-agenda-reservas"]);
    expect(keys([...ESSENTIAL, "purchasing-basic"]).filter((k) => k.startsWith("b-"))).toEqual(["b-gastos", "b-gastos-lista", "b-gastos-proveedores", "b-gastos-recurrentes", "b-gastos-categorias"]);
    expect(keys([...ESSENTIAL, "reports-advanced"]).filter((k) => k.startsWith("b-"))).toEqual(["b-resultados", "b-resultados-informe", "b-centros-coste"]);
  });

  it("gastos y cuenta de resultados son de administración; la agenda también la ve el equipo comercial", () => {
    const agente = keys(BUSINESS, "agente");
    expect(agente).toContain("b-agenda");
    expect(agente).not.toContain("b-gastos");
    expect(agente).not.toContain("b-resultados");
  });

  it("Essential conserva el acceso por ruta que ya tenía; sin capacidades, no incluido", () => {
    for (const r of BUSINESS_ROUTES) {
      expect(routeAccess(r, state(BUSINESS)), r).toBe("allowed");
      expect(routeAccess(r, state(ESSENTIAL)), r).toBe("allowed");
      expect(routeAccess(r, state([])), r).toBe("not_included");
    }
    expect(routeAccess("/admin/contabilidad/gastos", state(["purchasing-basic"]))).toBe("allowed");
    expect(routeAccess("/admin/operaciones/calendario", state(["bookings-generic"]))).toBe("allowed");
  });

  it("las rutas enlazadas existen en el panel", () => {
    const app = fs.readFileSync(path.join(__dirname, "../client/src/App.tsx"), "utf8");
    for (const r of BUSINESS_ROUTES) expect(app, r).toContain(`<Route path="${r}">`);
  });
});
