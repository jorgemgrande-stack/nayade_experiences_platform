/**
 * Licencias por capacidad: decisión de acceso, caché del Core, guardián de rutas tRPC y aplicación
 * desde suscripciones (catálogo oficial de Elephant Source).
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decide, type CapabilityGrant } from "./_core/capabilities/model";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { CapabilityAccess } from "./_core/capabilities/access";
import { capabilityRouteGuard } from "./_core/capabilities/routeGuard";
import { LicensingService } from "./licensing/service";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";

const NOW = Date.UTC(2026, 9, 16, 10);
const DAY = 86_400_000;
const g = (over: Partial<CapabilityGrant>): CapabilityGrant => ({ tenantId: "acme", capabilityId: "people-hr", siteId: "", status: "active", validUntil: null, source: "operator", updatedAt: 0, updatedBy: "t", ...over });

describe("decisión de acceso", () => {
  it("activa: lee y opera; no contratada: nada", () => {
    expect(decide([g({})], "people-hr", { write: true, now: NOW }).allowed).toBe(true);
    expect(decide([], "people-hr", { write: false, now: NOW })).toMatchObject({ allowed: false, status: "not_contracted" });
  });
  it("solo lectura: consulta sí, opera no", () => {
    expect(decide([g({ status: "read_only" })], "people-hr", { write: false, now: NOW }).allowed).toBe(true);
    expect(decide([g({ status: "read_only" })], "people-hr", { write: true, now: NOW })).toMatchObject({ allowed: false, status: "read_only" });
  });
  it("caducada (fin de prueba): pasa a solo lectura; los datos se siguen consultando", () => {
    const expired = [g({ validUntil: NOW - 1 })];
    expect(decide(expired, "people-hr", { write: false, now: NOW })).toMatchObject({ allowed: true, status: "read_only" });
    expect(decide(expired, "people-hr", { write: true, now: NOW })).toMatchObject({ allowed: false, status: "expired" });
  });
  it("contratada, pendiente de configuración, suspendida o cancelada: no se usa", () => {
    for (const status of ["contracted", "pending_setup", "suspended", "cancelled"] as const) expect(decide([g({ status })], "people-hr", { write: false, now: NOW }).allowed, status).toBe(false);
  });
  it("por sede: la de empresa cubre todas; la de sede solo la suya", () => {
    expect(decide([g({ siteId: "" })], "people-hr", { write: true, siteId: "sede-2", now: NOW }).allowed).toBe(true);
    expect(decide([g({ siteId: "sede-1" })], "people-hr", { write: true, siteId: "sede-1", now: NOW }).allowed).toBe(true);
    expect(decide([g({ siteId: "sede-1" })], "people-hr", { write: true, siteId: "sede-2", now: NOW }).allowed).toBe(false);
    expect(decide([g({ siteId: "sede-1" })], "people-hr", { write: true, now: NOW }).allowed).toBe(false);
  });
});

describe("acceso en el Core", () => {
  it("sin aplicación (single o sin CAPABILITY_ENFORCEMENT) todo se permite", async () => {
    const a = new CapabilityAccess(new MemoryCapabilityStore(), { enforce: false });
    expect((await a.check("people-hr", { write: true, tenantId: "acme" })).allowed).toBe(true);
  });
  it("caché con continuidad acotada si el registro cae; después falla cerrado", async () => {
    const store = new MemoryCapabilityStore();
    await store.apply("acme", [{ capabilityId: "people-hr", siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "t", reason: null, now: NOW });
    let t = NOW;
    const a = new CapabilityAccess(store, { enforce: true, ttlMs: 1000, maxStaleMs: 5000, now: () => t });
    expect((await a.check("people-hr", { write: true, tenantId: "acme" })).allowed).toBe(true);
    store.setFailing(true);
    t += 3000;
    expect((await a.check("people-hr", { write: true, tenantId: "acme" })).allowed).toBe(true);
    t += 10_000;
    await expect(a.check("people-hr", { write: true, tenantId: "acme" })).rejects.toThrow();
  });
});

describe("guardián de rutas tRPC", () => {
  async function serve(access: CapabilityAccess) {
    const app = express();
    app.use("/api/trpc", capabilityRouteGuard(() => access));
    app.use("/api/trpc", (_req, res) => void res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (method: string, path: string) =>
      new Promise<number>((resolve) => {
        const req = http.request({ host: "127.0.0.1", port, path, method }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.end();
      });
    return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
  }
  it("solo lectura: consultas (GET) sí, mutaciones (POST) no; sin contratar, 403; lo no mapeado pasa; origen caído, 503", async () => {
    const store = new MemoryCapabilityStore();
    await store.apply("default", [{ capabilityId: "people-hr", siteId: "", status: "read_only", validUntil: null, source: "trial:1" }], { actor: "t", reason: null, now: NOW });
    const s = await serve(new CapabilityAccess(store, { enforce: true, now: () => NOW }));
    try {
      expect(await s.call("GET", "/api/trpc/hr.listEmployees")).toBe(200);
      expect(await s.call("POST", "/api/trpc/hr.createEmployee")).toBe(403);
      expect(await s.call("GET", "/api/trpc/gestoria.dashboard")).toBe(403);
      expect(await s.call("GET", "/api/trpc/auth.me")).toBe(200);
      // Lote: basta una capacidad denegada para rechazar la petición entera
      expect(await s.call("GET", "/api/trpc/hr.listEmployees,gestoria.dashboard")).toBe(403);
      store.setFailing(true);
      const s2 = await serve(new CapabilityAccess(store, { enforce: true, now: () => NOW }));
      expect(await s2.call("GET", "/api/trpc/hr.listEmployees")).toBe(503);
      await s2.close();
    } finally {
      await s.close();
    }
  });
});

describe("aplicación de licencias desde la suscripción", () => {
  let caps: MemoryCapabilityStore;
  let subs: SubscriptionService;
  let licensing: LicensingService;
  let priceOf: (key: string, kind?: string) => Promise<number>;
  let clock = NOW;
  let tenantOfContract: string | null = "acme";

  beforeEach(async () => {
    clock = NOW;
    tenantOfContract = "acme";
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    priceOf = async (key, kind = "monthly") => {
      const e = (await webStore.getEntry("product", key))!;
      return (await webStore.listPrices(e.id)).find((p) => p.status === "approved" && p.kind === kind)!.id;
    };
    const crm: CrmPort = {
      company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : null),
      contract: async (id) => (id === 10 ? { id: 10, reference: "CT-2026-000010", companyId: 1, status: "signed", amountCents: null, currency: "EUR", billingInterval: "month", tenantId: tenantOfContract } : null),
    };
    const store = new MemorySubscriptionStore();
    caps = new MemoryCapabilityStore();
    subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => clock });
    licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => clock });
  });

  const create = async (over: Record<string, unknown> = {}) =>
    subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "business", priceId: await priceOf("business") }, ...over } as never, "operator:ana");

  it("Business + People: 29 + 15 capacidades del plan y la de People; idempotente", async () => {
    const s = await create({ addons: [{ productKey: "connect-people", priceId: await priceOf("connect-people") }] });
    const r = await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    expect(r.tenantId).toBe("acme");
    expect(r.desired.map((d) => d.capabilityId).sort()).toEqual([...capabilitiesOfTier("essential"), ...capabilitiesOfTier("business"), "people-hr"].sort());
    expect(r.applied).toHaveLength(45);
    expect((await caps.list("acme")).every((x) => x.status === "active" && x.source === `subscription:${s.id}`)).toBe(true);
    const again = await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    expect(again.applied).toEqual([]);
  });
  it("un paquete concede las capacidades de sus componentes, sin duplicar", async () => {
    const s = await create({ addons: [{ productKey: "connect-pack-finance", priceId: await priceOf("connect-pack-finance") }] });
    const r = await licensing.preview(s.id, { activate: true });
    const fin = r.desired.filter((d) => ["tax-filings", "bank-reconciliation", "bank-import-pos", "supplier-settlements"].includes(d.capabilityId));
    expect(fin.map((d) => d.capabilityId).sort()).toEqual(["bank-import-pos", "bank-reconciliation", "supplier-settlements", "tax-filings"]);
    expect(fin.every((d) => d.grantedBy.length === 1 && d.grantedBy[0] === "connect-pack-finance")).toBe(true);
    expect(new Set(r.desired.map((d) => d.capabilityId)).size).toBe(r.desired.length);
  });
  it("prueba: licencias con caducidad al final; al vencer, solo lectura", async () => {
    const s = await create({ plan: { productKey: "essential", priceId: await priceOf("essential") }, trialDays: 15 });
    const r = await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    expect(r.validUntil).toBe(s.trialEnd);
    const access = new CapabilityAccess(caps, { enforce: true, now: () => clock });
    expect((await access.check("crm-leads", { write: true, tenantId: "acme" })).allowed).toBe(true);
    clock = s.trialEnd! + DAY;
    const access2 = new CapabilityAccess(caps, { enforce: true, now: () => clock });
    expect((await access2.check("crm-leads", { write: false, tenantId: "acme" })).allowed).toBe(true);
    expect((await access2.check("crm-leads", { write: true, tenantId: "acme" })).allowed).toBe(false);
  });
  it("quitar una partida cancela su capacidad al reaplicar (los datos no se tocan)", async () => {
    const s = await create({ addons: [{ productKey: "connect-people", priceId: await priceOf("connect-people") }] });
    await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    const item = (await subs.detail(s.id)).items.find((i) => i.productKey === "connect-people")!;
    await subs.removeItem(s.id, item.id, { when: "now", reason: "Baja de People" }, s.version, "operator:ana");
    clock += 1000;
    const r = await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    expect(r.applied.map((e) => [e.capabilityId, e.fromStatus, e.toStatus])).toEqual([["people-hr", "active", "cancelled"]]);
  });
  it("«solo contratado» deja las licencias pendientes de activar; el operador puede suspender con motivo", async () => {
    const s = await create();
    const r = await licensing.apply(s.id, { activate: false, actor: "operator:ana" });
    expect(r.applied.every((e) => e.toStatus === "contracted")).toBe(true);
    await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    await expect(licensing.setStatus("acme", "crm-leads", "suspended", { actor: "operator:ana", reason: "" })).rejects.toThrow(/motivo/);
    await licensing.setStatus("acme", "crm-leads", "suspended", { actor: "operator:ana", reason: "Impago comprobado" });
    expect((await new CapabilityAccess(caps, { enforce: true, now: () => clock }).check("crm-leads", { write: false, tenantId: "acme" })).allowed).toBe(false);
    expect((await caps.events("acme"))[0]).toMatchObject({ capabilityId: "crm-leads", toStatus: "suspended", reason: "Impago comprobado" });
  });
  it("sin plataforma (tenant) ni en la suscripción ni en el contrato no se aplica nada", async () => {
    tenantOfContract = null;
    const s = await create();
    await expect(licensing.preview(s.id, { activate: true })).rejects.toThrow(/plataforma/);
  });
});

describe("suscripción y configuración del contrato", () => {
  it("el alta debe coincidir con el plan, la periodicidad y los complementos acordados", async () => {
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
    await seedElephantSource(web, webStore);
    const price = async (key: string) => (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
    const crm: CrmPort = {
      company: async () => ({ id: 1, name: "Acme" }),
      contract: async () => ({ id: 10, reference: null, companyId: 1, status: "signed", amountCents: null, currency: "EUR", billingInterval: "month", tenantId: "acme", configuration: { request: { plan: "essential", interval: "month", items: [{ key: "connect-voice" }] } } }),
    };
    const subs = new SubscriptionService({ store: new MemorySubscriptionStore(), catalog: catalogFromWebStore(webStore), crm, now: () => NOW });
    const base = { companyId: 1, contractId: 10, interval: "month" as const };
    await expect(subs.create({ ...base, plan: { productKey: "business", priceId: await price("business") } }, "t")).rejects.toThrow(/acordó el plan/);
    await expect(subs.create({ ...base, plan: { productKey: "essential", priceId: await price("essential") }, addons: [{ productKey: "connect-people", priceId: await price("connect-people") }] }, "t")).rejects.toThrow(/fuera de lo contratado/);
    expect((await subs.create({ ...base, plan: { productKey: "essential", priceId: await price("essential") }, addons: [{ productKey: "connect-voice", priceId: await price("connect-voice") }] }, "t")).status).toBe("active");
  });
});
