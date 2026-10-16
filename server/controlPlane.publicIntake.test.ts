/**
 * Captación pública desde la web comercial: solicitudes que cuelgan de leads del CRM.
 * Servicio (deduplicación, idempotencia, reglas de no sobrescritura) y API pública (origen, ticket,
 * campo trampa, límites, validación, errores del backend, sin fugas de datos internos), más la
 * gestión desde el CRM (bandeja, atender, permisos).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService } from "./crm/service";
import { MemoryCrmStore, type Tables } from "./crm/store";
import { WebRequestService, payloadHash, type WebRequestInput } from "./crm/webRequests";
import { checkTicket, issueTicket } from "./crm/publicApi";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const SECRET = "s".repeat(16) + crypto.randomBytes(16).toString("hex");
const WEB = "http://localhost:4180";
const T0 = Date.UTC(2026, 9, 15, 10);
const key = () => crypto.randomUUID();

const base = (over: Partial<WebRequestInput> = {}): WebRequestInput => ({
  type: "onboarding",
  name: "Marta Prueba",
  email: "marta@hotel-demo.test",
  phone: "+34 600 111 222",
  company: "Hotel Demo",
  sector: "Alojamiento",
  message: null,
  configuration: { plan: "business", extensions: ["voice-ai"], industries: ["hotel"], interests: ["ski"] },
  interest: null,
  preferredTime: "Martes por la mañana",
  sourcePage: "/onboarding",
  utm: null,
  marketingConsent: false,
  privacyVersion: "2026-10-borrador",
  ...over,
});

// ── Servicio ──────────────────────────────────────────────────────────────────

describe("WebRequestService", () => {
  let store: MemoryCrmStore;
  let crm: CrmService;
  let svc: WebRequestService;
  let now = T0;
  beforeEach(() => {
    now = T0;
    store = new MemoryCrmStore();
    crm = new CrmService({ store, now: () => now });
    svc = new WebRequestService({ store, crm, now: () => now });
  });

  it("crea un lead «web» con prioridad alta y una solicitud pendiente con la configuración", async () => {
    const r = await svc.receive(base(), { idempotencyKey: key(), ipHash: "h" });
    expect(r.outcome).toBe("created");
    expect(r.request.reference).toMatch(/^SOL-[A-Z2-9]{8}$/);
    const lead = (await store.get("leads", r.request.leadId))!;
    expect(lead).toMatchObject({ source: "web", status: "new", priority: "high", email: "marta@hotel-demo.test", companyName: "Hotel Demo" });
    expect(r.request).toMatchObject({ status: "pending", type: "onboarding", configuration: { plan: "business", interests: ["ski"] }, marketingConsent: false });
    const tl = await crm.timeline("lead", lead.id);
    expect(tl.map((a) => a.summary).join(" | ")).toContain(`Solicitud web: Sesión de onboarding (${r.request.reference})`);
    // El historial no guarda datos personales
    expect(JSON.stringify(tl)).not.toContain("600 111 222");
  });

  it("reutiliza el lead abierto del mismo correo y solo rellena campos vacíos (no sobrescribe)", async () => {
    const existing = await crm.createLead({ name: "Nombre comercial", email: "Marta@Hotel-Demo.test", companyName: "Grupo Real SL", owner: "Laura" }, "operator:laura");
    const r = await svc.receive(base({ name: "Otro nombre", company: "Otra empresa" }), { idempotencyKey: key(), ipHash: null });
    expect(r.request.leadId).toBe(existing.id);
    const lead = (await store.get("leads", existing.id))!;
    expect(lead).toMatchObject({ name: "Nombre comercial", companyName: "Grupo Real SL", owner: "Laura", phone: "+34 600 111 222" });
    expect((await store.list("leads")).length).toBe(1);
    expect((await crm.timeline("lead", existing.id)).some((a) => a.summary === "Datos completados desde la web: teléfono")).toBe(true);
  });

  it("un cliente ya convertido que vuelve a escribir genera un lead nuevo enlazado a su empresa", async () => {
    const old = await crm.createLead({ name: "Marta", email: "marta@hotel-demo.test", companyName: "Hotel Demo" }, "t");
    const conv = await crm.convertLead(old.id, {}, "t");
    const r = await svc.receive(base({ type: "extension_info", interest: "voice-ai", configuration: null }), { idempotencyKey: key(), ipHash: null });
    const lead = (await store.get("leads", r.request.leadId))!;
    expect(lead.id).not.toBe(old.id);
    expect(lead).toMatchObject({ companyId: conv.company.id, priority: "normal", source: "web" });
  });

  it("idempotencia: misma clave y contenido → misma solicitud; otro contenido → conflicto", async () => {
    const k = key();
    const a = await svc.receive(base(), { idempotencyKey: k, ipHash: null });
    const b = await svc.receive(base(), { idempotencyKey: k, ipHash: null });
    expect(b).toMatchObject({ outcome: "replayed", request: { id: a.request.id, reference: a.request.reference } });
    await expect(svc.receive(base({ message: "cambio" }), { idempotencyKey: k, ipHash: null })).rejects.toMatchObject({ code: "conflict" });
    expect((await store.list("leadRequests")).length).toBe(1);
  });

  it("el mismo envío repetido en 24 h no se duplica; después, sí se registra", async () => {
    const a = await svc.receive(base(), { idempotencyKey: key(), ipHash: null });
    const b = await svc.receive(base(), { idempotencyKey: key(), ipHash: null });
    expect(b).toMatchObject({ outcome: "duplicate", request: { reference: a.request.reference } });
    now += 25 * 60 * 60 * 1000;
    const c = await svc.receive(base(), { idempotencyKey: key(), ipHash: null });
    expect(c.outcome).toBe("created");
    // Otro tipo de solicitud de la misma persona: nueva solicitud en el mismo lead
    const d = await svc.receive(base({ type: "trial" }), { idempotencyKey: key(), ipHash: null });
    expect(d.outcome).toBe("created");
    expect(new Set((await store.list("leadRequests")).map((r) => r.leadId)).size).toBe(1);
  });

  it("envíos simultáneos de la misma persona no crean dos leads", async () => {
    await Promise.all([1, 2, 3, 4].map((i) => svc.receive(base({ message: `m${i}` }), { idempotencyKey: key(), ipHash: null })));
    expect((await store.list("leads")).length).toBe(1);
    expect((await store.list("leadRequests")).length).toBe(4);
  });

  it("atender una solicitud pasa el lead nuevo a «contactado»; la vista del CRM no expone campos internos", async () => {
    const r = await svc.receive(base(), { idempotencyKey: key(), ipHash: "secreto-ip" });
    const v = await svc.setStatus(r.request.id, "attended", "operator:laura");
    expect(v).toMatchObject({ status: "attended", attendedBy: "operator:laura" });
    expect((await store.get("leads", r.request.leadId))!.status).toBe("contacted");
    for (const row of [v, ...(await svc.forLead(r.request.leadId)), ...(await svc.list()).rows.map((x) => x.request)]) {
      expect(row).not.toHaveProperty("idempotencyKey");
      expect(row).not.toHaveProperty("payloadHash");
      expect(row).not.toHaveProperty("ipHash");
    }
    const back = await svc.setStatus(r.request.id, "pending", "operator:laura");
    expect(back).toMatchObject({ status: "pending", attendedAt: null, attendedBy: null });
  });

  it("bandeja: filtros por tipo, estado, responsable y búsqueda; resumen de pendientes", async () => {
    const a = await svc.receive(base(), { idempotencyKey: key(), ipHash: null });
    await svc.receive(base({ type: "trial", email: "otro@demo.test", company: "Spa Demo" }), { idempotencyKey: key(), ipHash: null });
    await crm.updateLead(a.request.leadId, { owner: "Laura" }, "t");
    expect((await svc.list({ type: "trial" })).total).toBe(1);
    expect((await svc.list({ owner: "Laura" })).rows[0].request.reference).toBe(a.request.reference);
    expect((await svc.list({ owner: "-" })).total).toBe(1);
    expect((await svc.list({ q: "spa demo" })).total).toBe(1);
    await svc.setStatus(a.request.id, "attended", "t");
    expect((await svc.list({ status: "pending" })).total).toBe(1);
    expect(await svc.summary()).toMatchObject({ pending: 1, byType: { trial: 1, onboarding: 0 } });
  });

  it("la huella ignora mayúsculas del correo y el orden de las claves", () => {
    expect(payloadHash(base({ email: "MARTA@hotel-demo.test" }))).toBe(payloadHash(base()));
  });
});

describe("tickets de formulario", () => {
  it("firma, tiempo mínimo, caducidad y manipulación", () => {
    const t = issueTicket(SECRET, T0);
    expect(checkTicket(SECRET, t, T0 + 1000, 3000, 7_200_000)).toEqual({ ok: false, reason: "too_fast" });
    expect(checkTicket(SECRET, t, T0 + 5000, 3000, 7_200_000).ok).toBe(true);
    expect(checkTicket(SECRET, t, T0 + 7_300_000, 3000, 7_200_000)).toEqual({ ok: false, reason: "expired" });
    expect(checkTicket("otro-secreto".repeat(4), t, T0 + 5000, 3000, 7_200_000)).toEqual({ ok: false, reason: "invalid" });
    const forged = t.replace(/^v1\.[^.]+/, `v1.${(T0 - 10_000).toString(36)}`);
    expect(checkTicket(SECRET, forged, T0 + 5000, 3000, 7_200_000)).toEqual({ ok: false, reason: "invalid" });
  });
});

// ── API pública y CRM ─────────────────────────────────────────────────────────

const FULL = "intake-crm-full-token-aaaaaaaaaaaaaaaa";
const READ = "intake-crm-read-token-bbbbbbbbbbbbbbbb";

class FlakyStore extends MemoryCrmStore {
  fail: null | "transient" | "bug" = null;
  override async insert<T extends keyof Tables>(table: T, row: Omit<Tables[T], "id">): Promise<Tables[T]> {
    if (this.fail === "transient" && table === "leadRequests") throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    if (this.fail === "bug" && table === "leadRequests") throw new Error(`fallo interno con ${SECRET}`);
    return super.insert(table, row);
  }
}

async function startApp(opts: { publicIntake?: boolean; perIp?: number; perEmailPerHour?: number } = {}) {
  let clock = T0;
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const store = new FlakyStore();
  const audit: Record<string, unknown>[] = [];
  const app = createControlPlaneApp({
    tokens: [
      { id: "ana", sha256: hashToken(FULL), scopes: ["crm:read", "crm:write"] },
      { id: "viewer", sha256: hashToken(READ), scopes: ["crm:read"] },
    ],
    registry: new TenantRegistryService(reg, () => ring),
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    allowedOrigins: ["http://localhost:4178"],
    crm: { service: new CrmService({ store }), store },
    publicIntake:
      opts.publicIntake === false
        ? undefined
        : { origins: [WEB], secret: SECRET, now: () => clock, perIp: opts.perIp ?? 100, perEmailPerHour: opts.perEmailPerHour, audit: (e) => audit.push(e) },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, path: string, o: { body?: unknown; origin?: string | null; token?: string; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number; json: any; raw: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1${path}`,
          method,
          headers: {
            ...(o.origin === null ? {} : { origin: o.origin ?? WEB }),
            ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
            ...(o.headers ?? {}),
          },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null, raw: b, headers: res.headers }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const ticket = async () => {
    const t = (await call("GET", "/public/form-ticket")).json.ticket as string;
    clock += 5000; // el visitante tarda en rellenar
    return t;
  };
  const submit = async (body: Record<string, unknown>, k = key()) => call("POST", "/public/requests", { body, headers: { "idempotency-key": k } });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { call, ticket, submit, close, store, audit, tick: (ms: number) => (clock += ms) };
}

const form = (ticket: string, over: Record<string, unknown> = {}) => ({
  type: "onboarding",
  name: "Marta Prueba",
  email: "marta@hotel-demo.test",
  phone: "+34 600 111 222",
  company: "Hotel Demo",
  sector: "Alojamiento",
  preferredTime: "Martes por la mañana",
  configuration: { plan: "business", extensions: ["voice-ai"], industries: ["hotel"], interests: ["ski"] },
  sourcePage: "/onboarding",
  consents: { privacy: true, marketing: false },
  privacyVersion: "2026-10-borrador",
  ticket,
  website: "",
  ...over,
});

describe("API pública de captación", () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  beforeEach(async () => {
    app = await startApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("solo desde el origen de la web; CORS sin credenciales; otras rutas del CP siguen cerradas", async () => {
    expect((await app.call("GET", "/public/form-ticket", { origin: null })).status).toBe(403);
    expect((await app.call("GET", "/public/form-ticket", { origin: "https://evil.example" })).status).toBe(403);
    const pre = await app.call("OPTIONS", "/public/requests");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(WEB);
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(String(pre.headers["access-control-allow-headers"])).toContain("idempotency-key");
    const evil = await app.call("OPTIONS", "/public/requests", { origin: "https://evil.example" });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    // El origen de la web no abre las rutas autenticadas
    expect((await app.call("GET", "/crm/leads")).status).toBe(401);
    expect((await app.call("POST", "/crm/leads", { body: { name: "x", email: "x@y.es" } })).status).toBe(401);
    expect((await app.call("GET", "/tenants")).status).toBe(401);
    expect((await app.call("POST", "/public/tenants", { body: {} })).status).toBe(404);
  });

  it("registra la solicitud y responde solo con una referencia (sin ids ni datos internos)", async () => {
    const t = await app.ticket();
    const r = await app.submit(form(t));
    expect(r.status).toBe(201);
    expect(Object.keys(r.json).sort()).toEqual(["duplicate", "reference", "status", "type"]);
    expect(r.json).toMatchObject({ status: "received", type: "onboarding", duplicate: false });
    expect(r.raw).not.toMatch(/leadId|"id"|marta@|ipHash|idempotency|SECRET/);
    expect(r.headers["cache-control"]).toBe("no-store");
    const [req] = await app.store.list("leadRequests");
    expect(req).toMatchObject({ reference: r.json.reference, preferredTime: "Martes por la mañana", privacyVersion: "2026-10-borrador" });
    expect(req.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(req.ipHash).not.toContain("127.0.0.1");
    expect(app.audit.find((e) => e.event === "accepted")).toMatchObject({ outcome: "created", type: "onboarding" });
    expect(JSON.stringify(app.audit)).not.toContain("marta@");
  });

  it("reintentos idempotentes, conflicto de clave y ticket de un solo uso", async () => {
    const t = await app.ticket();
    const k = key();
    const a = await app.submit(form(t), k);
    const b = await app.submit(form(t), k);
    expect(b.status).toBe(200);
    expect(b.json.reference).toBe(a.json.reference);
    expect((await app.submit(form(t, { message: "otra cosa" }), k)).status).toBe(409);
    // Mismo ticket con otra clave: ya no vale
    expect((await app.submit(form(t, { message: "otra cosa" }))).json).toEqual({ error: "invalid_ticket" });
    expect((await app.store.list("leadRequests")).length).toBe(1);
  });

  it("antispam: demasiado rápido, ticket falso o caducado y campo trampa", async () => {
    const fast = (await app.call("GET", "/public/form-ticket")).json.ticket;
    expect((await app.submit(form(fast))).json.error).toBe("too_fast");
    expect((await app.submit(form("v1.abc.def.ghi"))).json.error).toBe("invalid_ticket");
    const old = await app.ticket();
    app.tick(3 * 60 * 60 * 1000);
    expect((await app.submit(form(old))).json.error).toBe("invalid_ticket");
    const t = await app.ticket();
    const bot = await app.submit(form(t, { website: "https://spam.example" }));
    expect(bot.status).toBe(202);
    expect(bot.json).toEqual({ status: "received" });
    expect(await app.store.list("leads")).toHaveLength(0);
    expect(app.audit.some((e) => e.reason === "honeypot")).toBe(true);
  });

  it("validación estricta: campos desconocidos, consentimiento, correo y tipo; sin devolver valores", async () => {
    const t = await app.ticket();
    const bad = await app.submit(form(t, { email: "no-es-correo", tenantId: "hack", role: "admin" }));
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_request");
    expect(bad.raw).not.toContain("no-es-correo");
    expect((await app.submit(form(t, { consents: { privacy: false, marketing: false } }))).json.fields).toContain("consents.privacy");
    expect((await app.submit(form(t, { type: "module_info" }))).json.fields).toContain("interest");
    expect((await app.submit(form(t, { type: "admin" }))).status).toBe(400);
    expect((await app.submit(form(t, { configuration: { plan: "x", extensions: ["../etc"], industries: [], interests: [] } }))).status).toBe(400);
    expect((await app.call("POST", "/public/requests", { body: form(t) })).json.fields).toEqual(["Idempotency-Key"]);
    const big = await app.submit(form(t, { message: "x".repeat(20_000) }));
    expect([400, 413]).toContain(big.status);
    expect(await app.store.list("leads")).toHaveLength(0);
  });

  it("fallos del backend: transitorio → 503 reintentable; error interno → 500 sin detalles", async () => {
    app.store.fail = "transient";
    const t = await app.ticket();
    const k = key();
    const r = await app.submit(form(t), k);
    expect(r.status).toBe(503);
    expect(r.headers["retry-after"]).toBe("30");
    // El ticket no se consumió: el reintento con la misma clave funciona al recuperarse
    app.store.fail = null;
    expect((await app.submit(form(t), k)).status).toBe(201);
    app.store.fail = "bug";
    const t2 = await app.ticket();
    const e = await app.submit(form(t2, { type: "trial" }));
    expect(e.status).toBe(500);
    expect(e.json).toEqual({ error: "internal_error" });
    expect(e.raw).not.toContain(SECRET);
  });

  it("gestión en el CRM: bandeja, ficha del lead con solicitudes, atender y permisos", async () => {
    const t = await app.ticket();
    const sub = await app.submit(form(t));
    const list = await app.call("GET", "/crm/requests?status=pending", { token: READ });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ available: true, total: 1 });
    const row = list.json.requests[0];
    expect(row.request.reference).toBe(sub.json.reference);
    expect(row.request).not.toHaveProperty("idempotencyKey");
    expect(row.request).not.toHaveProperty("ipHash");
    const lead = await app.call("GET", `/crm/leads/${row.lead.id}`, { token: READ });
    expect(lead.json.requests[0]).toMatchObject({ reference: sub.json.reference, configuration: { plan: "business" } });
    expect((await app.call("POST", `/crm/requests/${row.request.id}/status`, { token: READ, body: { status: "attended" } })).status).toBe(403);
    expect((await app.call("POST", `/crm/requests/${row.request.id}/status`, { body: { status: "attended" } })).status).toBe(401);
    const ok = await app.call("POST", `/crm/requests/${row.request.id}/status`, { token: FULL, body: { status: "attended" } });
    expect(ok.json.request).toMatchObject({ status: "attended", attendedBy: "crm:ana" });
    expect((await app.call("GET", `/crm/leads/${row.lead.id}`, { token: READ })).json.lead.status).toBe("contacted");
    const dash = await app.call("GET", "/crm/dashboard", { token: READ });
    expect(dash.json.webRequests).toMatchObject({ pending: 0 });
    expect((await app.call("GET", "/crm/assignees", { token: READ })).json).toEqual({ assignees: [] });
    // Convertir con la configuración pedida: el circuito comercial de siempre
    const conv = await app.call("POST", `/crm/leads/${row.lead.id}/convert`, {
      token: FULL,
      body: { opportunity: { title: "Hotel Demo · Business", planId: "business", modules: ["hotel"] } },
    });
    expect(conv.status).toBe(200);
    expect(conv.json.opportunity).toMatchObject({ planId: "business", modules: ["hotel"] });
  });
});

describe("límites de la API pública", () => {
  it("por IP", async () => {
    const app = await startApp({ perIp: 2 });
    try {
      const t = await app.ticket();
      await app.submit(form(t));
      await app.submit(form(t, { email: "b@demo.test" }));
      const r = await app.submit(form(t, { email: "c@demo.test" }));
      expect(r.status).toBe(429);
      expect(r.json.error).toBe("rate_limited");
      expect(r.headers["retry-after"]).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("por correo, aunque cambie la IP o el ticket", async () => {
    const app = await startApp({ perEmailPerHour: 2 });
    try {
      for (const type of ["trial", "contact"]) expect((await app.submit(form(await app.ticket(), { type }))).status).toBe(201);
      const r = await app.submit(form(await app.ticket(), { type: "configuration" }));
      expect(r.status).toBe(429);
      app.tick(61 * 60 * 1000);
      expect((await app.submit(form(await app.ticket(), { type: "configuration" }))).status).toBe(201);
    } finally {
      await app.close();
    }
  });

  it("sin configuración no existe ninguna ruta pública", async () => {
    const app = await startApp({ publicIntake: false });
    try {
      expect((await app.call("GET", "/public/form-ticket")).status).toBe(401);
      expect((await app.call("POST", "/public/requests", { body: {} })).status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
