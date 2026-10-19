/**
 * Partidas comerciales (memoria, datos sintéticos): tipo de partida en la instantánea, ampliaciones por
 * cantidad desde el pedido (alta y cambios), subida inmediata y bajada a fin de periodo, nunca por debajo del
 * uso real, cambios que no declaran cantidades sin tocarlas y eventos `subscription.quantity_changed`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { SignedTestProvider } from "./orchestrator/payments";
import { CommercialOrchestrator } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService, lineKindOf } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { MemoryCommercialEventLog } from "./commercialEvents/log";
import { activeAt } from "./subscriptions/service";

const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const DAY = 86_400_000;
const key = () => crypto.randomBytes(12).toString("hex");
const actor = "operator:test";

describe("tipo de partida", () => {
  it("plan, ampliación por cantidad (con su métrica), servicio o módulo", () => {
    expect(lineKindOf({ family: "core_plan", addonFor: null })).toEqual({ lineKind: "plan", metric: null });
    expect(lineKindOf({ family: "extension", addonFor: { metric: "users", step: 1 } })).toEqual({ lineKind: "quantity", metric: "users" });
    expect(lineKindOf({ family: "service", addonFor: null })).toEqual({ lineKind: "service", metric: null });
    expect(lineKindOf({ family: "industry_module" })).toEqual({ lineKind: "module", metric: null });
  });
});

describe("ampliaciones por cantidad con el orquestador en memoria", () => {
  let clock: number;
  let svc: CommercialOrchestrator;
  let subs: SubscriptionService;
  let subsStore: MemorySubscriptionStore;
  let crm: CrmService;
  let ledger: MemoryCommercialEventLog;
  let usedUsers: number | null;
  const provider = new SignedTestProvider({ webhookSecret: SECRET });

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 20, 9);
    usedUsers = null;
    const crmStore = new MemoryCrmStore();
    ledger = new MemoryCommercialEventLog();
    subsStore = new MemorySubscriptionStore(ledger);
    const caps = new MemoryCapabilityStore();
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    const platform = { activate: async ({ company }: { company: { id: number; tenantId: string | null } }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) };
    crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now: () => clock });
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock, usage: { of: async (_t, m) => (m === "users" ? usedUsers : null) } });
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    svc = new CommercialOrchestrator({
      store: new MemoryOrderStore(ledger),
      crm,
      crmStore,
      subscriptions: subs,
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog,
      quote: async (r) => quote(await site(), r),
      licensing: new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => clock }),
      capabilities: caps,
      platform,
      payments: provider,
      now: () => clock,
    });
  });

  const company = async (name: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@${c.id}.example` }, actor);
    return c.id;
  };
  const accepted = { signatureRef: "firma-1", approvalReason: "Aprobado por producto" };
  /**
   * Alta o cambio hasta el final: aprobación administrativa de pruebas si espera confirmación; una bajada sin
   * importe que no añade capacidades ya se confirma al aceptar (base heredada).
   */
  const run = async (input: Parameters<CommercialOrchestrator["create"]>[0]) => {
    const o = (await svc.create({ idempotencyKey: key(), ...input }, actor)).order;
    const a = await svc.accept(o.id, accepted, actor);
    return a.order.state === "contracted" ? svc.approve(o.id, { reason: "Cliente piloto de ampliaciones" }, actor) : a;
  };
  const activate = async (input: Parameters<CommercialOrchestrator["create"]>[0]) => {
    const r = await run(input);
    expect(r.error ?? null).toBeNull();
    return r.order;
  };
  const users = async (subId: number, at = clock) => activeAt(await subsStore.items(subId), at).filter((i) => i.productKey === "addon-user-essential");

  it("alta con 5 usuarios en Essential (3 incluidos): una partida de 2 usuarios adicionales, marcada como ampliación", async () => {
    const o = await activate({ companyId: await company("Alta Usuarios SL"), request: { plan: "essential", interval: "month", items: [], users: 5 } });
    const [u] = await users(o.subscriptionId!);
    expect(u).toMatchObject({ quantity: 2, lineKind: "quantity", metric: "users", family: "extension" });
    const plan = (await subsStore.items(o.subscriptionId!)).find((i) => i.family === "core_plan")!;
    expect(plan.lineKind).toBe("plan");
    const ev = await ledger.list({ subscriptionId: o.subscriptionId!, types: ["subscription.quantity_changed", "subscription.created"] });
    expect(ev.map((e) => e.type)).toEqual(["subscription.created"]);
  });

  it("cambio a más usuarios: desde ahora; a menos: desde el fin del periodo; nunca por debajo del uso real", async () => {
    const prev = await activate({ companyId: await company("Cambio Usuarios SL"), request: { plan: "essential", interval: "month", items: [], users: 5 } });
    const subId = prev.subscriptionId!;
    const sub = (await subsStore.get(subId))!;
    // Subida a 8 (5 adicionales): inmediata, la partida anterior se cierra ahora
    clock += 2 * DAY;
    const up = await activate({ changeOf: prev.id, request: { plan: "essential", interval: "month", items: [], users: 8 } });
    expect((await users(subId)).map((i) => [i.quantity, i.effectiveFrom])).toEqual([[5, clock]]);
    // Bajada a 4 con 7 en uso: rechazada (el límite quedaría en 3 + 1 = 4)
    usedUsers = 7;
    clock += DAY;
    const blocked = await run({ changeOf: up.id, request: { plan: "essential", interval: "month", items: [], users: 4 } });
    expect(blocked.error).toMatch(/por debajo del uso real/);
    const ch = blocked.order;
    expect((await users(subId))[0].quantity).toBe(5);
    // Con 4 en uso sí: se aplica al fin del periodo (hasta entonces sigue con 5)
    usedUsers = 4;
    expect((await svc.advance(ch.id, actor)).error).toBeNull();
    expect((await users(subId))[0].quantity).toBe(5);
    expect((await users(subId, sub.currentPeriodEnd))[0]).toMatchObject({ quantity: 1, effectiveFrom: sub.currentPeriodEnd });
    // Rastro: alta a 2 (con la suscripción), subida 2→5 y bajada 5→1
    const q = await ledger.list({ subscriptionId: subId, types: ["subscription.quantity_changed"] });
    expect(q.map((e) => [(e.data.before as { quantity: number }).quantity, (e.data.after as { quantity: number; direction: string }).quantity, (e.data.after as { direction: string }).direction])).toEqual([
      [2, 5, "up"],
      [5, 1, "down"],
    ]);
  });

  it("un cambio que no declara cantidades (p. ej. añadir un módulo) no toca las ampliaciones", async () => {
    const prev = await activate({ companyId: await company("Sin Tocar SL"), request: { plan: "essential", interval: "month", items: [], users: 6 } });
    clock += DAY;
    await activate({ changeOf: prev.id, request: { plan: "essential", interval: "month", items: [{ key: "connect-people" }] } });
    const [u] = await users(prev.subscriptionId!);
    expect(u).toMatchObject({ quantity: 3, effectiveTo: null });
    expect((await users(prev.subscriptionId!, Date.UTC(2027, 0, 1)))[0]?.quantity).toBe(3);
  });

  it("volver a lo incluido (5 → 3 usuarios): baja de la ampliación a fin de periodo, registrada como cambio de cantidad", async () => {
    const prev = await activate({ companyId: await company("Baja Usuarios SL"), request: { plan: "essential", interval: "month", items: [], users: 5 } });
    const end = (await subsStore.get(prev.subscriptionId!))!.currentPeriodEnd;
    clock += DAY;
    await activate({ changeOf: prev.id, request: { plan: "essential", interval: "month", items: [], users: 3 } });
    expect((await users(prev.subscriptionId!))[0]).toMatchObject({ quantity: 2, effectiveTo: end });
    expect(await users(prev.subscriptionId!, end)).toHaveLength(0);
    const q = await ledger.list({ subscriptionId: prev.subscriptionId!, types: ["subscription.quantity_changed"] });
    expect(q.map((e) => (e.data.before as { quantity?: number }).quantity)).toEqual([2]);
  });

  it("cambio de cantidad directo: solo ampliaciones, sin repetir la misma cantidad ni encadenar cambios programados", async () => {
    const o = await activate({ companyId: await company("Directo SL"), request: { plan: "essential", interval: "month", items: [], users: 5 } });
    const s = (await subsStore.get(o.subscriptionId!))!;
    await expect(subs.changeQuantity(s.id, { productKey: "essential", quantity: 2 }, s.version, actor)).rejects.toThrow(/no es una ampliación/);
    await expect(subs.changeQuantity(s.id, { productKey: "addon-user-essential", quantity: 2 }, s.version, actor)).rejects.toThrow(/no cambia/);
    const down = await subs.changeQuantity(s.id, { productKey: "addon-user-essential", quantity: 1 }, s.version, actor);
    await expect(subs.changeQuantity(s.id, { productKey: "addon-user-essential", quantity: 4 }, down.subscription.version, actor)).rejects.toThrow(/baja programada|cambio programado/);
  });
});
