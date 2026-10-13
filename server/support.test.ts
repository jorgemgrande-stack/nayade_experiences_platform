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

function call(method: string, path: string, opts: { tenant?: string; cookie?: string } = {}) {
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
  configureSupport(store, SECRET);
  logs.length = 0;
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
    expect(JSON.parse(w.body)).toEqual({ error: "support_read_only" });
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
    configureSupport(store, undefined);
    expect((await call("GET", `/_support/enter?t=${forged}`, { tenant: "acme" })).status).toBe(404);
  });
});
