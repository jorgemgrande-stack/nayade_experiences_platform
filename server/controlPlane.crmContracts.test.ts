/**
 * Contratos SaaS v2: referencia, versionado inmutable, edición solo en borrador/enviado, firma
 * registrada (sin firma ficticia), activación con renovación, renovaciones y API con ámbitos.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService, addInterval, contractReference } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const DAY = 86_400_000;
let store: MemoryCrmStore;
let crm: CrmService;
let now = Date.UTC(2026, 9, 15, 10);

beforeEach(() => {
  store = new MemoryCrmStore();
  now = Date.UTC(2026, 9, 15, 10);
  crm = new CrmService({ store, now: () => now, activation: { activate: async ({ company }) => ({ tenantId: `t-${company.id}` }) } });
});

async function company() {
  const c = await crm.createCompany({ name: `Co ${Math.random()}` }, "op");
  await crm.createContact(c.id, { firstName: "Ana", email: `ana${c.id}@x.example` }, "op");
  return c;
}

describe("utilidades", () => {
  it("referencia y periodos", () => {
    expect(contractReference(42, Date.UTC(2026, 0, 1))).toBe("CT-2026-000042");
    expect(new Date(addInterval(Date.UTC(2026, 0, 31), "month")).toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(new Date(addInterval(Date.UTC(2026, 9, 15), "year")).toISOString().slice(0, 10)).toBe("2027-10-15");
  });
});

describe("contratos v2", () => {
  it("alta con referencia única y versión inicial", async () => {
    const co = await company();
    const a = await crm.createContract({ companyId: co.id, planId: "pro", billingInterval: "month", conditions: "Permanencia 12 meses", noticeDays: 30 }, "op");
    const b = await crm.createContract({ companyId: co.id }, "op");
    expect(a.reference).toMatch(/^CT-2026-\d{6}$/);
    expect(a.reference).not.toBe(b.reference);
    const d = await crm.getContract(a.id);
    expect(d.versions).toHaveLength(1);
    expect(d.versions[0]).toMatchObject({ version: 1, reason: "Versión inicial", snapshot: { planId: "pro", billingInterval: "month", noticeDays: 30, conditions: "Permanencia 12 meses" } });
  });

  it("validación de términos", async () => {
    const co = await company();
    await expect(crm.createContract({ companyId: co.id, startDate: now, renewalDate: now - DAY }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createContract({ companyId: co.id, noticeDays: 400 }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createContract({ companyId: co.id, currency: "EURO" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(crm.createContract({ companyId: co.id, planId: "Plan Pro!" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    expect(await store.list("contracts")).toHaveLength(0); // nada escrito
  });

  it("cada cambio de términos es una versión; enviado vuelve a borrador; firmado es inmutable", async () => {
    const co = await company();
    const c = await crm.createContract({ companyId: co.id, planId: "base", amountCents: 4900 }, "op");
    const v2 = await crm.updateContract(c.id, { amountCents: 3900, reason: "Descuento de lanzamiento" }, "op");
    expect(v2).toMatchObject({ version: 2, amountCents: 3900, status: "draft" });
    expect(await crm.updateContract(c.id, { amountCents: 3900 }, "op")).toMatchObject({ version: 2 }); // sin cambios
    await crm.setContractStatus(c.id, "sent", "op");
    const v3 = await crm.updateContract(c.id, { planId: "pro" }, "op");
    expect(v3).toMatchObject({ version: 3, status: "draft", planId: "pro" });
    const d = await crm.getContract(c.id);
    expect(d.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(d.versions[1]).toMatchObject({ reason: "Descuento de lanzamiento", snapshot: { amountCents: 3900, planId: "base" } });
    expect(d.versions[2].snapshot).toMatchObject({ amountCents: 4900 }); // instantánea antigua intacta
    expect(d.timeline.some((a) => a.summary.includes("vuelve a borrador"))).toBe(true);
    await crm.setContractStatus(c.id, "sent", "op");
    const s = await crm.setContractStatus(c.id, "signed", "op", { signatureRef: "Documento firmado 2026-10-15" });
    expect(s).toMatchObject({ signedAt: now, signatureMethod: "manual", signatureRef: "Documento firmado 2026-10-15" });
    await expect(crm.updateContract(c.id, { amountCents: 1 }, "op")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("la activación fija inicio y renovación según la periodicidad", async () => {
    const co = await company();
    const c = await crm.createContract({ companyId: co.id, planId: "base", billingInterval: "year" }, "op");
    for (const st of ["sent", "signed", "active"] as const) await crm.setContractStatus(c.id, st, "op");
    const a = (await store.get("contracts", c.id))!;
    expect(a).toMatchObject({ status: "active", tenantId: `t-${co.id}`, startDate: now, renewalDate: addInterval(now, "year") });
  });

  it("renovación: borrador enlazado con el periodo siguiente; sin duplicados; listado de próximas", async () => {
    const co = await company();
    const c = await crm.createContract({ companyId: co.id, planId: "base", billingInterval: "month", amountCents: 4900, conditions: "C1", autoRenew: true }, "op");
    await expect(crm.renewContract(c.id, "op")).rejects.toMatchObject({ code: "invalid_state" });
    for (const st of ["sent", "signed", "active"] as const) await crm.setContractStatus(c.id, st, "op");
    const active = (await store.get("contracts", c.id))!;
    const r = await crm.renewContract(c.id, "op");
    expect(r).toMatchObject({
      status: "draft",
      previousContractId: c.id,
      planId: "base",
      amountCents: 4900,
      conditions: "C1",
      autoRenew: true,
      startDate: active.renewalDate,
      renewalDate: addInterval(active.renewalDate!, "month"),
      version: 1,
    });
    await expect(crm.renewContract(c.id, "op")).rejects.toMatchObject({ code: "conflict" }); // idempotencia
    await crm.setContractStatus(r.id, "cancelled", "op");
    expect((await crm.renewContract(c.id, "op")).previousContractId).toBe(c.id); // tras cancelar, se puede renovar
    expect((await crm.listContracts({ renewalBefore: now + 40 * DAY })).items.map((x) => x.id)).toEqual([c.id]);
    expect((await crm.listContracts({ renewalBefore: now + 10 * DAY })).total).toBe(0);
  });
});

describe("activación de contratos: errores claros", () => {
  it("sin contacto con correo → invalid_input; fallo del alta → conflict con el motivo, y el contrato sigue firmado", async () => {
    const co = await crm.createCompany({ name: "Sin contacto" }, "op");
    await crm.createContact(co.id, { firstName: "Sin correo", phone: "600" }, "op");
    const c = await crm.createContract({ companyId: co.id, planId: "base" }, "op");
    for (const st of ["sent", "signed"] as const) await crm.setContractStatus(c.id, st, "op");
    await expect(crm.setContractStatus(c.id, "active", "op")).rejects.toMatchObject({ code: "invalid_input", message: expect.stringContaining("contacto activo con correo") });
    await crm.createContact(co.id, { firstName: "Ana", email: "ana@sin.example" }, "op");
    const failing = new CrmService({ store, now: () => now, activation: { activate: async () => { throw new Error("BD no disponible"); } } });
    await expect(failing.setContractStatus(c.id, "active", "op")).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("BD no disponible") });
    expect((await store.get("contracts", c.id))!.status).toBe("signed");
    expect((await crm.setContractStatus(c.id, "active", "op")).status).toBe("active");
  });
});

describe("API de contratos v2", () => {
  let server: http.Server;
  let port: number;
  const FULL = "ct-full-token-aaaaaaaaaaaaaaaaaaaaaa";
  const READ = "ct-read-token-bbbbbbbbbbbbbbbbbbbbbb";
  let companyId: number;

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const st = new MemoryCrmStore();
    const svc = new CrmService({ store: st });
    companyId = (await svc.createCompany({ name: "API Co" }, "seed")).id;
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
      crm: { service: svc, store: st },
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

  it("alta, edición versionada, ficha con versiones y ámbitos", async () => {
    const c = await call("POST", "/contracts", FULL, { companyId, planId: "pro", billingInterval: "year", conditions: "Pago anual", noticeDays: 60 });
    expect(c.status).toBe(201);
    const cid = c.json.contract.id;
    expect((await call("PATCH", `/contracts/${cid}`, READ, { amountCents: 1 })).status).toBe(403);
    expect((await call("POST", `/contracts/${cid}/renew`, READ)).status).toBe(403);
    // Campos de estado/sistema no editables por PATCH
    for (const bad of [{ status: "active" }, { tenantId: "x" }, { version: 9 }, { reference: "CT-X" }, { signatureMethod: "electronic" }, { signedAt: 1 }]) {
      expect((await call("PATCH", `/contracts/${cid}`, FULL, bad)).status).toBe(400);
    }
    expect((await call("POST", "/contracts", FULL, { companyId, tenantId: "x" })).status).toBe(400);
    const p = await call("PATCH", `/contracts/${cid}`, FULL, { amountCents: 99000, reason: "Ajuste" });
    expect(p.json.contract).toMatchObject({ version: 2, amountCents: 99000 });
    const d = await call("GET", `/contracts/${cid}`, READ);
    expect(d.json.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(d.json.timeline.length).toBeGreaterThan(0);
    expect((await call("GET", "/contracts/99999", READ)).status).toBe(404);
    expect((await call("GET", "/contracts?status=draft&limit=1", READ)).json).toMatchObject({ total: 1, limit: 1 });
  });

  it("firma registrada y renovación por API (activación no configurada → 409)", async () => {
    const c = (await call("POST", "/contracts", FULL, { companyId, planId: "base" })).json.contract;
    await call("POST", `/contracts/${c.id}/status`, FULL, { status: "sent" });
    const s = await call("POST", `/contracts/${c.id}/status`, FULL, { status: "signed", signatureRef: "Papel firmado" });
    expect(s.json.contract).toMatchObject({ status: "signed", signatureMethod: "manual", signatureRef: "Papel firmado" });
    expect((await call("POST", `/contracts/${c.id}/status`, FULL, { status: "active" })).status).toBe(409);
    const r = await call("POST", `/contracts/${c.id}/renew`, FULL);
    expect(r.status).toBe(201);
    expect(r.json.contract.previousContractId).toBe(c.id);
    expect((await call("POST", `/contracts/${c.id}/renew`, FULL)).status).toBe(409);
  });
});
