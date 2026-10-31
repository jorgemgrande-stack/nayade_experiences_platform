/**
 * Restricciones de la prueba gratuita (flujo actual): estado comercial único, dominio propio tras el primer pago
 * confirmado, correo a terceros, integraciones de pago, cuotas de prueba y exención explícita por empresa.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, type ServiceToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { QuotaExceededError } from "./_core/erm/types";
import {
  customDomainDecision,
  DEFAULT_TRIAL_EXEMPT_TENANTS,
  exemptTenantsFromEnv,
  integrationAllowed,
  quotaPolicyForPhase,
  resolveCommercialState,
  splitTrialRecipients,
  TRIAL_QUOTA_POLICY,
  TRIAL_EXPIRED_QUOTA_POLICY,
  type CommercialState,
} from "./commercialState";
import { applyTrialMailPolicy, assertIntegrationAllowed, enforceTrialQuota } from "./trialRestrictions";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 12);
const NONE = new Set<string>();
const trialGrant = (days: number) => ({ source: "trial:7", status: "active" as const, validUntil: NOW + days * DAY });
const paidGrant = { source: "subscription:9", status: "active" as const, validUntil: null };

const inTrial = (o: Partial<Parameters<typeof resolveCommercialState>[0]> = {}) =>
  resolveCommercialState({ multi: true, tenantId: "t-prueba", status: "trial", grants: [trialGrant(6)], now: NOW, exempt: NONE, ...o });
const contracted = (): CommercialState => resolveCommercialState({ multi: true, tenantId: "t-cliente", status: "active", grants: null, now: NOW, exempt: NONE });

describe("estado comercial", () => {
  it("prueba vigente: días restantes, sin primer pago y con restricciones", () => {
    const s = inTrial();
    expect(s).toMatchObject({ phase: "trial", inTrial: true, trialDaysLeft: 6, firstPaymentConfirmed: false, restricted: true, exempt: false });
  });

  it("prueba vencida: sigue restringida con 0 días", () => {
    expect(inTrial({ grants: [trialGrant(-1)] })).toMatchObject({ phase: "trial_expired", trialDaysLeft: 0, restricted: true });
  });

  it("contratada (registro active o grace) o alta asistida con licencia de pago: sin restricciones", () => {
    expect(contracted()).toMatchObject({ phase: "contracted", firstPaymentConfirmed: true, restricted: false, trialDaysLeft: null });
    expect(resolveCommercialState({ multi: true, tenantId: "x", status: "grace", grants: null, now: NOW, exempt: NONE })).toMatchObject({ phase: "grace", firstPaymentConfirmed: true, restricted: false });
    expect(inTrial({ grants: [trialGrant(3), paidGrant] })).toMatchObject({ phase: "contracted", restricted: false });
  });

  it("pedido del orquestador con el pago confirmado cuenta como primer pago; el de otra empresa no", () => {
    const confirmation = { kind: "payment" as const, ref: "1", actor: "system", reason: null, at: NOW };
    expect(inTrial({ status: "suspended", orders: [{ tenantId: "t-prueba", confirmation }] }).firstPaymentConfirmed).toBe(true);
    expect(inTrial({ status: "suspended", orders: [{ tenantId: "t-otra", confirmation }] }).firstPaymentConfirmed).toBe(false);
    expect(inTrial({ status: "suspended", orders: [{ tenantId: "t-prueba", confirmation: null }] }).firstPaymentConfirmed).toBe(false);
  });

  it("sin poder verificar las licencias (sin estado): no restringe", () => {
    expect(inTrial({ status: null, grants: "unavailable" })).toMatchObject({ phase: "unknown", restricted: false });
  });

  it("fuera de multiempresa: nada cambia", () => {
    expect(resolveCommercialState({ multi: false, tenantId: null, status: null, grants: null, now: NOW })).toMatchObject({ phase: "unmanaged", restricted: false, firstPaymentConfirmed: true });
  });
});

describe("exención explícita por empresa", () => {
  it("t5-skibox está exenta por defecto (sin variable)", () => {
    expect(DEFAULT_TRIAL_EXEMPT_TENANTS).toContain("t5-skibox");
    expect(exemptTenantsFromEnv({} as NodeJS.ProcessEnv).has("t5-skibox")).toBe(true);
  });

  it("la variable manda: lista propia o vacía", () => {
    expect([...exemptTenantsFromEnv({ TRIAL_RESTRICTIONS_EXEMPT_TENANTS: " t-a , t-b ," } as NodeJS.ProcessEnv)]).toEqual(["t-a", "t-b"]);
    expect(exemptTenantsFromEnv({ TRIAL_RESTRICTIONS_EXEMPT_TENANTS: "" } as NodeJS.ProcessEnv).size).toBe(0);
  });

  it("una empresa exenta en prueba no tiene restricciones y puede conectar su dominio", () => {
    const s = inTrial({ tenantId: "t-exenta", exempt: new Set(["t-exenta"]) });
    expect(s).toMatchObject({ phase: "trial", exempt: true, restricted: false });
    expect(customDomainDecision(s).allowed).toBe(true);
    expect(integrationAllowed(s, "ghl")).toBe(true);
  });
});

describe("dominio propio", () => {
  it("bloqueado en prueba, permitido tras el primer pago confirmado", () => {
    const d = customDomainDecision(inTrial());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.message).toMatch(/primer pago confirmado/);
    expect(customDomainDecision(contracted()).allowed).toBe(true);
  });
});

describe("plano de control: alta de dominio propio sin el motor antiguo", () => {
  const TOKEN = "ci-only-placeholder-not-a-secret-1";
  const tokens: ServiceToken[] = [{ id: "crm-main", sha256: hashToken(TOKEN), scopes: ["tenants:read", "tenants:write", "domains:write"] }];
  let server: http.Server;
  let port: number;
  let registry: TenantRegistryService;
  const caps = new MemoryCapabilityStore();
  const actor = { type: "operator" as const, id: "seed" };

  const post = (path: string, body: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port, path, method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      req.end(data);
    });

  beforeAll(async () => {
    const store = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    registry = new TenantRegistryService(store, () => ring);
    await registry.createTenant({ id: "t-prueba", displayName: "Empresa en prueba" }, actor);
    await registry.setStatus("t-prueba", "trial", actor);
    await caps.apply("t-prueba", [{ capabilityId: "core.panel", siteId: "", status: "active", validUntil: Date.now() + 10 * DAY, source: "trial:1" }], { actor: "test", reason: null, now: Date.now() });
    const app = createControlPlaneApp({
      tokens,
      registry,
      reader: store,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined, apply: async () => ({ changed: false, previous: null, entitlement: null as any }), remove: async () => ({ changed: false, previous: null }) },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      capabilities: caps,
      platformTarget: "edge.elephantsource.es",
      perMinute: 1000,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("en prueba: 403 con mensaje claro; el subdominio de plataforma sigue permitido", async () => {
    const denied = await post("/cp/v1/tenants/t-prueba/domains", { domain: "empresa-prueba.example.com", kind: "custom" });
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: "custom_domain_requires_payment" });
    expect(denied.json.message).toMatch(/primer pago confirmado/);
    const sub = await post("/cp/v1/tenants/t-prueba/domains", { domain: "t-prueba.elephantsource.es", kind: "platform_subdomain" });
    expect(sub.status).toBe(201);
  });

  it("tras el primer pago confirmado (el orquestador pasa el registro a active): permitido", async () => {
    await registry.setStatus("t-prueba", "active", actor);
    const ok = await post("/cp/v1/tenants/t-prueba/domains", { domain: "empresa-prueba.example.com", kind: "custom" });
    expect(ok.status).toBe(201);
  });
});

describe("integraciones externas de pago", () => {
  it("GHL y Vapi bloqueadas en prueba con error claro; contratada sin restricciones", async () => {
    const s = inTrial();
    expect(integrationAllowed(s, "ghl")).toBe(false);
    expect(integrationAllowed(s, "vapi")).toBe(false);
    await expect(assertIntegrationAllowed("vapi", s)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/prueba gratuita.*Vapi/) });
    await expect(assertIntegrationAllowed("ghl", contracted())).resolves.toBeUndefined();
  });
});

describe("cuotas de prueba", () => {
  it("política «trial» consultable solo en prueba y más baja que la de la plataforma", () => {
    expect(quotaPolicyForPhase(inTrial())).toBe(TRIAL_QUOTA_POLICY);
    expect(quotaPolicyForPhase(contracted())).toBeNull();
    expect(TRIAL_QUOTA_POLICY.map((q) => q.metric)).toEqual(expect.arrayContaining(["email.sent", "llm.tokens.input", "storage.write.bytes"]));
  });

  it("IA de la plataforma: se frena al agotar la cuota de prueba; contratada no", async () => {
    const limit = TRIAL_QUOTA_POLICY.find((q) => q.metric === "llm.tokens.input")!.limit;
    await expect(enforceTrialQuota("llm.tokens.input", 0, { state: async () => inTrial(), usage: async () => limit - 1 })).resolves.toBeUndefined();
    await expect(enforceTrialQuota("llm.tokens.input", 0, { state: async () => inTrial(), usage: async () => limit })).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(enforceTrialQuota("llm.tokens.input", 0, { state: async () => contracted(), usage: async () => limit * 10 })).resolves.toBeUndefined();
  });

  it("prueba vencida o detenida (licencias suspendidas o en solo lectura): sin IA, imágenes ni escritura; el correo conserva su tope", async () => {
    const suspended = inTrial({ grants: [{ ...trialGrant(6), status: "suspended" as const }] });
    const readOnly = inTrial({ grants: [{ ...trialGrant(6), status: "read_only" as const }] });
    const expired = inTrial({ grants: [trialGrant(-1)] });
    for (const s of [suspended, readOnly, expired]) {
      expect(s).toMatchObject({ phase: "trial_expired", restricted: true });
      expect(quotaPolicyForPhase(s)).toBe(TRIAL_EXPIRED_QUOTA_POLICY);
      await expect(enforceTrialQuota("llm.tokens.input", 1, { state: async () => s, usage: async () => 0 })).rejects.toBeInstanceOf(QuotaExceededError);
      await expect(enforceTrialQuota("storage.write.bytes", 1, { state: async () => s, usage: async () => 0 })).rejects.toBeInstanceOf(QuotaExceededError);
      await expect(enforceTrialQuota("email.sent", 1, { state: async () => s, usage: async () => 0 })).resolves.toBeUndefined();
    }
    for (const q of TRIAL_EXPIRED_QUOTA_POLICY) expect(q.limit).toBe(q.metric === "email.sent" ? TRIAL_QUOTA_POLICY.find((x) => x.metric === q.metric)!.limit : 0);
    // Una prueba vigente sigue con su cuota; una exenta, sin restricciones
    expect(quotaPolicyForPhase(inTrial())).toBe(TRIAL_QUOTA_POLICY);
    expect(quotaPolicyForPhase(inTrial({ grants: [{ ...trialGrant(6), status: "suspended" as const }], exempt: new Set(["t-prueba"]) }))).toBeNull();
  });
});

describe("correo durante la prueba", () => {
  const deps = (state: CommercialState, used = 0) => ({
    state: async () => state,
    usage: async () => used,
    configMailboxes: () => ["reservas@empresa-prueba.example"],
    ownMailboxes: async (c: string[]) => new Set(c.filter((e) => e === "admin@empresa-prueba.example")),
  });

  it("separa buzones propios y terceros", () => {
    expect(splitTrialRecipients(["Admin <ADMIN@x.example>", "cliente@y.example"], undefined, new Set(["admin@x.example"]))).toEqual({ to: ["Admin <ADMIN@x.example>"], cc: [], removed: 1 });
  });

  it("a terceros: no sale; a los buzones propios sí (sin los terceros)", async () => {
    expect(await applyTrialMailPolicy({ to: "cliente@gmail.example", category: "operational" }, deps(inTrial()))).toBeNull();
    const mixed = await applyTrialMailPolicy({ to: ["cliente@gmail.example", "admin@empresa-prueba.example"], cc: ["reservas@empresa-prueba.example", "otro@gmail.example"], category: "operational" }, deps(inTrial()));
    expect(mixed).toMatchObject({ to: ["admin@empresa-prueba.example"], cc: ["reservas@empresa-prueba.example"] });
  });

  it("tope diario de prueba: al agotarlo no sale ni a los buzones propios", async () => {
    const limit = TRIAL_QUOTA_POLICY.find((q) => q.metric === "email.sent")!.limit;
    expect(await applyTrialMailPolicy({ to: "admin@empresa-prueba.example", category: "operational" }, deps(inTrial(), limit))).toBeNull();
  });

  it("transaccionales de acceso (invitación, restablecimiento, seguridad, verificación): siempre", async () => {
    for (const category of ["user_invite", "password_reset", "security_notice", "email_verification"]) {
      const p = { to: "nuevo@gmail.example", category };
      expect(await applyTrialMailPolicy(p, deps(inTrial(), 10_000))).toBe(p);
    }
  });

  it("contratada o exenta: el correo a terceros sale sin cambios", async () => {
    const p = { to: "cliente@gmail.example", category: "operational" };
    expect(await applyTrialMailPolicy(p, deps(contracted()))).toBe(p);
    expect(await applyTrialMailPolicy(p, deps(inTrial({ tenantId: "t-exenta", exempt: new Set(["t-exenta"]) })))).toBe(p);
  });
});
