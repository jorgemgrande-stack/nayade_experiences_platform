/**
 * Política de consumo por plan y por empresa (datos sintéticos, memoria): límite efectivo con su desglose (plan,
 * ampliación, excepción vigente o caducada, valor por defecto), umbrales, excepciones con historial, cuotas del Resource
 * Manager con excepciones, sedes en el plano de control y cuotas de negocio aplicadas en el Core (usuarios y contactos).
 */
import { describe, it, expect, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { BUSINESS_POLICIES, activeException, exceptionState, explainLimit, policyOf, quotaVerdict, resolveEffectiveLimit, type QuotaException } from "./_core/erm/policy";
import { MemoryQuotaExceptionStore, QuotaExceptionError } from "./_core/erm/quotaExceptions";
import { withQuotaExceptions } from "./_core/erm/quota";
import { configureQuotaExceptions } from "./_core/erm/exceptionAccess";
import { businessLimit, limitWithoutExceptions, moduleIncluded, planIncluded, tenantPolicy } from "./quotaPolicyCatalog";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { configureLimitAccess } from "./_core/limits/access";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { runWithTenant } from "./_core/tenant";
import { currentLicence } from "./setupWizardDb";
import { assertBusinessQuota, quotaExceededMessage } from "./businessQuotas";
import { MemoryOrganizationStore, OrganizationService } from "./organization/service";
import type { CapabilityGrant } from "./_core/capabilities/model";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 12);
const actor = "operator:pruebas";

const exc = (p: Partial<QuotaException> = {}): QuotaException => ({
  id: 1,
  tenantId: "t-a",
  metric: "users",
  period: "total",
  originalLimit: 3,
  newLimit: 8,
  reason: "Temporada alta",
  operator: actor,
  startsAt: NOW - DAY,
  expiresAt: NOW + DAY,
  status: "active",
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
  ...p,
});

const grantsOf = (tenantId: string, ids: string[], validUntil: number | null = null): CapabilityGrant[] =>
  ids.map((capabilityId) => ({ tenantId, capabilityId, siteId: "", status: "active", validUntil, source: "subscription:1", updatedAt: 1, updatedBy: actor }));

const base = { metric: "users", period: "total" as const, planKey: "essential", planIncluded: 3, platformDefault: null, enforcement: "hard" as const, now: NOW };

