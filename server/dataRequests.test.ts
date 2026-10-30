/**
 * Solicitudes RGPD (CRM 0034): responsable, historial, filtros de listado y API /cp/v1/data-requests con sus permisos
 * (lectura con crm:read, cambios con crm:write) y el actor de cada evento.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken } from "./controlPlane/auth";
import { createDataRequestsRouter } from "./dataRequests/api";
import { DataRequestService, ESCALATION_DETAIL, TRANSITIONS, WARN_DAYS, operatorAssignees } from "./dataRequests/service";
import { MemoryDataRequestStore, matchesDeadline } from "./dataRequests/store";

const T0 = Date.UTC(2026, 9, 30, 10);
const DAY = 24 * 3600_000;
const input = { kind: "erasure", channel: "email", requesterName: "Ana Cliente", requesterEmail: "ana@cliente.example", companyId: 7 };
const OPS = [
  { username: "marta", displayName: "Marta Comercial", role: "sales", status: "active" },
  { username: "luis", displayName: "Luis Admin", role: "admin", status: "active" },
  { username: "sonia", displayName: "Sonia Soporte", role: "support", status: "active" },
  { username: "pepe", displayName: "Pepe Baja", role: "sales", status: "disabled" },
];

function setup() {
  let now = T0;
  const store = new MemoryDataRequestStore();
  const svc = new DataRequestService({ store, now: () => now, assignees: async () => operatorAssignees(OPS) });
  return { store, svc, clock: () => now, tick: (ms: number) => (now += ms) };
}

describe("responsables posibles", () => {
  it("solo operadores activos con permiso de edición del CRM, por nombre; identificador = usuario", () => {
    expect(operatorAssignees(OPS)).toEqual([
      { id: "luis", name: "Luis Admin" },
      { id: "marta", name: "Marta Comercial" },
    ]);
  });
});

describe("servicio: historial, responsable y notas", () => {
  it("cada cambio deja su evento con el actor, en orden cronológico", async () => {
    const { svc, tick } = setup();
    const r = await svc.register(input, "operator:marta");
    tick(1000);
    await svc.assign(r.id, "luis", "operator:marta");
    tick(1000);
    await svc.addNote(r.id, "  Pedida copia del contrato  ", "operator:luis");
    tick(1000);
    await svc.setStatus(r.id, "in_progress", null, "operator:luis");
    tick(1000);
    await svc.setStatus(r.id, "resolved", "Datos suprimidos.", "operator:luis");
    const { request, events } = await svc.detail(r.id);
    expect(request).toMatchObject({ status: "resolved", assigneeId: "luis", assigneeName: "Luis Admin", resolution: "Datos suprimidos." });
    expect(events.map((e) => [e.type, e.actor])).toEqual([
      ["created", "operator:marta"],
      ["assigned", "operator:marta"],
      ["note", "operator:luis"],
      ["status_changed", "operator:luis"],
      ["resolved", "operator:luis"],
    ]);
    expect(events.map((e) => e.at)).toEqual([T0, T0 + 1000, T0 + 2000, T0 + 3000, T0 + 4000]);
    expect(events[1].detail).toBe("Responsable: Luis Admin");
    expect(events[2].detail).toBe("Pedida copia del contrato");
    expect(events[3].detail).toBe("Recibida → En curso");
    expect(events[4].detail).toBe("En curso → Resuelta: Datos suprimidos.");
  });

  it("rechazar exige resolución y deja un cambio de estado; no se reabre", async () => {
    const { svc } = setup();
    const r = await svc.register(input, "operator:marta");
    await expect(svc.setStatus(r.id, "rejected", "   ", "operator:marta")).rejects.toThrow(/resuelto/);
    await svc.setStatus(r.id, "rejected", "No es el titular de los datos.", "operator:marta");
    const { events } = await svc.detail(r.id);
    expect(events.at(-1)).toMatchObject({ type: "status_changed", detail: "Recibida → Rechazada: No es el titular de los datos." });
    await expect(svc.setStatus(r.id, "in_progress", null, "operator:marta")).rejects.toThrow(/No se puede pasar de «Rechazada»/);
  });

  it("transiciones permitidas", () => {
    expect(TRANSITIONS.received).toEqual(["in_progress", "resolved", "rejected"]);
    expect(TRANSITIONS.in_progress).toEqual(["resolved", "rejected"]);
    expect(TRANSITIONS.resolved).toEqual([]);
    expect(TRANSITIONS.rejected).toEqual([]);
  });

  it("asignar: solo responsables válidos; reasignar y retirar dejan constancia; repetir no", async () => {
    const { svc } = setup();
    const r = await svc.register(input, "operator:marta");
    await expect(svc.assign(r.id, "sonia", "operator:marta")).rejects.toThrow(/operador activo/);
    await expect(svc.assign(r.id, "pepe", "operator:marta")).rejects.toThrow(/operador activo/);
    await expect(svc.assign(999, "luis", "operator:marta")).rejects.toThrow(/no encontrada/);
    await svc.assign(r.id, "marta", "operator:marta");
    await svc.assign(r.id, "marta", "operator:marta");
    await svc.assign(r.id, "luis", "operator:marta");
    expect((await svc.assign(r.id, null, "operator:luis")).assigneeId).toBeNull();
    const ev = (await svc.detail(r.id)).events.filter((e) => e.type === "assigned").map((e) => e.detail);
    expect(ev).toEqual(["Responsable: Marta Comercial", "Responsable: Luis Admin (antes: Marta Comercial)", "Responsable retirado (era Luis Admin)"]);
  });

  it("sin fuente de operadores no se puede asignar; nota vacía no", async () => {
    const svc = new DataRequestService({ store: new MemoryDataRequestStore(), now: () => T0 });
    const r = await svc.register(input, "operator:marta");
    await expect(svc.assign(r.id, "luis", "operator:marta")).rejects.toThrow(/No hay operadores/);
    expect(await svc.assigneeOptions()).toEqual([]);
    await expect(svc.addNote(r.id, "   ", "operator:marta")).rejects.toThrow(/vacía/);
  });

  it("escaladas: un evento por fase y solicitud, aunque el ciclo se repita", async () => {
    const { svc, tick } = setup();
    const r = await svc.register(input, "operator:marta");
    expect(await svc.escalate(T0)).toEqual([]);
    tick(23 * DAY);
    const now1 = T0 + 23 * DAY;
    expect((await svc.escalate(now1)).map((a) => a.facts.key)).toEqual([`dr:${r.id}:due`]);
    await svc.escalate(now1 + 1000);
    const now2 = T0 + 31 * DAY;
    await svc.escalate(now2);
    await svc.escalate(now2 + 1000);
    const esc = (await svc.detail(r.id)).events.filter((e) => e.type === "escalated");
    expect(esc.map((e) => [e.detail, e.actor, e.at])).toEqual([
      [ESCALATION_DETAIL.due, "system:alertas", now1],
      [ESCALATION_DETAIL.overdue, "system:alertas", now2],
    ]);
  });
});

describe("filtros del listado", () => {
  it("plazo (pura): vencidas y próximas a vencer solo si siguen abiertas", () => {
    const w = WARN_DAYS * DAY;
    expect(matchesDeadline({ status: "received", dueAt: T0 }, "overdue", T0, w)).toBe(true);
    expect(matchesDeadline({ status: "resolved", dueAt: T0 - DAY }, "overdue", T0, w)).toBe(false);
    expect(matchesDeadline({ status: "in_progress", dueAt: T0 + w }, "due_soon", T0, w)).toBe(true);
    expect(matchesDeadline({ status: "in_progress", dueAt: T0 + w + 1 }, "due_soon", T0, w)).toBe(false);
    expect(matchesDeadline({ status: "in_progress", dueAt: T0 }, "due_soon", T0, w)).toBe(false);
  });

  it("estado, tipo, responsable (o sin asignar) y plazo", async () => {
    const { svc, store } = setup();
    const a = await svc.register({ ...input, receivedAt: T0 - 31 * DAY }, "operator:marta");
    const b = await svc.register({ ...input, kind: "access", receivedAt: T0 - 25 * DAY }, "operator:marta");
    const c = await svc.register({ ...input, kind: "export" }, "operator:marta");
    await svc.assign(b.id, "luis", "operator:marta");
    await svc.setStatus(c.id, "in_progress", null, "operator:marta");
    const ids = async (q: Parameters<DataRequestService["list"]>[0]) => (await svc.list(q)).map((x) => x.id);
    expect(await ids({ deadline: "overdue" })).toEqual([a.id]);
    expect(await ids({ deadline: "due_soon" })).toEqual([b.id]);
    expect(await ids({ status: "in_progress" })).toEqual([c.id]);
    expect(await ids({ kind: "access" })).toEqual([b.id]);
    expect(await ids({ assigneeId: "luis" })).toEqual([b.id]);
    expect(await ids({ assigneeId: null })).toEqual([c.id, a.id]);
    await svc.setStatus(a.id, "resolved", "Hecho.", "operator:marta");
    expect(await ids({ deadline: "overdue" })).toEqual([]);
    expect(store.rows).toHaveLength(3);
  });
});

describe("API /cp/v1/data-requests", () => {
  const READ = "ci-only-placeholder-not-a-secret-2";
  const WRITE = "ci-only-placeholder-not-a-secret-1";
  let server: http.Server;
  let base: string;
  const { svc } = setup();

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(
      authenticate([
        { id: "lector", sha256: hashToken(READ), scopes: ["crm:read"], actorType: "operator" },
        { id: "marta", sha256: hashToken(WRITE), scopes: ["crm:read", "crm:write"], actorType: "operator" },
      ]),
    );
    app.use("/cp/v1/data-requests", createDataRequestsRouter(svc));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/data-requests`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: (await res.json()) as any };
  };

  it("lectura con crm:read; cambios solo con crm:write; el actor queda en el historial", async () => {
    expect((await call("POST", "", READ, input)).status).toBe(403);
    const created = await call("POST", "", WRITE, input);
    expect(created.status).toBe(201);
    const id = created.json.request.id;
    expect((await call("POST", `/${id}/notes`, READ, { text: "x" })).status).toBe(403);
    expect((await call("POST", `/${id}/assignee`, READ, { assigneeId: "luis" })).status).toBe(403);
    expect((await call("POST", `/${id}/status`, READ, { status: "in_progress" })).status).toBe(403);

    expect((await call("POST", `/${id}/notes`, WRITE, { text: "Llamada al cliente" })).status).toBe(201);
    expect((await call("POST", `/${id}/assignee`, WRITE, { assigneeId: "luis" })).json.request).toMatchObject({ assigneeId: "luis", assigneeName: "Luis Admin" });
    expect((await call("POST", `/${id}/assignee`, WRITE, { assigneeId: "sonia" })).status).toBe(400);
    expect((await call("POST", `/${id}/status`, WRITE, { status: "resolved" })).status).toBe(400);
    expect((await call("POST", `/${id}/status`, WRITE, { status: "resolved", resolution: "Datos suprimidos." })).json.request.status).toBe("resolved");
    expect((await call("POST", `/${id}/status`, WRITE, { status: "in_progress" })).status).toBe(409);

    const d = await call("GET", `/${id}`, READ);
    expect(d.status).toBe(200);
    expect(d.json.request.id).toBe(id);
    expect(d.json.events.map((e: any) => e.type)).toEqual(["created", "note", "assigned", "resolved"]);
    expect(new Set(d.json.events.map((e: any) => e.actor))).toEqual(new Set(["operator:marta"]));
    expect((await call("GET", "/999", READ)).status).toBe(404);
  });

  it("listado con filtros y responsables posibles", async () => {
    const open = await call("POST", "", WRITE, { ...input, kind: "access", receivedAt: T0 - 31 * DAY });
    const id = open.json.request.id;
    expect((await call("GET", "?deadline=overdue", READ)).json.requests.map((r: any) => r.id)).toEqual([id]);
    expect((await call("GET", "?assignee=none&status=received", READ)).json.requests.map((r: any) => r.id)).toEqual([id]);
    expect((await call("GET", "?assignee=luis", READ)).json.requests).toHaveLength(1);
    expect((await call("GET", "?kind=access", READ)).json.requests.map((r: any) => r.id)).toEqual([id]);
    expect((await call("GET", "?deadline=otra", READ)).status).toBe(400);
    expect((await call("GET", "/assignees", READ)).json.assignees.map((a: any) => a.id)).toEqual(["luis", "marta"]);
  });
});
