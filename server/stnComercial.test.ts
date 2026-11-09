/**
 * Social Token Net — comercialización (STN-5, parte ordinaria): un paquete y sus componentes nunca se pagan a la vez.
 *
 *  - Cotizador (configurador, alta desde la prueba y compra de módulos): el paquete y un componente elegidos juntos
 *    cobran solo el paquete y avisan; un componente de un paquete ya contratado se rechaza; un componente ya contratado
 *    se marca como sustituido por el paquete.
 *  - Pedidos (alta desde la prueba, compra y CRM): un pedido con el paquete y un componente se rechaza ANTES de cobrar.
 *  - Marketplace: con Complete contratado los módulos salen «Incluido en …» sin compra; con un módulo contratado, la
 *    ficha de Complete explica que lo sustituye y cobra solo la diferencia prorrateada.
 *
 * Los productos siguen «Próximamente»: nada de esto cambia estados comerciales ni precios.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { quote, type QuoteCatalog } from "./catalog/quote";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { buildConnectCatalog } from "./connectMarketplace";
import type { CapabilityGrant } from "./_core/capabilities/model";
import type { PanelCatalogItemView } from "./panelModules";
import { contratacion } from "./contratacionFixture";
import { OrderError } from "./orchestrator/types";

const COM = "social-token-net-communities";
const TOK = "social-token-net-tokens";
const CPL = "social-token-net-complete";
const T0 = Date.UTC(2026, 10, 5, 10);

let catalog: QuoteCatalog;
/** Catálogo con los tres productos a la venta (solo en esta prueba: en el real siguen «Próximamente»). */
let forSale: QuoteCatalog;

beforeAll(async () => {
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => T0 });
  await seedElephantSource(web, webStore);
  catalog = quoteCatalogFromSite(await web.site("published"));
  forSale = { ...catalog, products: catalog.products.map((p) => ([COM, TOK, CPL].includes(p.key) ? { ...p, commercialStatus: "available" as const, technicalStatus: "available" } : p)) };
});

describe("catálogo: los productos siguen como estaban", () => {
  it("precios 39 €, 29 € y 59 € al mes, «Próximamente» y Complete = los dos módulos", () => {
    const byKey = new Map(catalog.products.map((p) => [p.key, p]));
    expect([COM, TOK, CPL].map((k) => byKey.get(k)!.prices.find((p) => p.kind === "monthly")!.amountCents)).toEqual([3900, 2900, 5900]);
    expect([COM, TOK, CPL].map((k) => byKey.get(k)!.commercialStatus)).toEqual(["coming_soon", "coming_soon", "coming_soon"]);
    expect(byKey.get(CPL)!.bundleOf).toEqual([COM, TOK]);
    expect(byKey.get(CPL)!.family).toBe("net_bundle");
  });
});

describe("cotizador: un paquete y sus componentes no se pagan a la vez", () => {
  it("Complete y un módulo elegidos juntos: solo se cobra Complete, con un aviso claro", () => {
    const r = quote(forSale, { plan: "essential", interval: "month", items: [{ key: CPL }, { key: COM }, { key: TOK }] });
    expect(r.ok).toBe(true);
    expect(r.lines.filter((l) => l.status === "charged" && l.key !== "essential").map((l) => [l.key, l.amountCents])).toEqual([[CPL, 5900]]);
    expect(r.lines.filter((l) => l.status === "included_in_bundle").map((l) => l.key).sort()).toEqual([COM, TOK]);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Comunidades» ya va incluido en «Social Token Net»: se quita de la selección/)]));
    expect(r.bundleSavings).toEqual([{ bundle: CPL, listCents: 6800, bundleCents: 5900, savingCents: 900 }]);
  });

  it("con Complete ya contratado, pedir un módulo suelto se rechaza (ya está incluido)", () => {
    const r = quote(forSale, { plan: "essential", interval: "month", owned: [CPL], items: [{ key: TOK }] });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.stringMatching(/Tokens internos» ya está incluido en «Social Token Net», que ya tienes contratado/)]);
  });

  it("con un módulo contratado, Complete lo sustituye (deja de cobrarse aparte)", () => {
    const r = quote(forSale, { plan: "essential", interval: "month", owned: [COM], items: [{ key: CPL }] });
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.key === CPL)!;
    expect(l.replaces).toEqual([COM]);
    expect(l.note).toMatch(/Sustituye a lo ya contratado: Social Token Net · Comunidades/);
  });

  it("tres modalidades: solo Comunidades, solo Tokens internos (sin Comunidades) o Complete", () => {
    const charged = (keys: string[]) => {
      const r = quote(forSale, { plan: "essential", interval: "month", items: keys.map((key) => ({ key })) });
      expect(r.errors).toEqual([]);
      return r.lines.filter((l) => l.status === "charged" && l.key !== "essential").map((l) => [l.key, l.amountCents]);
    };
    expect(charged([COM])).toEqual([[COM, 3900]]);
    expect(charged([TOK])).toEqual([[TOK, 2900]]);
    expect(charged([CPL])).toEqual([[CPL, 5900]]);
    expect(PRODUCTS.find((p) => p.key === TOK)!.draft.dependencies).toEqual([]);
  });

  it("Tokens internos explica la naturaleza de los puntos sin aviso genérico de revisión legal", () => {
    const req = PRODUCTS.find((p) => p.key === TOK)!.draft.requirements.join(" ");
    expect(req).toMatch(/Puntos internos de fidelización: se canjean solo por recompensas y beneficios dentro del programa/);
    expect(req).toMatch(/No son criptomonedas, dinero electrónico, activos de inversión ni medio de pago/);
    expect(req).not.toMatch(/revisión legal/i);
  });

  it("los dos módulos sueltos (68 €) sugieren Complete (59 €)", () => {
    const r = quote(forSale, { plan: "essential", interval: "month", items: [{ key: COM }, { key: TOK }] });
    expect(r.ok).toBe(true);
    expect(r.suggestions).toEqual([expect.objectContaining({ bundle: CPL, savingCents: 900 })]);
  });
});

