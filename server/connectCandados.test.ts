/**
 * Candados de Elephant Connect en los lugares de trabajo (v2.0.0): sin licencia aparece el candado con el nombre,
 * el lema y el estado real del catálogo (igual que la ficha) y enlaza a /admin/ampliar/:clave; con la licencia
 * activa desaparece; sin catálogo (single, sin canal) no se muestra nada. Y cada lugar de trabajo lo coloca.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CAPABILITY_IDS } from "./catalog/capabilities";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { CONNECT_STATE_LABELS, deriveConnectState, type ConnectState } from "../shared/connectMarketplace";

(globalThis as { React?: unknown }).React = React;

const catalog = vi.hoisted(() => ({ items: [] as unknown[], isLoading: false }));
vi.mock("../client/src/components/connect/useConnect", () => ({ useConnectCatalog: () => catalog }));

import { WORKPLACE_LOCKS, WorkplaceLocks, workplaceLockItems } from "../client/src/components/connect/WorkplaceLocks";

type Item = { key: string; name: string; tagline: string; family: string; kind: "module"; capabilities: string[]; state: ConnectState };

/** El catálogo oficial con el estado que daría la ficha a una empresa sin licencias (o con `active` concedidas). */
function catalogItems(active: string[] = []): Item[] {
  return PRODUCTS.filter((p) => ["connect", "connect_bundle", "extra"].includes(p.family) && (p.draft.catalog.capabilities ?? []).length > 0).map((p) => {
    const capabilities = p.draft.catalog.capabilities ?? [];
    const { state } = deriveConnectState(
      { kind: "module", commercialStatus: p.draft.catalog.commercialStatus as never, capabilities, dependencies: [], plans: [] },
      { capabilityStatus: (c) => (active.includes(c) ? "active" : null), plan: "essential", productActive: () => false },
    );
    return { key: p.key, name: p.draft.name, tagline: p.draft.tagline ?? "", family: p.family, kind: "module", capabilities, state };
  });
}

const render = (place: keyof typeof WORKPLACE_LOCKS) =>
  renderToStaticMarkup(React.createElement(Router, { ssrPath: "/admin/crm" }, React.createElement(WorkplaceLocks, { place })));

beforeEach(() => {
  catalog.items = [];
  catalog.isLoading = false;
});

describe("candados de Elephant Connect en los lugares de trabajo", () => {
  it("solo usan capacidades reales del catálogo, cada una con su producto de Elephant Connect", () => {
    const items = catalogItems();
    for (const [place, caps] of Object.entries(WORKPLACE_LOCKS)) {
      for (const c of caps) {
        expect(CAPABILITY_IDS, `${place}: ${c}`).toContain(c);
        expect(workplaceLockItems(items, [c]).length, `${place}: ${c} sin producto`).toBe(1);
      }
    }
  });

  it("sin licencia: candado con nombre, estado real y lema del catálogo, que abre la ficha", () => {
    catalog.items = catalogItems();
    const html = render("crm");
    for (const key of ["connect-automations", "connect-whatsapp-ai", "connect-copilot"]) {
      const item = (catalog.items as Item[]).find((i) => i.key === key)!;
      expect(html).toContain(`href="/admin/ampliar/${key}"`);
      expect(html).toContain(item.name);
      expect(html).toContain(`${CONNECT_STATE_LABELS[item.state]} · ${item.tagline}`);
    }
    // Estados honestos del catálogo: nada «Disponible para contratar» que no lo esté
    expect(html).toContain("Próximamente");
    expect(html).not.toContain("Disponible para contratar");

    const comms = render("comms");
    expect(comms).toContain("/admin/ampliar/connect-voice");
    expect(comms).toContain("Bajo solicitud");
    expect(comms).toContain("/admin/ampliar/connect-reception-ai");

    const admin = render("admin");
    for (const key of ["connect-people", "connect-finance-sync", "connect-tax"]) expect(admin).toContain(`/admin/ampliar/${key}`);
  });

  it("con la licencia activa el candado desaparece", () => {
    catalog.items = catalogItems(["people-hr", "bank-import-pos", "bank-reconciliation"]);
    const admin = render("admin");
    expect(admin).not.toContain("connect-people");
    expect(admin).not.toContain("connect-finance-sync");
    expect(admin).toContain("connect-tax");

    catalog.items = catalogItems(["people-hr", "bank-import-pos", "bank-reconciliation", "tax-filings"]);
    expect(render("admin")).toBe("");
  });

  it("sin catálogo (una sola empresa o sin canal) o cargando: no muestra nada", () => {
    expect(render("crm")).toBe("");
    catalog.items = catalogItems();
    catalog.isLoading = true;
    expect(render("crm")).toBe("");
  });

  it("los lugares de trabajo colocan su candado", () => {
    const root = path.resolve(__dirname, "../client/src/pages/admin");
    const uses: Array<[string, string]> = [
      ["crm/CRMDashboard.tsx", "crm"],
      ["commercial/CommercialFollowupDashboard.tsx", "crm"],
      ["EmailTemplatesManager.tsx", "comms"],
      ["users/UsersManager.tsx", "admin"],
      ["settings/ConfigPanel.tsx", "admin"],
    ];
    for (const [file, place] of uses) expect(fs.readFileSync(path.join(root, file), "utf8"), file).toContain(`<WorkplaceLocks place="${place}"`);
  });
});