describe("límite efectivo y su desglose", () => {
  it("solo el plan", () => {
    const e = resolveEffectiveLimit(base);
    expect(e).toMatchObject({ limit: 3, source: "plan", contractual: 3, breakdown: { plan: { key: "essential", included: 3 }, addon: 0, exception: null } });
    expect(e.thresholds).toEqual({ warning: 2, critical: 2, max: 3 });
  });

  it("plan + ampliaciones: por unidades o por el límite contratado que escriben las licencias", () => {
    expect(resolveEffectiveLimit({ ...base, addonUnits: 2 })).toMatchObject({ limit: 5, source: "addon", breakdown: { addon: 2 } });
    expect(resolveEffectiveLimit({ ...base, contracted: 7 })).toMatchObject({ limit: 7, source: "addon", contractual: 7, breakdown: { addon: 4 } });
    // Contrato sin tope (Enterprise): null
    expect(resolveEffectiveLimit({ ...base, planKey: "enterprise", planIncluded: null })).toMatchObject({ limit: null, source: "plan", thresholds: { max: null } });
  });

  it("excepción vigente: manda; caducada, programada o revocada: vuelve lo contractual sin tareas", () => {
    const e = exc();
    expect(resolveEffectiveLimit({ ...base, contracted: 5, exceptions: [e] })).toMatchObject({ limit: 8, source: "exception", contractual: 5, breakdown: { exception: { id: 1, newLimit: 8 } } });
    // Al llegar la caducidad (misma excepción, solo cambia la hora)
    expect(resolveEffectiveLimit({ ...base, contracted: 5, exceptions: [e], now: e.expiresAt })).toMatchObject({ limit: 5, source: "addon", breakdown: { exception: null } });
    expect(resolveEffectiveLimit({ ...base, exceptions: [exc({ startsAt: NOW + 1 })] }).limit).toBe(3);
    expect(resolveEffectiveLimit({ ...base, exceptions: [exc({ status: "revoked" })] }).limit).toBe(3);
    // Excepción sin tope
    expect(resolveEffectiveLimit({ ...base, exceptions: [exc({ newLimit: null })] })).toMatchObject({ limit: null, source: "exception" });
    // Solo la de su métrica y periodo; con varias, la más reciente
    expect(activeException([exc({ metric: "sites" }), exc({ period: "day" })], "users", "total", NOW)).toBeNull();
    expect(activeException([exc({ id: 1, newLimit: 8 }), exc({ id: 2, newLimit: 9, createdAt: NOW })], "users", "total", NOW)?.newLimit).toBe(9);
    expect(exceptionState(exc(), NOW)).toBe("active");
    expect(exceptionState(exc(), NOW + 2 * DAY)).toBe("expired");
  });

  it("valor por defecto de plataforma solo si no hay plan, ampliación ni excepción", () => {
    expect(resolveEffectiveLimit({ ...base, planKey: null, planIncluded: undefined, platformDefault: 1 })).toMatchObject({ limit: 1, source: "default", contractual: undefined });
    expect(resolveEffectiveLimit({ ...base, platformDefault: 100 })).toMatchObject({ limit: 3, source: "plan" });
    expect(resolveEffectiveLimit({ ...base, planKey: null, planIncluded: undefined, platformDefault: 1, exceptions: [exc({ newLimit: 4 })] })).toMatchObject({ limit: 4, source: "exception" });
  });

  it("umbral de aviso y crítico no bloquean; superar el máximo bloquea solo si es dura", () => {
    const hard = resolveEffectiveLimit({ ...base, planIncluded: 100 });
    expect(quotaVerdict(hard, 50)).toEqual({ allowed: true, level: "ok" });
    expect(quotaVerdict(hard, 79)).toEqual({ allowed: true, level: "warning" });
    expect(quotaVerdict(hard, 94)).toEqual({ allowed: true, level: "critical" });
    expect(quotaVerdict(hard, 99)).toEqual({ allowed: true, level: "critical" });
    expect(quotaVerdict(hard, 100)).toEqual({ allowed: false, level: "exceeded" });
    expect(quotaVerdict({ ...hard, enforcement: "soft" }, 100)).toEqual({ allowed: true, level: "soft_exceeded" });
    expect(quotaVerdict(resolveEffectiveLimit({ ...base, planIncluded: null }), 1e9)).toEqual({ allowed: true, level: "ok" });
  });

  it("explicación legible", () => {
    expect(explainLimit(resolveEffectiveLimit({ ...base, contracted: 5, exceptions: [exc()] }))).toBe("8 (excepción comercial) · Plan essential: 3 · ampliaciones: +2 · excepción hasta 2026-10-31: 8");
    expect(explainLimit(resolveEffectiveLimit({ ...base, planKey: null, planIncluded: undefined, platformDefault: 1 }))).toBe("1 (valor por defecto de la plataforma) · por defecto: 1");
  });
});

