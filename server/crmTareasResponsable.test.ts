/**
 * Tareas comerciales con responsable y prioridad (db/crm/migrations/0024_crm_task_assignment.sql): servicio y API.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

describe("tareas con responsable y prioridad (servicio)", () => {
  let now = 1_800_000_000_000;
  const crm = new CrmService({ store: new MemoryCrmStore(), now: () => now });

  it("una tarea nueva es «normal» y sin asignar si no se indica; se guarda el responsable recortado", async () => {
    const c = await crm.createCompany({ name: "Empresa Tareas" }, "op");
    const a = await crm.addTask("company", c.id, "Llamar", now + 1000, "op");
    expect(a).toMatchObject({ assignee: null, priority: "normal" });
    const b = await crm.addTask("company", c.id, "Enviar propuesta", now + 2000, "op", { assignee: "  Laura  ", priority: "high" });
    expect(b).toMatchObject({ assignee: "Laura", priority: "high" });
    // Una actividad que no es tarea no lleva responsable
    const n = await crm.log("company", c.id, "note", "Nota", "op", { assignee: "Laura", priority: "high" });
    expect(n).toMatchObject({ assignee: null, priority: "normal" });
  });

  it("filtros por responsable (incluidas las sin asignar) y por prioridad; a igual fecha, la alta primero", async () => {
    const c = await crm.createCompany({ name: "Empresa Filtros" }, "op");
    const due = now + 50_000;
    await crm.addTask("company", c.id, "Baja", due, "op", { assignee: "Pablo", priority: "low" });
    await crm.addTask("company", c.id, "Alta", due, "op", { assignee: "Pablo", priority: "high" });
    const pablo = await crm.tasks({ assignee: "Pablo" });
    expect(pablo.map((t) => t.summary)).toEqual(["Alta", "Baja"]);
    expect((await crm.tasks({ assignee: null })).every((t) => t.assignee === null)).toBe(true);
    expect((await crm.tasks({ priority: "high" })).map((t) => t.summary)).toEqual(["Enviar propuesta", "Alta"]);
  });

  it("reasignar, cambiar prioridad y fecha; quitar el responsable; una hecha no se edita; una nota no es tarea", async () => {
    const c = await crm.createCompany({ name: "Empresa Edición" }, "op");
    const t = await crm.addTask("company", c.id, "Revisar contrato", now + 1000, "op", { assignee: "Laura" });
    const u = await crm.updateTask(t.id, { assignee: "Pablo", priority: "high", dueAt: now + 9000 });
    expect(u).toMatchObject({ assignee: "Pablo", priority: "high", dueAt: now + 9000 });
    expect((await crm.updateTask(t.id, { assignee: "" })).assignee).toBeNull();
    await crm.completeTask(t.id);
    await expect(crm.updateTask(t.id, { priority: "low" })).rejects.toMatchObject({ code: "invalid_state" });
    const n = await crm.log("company", c.id, "note", "Nota", "op");
    await expect(crm.updateTask(n.id, { priority: "low" })).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("API de tareas: responsable, prioridad y permisos", () => {
  let server: http.Server;
  let port: number;
  const FULL = "tareas-full-token-aaaaaaaaaaaaaaaaaaaa";
  const READ = "tareas-read-token-bbbbbbbbbbbbbbbbbbbb";
  let companyId = 0;

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const st = new MemoryCrmStore();
    const service = new CrmService({ store: st });
    companyId = (await service.createCompany({ name: "Empresa API Tareas" }, "op")).id;
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
      crm: { service, store: st },
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = (method: string, path: string, token?: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1/crm${path}`,
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          },
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

  it("alta con responsable y prioridad, filtros y edición", async () => {
    const due = Date.now() + 86_400_000;
    const a = await call("POST", "/activities", FULL, { entityType: "company", entityId: companyId, kind: "task", summary: "Llamar al cliente", dueAt: due, assignee: "Laura", priority: "high" });
    expect(a.status).toBe(201);
    expect(a.json.activity).toMatchObject({ assignee: "Laura", priority: "high" });
    const b = await call("POST", "/activities", FULL, { entityType: "company", entityId: companyId, kind: "task", summary: "Sin asignar", dueAt: due });
    expect(b.json.activity).toMatchObject({ assignee: null, priority: "normal" });
    expect((await call("GET", "/tasks?assignee=Laura", READ)).json.tasks.map((t: any) => t.summary)).toEqual(["Llamar al cliente"]);
    expect((await call("GET", "/tasks?assignee=none", READ)).json.tasks.map((t: any) => t.summary)).toEqual(["Sin asignar"]);
    expect((await call("GET", "/tasks?priority=high", READ)).json.tasks.length).toBe(1);
    const p = await call("PATCH", `/tasks/${b.json.activity.id}`, FULL, { assignee: "Pablo", priority: "low" });
    expect(p.status).toBe(200);
    expect(p.json.task).toMatchObject({ assignee: "Pablo", priority: "low" });
  });

  it("valida la entrada y exige crm:write", async () => {
    const due = Date.now() + 86_400_000;
    const t = await call("POST", "/activities", FULL, { entityType: "company", entityId: companyId, kind: "task", summary: "X", dueAt: due });
    const tid = t.json.activity.id;
    expect((await call("PATCH", `/tasks/${tid}`, FULL, { priority: "urgente" })).status).toBe(400);
    expect((await call("PATCH", `/tasks/${tid}`, FULL, { author: "otro" })).status).toBe(400);
    expect((await call("PATCH", `/tasks/${tid}`, FULL, { assignee: "x".repeat(101) })).status).toBe(400);
    expect((await call("GET", "/tasks?priority=urgente", READ)).status).toBe(400);
    expect((await call("PATCH", `/tasks/${tid}`, READ, { priority: "high" })).status).toBe(403);
    expect((await call("PATCH", `/tasks/${tid}`, undefined, { priority: "high" })).status).toBe(401);
    expect((await call("PATCH", "/tasks/999999", FULL, { priority: "high" })).status).toBe(404);
  });
});
