/**
 * Menú dinámico por manifiesto (contrato de módulo 1.2): validación de aportaciones, fusión con el menú por tareas,
 * resolución por licencia (activa / solo lectura / suspendida / sin licencia), rol, permiso, licencia de módulo y
 * compatibilidad con el Core, guardián de rutas y namespaces protegidos en el servidor.
 */
import { describe, expect, it } from "vitest";
import {
  CORE_EXTENSION_PANELS,
  CORE_EXTENSION_ROUTES,
  panelEntries,
  validatePanelContributions,
  type PanelContributions,
} from "../shared/panelExtensions";
import { mergeExtensions, panelTargets, resolveNav, routeAccess, routeCapabilities, TASK_NAV, type NavContext } from "../shared/adminNav";
import { validateManifest } from "./_core/modules/registry";
import { BUILTIN_MODULES, CONNECT_EXTENSIONS } from "./_core/modules/builtin";
import { MODULE_CONTRACT_VERSION, ModuleError, type ModuleManifest } from "./_core/modules/contract";
import { satisfies } from "./_core/modules/semver";
import {
  extensionCapabilityRoutes,
  extensionModuleRoutes,
  panelExtensionSources,
  resolvePanelNavigation,
  type PanelExtensionSource,
} from "./_core/modules/panelNavigation";
import { skiRentalModule } from "./skiRental/manifest";

type State = "active" | "read_only" | null;

const big: PanelContributions = {
  section: {
    id: "clinica",
    label: "Clínica",
    order: 10,
    items: [
      { id: "inicio", label: "Resumen", path: "/admin/clinica", icon: "dashboard" },
      {
        id: "pacientes",
        label: "Pacientes",
        path: "/admin/clinica/pacientes",
        icon: "users",
        roles: ["admin", "agente"],
        children: [
          { id: "fichas", label: "Fichas", path: "/admin/clinica/pacientes", roles: ["admin", "agente"] },
          { id: "historial", label: "Historial", path: "/admin/clinica/historial", permission: "care.history.view", roles: ["admin", "agente"] },
        ],
      },
    ],
  },
  tabs: [{ id: "agenda-clientes", label: "Citas del cliente", path: "/admin/clinica/citas-cliente", parent: "t-clientes", roles: ["admin", "agente"] }],
  settings: [{ id: "ajustes", label: "Ajustes de la clínica", path: "/admin/clinica/ajustes" }],
  routes: ["/admin/clinica/informes"],
  api: ["careClinic"],
};
const careManifest: ModuleManifest = {
  id: "care",
  name: "Care Net",
  version: "1.0.0",
  kind: "sector",
  coreRange: "^1.0.0",
  capability: "care-net",
  permissions: [{ key: "care.history.view", description: "Ver el historial" }],
  panel: big,
};
const source = (m: ModuleManifest, o: Partial<PanelExtensionSource> = {}): PanelExtensionSource => ({ manifest: m, capability: m.capability ?? null, requiresModuleLicense: false, siteScoped: false, ...o });
const deps = (o: { states?: Record<string, State>; role?: string; perms?: string[]; modules?: string[]; core?: string } = {}) => ({
  coreVersion: o.core ?? "1.0.0",
  role: o.role ?? "admin",
  capabilityState: (id: string) => o.states?.[id] ?? null,
  moduleAvailable: async (id: string) => (o.modules ?? []).includes(id),
  hasPermission: async (k: string) => (o.perms ?? []).includes(k),
});
const ctx = (states: Record<string, State>, role = "admin"): NavContext => ({ role, isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: (id) => states[id] ?? null });
const ESSENTIAL_STATES: Record<string, State> = Object.fromEntries(TASK_NAV.flatMap((s) => s.items.flatMap((i) => [...(i.capabilities ?? []), ...(i.children ?? []).flatMap((c) => c.capabilities ?? [])])).map((c) => [c, "active" as State]));

