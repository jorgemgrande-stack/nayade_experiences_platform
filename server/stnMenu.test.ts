/**
 * Social Token Net — menú y activación funcional por licencia (registro declarativo de extensiones del panel).
 *
 *  - Sin licencias: nada. Solo Comunidades, solo Tokens internos o los dos (Complete): cada familia aparece sola, y las
 *    funciones conjuntas solo con las dos.
 *  - Suspensión de una capacidad: desaparecen sus entradas sin tocar las de la otra; el guardián de rutas del panel
 *    bloquea sus URL y el servidor sigue exigiendo la licencia en cada procedimiento.
 *  - «Gestionar» abre la pantalla real de cada producto (Complete, la portada de Social Token Net).
 */
import { describe, it, expect } from "vitest";
import { CORE_EXTENSION_PANELS, panelEntries, validatePanelContributions } from "../shared/panelExtensions";
import { panelTargets, routeAccess, TASK_NAV } from "../shared/adminNav";
import { primaryAction } from "../shared/connectShowcase";
import { CONNECT_EXTENSIONS } from "./_core/modules/builtin";
import { panelExtensionSources, resolvePanelNavigation } from "./_core/modules/panelNavigation";
import { openPathResolver } from "./connectShowcase";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { CAPABILITIES } from "./catalog/capabilities";

const COM = "social-token-net";
const TOK = "social-token-net-tokens";
type State = "active" | "read_only" | null;

const stn = panelExtensionSources().filter((s) => s.manifest.id === "social_token_net");
const nav = (states: Record<string, State>, role = "admin") =>
  resolvePanelNavigation(stn, {
    coreVersion: "1.0.0",
    role,
    capabilityState: (id) => states[id] ?? null,
    moduleAvailable: async () => false,
    hasPermission: async () => false,
  });
const keys = (n: Awaited<ReturnType<typeof nav>>) =>
  n.entries.flatMap((e) => (e.kind === "section" ? e.items.flatMap((i) => [i.key, ...(i.children ?? []).map((c) => c.key)]) : []));

const COMMUNITY_KEYS = [
  "x-social_token_net-comunidades",
  "x-social_token_net-comunidades-lista",
  "x-social_token_net-miembros",
  "x-social_token_net-publicaciones",
  "x-social_token_net-encuestas",
  "x-social_token_net-moderacion",
  "x-social_token_net-indicadores",
];
const TOKEN_KEYS = [
  "x-social_token_net-fidelizacion",
  "x-social_token_net-programa",
  "x-social_token_net-monederos",
  "x-social_token_net-reglas",
  "x-social_token_net-recompensas",
  "x-social_token_net-canjes",
];

describe("registro: Social Token Net se declara como extensión con sección propia", () => {
  it("manifiesto válido, sin capacidad única y fuera del menú fijo del Core", () => {
    const m = CONNECT_EXTENSIONS.find((x) => x.id === "social_token_net")!;
    expect(m.capability).toBeUndefined();
    expect(m.panel?.section).toMatchObject({ id: "social-token-net", label: "Social Token Net" });
    const known = new Set(CAPABILITIES.map((c) => c.id));
    expect(validatePanelContributions(m.id, m.panel!, { capability: null, isCapability: (id) => known.has(id), targets: panelTargets() })).toEqual([]);
    const hrefs = TASK_NAV.flatMap((s) => s.items.map((i) => i.href));
    for (const p of ["/admin/comunidades", "/admin/fidelizacion"]) expect(hrefs).not.toContain(p);
  });

  it("una entrada conjunta exige TODAS sus capacidades", () => {
    const panel = { items: [{ id: "x", label: "X", path: "/admin/x", capabilities: [TOK], allCapabilities: [COM, TOK] }] };
    const vis = (on: string[]) => panelEntries("m", panel, null, { roleAllowed: () => true, hasPermission: () => false, capabilitiesVisible: (c) => c.some((x) => on.includes(x)) });
    expect(vis([TOK])).toEqual([]);
    expect(vis([COM, TOK])).toHaveLength(1);
  });
});