describe("catálogo: planes y módulos", () => {
  it("lo incluido en cada plan, con herencia", () => {
    expect(planIncluded("essential", "contacts")).toBe(10_000);
    expect(planIncluded("business", "users")).toBe(15);
    expect(planIncluded("enterprise", "sites")).toBeNull();
    expect(planIncluded("essential", "rooms")).toBeUndefined();
    expect(planIncluded(null, "users")).toBeUndefined();
  });

  it("los módulos aportan su cuota solo con la capacidad viva", () => {
    expect(moduleIncluded(grantsOf("t", ["hotel-net"]), "rooms", NOW)).toEqual({ included: 20, modules: ["hotel-net-pms"] });
    expect(moduleIncluded(grantsOf("t", ["hotel-net"], NOW - 1), "rooms", NOW)).toBeUndefined();
    expect(moduleIncluded([], "rooms", NOW)).toBeUndefined();
  });

  it("política completa de una empresa Business con ampliaciones, ajuste del operador y excepciones", () => {
    const p = tenantPolicy({
      grants: grantsOf("t-b", [...capabilitiesOfTier("essential"), ...capabilitiesOfTier("business")]),
      contracted: [{ metric: "users", limit: 18 }, { metric: "storage_gb", limit: 60 }],
      overrides: [{ tenantId: "t-b", metric: "email.sent", period: "day", limit: 300, enforcement: "soft" }],
      defaults: [{ metric: "email.sent", period: "day", limit: 1000, enforcement: "hard" }, { metric: "llm.tokens.input", period: "month", limit: 2_000_000, enforcement: "soft" }],
      exceptions: [exc({ tenantId: "t-b", metric: "contacts", newLimit: 150_000, originalLimit: 100_000 }), exc({ id: 2, tenantId: "t-b", metric: "llm.tokens.input", period: "month", newLimit: 5_000_000 })],
      now: NOW,
    });
    expect(p.plan).toBe("business");
    const b = Object.fromEntries(p.business.map((x) => [x.metric, x]));
    expect(b.users).toMatchObject({ limit: 18, source: "addon", breakdown: { plan: { included: 15 }, addon: 3 } });
    expect(b.sites).toMatchObject({ limit: 5, source: "plan" });
    expect(b.storage_gb).toMatchObject({ limit: 60, breakdown: { addon: 10 } });
    expect(b.contacts).toMatchObject({ limit: 150_000, source: "exception", contractual: 100_000 });
    expect(b.orders_month).toMatchObject({ limit: 5_000, enforcement: "none" });
    expect(b.rooms).toMatchObject({ limit: null, source: "default" });
    const r = Object.fromEntries(p.resources.map((x) => [`${x.metric}|${x.period}`, x]));
    expect(r["email.sent|day"]).toMatchObject({ limit: 300, source: "override", enforcement: "soft", breakdown: { default: 1000 } });
    expect(r["llm.tokens.input|month"]).toMatchObject({ limit: 5_000_000, source: "exception" });
    // Cuota original de una excepción nueva: el límite de hoy sin excepciones
    expect(limitWithoutExceptions(p, "contacts", "total")).toBe(100_000);
    expect(limitWithoutExceptions(p, "llm.tokens.input", "month")).toBe(2_000_000);
    expect(limitWithoutExceptions(p, "email.sent", "day")).toBe(300);
    expect(limitWithoutExceptions(p, "nada", "total")).toBeUndefined();
  });

  it("sin plan: valores por defecto que nunca son más estrictos que lo de antes (usuarios y contactos sin tope; sedes 1)", () => {
    const p = tenantPolicy({ grants: null, contracted: [{ metric: "users", limit: 2 }], overrides: [], defaults: [], exceptions: [], now: NOW });
    expect(p.plan).toBeNull();
    const b = Object.fromEntries(p.business.map((x) => [x.metric, x]));
    expect(b.users).toMatchObject({ limit: null, source: "default" });
    expect(b.contacts.limit).toBeNull();
    expect(b.sites.limit).toBe(1);
    expect(BUSINESS_POLICIES.every((x) => x.platformDefault === null || x.platformDefault >= 1)).toBe(true);
  });
});

describe("excepciones comerciales: alta, revocación e historial", () => {
  const input = (p: Record<string, unknown> = {}) => ({ tenantId: "t-a", metric: "users", period: "total" as const, originalLimit: 3, newLimit: 6, reason: "Campaña de invierno", operator: actor, startsAt: NOW, expiresAt: NOW + 30 * DAY, ...p });

  it("valida motivo, fechas, límites y duración máxima", async () => {
    const s = new MemoryQuotaExceptionStore();
    await expect(s.create(input({ reason: "x" }), NOW)).rejects.toThrow(/motivo/);
    await expect(s.create(input({ expiresAt: NOW }), NOW)).rejects.toThrow(/posterior/);
    await expect(s.create(input({ startsAt: NOW - 10 * DAY, expiresAt: NOW - DAY }), NOW)).rejects.toThrow(/futura/);
    await expect(s.create(input({ newLimit: -1 }), NOW)).rejects.toThrow(/enteros/);
    await expect(s.create(input({ expiresAt: NOW + 400 * DAY }), NOW)).rejects.toThrow(/366 días/);
    await expect(s.create(input({ tenantId: "T A" }), NOW)).rejects.toBeInstanceOf(QuotaExceptionError);
  });

  it("una sola vigente por cuota; revocar exige motivo; todo queda en el historial", async () => {
    const s = new MemoryQuotaExceptionStore();
    const a = await s.create(input(), NOW);
    expect(a).toMatchObject({ id: 1, status: "active", operator: actor });
    await expect(s.create(input(), NOW + 1)).rejects.toThrow(/Ya hay una excepción/);
    // Otra métrica u otra empresa sí
    await s.create(input({ metric: "sites" }), NOW);
    await s.create(input({ tenantId: "t-b" }), NOW);
    await expect(s.revoke("t-a", a.id, { actor, reason: "no", now: NOW + 2 })).rejects.toThrow(/motivo/);
    await expect(s.revoke("t-b", a.id, { actor, reason: "Error de alta", now: NOW + 2 })).rejects.toThrow(/no encontrada/);
    const r = await s.revoke("t-a", a.id, { actor: "operator:otra", reason: "Error de alta", now: NOW + 2 });
    expect(r).toMatchObject({ status: "revoked", revokedBy: "operator:otra", revokeReason: "Error de alta", revokedAt: NOW + 2 });
    await expect(s.revoke("t-a", a.id, { actor, reason: "Otra vez", now: NOW + 3 })).rejects.toThrow(/ya estaba revocada/);
    // Tras revocar se puede conceder otra
    await s.create(input({ newLimit: 9 }), NOW + 4);
    const h = await s.history("t-a");
    expect(h.map((x) => [x.action, x.details.metric, x.actor])).toEqual([
      ["created", "users", actor],
      ["revoked", "users", "operator:otra"],
      ["created", "sites", actor],
      ["created", "users", actor],
    ]);
    expect(h[1].details).toMatchObject({ reason: "Error de alta", newLimit: 6, originalLimit: 3 });
    expect((await s.history("t-b")).length).toBe(1);
    // Una caducada no se revoca (ya no aplica) y no impide otra nueva
    const c = await s.create(input({ metric: "contacts", expiresAt: NOW + DAY }), NOW);
    await expect(s.revoke("t-a", c.id, { actor, reason: "Tarde ya", now: NOW + 2 * DAY })).rejects.toThrow(/caducado/);
    await expect(s.create(input({ metric: "contacts", startsAt: NOW + 2 * DAY, expiresAt: NOW + 3 * DAY }), NOW + 2 * DAY)).resolves.toMatchObject({ status: "active" });
  });
});

