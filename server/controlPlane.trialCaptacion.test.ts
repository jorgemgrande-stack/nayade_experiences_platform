/**
 * Captación y activación de la prueba gratuita (formulario de la web del 09/11/2026) por HTTP, con el aprovisionamiento
 * REAL en memoria, el catálogo oficial, suscripciones y licencias. Datos sintéticos; ningún correo ni cobro real.
 *
 *  - Alta con responsable, sector, teléfono, país, aceptación expresa, consentimiento comercial y procedencia:
 *    se guardan en la prueba, la empresa del CRM nace con sector, país y teléfono, y el responsable es su contacto
 *    principal (propietario). El registro comercial lleva sector y procedencia, nunca nombre, teléfono ni correo.
 *  - Validaciones: sin nombre o sin aceptación expresa, 400; el formulario anterior (correo y empresa) sigue valiendo.
 *  - Correo con prueba abierta sin verificar: misma respuesta y se reenvía el enlace.
 *  - Hitos del panel (primer acceso y primera acción): una sola vez, con el token de comercio del Core.
 *  - Embudo: contador anónimo de la página y etapas de las pruebas por canal.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createContractActivation } from "./crm/activation";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryTrialStore } from "./trials/store";
import { MemoryTrialFunnelCounter, MysqlTrialFunnelCounter } from "./trials/funnel";
import { normalizeAttribution, normalizeProfile } from "./trials/profile";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import type { TrialNotifier } from "./trials/onboarding";
import type { CommercialEventDraft } from "./commercialEvents/types";

const ADMIN = "cap-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
const CORE = "cap-core-token-bbbbbbbbbbbbbbbbbbbbbbbb";
let clock = Date.UTC(2026, 10, 9, 9);
let server: http.Server;
let port = 0;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const commercial: CommercialEventDraft[] = [];
const trialStore = new MemoryTrialStore({ append: async (_tx, drafts) => (commercial.push(...drafts), { written: drafts.length, duplicates: 0 }) });
const funnel = new MemoryTrialFunnelCounter();
const consentsGranted: Array<{ contactId: number; evidence: string }> = [];
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
const admins: Array<{ email: string; name: string }> = [];

const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1${path}`,
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) },
      },
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
const key = () => crypto.randomBytes(12).toString("hex");
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

const FORM = {
  fullName: "  Lucía   Martín Ruiz ",
  sector: "servicios-profesionales",
  phone: "+34 600 111 222",
  country: "es",
  termsAccepted: true,
  termsVersion: "2026-10-31",
  marketingConsent: true,
  attribution: { source: "Google", medium: "cpc", campaign: "prueba-essential", referrerHost: "www.google.com", landingPath: "/prueba-gratuita?x=1" },
};

beforeAll(async () => {
  const registry = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new TenantRegistryService(registry, () => ring);
  const provisioning = new ProvisioningService({
    registry: reg,
    reader: registry,
    databases: { ensureDatabase: async (id) => ({ dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
    schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
    seeder: { seedAdmin: async (_dsn, a) => (admins.push(a), { created: true, inviteToken: crypto.randomBytes(8).toString("hex") }), seedBranding: async () => undefined },
    entitlements: { grant: async () => undefined },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    now: () => clock,
    sleep: async () => undefined,
  });
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read"] as const;
  const app = createControlPlaneApp({
    tokens: [
      { id: "admin", sha256: hashToken(ADMIN), scopes: [...all] },
      { id: "core", sha256: hashToken(CORE), scopes: ["commerce:support"] },
    ],
    registry: reg,
    reader: registry,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    trials: { store: trialStore, funnel, publicEnabled: true, autoProvision: true, notify, marketingConsent: async (contactId: number, evidence: string) => void consentsGranted.push({ contactId, evidence }) },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string, companyName: string, extra: Record<string, unknown> = FORM) {
  return call("POST", "/public/trial", { token: null, body: { email, companyName, idempotencyKey: key(), ...extra } });
}
async function verifyLast(email: string) {
  const v = outbox.filter((m) => m.kind === "verification" && m.to === email).at(-1)!;
  const r = await call("POST", "/public/trial/verify", { token: null, body: { id: v.data.trialId, token: v.data.token } });
  return { r, trialId: v.data.trialId as number };
}

describe("normalización de los datos del formulario", () => {
  it("nombre, teléfono y país normalizados; consentimiento comercial solo si se marca", () => {
    const p = normalizeProfile({ fullName: "  Ana   Gil ", phone: "+34 (600) 11-22-33", country: "es", termsAccepted: true }, 1000);
    expect(p).toMatchObject({ fullName: "Ana Gil", phone: "+34 600 11 22 33", country: "ES", marketingConsent: false, marketingConsentAt: null, termsAcceptedAt: 1000 });
    expect(() => normalizeProfile({ fullName: "Ana Gil", termsAccepted: false }, 1)).toThrow(/aceptar/);
    expect(() => normalizeProfile({ fullName: "A", termsAccepted: true }, 1)).toThrow(/nombre/);
    expect(() => normalizeProfile({ fullName: "Ana Gil", phone: "abc", termsAccepted: true }, 1)).toThrow(/Teléfono/);
    expect(() => normalizeProfile({ fullName: "Ana Gil", sector: "inventado", termsAccepted: true }, 1)).toThrow(/Sector/);
  });
  it("la procedencia descarta correos, números largos, URLs completas y parámetros", () => {
    expect(normalizeAttribution({ source: "ana@correo.es", medium: "612345678", campaign: "Otoño 2026", referrerHost: "https://x.com/a", landingPath: "/prueba-gratuita?utm=1" })).toEqual({
      source: null, medium: null, campaign: "otoño-2026", term: null, content: null, referrerHost: null, landingPath: "/prueba-gratuita", adClick: null,
    });
    // Del clic de anuncio solo la red conocida, nunca el identificador
    expect(normalizeAttribution({ adClick: "google" })?.adClick).toBe("google");
    expect(normalizeAttribution({ source: "x", adClick: "Cj0KCQ-identificador" })?.adClick).toBeNull();
    expect(normalizeAttribution({})).toBeNull();
    // Un teléfono con separadores tampoco pasa como UTM
    expect(normalizeAttribution({ source: "+34-600-111-222", medium: "600.111.222", campaign: "black-friday-2026" })).toMatchObject({ source: null, medium: null, campaign: "black-friday-2026" });
  });
});

describe("alta con el formulario nuevo", () => {
  it("guarda responsable y procedencia; la empresa del CRM nace con sector, país, teléfono y su propietario", async () => {
    expect((await signup("lucia@estudio-martin.example", "Estudio Martín")).status).toBe(202);
    const { r, trialId } = await verifyLast("lucia@estudio-martin.example");
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("active");
    const t = (await trialStore.get(trialId))!;
    expect(t.configuration.profile).toMatchObject({ fullName: "Lucía Martín Ruiz", sector: "servicios-profesionales", phone: "+34 600 111 222", country: "ES", marketingConsent: true, termsVersion: "2026-10-31" });
    expect(t.configuration.attribution).toMatchObject({ source: "google", medium: "cpc", campaign: "prueba-essential", referrerHost: "google.com", landingPath: "/prueba-gratuita" });
    // El administrador de la plataforma lleva el nombre del responsable (el panel le saluda por su nombre)
    expect(admins.at(-1)).toMatchObject({ email: "lucia@estudio-martin.example", name: "Lucía Martín Ruiz" });
    const company = (await crmStore.list("companies", { tenantId: t.tenantId! }))[0];
    expect(company).toMatchObject({ name: "Estudio Martín", email: "lucia@estudio-martin.example", sector: "Servicios profesionales", country: "ES", phone: "+34 600 111 222" });
    expect(company.notes).toMatch(/origen google, medio cpc, campaña prueba-essential/);
    const contacts = await crmStore.list("contacts", { companyId: company.id });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: "Lucía Martín Ruiz", firstName: "Lucía", lastName: "Martín Ruiz", email: "lucia@estudio-martin.example", isPrimary: true, role: "Propietario (prueba gratuita)" });
    expect(contacts[0].notes).toMatch(/Acepta comunicaciones comerciales/);
    // La casilla comercial queda en el registro de consentimientos (el que filtra los envíos comerciales), con su evidencia
    expect(consentsGranted).toEqual([{ contactId: contacts[0].id, evidence: expect.stringMatching(/casilla no premarcada: «Quiero recibir novedades y ofertas de Big Elephant.*condiciones 2026-10-31/) }]);
    // Registro comercial: sector y procedencia, nunca datos personales
    const mine = commercial.filter((e) => e.trialId === trialId);
    expect(mine.map((e) => e.type)).toEqual(expect.arrayContaining(["trial.requested", "trial.verified", "trial.started"]));
    expect(mine[0].data).toMatchObject({ sector: "servicios-profesionales", country: "ES", source: "google", campaign: "prueba-essential" });
    expect(JSON.stringify(mine)).not.toMatch(/Lucía|600 111|lucia@/);
  });

  it("sin nombre o sin aceptación expresa no se acepta; el formulario anterior solo con la aceptación y su versión", async () => {
    expect((await signup("sin-nombre@taller.example", "Taller", { ...FORM, fullName: "" })).status).toBe(400);
    expect((await signup("sin-acepta@taller.example", "Taller", { ...FORM, termsAccepted: false })).status).toBe(400);
    // Formulario anterior (solo correo y empresa) sin aceptación: 400 con el motivo para la persona y nada creado
    const old = await signup("sin-condiciones@taller.example", "Taller Viejo", {});
    expect(old.status).toBe(400);
    expect(old.json.message).toBe("Hay que aceptar la política de privacidad y las condiciones de la prueba");
    const noVersion = await signup("sin-version@taller.example", "Taller Viejo", { termsAccepted: true });
    expect(noVersion.status).toBe(400);
    expect(noVersion.json.message).toMatch(/versión de las condiciones/);
    expect((await trialStore.list({})).some((x) => x.email.startsWith("sin-condiciones@") || x.email.startsWith("sin-version@"))).toBe(false);
    expect((await signup("antiguo@taller.example", "Taller Antiguo", { termsAccepted: true, termsVersion: "2026-10-21" })).status).toBe(202);
    // Claves de procedencia desconocidas (gclid…) se descartan sin impedir el alta
    expect((await signup("gclid@taller.example", "Taller Gclid", { ...FORM, attribution: { source: "bing", gclid: "abc123" } })).status).toBe(202);
    const t = (await trialStore.list({})).find((x) => x.email === "antiguo@taller.example")!;
    expect(t.configuration.profile).toBeUndefined();
    // La versión aceptada queda registrada en todas las altas públicas
    expect(t.configuration.terms).toEqual({ acceptedAt: expect.any(Number), version: "2026-10-21" });
  });

  it("campo trampa: misma respuesta y no se crea nada", async () => {
    const before = (await trialStore.list({})).length;
    expect((await signup("robot@spam.example", "Spam", { ...FORM, website: "http://spam" })).status).toBe(202);
    expect((await trialStore.list({})).length).toBe(before);
  });

  it("correo con prueba abierta sin verificar: misma respuesta y se le reenvía el enlace (pasada la espera mínima)", async () => {
    const a = await signup("repite@bodega.example", "Bodega Repite");
    clock += 5 * 60_000;
    const b = await signup("repite@bodega.example", "Bodega Repite");
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.raw).toBe(b.raw);
    await settle();
    const sent = outbox.filter((m) => m.kind === "verification" && m.to === "repite@bodega.example");
    expect(sent).toHaveLength(2);
    expect(sent[1].data).toMatchObject({ resend: true });
    expect((await trialStore.list({})).filter((x) => x.email === "repite@bodega.example")).toHaveLength(1);
  });
});

describe("hitos del panel y embudo", () => {
  it("primer acceso y primera acción: una sola vez, con el token del Core", async () => {
    await signup("hitos@reformas.example", "Reformas Hitos", { ...FORM, attribution: { referrerHost: "facebook.com" } });
    const { trialId } = await verifyLast("hitos@reformas.example");
    const tenantId = (await trialStore.get(trialId))!.tenantId!;
    const path = `/commerce/tenants/${tenantId}/trial-milestones`;
    expect((await call("POST", path, { body: { milestone: "first_access" } })).status).toBe(403);
    expect((await call("POST", path, { token: CORE, body: { milestone: "first_access" } })).json).toMatchObject({ recorded: true, trialId });
    expect((await call("POST", path, { token: CORE, body: { milestone: "first_access" } })).json).toMatchObject({ recorded: false, trialId });
    expect((await call("POST", path, { token: CORE, body: { milestone: "first_action", detail: "client" } })).json.recorded).toBe(true);
    expect((await call("POST", path, { token: CORE, body: { milestone: "otra" } })).status).toBe(400);
    // Una plataforma sin prueba: no hace nada
    expect((await call("POST", "/commerce/tenants/otra-empresa/trial-milestones", { token: CORE, body: { milestone: "first_access" } })).json).toMatchObject({ recorded: false, trialId: null });
    const events = (await call("GET", `/trials/${trialId}/events`)).json.events.map((e: any) => e.action);
    expect(events.filter((a: string) => a === "first_access")).toHaveLength(1);
    expect(events).toContain("first_action");
    expect(commercial.filter((e) => e.trialId === trialId).map((e) => e.type)).toEqual(expect.arrayContaining(["trial.first_access", "trial.first_action"]));
  });

  it("contador anónimo de la página y etapas por canal", async () => {
    for (const step of ["visit", "visit", "form_start"]) expect((await call("POST", "/public/trial/funnel", { token: null, body: { step, attribution: { source: "google", medium: "cpc" } } })).status).toBe(202);
    expect((await call("POST", "/public/trial/funnel", { token: null, body: { step: "visit" } })).status).toBe(202);
    expect((await call("POST", "/public/trial/funnel", { token: null, body: { step: "otra" } })).status).toBe(400);
    expect((await call("GET", "/trials/funnel?from=2026-11-01&to=2026-11-30", { token: null })).status).toBe(401);
    const f = (await call("GET", "/trials/funnel?from=2026-11-01&to=2026-11-30")).json;
    expect(f.landing.totals).toEqual({ visit: 3, form_start: 1 });
    expect(f.landing.channels).toEqual(expect.arrayContaining([{ channel: "google", visit: 2, form_start: 1 }, { channel: "directo", visit: 1, form_start: 0 }]));
    const google = f.rows.find((r: any) => r.channel === "google");
    // Lucía (verificada y activa) y la bodega (sin verificar), las dos desde Google
    expect(google.stages).toMatchObject({ submitted: 2, verified: 1, provisioned: 1 });
    const facebook = f.rows.find((r: any) => r.channel === "facebook.com");
    expect(facebook.stages).toMatchObject({ provisioned: 1, first_access: 1, first_action: 1 });
    expect(f.totals.submitted).toBeGreaterThanOrEqual(4);
    expect(f.raw ?? JSON.stringify(f)).not.toMatch(/@/);
    expect((await call("GET", "/trials/funnel?from=2026-11-30&to=2026-11-01")).status).toBe(400);
  });
});

describe("contador sin la migración 0046", () => {
  it("descarta en silencio si falta la tabla y propaga cualquier otro error", async () => {
    const missing = Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
    const pool = (err: Error) => ({ query: async () => { throw err; } }) as never;
    const c = new MysqlTrialFunnelCounter(pool(missing));
    await expect(c.add("visit", { day: "2026-11-09", channel: "directo", medium: "", campaign: "" })).resolves.toBeUndefined();
    await expect(c.counts({ from: "2026-11-01", to: "2026-11-09" })).resolves.toEqual([]);
    const other = new MysqlTrialFunnelCounter(pool(Object.assign(new Error("down"), { code: "ECONNREFUSED" })));
    await expect(other.add("visit", { day: "2026-11-09", channel: "directo", medium: "", campaign: "" })).rejects.toThrow("down");
  });
});

describe("registros técnicos o de prueba: fuera del embudo, sin borrar nada", () => {
  it("marcar una prueba es una acción auditada, idempotente y con permiso de escritura", async () => {
    clock += 25 * 3600_000; // fuera del límite de altas por conexión de las pruebas anteriores
    expect((await signup("tecnica@verificacion.example", "Verificación técnica", { ...FORM, attribution: { source: "verificacion-interna" } })).status).toBe(202);
    const t = (await trialStore.list({})).find((x) => x.email === "tecnica@verificacion.example")!;
    expect((await call("POST", `/trials/${t.id}/mark-test`, { token: CORE, body: { reason: "Alta de verificación técnica" } })).status).toBe(403);
    expect((await call("POST", `/trials/${t.id}/mark-test`, { body: { reason: "no" } })).status).toBe(400);
    const r = await call("POST", `/trials/${t.id}/mark-test`, { body: { reason: "Alta de verificación técnica" } });
    expect(r.status).toBe(200);
    expect(r.json.trial.configuration.test).toMatchObject({ reason: "Alta de verificación técnica" });
    expect(r.json.trial.state).toBe(t.state);
    expect((await call("POST", `/trials/${t.id}/mark-test`, { body: { reason: "Otra vez, ya marcada" } })).status).toBe(200);
    const notes = (await trialStore.events(t.id)).filter((e) => e.action === "marked_test");
    expect(notes).toHaveLength(1);
    expect(notes[0].detail).toBe("Alta de verificación técnica");
  });

  it("el embudo excluye las pruebas marcadas y los canales técnicos (visitas incluidas) y dice cuántos", async () => {
    clock += 25 * 3600_000; // fuera del límite de altas por conexión de las pruebas anteriores
    const day = new Date(clock).toISOString().slice(0, 10);
    await call("POST", "/public/trial/funnel", { token: null, body: { step: "visit", attribution: { source: "canal-tecnico" } } });
    expect((await signup("canal@tecnico.example", "Canal técnico", { ...FORM, attribution: { source: "canal-tecnico" } })).status).toBe(202);
    const before = (await call("GET", `/trials/funnel?from=${day}&to=${day}`, {})).json;
    expect(before.rows.some((x: { channel: string }) => x.channel === "canal-tecnico")).toBe(true);
    expect((await call("POST", "/trials/funnel/test-channels", { token: CORE, body: { channel: "canal-tecnico", reason: "Visitas de verificación" } })).status).toBe(403);
    const m = await call("POST", "/trials/funnel/test-channels", { body: { channel: "Canal-Tecnico", reason: "Visitas de verificación" } });
    expect(m.status).toBe(201);
    expect((await call("POST", "/trials/funnel/test-channels", { body: { channel: "canal-tecnico", reason: "Visitas de verificación" } })).json.marked).toBe(false);
    const after = (await call("GET", `/trials/funnel?from=${day}&to=${day}`, {})).json;
    expect(after.rows.some((x: { channel: string }) => x.channel === "canal-tecnico")).toBe(false);
    expect(after.landing.channels.some((x: { channel: string }) => x.channel === "canal-tecnico")).toBe(false);
    expect(after.excluded.channels).toContain("canal-tecnico");
    // Un canal que no encaja con lo que se guarda se rechaza en lugar de no excluir nada
    expect((await call("POST", "/trials/funnel/test-channels", { body: { channel: "<script>", reason: "Visitas de verificación" } })).status).toBe(400);
    expect(after.excluded.trials).toBeGreaterThanOrEqual(1);
    // Nada se ha borrado: el contador sigue teniendo la visita
    expect(Array.from(funnel.rows.values()).some((x) => x.channel === "canal-tecnico")).toBe(true);
  });
});
