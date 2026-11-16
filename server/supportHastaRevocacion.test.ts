/**
 * Soporte delegado «hasta revocación» (16/11/2026): la AUTORIZACIÓN no caduca; cada SESIÓN sí (2 h sin actividad,
 * 12 h como máximo), se renueva desde el CRM con el operador autenticado y se cierra sin revocar la autorización.
 * Revocar invalida todas sus sesiones al momento. Mismos vetos y la misma auditoría que el acceso limitado.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MemorySupportStore, UNTIL_REVOKED_EXPIRES_AT, buildGrant, grantActive, type SupportGrant } from "./_core/support/grants";
import {
  _resetSupportReplicaState,
  configureSupport,
  createSupportRouter,
  getSupportUser,
  signSupportToken,
  supportReadOnlyGuard,
  SUPPORT_COOKIE,
  SUPPORT_SESSION_IDLE_MS,
  SUPPORT_SESSION_MAX_MS,
  SUPPORT_SESSION_REFRESH_MS,
} from "./_core/support/session";
import { supportAuditSender, SUPPORT_AUDIT_PATH } from "./_core/support/audit";
import { runWithTenant } from "./_core/tenant";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { supportModeLabel } from "../client/src/components/SupportModeBar";

const SECRET = "s".repeat(40);
const MIN = 60_000;

// ── Core: sesiones de una autorización «hasta revocación» ───────────────────────────────────────────────────────
describe("Core: sesiones de soporte hasta revocación", () => {
  let store: MemorySupportStore;
  let server: http.Server;
  let port: number;
  const events: Array<{ gid: string; ev: string; d: Record<string, unknown> }> = [];
  let auditUp = true;
  // Como el plano de control: la salida cierra la sesión (hasta revocación) o revoca la concesión (limitada)
  const auditStub = async (c: { gid: string; ev: string; d: Record<string, unknown> }) => {
    if (!auditUp) return false;
    events.push(c);
    const g = store.grants.get(c.gid);
    if (c.ev === "exited" && g) {
      if (g.untilRevoked && typeof c.d.session === "string") store.endSession(g.id, c.d.session);
      else if (!g.untilRevoked) store.revoke(g.id);
    }
    return true;
  };

  const beat = (cookie: string) => call("POST", "/_support/heartbeat", { tenant: "acme", cookie });
  function call(method: string, path: string, o: { tenant?: string; cookie?: string } = {}) {
    return new Promise<{ status: number; body: string; setCookie?: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path, method, headers: { ...(o.tenant ? { "x-test-tenant": o.tenant } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, setCookie: res.headers["set-cookie"]?.[0] }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
  const cookieFrom = (s?: string) => (s ?? "").split(";")[0];
  const who = async (cookie: string, tenant = "acme") => JSON.parse((await call("GET", "/me", { tenant, cookie })).body);

  async function enter(o: { tenant?: string; readOnly?: boolean; untilRevoked?: boolean; grant?: SupportGrant } = {}) {
    const tenant = o.tenant ?? "acme";
    const g = o.grant ?? store.create({ tenantId: tenant, operator: "operator:jorge", reason: "Implantación Quantum", untilRevoked: o.untilRevoked ?? true, minutes: 30, readOnly: o.readOnly ?? false });
    const r = await call("GET", `/_support/enter?t=${await signSupportToken(g, SECRET)}`, { tenant });
    return { g, r, cookie: cookieFrom(r.setCookie) };
  }

  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      const t = req.headers["x-test-tenant"];
      if (typeof t === "string") runWithTenant(t, () => next());
      else next();
    });
    app.use(supportReadOnlyGuard(() => undefined));
    app.use(createSupportRouter());
    app.get("/me", async (req, res) => {
      const u = await getSupportUser(req);
      res.json(u ? { support: true, readOnly: u.supportReadOnly, untilRevoked: u.supportUntilRevoked, expiresAt: u.supportExpiresAt, label: supportModeLabel(u) } : { support: false });
    });
    app.post("/data", (_req, res) => res.json({ wrote: true }));
    app.post("/api/auth/change-password", (_req, res) => res.json({ changed: true }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    configureSupport(null);
  });
  beforeEach(() => {
    store = new MemorySupportStore();
    configureSupport(store, SECRET, { audit: auditStub as never, returnUrl: "https://crm.example/" });
    _resetSupportReplicaState();
    events.length = 0;
    auditUp = true;
  });
  afterEach(() => vi.useRealTimers());

  it("la autorización no caduca: sin fecha que mostrar y con la banda «Hasta revocación»", async () => {
    const { g, r, cookie } = await enter();
    expect(r.status).toBe(302);
    expect(g.untilRevoked).toBe(true);
    expect(g.expiresAt).toBe(UNTIL_REVOKED_EXPIRES_AT);
    expect(grantActive(g, Date.now() + 365 * 24 * 60 * MIN)).toBe(true);
    expect(await who(cookie)).toMatchObject({ support: true, readOnly: false, untilRevoked: true, expiresAt: null, label: "Soporte Big Elephant · Con modificación · Hasta revocación" });
    // La entrada se registra con el identificador de la sesión
    expect(events[0]).toMatchObject({ ev: "entered", d: { session: expect.stringMatching(/^[a-f0-9]{24}$/) } });
    // La cookie no es permanente: dura la sesión (12 h), no la autorización
    const maxAge = Number(/Max-Age=(\d+)/i.exec(r.setCookie ?? "")?.[1]);
    expect(maxAge).toBeLessThanOrEqual(SUPPORT_SESSION_MAX_MS / 1000);
  });

  it("solo administración en la concesión; aquí, «hasta revocación» con solo lectura sigue siendo solo lectura", async () => {
    const { cookie } = await enter({ readOnly: true });
    expect((await call("POST", "/data", { tenant: "acme", cookie })).status).toBe(403);
    expect(await who(cookie)).toMatchObject({ label: "Soporte Big Elephant · Solo lectura · Hasta revocación" });
  });

  it("con modificación: cada cambio se registra antes y con su resultado; lo sensible sigue vetado; sin registro no se modifica", async () => {
    const { cookie } = await enter();
    events.length = 0;
    expect((await call("POST", "/data", { tenant: "acme", cookie })).status).toBe(200);
    await new Promise((x) => setTimeout(x, 20));
    expect(events.map((e) => e.ev)).toEqual(["write", "write_result"]);
    expect((await call("POST", "/api/auth/change-password", { tenant: "acme", cookie })).status).toBe(403);
    auditUp = false;
    expect((await call("POST", "/data", { tenant: "acme", cookie })).status).toBe(503);
  });

  it("sesión: 2 h sin actividad la cierran; con actividad real se renueva, pero nunca más allá de 12 h", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const idle = await enter();
    vi.setSystemTime(Date.now() + SUPPORT_SESSION_IDLE_MS + MIN);
    expect((await who(idle.cookie)).support).toBe(false);
    // La autorización sigue: desde el CRM se abre otra sesión
    expect(grantActive(idle.g)).toBe(true);
    const again = await enter({ grant: idle.g });
    expect((await who(again.cookie)).support).toBe(true);

    // Con actividad real cada hora (aviso del panel o una modificación): la cookie se renueva, hasta el tope de 12 h
    let cookie = again.cookie;
    events.length = 0;
    let renewed = 0;
    for (let h = 1; h <= 11; h++) {
      vi.setSystemTime(Date.now() + 60 * MIN);
      const r = h % 2 ? await beat(cookie) : await call("POST", "/data", { tenant: "acme", cookie });
      expect(r.status, `hora ${h}`).toBe(200);
      if (r.setCookie) {
        cookie = cookieFrom(r.setCookie);
        renewed++;
      }
    }
    expect(renewed).toBe(11);
    expect(events.filter((e) => e.ev === "activity")).toHaveLength(11);
    vi.setSystemTime(Date.now() + 61 * MIN); // 12 h y 1 min desde la apertura
    expect((await who(cookie)).support).toBe(false);
  });

  it("las consultas periódicas del panel no mantienen viva la sesión: una pestaña abandonada se cierra a las 2 h", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const { cookie } = await enter();
    events.length = 0;
    for (let m = 0; m < 5; m++) {
      vi.setSystemTime(Date.now() + 20 * MIN);
      const r = await call("GET", "/me", { tenant: "acme", cookie });
      expect(JSON.parse(r.body).support).toBe(true);
      expect(r.setCookie).toBeUndefined();
    }
    expect(events).toEqual([]);
    vi.setSystemTime(Date.now() + 21 * MIN); // 2 h y 1 min sin actividad real
    expect((await who(cookie)).support).toBe(false);
  });

  it("el aviso de actividad renueva como mucho cada 15 minutos y solo si queda registrado", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const { cookie } = await enter();
    events.length = 0;
    const early = await beat(cookie);
    expect(JSON.parse(early.body)).toEqual({ ok: true, renewed: false });
    expect(early.setCookie).toBeUndefined();
    vi.setSystemTime(Date.now() + SUPPORT_SESSION_REFRESH_MS + 1000);
    auditUp = false;
    const unrecorded = await beat(cookie);
    expect(JSON.parse(unrecorded.body)).toEqual({ ok: true, renewed: false });
    expect(unrecorded.setCookie).toBeUndefined();
    auditUp = true;
    const ok = await beat(cookie);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, renewed: true });
    expect(ok.setCookie).toMatch(new RegExp(`^${SUPPORT_COOKIE}=`));
    expect(events.map((e) => e.ev)).toEqual(["activity"]);
    // Sin sesión de soporte, o desde otro origen, nada
    expect((await call("POST", "/_support/heartbeat", { tenant: "acme" })).status).toBe(401);
  });

  it("si el cierre no queda registrado, no se aparenta: 503, la cookie se queda y se puede reintentar", async () => {
    const { g, cookie } = await enter();
    auditUp = false;
    const fail = await call("POST", "/_support/exit", { tenant: "acme", cookie });
    expect(fail.status).toBe(503);
    expect(fail.setCookie).toBeUndefined();
    expect(JSON.parse(fail.body)).toMatchObject({ error: "exit_unrecorded", message: expect.stringContaining("revoca") });
    expect((await who(cookie)).support).toBe(true);
    auditUp = true;
    const ok = await call("POST", "/_support/exit", { tenant: "acme", cookie });
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toMatch(/es_support=;/);
    expect((await who(cookie)).support).toBe(false);
    expect(g.revokedAt).toBeNull();
  });

  it("«Finalizar sesión» cierra esa sesión en el servidor sin revocar la autorización; las demás sesiones siguen", async () => {
    const a = await enter();
    const b = await enter({ grant: a.g }); // acceso simultáneo (otra pestaña u otro navegador)
    events.length = 0;
    const out = await call("POST", "/_support/exit", { tenant: "acme", cookie: a.cookie });
    expect(JSON.parse(out.body)).toEqual({ returnUrl: "https://crm.example/", authorizationKept: true });
    expect(events).toEqual([expect.objectContaining({ ev: "exited", d: { session: expect.any(String) } })]);
    expect(a.g.revokedAt).toBeNull();
    // La cookie copiada de la sesión cerrada ya no vale, ni siquiera en otra réplica (sin memoria local)
    expect((await who(a.cookie)).support).toBe(false);
    _resetSupportReplicaState();
    expect((await who(a.cookie)).support).toBe(false);
    expect((await who(b.cookie)).support).toBe(true);
  });

  it("revocar invalida al instante todas las sesiones: ni lecturas ni modificaciones en modo soporte", async () => {
    const a = await enter();
    const b = await enter({ grant: a.g });
    store.revoke(a.g.id);
    expect((await who(a.cookie)).support).toBe(false);
    expect((await who(b.cookie)).support).toBe(false);
    events.length = 0;
    await call("POST", "/data", { tenant: "acme", cookie: a.cookie });
    expect(events).toEqual([]); // sin identidad de soporte: el borde no deja pasar nada en su nombre
    expect((await call("GET", `/_support/enter?t=${await signSupportToken(a.g, SECRET)}`, { tenant: "acme" })).status).toBe(403);
  });

  it("aislamiento: la sesión de una empresa no vale en otra", async () => {
    const { cookie } = await enter({ tenant: "acme" });
    expect((await who(cookie, "otra")).support).toBe(false);
  });

  it("reinicio: la sesión sigue (estado en la cookie firmada y en el registro), y un enlace usado no vuelve a abrir", async () => {
    const g = store.create({ tenantId: "acme", operator: "operator:jorge", reason: "Implantación Quantum", untilRevoked: true });
    const link = await signSupportToken(g, SECRET);
    const r = await call("GET", `/_support/enter?t=${link}`, { tenant: "acme" });
    const cookie = cookieFrom(r.setCookie);
    configureSupport(store, SECRET, { audit: auditStub as never, returnUrl: "https://crm.example/" });
    _resetSupportReplicaState();
    expect((await who(cookie)).support).toBe(true);
  });

  it("si no se puede comprobar el cierre de la sesión, no vale (falla cerrado)", async () => {
    const { cookie } = await enter();
    store.sessionEnded = async () => {
      throw new Error("registro caído");
    };
    _resetSupportReplicaState();
    expect((await who(cookie)).support).toBe(false);
  });

  it("compatibilidad: las cookies anteriores (sin sesión identificada) valen hasta su caducidad, solo con duración limitada", async () => {
    // Cookie como las emitidas antes de esta versión: sin sid
    const limited = store.create({ tenantId: "acme", operator: "operator:jorge", reason: "Sesión de 240 minutos", minutes: 240, readOnly: false });
    const legacy = await signSupportToken(limited, SECRET, undefined, "session");
    expect(await who(`${SUPPORT_COOKIE}=${legacy}`)).toMatchObject({ support: true, untilRevoked: false });
    expect((await who(`${SUPPORT_COOKIE}=${legacy}`)).label).toMatch(/Caduca \d\d:\d\d$/);
    // Una cookie sin sesión para una autorización hasta revocación no vale
    const ur = store.create({ tenantId: "acme", operator: "operator:jorge", reason: "Implantación Quantum", untilRevoked: true });
    expect((await who(`${SUPPORT_COOKIE}=${await signSupportToken(ur, SECRET, undefined, "session")}`)).support).toBe(false);
    // Y una concesión limitada sigue terminando al salir (como hasta ahora)
    const l = await enter({ untilRevoked: false });
    const out = await call("POST", "/_support/exit", { tenant: "acme", cookie: l.cookie });
    expect(JSON.parse(out.body)).toEqual({ returnUrl: "https://crm.example/" });
    expect(l.g.revokedAt).not.toBeNull();
  });

  it("concesión: «hasta revocación» no necesita minutos; la limitada sigue exigiéndolos (1–240)", () => {
    expect(buildGrant({ tenantId: "a", operator: "j", reason: "motivo válido", untilRevoked: true }, 0)).toMatchObject({ untilRevoked: true, expiresAt: UNTIL_REVOKED_EXPIRES_AT });
    expect(() => buildGrant({ tenantId: "a", operator: "j", reason: "motivo válido" }, 0)).toThrow(/duración/);
    expect(() => buildGrant({ tenantId: "a", operator: "j", reason: "motivo válido", minutes: 241 }, 0)).toThrow(/duración/);
  });
});

// ── Plano de control: conceder, listar, renovar sesión y revocar ─────────────────────────────────────────────────
describe("plano de control: accesos hasta revocación", () => {
  const TOK = "sup-admin-token-bbbbbbbbbbbbbbbbbbbbbb";
  let server: http.Server | null = null;

  async function start(o: { role?: string; username?: string; noDomain?: string } = {}) {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "test" });
    await registry.createTenant({ id: "otra", displayName: "Otra" }, { type: "operator", id: "test" });
    // Dominio principal activo (el panel de la empresa), salvo en la empresa indicada
    const realList = reg.listDomains.bind(reg);
    (reg as any).listDomains = async (t: string) => (t === o.noDomain ? [] : [...(await realList(t)), { domain: `${t}.app.example`, isPrimary: true, status: "active" }]);
    const grants = new Map<string, SupportGrant>();
    const events: Array<{ tenantId: string; operator: string; action: string; details: Record<string, unknown> }> = [];
    const listed = (g: SupportGrant) => ({ ...g, tenantName: g.tenantId === "acme" ? "Acme" : "Otra", lastActivityAt: Math.max(0, ...events.filter((e) => e.details.grantId === g.id).map(() => Date.now())) || null });
    const live = () => [...grants.values()].filter((g) => grantActive(g));
    const support = {
      create: async (i: Parameters<typeof buildGrant>[0]) => {
        const g = buildGrant(i, Date.now());
        grants.set(g.id, g);
        return g;
      },
      revoke: async (id: string, by: string) => {
        const g = grants.get(id)!;
        g.revokedAt = Date.now();
        events.push({ tenantId: g.tenantId, operator: by, action: "support.revoked", details: { grantId: id, revokedBy: by } });
        return g;
      },
      getGrant: async (id: string) => grants.get(id) ?? null,
      listActive: async (t: string) => live().filter((g) => g.tenantId === t).map(listed),
      listAllActive: async () => live().map(listed),
      record: async (tenantId: string, operator: string, action: string, details: Record<string, unknown>) => void events.push({ tenantId, operator, action, details }),
      sessionEnded: async (_t: string, gid: string, sid: string) => events.some((e) => e.action === "support.exited" && e.details.grantId === gid && e.details.session === sid),
      sessionEntered: async (_t: string, gid: string, sid: string) => events.some((e) => e.action === "support.entered" && e.details.grantId === gid && e.details.session === sid),
    };
    let role = o.role;
    const app = createControlPlaneApp({
      tokens: [{ id: "soporte", sha256: hashToken(TOK), scopes: ["tenants:read", "support:write"] }],
      registry,
      reader: reg,
      platformTarget: "edge.example.com",
      support: support as never,
      supportSecret: SECRET,
      ...(o.role ? { operators: { validateSession: async () => ({ operator: { id: 1, username: o.username ?? "jorge", role }, session: { id: "s".repeat(16), csrfToken: "csrf-ok" }, scopes: ["tenants:read", "support:write"] }) } } : {}),
    } as never);
    server = http.createServer(app);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const raw = (method: string, path: string, q: { token?: string; body?: unknown; session?: boolean } = {}) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        const data = q.body === undefined ? undefined : JSON.stringify(q.body);
        const req = http.request(
          { host: "127.0.0.1", port, path, method, headers: { ...(q.token ? { authorization: `Bearer ${q.token}` } : {}), ...(q.session ? { cookie: "be_cp_session=abc", "x-csrf-token": "csrf-ok" } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
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
    const call = (method: string, path: string, q: { token?: string; body?: unknown; session?: boolean } = {}) => raw(method, `/cp/v1${path}`, q);
    const audit = supportAuditSender({ secret: SECRET, url: `http://127.0.0.1:${port}${SUPPORT_AUDIT_PATH}` });
    return { call, grants, events, audit, setRole: (r: string) => void (role = r) };
  }
  const close = async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  };
  afterEach(close);
  const body = { reason: "Implantación de Quantum Soulrise", untilRevoked: true, readOnly: false };

  it("solo administración (admin y superadmin) concede «hasta revocación»; ni el rol soporte ni un token de servicio", async () => {
    for (const [role, status] of [["admin", 201], ["superadmin", 201], ["support", 403]] as const) {
      const h = await start({ role });
      const r = await h.call("POST", "/tenants/acme/support-access", { session: true, body: { ...body, readOnly: true } });
      expect(r.status, role).toBe(status);
      if (status === 201) {
        expect(r.json).toMatchObject({ untilRevoked: true, expiresAt: null, readOnly: true });
        expect(h.events).toEqual([]); // la concesión la audita el almacén (support.granted) en su transacción
      }
      await close();
    }
    const svc = await start();
    expect((await svc.call("POST", "/tenants/acme/support-access", { token: TOK, body: { ...body, readOnly: true } })).status).toBe(403);
    // Sin duración ni «hasta revocación»: petición incompleta
    expect((await svc.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #12 de prueba" } })).status).toBe(400);
  });

  it("gestión global: todas las empresas, con modo, duración, última actividad y estado; sin tokens", async () => {
    const h = await start({ role: "admin" });
    const a = await h.call("POST", "/tenants/acme/support-access", { session: true, body });
    const b = await h.call("POST", "/tenants/otra/support-access", { session: true, body: { reason: "Ticket #13 de prueba", minutes: 30 } });
    const c = await h.call("POST", "/tenants/otra/support-access", { session: true, body: { reason: "Ticket #14 de prueba", minutes: 30 } });
    expect((await h.call("DELETE", `/support-access/${c.json.grantId}`, { session: true })).status).toBe(204);
    const l = await h.call("GET", "/support-access", { session: true });
    expect(l.status).toBe(200);
    const byId = Object.fromEntries(l.json.grants.map((g: any) => [g.grantId, g]));
    expect(Object.keys(byId).sort()).toEqual([a.json.grantId, b.json.grantId].sort());
    expect(byId[a.json.grantId]).toMatchObject({ tenantId: "acme", tenantName: "Acme", operator: "operator:jorge", readOnly: false, untilRevoked: true, expiresAt: null, state: "active" });
    expect(byId[b.json.grantId]).toMatchObject({ tenantId: "otra", untilRevoked: false, expiresAt: expect.any(String) });
    expect(JSON.stringify(l.json)).not.toMatch(/token|enterUrl/i);
    // Por empresa: solo las suyas
    expect((await h.call("GET", "/tenants/acme/support-access", { session: true })).json.grants.map((g: any) => g.grantId)).toEqual([a.json.grantId]);
  });

  it("sin dominio principal activo no se crea una autorización indefinida (no quedaría vigente sin poder usarse)", async () => {
    const h = await start({ role: "admin", noDomain: "acme" });
    const r = await h.call("POST", "/tenants/acme/support-access", { session: true, body });
    expect(r.status).toBe(409);
    expect(h.grants.size).toBe(0);
  });

  it("renovar con una autorización hasta revocación de solo lectura también exige seguir siendo administración", async () => {
    const h = await start({ role: "admin" });
    const a = await h.call("POST", "/tenants/acme/support-access", { session: true, body: { ...body, readOnly: true } });
    expect((await h.call("POST", `/support-access/${a.json.grantId}/session`, { session: true })).status).toBe(201);
    h.setRole("support");
    expect((await h.call("POST", `/support-access/${a.json.grantId}/session`, { session: true })).status).toBe(403);
  });

  it("renovar la sesión: solo el operador autorizado, autenticado; queda registrado; con modificación solo si sigue siendo administración", async () => {
    const h = await start({ role: "admin" });
    const a = await h.call("POST", "/tenants/acme/support-access", { session: true, body });
    const r = await h.call("POST", `/support-access/${a.json.grantId}/session`, { session: true });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ grantId: a.json.grantId, untilRevoked: true, readOnly: false });
    expect(h.events.map((e) => [e.action, e.operator])).toEqual([["support.session_renewed", "operator:jorge"]]);
    // Otro operador (aunque tenga support:write) no abre sesiones con la autorización de otra persona
    expect((await h.call("POST", `/support-access/${a.json.grantId}/session`, { token: TOK })).status).toBe(403);
    // Si su rol deja de ser administración, no reabre con modificación
    h.setRole("support");
    expect((await h.call("POST", `/support-access/${a.json.grantId}/session`, { session: true })).status).toBe(403);
    h.setRole("admin");
    // Revocada: no hay sesión nueva
    await h.call("DELETE", `/support-access/${a.json.grantId}`, { session: true });
    expect((await h.call("POST", `/support-access/${a.json.grantId}/session`, { session: true })).status).toBe(404);
    expect((await h.call("POST", `/support-access/${"f".repeat(32)}/session`, { session: true })).status).toBe(404);
  });

  it("revocar: a nombre de quien revoca (no del beneficiario), efectivo en el servidor; desconocido 404", async () => {
    const h = await start({ role: "admin", username: "ana" });
    const a = await h.call("POST", "/tenants/acme/support-access", { session: true, body });
    expect((await h.call("DELETE", `/support-access/${a.json.grantId}`, { token: TOK })).status).toBe(204);
    expect(h.events.at(-1)).toMatchObject({ action: "support.revoked", operator: "crm:soporte", details: { revokedBy: "crm:soporte" } });
    expect(grantActive(h.grants.get(a.json.grantId)!)).toBe(false);
    expect((await h.audit({ gid: a.json.grantId, tid: "acme", ev: "write", d: {} }))).toBe(false); // ya no se modifica
    expect((await h.call("DELETE", `/support-access/${"e".repeat(32)}`, { token: TOK })).status).toBe(404);
  });

  it("auditoría del Core: salir cierra solo la sesión; la actividad se anota; revocada, ya no", async () => {
    const h = await start({ role: "admin" });
    const a = await h.call("POST", "/tenants/acme/support-access", { session: true, body });
    const sid = "a1".repeat(12);
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "entered", d: { session: sid } })).toBe(true);
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "activity", d: { session: sid } })).toBe(true);
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "exited", d: { session: sid } })).toBe(true);
    expect(h.grants.get(a.json.grantId)!.revokedAt).toBeNull();
    expect(h.events.map((e) => e.action).slice(0, 3)).toEqual(["support.entered", "support.activity", "support.exited"]);
    expect(h.events[0].details).toMatchObject({ untilRevoked: true, expiresAt: null, session: sid, reason: body.reason });
    expect(h.events[2].details).toMatchObject({ grantId: a.json.grantId, session: sid });
    // Actividad de una sesión ya cerrada: no se anota (el Core no la renueva)
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "activity", d: { session: sid } })).toBe(false);
    // Un enlace (= una sesión) no abre dos veces, aunque lo canjeen dos réplicas distintas
    const sid2 = "e5".repeat(12);
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "entered", d: { session: sid2 } })).toBe(true);
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "entered", d: { session: sid2 } })).toBe(false);
    await h.call("DELETE", `/support-access/${a.json.grantId}`, { session: true });
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "activity", d: { session: sid2 } })).toBe(false);
    expect(await h.audit({ gid: a.json.grantId, tid: "acme", ev: "entered", d: { session: "b2".repeat(12) } })).toBe(false);
  });
});