describe("menú según las licencias de la empresa", () => {
  it("1. sin licencias de Social Token Net: ningún menú operativo", async () => {
    expect((await nav({})).entries).toEqual([]);
  });

  it("2. solo Comunidades: portada y sus herramientas", async () => {
    expect(keys(await nav({ [COM]: "active" }))).toEqual(["x-social_token_net-inicio", ...COMMUNITY_KEYS]);
  });

  it("3. solo Tokens internos: portada y sus herramientas", async () => {
    expect(keys(await nav({ [TOK]: "active" }))).toEqual(["x-social_token_net-inicio", ...TOKEN_KEYS]);
  });

  it("4. Complete (las dos): ambas familias y las funciones conjuntas", async () => {
    expect(keys(await nav({ [COM]: "active", [TOK]: "active" }))).toEqual(["x-social_token_net-inicio", ...COMMUNITY_KEYS, ...TOKEN_KEYS, "x-social_token_net-conjunto"]);
  });

  it("5 y 6. suspender Comunidades retira sus accesos sin tocar Tokens; al reactivarla vuelven", async () => {
    const suspended = keys(await nav({ [COM]: null, [TOK]: "active" }));
    expect(suspended).toEqual(["x-social_token_net-inicio", ...TOKEN_KEYS]);
    expect(keys(await nav({ [COM]: "active", [TOK]: "active" }))).toContain("x-social_token_net-miembros");
  });

  it("solo lectura sigue visible; el equipo (agente) ve fidelización pero no la gestión de comunidades", async () => {
    expect(keys(await nav({ [COM]: "read_only" }))).toContain("x-social_token_net-miembros");
    expect(keys(await nav({ [COM]: "active", [TOK]: "active" }, "agente"))).toEqual(["x-social_token_net-inicio", ...TOKEN_KEYS, "x-social_token_net-conjunto"]);
  });
});

describe("rutas: el panel y el servidor comprueban la licencia, no solo el menú", () => {
  const routes = CORE_EXTENSION_PANELS.socialTokenNet.panel;
  const state = (on: string[]) => (id: string): State => (on.includes(id) ? "active" : null);
  it("8. acceso directo por URL sin licencia: «No incluido en tu plan»", () => {
    expect(routes).toBeTruthy();
    expect(routeAccess("/admin/comunidades/apartado/miembros", state([TOK]))).toBe("not_included");
    expect(routeAccess("/admin/comunidades/3/reportes", state([TOK]))).toBe("not_included");
    expect(routeAccess("/admin/fidelizacion/recompensas", state([COM]))).toBe("not_included");
    expect(routeAccess("/admin/fidelizacion/recompensas", state([TOK]))).toBe("allowed");
    expect(routeAccess("/admin/social-token-net", state([COM]))).toBe("allowed");
    expect(routeAccess("/admin/social-token-net", state([]))).toBe("not_included");
  });
  it("el servidor exige la licencia en cada procedimiento", () => {
    expect(capabilityForProcedure("communities.admin.list")).toBe(COM);
    expect(capabilityForProcedure("loyalty.overview")).toBe(TOK);
    expect(capabilityForProcedure("socialNet.status")).toBe(TOK);
  });
});

describe("7. «Gestionar» abre la pantalla real", () => {
  const open = openPathResolver(panelExtensionSources().map((s) => ({ capability: s.capability, panel: s.manifest.panel ?? null })));
  it("Comunidades, Tokens internos y Complete", () => {
    expect(open([COM])).toBe("/admin/comunidades");
    expect(open([TOK])).toBe("/admin/fidelizacion");
    expect(open([COM, TOK])).toBe("/admin/social-token-net");
    expect(open(["people-hr"])).toBe("/admin/personal");
  });
  it("contratado con ruta propia → «Gestionar»", () => {
    const view = { canPurchase: true, interestEnabled: true };
    expect(primaryAction({ state: "active", kind: "module", purchasable: false, openPath: open([COM, TOK]) }, view)).toEqual({ kind: "open", label: "Gestionar", href: "/admin/social-token-net" });
  });
});
