/**
 * Panel comercial: métricas reales del CRM, resumen de suscripciones y ámbitos (los datos de
 * facturación exigen billing:read y facturación configurada; si no, `billing` es null).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { billingSummary, DAY_MS } from "./crm/dashboard";
import { MemoryBillingStore } from "./_core/billing/memory";
import type { Subscription } from "./_core/billing/types";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, type ServiceToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const NOW = Date.UTC(2026, 9, 15, 12);

const sub = (p: Partial<Subscription> & Pick<Subscription, "tenantId" | "status">): Subscription => ({
  id: `sub-${p.tenantId}`,
  planId: "base",
  modules: [],
  currentPeriodStart: NOW - 10 * DAY_MS,
  currentPeriodEnd: NOW + 20 * DAY_MS,
  trialEnd: null,
  graceEnd: null,
  cancelAtPeriodEnd: false,
  pendingPlanId: null,
  currency: "EUR",
  providerCustomerId: null,
  createdAt: NOW - 30 * DAY_MS,
  canceledAt: null,
  attempts: 0,
  ...p,
});

describe("resumen de suscripciones", () => {
  it("cuenta estados y lista vencimientos dentro del horizonte, ordenados", () => {
    const s = billingSummary(
      [
        sub({ tenantId: "t1", status: "trialing", trialEnd: NOW + 5 * DAY_MS }),
        sub({ tenantId: "t2", status: "trialing", trialEnd: NOW + 2 * DAY_MS }),
        sub({ tenantId: "t3", status: "trialing", trialEnd: NOW + 12 * DAY_MS }),
        sub({ tenantId: "t4", status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: NOW + 3 * DAY_MS }),
        sub({ tenantId: "t5", status: "active" }),
        sub({ tenantId: "t6", status: "past_due", graceEnd: NOW + 4 * DAY_MS, attempts: 2 }),
        sub({ tenantId: "t7", status: "suspended" }),
      ],
      NOW,
    );
    expect(s).toMatchObject({ trialing: 3, active: 2, pastDue: 1, suspended: 1, horizonDays: 7 });
    expect(s.trialsEndingSoon.map((x) => x.tenantId)).toEqual(["t2", "t1"]);
    expect(s.endingSoon.map((x) => x.tenantId)).toEqual(["t4"]);
    expect(s.pendingPayments).toEqual([{ tenantId: "t6", planId: "base", graceEnd: NOW + 4 * DAY_MS, attempts: 2 }]);
    expect(billingSummary([], NOW)).toMatchObject({ trialing: 0, trialsEndingSoon: [] });
  });
});

describe("métricas del panel comercial", () => {
  it("se calculan con los datos del CRM", async () => {
    let now = Date.UTC(2026, 8, 20);
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => now, activation: { activate: async ({ company }) => ({ tenantId: `t-${company.id}` }) } });
    await crm.createLead({ name: "A", email: "a@x.example" }, "op");
    const l2 = await crm.createLead({ name: "B", email: "b@x.example" }, "op");
    await crm.setLeadStatus(l2.id, "disqualified", "op");
    const c1 = await crm.createCompany({ name: "Uno" }, "op");
    const c2 = await crm.createCompany({ name: "Dos" }, "op");
    await crm.createCompany({ name: "Tres" }, "op");
    await crm.createContact(c2.id, { firstName: "E", email: "e@dos.example" }, "op");
    // Ganada en septiembre (no cuenta en octubre)
    const old = await crm.createOpportunity({ companyId: c1.id, title: "Sep", amountCents: 5000 }, "op");
    await crm.moveStage(old.id, "proposal", "op");
    await crm.moveStage(old.id, "won", "op");
    now = NOW;
    const o1 = await crm.createOpportunity({ companyId: c2.id, title: "Oct", amountCents: 10000, nextAction: "x", nextActionAt: NOW - DAY_MS }, "op");
    await crm.moveStage(o1.id, "proposal", "op");
    await crm.createOpportunity({ companyId: c2.id, title: "Abierta", amountCents: 20000 }, "op");
    const o3 = await crm.createOpportunity({ companyId: c2.id, title: "Ganada oct", amountCents: 7000 }, "op");
    await crm.moveStage(o3.id, "negotiation", "op");
    await crm.moveStage(o3.id, "won", "op");
    const k = await crm.createContract({ companyId: c2.id, planId: "base", billingInterval: "month", renewalDate: NOW + 20 * DAY_MS }, "op");
    for (const s of ["sent", "signed", "active"] as const) await crm.setContractStatus(k.id, s, "op");
    await crm.createContract({ companyId: c1.id }, "op");
    await crm.addTask("company", c1.id, "Vencida", NOW - DAY_MS, "op");

    const d = await crm.dashboard();
    expect(d.metrics).toMatchObject({
      activeLeads: 1,
      openOpportunities: 2,
      pipelineOpenCents: 30000,
      pipelineWeightedCents: 10000 * 0.3 + 20000 * 0.1,
      overdueNextActions: 1,
      wonThisMonth: { count: 1, amountCents: 7000 },
      pendingContracts: { draft: 1, sent: 0, signed: 0 },
      renewalsNext30Days: 1,
      overdueTasks: 1,
      activeCustomers: 2,
      customersWithPlatform: 1,
      prospects: 1,
    });
    expect(d.leadsByStatus).toMatchObject({ new: 1, disqualified: 1 }); // claves anteriores intactas
  });
});

describe("API del panel", () => {
  const servers: http.Server[] = [];
  const COM = "dash-commercial-token-aaaaaaaaaaaaaaa";
  const MGR = "dash-manager-token-bbbbbbbbbbbbbbbbbb";

  async function start(withBilling: boolean) {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const st = new MemoryCrmStore();
    const billingStore = new MemoryBillingStore();
    await billingStore.putSubscription(sub({ tenantId: "acme", status: "trialing", trialEnd: Date.now() + 2 * DAY_MS }));
    const tokens: ServiceToken[] = [
      { id: "comercial", sha256: hashToken(COM), scopes: ["crm:read"] },
      { id: "gerente", sha256: hashToken(MGR), scopes: ["crm:read", "billing:read"] },
    ];
    const app = createControlPlaneApp({
      tokens,
      registry: new TenantRegistryService(reg, () => ring),
      reader: reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      crm: { service: new CrmService({ store: st }), store: st },
      ...(withBilling ? { billingStore } : {}),
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    return (token: string) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port, path: "/cp/v1/crm/dashboard", headers: { authorization: `Bearer ${token}` } }, (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(b) }));
          })
          .on("error", reject);
      });
  }
  afterAll(async () => {
    for (const s of servers) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  let withBilling: (t: string) => Promise<{ status: number; json: any }>;
  let noBilling: (t: string) => Promise<{ status: number; json: any }>;
  beforeAll(async () => {
    withBilling = await start(true);
    noBilling = await start(false);
  });

  it("billing:read ve el resumen de suscripciones", async () => {
    const r = await withBilling(MGR);
    expect(r.status).toBe(200);
    expect(r.json.billing).toMatchObject({ trialing: 1 });
    expect(r.json.billing.trialsEndingSoon[0].tenantId).toBe("acme");
    expect(r.json.billingUnavailable).toBeNull();
    expect(r.json.metrics).toBeDefined();
  });

  it("sin billing:read no se filtran datos de facturación", async () => {
    const r = await withBilling(COM);
    expect(r.status).toBe(200);
    expect(r.json.billing).toBeNull();
    expect(r.json.billingUnavailable).toBe("forbidden");
    expect(JSON.stringify(r.json)).not.toContain("acme");
  });

  it("sin facturación configurada se indica, no se inventan ceros", async () => {
    const r = await noBilling(MGR);
    expect(r.json).toMatchObject({ billing: null, billingUnavailable: "not_configured" });
  });
});
