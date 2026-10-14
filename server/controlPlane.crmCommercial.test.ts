/**
 * CRM comercial v2: empresas (ficha, ciclo de vida), contactos (principal), leads (edición,
 * duplicados, conversión sin pérdida), pipeline ampliado y API (ámbitos, campos no editables,
 * IDOR y validación).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService, normalizeCompanyName, normalizePhone } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { STAGES } from "./crm/types";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

let store: MemoryCrmStore;
let crm: CrmService;
let now = Date.UTC(2026, 9, 15);

beforeEach(() => {
  store = new MemoryCrmStore();
  now = Date.UTC(2026, 9, 15);
  crm = new CrmService({ store, now: () => now, activation: { activate: async ({ company }) => ({ tenantId: `t-${company.id}` }) } });
});

describe("normalización", () => {
  it("nombres de empresa y teléfonos comparables", () => {
    expect(normalizeCompanyName("Kayak Sur, S.L.")).toBe(normalizeCompanyName("kayak  sur"));
    expect(normalizeCompanyName("Hôtel Mar SA")).toBe("hotel mar");
    expect(normalizePhone("+34 600-11-22-33")).toBe(normalizePhone("600112233"));
    expect(normalizePhone("12")).toBe("");
  });
});

describe("empresas", () => {
  it("valida la ficha fiscal y de contacto", async () => {
    await expect(crm.createCompany({ name: " " }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createCompany({ name: "A", email: "no-es-correo" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createCompany({ name: "A", country: "ESP" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createCompany({ name: "A", taxId: "B12 345*" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    const c = await crm.createCompany(
      { name: "Kayak Sur", legalName: "Kayak Sur SL", taxId: "b12345678", email: "Info@Kayak.example", country: "es", website: "kayak.example", city: "Sevilla" },
      "op",
    );
    expect(c).toMatchObject({ taxId: "B12345678", email: "info@kayak.example", country: "ES", website: "https://kayak.example/", status: "active", owner: "op", tenantId: null });
  });

  it("no duplica por NIF ni por nombre normalizado", async () => {
    await crm.createCompany({ name: "Kayak Sur, S.L.", taxId: "B11" }, "op");
    await expect(crm.createCompany({ name: "kayak sur" }, "op")).rejects.toMatchObject({ code: "conflict" });
    await expect(crm.createCompany({ name: "Otra", taxId: "b11" }, "op")).rejects.toMatchObject({ code: "conflict" });
  });

  it("edición con historial; sin cambios no registra nada", async () => {
    const c = await crm.createCompany({ name: "Spa Luna" }, "op");
    const u = await crm.updateCompany(c.id, { status: "inactive", phone: "600111222", owner: "ana" }, "op");
    expect(u).toMatchObject({ status: "inactive", phone: "600111222", owner: "ana", updatedAt: now });
    const tl = await crm.timeline("company", c.id);
    expect(tl[0].summary).toContain("status active → inactive");
    expect(tl[0].summary).toContain("phone");
    expect(tl[0].summary).not.toContain("600111222"); // datos personales fuera del historial
    const n = tl.length;
    await crm.updateCompany(c.id, { status: "inactive" }, "op");
    expect(await crm.timeline("company", c.id)).toHaveLength(n);
  });

  it("ciclo de vida: prospecto → cliente → tenant, y filtro por fase", async () => {
    const c = await crm.createCompany({ name: "Hotel Mar" }, "op");
    expect((await crm.getCompany(c.id)).lifecycle).toBe("prospect");
    const o = await crm.createOpportunity({ companyId: c.id, title: "Pro", amountCents: 1000 }, "op");
    await crm.moveStage(o.id, "proposal", "op");
    await crm.moveStage(o.id, "won", "op");
    expect((await crm.getCompany(c.id)).lifecycle).toBe("customer");
    await crm.createContact(c.id, { firstName: "Eva", email: "eva@mar.example" }, "op");
    const k = await crm.createContract({ companyId: c.id, planId: "base" }, "op");
    for (const s of ["sent", "signed", "active"] as const) await crm.setContractStatus(k.id, s, "op");
    expect((await crm.getCompany(c.id)).lifecycle).toBe("tenant");
    await crm.createCompany({ name: "Prospecto" }, "op");
    expect((await crm.listCompanies({ lifecycle: "prospect" })).items.map((x) => x.name)).toEqual(["Prospecto"]);
    expect((await crm.listCompanies({ q: "MAR" })).total).toBe(1);
  });
});

describe("contactos", () => {
  it("nombre y apellidos; el primero es el principal; solo uno principal por empresa", async () => {
    const c = await crm.createCompany({ name: "Co" }, "op");
    const a = await crm.createContact(c.id, { firstName: "Ana", lastName: "Ruiz Gil", email: "ana@co.example" }, "op");
    expect(a).toMatchObject({ name: "Ana Ruiz Gil", isPrimary: true, status: "active" });
    const b = await crm.createContact(c.id, { name: "Luis Pérez", phone: "+34 600 000 001" }, "op");
    expect(b).toMatchObject({ firstName: "Luis", lastName: "Pérez", isPrimary: false });
    await crm.updateContact(b.id, { isPrimary: true }, "op");
    const list = (await crm.listContacts({ companyId: c.id })).items;
    expect(list.filter((x) => x.isPrimary).map((x) => x.id)).toEqual([b.id]);
    expect(list[0].id).toBe(b.id); // el principal primero
  });

  it("estado, duplicados por correo y búsqueda por teléfono", async () => {
    const c = await crm.createCompany({ name: "Co" }, "op");
    const a = await crm.createContact(c.id, { firstName: "Ana", email: "ana@co.example" }, "op");
    await expect(crm.createContact(c.id, { firstName: "Otra", email: "ANA@co.example" }, "op")).rejects.toMatchObject({ code: "conflict" });
    const off = await crm.updateContact(a.id, { status: "inactive" }, "op");
    expect(off).toMatchObject({ status: "inactive", isPrimary: false });
    await expect(crm.updateContact(a.id, { isPrimary: true }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await crm.createContact(c.id, { firstName: "Tel", phone: "600 11 22 33" }, "op");
    expect((await crm.listContacts({ q: "+34600112233" })).items.map((x) => x.firstName)).toEqual(["Tel"]);
    await expect(crm.createContact(9999, { firstName: "X" }, "op")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("leads", () => {
  it("prioridad, edición e historial; correo duplicado en edición", async () => {
    const l = await crm.createLead({ name: "Marta", email: "marta@x.example", priority: "high", source: "web" }, "op");
    expect(l.priority).toBe("high");
    await crm.createLead({ name: "Pablo", email: "pablo@x.example" }, "op");
    await expect(crm.updateLead(l.id, { email: "pablo@x.example" }, "op")).rejects.toMatchObject({ code: "conflict" });
    await expect(crm.updateLead(l.id, { email: null, phone: null }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    const u = await crm.updateLead(l.id, { priority: "urgent", owner: "ana", notes: "Llamar el lunes" }, "op");
    expect(u).toMatchObject({ priority: "urgent", owner: "ana", notes: "Llamar el lunes" });
    expect((await crm.timeline("lead", l.id))[0].summary).toContain("priority high → urgent");
    expect((await crm.listLeads({ priority: "urgent" })).total).toBe(1);
    expect((await crm.listLeads({ q: "marta" })).total).toBe(1);
  });

  it("detección de duplicados por correo, teléfono, empresa y NIF", async () => {
    await crm.createLead({ name: "A", email: "a@x.example", phone: "600 123 456", companyName: "Kayak Sur S.L." }, "op");
    const co = await crm.createCompany({ name: "Hotel Norte", taxId: "B99" }, "op");
    await crm.createContact(co.id, { firstName: "C", email: "c@norte.example" }, "op");
    const d = await crm.findDuplicates({ phone: "+34600123456", companyName: "kayak sur", email: "c@norte.example", taxId: "b99" });
    expect(d.map((x) => `${x.type}:${x.reason}`).sort()).toEqual(["company:tax_id", "contact:email", "lead:phone"]);
    expect(await crm.findDuplicates({})).toEqual([]);
  });

  it("la conversión conserva el lead, reutiliza empresa y contacto y copia las notas", async () => {
    const co = await crm.createCompany({ name: "Spa Luna SL" }, "op");
    await crm.createContact(co.id, { firstName: "Marta", email: "marta@spa.example" }, "op");
    const l = await crm.createLead({ name: "Marta Gil", email: "marta@spa.example", phone: "600", companyName: "spa luna", source: "feria", notes: "Quiere 3 módulos" }, "op");
    const r = await crm.convertLead(l.id, { opportunity: { title: "Spa Luna Pro", amountCents: 1000, planId: "pro", modules: ["spa", "hotel"] } }, "op");
    expect(r.company.id).toBe(co.id);
    expect(await store.list("contacts", { companyId: co.id })).toHaveLength(1);
    expect(r.opportunity).toMatchObject({ contactId: r.contact.id, planId: "pro", modules: ["spa", "hotel"] });
    expect(r.lead).toMatchObject({ status: "converted", name: "Marta Gil", source: "feria", notes: "Quiere 3 módulos", phone: "600", convertedCompanyId: co.id });
    expect((await crm.timeline("company", co.id)).some((a) => a.summary.includes("Quiere 3 módulos"))).toBe(true);
    // Lead convertido: datos de origen bloqueados, notas editables; no se convierte dos veces
    await expect(crm.updateLead(l.id, { email: "otro@x.example" }, "op")).rejects.toMatchObject({ code: "invalid_state" });
    expect((await crm.updateLead(l.id, { notes: "Cliente" }, "op")).notes).toBe("Cliente");
    await expect(crm.convertLead(l.id, {}, "op")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("una conversión con datos no válidos no escribe nada", async () => {
    const l = await crm.createLead({ name: "X", email: "x@x.example", companyName: "Nueva" }, "op");
    await expect(crm.convertLead(l.id, { opportunity: { title: "T", modules: ["NO VALIDO"] } }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    expect(await store.list("companies")).toHaveLength(0);
    expect((await store.get("leads", l.id))!.status).toBe("new");
  });

  it("conversión hacia una empresa existente elegida", async () => {
    const co = await crm.createCompany({ name: "Grupo A" }, "op");
    const l = await crm.createLead({ name: "Luis", phone: "611" }, "op");
    const r = await crm.convertLead(l.id, { companyId: co.id }, "op");
    expect(r.company.id).toBe(co.id);
    await expect(crm.convertLead((await crm.createLead({ name: "Z", phone: "1" }, "op")).id, { companyId: 999 }, "op")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("pipeline de oportunidades", () => {
  async function opp() {
    const c = await crm.createCompany({ name: `Co ${Math.random()}` }, "op");
    return crm.createOpportunity({ companyId: c.id, title: "T", amountCents: 100000 }, "op");
  }

  it("ocho etapas; ganar solo desde propuesta o negociación; reabrir", async () => {
    expect(STAGES).toEqual(["prospecting", "contacted", "qualification", "demo", "proposal", "negotiation", "won", "lost"]);
    const o = await opp();
    for (const [s, p] of [["contacted", 15], ["qualification", 20], ["demo", 25], ["contacted", 15]] as const) {
      expect((await crm.moveStage(o.id, s, "op")).probability).toBe(p);
    }
    await expect(crm.moveStage(o.id, "won", "op")).rejects.toMatchObject({ code: "invalid_state" });
    await crm.moveStage(o.id, "proposal", "op");
    expect((await crm.moveStage(o.id, "won", "op")).closedAt).toBe(now);
    await expect(crm.moveStage(o.id, "demo", "op")).rejects.toMatchObject({ code: "invalid_state" });
    expect((await crm.moveStage(o.id, "negotiation", "op")).closedAt).toBeNull();
    expect((await crm.pipeline()).map((s) => s.stage)).toEqual(STAGES);
    const tl = await crm.timeline("opportunity", o.id);
    expect(tl.filter((a) => a.summary.startsWith("Etapa:")).length).toBe(7);
  });

  it("edición: plan, módulos, próxima acción; contacto de otra empresa rechazado", async () => {
    const o = await opp();
    const other = await crm.createCompany({ name: "Ajena" }, "op");
    const foreign = await crm.createContact(other.id, { firstName: "X" }, "op");
    await expect(crm.updateOpportunity(o.id, { contactId: foreign.id }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.updateOpportunity(o.id, { modules: ["Hotel!"] }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.updateOpportunity(o.id, { currency: "EURO" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    const u = await crm.updateOpportunity(o.id, { planId: "pro", modules: ["hotel", "hotel", "spa"], nextAction: "Demo", nextActionAt: now + 86400000 }, "op");
    expect(u).toMatchObject({ planId: "pro", modules: ["hotel", "spa"], nextAction: "Demo", nextActionAt: now + 86400000 });
    expect((await crm.listOpportunities({ open: true, q: "pro" })).total).toBe(1);
  });

  it("completar una tarea dos veces es idempotente", async () => {
    const c = await crm.createCompany({ name: "T" }, "op");
    const t = await crm.addTask("company", c.id, "Llamar", now + 1000, "op");
    const a = await crm.completeTask(t.id);
    now += 5000;
    expect((await crm.completeTask(t.id)).doneAt).toBe(a.doneAt);
  });
});

describe("API del CRM comercial v2", () => {
  let server: http.Server;
  let port: number;
  const FULL = "crm2-full-token-aaaaaaaaaaaaaaaaaaaa";
  const READ = "crm2-read-token-bbbbbbbbbbbbbbbbbbbb";
  const OTHER = "crm2-other-token-cccccccccccccccccc";

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const st = new MemoryCrmStore();
    const app = createControlPlaneApp({
      tokens: [
        { id: "ana", sha256: hashToken(FULL), scopes: ["crm:read", "crm:write"] },
        { id: "viewer", sha256: hashToken(READ), scopes: ["crm:read"] },
        { id: "tickets-only", sha256: hashToken(OTHER), scopes: ["tenants:read"] },
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

  it("ámbitos: sin token 401, sin crm:* 403, lectura no puede escribir", async () => {
    expect((await call("GET", "/contacts")).status).toBe(401);
    expect((await call("GET", "/companies", OTHER)).status).toBe(403);
    expect((await call("GET", "/companies", READ)).status).toBe(200);
    expect((await call("POST", "/companies", READ, { name: "X" })).status).toBe(403);
    expect((await call("PATCH", "/companies/1", READ, { name: "X" })).status).toBe(403);
    expect((await call("PATCH", "/contacts/1", READ, { firstName: "X" })).status).toBe(403);
    expect((await call("PATCH", "/leads/1", READ, { notes: "X" })).status).toBe(403);
    expect((await call("PATCH", "/opportunities/1", READ, { title: "X" })).status).toBe(403);
  });

  it("ficha de empresa, contactos y edición; campos no editables rechazados", async () => {
    const c = await call("POST", "/companies", FULL, { name: "Multiaventura", taxId: "B55", email: "info@multi.example", country: "ES" });
    expect(c.status).toBe(201);
    const cid = c.json.company.id;
    expect((await call("POST", "/companies", FULL, { name: "multiaventura" })).status).toBe(409);
    // tenantId solo lo fija la activación de contrato: no se puede asignar por API (escalada)
    expect((await call("PATCH", `/companies/${cid}`, FULL, { tenantId: "otro-tenant" })).status).toBe(400);
    expect((await call("POST", "/companies", FULL, { name: "Y", tenantId: "x" })).status).toBe(400);
    expect((await call("PATCH", `/companies/${cid}`, FULL, { status: "churned", city: "Jaén" })).json.company).toMatchObject({ status: "churned", city: "Jaén", tenantId: null });
    expect((await call("PATCH", "/companies/99999", FULL, { city: "X" })).status).toBe(404);

    const k = await call("POST", `/companies/${cid}/contacts`, FULL, { firstName: "Ana", lastName: "Martín", email: "ana@multi.example", role: "Gerente" });
    expect(k.status).toBe(201);
    expect(k.json.contact.isPrimary).toBe(true);
    expect((await call("POST", `/companies/${cid}/contacts`, FULL, { firstName: "B", email: "no" })).status).toBe(400);
    expect((await call("PATCH", `/contacts/${k.json.contact.id}`, FULL, { phone: "600", isPrimary: true })).json.contact.phone).toBe("600");
    expect((await call("PATCH", `/contacts/${k.json.contact.id}`, FULL, { companyId: 99999 })).status).toBe(404);

    const detail = await call("GET", `/companies/${cid}`, READ);
    expect(detail.json.company).toMatchObject({ id: cid, lifecycle: "prospect" });
    expect(detail.json.contacts).toHaveLength(1);
    expect(detail.json.timeline.length).toBeGreaterThan(0);

    const list = await call("GET", "/contacts?q=ana&limit=1", READ);
    expect(list.json).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect((await call("GET", "/companies?lifecycle=prospect", READ)).json.total).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/companies?limit=0", READ)).status).toBe(400);
  });

  it("leads: alta con aviso de duplicados, edición, conversión y oportunidad ampliada", async () => {
    await call("POST", "/leads", FULL, { name: "Primero", phone: "699 000 111", companyName: "Kayak Norte" });
    const l = await call("POST", "/leads", FULL, { name: "Segundo", email: "s@kayak.example", phone: "+34699000111", priority: "high" });
    expect(l.status).toBe(201);
    expect(l.json.duplicates.map((d: any) => d.reason)).toContain("phone");
    expect((await call("GET", "/duplicates?companyName=kayak%20norte%20sl", READ)).json.duplicates).toHaveLength(1);
    const lid = l.json.lead.id;
    expect((await call("PATCH", `/leads/${lid}`, FULL, { status: "converted" })).status).toBe(400);
    expect((await call("PATCH", `/leads/${lid}`, FULL, { priority: "urgent", owner: "ana" })).json.lead.priority).toBe("urgent");
    const conv = await call("POST", `/leads/${lid}/convert`, FULL, { companyName: "Kayak Norte", opportunity: { title: "Plan Pro", planId: "pro", modules: ["tpv"] } });
    expect(conv.status).toBe(200);
    const oid = conv.json.opportunity.id;
    expect(conv.json.opportunity).toMatchObject({ planId: "pro", modules: ["tpv"], contactId: conv.json.contact.id });
    expect((await call("POST", `/opportunities/${oid}/stage`, FULL, { stage: "demo" })).json.opportunity.stage).toBe("demo");
    expect((await call("PATCH", `/opportunities/${oid}`, FULL, { nextAction: "Enviar propuesta", nextActionAt: Date.UTC(2026, 9, 20) })).status).toBe(200);
    expect((await call("PATCH", `/opportunities/${oid}`, FULL, { stage: "won" })).status).toBe(400); // la etapa solo por /stage
    expect((await call("PATCH", `/opportunities/${oid}`, FULL, { companyId: 1 })).status).toBe(400);
    const od = await call("GET", `/opportunities/${oid}`, READ);
    expect(od.json.opportunity.nextAction).toBe("Enviar propuesta");
    expect(od.json.timeline.some((a: any) => a.summary.includes("Origen: lead"))).toBe(true);
    const ol = await call("GET", "/opportunities?open=1&stage=demo", READ);
    expect(ol.json.total).toBe(1);
    expect(ol.json.pipeline).toHaveLength(8);
    expect((await call("GET", `/leads/${lid}`, READ)).json.lead.status).toBe("converted");
  });

  it("actividad solo sobre entidades existentes; errores sin detalles internos", async () => {
    const r = await call("POST", "/activities", FULL, { entityType: "company", entityId: 424242, kind: "call", summary: "x" });
    expect(r.status).toBe(404);
    const bad = await call("PATCH", "/leads/abc", FULL, { notes: "x" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).not.toMatch(/stack|at /);
  });
});