describe("Resource Manager: cuotas con excepciones vigentes", () => {
  it("la excepción sustituye o añade la cuota mientras está vigente; al caducar vuelve la de siempre; si falla la lectura, la de siempre", async () => {
    const reader = { listQuotas: async (t: string) => [{ tenantId: t, metric: "email.sent", period: "day" as const, limit: 100, enforcement: "hard" as const }] };
    const store = new MemoryQuotaExceptionStore();
    await store.create({ tenantId: "t-a", metric: "email.sent", period: "day", originalLimit: 100, newLimit: 500, reason: "Envío de campaña", operator: actor, startsAt: NOW, expiresAt: NOW + DAY }, NOW);
    await store.create({ tenantId: "t-a", metric: "llm.tokens.input", period: "month", originalLimit: null, newLimit: null, reason: "Piloto de IA", operator: actor, startsAt: NOW, expiresAt: NOW + DAY }, NOW);
    let now = NOW + 1;
    const r = withQuotaExceptions(reader, store, () => now);
    const list = await r.listQuotas("t-a");
    expect(list.find((q) => q.metric === "email.sent")?.limit).toBe(500);
    expect(list.find((q) => q.metric === "llm.tokens.input")).toMatchObject({ period: "month", limit: Number.MAX_SAFE_INTEGER });
    expect((await r.listQuotas("t-b")).find((q) => q.metric === "email.sent")?.limit).toBe(100);
    now = NOW + DAY;
    expect(await r.listQuotas("t-a")).toEqual(await reader.listQuotas("t-a"));
    store.failing = true;
    now = NOW + 1;
    expect(await r.listQuotas("t-a")).toEqual(await reader.listQuotas("t-a"));
  });
});

describe("sedes en el plano de control con excepción", () => {
  it("la excepción vigente amplía el límite de sedes; caducada, vuelve el contractual", async () => {
    let now = NOW;
    const exceptions = new MemoryQuotaExceptionStore();
    const store = new MemoryOrganizationStore();
    const org = new OrganizationService({ store, subscriptions: { list: async () => [], items: async () => [] }, catalog: async () => ({ products: [] }) as never, now: () => now, exceptions });
    await org.createSite("t-org", { siteId: "sede-1", name: "Sede uno" }, actor);
    await expect(org.createSite("t-org", { siteId: "sede-2", name: "Sede dos" }, actor)).rejects.toThrow(/1 sede/);
    await exceptions.create({ tenantId: "t-org", metric: "sites", period: "total", originalLimit: 1, newLimit: 2, reason: "Apertura temporal", operator: actor, startsAt: NOW, expiresAt: NOW + DAY }, NOW);
    expect(await org.limits("t-org")).toMatchObject({ sites: 2, users: 3 });
    await org.createSite("t-org", { siteId: "sede-2", name: "Sede dos" }, actor);
    now = NOW + DAY;
    expect((await org.limits("t-org")).sites).toBe(1);
    await expect(org.createSite("t-org", { siteId: "sede-3", name: "Sede tres" }, actor)).rejects.toThrow(/1 sede/);
  });
});

