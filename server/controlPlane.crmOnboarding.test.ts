/**
 * Onboarding desde el CRM: validaciones, aprovisionamiento reanudable (servicio real con dobles
 * en memoria), prueba del plan (motor real, cobros apagados), enlace empresa ↔ tenant y ámbitos.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { CrmOnboarding } from "./crm/onboarding";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { SubscriptionService } from "./_core/billing/service";
import { FakeProvider, MemoryBillingStore, RecordingEffects } from "./_core/billing/memory";
import type { Catalog } from "./_core/billing/types";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { deliverAdminInvite, withAdminInviteDelivery } from "./controlPlane/adminInviteDelivery";
import type { CoreAccessClient } from "./controlPlane/tenantAccess";

const OP: Actor = { type: "operator", id: "ana" };
const catalog: Catalog = {
  trialDays: 15,
  graceDays: 7,
  trial: { maxCustomDomains: 0, integrations: [], quotas: [] },
  plans: [
    { id: "base", name: "Base", kind: "base", interval: "month", priceCents: null, currency: "EUR", includedModules: ["cms"], maxCustomDomains: 1, quotas: [] },
  ],
  modules: [],
};

function world(opts: { billing?: boolean } = {}) {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  const fail = { schema: 0 };
  const grants: string[] = [];
  const provisioning = new ProvisioningService({
    registry,
    reader: reg,
    databases: { ensureDatabase: async (id) => ({ dsn: `mysql://u:p@db.invalid:3306/es_${id}`, serverAlias: "t" }), dropDatabase: async () => undefined },
    schema: {
      apply: async () => {
        if (fail.schema > 0) {
          fail.schema--;
          throw new Error("fallo simulado");
        }
        return { baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" };
      },
    },
    seeder: { seedAdmin: async () => ({ created: true, inviteToken: "INV-" + crypto.randomBytes(4).toString("hex") }), seedBranding: async () => undefined },
    entitlements: { grant: async (t, m) => void grants.push(`${t}:${m}`) },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    sleep: async () => undefined,
  });
  const billingStore = new MemoryBillingStore();
  const billing = opts.billing === false ? undefined : new SubscriptionService({ catalog, store: billingStore, provider: new FakeProvider(), effects: new RecordingEffects() });
  const store = new MemoryCrmStore();
  const crm = new CrmService({ store });
  const onboarding = new CrmOnboarding({ store, crm, provisioning, registry: reg, billing, platformDomain: "elephantsource.es" });
  return { reg, registry, ring, provisioning, billing, billingStore, store, crm, onboarding, fail, grants };
}

async function companyWithAdmin(w: ReturnType<typeof world>, name = "Acme Hotel") {
  const c = await w.crm.createCompany({ name, email: "info@acme.example" }, "op");
  const k = await w.crm.createContact(c.id, { firstName: "Eva", lastName: "Gil", email: "eva@acme.example" }, "op");
  return { c, k };
}

describe("onboarding desde el CRM", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it("alta completa: plataforma, prueba del plan, módulos, enlace y registro", async () => {
    const { c, k } = await companyWithAdmin(w);
    const r = await w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id, planId: "base", modules: ["hotel", "spa"] }, OP);
    expect(r.status).toBe("completed");
    expect(r.domain).toBe("acme.elephantsource.es");
    expect(r.provisioning.adminInviteToken).toMatch(/^INV-/);
    expect(r.subscription).toMatchObject({ tenantId: "acme", planId: "base", status: "trialing" });
    expect(r.company.tenantId).toBe("acme");
    expect(w.grants).toEqual(expect.arrayContaining(["acme:hotel", "acme:spa"]));
    expect((await w.reg.getTenant("acme"))?.displayName).toBe("Acme Hotel");
    expect((await w.crm.getCompany(c.id)).lifecycle).toBe("tenant");
    expect((await w.crm.timeline("company", c.id))[0].summary).toContain("Alta de plataforma: acme.elephantsource.es");
    // Repetir no crea otra plataforma
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id }, OP)).rejects.toMatchObject({ code: "conflict" });
  });

  it("validaciones: empresa activa, administrador de la empresa con correo, módulos y días", async () => {
    const { c, k } = await companyWithAdmin(w);
    const other = await companyWithAdmin(w, "Otra");
    const noMail = await w.crm.createContact(c.id, { firstName: "Sin", phone: "600" }, "op");
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: other.k.id }, OP)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: noMail.id }, OP)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id, modules: ["Hotel!"] }, OP)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id, trialDays: 120 }, OP)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(w.onboarding.onboard(c.id, { tenantId: "../x", adminContactId: k.id }, OP)).rejects.toMatchObject({ code: "invalid_input" });
    await w.crm.updateContact(k.id, { status: "inactive" }, "op");
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id }, OP)).rejects.toMatchObject({ code: "invalid_input" });
    await w.crm.updateCompany(c.id, { status: "inactive" }, "op");
    await expect(w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id }, OP)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(w.onboarding.onboard(999, { tenantId: "acme", adminContactId: k.id }, OP)).rejects.toMatchObject({ code: "not_found" });
    expect(await w.reg.getTenant("acme")).toBeNull(); // nada aprovisionado
  });

  it("un subdominio en uso por otra empresa o por otro tenant no se reutiliza", async () => {
    const a = await companyWithAdmin(w, "Uno");
    const b = await companyWithAdmin(w, "Dos");
    await w.onboarding.onboard(a.c.id, { tenantId: "uno", adminContactId: a.k.id }, OP);
    expect(await w.onboarding.check("uno", b.c.id)).toMatchObject({ available: false });
    await expect(w.onboarding.onboard(b.c.id, { tenantId: "uno", adminContactId: b.k.id }, OP)).rejects.toMatchObject({ code: "conflict" });
    // Tenant creado fuera del CRM
    await w.provisioning.run({ tenantId: "externo", displayName: "Externo", adminEmail: "x@x.example", platformDomain: "elephantsource.es" }, OP);
    await expect(w.onboarding.onboard(b.c.id, { tenantId: "externo", adminContactId: b.k.id }, OP)).rejects.toMatchObject({ code: "conflict" });
    expect(await w.onboarding.check("libre", b.c.id)).toEqual({ available: true, reason: null, domain: "libre.elephantsource.es" });
    expect((await w.onboarding.check("A", b.c.id)).available).toBe(false);
  });

  it("un alta que falla queda incompleta, sin enlazar, y el reintento la reanuda", async () => {
    const { c, k } = await companyWithAdmin(w);
    w.fail.schema = 10;
    const r1 = await w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id, planId: "base" }, OP);
    expect(r1.status).toBe("incomplete");
    expect(r1.provisioning.failedStep).toBeDefined();
    expect(r1.subscription).toBeNull();
    expect((await w.store.get("companies", c.id))!.tenantId).toBeNull();
    expect(await w.billingStore.getSubscriptionByTenant("acme")).toBeNull(); // sin prueba si no hay plataforma
    expect(await w.onboarding.check("acme", c.id)).toMatchObject({ available: true, reason: expect.stringContaining("reanudará") });
    w.fail.schema = 0;
    const r2 = await w.onboarding.onboard(c.id, { tenantId: "acme", adminContactId: k.id, planId: "base" }, OP);
    expect(r2).toMatchObject({ status: "completed", company: { tenantId: "acme" }, subscription: { status: "trialing" } });
  });

  it("facturación no configurada o plan no válido: la plataforma se crea y se avisa", async () => {
    const nb = world({ billing: false });
    const a = await companyWithAdmin(nb);
    const r = await nb.onboarding.onboard(a.c.id, { tenantId: "sinfact", adminContactId: a.k.id, planId: "base" }, OP);
    expect(r).toMatchObject({ status: "completed", subscription: null });
    expect(r.notes[0]).toMatch(/no configurada/);
    const b = await companyWithAdmin(w);
    const r2 = await w.onboarding.onboard(b.c.id, { tenantId: "planmal", adminContactId: b.k.id, planId: "no-existe" }, OP);
    expect(r2).toMatchObject({ status: "completed", subscription: null, company: { tenantId: "planmal" } });
    expect(r2.notes.join(" ")).toMatch(/Prueba no iniciada/);
  });
});

describe("API de onboarding", () => {
  let server: http.Server;
  let port: number;
  let w: ReturnType<typeof world>;
  const FULL = "onb-full-token-aaaaaaaaaaaaaaaaaaaaaa";
  const NOPROV = "onb-noprov-token-bbbbbbbbbbbbbbbbbbb";
  const NOBILL = "onb-nobill-token-ccccccccccccccccccc";
  let ids: { c: number; k: number };

  beforeAll(async () => {
    w = world();
    const x = await companyWithAdmin(w, "Api Co");
    ids = { c: x.c.id, k: x.k.id };
    const app = createControlPlaneApp({
      tokens: [
        { id: "ana", sha256: hashToken(FULL), scopes: ["crm:read", "crm:write", "provisioning:write", "billing:write"] },
        { id: "comercial", sha256: hashToken(NOPROV), scopes: ["crm:read", "crm:write"] },
        { id: "ops", sha256: hashToken(NOBILL), scopes: ["crm:read", "crm:write", "provisioning:write"] },
      ],
      registry: w.registry,
      reader: w.reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      platformDomain: "elephantsource.es",
      provisioning: w.provisioning,
      billing: w.billing,
      billingStore: w.billingStore,
      crm: { service: w.crm, store: w.store },
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = (method: string, path: string, token: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1/crm${path}`,
          method,
          headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });

  it("configuración y comprobación de subdominio", async () => {
    expect((await call("GET", "/onboarding/config", NOPROV)).json).toEqual({ available: true, platformDomain: "elephantsource.es", billing: true, defaultTrialDays: 15, subdomainsRoutable: true });
    expect((await call("GET", `/onboarding/check?tenantId=api-co&companyId=${ids.c}`, NOPROV)).json).toMatchObject({ available: true, domain: "api-co.elephantsource.es" });
  });

  it("ámbitos: sin provisioning:write 403; plan sin billing:write 403; campos extra 400", async () => {
    expect((await call("POST", `/companies/${ids.c}/onboard`, NOPROV, { tenantId: "api-co", adminContactId: ids.k })).status).toBe(403);
    expect((await call("POST", `/companies/${ids.c}/onboard`, NOBILL, { tenantId: "api-co", adminContactId: ids.k, planId: "base" })).status).toBe(403);
    expect((await call("POST", `/companies/${ids.c}/onboard`, FULL, { tenantId: "api-co", adminContactId: ids.k, platformDomain: "evil.example" })).status).toBe(400);
    expect(await w.reg.getTenant("api-co")).toBeNull();
  });

  it("alta completa por API (201) y repetición rechazada (409)", async () => {
    const r = await call("POST", `/companies/${ids.c}/onboard`, FULL, { tenantId: "api-co", adminContactId: ids.k, planId: "base", modules: ["hotel"] });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: "completed", domain: "api-co.elephantsource.es", company: { tenantId: "api-co" }, subscription: { status: "trialing" } });
    expect((await call("POST", `/companies/${ids.c}/onboard`, FULL, { tenantId: "api-co", adminContactId: ids.k })).status).toBe(409);
  });
});

describe("entrega de la invitación del administrador tras el alta", () => {
  // Core simulado: lista de Accesos con el modo y el ámbito del correo, e invitación con el resultado del envío
  function core(o: { mailMode: "off" | "sandbox" | "live"; invite?: boolean; mail?: string; status?: number }) {
    const calls: Array<{ act: string; uid?: number; confirm?: string; tenantId: string }> = [];
    const client: CoreAccessClient = {
      async call(x) {
        calls.push({ act: x.act, uid: x.uid, confirm: x.confirm, tenantId: x.tenantId });
        if (o.status) return { status: o.status, body: { error: "core_unreachable" } };
        if (x.act === "list") return { status: 200, body: { mailMode: o.mailMode, accessMail: { invite: o.invite ?? true, reset: true }, users: [{ id: 7, email: "Eva@Acme.example" }] } };
        return { status: 200, body: { ok: true, mail: o.mail ?? "sent" } };
      },
    };
    return { client, calls };
  }
  const delivered = (k: ReturnType<typeof core>) => () => deliverAdminInvite(k.client, { tenantId: "acme", adminEmail: "eva@acme.example", operator: "operator:ana" });

  it("con el correo de acceso operativo: sale por correo y el enlace NO se devuelve al operador", async () => {
    const k = core({ mailMode: "live" });
    const r = await withAdminInviteDelivery({ status: "completed", adminInviteToken: "INV-secreto" }, delivered(k));
    expect(r).not.toHaveProperty("adminInviteToken");
    expect(JSON.stringify(r)).not.toContain("INV-secreto");
    expect(r.adminInvite).toEqual({ delivery: "email" });
    expect(k.calls.map((x) => [x.act, x.uid, x.confirm])).toEqual([["list", undefined, undefined], ["invite", 7, "eva@acme.example"]]);
  });

  it("correo apagado o empresa fuera de ámbito: no se invita y el enlace se muestra una vez, como antes", async () => {
    for (const [k, reason] of [[core({ mailMode: "off" }), "mail_disabled"], [core({ mailMode: "live", invite: false }), "scope_blocked"]] as const) {
      const r = await withAdminInviteDelivery({ status: "completed", adminInviteToken: "INV-1" }, delivered(k));
      expect(r.adminInviteToken).toBe("INV-1");
      expect(r.adminInvite).toEqual({ delivery: "operator", reason });
      expect(k.calls.map((x) => x.act)).toEqual(["list"]);
    }
  });

  it("sandbox que no deja salir al destinatario, o Core caído: se conserva la entrega manual y el alta no falla", async () => {
    const sb = await withAdminInviteDelivery({ status: "completed", adminInviteToken: "INV-2" }, delivered(core({ mailMode: "sandbox", mail: "sandbox_blocked" })));
    expect(sb).toMatchObject({ adminInviteToken: "INV-2", adminInvite: { delivery: "operator", reason: "sandbox_blocked" } });
    const down = await withAdminInviteDelivery({ status: "completed", adminInviteToken: "INV-3" }, delivered(core({ mailMode: "live", status: 503 })));
    expect(down).toMatchObject({ adminInviteToken: "INV-3", adminInvite: { delivery: "operator", reason: "core_unavailable" } });
    const thrown = await withAdminInviteDelivery({ status: "completed", adminInviteToken: "INV-4" }, async () => { throw new Error("x"); });
    expect(thrown.adminInviteToken).toBe("INV-4");
  });

  it("sin token (alta reanudada o incompleta) no se llama al Core", async () => {
    const k = core({ mailMode: "live" });
    expect(await withAdminInviteDelivery({ status: "completed" }, delivered(k))).toEqual({ status: "completed" });
    expect(await withAdminInviteDelivery({ status: "failed", adminInviteToken: "x" }, delivered(k))).toMatchObject({ adminInviteToken: "x" });
    expect(k.calls).toEqual([]);
  });

  it("alta desde el CRM con correo operativo: la respuesta no lleva el enlace y se anota el envío", async () => {
    const w = world();
    const k = core({ mailMode: "live" });
    const onboarding = new CrmOnboarding({ store: w.store, crm: w.crm, provisioning: w.provisioning, registry: w.reg, billing: w.billing, platformDomain: "elephantsource.es", deliverInvite: (t, e, a) => deliverAdminInvite(k.client, { tenantId: t, adminEmail: e, operator: `${a.type}:${a.id}` }) });
    const { c, k: contact } = await companyWithAdmin(w);
    const r = await onboarding.onboard(c.id, { tenantId: "acme-correo", adminContactId: contact.id }, OP);
    expect(r.status).toBe("completed");
    expect(r.provisioning.adminInviteToken).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/INV-/);
    expect(r.notes).toContain("Invitación enviada por correo a eva@acme.example");
    expect(k.calls.find((x) => x.act === "invite")).toMatchObject({ tenantId: "acme-correo", confirm: "eva@acme.example" });
  });
});
