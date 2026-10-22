/**
 * Límites contratados hacia el Core (memoria, datos sintéticos): cálculo plan + ampliaciones, escritura al aplicar
 * las licencias (con su evento), aislamiento entre empresas, lectura en el Core con su empresa en curso, plazas de
 * usuario con el límite contratado y tope de almacenamiento en las subidas (y declaración del uso real).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { LimitAccess, configureLimitAccess } from "./_core/limits/access";
import { runWithTenant } from "./_core/tenant";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { configureCapabilityAccess } from "./_core/capabilities/access";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { MemoryCrmStore } from "./crm/store";
import { CrmService } from "./crm/service";
import { MemoryWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MemoryCommercialEventLog } from "./commercialEvents/log";
import { FileService, FileValidationError } from "./_core/files/service";
import { LocalObjectBackend } from "./_core/files/backend";
import { MemoryObjectMetaStore } from "./storedObjectsDb";
import { currentLicence } from "./setupWizardDb";

const DAY = 86_400_000;
const GB = 1024 ** 3;
const actor = "operator:test";

describe("almacén de límites y uso", () => {
  it("idempotente, solo lo que cambia, y cada empresa solo ve lo suyo", async () => {
    const s = new MemoryTenantLimitStore();
    const meta = { source: "subscription:1", actor, now: 1 };
    expect(await s.setLimits("t-a", [{ metric: "users", limit: 5 }, { metric: "storage_gb", limit: 5 }], meta)).toEqual([
      { metric: "users", from: undefined, to: 5 },
      { metric: "storage_gb", from: undefined, to: 5 },
    ]);
    expect(await s.setLimits("t-a", [{ metric: "users", limit: 5 }], meta)).toEqual([]);
    expect(await s.setLimits("t-a", [{ metric: "users", limit: 8 }], meta)).toEqual([{ metric: "users", from: 5, to: 8 }]);
    await s.setLimits("t-b", [{ metric: "users", limit: 3 }], meta);
    expect((await s.limits("t-a")).find((l) => l.metric === "users")?.limit).toBe(8);
    expect((await s.limits("t-b")).map((l) => l.limit)).toEqual([3]);
    await s.reportUsage("t-a", "users", 4, 10);
    await s.reportUsage("t-a", "users", 2, 5); // medida más antigua: no retrocede
    expect(await s.usage("t-a")).toEqual([{ metric: "users", used: 4, measuredAt: 10 }]);
    expect(await s.usage("t-b")).toEqual([]);
  });

  it("acceso del Core: solo con empresa en curso; sin dato o si el registro cae, lo del plan (undefined)", async () => {
    const s = new MemoryTenantLimitStore();
    await s.setLimits("t-a", [{ metric: "users", limit: 6 }], { source: "x", actor, now: 1 });
    const a = new LimitAccess(s, { enforce: true, ttlMs: 0 });
    expect(await a.limit("users")).toBeUndefined(); // sin empresa en curso
    expect(await runWithTenant("t-a", () => a.limit("users"))).toBe(6);
    expect(await runWithTenant("t-a", () => a.limit("storage_gb"))).toBeUndefined();
    expect(await runWithTenant("t-b", () => a.limit("users"))).toBeUndefined();
    const down = new LimitAccess({ limits: async () => Promise.reject(new Error("registro caído")), reportUsage: async () => undefined }, { enforce: true });
    expect(await runWithTenant("t-a", () => down.limit("users"))).toBeUndefined();
    runWithTenant("t-a", () => a.report("users", 3));
    await new Promise((r) => setTimeout(r, 5));
    expect(await s.usage("t-a")).toMatchObject([{ metric: "users", used: 3 }]);
  });
});

describe("licencias: límites = lo incluido en el plan + ampliaciones vigentes", () => {
  let clock: number;
  let subs: SubscriptionService;
  let subsStore: MemorySubscriptionStore;
  let licensing: LicensingService;
  let limits: MemoryTenantLimitStore;
  let ledger: MemoryCommercialEventLog;
  let crm: CrmService;
  let web: MemoryWebStore;

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 20, 9);
    web = new MemoryWebStore();
    await seedElephantSource(new WebAdminService({ store: web, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), web);
    const crmStore = new MemoryCrmStore();
    crm = new CrmService({ store: crmStore, now: () => clock });
    subsStore = new MemorySubscriptionStore();
    const crmPort = crmFromStore(crmStore);
    subs = new SubscriptionService({ store: subsStore, catalog: catalogFromWebStore(web), crm: crmPort, now: () => clock });
    limits = new MemoryTenantLimitStore();
    ledger = new MemoryCommercialEventLog();
    licensing = new LicensingService({ capabilities: new MemoryCapabilityStore(), subscriptions: subsStore, crm: crmPort, catalog: async () => quoteCatalogFromSite(await new WebAdminService({ store: web, refs: { moduleIds: [], planIds: () => null } }).site("published")), now: () => clock, limits, events: ledger });
  });

  const priceOf = async (k: string) => (await catalogFromWebStore(web).offer()).find((x) => x.key === k)!.prices.find((x) => x.kind === "monthly")!.id;

  it("Essential con 2 usuarios adicionales: usuarios 5, sedes 1, almacenamiento 5 GB; la bajada se nota al fin del periodo", async () => {
    const c = await crm.createCompany({ name: "Límites SL" }, actor);
    const sub = await subs.create({ companyId: c.id, tenantId: "t-limites", interval: "month", plan: { productKey: "essential", priceId: await priceOf("essential") }, addons: [{ productKey: "addon-user-essential", priceId: await priceOf("addon-user-essential"), quantity: 2 }] }, actor);
    const r = await licensing.apply(sub.id, { activate: true, actor });
    expect(r.limits.map((l) => [l.metric, l.to])).toEqual([
      ["users", 5],
      ["sites", 1],
      ["storage_gb", 5],
    ]);
    expect((await ledger.list({ subscriptionId: sub.id, types: ["entitlement.limit_changed"] })).map((e) => e.data)).toEqual([
      { metric: "users", from: null, to: 5 },
      { metric: "sites", from: null, to: 1 },
      { metric: "storage_gb", from: null, to: 5 },
    ]);
    // Repetir no cambia nada
    expect((await licensing.apply(sub.id, { activate: true, actor })).limits).toEqual([]);
    // Bajada a 1 usuario adicional: hasta el fin del periodo siguen siendo 5
    const s1 = (await subsStore.get(sub.id))!;
    await subs.changeQuantity(sub.id, { productKey: "addon-user-essential", quantity: 1 }, s1.version, actor);
    expect((await licensing.apply(sub.id, { activate: true, actor })).limits).toEqual([]);
    clock = s1.currentPeriodEnd + 1;
    expect((await licensing.apply(sub.id, { activate: true, actor })).limits).toEqual([{ metric: "users", from: 5, to: 4 }]);
    // Otra empresa no se ve afectada
    expect(await limits.limits("t-otra")).toEqual([]);
  });
});

describe("el Core aplica los límites contratados", () => {
  let dir: string;
  const env = { ...process.env };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "limites-"));
    process.env.APP_URL = "https://empresa.example";
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...env };
    configureLimitAccess(null);
  });

  it("plazas: el límite contratado (plan + adicionales) sustituye al del plan; sin dato, el del plan", async () => {
    process.env.TENANT_MODE = "multi";
    const caps = new MemoryCapabilityStore();
    await caps.apply("t-plazas", capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" })), { actor, reason: "Alta", now: 1 });
    configureCapabilityAccess(caps, { enforce: true, ttlMs: 0 });
    expect((await runWithTenant("t-plazas", () => currentLicence())).userLimit).toBe(3);
    const s = new MemoryTenantLimitStore();
    await s.setLimits("t-plazas", [{ metric: "users", limit: 5 }], { source: "subscription:1", actor, now: 1 });
    configureLimitAccess(s, { enforce: true, ttlMs: 0 });
    expect(await runWithTenant("t-plazas", () => currentLicence())).toMatchObject({ plan: "essential", userLimit: 5 });
  });

  it("almacenamiento: no se sube por encima del contratado; liberando espacio, sí; el uso real queda declarado", async () => {
    const s = new MemoryTenantLimitStore();
    await s.setLimits("t-disco", [{ metric: "storage_gb", limit: 1 }], { source: "subscription:1", actor, now: 1 });
    configureLimitAccess(s, { enforce: true, ttlMs: 0 });
    const meta = new MemoryObjectMetaStore();
    const svc = new FileService({ backend: () => new LocalObjectBackend(dir), meta, retryDelayMs: 1 });
    const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
    // Ya ocupa casi 1 GB
    await meta.insert({ objectId: "o-grande", storageKey: "k/grande", visibility: "private", category: "invoice", contentType: "application/pdf", sizeBytes: GB - 10, sha256: "x", originalName: null, ownerType: null, ownerId: null, uploadedBy: null, status: "active", replacesObjectId: null, replacedBy: null, error: null, createdAt: 1, updatedAt: 1, confirmedAt: 1, deletedAt: null, bytesRemovedAt: null } as never);
    await expect(runWithTenant("t-disco", () => svc.put({ category: "invoice", data: PDF, declaredType: "application/pdf" }))).rejects.toThrow(/almacenamiento contratado \(1 GB\)/);
    await expect(runWithTenant("t-disco", () => svc.put({ category: "invoice", data: PDF, declaredType: "application/pdf" }))).rejects.toBeInstanceOf(FileValidationError);
    // Se libera el fichero grande: ya cabe
    await meta.update("o-grande", { status: "deleted" as never });
    const ok = await runWithTenant("t-disco", () => svc.put({ category: "invoice", data: PDF, declaredType: "application/pdf" }));
    expect(ok.sizeBytes).toBe(PDF.length);
    await new Promise((r) => setTimeout(r, 5));
    expect((await s.usage("t-disco")).find((u) => u.metric === "storage_bytes")).toBeTruthy();
  });
});

void DAY;
