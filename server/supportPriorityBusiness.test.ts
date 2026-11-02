/**
 * Soporte prioritario del plan Business (y Enterprise): las incidencias abiertas desde el panel entran con prioridad
 * alta según la licencia vigente; Essential, sin plan o sin licencias legibles siguen con prioridad normal. La empresa
 * no ve la prioridad; el equipo sí.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type ServiceToken } from "./controlPlane/auth";
import { createTicketsRouter } from "./controlPlane/tickets";
import { createCustomerTicketsRouter, supportPriorityFor } from "./support/customerTickets";
import { MemoryTicketStore, TicketService } from "./_core/support/tickets";
import type { CapabilityGrant } from "./_core/capabilities/model";

const NOW = 1_800_000_000_000;
const grant = (tenantId: string, capabilityId: string, extra: Partial<CapabilityGrant> = {}): CapabilityGrant => ({
  tenantId,
  capabilityId,
  siteId: "",
  status: "active",
  validUntil: null,
  source: "subscription:1",
  updatedAt: 0,
  updatedBy: "test",
  ...extra,
});
const essential = (t: string) => [grant(t, "admin-panel"), grant(t, "crm-contacts")];
const business = (t: string) => [...essential(t), grant(t, "roles-custom"), grant(t, "bookings-generic")];
const enterprise = (t: string) => [...business(t), grant(t, "audit-advanced")];

describe("supportPriorityFor", () => {
  it("Business y Enterprise: alta; Essential, sin plan o sin licencias: normal", () => {
    expect(supportPriorityFor(business("a"), NOW)).toBe("high");
    expect(supportPriorityFor(enterprise("a"), NOW)).toBe("high");
    expect(supportPriorityFor(essential("a"), NOW)).toBe("normal");
    expect(supportPriorityFor([], NOW)).toBe("normal");
    expect(supportPriorityFor(null, NOW)).toBe("normal");
  });

  it("una capacidad Business cancelada no cuenta", () => {
    expect(supportPriorityFor([...essential("a"), grant("a", "roles-custom", { status: "cancelled" })], NOW)).toBe("normal");
  });
});

const CORE = "core-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEAM = "team-token-cccccccccccccccccccccccccc";
const tokens: ServiceToken[] = [
  { id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] },
  { id: "agente-ana", sha256: hashToken(TEAM), scopes: ["tickets:read", "tickets:write"] },
];
const LICENCES: Record<string, CapabilityGrant[]> = { biz: business("biz"), ess: essential("ess") };

let server: http.Server;
let port: number;

function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1${path}`,
        method,
        headers: { authorization: `Bearer ${opts.token ?? CORE}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) },
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
  const service = new TicketService(new MemoryTicketStore(), async (t) => ["biz", "ess", "rota"].includes(t));
  const grants = async (t: string) => {
    if (t === "rota") throw new Error("registro no disponible");
    return LICENCES[t] ?? [];
  };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authenticate(tokens));
  router.use("/tickets", createTicketsRouter(service));
  router.use("/commerce", createCustomerTicketsRouter(service, { grants, now: () => NOW }));
  app.use("/cp/v1", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const open = (tenant: string) =>
  call("POST", `/commerce/tenants/${tenant}/tickets`, { body: { title: "No carga la agenda", description: "La agenda no carga desde ayer", requestedBy: "lucia@empresa.example" } });

describe("soporte prioritario al abrir desde el panel", () => {
  it("Business entra con prioridad alta (visible para el equipo, no para la empresa)", async () => {
    const c = await open("biz");
    expect(c.status).toBe(201);
    expect(c.json.ticket).not.toHaveProperty("priority");
    const team = await call("GET", `/tickets/${c.json.ticket.id}`, { token: TEAM });
    expect(team.json.ticket.priority).toBe("high");
  });

  it("Essential sigue con prioridad normal", async () => {
    const c = await open("ess");
    const team = await call("GET", `/tickets/${c.json.ticket.id}`, { token: TEAM });
    expect(team.json.ticket.priority).toBe("normal");
  });

  it("si las licencias no se pueden leer, el ticket se crea igual con prioridad normal", async () => {
    const c = await open("rota");
    expect(c.status).toBe(201);
    const team = await call("GET", `/tickets/${c.json.ticket.id}`, { token: TEAM });
    expect(team.json.ticket.priority).toBe("normal");
  });
});
