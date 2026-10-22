/**
 * Soporte desde el panel de la empresa: la empresa crea, consulta, responde y reabre SUS incidencias; nunca ve notas
 * internas ni datos del equipo; el equipo trabaja con las mismas incidencias desde /tickets.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type ServiceToken } from "./controlPlane/auth";
import { createTicketsRouter } from "./controlPlane/tickets";
import { createCustomerTicketsRouter } from "./support/customerTickets";
import { MemoryTicketStore, TicketService } from "./_core/support/tickets";

const CORE = "core-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";
const CORE_SUPPORT = "core-support-token-bbbbbbbbbbbbbbbbbbb";
const TEAM = "team-token-cccccccccccccccccccccccccc";
const tokens: ServiceToken[] = [
  { id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] },
  { id: "core-support", sha256: hashToken(CORE_SUPPORT), scopes: ["commerce:support"] },
  { id: "agente-ana", sha256: hashToken(TEAM), scopes: ["tickets:read", "tickets:write"] },
];

let server: http.Server;
let port: number;
const told: Array<{ id: number; kind: string; to: string | null }> = [];

function call(method: string, path: string, opts: { token?: string | null; body?: unknown } = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const token = opts.token === undefined ? CORE : opts.token;
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
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  let now = 1_000;
  const service = new TicketService(new MemoryTicketStore(), async (t) => ["acme", "beta"].includes(t), () => ++now, async (t, kind) => void told.push({ id: t.id, kind, to: t.requester }));
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authenticate(tokens));
  router.use("/tickets", createTicketsRouter(service));
  router.use("/commerce", createCustomerTicketsRouter(service));
  app.use("/cp/v1", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const open = (tenant: string, title: string, by = "lucia@acme.example") =>
  call("POST", `/commerce/tenants/${tenant}/tickets`, { body: { title, description: `Detalle de la incidencia: ${title}`, category: "technical", requestedBy: by } });

describe("soporte desde el panel de la empresa", () => {
  it("solo el token del Core (commerce:support o commerce:purchase); el del equipo no", async () => {
    expect((await call("GET", "/commerce/tenants/acme/tickets", { token: null })).status).toBe(401);
    expect((await call("GET", "/commerce/tenants/acme/tickets", { token: TEAM })).status).toBe(403);
    expect((await call("GET", "/commerce/tenants/acme/tickets", { token: CORE_SUPPORT })).status).toBe(200);
    expect((await call("GET", "/commerce/tenants/ACME!/tickets")).status).toBe(400);
  });

  it("valida entradas: título, descripción, categoría y quién la abre", async () => {
    expect((await call("POST", "/commerce/tenants/acme/tickets", { body: { title: "x", description: "corta", requestedBy: "lucia@acme.example" } })).status).toBe(400);
    expect((await call("POST", "/commerce/tenants/acme/tickets", { body: { title: "No carga", description: "La agenda no carga desde ayer", category: "otra", requestedBy: "lucia@acme.example" } })).status).toBe(400);
    expect((await call("POST", "/commerce/tenants/acme/tickets", { body: { title: "No carga", description: "La agenda no carga desde ayer", requestedBy: "no-es-correo" } })).status).toBe(400);
    expect((await call("POST", "/commerce/tenants/acme/tickets", { body: { title: "No carga", description: "La agenda no carga desde ayer", requestedBy: "lucia@acme.example", priority: "urgent" } })).status).toBe(400);
    expect((await open("noexiste", "Empresa inexistente")).status).toBe(404);
  });

  it("ciclo completo: la empresa abre, el equipo responde (y anota en privado), la empresa contesta y reabre", async () => {
    const c = await open("acme", "No se envían las facturas");
    expect(c.status).toBe(201);
    const id = c.json.ticket.id;
    expect(c.json.ticket).toEqual(expect.objectContaining({ title: "No se envían las facturas", category: "technical", status: "open" }));
    expect(c.json.ticket).not.toHaveProperty("assignee");
    expect(c.json.ticket).not.toHaveProperty("priority");
    expect(told).toContainEqual({ id, kind: "received", to: "lucia@acme.example" });

    // El equipo: nota interna, respuesta pública y espera de respuesta
    await call("POST", `/tickets/${id}/comments`, { token: TEAM, body: { text: "Revisar el proveedor SMTP del cliente", internal: true } });
    await call("POST", `/tickets/${id}/comments`, { token: TEAM, body: { text: "¿Nos confirmas el correo de envío configurado?" } });
    await call("POST", `/tickets/${id}/status`, { token: TEAM, body: { status: "waiting_customer" } });

    const d = await call("GET", `/commerce/tenants/acme/tickets/${id}`);
    expect(d.status).toBe(200);
    expect(JSON.stringify(d.json)).not.toMatch(/SMTP del cliente|agente-ana/);
    expect(d.json.timeline.map((e: any) => [e.kind, e.author])).toEqual([
      ["created", "customer"],
      ["comment", "support"],
      ["status", "support"],
    ]);

    // La empresa contesta: vuelve a «en curso» (el equipo tiene que actuar)
    const r = await call("POST", `/commerce/tenants/acme/tickets/${id}/comments`, { body: { text: "Es facturas@acme.example", requestedBy: "lucia@acme.example" } });
    expect(r.status).toBe(201);
    expect(r.json.ticket.status).toBe("in_progress");
    expect(r.json.timeline.at(-2)).toMatchObject({ kind: "comment", author: "customer", text: "Es facturas@acme.example" });

    // Resuelta: responder ya no vale; reabrir con motivo, sí
    await call("POST", `/tickets/${id}/status`, { token: TEAM, body: { status: "resolved", comment: "Corregido el remitente" } });
    expect((await call("POST", `/commerce/tenants/acme/tickets/${id}/comments`, { body: { text: "Gracias", requestedBy: "lucia@acme.example" } })).status).toBe(409);
    const re = await call("POST", `/commerce/tenants/acme/tickets/${id}/reopen`, { body: { reason: "Sigue fallando con los abonos", requestedBy: "lucia@acme.example" } });
    expect(re.status).toBe(200);
    expect(re.json.ticket.status).toBe("open");
    expect(told.filter((t) => t.id === id).map((t) => t.kind)).toEqual(["received", "replied", "resolved", "reopened"]);
    // Una abierta no se «reabre»
    expect((await call("POST", `/commerce/tenants/acme/tickets/${id}/reopen`, { body: { reason: "Otra vez", requestedBy: "lucia@acme.example" } })).status).toBe(409);
  });

  it("aislamiento: cada empresa ve solo las suyas; la de otra se comporta como inexistente", async () => {
    const a = (await open("acme", "Incidencia de Acme")).json.ticket.id;
    const b = (await open("beta", "Incidencia de Beta", "pablo@beta.example")).json.ticket.id;
    const listA = (await call("GET", "/commerce/tenants/acme/tickets")).json.tickets.map((t: any) => t.id);
    const listB = (await call("GET", "/commerce/tenants/beta/tickets")).json.tickets.map((t: any) => t.id);
    expect(listA).toContain(a);
    expect(listA).not.toContain(b);
    expect(listB).toEqual([b]);
    expect((await call("GET", `/commerce/tenants/acme/tickets/${b}`)).status).toBe(404);
    expect((await call("POST", `/commerce/tenants/acme/tickets/${b}/comments`, { body: { text: "Hola", requestedBy: "lucia@acme.example" } })).status).toBe(404);
    expect((await call("POST", `/commerce/tenants/acme/tickets/${b}/reopen`, { body: { reason: "Reabrir", requestedBy: "lucia@acme.example" } })).status).toBe(404);
  });
});

describe("soporte con la empresa en solo lectura o suspendida", () => {
  it("abrir, responder y reabrir siguen permitidos; mezclados con otra escritura, no", async () => {
    const { isSessionPath } = await import("./_core/tenantRegistry/tenantMiddleware");
    for (const p of ["support.open", "support.reply", "support.reopen"]) expect(isSessionPath(`/api/trpc/${p}`), p).toBe(true);
    expect(isSessionPath("/api/trpc/support.open,crm.clients.create")).toBe(false);
  });
});