describe("contrato de módulo 1.2: aportaciones al panel", () => {
  it("1.2 es compatible con lo que implementa 1.1 y los manifiestos sin `panel` siguen siendo válidos", () => {
    expect(MODULE_CONTRACT_VERSION).toBe("1.2.0");
    expect(satisfies(MODULE_CONTRACT_VERSION, skiRentalModule.contract)).toBe(true);
    expect(() => validateManifest({ id: "viejo", name: "Viejo", version: "1.0.0", kind: "addon", coreRange: "^1.0.0" })).not.toThrow();
  });

  it("las extensiones del Core declaran sus aportaciones y son válidas", () => {
    for (const m of [...BUILTIN_MODULES, ...CONNECT_EXTENSIONS]) expect(() => validateManifest(m), m.id).not.toThrow();
    expect(validateManifest.bind(null, careManifest)).not.toThrow();
    const declared = [...BUILTIN_MODULES, ...CONNECT_EXTENSIONS].filter((m) => m.panel).map((m) => [m.id, m.capability]);
    expect(declared).toEqual([["hotel", "hotel-net"], ["spa", "care-net"], ["restaurants", "restaurant-net"], ["people", "people-hr"]]);
    // Ya no están fijas en el menú del Core
    const hrefs = TASK_NAV.flatMap((s) => s.items.map((i) => i.href));
    for (const p of ["/admin/personal", "/admin/hotel", "/admin/restaurantes", "/admin/spa"]) expect(hrefs).not.toContain(p);
  });

  it("rechaza aportaciones mal formadas", () => {
    const bad = (panel: PanelContributions, extra: Partial<ModuleManifest> = {}) => () => validateManifest({ ...careManifest, ...extra, panel });
    expect(bad({ items: [{ id: "x", label: "X", path: "/fuera" }] })).toThrow(ModuleError);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/x", icon: "cohete" as never }] })).toThrow(/icono/);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/x", permission: "care.otro" }] })).toThrow(/permiso/);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/x", section: "no-existe" }] })).toThrow(/sección desconocida/);
    expect(bad({ tabs: [{ id: "x", label: "X", path: "/admin/x", parent: "no-existe" }] })).toThrow(/entrada desconocida/);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/crm/clientes" }] })).toThrow(/del Core/);
    expect(bad({ section: { id: "ventas", label: "Otra", items: [{ id: "x", label: "X", path: "/admin/x" }] } })).toThrow(/ya existe/);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/x" }, { id: "x", label: "Y", path: "/admin/y" }] })).toThrow(/duplicado/);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/x" }] }, { capability: undefined })).toThrow(/sin capacidad/);
    expect(bad({ items: [{ id: "x", label: "X", path: "/admin/x", capabilities: ["inventada"] }] })).toThrow(/capacidad desconocida/);
    expect(() => validateManifest({ ...careManifest, capability: "inventada" })).toThrow(/capacidad desconocida/);
    expect(validatePanelContributions("care", big, { capability: "care-net", permissions: careManifest.permissions, targets: panelTargets() })).toEqual([]);
  });
});

