/**
 * Panel operativo del Inicio con una BD simulada en memoria (server/operationalPanelDb.ts):
 *  - sin las tablas de convocatorias/servicios (migraciones ausentes) no falla: secciones vacías y tarjeta oculta;
 *  - cada parte solo se lee con su capacidad contratada;
 *  - la consulta de presupuestos excluye los cobrados (estado o fecha de pago) y los muertos;
 *  - otro error de BD no se esconde.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const dialect = new MySqlDialect();
const state = {
  caps: new Set<string>(),
  missing: false,
  boom: false,
  sqls: [] as string[],
};
const missing = () => Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" });

vi.mock("./_core/capabilities/access", () => ({ getCapabilityAccess: () => ({ check: async (cap: string) => ({ allowed: state.caps.has(cap) }) }) }));
vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: any) => {
      const { sql: s } = dialect.sqlToQuery(q);
      state.sqls.push(s);
      if (state.boom) throw Object.assign(new Error("conexión perdida"), { code: "PROTOCOL_CONNECTION_LOST" });
      if (state.missing && /product_editions|edition_enrollments|enrollment_services|edition_sessions/.test(s)) throw missing();
      if (/COUNT\(\*\) AS n FROM leads/.test(s)) return [[{ n: 1 }]];
      if (/FROM leads WHERE/.test(s)) return [[{ id: 1, name: "Ana", email: "ana@ejemplo.example", source: "web_solicitud_plaza", selectedProduct: "Paquete", variant_label: "4 sesiones", request_lang: "de", is_test: 0, createdAt: new Date(0) }]];
      return [[]];
    },
  }),
}));

beforeEach(() => {
  state.caps = new Set(["crm-leads", "shop-catalog", "crm-quotes"]);
  state.missing = false;
  state.boom = false;
  state.sqls = [];
});

describe("lecturas del panel operativo", () => {
  it("sin las migraciones de convocatorias: secciones vacías, solicitudes web sí", async () => {
    state.missing = true;
    const { operationalPanel } = await import("./operationalPanelDb");
    const p = await operationalPanel(Date.UTC(2036, 10, 18));
    expect(p.webRequests.total).toBe(1);
    expect(p.webRequests.items[0]).toMatchObject({ name: "Ana", lang: "de", variant: "4 sesiones", href: "/admin/crm?tab=leads&search=ana%40ejemplo.example" });
    for (const k of ["pendingEnrollments", "unpaidQuotes", "upcomingEditions", "upcomingSessions", "pendingServices"] as const) expect(p[k]).toEqual({ total: 0, items: [] });
    expect(p.visible).toBe(true);
  });

  it("sin licencia de CRM ni de catálogo no se lee nada y la tarjeta no se enseña", async () => {
    state.caps = new Set();
    const { operationalPanel } = await import("./operationalPanelDb");
    const p = await operationalPanel();
    expect(p.visible).toBe(false);
    expect(state.sqls).toEqual([]);
  });

  it("sin licencia de presupuestos no se consultan presupuestos", async () => {
    state.caps.delete("crm-quotes");
    const { operationalPanel } = await import("./operationalPanelDb");
    await operationalPanel();
    expect(state.sqls.some((s) => /JOIN quotes/.test(s))).toBe(false);
    expect(state.sqls.some((s) => /FROM edition_enrollments/.test(s))).toBe(true);
  });

  it("presupuestos sin cobrar: excluye los pagados (estado o fecha de pago), los muertos y las inscripciones canceladas", async () => {
    const { operationalPanel } = await import("./operationalPanelDb");
    await operationalPanel();
    const q = state.sqls.find((s) => /JOIN quotes/.test(s) && /SELECT en\.id/.test(s))!;
    expect(q).toMatch(/q\.paidAt IS NULL/);
    expect(q).toMatch(/q\.status NOT IN \(\?, \?, \?, \?, \?, \?\)/);
    expect(q).toMatch(/en\.status <> 'cancelada'/);
    expect(q).toMatch(/LIMIT \?/);
  });

  it("otro error de la BD no se esconde", async () => {
    state.boom = true;
    const { operationalPanel } = await import("./operationalPanelDb");
    await expect(operationalPanel()).rejects.toThrow(/conexión perdida/);
  });
});