describe("pedidos: el paquete y un componente juntos se rechazan antes de cobrar", () => {
  it("compra o alta con Complete y un módulo: pedido rechazado con el motivo, sin cobro ni licencias", async () => {
    const c = await contratacion();
    const base = await c.baseOrder("STN Doble SL");
    const before = await c.caps.list(base.tenantId!);
    let err: unknown = null;
    let order = null as Awaited<ReturnType<typeof c.changeWith>>["order"] | null;
    try {
      order = (await c.changeWith(base, [CPL, COM])).order;
    } catch (e) {
      err = e;
    }
    const message = err instanceof OrderError ? err.message : (order?.lastError ?? "");
    expect(message).toMatch(/Comunidades» ya va incluido en «Social Token Net».*Elige el paquete o sus módulos, no los dos/);
    if (order) expect(["requested", "rejected"]).toContain(order.state);
    expect(await c.orders.payments(order?.id ?? -1).catch(() => [])).toEqual([]);
    expect(await c.caps.list(base.tenantId!)).toEqual(before);
  });
});

describe("marketplace: incluido en Complete y sustitución de módulos", () => {
  const item = (key: string, o: Partial<PanelCatalogItemView> & { activation?: unknown } = {}) => ({
    key,
    name: PRODUCTS.find((p) => p.key === key)!.draft.name,
    family: key === CPL ? "net_bundle" : "net_module",
    kind: "module" as const,
    metric: null,
    step: null,
    commercialStatus: "available" as const,
    capabilities: key === COM ? ["social-token-net"] : key === TOK ? ["social-token-net-tokens"] : [],
    monthly: { amountCents: key === COM ? 3900 : key === TOK ? 2900 : 5900, currency: "EUR", taxIncluded: false, unit: null },
    purchasable: true,
    ...o,
  });
  const active = { state: "active", payment: "confirmed", error: null, retryable: false, nextRetryAt: null, activeUntil: null, renewal: "active", canReactivate: false, updatedAt: T0 };
  const grant = (capabilityId: string): CapabilityGrant => ({ tenantId: "t1", capabilityId, siteId: "", status: "active", validUntil: null, source: "subscription:1", updatedAt: T0, updatedBy: "test" });
  const both = [grant("social-token-net"), grant("social-token-net-tokens")];

  it("con Social Token Net contratado, los antiguos módulos no aparecen como productos y el producto sale contratado", () => {
    const out = buildConnectCatalog({ items: [item(COM), item(TOK), item(CPL, { activation: active })] }, both, T0, "essential");
    expect(out.map((i) => i.key)).toEqual([CPL]);
    expect(out[0]).toMatchObject({ name: "Social Token Net", state: "active", purchasable: false, replaces: [], includedIn: null });
  });

  it("con Comunidades contratado, Complete se puede contratar y explica que lo sustituye con la diferencia prorrateada", () => {
    const out = buildConnectCatalog({ items: [item(COM, { activation: active }), item(TOK), item(CPL, { activation: { ...active, state: "none", payment: null } })] }, [grant("social-token-net")], T0, "essential");
    const cpl = out.find((i) => i.key === CPL)!;
    expect(cpl).toMatchObject({ state: "available", purchasable: true, replaces: [{ key: COM, name: "Social Token Net · Comunidades" }] });
    expect(cpl.reasons.join(" ")).toMatch(/Sustituye a Social Token Net · Comunidades.*solo se cobra la diferencia prorrateada.*Tus datos se conservan/);
    // 09/11/2026: el módulo heredado contratado se ve (en «Mis módulos»), marcado como heredado y sin compra; el no
    // contratado, no
    expect(out.find((i) => i.key === COM)).toMatchObject({ purchasable: false, legacy: { replacedBy: { key: CPL, name: "Social Token Net" } } });
    expect(out.find((i) => i.key === TOK)).toBeUndefined();
  });

  it("con los dos módulos sueltos (contrato anterior), equivale al producto: contratado, sin nueva compra ni cambio de condiciones", () => {
    const out = buildConnectCatalog({ items: [item(COM, { activation: active }), item(TOK, { activation: active }), item(CPL, { activation: { ...active, state: "none", payment: null } })] }, both, T0, "essential");
    const cpl = out.find((i) => i.key === CPL)!;
    expect([cpl.state, cpl.purchasable]).toEqual(["active", false]);
    expect(cpl.replaces.map((r) => r.key)).toEqual([COM, TOK]);
    expect(cpl.net!.legacyContracted.map((r) => r.key)).toEqual([COM, TOK]);
    expect(cpl.reasons.join(" ")).toMatch(/Ya tienes las funciones de Social Token Net con tu contratación anterior \(Social Token Net · Comunidades, Social Token Net · Tokens internos\)/);
  });

  it("«Próximamente» sigue mandando: con un módulo contratado, Complete no se vende todavía", () => {
    const out = buildConnectCatalog({ items: [item(COM, { activation: active }), item(CPL, { commercialStatus: "coming_soon", purchasable: false, activation: { ...active, state: "none" } })] }, [grant("social-token-net")], T0, "essential");
    expect(out.find((i) => i.key === CPL)).toMatchObject({ state: "coming_soon", purchasable: false });
  });
});