describe("resolución por licencia, rol, permiso y versión del Core", () => {
  const care = [source(careManifest)];
  const keys = (n: Awaited<ReturnType<typeof resolvePanelNavigation>>) =>
    n.entries.flatMap((e) => (e.kind === "section" ? e.items.flatMap((i) => [i.key, ...(i.children ?? []).map((c) => c.key)]) : e.kind === "item" ? [e.item.key] : [e.leaf.key]));

  it("licencia activa: todas sus aportaciones (sin el permiso propio, sin la entrada que lo pide)", async () => {
    const n = await resolvePanelNavigation(care, deps({ states: { "care-net": "active" } }));
    expect(keys(n)).toEqual(["x-care-inicio", "x-care-pacientes", "x-care-fichas", "x-care-agenda-clientes", "x-care-ajustes"]);
    const withPerm = await resolvePanelNavigation(care, deps({ states: { "care-net": "active" }, perms: ["care.history.view"] }));
    expect(keys(withPerm)).toContain("x-care-historial");
  });

  it("solo lectura: se ve (el menú la marca); suspendida o sin licencia: nada, pero sus rutas siguen declaradas", async () => {
    expect((await resolvePanelNavigation(care, deps({ states: { "care-net": "read_only" } }))).entries.length).toBeGreaterThan(0);
    for (const states of [{}, { "care-net": null }]) {
      const n = await resolvePanelNavigation(care, deps({ states }));
      expect(n.entries).toEqual([]);
      expect(n.routes.map((r) => r.path)).toEqual(expect.arrayContaining(["/admin/clinica", "/admin/clinica/informes", "/admin/clinica/ajustes"]));
    }
  });

  it("rol sin permiso: el equipo solo ve lo que su rol permite", async () => {
    const n = await resolvePanelNavigation(care, deps({ states: { "care-net": "active" }, role: "agente" }));
    expect(keys(n)).toEqual(["x-care-pacientes", "x-care-fichas", "x-care-agenda-clientes"]);
    // El rol «solo lectura» ve lo del equipo
    expect(keys(await resolvePanelNavigation(care, deps({ states: { "care-net": "active" }, role: "readonly" })))).toEqual(keys(n));
    expect((await resolvePanelNavigation(care, deps({ states: { "care-net": "active" }, role: "monitor" }))).entries).toEqual([]);
  });

  it("coreRange incompatible: no aporta nada", async () => {
    const n = await resolvePanelNavigation([source({ ...careManifest, coreRange: "^2.0.0" })], deps({ states: { "care-net": "active" } }));
    expect(n.entries).toEqual([]);
    expect(n.routes.length).toBeGreaterThan(0);
  });

  it("módulo con licencia propia: hace falta además la licencia de módulo", async () => {
    const hotel = BUILTIN_MODULES.find((m) => m.id === "hotel")!;
    const src = [source(hotel, { requiresModuleLicense: true })];
    expect((await resolvePanelNavigation(src, deps({ states: { "hotel-net": "active" } }))).entries).toEqual([]);
    expect((await resolvePanelNavigation(src, deps({ states: { "hotel-net": "active" }, modules: ["hotel"] }))).entries.map((e) => e.kind === "item" && e.item.href)).toEqual(["/admin/hotel"]);
    expect((await resolvePanelNavigation(src, deps({ modules: ["hotel"] }))).entries).toEqual([]);
  });

  it("fuentes del proceso: extensiones del Core y del SDK, sin repetir", () => {
    const ids = panelExtensionSources().map((s) => s.manifest.id);
    expect(ids).toEqual(expect.arrayContaining(["hotel", "spa", "restaurants", "people"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("fusión con el menú por tareas", () => {
  const entriesFor = (role = "admin") =>
    panelEntries("care", big, "care-net", { roleAllowed: (r) => r.includes(role), hasPermission: () => true, capabilitiesVisible: () => true });

  it("sección propia delante de «Organización», pestaña en una entrada existente y apartado en Ajustes", () => {
    const merged = mergeExtensions(TASK_NAV, entriesFor());
    const ids = merged.map((s) => s.id);
    expect(ids.indexOf("clinica")).toBe(ids.indexOf("organizacion") - 1);
    const clientes = merged.flatMap((s) => s.items).find((i) => i.key === "t-clientes")!;
    expect(clientes.children!.map((c) => c.href)).toEqual(["/admin/crm/clientes", "/admin/clinica/citas-cliente"]);
    const ajustes = merged.flatMap((s) => s.items).find((i) => i.key === "t-ajustes")!;
    expect(ajustes.children!.at(-1)!.href).toBe("/admin/clinica/ajustes");
    // No modifica el menú de partida
    expect(TASK_NAV.flatMap((s) => s.items).find((i) => i.key === "t-clientes")!.children).toBeUndefined();
  });

  it("entradas en «Módulos contratados» por su orden; claves repetidas o destinos desconocidos se descartan", () => {
    const people = CORE_EXTENSION_PANELS.people;
    const hotel = CORE_EXTENSION_PANELS.hotel;
    const f = { roleAllowed: () => true, hasPermission: () => true, capabilitiesVisible: () => true };
    const entries = [...panelEntries("hotel", hotel.panel, hotel.capability, f), ...panelEntries("people", people.panel, people.capability, f)];
    const contratados = mergeExtensions(TASK_NAV, [...entries, ...entries]).find((s) => s.id === "contratados")!.items.map((i) => i.key);
    expect(contratados[0]).toBe("x-people-personal");
    expect(contratados.filter((k) => k === "x-hotel-hotel")).toHaveLength(1);
    expect(contratados.indexOf("x-hotel-hotel")).toBeLessThan(contratados.indexOf("x-reav"));
    const orphan = mergeExtensions(TASK_NAV, [{ kind: "tab", moduleId: "z", parent: "no-existe", order: 1, leaf: { key: "x-z-a", label: "A", href: "/admin/z", capabilities: ["care-net"], roles: ["admin"] } }]);
    expect(JSON.stringify(orphan)).not.toContain("x-z-a");
  });

  it("resolveNav vuelve a filtrar por rol y licencia y marca solo lectura", () => {
    const states = { ...ESSENTIAL_STATES, "care-net": "read_only" as State };
    const resolved = resolveNav(TASK_NAV, ctx(states), entriesFor());
    const clinica = resolved.find((s) => s.id === "clinica")!;
    expect(clinica.items.every((i) => i.readOnly)).toBe(true);
    // Sin licencia, aunque llegaran entradas, no se pintan
    expect(resolveNav(TASK_NAV, ctx(ESSENTIAL_STATES), entriesFor()).find((s) => s.id === "clinica")).toBeUndefined();
    // Sin aportaciones, el menú es el de siempre
    expect(resolveNav(TASK_NAV, ctx(ESSENTIAL_STATES), [])).toEqual(resolveNav(TASK_NAV, ctx(ESSENTIAL_STATES)));
  });
});

describe("rutas y APIs de las extensiones", () => {
  it("guardián del panel: las rutas de extensiones del Core se bloquean sin licencia y se abren con ella", () => {
    for (const p of ["/admin/personal/nominas", "/admin/hotel", "/admin/spa", "/admin/restaurantes/reservas"]) {
      expect(routeAccess(p, () => null), p).toBe("not_included");
    }
    expect(routeCapabilities("/admin/spa")).toEqual(["care-net"]);
    expect(routeAccess("/admin/personal/empleados/7", (id) => (id === "people-hr" ? "active" : null))).toBe("allowed");
    expect(routeAccess("/admin/personal", (id) => (id === "people-hr" ? "read_only" : null))).toBe("read_only");
    expect(CORE_EXTENSION_ROUTES.length).toBeGreaterThan(0);
  });

  it("guardián del panel: rutas de extensiones externas que da el servidor (también subpáginas no listadas en el menú)", () => {
    const routes = [{ path: "/admin/clinica", capabilities: ["care-net"] }, { path: "/admin/clinica/informes", capabilities: ["care-net"] }];
    expect(routeAccess("/admin/clinica/informes/2026", () => null, routes)).toBe("not_included");
    expect(routeAccess("/admin/clinica/informes", (id) => (id === "care-net" ? "active" : null), routes)).toBe("allowed");
    // Sin la tabla del servidor, una ruta desconocida no depende de ninguna capacidad (el servidor sigue protegiendo los datos)
    expect(routeCapabilities("/admin/clinica")).toBeNull();
  });

  it("guardianes del servidor: los namespaces que declaran los manifiestos", () => {
    const sources = [...panelExtensionSources(), source(careManifest), source({ ...careManifest, id: "sede", capability: "ski-rental", panel: { ...big, api: ["porSede"] } }, { siteScoped: true })];
    const caps = extensionCapabilityRoutes(sources);
    expect(caps).toMatchObject({ hr: "people-hr", hotel: "hotel-net", spa: "care-net", restaurants: "restaurant-net", careClinic: "care-net" });
    expect(caps.porSede).toBeUndefined();
    expect(extensionModuleRoutes(sources)).toEqual({ hotel: "hotel", spa: "spa", restaurants: "restaurants" });
  });
});