describe("cuotas de negocio en el Core", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    configureLimitAccess(null);
    configureQuotaExceptions(null);
    _resetCapabilityAccessForTests();
  });
  const essential = async (tenantId: string) => {
    const caps = new MemoryCapabilityStore();
    await caps.apply(tenantId, capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" })), { actor, reason: "Alta", now: 1 });
    configureCapabilityAccess(caps, { enforce: true, ttlMs: 0 });
  };

  it("usuarios: la excepción vigente manda sobre lo contratado; sin ella, lo contratado (sin cambios)", async () => {
    process.env.TENANT_MODE = "multi";
    await essential("t-plazas");
    const limits = new MemoryTenantLimitStore();
    await limits.setLimits("t-plazas", [{ metric: "users", limit: 5 }], { source: "subscription:1", actor, now: 1 });
    configureLimitAccess(limits, { enforce: true, ttlMs: 0 });
    const exceptions = new MemoryQuotaExceptionStore();
    configureQuotaExceptions(exceptions, { enforce: true, ttlMs: 0 });
    expect((await runWithTenant("t-plazas", () => currentLicence())).userLimit).toBe(5);
    const now = Date.now();
    await exceptions.create({ tenantId: "t-plazas", metric: "users", period: "total", originalLimit: 5, newLimit: 9, reason: "Formación de temporada", operator: actor, startsAt: now - 1000, expiresAt: now + DAY }, now);
    expect((await runWithTenant("t-plazas", () => currentLicence())).userLimit).toBe(9);
    // Otra empresa no la ve
    await essential("t-otra");
    expect((await runWithTenant("t-otra", () => currentLicence())).userLimit).toBe(3);
  });

  it("contactos: 403 claro al superar el plan; con excepción vigente cabe; sin plan, en instalación única o sin licencias legibles, no se bloquea", async () => {
    process.env.TENANT_MODE = "multi";
    await essential("t-crm");
    const exceptions = new MemoryQuotaExceptionStore();
    configureQuotaExceptions(exceptions, { enforce: true, ttlMs: 0 });
    let counted = 0;
    const count = (n: number) => async () => ((counted += 1), n);
    await expect(runWithTenant("t-crm", () => assertBusinessQuota("contacts", count(9_999)))).resolves.toBeUndefined();
    const err = await runWithTenant("t-crm", () => assertBusinessQuota("contacts", count(10_000))).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Has alcanzado el límite de contactos de tu plan (10.000 contactos; ahora tienes 10.000). Amplía tu plan o pide una ampliación a Big Elephant para dar de alta más.");
    const now = Date.now();
    await exceptions.create({ tenantId: "t-crm", metric: "contacts", period: "total", originalLimit: 10_000, newLimit: 12_000, reason: "Importación de clientes", operator: actor, startsAt: now - 1000, expiresAt: now + DAY }, now);
    await expect(runWithTenant("t-crm", () => assertBusinessQuota("contacts", count(10_000)))).resolves.toBeUndefined();
    // Sin plan (instalación anterior a las licencias): no se cuenta ni se bloquea
    counted = 0;
    await expect(runWithTenant("t-sin-plan", () => assertBusinessQuota("contacts", count(1e9)))).resolves.toBeUndefined();
    expect(counted).toBe(0);
    // Las cuotas no aplicadas (pedidos al mes) nunca bloquean
    await expect(runWithTenant("t-crm", () => assertBusinessQuota("orders_month", count(1e9)))).resolves.toBeUndefined();
    // Licencias ilegibles: no se bloquea
    configureCapabilityAccess({ list: async () => Promise.reject(new Error("caído")) }, { enforce: true, ttlMs: 0 });
    await expect(runWithTenant("t-crm", () => assertBusinessQuota("contacts", count(1e9)))).resolves.toBeUndefined();
    // Instalación única: nada
    process.env.TENANT_MODE = "single";
    await expect(runWithTenant("t-crm", () => assertBusinessQuota("contacts", count(1e9)))).resolves.toBeUndefined();
  });

  it("mensaje con la ampliación temporal y política declarada de cada cuota", () => {
    const eff = businessLimit(policyOf("contacts")!, { grants: grantsOf("t", capabilitiesOfTier("essential")), contracted: [], exceptions: [exc({ metric: "contacts", newLimit: 12_000 })], now: NOW }, "essential");
    expect(quotaExceededMessage(eff, 12_000)).toMatch(/de la ampliación temporal concedida \(12\.000 contactos; ahora tienes 12\.000\)/);
    expect(BUSINESS_POLICIES.filter((p) => p.enforcement === "hard").map((p) => p.metric)).toEqual(["users", "sites", "fiscal_entities", "storage_gb", "contacts"]);
    for (const p of BUSINESS_POLICIES) expect(p.applied.length).toBeGreaterThan(10);
  });
});
