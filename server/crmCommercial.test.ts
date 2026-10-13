/**
 * CRM comercial: reglas del embudo, conversión de leads, contratos y activación,
 * seguimiento, y la API protegida por ámbitos.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { CrmError } from "./crm/types";
import { slugifyTenantId } from "./crm/activation";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

let store: MemoryCrmStore;
let crm: CrmService;
let now = Date.UTC(2026, 9, 14);
const activated: string[] = [];

beforeEach(() => {
  store = new MemoryCrmStore();
  now = Date.UTC(2026, 9, 14);
  activated.length = 0;
  crm = new CrmService({
    store,
    now: () => now,
    activation: {
      async activate({ company, contact }) {
        if (!contact?.email) throw new Error("sin contacto");
        const tenantId = slugifyTenantId(company.name);
        activated.push(tenantId);
        return { tenantId };
      },
    },
  });
});

describe("leads", () => {
  it("valida y deduplica por correo", async () => {
    await expect(crm.createLead({ name: "" }, "ana")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createLead({ name: "X", email: "no-correo" }, "ana")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createLead({ name: "X" }, "ana")).rejects.toMatchObject({ code: "invalid_input" });
    await crm.createLead({ name: "Ana", email: "ana@hotel.example" }, "ana");
    await expect(crm.createLead({ name: "Ana 2", email: "ANA@hotel.example" }, "ana")).rejects.toMatchObject({ code: "conflict" });
  });

  it("conversión: crea empresa, contacto y oportunidad; no se convierte dos veces", async () => {
    const lead = await crm.createLead({ name: "Ana Pérez", email: "ana@hotelsol.example", companyName: "Hotel Sol", owner: "jorge" }, "jorge");
    const r = await crm.convertLead(lead.id, { opportunity: { title: "Licencia Hotel Sol", amountCents: 120000 } }, "jorge");
    expect(r.company.name).toBe("Hotel Sol");
    expect(r.contact).toMatchObject({ email: "ana@hotelsol.example", companyId: r.company.id });
    expect(r.opportunity).toMatchObject({ stage: "prospecting", amountCents: 120000, probability: 10 });
    expect(r.lead.status).toBe("converted");
    await expect(crm.convertLead(lead.id, {}, "jorge")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(crm.setLeadStatus(lead.id, "contacted", "jorge")).rejects.toBeInstanceOf(CrmError);
  });

  it("un lead descartado no se convierte", async () => {
    const lead = await crm.createLead({ name: "Z", email: "z@x.example" }, "a");
    await crm.setLeadStatus(lead.id, "disqualified", "a");
    await expect(crm.convertLead(lead.id, {}, "a")).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("oportunidades", () => {
  async function opp(amount = 100000) {
    const c = await store.insert("companies", { name: "Co", taxId: null, website: null, sector: null, address: null, notes: null, tenantId: null, owner: null, createdAt: 1 });
    return crm.createOpportunity({ companyId: c.id, title: "T", amountCents: amount }, "a");
  }

  it("transiciones válidas y probabilidad por etapa", async () => {
    const o = await opp();
    expect((await crm.moveStage(o.id, "proposal", "a")).probability).toBe(30);
    expect((await crm.moveStage(o.id, "negotiation", "a")).probability).toBe(60);
    const won = await crm.moveStage(o.id, "won", "a");
    expect(won).toMatchObject({ probability: 100, closedAt: now });
    await expect(crm.moveStage(o.id, "prospecting", "a")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("perder exige motivo; saltos no permitidos se rechazan", async () => {
    const o = await opp();
    await expect(crm.moveStage(o.id, "won", "a")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(crm.moveStage(o.id, "lost", "a")).rejects.toMatchObject({ code: "invalid_input" });
    expect((await crm.moveStage(o.id, "lost", "a", { lostReason: "precio" })).lostReason).toBe("precio");
  });

  it("pipeline ponderado", async () => {
    const a = await opp(100000);
    await opp(50000);
    await crm.moveStage(a.id, "proposal", "x");
    const p = await crm.pipeline();
    expect(p.find((s) => s.stage === "proposal")).toMatchObject({ count: 1, totalCents: 100000, weightedCents: 30000 });
    expect(p.find((s) => s.stage === "prospecting")).toMatchObject({ count: 1, totalCents: 50000, weightedCents: 5000 });
  });
});

describe("contratos y activación", () => {
  async function ready() {
    const lead = await crm.createLead({ name: "Ana", email: "ana@sol.example", companyName: "Hotel Sol Ñandú" }, "a");
    const { company } = await crm.convertLead(lead.id, {}, "a");
    const c = await crm.createContract({ companyId: company.id, planId: "base", modules: ["hotel", "BAD MODULE"], amountCents: 4900 }, "a");
    return { company, c };
  }

  it("ciclo draft → sent → signed → active crea el tenant y lo enlaza", async () => {
    const { company, c } = await ready();
    expect(c.modules).toEqual(["hotel"]);
    await crm.setContractStatus(c.id, "sent", "a");
    const signed = await crm.setContractStatus(c.id, "signed", "a");
    expect(signed.signedAt).toBe(now);
    const active = await crm.setContractStatus(c.id, "active", "a");
    expect(active).toMatchObject({ status: "active", tenantId: "hotel-sol-nandu" });
    expect(activated).toEqual(["hotel-sol-nandu"]);
    expect((await store.get("companies", company.id))!.tenantId).toBe("hotel-sol-nandu");
  });

  it("no se activa sin firmar ni sin plan", async () => {
    const { c } = await ready();
    await expect(crm.setContractStatus(c.id, "active", "a")).rejects.toMatchObject({ code: "invalid_state" });
    const c2 = await crm.createContract({ companyId: c.companyId }, "a");
    await crm.setContractStatus(c2.id, "sent", "a");
    await crm.setContractStatus(c2.id, "signed", "a");
    await expect(crm.setContractStatus(c2.id, "active", "a")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("un fallo de activación deja el contrato firmado (no activo)", async () => {
    const failing = new CrmService({ store, now: () => now, activation: { activate: async () => { throw new Error("alta fallida"); } } });
    const { c } = await ready();
    await failing.setContractStatus(c.id, "sent", "a");
    await failing.setContractStatus(c.id, "signed", "a");
    await expect(failing.setContractStatus(c.id, "active", "a")).rejects.toThrow("alta fallida");
    expect((await store.get("contracts", c.id))!.status).toBe("signed");
  });

  it("slugifyTenantId", () => {
    expect(slugifyTenantId("Hotel Sol Ñandú S.L.")).toBe("hotel-sol-nandu-s-l");
    expect(slugifyTenantId("123 Café")).toBe("t-123-cafe");
    expect(slugifyTenantId("A")).toBe("a-co");
  });
});

describe("seguimiento", () => {
  it("tareas pendientes ordenadas; completar; línea de tiempo", async () => {
    const lead = await crm.createLead({ name: "L", email: "l@x.example" }, "ana");
    const t1 = await crm.addTask("lead", lead.id, "Llamar", now + 2 * 86_400_000, "ana");
    await crm.addTask("lead", lead.id, "Enviar propuesta", now + 86_400_000, "ana");
    expect((await crm.tasks()).map((t) => t.summary)).toEqual(["Enviar propuesta", "Llamar"]);
    await crm.completeTask(t1.id);
    expect((await crm.tasks()).map((t) => t.summary)).toEqual(["Enviar propuesta"]);
    expect((await crm.tasks({ until: now })).length).toBe(0);
    const tl = await crm.timeline("lead", lead.id);
    expect(tl.length).toBeGreaterThanOrEqual(3);
    await expect(crm.completeTask(tl.find((a) => a.kind === "note")!.id)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("dashboard", async () => {
    await crm.createLead({ name: "A", email: "a@x.example" }, "x");
    expect((await crm.dashboard()).leadsByStatus.new).toBe(1);
  });
});

describe("API", () => {
  let server: http.Server;
  let port: number;
  const FULL = "crm-full-token-aaaaaaaaaaaaaaaaaaaa";
  const READ = "crm-read-token-bbbbbbbbbbbbbbbbbbbb";

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const st = new MemoryCrmStore();
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

  it("autenticación y ámbitos", async () => {
    expect((await call("GET", "/leads")).status).toBe(401);
    expect((await call("GET", "/leads", READ)).status).toBe(200);
    expect((await call("POST", "/leads", READ, { name: "X", email: "x@x.example" })).status).toBe(403);
  });

  it("flujo completo por API: lead → conversión → oportunidad → contrato", async () => {
    const l = await call("POST", "/leads", FULL, { name: "Marta", email: "marta@spa.example", companyName: "Spa Luna" });
    expect(l.status).toBe(201);
    const conv = await call("POST", `/leads/${l.json.lead.id}/convert`, FULL, { opportunity: { title: "Spa Luna", amountCents: 90000 } });
    expect(conv.status).toBe(200);
    const opp = conv.json.opportunity;
    expect((await call("POST", `/opportunities/${opp.id}/stage`, FULL, { stage: "proposal" })).json.opportunity.stage).toBe("proposal");
    expect((await call("POST", `/opportunities/${opp.id}/stage`, FULL, { stage: "lost" })).status).toBe(400);
    const ct = await call("POST", "/contracts", FULL, { companyId: conv.json.company.id, opportunityId: opp.id, planId: "base", modules: ["spa"] });
    expect(ct.status).toBe(201);
    expect((await call("POST", `/contracts/${ct.json.contract.id}/status`, FULL, { status: "active" })).status).toBe(409);
    const dash = await call("GET", "/dashboard", READ);
    expect(dash.json.leadsByStatus.converted).toBe(1);
    expect((await call("GET", "/companies/99999", FULL)).status).toBe(404);
  });

  it("entrada no válida → 400 sin detalles internos", async () => {
    const r = await call("POST", "/leads", FULL, { name: 5 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).not.toMatch(/stack|at /);
  });
});
