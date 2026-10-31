/**
 * Elephant Connect de punta a punta en el Core, con un doble del plano de control (compra idempotente por clave,
 * cobro pendiente y licencias aplicadas por el «webhook») y las licencias reales en memoria:
 *
 *   contratar → pedido en espera → licencia concedida → purchaseStatus = applied → el catálogo y el menú la muestran
 *   sin cerrar sesión; repetir con la misma clave no duplica; suspender → desaparece del menú y queda «con incidencia».
 *
 * Además: solo la administración compra, cada empresa ve SOLO sus licencias y sus pedidos, y el estado prudente
 * cuando el canal con el plano de control no está.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { CommerceClient } from "./commerceClient";

const fake = vi.hoisted(() => {
  const orders = new Map<string, { orderId: number; tenantId: string; status: string; add: string[] }>();
  const state = { created: 0, nextId: 100, failNext: false, channel: true };
  return { orders, state };
});

vi.mock("./commerceClient", async (orig) => {
  const real = await orig<typeof import("./commerceClient")>();
  const catalog = {
    purchasesEnabled: true,
    items: [
      { key: "connect-people", name: "Connect People", family: "connect", kind: "module", metric: null, step: null, commercialStatus: "available", capabilities: ["people-hr"], monthly: { amountCents: 1900, currency: "EUR", taxIncluded: false, unit: null }, purchasable: true },
      { key: "connect-voice", name: "Connect Voice", family: "connect", kind: "module", metric: null, step: null, commercialStatus: "on_request", capabilities: ["voice-ai"], monthly: { amountCents: 3900, currency: "EUR", taxIncluded: false, unit: null }, purchasable: false },
    ],
  };
  const client: Partial<CommerceClient> = {
    catalog: async () => catalog,
    preview: async () => ({ currency: "EUR", amountDueCents: 950, taxCents: null, lines: [], recurringDeltaCents: 1900, interval: "month" }),
    purchase: async (tenantId, input, o) => {
      if (fake.state.failNext) {
        fake.state.failNext = false;
        throw new real.CommerceError(503, "unreachable", "El servicio de compras no responde.");
      }
      const k = `${tenantId}:${o.idempotencyKey}`;
      let ord = fake.orders.get(k);
      if (!ord) {
        fake.state.created++;
        ord = { orderId: fake.state.nextId++, tenantId, status: "payment_pending", add: input.add ?? [] };
        fake.orders.set(k, ord);
      }
      return { status: ord.status, orderId: ord.orderId, paymentUrl: ord.status === "payment_pending" ? "https://invoice.stripe.com/i/prueba" : null, created: fake.state.created };
    },
    status: async (tenantId, orderId) => {
      const ord = Array.from(fake.orders.values()).find((x) => x.orderId === orderId && x.tenantId === tenantId);
      if (!ord) throw new real.CommerceError(404, "not_found", "Pedido no encontrado");
      return { status: ord.status, orderId, paymentUrl: null };
    },
  };
  return { ...real, commerceClientFromEnv: () => (fake.state.channel ? (client as CommerceClient) : null) };
});
vi.mock("./subscriptionDb", async (orig) => ({ ...(await orig<typeof import("./subscriptionDb")>()), countPanelUsers: async () => 1 }));
vi.mock("./supportContact", () => ({ resolveSupportContact: async () => ({ email: "ayuda@elephant.example" }) }));

import { router } from "./_core/trpc";
import { subscriptionRouter } from "./routers/subscriptionRouter";
import { connectRouter } from "./routers/connectRouter";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { runWithTenant } from "./_core/tenant";
import { capabilityStateFrom, resolveNav, TASK_NAV } from "../shared/adminNav";
import { beginAttempt, memoryAttemptStorage, openOrders, recordResult } from "../shared/connectPurchase";

const app = router({ subscription: subscriptionRouter, connect: connectRouter });
const ctxFor = (role: string, id = 1): TrpcContext => ({
  user: { id, openId: "o", email: "ana@empresa.example", name: "Ana", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});
const A = "empresa-a";
const B = "empresa-b";
let clock = Date.UTC(2026, 9, 31, 10);
const store = new MemoryCapabilityStore();
const env = { ...process.env };

const as = <T>(tenant: string, fn: () => Promise<T>) => runWithTenant(tenant, fn);
const menuHrefs = async (tenant: string) => {
  const ov = await as(tenant, () => app.createCaller(ctxFor("admin")).subscription.overview());
  const nav = resolveNav(TASK_NAV, { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: capabilityStateFrom(ov) });
  return nav.flatMap((s) => s.items.map((i) => i.href));
};
const stateOf = async (tenant: string, key: string, role = "admin") => (await as(tenant, () => app.createCaller(ctxFor(role)).connect.catalog())).items.find((i) => i.key === key)!;

beforeAll(async () => {
  process.env.TENANT_MODE = "multi";
  configureCapabilityAccess(store, { now: () => clock, enforce: true, ttlMs: 30_000 });
  // Dos empresas de pago (plan Essential, sin caducidad)
  for (const t of [A, B]) {
    await store.apply(
      t,
      capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" })),
      { actor: "test", reason: null, now: clock },
    );
  }
});
afterAll(() => {
  process.env = env;
  _resetCapabilityAccessForTests();
});
beforeEach(() => {
  fake.state.channel = true;
});

describe("Elephant Connect: ciclo completo de contratación", () => {
  it("contratar → pedido confirmado por el backend → licencia → el menú la muestra; misma clave, sin duplicar", async () => {
    expect(await menuHrefs(A)).not.toContain("/admin/personal");
    const before = await stateOf(A, "connect-people");
    expect([before.state, before.purchasable]).toEqual(["available", true]);
    const cat = await as(A, () => app.createCaller(ctxFor("admin")).connect.catalog());
    expect([cat.canPurchase, cat.purchaseBlock, cat.plan?.key]).toEqual([true, null, "essential"]);

    // Navegador: intento con clave estable; la primera llamada falla por red → se reintenta con la MISMA clave
    const browser = memoryAttemptStorage();
    const attempt = beginAttempt(browser, "u1", "connect-people", clock);
    const caller = app.createCaller(ctxFor("admin"));
    fake.state.failNext = true;
    await expect(as(A, () => caller.subscription.purchase({ add: ["connect-people"], idempotencyKey: attempt.idempotencyKey }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const retry = beginAttempt(browser, "u1", "connect-people", clock + 1000);
    expect(retry.idempotencyKey).toBe(attempt.idempotencyKey);
    const r1 = (await as(A, () => caller.subscription.purchase({ add: ["connect-people"], idempotencyKey: retry.idempotencyKey }))) as { status: string; orderId: number };
    const r2 = (await as(A, () => caller.subscription.purchase({ add: ["connect-people"], idempotencyKey: retry.idempotencyKey }))) as { status: string; orderId: number };
    expect(r1.orderId).toBe(r2.orderId);
    expect(fake.state.created).toBe(1);
    expect(r1.status).toBe("payment_pending");
    recordResult(browser, "u1", retry, r1);
    expect(openOrders(browser, "u1").map((o) => o.orderId)).toEqual([r1.orderId]);

    // Volver de la página de pago NO activa nada: el backend aún no lo ha confirmado
    expect((await stateOf(A, "connect-people")).state).toBe("available");
    expect(await menuHrefs(A)).not.toContain("/admin/personal");

    // Cobro verificado (webhook en el plano de control): licencia aplicada en el registro y pedido aplicado
    await store.apply(A, [{ capabilityId: "people-hr", siteId: "", status: "active", validUntil: null, source: "subscription:1" }], { actor: "cp", reason: "purchase", now: clock });
    Array.from(fake.orders.values()).find((o) => o.orderId === r1.orderId)!.status = "applied";
    // Sin consultar el estado, la caché de licencias (30 s) aún no lo ve…
    expect((await stateOf(A, "connect-people")).state).toBe("available");
    // …la consulta del pedido aplicado la descarta: catálogo y menú lo muestran al momento, sin cerrar sesión
    const st = (await as(A, () => caller.subscription.purchaseStatus({ orderId: r1.orderId }))) as { status: "applied" };
    expect(st.status).toBe("applied");
    recordResult(browser, "u1", openOrders(browser, "u1")[0], st);
    expect(openOrders(browser, "u1")).toEqual([]);
    const after = await stateOf(A, "connect-people");
    expect([after.state, after.purchasable]).toEqual(["active", false]);
    expect(await menuHrefs(A)).toContain("/admin/personal");

    // Aislamiento: la otra empresa ni lo tiene ni ve el pedido
    expect((await stateOf(B, "connect-people")).state).toBe("available");
    expect(await menuHrefs(B)).not.toContain("/admin/personal");
    await expect(as(B, () => app.createCaller(ctxFor("admin")).subscription.purchaseStatus({ orderId: r1.orderId }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("suspender → desaparece del menú y queda «suspendida o con incidencia» (sin ofrecer comprar otra vez)", async () => {
    await store.apply(A, [{ capabilityId: "people-hr", siteId: "", status: "suspended", validUntil: null, source: "operator" }], { actor: "operador", reason: "impago", now: clock });
    clock += 31_000; // la caché de licencias se renueva sola
    expect(await menuHrefs(A)).not.toContain("/admin/personal");
    const s = await stateOf(A, "connect-people");
    expect([s.state, s.purchasable]).toEqual(["incident", false]);
  });

  it("solo la administración compra; el resto ve el catálogo con el motivo", async () => {
    const view = await as(B, () => app.createCaller(ctxFor("agente")).connect.catalog());
    expect([view.canPurchase, view.purchaseBlock]).toEqual([false, "role"]);
    expect(view.items.find((i) => i.key === "connect-voice")!.state).toBe("on_request");
    await expect(as(B, () => app.createCaller(ctxFor("agente")).subscription.purchase({ add: ["connect-people"], idempotencyKey: "clave-agente-000000001" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(B, () => app.createCaller(ctxFor("user")).connect.catalog())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sin canal con el plano de control: nada contratable y contacto", async () => {
    fake.state.channel = false;
    const view = await as(B, () => app.createCaller(ctxFor("admin")).connect.catalog());
    expect([view.available, view.canPurchase, view.items.length, view.supportEmail]).toEqual([false, false, 0, "ayuda@elephant.example"]);
  });
});
