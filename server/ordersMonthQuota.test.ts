/**
 * Cupo de pedidos al mes: se mide y se avisa en «Consumo» (80 % y superado), nunca se bloquea. Solo en multiempresa
 * con plan conocido; sin plan, en instalación única o si medir falla, no aparece (y nunca rompe la página).
 */
import { describe, it, expect, afterEach } from "vitest";
import { ordersMonthRow, withOrdersMonth, currentOrdersMonthUsage } from "./ordersMonthQuota";
import { policyOf } from "./_core/erm/policy";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { configureQuotaExceptions } from "./_core/erm/exceptionAccess";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { runWithTenant } from "./_core/tenant";
import { assertBusinessQuota } from "./businessQuotas";
import type { PanelUsage } from "./commerce/panelUsage";

const actor = "operator:pruebas";

describe("política de pedidos al mes", () => {
  it("es blanda: se avisa, no se bloquea", () => {
    expect(policyOf("orders_month")).toMatchObject({ enforcement: "soft", period: "total" });
  });

  it("fila de consumo: ok, aviso al 80 % y superado sin cortar", () => {
    expect(ordersMonthRow(null, 10)).toBeNull();
    expect(ordersMonthRow({ limit: null }, 10)).toBeNull();
    expect(ordersMonthRow({ limit: 5_000 }, 100)).toMatchObject({ metric: "orders_month", label: "Pedidos", period: "month", periodLabel: "este mes", used: 100, limit: 5_000, state: "ok", enforcement: "soft" });
    expect(ordersMonthRow({ limit: 5_000 }, 4_000)?.state).toBe("warning");
    expect(ordersMonthRow({ limit: 5_000 }, 5_000)?.state).toBe("exceeded");
    expect(ordersMonthRow({ limit: 5_000 }, 7_000)).toMatchObject({ state: "exceeded", ratio: 1.4 });
  });

  it("se añade al consumo del Resource Manager sin duplicarse", () => {
    const base: PanelUsage = { available: false, rows: [], warningRatio: 0.8, lagSeconds: 15 };
    expect(withOrdersMonth(base, null)).toBe(base);
    const row = ordersMonthRow({ limit: 500 }, 450)!;
    const out = withOrdersMonth(withOrdersMonth(base, row), row);
    expect(out.available).toBe(true);
    expect(out.rows).toEqual([row]);
  });
});

describe("consumo de pedidos de la empresa en curso", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    configureQuotaExceptions(null);
    _resetCapabilityAccessForTests();
  });
  const licence = async (tenantId: string, tiers: Array<"essential" | "business">) => {
    const caps = new MemoryCapabilityStore();
    const ids = tiers.flatMap((t) => capabilitiesOfTier(t));
    await caps.apply(tenantId, ids.map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" })), { actor, reason: "Alta", now: 1 });
    configureCapabilityAccess(caps, { enforce: true, ttlMs: 0 });
  };

  it("Business: límite de 5.000 y aviso al superarlo; Essential: 500", async () => {
    process.env.TENANT_MODE = "multi";
    await licence("t-biz", ["essential", "business"]);
    const biz = await runWithTenant("t-biz", () => currentOrdersMonthUsage(async () => 6_000));
    expect(biz).toMatchObject({ limit: 5_000, used: 6_000, state: "exceeded", enforcement: "soft" });
    await licence("t-ess", ["essential"]);
    expect(await runWithTenant("t-ess", () => currentOrdersMonthUsage(async () => 420))).toMatchObject({ limit: 500, state: "warning" });
  });

  it("nunca bloquea un pedido aunque se supere el cupo", async () => {
    process.env.TENANT_MODE = "multi";
    await licence("t-biz", ["essential", "business"]);
    await expect(runWithTenant("t-biz", () => assertBusinessQuota("orders_month", async () => 1e9))).resolves.toBeUndefined();
  });

  it("sin plan, en instalación única o si medir falla: no aparece y no lanza", async () => {
    process.env.TENANT_MODE = "multi";
    await licence("t-biz", ["essential", "business"]);
    expect(await runWithTenant("t-sin-plan", () => currentOrdersMonthUsage(async () => 10))).toBeNull();
    expect(await runWithTenant("t-biz", () => currentOrdersMonthUsage(async () => Promise.reject(new Error("bd caída"))))).toBeNull();
    process.env.TENANT_MODE = "single";
    expect(await runWithTenant("t-biz", () => currentOrdersMonthUsage(async () => 10))).toBeNull();
  });
});
