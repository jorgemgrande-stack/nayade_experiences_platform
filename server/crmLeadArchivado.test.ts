/**
 * Archivado y eliminación de leads: el borrado físico solo cuando no hay nada que conservar; el resto, archivado
 * recuperable. Cubre las reglas de conservación, la idempotencia, el efecto en listados e indicadores y la API
 * (permisos: archivar con crm:write; eliminar solo con administración, operators:write).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
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

let store: MemoryCrmStore;
let crm: CrmService;
let now = Date.UTC(2026, 10, 21);

const addRequest = (leadId: number, status: "pending" | "attended" = "pending") =>
  store.insert("leadRequests", {
    leadId,
    reference: `SOL-${leadId}-${status}`,
    type: "trial",
    status,
    sector: null,
    message: null,
    configuration: null,
    interest: null,
    preferredTime: null,
    sourcePage: null,
    utm: null,
    privacyAcceptedAt: now,
    privacyVersion: "v1",
    marketingConsent: false,
    idempotencyKey: `k-${leadId}-${status}`,
    payloadHash: "h",
    ipHash: null,
    attendedAt: status === "attended" ? now : null,
    attendedBy: status === "attended" ? "ana" : null,
    createdAt: now,
  } as never);

beforeEach(() => {
  store = new MemoryCrmStore();
  now = Date.UTC(2026, 10, 21);
  crm = new CrmService({ store, now: () => now });
});

describe("leadDependencies y eliminación", () => {
  it("1. lead sin relaciones: se puede eliminar; el historial queda como constancia", async () => {
    const l = await crm.createLead({ name: "Felipe Ramos", email: "felipe@x.example" }, "ana");
    const dep = await crm.leadDependencies(l.id);
    expect(dep).toMatchObject({ canDelete: true, deleteBlockers: [], canArchive: true });
    const out = await crm.deleteLead(l.id, "admin");
    expect(out).toEqual({ id: l.id, name: "Felipe Ramos" });
    expect(await store.get("leads", l.id)).toBeNull();
    const trail = await crm.timeline("lead", l.id);
    expect(trail.some((a) => a.summary.includes("Lead eliminado") && a.author === "admin")).toBe(true);
    expect(trail.some((a) => a.summary === "Lead creado")).toBe(true);
  });

  it("2. lead con solicitud web: no se elimina (explica por qué) pero se puede archivar si está atendida", async () => {
    const l = await crm.createLead({ name: "Web", email: "web@x.example" }, "ana");
    await addRequest(l.id, "attended");
    const dep = await crm.leadDependencies(l.id);
    expect(dep.canDelete).toBe(false);
    expect(dep.deleteBlockers.join(" ")).toMatch(/solicitud web/);
    await expect(crm.deleteLead(l.id, "admin")).rejects.toMatchObject({ code: "invalid_state" });
    expect(await store.get("leads", l.id)).not.toBeNull();
    expect(dep.canArchive).toBe(true);
  });

  it("2b. con una solicitud pendiente tampoco se archiva: antes hay que atenderla", async () => {
    const l = await crm.createLead({ name: "Pend", email: "p@x.example" }, "ana");
    await addRequest(l.id, "pending");
    const dep = await crm.leadDependencies(l.id);
    expect(dep.canArchive).toBe(false);
    expect(dep.archiveBlockers.join(" ")).toMatch(/pendiente/);
    await expect(crm.archiveLead(l.id, null, "ana")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("3. lead convertido en empresa: no se elimina ni cascada sobre empresa/contacto/oportunidad", async () => {
    const l = await crm.createLead({ name: "Ana", email: "ana@hotel.example", companyName: "Hotel Sol" }, "ana");
    const r = await crm.convertLead(l.id, { opportunity: { title: "Licencia", amountCents: 1000 } }, "ana");
    const dep = await crm.leadDependencies(l.id);
    expect(dep.canDelete).toBe(false);
    expect(dep.deleteBlockers.join(" ")).toMatch(/convertido/);
    await expect(crm.deleteLead(l.id, "admin")).rejects.toMatchObject({ code: "invalid_state" });
    expect(await store.get("companies", r.company.id)).not.toBeNull();
    expect(await store.get("opportunities", r.opportunity!.id)).not.toBeNull();
    expect(await store.get("contacts", r.contact!.id)).not.toBeNull();
  });

  it("4. lead con actividad manual: bloquea la eliminación; una nota automática no", async () => {
    const l = await crm.createLead({ name: "Con llamada", email: "c@x.example" }, "ana");
    await crm.log("lead", l.id, "call", "Llamada de presentación", "ana");
    const dep = await crm.leadDependencies(l.id);
    expect(dep.canDelete).toBe(false);
    expect(dep.activities.manual).toBe(1);
    await expect(crm.deleteLead(l.id, "admin")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("4b. una tarea abierta impide archivar hasta cerrarla", async () => {
    const l = await crm.createLead({ name: "Tarea", email: "t@x.example" }, "ana");
    await crm.log("lead", l.id, "task", "Enviar propuesta", "ana", { dueAt: now + 86_400_000 });
    const dep = await crm.leadDependencies(l.id);
    expect(dep.canArchive).toBe(false);
    expect(dep.archiveBlockers.join(" ")).toMatch(/tarea/);
  });

  it("5. lead vinculado a una empresa existente: no se elimina", async () => {
    const c = await crm.createCompany({ name: "Spa Luna" }, "ana");
    const l = await crm.createLead({ name: "Marta", email: "m@spa.example", companyId: c.id }, "ana");
    expect((await crm.leadDependencies(l.id)).canDelete).toBe(false);
  });

  it("8. doble confirmación: el segundo intento no borra nada más y responde no encontrado", async () => {
    const l = await crm.createLead({ name: "Doble", email: "d@x.example" }, "ana");
    await crm.deleteLead(l.id, "admin");
    await expect(crm.deleteLead(l.id, "admin")).rejects.toMatchObject({ code: "not_found" });
    const deletions = (await crm.timeline("lead", l.id)).filter((a) => a.summary.includes("Lead eliminado"));
    expect(deletions).toHaveLength(1);
  });

  it("una restricción de integridad en el borrado no deja el lead a medias", async () => {
    const l = await crm.createLead({ name: "Carrera", email: "r@x.example" }, "ana");
    const real = store.remove.bind(store);
    store.remove = async () => {
      throw new Error("ER_ROW_IS_REFERENCED_2");
    };
    await expect(crm.deleteLead(l.id, "admin")).rejects.toMatchObject({ code: "conflict" });
    store.remove = real;
    expect(await store.get("leads", l.id)).not.toBeNull();
    expect((await crm.timeline("lead", l.id)).some((a) => a.summary.includes("Lead eliminado"))).toBe(false);
  });
});

describe("archivado y recuperación", () => {
  it("10. archivar saca el lead de listados e indicadores y recuperar lo devuelve; es idempotente", async () => {
    const a = await crm.createLead({ name: "Activo", email: "a@x.example" }, "ana");
    const b = await crm.createLead({ name: "Archivable", email: "b@x.example" }, "ana");
    const out = await crm.archiveLead(b.id, "Duplicado de otro contacto", "ana");
    expect(out.archivedAt).toBe(now);
    expect(out.archivedBy).toBe("ana");
    expect(out.archiveReason).toBe("Duplicado de otro contacto");
    // idempotente
    expect((await crm.archiveLead(b.id, "otro motivo", "luis")).archivedBy).toBe("ana");
    expect((await crm.listLeads()).items.map((l) => l.id)).toEqual([a.id]);
    expect((await crm.listLeads({ archived: "only" })).items.map((l) => l.id)).toEqual([b.id]);
    expect((await crm.listLeads({ archived: "all" })).items).toHaveLength(2);
    expect((await crm.dashboard()).metrics?.activeLeads).toBe(1);
    expect((await crm.dashboard()).leadsByStatus.new).toBe(1);
    const back = await crm.restoreLead(b.id, "ana");
    expect(back.archivedAt).toBeNull();
    expect((await crm.listLeads()).items).toHaveLength(2);
    expect((await crm.restoreLead(b.id, "ana")).archivedAt).toBeNull();
    const trail = (await crm.timeline("lead", b.id)).map((x) => x.summary);
    expect(trail.some((t) => t.startsWith("Lead archivado: Duplicado"))).toBe(true);
    expect(trail).toContain("Lead recuperado del archivo");
  });

  it("un correo de un lead archivado no se duplica y el mensaje propone recuperarlo", async () => {
    const l = await crm.createLead({ name: "Archivado", email: "dup@x.example" }, "ana");
    await crm.archiveLead(l.id, null, "ana");
    await expect(crm.createLead({ name: "Otro", email: "dup@x.example" }, "ana")).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/archivado/) });
  });
});

describe("API", () => {
  let server: http.Server;
  let port: number;
  const ADMIN = "lead-admin-token-aaaaaaaaaaaaaaaaaa";
  const SALES = "lead-sales-token-bbbbbbbbbbbbbbbbbb";
  const READ = "lead-read-token-cccccccccccccccccc";
  let st: MemoryCrmStore;

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    st = new MemoryCrmStore();
    const app = createControlPlaneApp({
      tokens: [
        { id: "admin", sha256: hashToken(ADMIN), scopes: ["crm:read", "crm:write", "operators:write"] },
        { id: "sales", sha256: hashToken(SALES), scopes: ["crm:read", "crm:write"] },
        { id: "viewer", sha256: hashToken(READ), scopes: ["crm:read"] },
      ],
      registry: new TenantRegistryService(reg, () => ring),
      reader: reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      crm: { service: new CrmService({ store: st }), store: st },
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
        { host: "127.0.0.1", port, path: `/cp/v1/crm${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
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

  it("6. permisos: sin autenticar 401; solo lectura 403; comercial archiva pero no elimina; administración elimina", async () => {
    const l = (await call("POST", "/leads", SALES, { name: "Permisos", email: "perm@x.example" })).json.lead;
    expect((await call("DELETE", `/leads/${l.id}`)).status).toBe(401);
    expect((await call("DELETE", `/leads/${l.id}`, READ)).status).toBe(403);
    expect((await call("POST", `/leads/${l.id}/archive`, READ, {})).status).toBe(403);
    const forbidden = await call("DELETE", `/leads/${l.id}`, SALES);
    expect(forbidden.status).toBe(403);
    expect(forbidden.json.message).toMatch(/administración/);
    expect((await st.get("leads", l.id))).not.toBeNull();
    // dependencias: lectura suficiente
    const dep = await call("GET", `/leads/${l.id}/dependencies`, READ);
    expect(dep.status).toBe(200);
    expect(dep.json.dependencies).toMatchObject({ canDelete: true, canArchive: true });
    expect((await call("DELETE", `/leads/${l.id}`, ADMIN)).status).toBe(200);
    expect((await st.get("leads", l.id))).toBeNull();
    // repetición: no encontrado, sin efecto
    expect((await call("DELETE", `/leads/${l.id}`, ADMIN)).status).toBe(404);
  });

  it("administración tampoco elimina un lead convertido: 409 con la explicación", async () => {
    const l = (await call("POST", "/leads", SALES, { name: "Conv", email: "conv@x.example", companyName: "Conv SL" })).json.lead;
    expect((await call("POST", `/leads/${l.id}/convert`, SALES, {})).status).toBe(200);
    const del = await call("DELETE", `/leads/${l.id}`, ADMIN);
    expect([409, 400, 422]).toContain(del.status);
    expect(JSON.stringify(del.json)).toMatch(/convertido/);
    expect((await st.get("leads", l.id))).not.toBeNull();
  });

  it("archivar y recuperar por API; el listado por defecto oculta los archivados", async () => {
    const l = (await call("POST", "/leads", SALES, { name: "Arch API", email: "arch@x.example" })).json.lead;
    const a = await call("POST", `/leads/${l.id}/archive`, SALES, { reason: "Prueba" });
    expect(a.status).toBe(200);
    expect(a.json.lead.archivedAt).toBeTruthy();
    expect((await call("GET", "/leads", READ)).json.leads.some((x: { id: number }) => x.id === l.id)).toBe(false);
    expect((await call("GET", "/leads?archived=only", READ)).json.leads.some((x: { id: number }) => x.id === l.id)).toBe(true);
    expect((await call("GET", "/leads?archived=raro", READ)).status).toBe(400);
    const r = await call("POST", `/leads/${l.id}/restore`, SALES);
    expect(r.json.lead.archivedAt).toBeNull();
    expect((await call("GET", "/leads", READ)).json.leads.some((x: { id: number }) => x.id === l.id)).toBe(true);
  });

  it("7. un lead inexistente (o de otro entorno) no se puede archivar ni eliminar", async () => {
    expect((await call("POST", "/leads/999999/archive", SALES, {})).status).toBe(404);
    expect((await call("DELETE", "/leads/999999", ADMIN)).status).toBe(404);
    expect((await call("GET", "/leads/999999/dependencies", READ)).status).toBe(404);
    expect((await call("DELETE", "/leads/abc", ADMIN)).status).toBeGreaterThanOrEqual(400);
  });
});
