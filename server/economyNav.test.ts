/** Navegación de Economía (shared/economyNav.ts): grupos, visibilidad como el menú lateral y nombre único por pantalla. */
import { describe, expect, it } from "vitest";
import { ECONOMY_GROUPS, ECONOMY_SCREENS, groupScreens, subScreens, visibleEconomyScreens, type EconomyNavContext } from "../shared/economyNav";
import { LEGACY_SECTIONS, TASK_NAV } from "../shared/adminNav";
import es from "../shared/i18n/locales/es/economyShell";
import de from "../shared/i18n/locales/de/economyShell";

const all = (id: string): "active" | "read_only" | null => (id ? "active" : null);
const caps = (...ids: string[]) => (id: string) => (ids.includes(id) ? ("active" as const) : null);
const ctx = (o: Partial<EconomyNavContext>): EconomyNavContext => ({ role: "admin", mode: "tasks", capabilityState: all, ...o });
const ids = (c: EconomyNavContext) => visibleEconomyScreens(c).map((s) => s.id);

describe("estructura de Economía", () => {
  it("16 pantallas, cada una con su ruta de siempre y un grupo", () => {
    expect(ECONOMY_SCREENS).toHaveLength(16);
    expect(new Set(ECONOMY_SCREENS.map((s) => s.href)).size).toBe(16);
    for (const s of ECONOMY_SCREENS) {
      expect(s.href.startsWith("/admin/contabilidad/")).toBe(true);
      expect(ECONOMY_GROUPS).toContain(s.group);
    }
    expect(ECONOMY_GROUPS).toEqual(["today", "movements", "pos", "results"]);
  });
  it("agrupa como se aprobó: Hoy, Movimientos, TPV, Resultados", () => {
    const v = visibleEconomyScreens(ctx({}));
    expect(groupScreens("today", v).map((s) => s.id)).toEqual(["summary", "daily"]);
    expect(groupScreens("movements", v).map((s) => s.id)).toEqual(["transactions", "expenses", "cash", "bank"]);
    expect(groupScreens("pos", v).map((s) => s.id)).toEqual(["pos", "batches"]);
    expect(groupScreens("results", v).map((s) => s.id)).toEqual(["profitLoss", "reports", "general", "financeSync"]);
    expect(subScreens("expenses", v).map((s) => s.id)).toEqual(["expenses", "recurring", "suppliers", "categories", "costCenters"]);
  });
  it("«Conciliación TPV» ya no es una pantalla aparte (es la cabecera de Remesas) pero su ruta sigue respondiendo", async () => {
    const { readFileSync } = await import("node:fs");
    expect(ECONOMY_SCREENS.map((s) => s.id as string)).not.toContain("conciliation");
    const app = readFileSync("client/src/App.tsx", "utf8");
    expect(app).toContain('path="/admin/contabilidad/conciliacion-tpv"');
    const redirect = readFileSync("client/src/pages/admin/accounting/CardTerminalConciliationDashboard.tsx", "utf8");
    expect(redirect).toContain("/admin/contabilidad/remesas-tpv");
    expect(redirect).toContain("window.location.search");
  });
  it("las pantallas existen en el árbol de rutas del cliente", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("client/src/App.tsx", "utf8");
    for (const s of ECONOMY_SCREENS) expect(app).toContain(`path="${s.href}"`);
  });
});

describe("visibilidad = la del menú lateral", () => {
  it("con todas las capacidades, administración ve las 16", () => {
    expect(ids(ctx({}))).toHaveLength(16);
  });
  it("sin la capacidad de bancos y TPV no aparecen Bancos, TPV ni Finance Sync", () => {
    const v = ids(ctx({ capabilityState: caps("bill-reports", "purchasing-basic", "reports-advanced", "bill-cash", "accounting-general") }));
    for (const hidden of ["bank", "pos", "batches", "financeSync"]) expect(v).not.toContain(hidden);
    expect(v).toContain("summary");
    expect(v).toContain("general");
  });
  it("Gastos exige la capacidad del menú (compras), no solo la de informes", () => {
    const v = ids(ctx({ capabilityState: caps("bill-reports") }));
    expect(v).toContain("transactions");
    expect(v).not.toContain("expenses");
    expect(v).not.toContain("recurring");
    expect(v).not.toContain("costCenters");
    expect(ids(ctx({ capabilityState: caps("bill-reports", "reports-advanced") }))).toContain("costCenters");
  });
  it("una capacidad en solo lectura sigue mostrando la pantalla (como el menú)", () => {
    const ro = (id: string) => (id === "bill-reports" ? ("read_only" as const) : null);
    expect(ids(ctx({ capabilityState: ro }))).toContain("summary");
  });
  it("el menú de siempre (Náyade) muestra todo a administración", () => {
    expect(ids(ctx({ mode: "legacy", capabilityState: () => "active" }))).toHaveLength(16);
  });
  it("solo administración; el rol controler ve únicamente el Control diario", () => {
    expect(ids(ctx({ role: "controler", mode: "legacy" }))).toEqual(["daily"]);
    expect(ids(ctx({ role: "agente" }))).toEqual([]);
    expect(ids(ctx({ role: "readonly" }))).toEqual([]);
    expect(ids(ctx({ role: "user" }))).toEqual([]);
  });
});

describe("nombre único por pantalla", () => {
  const name = (id: string) => (es.screen as Record<string, string>)[id];
  it("el nombre de cada pantalla es el que muestra el menú lateral (por ruta)", () => {
    const labelsByHref = new Map<string, Set<string>>();
    const add = (href: string, label: string) => labelsByHref.set(href, (labelsByHref.get(href) ?? new Set()).add(label));
    for (const sec of [...TASK_NAV, ...LEGACY_SECTIONS]) for (const it of sec.items) { if (it.children) for (const ch of it.children) add(ch.href, ch.label); else add(it.href, it.label); }
    for (const s of ECONOMY_SCREENS) {
      const labels = labelsByHref.get(s.href);
      // Caja de contabilidad no tiene entrada en el menú por tareas: su nombre sale del menú de siempre
      expect(labels, s.href).toBeDefined();
      expect([...labels!], s.href).toContain(name(s.id));
    }
  });
  it("hay nombre en español y en alemán para todo", () => {
    for (const s of ECONOMY_SCREENS) {
      expect(name(s.id)).toBeTruthy();
      expect((de.screen as Record<string, string>)[s.id]).toBeTruthy();
    }
    expect(Object.keys(de.group)).toEqual(Object.keys(es.group));
  });
});
