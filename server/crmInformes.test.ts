/** Informes comerciales del CRM: cálculo (hora de Madrid, conversión, actividad, calidad de datos), CSV y API. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crmReports, madridMonth, toCsv, madridDayRange, madridMidnight } from "./crm/reports";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const D = (iso: string) => Date.parse(iso);

describe("informes: cálculo", () => {
  it("los meses se cuentan en hora de Madrid", () => {
    expect(madridMonth(D("2026-12-31T23:30:00Z"))).toBe("2027-01");
    expect(madridMonth(D("2026-10-31T22:30:00Z"))).toBe("2026-10"); // 23:30 en Madrid (hora de invierno)
  });

  it("conversión, actividad por responsable, seguimientos y calidad de datos", () => {
    const now = D("2026-10-24T12:00:00Z");
    const base = { createdAt: D("2026-10-05T10:00:00Z"), updatedAt: null } as const;
    const lead = (id: number, x: Record<string, unknown>) => ({ id, source: null, name: "L", email: null, phone: null, companyName: null, status: "new", priority: "normal", owner: null, notes: null, companyId: null, convertedCompanyId: null, convertedOpportunityId: null, ...base, ...x }) as never;
    const opp = (id: number, x: Record<string, unknown>) => ({ id, companyId: 1, contactId: null, title: `O${id}`, stage: "proposal", amountCents: 1000, currency: "EUR", expectedClose: null, probability: 50, owner: "Laura", planId: null, modules: [], nextAction: null, nextActionAt: null, lostReason: null, closedAt: null, ...base, ...x }) as never;
    const company = (id: number, name: string, x: Record<string, unknown> = {}) => ({ id, name, legalName: null, taxId: null, email: null, phone: null, website: null, sector: null, address: null, city: null, postalCode: null, country: null, billingEmail: null, notes: null, tenantId: null, owner: null, status: "active", ...base, ...x }) as never;
    const r = crmReports(
      {
        leads: [
          lead(1, { source: "web", email: "a@x.example" }),
          lead(2, { status: "converted", convertedCompanyId: 1, owner: "Laura", email: "A@x.example" }),
          lead(3, { createdAt: D("2026-09-01T10:00:00Z") }), // fuera del periodo
          lead(4, { status: "converted" }), // incoherente: convertido sin empresa
        ],
        opportunities: [
          opp(1, { stage: "won", closedAt: D("2026-10-15T10:00:00Z") }),
          opp(2, { stage: "lost", closedAt: D("2026-10-10T10:00:00Z"), lostReason: "precio" }),
          opp(3, { nextActionAt: D("2026-10-20T10:00:00Z") }), // vencida
          opp(4, { owner: null, companyId: 99 }), // sin responsable y empresa inexistente
          opp(5, { stage: "won", closedAt: null }), // incoherente
        ],
        companies: [company(1, "Hotel Ñandú S.L."), company(2, "hotel ñandu sl", { tenantId: "t-fantasma" })],
        contacts: [{ id: 1, companyId: 77, name: "C" } as never],
        activities: [
          { id: 1, entityType: "company", entityId: 1, kind: "call", summary: "x", dueAt: null, doneAt: null, author: "operator:laura", assignee: null, priority: "normal", createdAt: D("2026-10-06T10:00:00Z") },
          { id: 2, entityType: "company", entityId: 1, kind: "task", summary: "t", dueAt: D("2026-10-20T10:00:00Z"), doneAt: null, author: "x", assignee: "Laura", priority: "high", createdAt: D("2026-10-06T10:00:00Z") },
          { id: 3, entityType: "company", entityId: 1, kind: "task", summary: "t", dueAt: D("2026-10-30T10:00:00Z"), doneAt: D("2026-10-07T10:00:00Z"), author: "x", assignee: "Pablo", priority: "normal", createdAt: D("2026-10-06T10:00:00Z") },
        ],
      },
      { from: D("2026-10-01T00:00:00+02:00"), to: D("2026-11-01T00:00:00+01:00"), now, knownTenants: new Set(["t-real"]) },
    );
    expect(r.leads.total).toBe(3);
    expect(r.leads.byMonth["2026-10"]).toMatchObject({ total: 3, converted: 2, bySource: { web: 1, "sin origen": 2 } });
    expect(r.conversion).toMatchObject({ created: 5, won: 2, lost: 1, open: 2, winRate: 2 / 3, wonCents: 2000, lostReasons: { precio: 1 } });
    expect(r.activityByPerson.Laura).toMatchObject({ tasksPending: 1, tasksOverdue: 1, openOpportunities: 1 });
    expect(r.activityByPerson.Pablo).toMatchObject({ tasksDone: 1 });
    expect(r.activityByPerson["operator:laura"].activities).toBe(1);
    expect(r.followUps.overdueNextActions.map((x) => x.id)).toEqual([3]);
    expect(r.followUps.overdueTasks).toBe(1);
    expect(r.quality.duplicateCompaniesByName).toEqual([[1, 2]]);
    expect(r.quality.duplicateLeadsByEmail).toEqual([[1, 2]]);
    expect(r.quality).toMatchObject({ convertedLeadsWithoutCompany: 1, closedOpportunitiesWithoutDate: 1, openOpportunitiesWithoutOwner: 1, opportunitiesWithMissingCompany: 1, contactsWithMissingCompany: 1 });
    expect(r.quality.companiesWithUnknownTenant).toEqual([{ id: 2, tenantId: "t-fantasma" }]);
  });

  it("CSV: separador «;», comillas y sin fórmulas", () => {
    const csv = toCsv([{ a: "=SUMA(1)", b: 'dice "hola"', c: null, d: 5 }]);
    expect(csv).toBe('"a";"b";"c";"d"\r\n"\'=SUMA(1)";"dice ""hola""";"";"5"');
    expect(toCsv([])).toBe("");
  });
});

describe("informes: API", () => {
  let server: http.Server;
  let port: number;
  const READ = "informes-read-token-aaaaaaaaaaaaaaaaaaa";
  const OTHER = "informes-other-token-bbbbbbbbbbbbbbbbbb";

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const st = new MemoryCrmStore();
    const service = new CrmService({ store: st });
    await service.createLead({ name: "Lead Uno", email: "uno@x.example", source: "=web" }, "op");
    const app = createControlPlaneApp({
      tokens: [
        { id: "lectura", sha256: hashToken(READ), scopes: ["crm:read"] },
        { id: "otro", sha256: hashToken(OTHER), scopes: ["tenants:read"] },
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
  const get = (path: string, token?: string) =>
    new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: `/cp/v1/crm${path}`, headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, type: String(res.headers["content-type"] ?? "") }));
        })
        .on("error", reject);
    });
  // «Hoy» en Madrid, como los informes: entre las 00:00 y las 02:00 de Madrid la fecha UTC aún es la del día anterior
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  it("informe del periodo, sin truncar", async () => {
    const r = await get(`/reports?from=2026-01-01&to=${today}`, READ);
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.leads.total).toBe(1);
    expect(j.truncated).toBe(false);
    expect(j.period.timeZone).toBe("Europe/Madrid");
  });

  it("exportación CSV sin datos de contacto y sin fórmulas", async () => {
    const r = await get(`/reports/export?kind=leads&from=2026-01-01&to=${today}`, READ);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/text\/csv/);
    expect(r.body).not.toContain("uno@x.example");
    expect(r.body).toContain("\"'=web\"");
  });

  it("validación y permisos", async () => {
    expect((await get("/reports?from=2026-13-01&to=2026-10-01", READ)).status).toBe(400);
    expect((await get("/reports?from=2026-10-10&to=2026-10-01", READ)).status).toBe(400);
    expect((await get("/reports?from=2020-01-01&to=2026-10-01", READ)).status).toBe(400);
    expect((await get(`/reports/export?kind=contactos&from=2026-01-01&to=${today}`, READ)).status).toBe(400);
    expect((await get(`/reports?from=2026-01-01&to=${today}`, OTHER)).status).toBe(403);
    expect((await get(`/reports?from=2026-01-01&to=${today}`)).status).toBe(401);
  });
});

describe("periodos en hora de Madrid, también el día del cambio de hora", () => {
  const iso = (t: number) => new Date(t).toISOString();
  it("día normal: 00:00 de Madrid y 24 horas", () => {
    expect(iso(madridMidnight("2026-10-20"))).toBe("2026-10-19T22:00:00.000Z");
    const r = madridDayRange("2026-10-20", "2026-10-20");
    expect((r.to - r.from) / 3_600_000).toBe(24);
  });
  it("25/10/2026 (fin del horario de verano): empieza a las 22:00 UTC del 24 y dura 25 horas", () => {
    expect(iso(madridMidnight("2026-10-25"))).toBe("2026-10-24T22:00:00.000Z");
    const r = madridDayRange("2026-10-25", "2026-10-25");
    expect(iso(r.to)).toBe("2026-10-25T23:00:00.000Z");
    expect((r.to - r.from) / 3_600_000).toBe(25);
    // Un registro de las 00:30 de Madrid del día 25 (22:30 UTC del 24) está dentro
    const t = Date.parse("2026-10-24T22:30:00Z");
    expect(t >= r.from && t < r.to).toBe(true);
  });
  it("28/03/2027 (inicio del horario de verano): dura 23 horas", () => {
    expect(iso(madridMidnight("2027-03-28"))).toBe("2027-03-27T23:00:00.000Z");
    const r = madridDayRange("2027-03-28", "2027-03-28");
    expect((r.to - r.from) / 3_600_000).toBe(23);
  });
});
