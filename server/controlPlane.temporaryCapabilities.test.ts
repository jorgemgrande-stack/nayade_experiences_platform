/**
 * Concesión temporal de capacidades a empresas de prueba: permisos por rol, listas cerradas, production cerrado,
 * motivo y caducidad (≤ 24 h), duplicados y concurrencia, fuentes ajenas, caducidad (decide + barrido), suspensión,
 * registro completo, aislamiento y ausencia de efectos sobre suscripciones/módulos.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, SCOPES, type ServiceToken } from "./controlPlane/auth";
import { ROLES, ROLE_SCOPES } from "./controlPlane/operatorRoles";
import { MAX_TEMP_CAPABILITY_HOURS, TEMPORARY_CAPABILITY_IDS, TEMPORARY_CAPABILITY_TENANTS, TemporaryCapabilities } from "./controlPlane/temporaryCapabilities";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { decide } from "./_core/capabilities/model";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const T = "alta-correo-20261024c";
const OTHER = "otra-empresa";
const CAP = "accounting-general";
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const TOK: Record<string, string> = Object.fromEntries([...ROLES, "service", "second"].map((r) => [r, `tok-${r}-aaaaaaaaaaaaaaaaaaaaaaaa`]));
const REASON = "verificación funcional de Contabilidad General #41";

interface Ctx {
  base: string;
  store: MemoryCapabilityStore;
  clock: { t: number };
  env: { v: string | null };
  close: () => Promise<void>;
}
const open: Ctx[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function setup(): Promise<Ctx> {
  const clock = { t: NOW };
  const env = { v: "alta-correo" as string | null };
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new MemoryTenantRegistryStore();
  const registry = new TenantRegistryService(reg, () => ring);
  await registry.createTenant({ id: T, displayName: "Prueba" }, { type: "operator", id: "test" });
  await registry.createTenant({ id: OTHER, displayName: "Otra" }, { type: "operator", id: "test" });
  const store = new MemoryCapabilityStore();
  const tokens: ServiceToken[] = [
    ...ROLES.map((r) => ({ id: `op-${r}`, sha256: hashToken(TOK[r]), scopes: [...ROLE_SCOPES[r]], actorType: "operator" as const })),
    { id: "op-second", sha256: hashToken(TOK.second), scopes: [...ROLE_SCOPES.admin], actorType: "operator" as const },
    // Token de servicio (no es una persona) con todos los ámbitos
    { id: "integracion", sha256: hashToken(TOK.service), scopes: [...SCOPES] },
  ];
  const app = createControlPlaneApp({
    tokens,
    registry,
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.elephantsource.es",
    perMinute: 10_000,
    capabilities: store,
    temporaryCapabilities: { environment: () => env.v, now: () => clock.t },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const ctx: Ctx = { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`, store, clock, env, close: () => new Promise<void>((r) => server.close(() => r())) };
  open.push(ctx);
  return ctx;
}

async function call(ctx: Ctx, method: string, path: string, who: string, body?: unknown) {
  const r = await fetch(ctx.base + path, { method, headers: { authorization: `Bearer ${TOK[who]}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
const grant = (ctx: Ctx, who = "admin", over: Record<string, unknown> = {}, tenant = T) =>
  call(ctx, "POST", `/tenants/${tenant}/temporary-capabilities`, who, { capabilityId: CAP, reason: REASON, expiresAt: ctx.clock.t + 24 * H, ...over });
const suspend = (ctx: Ctx, who = "admin", reason = REASON) => call(ctx, "POST", `/tenants/${T}/temporary-capabilities/${CAP}/suspend`, who, { reason });

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});

describe("permisos", () => {
  it("el scope solo lo tienen superadmin y admin (nunca sales, support ni readonly)", () => {
    expect(ROLE_SCOPES.superadmin).toContain("capabilities:grant-temporary");
    expect(ROLE_SCOPES.admin).toContain("capabilities:grant-temporary");
    for (const r of ["sales", "support", "readonly"] as const) expect(ROLE_SCOPES[r]).not.toContain("capabilities:grant-temporary");
  });
  it("por rol: superadmin y admin conceden; el resto recibe 403 y no se escribe nada", async () => {
    for (const r of ["sales", "support", "readonly"]) {
      expect((await grant(ctx, r)).status, r).toBe(403);
      expect((await suspend(ctx, r)).status, r).toBe(403);
    }
    expect(await ctx.store.list(T)).toEqual([]);
    expect((await grant(ctx, "superadmin")).status).toBe(200);
  });
  it("un token de servicio (no operador) no puede conceder aunque tenga el ámbito", async () => {
    expect((await grant(ctx, "service")).status).toBe(403);
    expect(await ctx.store.list(T)).toEqual([]);
  });
  it("GET: enabled=false sin el scope y true con él", async () => {
    await grant(ctx);
    const sup = await call(ctx, "GET", `/tenants/${T}/temporary-capabilities`, "support");
    expect(sup.status).toBe(200);
    expect(sup.body).toMatchObject({ enabled: false, grants: [], events: [] });
    const adm = await call(ctx, "GET", `/tenants/${T}/temporary-capabilities`, "admin");
    expect(adm.body).toMatchObject({ enabled: true, environment: "alta-correo", maxHours: 24, eligible: true, allowedCapabilities: [{ id: CAP, name: "Contabilidad general" }] });
    expect(adm.body.grants).toHaveLength(1);
  });
  it("ningún scope ni rol de operador se modifica y el cuerpo no admite campos de permisos", async () => {
    const before = JSON.stringify(ROLES.map((r) => ROLE_SCOPES[r]));
    await grant(ctx);
    await suspend(ctx);
    expect(JSON.stringify(ROLES.map((r) => ROLE_SCOPES[r]))).toBe(before);
    expect((await grant(ctx, "admin", { scopes: ["operators:write"] })).status).toBe(400);
  });
});

describe("listas cerradas y entorno", () => {
  it("las listas son exactamente las autorizadas", () => {
    expect(TEMPORARY_CAPABILITY_TENANTS).toEqual([T]);
    expect(TEMPORARY_CAPABILITY_IDS).toEqual([CAP]);
    expect(MAX_TEMP_CAPABILITY_HOURS).toBe(24);
  });
  it("otro tenant → 403; capacidad fuera de la lista → 403; formato inválido → 400", async () => {
    const a = await grant(ctx, "admin", {}, OTHER);
    expect(a.status).toBe(403);
    expect(a.body.error).toMatch(/no está autorizada/);
    expect((await grant(ctx, "admin", { capabilityId: "crm-leads" })).status).toBe(403);
    expect((await grant(ctx, "admin", { capabilityId: "operators:write" })).status).toBe(400);
    expect(await ctx.store.list(OTHER)).toEqual([]);
    expect(await ctx.store.list(T)).toEqual([]);
    const g = await call(ctx, "GET", `/tenants/${OTHER}/temporary-capabilities`, "admin");
    expect(g.body).toMatchObject({ eligible: false, grants: [] });
  });
  it("tenant inexistente → 404", async () => {
    expect((await call(ctx, "GET", "/tenants/no-existe/temporary-capabilities", "admin")).status).toBe(404);
  });
  it("production (con espacios y mayúsculas) cierra la herramienta por completo", async () => {
    await grant(ctx);
    ctx.env.v = "  Production ";
    const r = await grant(ctx);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/production/);
    expect((await suspend(ctx)).status).toBe(403);
    const g = await call(ctx, "GET", `/tenants/${T}/temporary-capabilities`, "superadmin");
    expect(g.body).toMatchObject({ enabled: false, environment: "production", grants: [], events: [] });
    expect((await ctx.store.list(T))[0].status).toBe("active");
  });
});

describe("validación", () => {
  it("motivo obligatorio (≥ 10) y caducidad obligatoria, futura y ≤ 24 h", async () => {
    expect((await grant(ctx, "admin", { reason: "corto" })).status).toBe(400);
    expect((await grant(ctx, "admin", { reason: undefined })).status).toBe(400);
    expect((await grant(ctx, "admin", { expiresAt: undefined })).status).toBe(400);
    expect((await grant(ctx, "admin", { expiresAt: "2026-11-28" })).status).toBe(400);
    expect((await grant(ctx, "admin", { expiresAt: ctx.clock.t })).status).toBe(400);
    expect((await grant(ctx, "admin", { expiresAt: ctx.clock.t - H })).status).toBe(400);
    const tooLong = await grant(ctx, "admin", { expiresAt: ctx.clock.t + 24 * H + 1 });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/24 horas/);
    expect(await ctx.store.list(T)).toEqual([]);
    expect((await grant(ctx, "admin", { expiresAt: ctx.clock.t + 24 * H })).status).toBe(200);
  });
  it("la suspensión exige motivo", async () => {
    await grant(ctx);
    expect((await suspend(ctx, "admin", "x")).status).toBe(400);
  });
});

describe("concesión, registro y suspensión", () => {
  it("concede con source=operator y registra operador, estado anterior/nuevo, motivo y caducidad", async () => {
    const exp = ctx.clock.t + 2 * H;
    const r = await grant(ctx, "admin", { expiresAt: exp });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, grant: { capabilityId: CAP, status: "active", validUntil: exp, source: "operator", updatedBy: "operator:op-admin" } });
    expect(r.body.event).toMatchObject({ capabilityId: CAP, fromStatus: null, toStatus: "active", actor: "operator:op-admin", at: NOW });
    expect(r.body.event.reason).toBe(`temporal hasta 2026-11-27T14:00Z · ${REASON}`);
    const ev = await ctx.store.events(T);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: "operator", actor: "operator:op-admin", toStatus: "active", fromStatus: null });
  });
  it("suspensión manual: evento con estado anterior/nuevo y motivo; la decisión pasa a denegada", async () => {
    await grant(ctx);
    const s = await suspend(ctx, "superadmin", "fin de la verificación");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ ok: true, grant: { status: "suspended" }, event: { fromStatus: "active", toStatus: "suspended", actor: "operator:op-superadmin" } });
    expect(s.body.event.reason).toContain("fin de la verificación");
    expect(decide(await ctx.store.list(T), CAP, { write: false, now: ctx.clock.t }).allowed).toBe(false);
    expect((await suspend(ctx)).status).toBe(409);
    expect((await grant(ctx)).status).toBe(200);
  });
  it("suspender lo que no existe → 404", async () => {
    expect((await suspend(ctx)).status).toBe(404);
  });
  it("GET devuelve solo concesiones y eventos de operador, con la forma del contrato", async () => {
    await ctx.store.apply(T, [{ capabilityId: "crm-leads", siteId: "", status: "active", validUntil: null, source: "subscription:7" }], { actor: "system", reason: "alta", now: NOW });
    await grant(ctx);
    const g = await call(ctx, "GET", `/tenants/${T}/temporary-capabilities`, "admin");
    expect(g.body.grants.map((x: any) => x.capabilityId)).toEqual([CAP]);
    expect(Object.keys(g.body.grants[0]).sort()).toEqual(["capabilityId", "source", "status", "updatedAt", "updatedBy", "validUntil"]);
    expect(g.body.events.map((x: any) => x.capabilityId)).toEqual([CAP]);
    expect(Object.keys(g.body.events[0]).sort()).toEqual(["actor", "at", "capabilityId", "fromStatus", "reason", "toStatus"]);
  });
});

describe("duplicados, concurrencia y otras fuentes", () => {
  it("concesión de operador vigente → 409 (para ampliar: suspender y conceder de nuevo)", async () => {
    expect((await grant(ctx)).status).toBe(200);
    const again = await grant(ctx, "second");
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/vigente/);
    expect((await ctx.store.list(T))[0].updatedBy).toBe("operator:op-admin");
  });
  it("dos POST simultáneos: uno gana y el otro 409", async () => {
    const [a, b] = await Promise.all([grant(ctx, "admin"), grant(ctx, "second")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await ctx.store.events(T)).toHaveLength(1);
  });
  it("si otra fuente (suscripción o prueba) concede la capacidad → 409 y no se pisa ni degrada", async () => {
    for (const source of ["subscription:9", "trial:3"]) {
      const store = new MemoryCapabilityStore();
      await store.apply(T, [{ capabilityId: CAP, siteId: "", status: "active", validUntil: null, source }], { actor: "system", reason: "alta", now: NOW });
      const svc = new TemporaryCapabilities({ store, now: () => NOW, environment: () => "alta-correo" });
      await expect(svc.grant(T, { capabilityId: CAP, reason: REASON, expiresAt: NOW + H }, "operator:x")).rejects.toMatchObject({ code: "conflict" });
      await expect(svc.suspend(T, CAP, REASON, "operator:x")).rejects.toMatchObject({ code: "not_found" });
      expect((await store.list(T))[0]).toMatchObject({ status: "active", validUntil: null, source });
      expect(await store.events(T)).toHaveLength(1);
    }
  });
  it("una concesión vencida se puede volver a conceder", async () => {
    await grant(ctx, "admin", { expiresAt: ctx.clock.t + H });
    ctx.clock.t += 2 * H;
    expect((await grant(ctx)).status).toBe(200);
  });
});

describe("caducidad automática", () => {
  const g = (over: object) => ({ tenantId: T, capabilityId: CAP, siteId: "", status: "active" as const, validUntil: null, source: "operator", updatedAt: 0, updatedBy: "x", ...over });
  it("decide: operator vencida no permite ni lectura (expired)", () => {
    const list = [g({ validUntil: NOW - 1 })];
    expect(decide(list, CAP, { write: false, now: NOW })).toMatchObject({ allowed: false, status: "expired" });
    expect(decide(list, CAP, { write: true, now: NOW })).toMatchObject({ allowed: false, status: "expired" });
    expect(decide([g({ validUntil: NOW + 1 })], CAP, { write: true, now: NOW })).toMatchObject({ allowed: true, status: "active" });
    expect(decide([g({ validUntil: null })], CAP, { write: true, now: NOW }).allowed).toBe(true);
  });
  it("decide (regresión): suscripción/prueba activa vencida sigue en solo lectura", () => {
    for (const source of ["subscription:1", "trial:1"]) {
      const list = [g({ source, validUntil: NOW - 1 })];
      expect(decide(list, CAP, { write: false, now: NOW })).toMatchObject({ allowed: true, status: "read_only" });
      expect(decide(list, CAP, { write: true, now: NOW })).toMatchObject({ allowed: false, status: "expired" });
    }
  });
  it("barrido: suspende las vencidas con evento system:expiry, es idempotente y no toca las vigentes ni otras fuentes", async () => {
    const svc = new TemporaryCapabilities({ store: ctx.store, now: () => ctx.clock.t, environment: () => "alta-correo" });
    await grant(ctx, "admin", { expiresAt: ctx.clock.t + H });
    await ctx.store.apply(OTHER, [{ capabilityId: CAP, siteId: "", status: "active", validUntil: ctx.clock.t - 1, source: "subscription:5" }], { actor: "system", reason: "alta", now: NOW });
    expect(await svc.sweep()).toBe(0);
    ctx.clock.t += 2 * H;
    expect(await svc.sweep()).toBe(1);
    expect(await svc.sweep()).toBe(0);
    expect((await ctx.store.list(T))[0].status).toBe("suspended");
    expect((await ctx.store.list(OTHER))[0].status).toBe("active");
    expect((await ctx.store.events(T))[0]).toMatchObject({ actor: "system:expiry", reason: "caducidad automática", fromStatus: "active", toStatus: "suspended", source: "operator" });
    expect(await ctx.store.events(T)).toHaveLength(2);
  });
});

describe("aislamiento y ausencia de efectos", () => {
  it("el tenant A no cambia el tenant B; solo se escribe el registro de capacidades (sin módulos ni suscripciones)", async () => {
    await ctx.store.apply(OTHER, [{ capabilityId: "crm-leads", siteId: "", status: "active", validUntil: null, source: "subscription:2" }], { actor: "system", reason: "alta", now: NOW });
    const before = JSON.stringify(await ctx.store.list(OTHER));
    const evBefore = (await ctx.store.events(OTHER)).length;
    await grant(ctx);
    await suspend(ctx);
    expect(JSON.stringify(await ctx.store.list(OTHER))).toBe(before);
    expect((await ctx.store.events(OTHER)).length).toBe(evBefore);
    // Esta app no tiene suscripciones, pedidos ni facturación montados: la herramienta funciona sin ellos
    // (no depende de ninguno) y la fila escrita es exclusivamente de operador.
    expect((await ctx.store.list(T)).every((x) => x.source === "operator")).toBe(true);
  });
});
