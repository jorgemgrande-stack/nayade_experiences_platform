/**
 * Tickets de soporte: ciclo de vida, historial, permisos, validación, paginación y aislamiento.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type ServiceToken } from "./controlPlane/auth";
import { createTicketsRouter } from "./controlPlane/tickets";
import { MemoryTicketStore, TicketService } from "./_core/support/tickets";

const RW = "rw-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";
const RO = "ro-token-bbbbbbbbbbbbbbbbbbbbbbbbbb";
const NONE = "no-token-cccccccccccccccccccccccccc";
const tokens: ServiceToken[] = [
  { id: "agent-1", sha256: hashToken(RW), scopes: ["tickets:read", "tickets:write"] },
  { id: "viewer", sha256: hashToken(RO), scopes: ["tickets:read"] },
  { id: "other", sha256: hashToken(NONE), scopes: ["tenants:read"] },
];

let server: http.Server;
let port: number;

function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1/tickets${path}`,
        method,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = JSON.parse(b);
          } catch {
            /* sin cuerpo */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  let now = 1_000;
  const service = new TicketService(new MemoryTicketStore(), async (t) => ["acme", "beta"].includes(t), () => ++now);
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authenticate(tokens));
  router.use("/tickets", createTicketsRouter(service));
  app.use("/cp/v1", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const mk = (tenantId: string, title: string, extra: Record<string, unknown> = {}) =>
  call("POST", "/", { token: RW, body: { tenantId, title, description: `Detalle de ${title}`, ...extra } });

describe("tickets de soporte", () => {
  it("exige token y ámbitos", async () => {
    expect((await call("GET", "/")).status).toBe(401);
    expect((await call("GET", "/", { token: NONE })).status).toBe(403);
    expect((await call("POST", "/", { token: RO, body: { tenantId: "acme", title: "x", description: "y" } })).status).toBe(403);
    expect((await call("GET", "/", { token: RO })).status).toBe(200);
  });

  it("valida entradas y rechaza tenants inexistentes", async () => {
    expect((await call("POST", "/", { token: RW, body: { tenantId: "../etc", title: "x", description: "y" } })).status).toBe(400);
    expect((await call("POST", "/", { token: RW, body: { tenantId: "acme", title: "", description: "y" } })).status).toBe(400);
    expect((await call("POST", "/", { token: RW, body: { tenantId: "acme", title: "x", description: "y", priority: "ya" } })).status).toBe(400);
    expect((await mk("fantasma", "Hola")).status).toBe(404);
    expect((await call("GET", "/abc", { token: RW })).status).toBe(400);
    expect((await call("GET", "/999", { token: RW })).status).toBe(404);
  });

  it("ciclo completo con historial atribuido al actor", async () => {
    const created = await mk("acme", "No carga el panel", { priority: "high", requester: "ana@acme.test" });
    expect(created.status).toBe(201);
    const id = created.json.ticket.id;
    expect(created.json.ticket).toMatchObject({ status: "open", priority: "high", assignee: null, tenantId: "acme" });

    expect((await call("POST", `/${id}/assign`, { token: RW, body: { assignee: "marta" } })).json.ticket.assignee).toBe("marta");
    expect((await call("POST", `/${id}/priority`, { token: RW, body: { priority: "urgent" } })).json.ticket.priority).toBe("urgent");
    expect((await call("POST", `/${id}/status`, { token: RW, body: { status: "in_progress" } })).json.ticket.status).toBe("in_progress");
    await call("POST", `/${id}/comments`, { token: RW, body: { text: "Reproducido", internal: true } });
    const done = await call("POST", `/${id}/status`, { token: RW, body: { status: "resolved", comment: "Reiniciado el servicio" } });
    expect(done.json.ticket.resolvedAt).toBeTypeOf("number");

    const detail = await call("GET", `/${id}`, { token: RO });
    const kinds = detail.json.events.map((e: any) => e.kind);
    expect(kinds).toEqual(["created", "assignee", "priority", "status", "comment", "status"]);
    expect(detail.json.events.every((e: any) => e.actor === "crm:agent-1" || e.actor.endsWith(":agent-1"))).toBe(true);
    expect(detail.json.events[4]).toMatchObject({ internal: true, comment: "Reproducido" });
  });

  it("solo se permiten transiciones válidas y un ticket cerrado es inmutable", async () => {
    const id = (await mk("acme", "Transiciones")).json.ticket.id;
    expect((await call("POST", `/${id}/status`, { token: RW, body: { status: "closed" } })).status).toBe(200);
    expect((await call("POST", `/${id}/status`, { token: RW, body: { status: "open" } })).status).toBe(409);
    expect((await call("POST", `/${id}/assign`, { token: RW, body: { assignee: "x" } })).status).toBe(409);
    expect((await call("POST", `/${id}/comments`, { token: RW, body: { text: "tarde" } })).status).toBe(409);
    const r = (await mk("acme", "Reapertura")).json.ticket.id;
    await call("POST", `/${r}/status`, { token: RW, body: { status: "resolved" } });
    const reopened = await call("POST", `/${r}/status`, { token: RW, body: { status: "open" } });
    expect(reopened.json.ticket).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("aislamiento: filtros por empresa y acceso cruzado como inexistente", async () => {
    const a = (await mk("acme", "Solo de Acme")).json.ticket.id;
    const b = (await mk("beta", "Solo de Beta")).json.ticket.id;
    const acme = (await call("GET", "/?tenantId=acme&limit=200", { token: RO })).json.tickets;
    expect(acme.length).toBeGreaterThan(0);
    expect(acme.every((t: any) => t.tenantId === "acme")).toBe(true);
    expect(acme.some((t: any) => t.id === b)).toBe(false);
    // con el tenant indicado, un ticket de otra empresa no existe
    expect((await call("GET", `/${b}?tenantId=acme`, { token: RO })).status).toBe(404);
    expect((await call("GET", `/${b}?tenantId=beta`, { token: RO })).status).toBe(200);
    expect(a).not.toBe(b);
  });

  it("paginación, filtros y búsqueda", async () => {
    for (let i = 0; i < 5; i++) await mk("beta", `Paginable ${i}`, { priority: "low", category: "facturacion" });
    const p1 = (await call("GET", "/?tenantId=beta&priority=low&limit=2&offset=0", { token: RO })).json;
    const p2 = (await call("GET", "/?tenantId=beta&priority=low&limit=2&offset=2", { token: RO })).json;
    expect(p1.total).toBe(5);
    expect(p1.tickets).toHaveLength(2);
    expect(p2.tickets).toHaveLength(2);
    expect(p1.tickets[0].id).not.toBe(p2.tickets[0].id);
    const q = (await call("GET", "/?q=paginable%203", { token: RO })).json;
    expect(q.tickets).toHaveLength(1);
    expect((await call("GET", "/?limit=9999", { token: RO })).status).toBe(400);
    expect((await call("GET", "/?status=raro", { token: RO })).status).toBe(400);
    const mine = (await call("GET", "/?assignee=marta", { token: RO })).json;
    expect(mine.tickets.every((t: any) => t.assignee === "marta")).toBe(true);
  });
});
