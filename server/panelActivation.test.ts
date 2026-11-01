/**
 * Estado de activación por producto en el catálogo del panel (solo lectura): sale de los pedidos de la empresa y la
 * licencia solo cuenta cuando el pedido queda vigente. Nunca se mezcla con pedidos de otra empresa. Datos sintéticos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { activationFromOrders, ERROR_WINDOW_MS } from "./commerce/panelActivation";
import { panelCatalog } from "./commerce/panelCatalog";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import type { CommercialOrder, OrderState } from "./orchestrator/types";

const NOW = Date.UTC(2026, 10, 1, 12);
const T = "t9-demo";
let seq = 0;
const order = (state: OrderState, keys: string[], o: Partial<CommercialOrder> = {}) =>
  ({ id: ++seq, state, tenantId: T, companyId: 1, request: { items: keys.map((key) => ({ key })) }, createdAt: NOW - 3600_000, updatedAt: NOW - 60_000, ...o }) as unknown as CommercialOrder;

describe("estado de activación a partir de los pedidos", () => {
  it("lo del pedido vigente está activo; una compra posterior en curso queda pendiente o procesando", () => {
    seq = 0;
    const m = activationFromOrders([order("active", ["core-essential", "connect-tax"]), order("quoted", ["core-essential", "connect-tax", "connect-people"]), order("licensed", ["core-essential", "connect-crm"])], T, NOW);
    expect(m.get("connect-tax")).toMatchObject({ state: "active", retryable: false });
    expect(m.get("connect-people")).toMatchObject({ state: "pending" });
    expect(m.get("connect-crm")).toMatchObject({ state: "processing" });
    expect(m.has("connect-voice")).toBe(false);
  });

  it("una compra rechazada reciente es un error recuperable; pasada la ventana, desaparece", () => {
    seq = 0;
    const m = activationFromOrders([order("active", ["core-essential"]), order("rejected", ["core-essential", "connect-people"])], T, NOW);
    expect(m.get("connect-people")).toMatchObject({ state: "error", retryable: true });
    expect(m.get("core-essential")).toMatchObject({ state: "active" });
    const old = activationFromOrders([order("active", ["core-essential"]), order("rejected", ["connect-people"], { updatedAt: NOW - ERROR_WINDOW_MS - 1 })], T, NOW);
    expect(old.has("connect-people")).toBe(false);
  });

  it("un reintento posterior sustituye al error; lo anterior al pedido vigente no cuenta", () => {
    seq = 0;
    const m = activationFromOrders([order("rejected", ["connect-crm"]), order("active", ["core-essential"]), order("rejected", ["connect-people"]), order("contracted", ["connect-people"])], T, NOW);
    expect(m.get("connect-people")).toMatchObject({ state: "pending", retryable: false });
    expect(m.has("connect-crm")).toBe(false);
  });

  it("pedidos de otro tenant no cuentan; sin pedido vigente nada está activo", () => {
    seq = 0;
    const m = activationFromOrders([order("active", ["connect-tax"], { tenantId: "otra-empresa" }), order("cancelled", ["connect-crm"])], T, NOW);
    expect(m.size).toBe(0);
  });
});

describe("activación en el catálogo del panel", () => {
  let site: SiteDocument;
  beforeAll(async () => {
    const store = new MemoryWebStore();
    const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
    await seedElephantSource(web, store);
    site = await web.site("published");
  });

  it("cada producto lleva su estado; sin dato es «none»; si no se pudo consultar, null; nunca cambia lo comprable", () => {
    const products = quoteCatalogFromSite(site).products;
    const act = new Map([["connect-people", { state: "pending" as const, retryable: false, updatedAt: NOW }]]);
    const cat = panelCatalog(products, { version: "v", purchasesEnabled: false, site, activation: act });
    expect(cat.items.find((i) => i.key === "connect-people")!.activation).toEqual({ state: "pending", retryable: false, updatedAt: NOW });
    expect(cat.items.find((i) => i.key === "connect-tax")!.activation).toEqual({ state: "none", retryable: false, updatedAt: null });
    expect(cat.items.every((i) => i.purchasable === false)).toBe(true);
    expect(panelCatalog(products, { version: "v", purchasesEnabled: false, site, activation: null }).items.every((i) => i.activation === null)).toBe(true);
  });
});
