/**
 * Foto de integridad comercial (solo lectura): misma huella con los mismos datos, otra si cambia un importe o un
 * estado, recuentos por estado, «ausente» si falta una tabla y nunca escribe (solo SELECT).
 */
import { describe, it, expect } from "vitest";
import type { Pool } from "mysql2/promise";
import { commercialIntegrity } from "./catalog/commercial/integrity";

function fakePool(tables: Record<string, Array<Record<string, unknown>>>, queries: string[] = []) {
  return {
    query: async (sql: string) => {
      queries.push(sql);
      const t = /FROM `([a-z_]+)`/.exec(sql)?.[1] ?? "";
      if (!(t in tables)) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
      return [tables[t]];
    },
  } as unknown as Pool;
}

const crm = () => ({
  subscriptions: [{ id: 1, status: "active", billing_interval: "month", pending_interval: null, current_period_end: 1, cancel_at: null, version: 3 }],
  subscription_items: [{ id: 1, subscription_id: 1, product_key: "business", price_id: 7, price_source: "catalog", price_kind: "monthly", unit_amount_cents: 7900, quantity: 1, discount_kind: null, discount_value: null, effective_from: 1, effective_to: null }],
  commercial_orders: [{ id: 1, kind: "new", state: "active", subscription_id: 1, version: 5 }],
  commercial_payments: [{ id: 1, order_id: 1, purpose: "initial", amount_cents: 9559, status: "succeeded" }],
});

describe("integridad comercial", () => {
  it("huellas estables, sensibles a importes y estados, y solo lectura", async () => {
    const q: string[] = [];
    const reg = fakePool({ tenant_entitlements: [{ tenant_id: "a", module_id: "crm", status: "active", valid_until: null }] }, q);
    const a = await commercialIntegrity(fakePool(crm(), q), reg);
    const b = await commercialIntegrity(fakePool(crm(), q), reg);
    expect(a).toEqual(b);
    expect(a.stripe_subscriptions).toBe("ausente");
    expect(a.subscriptions).toMatchObject({ filas: 1, porEstado: { active: 1 } });
    const changed = crm();
    changed.subscription_items[0].unit_amount_cents = 6900;
    const c = await commercialIntegrity(fakePool(changed, q), reg);
    expect((c.subscription_items as { huella: string }).huella).not.toBe((a.subscription_items as { huella: string }).huella);
    expect(c.subscriptions).toEqual(a.subscriptions);
    expect(q.every((s) => /^SELECT /.test(s))).toBe(true);
  });
});
