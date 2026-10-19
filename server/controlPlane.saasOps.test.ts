/**
 * Endpoints del plano de control para Operación SaaS (CRM interno), por HTTP y con sus ámbitos:
 *  - GET  /tenants/:id/organization → limits.users (catálogo) y used.users (null: no se cuenta aquí)
 *  - GET  /trials/:id/events
 *  - POST /trials/:id/suspend y /reactivate (con sus licencias)
 *  - GET  /provisioning?status= (listado global paginado, sin datos personales)
 *  - POST /provisioning/:id/retry (idempotente, con la petición guardada)
 *  - GET  /crm/requests?companyId=
 * Y los correos de la prueba y de la conversión: solo por el puerto de avisos; nada sale por SMTP.
 *
 * Aprovisionamiento REAL con registro en memoria (solo la creación física de la BD y el sembrado son
 * dobles), catálogo oficial, suscripciones, licencias por capacidad y un buzón en memoria.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

// Ningún correo real: si algo intentase abrir un transporte SMTP, la prueba lo detecta
const smtp = vi.hoisted(() => ({ createTransport: 0, sendMail: 0 }));
vi.mock("nodemailer", () => {
  const createTransport = () => {
    smtp.createTransport++;
    return { sendMail: async () => void smtp.sendMail++ };
  };
  return { default: { createTransport }, createTransport };
});

import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp, type ControlPlaneDeps } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { MemoryOrganizationStore } from "./organization/service";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import type { TrialNotifier } from "./trials/onboarding";
import { trialNotifierFromEnv } from "./trials/emailNotifier";
import type { LeadRequest } from "./crm/types";

const DAY = 86_400_000;
const OPS = "saas-ops-token-aaaaaaaaaaaaaaaaaaaaaa"; // gitleaks:allow
const READER = "saas-ops-lectura-bbbbbbbbbbbbbbbbbbbb"; // gitleaks:allow
let clock = Date.UTC(2026, 9, 16, 9);
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const crm = new CrmService({ store: crmStore });
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
let failProvisioning = 0;
let seededAdmins = 0;
const servers: http.Server[] = [];
let port = 0;
let quietPort = 0;

const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};

const call = (method: string, p: string, o: { token?: string; body?: unknown; port?: number } = {}) =>
  new Promise<{ status: number; json: any; raw: string }>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request(
      { host: "127.0.0.1", port: o.port ?? port, path: `/cp/v1${p}`, method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null, raw: b }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });

async function listen(deps: ControlPlaneDeps) {
  const s = http.createServer(createControlPlaneApp(deps));
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servers.push(s);
  return (s.address() as AddressInfo).port;
}

beforeAll(async () => {
  const registryReader = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(registryReader, () => ring);
  const provisioning = new ProvisioningService({
    registry,
    reader: registryReader,
    databases: {
      ensureDatabase: async (id) => {
        if (failProvisioning > 0) {
          failProvisioning--;
          throw new Error("servidor de BD no disponible");
        }
        return { dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" };
      },
      dropDatabase: async () => undefined,
    },
    schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
    seeder: { seedAdmin: async () => (seededAdmins++, { created: true, inviteToken: crypto.randomBytes(8).toString("hex") }), seedBranding: async () => undefined },
    entitlements: { grant: async () => undefined },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    now: () => clock,
    sleep: async () => undefined,
  });
  const webStore = new MemoryWebStore();
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  const base: ControlPlaneDeps = {
    tokens: [
      { id: "ops", sha256: hashToken(OPS), scopes: ["tenants:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "crm:read"] },
      { id: "lectura", sha256: hashToken(READER), scopes: ["tenants:read", "subscriptions:read"] },
    ],
    registry,
    reader: registryReader,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    organization: new MemoryOrganizationStore(),
    trials: { store: trialStore, publicEnabled: true, autoProvision: true, notify },
  };
  port = await listen(base);
  // Misma configuración SIN puerto de avisos: el aviso por defecto solo deja constancia
  quietPort = await listen({ ...base, trials: { store: new MemoryTrialStore(), publicEnabled: true, autoProvision: false } });
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

const key = () => crypto.randomBytes(12).toString("hex");
const access = () => new CapabilityAccess(caps, { enforce: true, now: () => clock });

describe("Operación SaaS: endpoints del plano de control", () => {
  let trialId = 0;
  let tenantId = "";

  beforeAll(async () => {
    await call("POST", "/public/trial", { body: { email: "ana@hotelsol.example", companyName: "Hotel Sol", idempotencyKey: key() } });
    const v = outbox.find((m) => m.kind === "verification")!;
    trialId = v.data.trialId as number;
    const r = await call("POST", "/public/trial/verify", { body: { id: trialId, token: v.data.token } });
    expect(r.json.state).toBe("active");
    tenantId = (await trialStore.get(trialId))!.tenantId!;
  });

  it("organización: límite de usuarios del plan (catálogo: Essential 3) y usados no disponibles (null)", async () => {
    const r = await call("GET", `/tenants/${tenantId}/organization`, { token: READER });
    expect(r.status).toBe(200);
    expect(r.json.limits).toMatchObject({ sites: 1, fiscal_entities: 1, users: 3 });
    expect(r.json.used).toMatchObject({ sites: 0, fiscal_entities: 0, users: null });
    expect((await call("GET", "/tenants/no-existe/organization", { token: READER })).status).toBe(404);
    expect((await call("GET", `/tenants/${tenantId}/organization`)).status).toBe(401);
  });

  it("eventos de una prueba: historial ordenado; 404 si no existe; exige subscriptions:read", async () => {
    const r = await call("GET", `/trials/${trialId}/events`, { token: READER });
    expect(r.status).toBe(200);
    expect(r.json.events.map((e: any) => e.action)).toEqual(["registered", "verify", "request_provisioning", "provisioned"]);
    expect(r.raw).not.toMatch(/token|ipHash|verification_token/i);
    expect((await call("GET", "/trials/9999/events", { token: READER })).status).toBe(404);
    expect((await call("GET", `/trials/${trialId}/events`)).status).toBe(401);
  });

  it("suspender: la prueba y sus licencias quedan suspendidas; exige subscriptions:write y entitlements:write", async () => {
    const t = (await trialStore.get(trialId))!;
    expect((await call("POST", `/trials/${trialId}/suspend`, { token: READER, body: { reason: "Uso indebido", expectedVersion: t.version } })).status).toBe(403);
    expect((await call("POST", `/trials/${trialId}/suspend`, { token: OPS, body: { reason: "x", expectedVersion: t.version } })).status).toBe(400);
    expect((await call("POST", `/trials/${trialId}/suspend`, { token: OPS, body: { reason: "Uso indebido", expectedVersion: t.version - 1 } })).status).toBe(409);
    const r = await call("POST", `/trials/${trialId}/suspend`, { token: OPS, body: { reason: "Uso indebido", expectedVersion: t.version } });
    expect(r.status).toBe(200);
    expect(r.json.trial).toMatchObject({ state: "suspended", suspendedReason: "Uso indebido" });
    expect((await caps.list(tenantId)).every((g) => g.status === "suspended")).toBe(true);
    expect((await access().check("crm-leads", { write: false, tenantId })).allowed).toBe(false);
    // Suspender otra vez no es válido desde «suspendida»
    expect((await call("POST", `/trials/${trialId}/suspend`, { token: OPS, body: { reason: "Otra vez", expectedVersion: r.json.trial.version } })).status).toBe(409);
  });

  it("reactivar: licencias activas otra vez hasta el fin de la prueba; vencida no se reactiva", async () => {
    const t = (await trialStore.get(trialId))!;
    const r = await call("POST", `/trials/${trialId}/reactivate`, { token: OPS, body: { expectedVersion: t.version } });
    expect(r.status).toBe(200);
    expect(r.json.trial.state).toBe("active");
    expect(r.json.licencesChanged).toBeGreaterThan(0);
    expect((await caps.list(tenantId)).every((g) => g.status === "active" && g.validUntil === t.endsAt)).toBe(true);
    expect((await access().check("crm-leads", { write: true, tenantId })).allowed).toBe(true);
    const events = (await call("GET", `/trials/${trialId}/events`, { token: READER })).json.events.map((e: any) => e.action);
    expect(events.slice(-2)).toEqual(["suspend", "reactivate"]);
    // Una prueba suspendida y ya vencida no se reactiva (ampliar o convertir)
    const t2 = (await trialStore.get(trialId))!;
    await call("POST", `/trials/${trialId}/suspend`, { token: OPS, body: { reason: "Revisión", expectedVersion: t2.version } });
    clock += 20 * DAY;
    const t3 = (await trialStore.get(trialId))!;
    const late = await call("POST", `/trials/${trialId}/reactivate`, { token: OPS, body: { expectedVersion: t3.version } });
    expect(late.status).toBe(409);
    expect(late.json.message).toMatch(/vencido/);
    clock -= 20 * DAY;
  });

  it("aprovisionamiento: listado global por estado, paginado y sin el correo del administrador", async () => {
    failProvisioning = 3;
    const failed = await call("POST", "/provisioning", { token: OPS, body: { tenantId: "fallida-sl", displayName: "Fallida SL", adminEmail: "owner@fallida.example", platformDomain: "elephant.test" } });
    expect(failed.status).toBe(202);
    expect(failed.json.status).toBe("failed");
    const list = await call("GET", "/provisioning?status=failed", { token: READER });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(list.json.provisioning[0]).toMatchObject({ tenantId: "fallida-sl", displayName: "Fallida SL", status: "failed", failedStep: "database", completedSteps: 1 });
    expect(list.raw).not.toContain("owner@fallida.example");
    const all = await call("GET", "/provisioning?limit=1&offset=0", { token: READER });
    expect(all.json.total).toBe(2);
    expect(all.json.provisioning).toHaveLength(1);
    expect((await call("GET", "/provisioning?status=inventado", { token: READER })).status).toBe(400);
    expect((await call("GET", "/provisioning")).status).toBe(401);
  });

  it("reintento: reanuda con la petición guardada; repetido no duplica nada; exige provisioning:write", async () => {
    expect((await call("POST", "/provisioning/fallida-sl/retry", { token: READER })).status).toBe(403);
    expect((await call("POST", "/provisioning/fallida-sl/retry", { token: OPS, body: { displayName: "Otra" } })).status).toBe(400);
    expect((await call("POST", "/provisioning/no-existe/retry", { token: OPS })).status).toBe(404);
    const before = seededAdmins;
    const r = await call("POST", "/provisioning/fallida-sl/retry", { token: OPS });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("completed");
    expect(seededAdmins).toBe(before + 1);
    const again = await call("POST", "/provisioning/fallida-sl/retry", { token: OPS });
    expect(again.status).toBe(200);
    expect(again.json.completedSteps).toEqual(r.json.completedSteps);
    expect(seededAdmins).toBe(before + 1);
    expect((await call("GET", "/provisioning?status=failed", { token: READER })).json.total).toBe(0);
    const done = (await call("GET", "/provisioning?status=completed", { token: READER })).json.provisioning;
    expect(done.map((p: any) => p.tenantId)).toEqual(expect.arrayContaining([tenantId, "fallida-sl"]));
    // La petición guardada no cambia al reintentar
    expect(done.find((p: any) => p.tenantId === "fallida-sl").displayName).toBe("Fallida SL");
  });

  it("solicitudes web de una empresa (crm:read): solo las de sus leads", async () => {
    const company = (await crmStore.list("companies", { tenantId }))[0];
    const other = await crm.createCompany({ name: "Otra Empresa SL", email: null }, "prueba");
    const mine = await crm.createLead({ name: "Ana", email: "ana@hotelsol.example", companyId: company.id }, "prueba");
    const theirs = await crm.createLead({ name: "Luis", email: "luis@otra.example", companyId: other.id }, "prueba");
    const req = (leadId: number, reference: string): Omit<LeadRequest, "id"> => ({
      leadId, reference, type: "contact", status: "pending", sector: null, message: null, configuration: null, interest: null, preferredTime: null,
      sourcePage: null, utm: null, privacyAcceptedAt: clock, privacyVersion: "1", marketingConsent: false, idempotencyKey: key(), payloadHash: key(),
      ipHash: null, attendedAt: null, attendedBy: null, createdAt: clock,
    });
    await crmStore.insert("leadRequests", req(mine.id, "SOL-1"));
    await crmStore.insert("leadRequests", req(theirs.id, "SOL-2"));
    const r = await call("GET", `/crm/requests?companyId=${company.id}`, { token: OPS });
    expect(r.status).toBe(200);
    expect(r.json.requests.map((x: any) => x.request.reference)).toEqual(["SOL-1"]);
    expect(r.json.total).toBe(1);
    expect((await call("GET", "/crm/requests", { token: OPS })).json.total).toBe(2);
    expect((await call("GET", "/crm/requests?companyId=99999", { token: OPS })).status).toBe(404);
    expect((await call("GET", "/crm/requests?companyId=abc", { token: OPS })).status).toBe(400);
    expect((await call("GET", `/crm/requests?companyId=${company.id}`, { token: READER })).status).toBe(403);
  });
});

describe("correos de la prueba y del orquestador: solo por el puerto de avisos, nada real", () => {
  it("la conversión de prueba a pago sin pedido no se hace ni envía nada; los avisos van por el puerto (aquí, un buzón en memoria)", async () => {
    await call("POST", "/public/trial", { body: { email: "eva@casa.example", companyName: "Casa Eva", idempotencyKey: key() } });
    const v = outbox.filter((m) => m.kind === "verification").at(-1)!;
    await call("POST", "/public/trial/verify", { body: { id: v.data.trialId, token: v.data.token } });
    const sent = outbox.length;
    const r = await call("POST", `/trials/${v.data.trialId}/convert`, { token: OPS, body: { category: "exception", reason: "Conversión excepcional de prueba sin pedido" } });
    expect(r.status).toBe(409);
    expect(outbox.length).toBe(sent);
    expect(smtp.createTransport + smtp.sendMail).toBe(0);
  });

  it("sin puerto configurado: el aviso por defecto solo deja constancia (sin correo ni token en el registro)", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    try {
      const r = await call("POST", "/public/trial", { port: quietPort, body: { email: "sin@aviso.example", companyName: "Sin Aviso", idempotencyKey: key() } });
      expect(r.status).toBe(202);
    } finally {
      spy.mockRestore();
    }
    expect(logs.some((l) => l.includes("verification_not_sent"))).toBe(true);
    expect(logs.join("\n")).not.toMatch(/sin@aviso\.example|token/i);
    expect(smtp.createTransport + smtp.sendMail).toBe(0);
  });

  it("el correo de la prueba está apagado por defecto y no se enciende a medias", () => {
    expect(trialNotifierFromEnv({})).toBeNull();
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "cualquiera" })).toBeNull();
    // «live» sin URL de verificación o sin SMTP completo: queda apagado
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "live" })?.mode).toBe("off");
    expect(trialNotifierFromEnv({ CP_TRIAL_EMAIL_MODE: "live", CP_TRIAL_VERIFY_URL: "https://web.example/verificar" })?.mode).toBe("off");
    expect(smtp.createTransport).toBe(0);
  });

  it("el orquestador y la conversión no tienen vía propia de correo; el alta no lleva aviso de bienvenida en el plano de control", () => {
    const read = (p: string) => fs.readFileSync(path.join(__dirname, p), "utf8");
    for (const f of fs.readdirSync(path.join(__dirname, "orchestrator")).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
      expect(read(`orchestrator/${f}`), f).not.toMatch(/nodemailer|from "\.\.\/mailer"|sendEmail|smtpEmailPort/);
    }
    expect(read("trials/onboarding.ts")).not.toMatch(/nodemailer|mailer|sendEmail/);
    // Los avisos de la prueba solo salen por `notify` (por defecto, el que no envía nada)
    expect(read("controlPlane/api.ts")).toContain("notify: d.trials.notify ?? logOnlyTrialNotifier");
    // El servicio del plano de control no conecta el aviso de bienvenida del aprovisionamiento
    expect(read("controlPlane/main.ts")).not.toMatch(/welcome\s*:/);
  });
});
