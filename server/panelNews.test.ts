/**
 * «Nuevo» en el menú para las extensiones recién activadas (shared/panelNews.ts) y la fecha de activación que da el
 * servidor en `panel.navigation`: reutilizable por cualquier extensión (Social Token Net, People, Hotel…).
 */
import { describe, it, expect } from "vitest";
import { discoveredAt, extensionBlocks, isNewExtension, NEW_EXTENSION_DAYS } from "../shared/panelNews";
import { resolveNav, TASK_NAV, type NavContext } from "../shared/adminNav";
import { panelExtensionSources, resolvePanelNavigation } from "./_core/modules/panelNavigation";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 12);
const COM = "social-token-net";
const TOK = "social-token-net-tokens";

const navFor = (states: Record<string, "active" | null>, since: Record<string, number>) =>
  resolvePanelNavigation(panelExtensionSources(), {
    coreVersion: "1.0.0",
    role: "admin",
    capabilityState: (id) => states[id] ?? null,
    capabilitySince: (id) => since[id] ?? null,
    moduleAvailable: async () => false,
    hasPermission: async () => false,
  });

describe("fecha de activación de cada extensión", () => {
  it("la sección toma la activación más reciente de sus licencias visibles", async () => {
    const n = await navFor({ [COM]: "active", [TOK]: "active", "people-hr": "active" }, { [COM]: NOW - 30 * DAY, [TOK]: NOW - DAY, "people-hr": NOW - 2 * DAY });
    const stn = n.entries.find((e) => e.moduleId === "social_token_net");
    expect(stn).toMatchObject({ kind: "section", since: NOW - DAY });
    expect(n.entries.find((e) => e.moduleId === "people")).toMatchObject({ kind: "item", since: NOW - 2 * DAY });
    // Una licencia suspendida no cuenta
    const solo = await navFor({ [COM]: "active" }, { [COM]: NOW - 30 * DAY, [TOK]: NOW - DAY });
    expect(solo.entries.find((e) => e.moduleId === "social_token_net")?.since).toBe(NOW - 30 * DAY);
  });
});

describe("«Nuevo»: recién activada y sin descubrir", () => {
  const ext = (since: number | null) => ({ moduleId: "social_token_net", since });
  it(`dura ${NEW_EXTENSION_DAYS} días y desaparece al descubrirla`, () => {
    expect(isNewExtension(ext(NOW - DAY), new Set(), NOW)).toBe(true);
    expect(isNewExtension(ext(NOW - (NEW_EXTENSION_DAYS + 1) * DAY), new Set(), NOW)).toBe(false);
    expect(isNewExtension(ext(NOW - DAY), new Set(["social_token_net"]), NOW)).toBe(false);
    expect(isNewExtension(ext(null), new Set(), NOW)).toBe(false);
    expect(isNewExtension(undefined, new Set(), NOW)).toBe(false);
  });

  it("el menú sabe qué secciones y entradas son de extensiones; el Core no se marca", async () => {
    const n = await navFor({ [COM]: "active", [TOK]: "active", "people-hr": "active" }, { [COM]: NOW - DAY, "people-hr": NOW - DAY });
    const ctx: NavContext = { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: () => "active" };
    const sections = resolveNav(TASK_NAV, ctx, n.entries);
    const stn = sections.find((s) => s.id === "social-token-net")!;
    expect(stn.extension).toEqual({ moduleId: "social_token_net", since: NOW - DAY });
    const people = sections.flatMap((s) => s.items).find((i) => i.href === "/admin/personal")!;
    expect(people.extension?.moduleId).toBe("people");
    expect(sections.filter((s) => s.id !== "social-token-net").every((s) => !s.extension)).toBe(true);
    expect(sections.flatMap((s) => s.items).filter((i) => i.extension).map((i) => i.href)).toEqual(["/admin/personal"]);

    // Descubrir: entrar en cualquiera de sus pantallas
    const blocks = extensionBlocks(sections);
    expect(discoveredAt("/admin/comunidades/1/reportes", blocks)).toEqual(["social_token_net"]);
    expect(discoveredAt("/admin/fidelizacion/recompensas", blocks)).toEqual(["social_token_net"]);
    expect(discoveredAt("/admin/personal/fichajes", blocks)).toEqual(["people"]);
    expect(discoveredAt("/admin/crm", blocks)).toEqual([]);
    expect(discoveredAt("/admin/comunidadesx", blocks)).toEqual([]);
  });
});
