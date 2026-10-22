/**
 * Módulos en el panel de la empresa: el catálogo publicado cruzado con SUS licencias.
 */
import { describe, it, expect } from "vitest";
import { panelModules, type PanelCatalogItemView } from "./panelModules";
import type { CapabilityGrant } from "./_core/capabilities/model";

const NOW = Date.UTC(2026, 9, 22, 10);
const item = (key: string, o: Partial<PanelCatalogItemView> = {}): PanelCatalogItemView => ({
  key,
  name: key,
  family: "connect",
  kind: "module",
  metric: null,
  step: null,
  commercialStatus: "available",
  capabilities: [`${key}-cap`],
  monthly: { amountCents: 1900, currency: "EUR", taxIncluded: false, unit: null },
  purchasable: true,
  ...o,
});
const grant = (capabilityId: string, o: Partial<CapabilityGrant> = {}): CapabilityGrant => ({ tenantId: "t1", capabilityId, siteId: "", status: "active", validUntil: null, source: "subscription:1", updatedAt: NOW, updatedBy: "test", ...o });

describe("módulos del panel", () => {
  it("lo contratado sale como incluido (o solo lectura) y nunca se ofrece comprarlo otra vez", () => {
    const out = panelModules(
      { purchasesEnabled: true, items: [item("people"), item("tax"), item("voice", { commercialStatus: "on_request", purchasable: false })] },
      [grant("people-cap"), grant("tax-cap", { status: "read_only" })],
      NOW,
    );
    expect(out.modules.map((m) => [m.key, m.state, m.purchasable])).toEqual([
      ["people", "active", false],
      ["tax", "read_only", false],
      ["voice", "on_request", false],
    ]);
  });

  it("lo no contratado muestra su estado comercial; una licencia caducada o suspendida no cuenta como incluida", () => {
    const out = panelModules(
      { purchasesEnabled: true, items: [item("people"), item("pos", { commercialStatus: "coming_soon", purchasable: false }), item("finance")] },
      [grant("people-cap", { status: "suspended" }), grant("finance-cap", { validUntil: NOW - 1000, source: "trial:3" })],
      NOW,
    );
    expect(out.modules.map((m) => [m.key, m.state, m.purchasable])).toEqual([
      ["people", "available", true],
      ["pos", "coming_soon", false],
      ["finance", "available", true],
    ]);
  });

  it("un módulo con varias capacidades solo está incluido si las tiene todas", () => {
    const out = panelModules({ purchasesEnabled: true, items: [item("pack", { capabilities: ["a", "b"] })] }, [grant("a")], NOW);
    expect(out.modules[0]).toMatchObject({ state: "available", purchasable: true });
  });

  it("las ampliaciones por unidades conservan su estado comercial aunque haya licencias", () => {
    const out = panelModules({ purchasesEnabled: false, items: [item("addon-user", { kind: "quantity", metric: "users", step: 1, capabilities: [], purchasable: false })] }, [grant("x")], NOW);
    expect(out).toEqual({ purchasesEnabled: false, modules: [expect.objectContaining({ key: "addon-user", state: "available", purchasable: false })] });
  });
});
