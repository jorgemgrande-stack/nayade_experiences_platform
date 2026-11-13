/**
 * Acceso delegado de soporte: concesión temporal, ligada al tenant, de solo lectura por
 * defecto, revocable, y sin posibilidad de cruzar a otro tenant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MemorySupportStore, MAX_SUPPORT_MINUTES, buildGrant } from "./_core/support/grants";
import {
  configureSupport,
  createSupportRouter,
  getSupportIdentity,
  signSupportToken,
  supportReadOnlyGuard,
  SUPPORT_COOKIE,
} from "./_core/support/session";
import { runWithTenant } from "./_core/tenant";

const SECRET = "s".repeat(40);
let store: MemorySupportStore;
let server: http.Server;
let port: number;
const logs: string[] = [];
const events: Array<{ ev: string; d: Record<string, unknown> }> = [];
let auditUp = true;
const auditStub = async (c: { ev: string; d: Record<string, unknown> }) => (auditUp ? (events.push({ ev: c.ev, d: c.d }), true) : false);

function call(method: string, path: string, opts: { tenant?: string; cookie?: string; https?: boolean; origin?: string } = {}) {
  return new Promise<{ status: number; body: string; setCookie?: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(opts.tenant ? { "x-test-tenant": opts.tenant } : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...(opts.https ? { "x-forwarded-proto": "https" } : {}),
          ...(opts.origin ? { origin: opts.origin } : {}),
        },
      },
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

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1); // como en producción: HTTPS por X-Forwarded-Proto
  app.use((req, _res, next) => {
    const t = req.headers["x-test-tenant"];
    if (typeof t === "string") runWithTenant(t, () => next());
    else next();
  });
  app.use(supportReadOnlyGuard((l) => logs.push(l)));
  app.use(createSupportRouter());
  app.get("/data", async (req, res) => {
    const id = await getSupportIdentity(req);
    res.json({ support: !!id });
  });
  app.post("/data", (_req, res) => res.json({ wrote: true }));
  app.post("/api/auth/change-password", (_req, res) => res.json({ changed: true }));
  app.get("/api/settlements/7/export-excel", (_req, res) => res.json({ excel: true }));
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
  logs.length = 0;
  events.length = 0;
  auditUp = true;
});

const cookieFrom = (setCookie?: string) => (setCookie ?? "").split(";")[0];

async function enter(tenant: string, readOnly = true, minutes = 30) {
  const g = store.create({ tenantId: tenant, operator: "jorge", reason: "Incidencia #123", minutes, readOnly });
  const token = await signSupportToken(g, SECRET);
  const r = await call("GET", `/_support/enter?t=${token}`, { tenant });
  return { g, token, r };
}

describe("concesiones", () => {
  it("exige motivo y duración acotada", () => {
    expect(() => buildGrant({ tenantId: "a", operator: "j", reason: "", minutes: 10 }, 0)).toThrow(/motivo/);
    expect(() => buildGrant({ tenantId: "a", operator: "j", reason: "motivo válido", minutes: 0 }, 0)).toThrow();
    expect(() => buildGrant({ tenantId: "a", operator: "j", reason: "motivo válido", minutes: MAX_SUPPORT_MINUTES + 1 }, 0)).toThrow();
    expect(buildGrant({ tenantId: "a", operator: "j", reason: "motivo válido", minutes: 60 }, 0).readOnly).toBe(true);
  });
});

describe("sesión de soporte", () => {
  it("por HTTPS la cookie es __Host-es_support (Secure, Path=/, sin Domain) y la de sin prefijo no vale", async () => {
    const g = store.create({ tenantId: "acme", operator: "jorge", reason: "Incidencia #124", minutes: 30, readOnly: true });
    const token = await signSupportToken(g, SECRET);
    const r = await call("GET", `/_support/enter?t=${token}`, { tenant: "acme", https: true });
    expect(r.status).toBe(302);
    expect(r.setCookie).toMatch(/^__Host-es_support=/);
    expect(r.setCookie).toMatch(/;\s*Secure/i);
    expect(r.setCookie).toMatch(/;\s*Path=\/(;|$)/);
    expect(r.setCookie).not.toMatch(/Domain=/i);
    const ok = await call("GET", "/data", { tenant: "acme", https: true, cookie: cookieFrom(r.setCookie) });
    expect(JSON.parse(ok.body)).toEqual({ support: true });
    // El mismo token con el nombre sin prefijo (fijable desde otra empresa con Domain=<dominio padre>): no vale
    const legacy = await call("GET", "/data", { tenant: "acme", https: true, cookie: `${SUPPORT_COOKIE}=${token}` });
    expect(JSON.parse(legacy.body)).toEqual({ support: false });
  });

  it("canjea el token en el tenant concedido y establece cookie HttpOnly/Strict", async () => {
    const { r } = await enter("acme");
    expect(r.status).toBe(302);
    expect(r.setCookie).toContain(`${SUPPORT_COOKIE}=`);
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Strict/i);
    const who = await call("GET", "/data", { tenant: "acme", cookie: cookieFrom(r.setCookie) });
    expect(JSON.parse(who.body)).toEqual({ support: true });
  });

  it("el token concedido para un tenant no sirve en otro", async () => {
    const { g, token } = await enter("acme");
    const r = await call("GET", `/_support/enter?t=${token}`, { tenant: "otro" });
    expect(r.status).toBe(403);
    const who = await call("GET", "/data", { tenant: "otro", cookie: `${SUPPORT_COOKIE}=${token}` });
    expect(JSON.parse(who.body)).toEqual({ support: false });
    void g;
  });

  it("solo lectura: las escrituras se rechazan y quedan registradas", async () => {
    const { r } = await enter("acme", true);
    const c = cookieFrom(r.setCookie);
    expect((await call("GET", "/data", { tenant: "acme", cookie: c })).status).toBe(200);
    const w = await call("POST", "/data", { tenant: "acme", cookie: c });
    expect(w.status).toBe(403);
    expect(JSON.parse(w.body)).toMatchObject({ error: "support_read_only", message: expect.stringContaining("solo lectura") });
    expect(logs.some((l) => l.includes("write_blocked") && l.includes("jorge"))).toBe(true);
    expect(logs.join("")).not.toContain(c.split("=")[1]); // el token no se registra
  });

  it("con permiso de escritura explícito, se permiten escrituras", async () => {
    const { r } = await enter("acme", false);
    const w = await call("POST", "/data", { tenant: "acme", cookie: cookieFrom(r.setCookie) });
    expect(w.status).toBe(200);
  });

  it("la revocación surte efecto inmediato", async () => {
    const { g, r } = await enter("acme");
    const c = cookieFrom(r.setCookie);
    expect(JSON.parse((await call("GET", "/data", { tenant: "acme", cookie: c })).body).support).toBe(true);
    store.revoke(g.id);
    expect(JSON.parse((await call("GET", "/data", { tenant: "acme", cookie: c })).body).support).toBe(false);
    expect((await call("GET", `/_support/enter?t=${(await signSupportToken(g, SECRET))}`, { tenant: "acme" })).status).toBe(403);
  });

  it("una concesión caducada no vale", async () => {
    const { g, r } = await enter("acme");
    g.expiresAt = Date.now() - 1000;
    const who = await call("GET", "/data", { tenant: "acme", cookie: cookieFrom(r.setCookie) });
    expect(JSON.parse(who.body).support).toBe(false);
  });

  it("sin secreto configurado no hay soporte (404) y los tokens firmados con otro secreto se rechazan", async () => {
    const { g } = await enter("acme");
    const forged = await signSupportToken(g, "x".repeat(40));
    expect((await call("GET", `/_support/enter?t=${forged}`, { tenant: "acme" })).status).toBe(403);
    configureSupport(store, undefined, { audit: auditStub as never });
    expect((await call("GET", `/_support/enter?t=${forged}`, { tenant: "acme" })).status).toBe(404);
  });
});

describe("auditoría y límites del modo soporte", () => {
  it("la entrada queda registrada antes de abrir el panel; sin registro no se entra", async () => {
    const { r } = await enter("acme");
    expect(r.status).toBe(302);
    expect(events.map((e) => e.ev)).toEqual(["entered"]);
    auditUp = false;
    const again = await enter("acme");
    expect(again.r.status).toBe(503);
    expect(again.r.setCookie).toBeUndefined();
  });

  it("consultas ordinarias sin registro; cada modificación se registra antes y con su resultado", async () => {
    const { r } = await enter("acme", false);
    const c = cookieFrom(r.setCookie);
    events.length = 0;
    await call("GET", "/data", { tenant: "acme", cookie: c });
    expect(events).toHaveLength(0);
    expect((await call("POST", "/data", { tenant: "acme", cookie: c })).status).toBe(200);
    await new Promise((x) => setTimeout(x, 20));
    expect(events.map((e) => e.ev)).toEqual(["write", "write_result"]);
    expect(events[0].d).toMatchObject({ method: "POST", resource: "/data" });
    expect(events[1].d).toMatchObject({ status: 200 });
    // Sin registro, la modificación no se ejecuta
    auditUp = false;
    expect((await call("POST", "/data", { tenant: "acme", cookie: c })).status).toBe(503);
  });

  it("solo lectura: el intento de modificación queda en el historial", async () => {
    const { r } = await enter("acme", true);
    events.length = 0;
    expect((await call("POST", "/data", { tenant: "acme", cookie: cookieFrom(r.setCookie) })).status).toBe(403);
    expect(events.map((e) => e.ev)).toEqual(["write_blocked"]);
  });

  it("rutas sensibles: vetadas en solo lectura; con modificación (administración) permitidas y registradas; exportaciones solo con modificación", async () => {
    const ro = cookieFrom((await enter("acme", true)).r.setCookie);
    const rw = cookieFrom((await enter("acme", false)).r.setCookie);
    events.length = 0;
    const f = await call("POST", "/api/auth/change-password", { tenant: "acme", cookie: ro });
    expect(f.status).toBe(403);
    expect(JSON.parse(f.body).error).toBe("support_forbidden");
    expect((await call("POST", "/api/auth/change-password", { tenant: "acme", cookie: rw })).status).toBe(200);
    expect((await call("GET", "/api/settlements/7/export-excel", { tenant: "acme", cookie: ro })).status).toBe(403);
    expect((await call("GET", "/api/settlements/7/export-excel", { tenant: "acme", cookie: rw })).status).toBe(200);
    expect(events.map((e) => e.ev)).toEqual(["blocked", "write", "write_result", "blocked", "export"]);
  });

  it("solo lectura en /api/trpc: el error va en el formato de tRPC (el panel muestra el mensaje), también en lotes", async () => {
    const ro = cookieFrom((await enter("acme", true)).r.setCookie);
    const one = await call("POST", "/api/trpc/cms.savePageDraft", { tenant: "acme", cookie: ro });
    expect(one.status).toBe(403);
    expect(JSON.parse(one.body)).toMatchObject({ error: { json: { code: -32003, message: expect.stringContaining("solo lectura"), data: { code: "FORBIDDEN", httpStatus: 403, path: "cms.savePageDraft" } } } });
    const batch = await call("POST", "/api/trpc/cms.savePageDraft,cms.publishPage?batch=1", { tenant: "acme", cookie: ro });
    const body = JSON.parse(batch.body);
    expect(body).toHaveLength(2);
    expect(body[1]).toMatchObject({ error: { json: { data: { path: "cms.publishPage" } } } });
  });

  it("salir registra la salida, borra solo la cookie de soporte y devuelve adónde volver", async () => {
    const { r } = await enter("acme");
    const c = cookieFrom(r.setCookie);
    events.length = 0;
    const out = await call("POST", "/_support/exit", { tenant: "acme", cookie: c });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ returnUrl: "https://crm.example/" });
    expect(out.setCookie).toMatch(/es_support=;/);
    expect(events.map((e) => e.ev)).toEqual(["exited"]);
  });
});

describe("enlace de entrada y tipos de token (revisión de seguridad)", () => {
  it("el enlace es de un solo uso y no vale como cookie; la cookie no vale como enlace", async () => {
    const { token, r } = await enter("acme");
    expect(r.status).toBe(302);
    const cookie = cookieFrom(r.setCookie);
    expect(cookie.split("=")[1]).not.toBe(token); // credencial distinta
    expect((await call("GET", `/_support/enter?t=${token}`, { tenant: "acme" })).status).toBe(403);
    expect(JSON.parse((await call("GET", "/data", { tenant: "acme", cookie: `${SUPPORT_COOKIE}=${token}` })).body)).toEqual({ support: false });
    expect((await call("GET", `/_support/enter?t=${cookie.split("=")[1]}`, { tenant: "acme" })).status).toBe(403);
  });

  it("un evento de auditoría firmado no abre sesión ni como enlace ni como cookie", async () => {
    const { signSupportAudit } = await import("./_core/support/audit");
    const g = store.create({ tenantId: "acme", operator: "jorge", reason: "Incidencia #125", minutes: 30 });
    const ev = await signSupportAudit(SECRET, { gid: g.id, tid: "acme", ev: "entered", d: {} });
    expect((await call("GET", `/_support/enter?t=${ev}`, { tenant: "acme" })).status).toBe(403);
    expect(JSON.parse((await call("GET", "/data", { tenant: "acme", cookie: `${SUPPORT_COOKIE}=${ev}` })).body)).toEqual({ support: false });
  });

  it("salir desde otro origen (otra empresa del mismo dominio) se rechaza", async () => {
    const c = cookieFrom((await enter("acme")).r.setCookie);
    events.length = 0;
    expect((await call("POST", "/_support/exit", { tenant: "acme", cookie: c, origin: "https://otra.app.example" })).status).toBe(403);
    expect(events).toHaveLength(0);
  });

  it("diagnóstico y recuperación de pagos vetados, también con mayúsculas", async () => {
    const { classifySupportRequest } = await import("./_core/support/policy");
    expect(classifySupportRequest("GET", "/api/admin/diagnose-order/X1").kind).toBe("forbidden");
    expect(classifySupportRequest("POST", "/API/AUTH/handoff").kind).toBe("forbidden");
  });
});
