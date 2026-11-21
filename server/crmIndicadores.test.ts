/**
 * Fase comercial 1I: los indicadores del panel y los listados de destino usan el MISMO criterio (focus.ts), y los
 * informes separan la actividad de personas de la de procesos automáticos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { activityOrigin } from "./crm/focus";
import { crmReports } from "./crm/reports";

const DAY = 86_400_000;
let store: MemoryCrmStore;
let crm: CrmService;
let now = Date.UTC(2026, 10, 21, 12);

beforeEach(() => {
  store = new MemoryCrmStore();
  now = Date.UTC(2026, 10, 21, 12);
  let n = 0;
  crm = new CrmService({ store, now: () => now, activation: { activate: async () => ({ tenantId: `t${++n}-demo` }) } });
});

async function seed() {
  // Leads: 2 en curso sin responsable, 1 con responsable, 1 descartado sin responsable, 1 archivado sin responsable
  await crm.createLead({ name: "A sin dueño", email: "a@x.example" }, "ana");
  await crm.createLead({ name: "B sin dueño", email: "b@x.example" }, "ana");
  await crm.createLead({ name: "C con dueño", email: "c@x.example", owner: "Laura" }, "ana");
  const d = await crm.createLead({ name: "D descartado", email: "d@x.example" }, "ana");
  await crm.setLeadStatus(d.id, "disqualified", "ana");
  const e = await crm.createLead({ name: "E archivado", email: "e@x.example" }, "ana");
  await crm.archiveLead(e.id, "duplicado", "ana");

  const co = await crm.createCompany({ name: "Hotel Uno" }, "ana");
  const co2 = await crm.createCompany({ name: "Hotel Dos" }, "ana");
  await crm.createContact(co.id, { name: "Ana Gómez", email: "ana@hotel.example", isPrimary: true }, "ana");
  // Oportunidades: vencida, sin próxima acción, con acción futura y una ganada
  await crm.createOpportunity({ companyId: co.id, title: "Vencida", nextActionAt: now - DAY }, "ana");
  await crm.createOpportunity({ companyId: co.id, title: "Sin acción" }, "ana");
  await crm.createOpportunity({ companyId: co2.id, title: "Futura", nextActionAt: now + 3 * DAY }, "ana");
  const w = await crm.createOpportunity({ companyId: co2.id, title: "Ganada" }, "ana");
  await crm.moveStage(w.id, "negotiation", "ana");
  await crm.moveStage(w.id, "won", "ana");
  // Contratos: borrador, enviado, firmado, activo con renovación pasada, activo con renovación lejana
  const mk = async (renewalDate: number | null) => crm.createContract({ companyId: co.id, planId: "essential", amountCents: 1000, currency: "EUR", renewalDate }, "ana");
  await mk(null);
  const sent = await mk(null);
  await crm.setContractStatus(sent.id, "sent", "ana");
  const signed = await mk(null);
  await crm.setContractStatus(signed.id, "sent", "ana");
  await crm.setContractStatus(signed.id, "signed", "ana", { signatureRef: "x" });
  const past = await mk(now - 5 * DAY);
  for (const st of ["sent", "signed", "active"] as const) await crm.setContractStatus(past.id, st, "ana", st === "signed" ? { signatureRef: "x" } : {});
  const far = await mk(now + 200 * DAY);
  for (const st of ["sent", "signed", "active"] as const) await crm.setContractStatus(far.id, st, "ana", st === "signed" ? { signatureRef: "x" } : {});
}

describe("paridad panel ↔ listado (mismo criterio)", () => {
  it("cada indicador coincide con el total del listado filtrado", async () => {
    await seed();
    const { metrics: m } = await crm.dashboard();
    expect((await crm.listLeads({ focus: "active" })).total).toBe(m.activeLeads);
    expect((await crm.listLeads({ focus: "unowned" })).total).toBe(m.unownedLeads);
    expect((await crm.listOpportunities({ focus: "open" })).total).toBe(m.openOpportunities);
    expect((await crm.listOpportunities({ focus: "overdue-next-action" })).total).toBe(m.overdueNextActions);
    expect((await crm.listOpportunities({ focus: "no-next-action" })).total).toBe(m.opportunitiesWithoutNextAction);
    expect((await crm.listContracts({ focus: "to-sign" })).total).toBe(m.pendingContracts.draft + m.pendingContracts.sent);
    expect((await crm.listContracts({ focus: "signed" })).total).toBe(m.pendingContracts.signed);
    expect((await crm.listContracts({ focus: "renewals" })).total).toBe(m.renewalsNext30Days);
    expect((await crm.listCompanies({ focus: "customers" })).total).toBe(m.activeCustomers);
    expect((await crm.listCompanies({ focus: "platform-only" })).total).toBe(m.platformWithoutContract);
    expect((await crm.listCompanies({ focus: "prospects" })).total).toBe(m.prospects);
  });

  it("valores concretos: se excluyen archivados y descartados; las renovaciones incluyen fechas pasadas", async () => {
    await seed();
    const { metrics: m } = await crm.dashboard();
    expect(m).toMatchObject({ activeLeads: 3, unownedLeads: 2, openOpportunities: 3, overdueNextActions: 1, opportunitiesWithoutNextAction: 1, renewalsNext30Days: 1 });
    expect(m.pendingContracts).toEqual({ draft: 1, sent: 1, signed: 1 });
    const unowned = (await crm.listLeads({ focus: "unowned" })).items.map((l) => l.name).sort();
    expect(unowned).toEqual(["A sin dueño", "B sin dueño"]);
    const ren = (await crm.listContracts({ focus: "renewals" })).items;
    expect(ren).toHaveLength(1);
    expect(ren[0].renewalDate).toBeLessThan(now);
    expect((await crm.listOpportunities({ focus: "overdue-next-action" })).items.map((o) => o.title)).toEqual(["Vencida"]);
    expect((await crm.listOpportunities({ focus: "no-next-action" })).items.map((o) => o.title)).toEqual(["Sin acción"]);
  });

  it("sin focus los listados no cambian (compatibilidad)", async () => {
    await seed();
    expect((await crm.listLeads({})).total).toBe(4); // sin archivados
    expect((await crm.listOpportunities({})).total).toBe(4);
    expect((await crm.listContracts({})).total).toBe(5);
  });
});

describe("clasificación del origen de los eventos", () => {
  it("personas, procesos y sin clasificar", () => {
    expect(activityOrigin("operator:laura")).toBe("human");
    expect(activityOrigin("user:12")).toBe("human");
    for (const a of ["system:trial", "system:stripe", "system:lead-notices", "public:acceptance", "public:link:7", "web:public", "panel:suscripcion", "operacion:fichas", "catalogo:especificaciones-comerciales"]) {
      expect(activityOrigin(a)).toBe("automatic");
    }
    for (const a of ["Laura", "", null, undefined, "raro:algo", "x"]) expect(activityOrigin(a as string)).toBe("unknown");
  });

  it("el informe no atribuye procesos automáticos a ninguna persona y conserva la trazabilidad", () => {
    const D = (iso: string) => Date.parse(iso);
    const act = (id: number, author: string, kind = "note") => ({ id, entityType: "lead", entityId: 1, kind, summary: `evento ${id}`, dueAt: null, doneAt: null, author, assignee: null, priority: "normal", createdAt: D("2026-10-10T10:00:00Z") + id }) as never;
    const r = crmReports(
      { leads: [], opportunities: [], companies: [], contacts: [], activities: [act(1, "operator:laura", "call"), act(2, "system:trial"), act(3, "public:link:4"), act(4, "web:public"), act(5, "Laura"), act(6, "operator:laura", "meeting")] },
      { from: D("2026-10-01T00:00:00Z"), to: D("2026-11-01T00:00:00Z"), now: D("2026-11-21T00:00:00Z") },
    );
    expect(Object.keys(r.activityByPerson).filter((k) => /^(system|public|web|panel):/.test(k))).toEqual([]);
    expect(r.activityByPerson["operator:laura"].activities).toBe(2);
    expect(r.activityByPerson["Laura"]?.activities ?? 0).toBe(0);
    const s = r.activityStream;
    expect(s.total).toBe(6);
    expect(s.byOrigin).toEqual({ human: 2, automatic: 3, unknown: 1 });
    expect(s.byOrigin.human + s.byOrigin.automatic + s.byOrigin.unknown).toBe(s.total);
    expect(s.events).toHaveLength(6);
    expect(s.events.find((e) => e.author === "Laura")?.origin).toBe("unknown");
    expect(s.byAuthor["system:trial"]).toEqual({ origin: "automatic", count: 1 });
    expect(s.truncated).toBe(false);
  });

  it("la lista del flujo se recorta a 200 pero los recuentos son completos", () => {
    const D = Date.parse("2026-10-10T10:00:00Z");
    const many = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, entityType: "lead", entityId: 1, kind: "note", summary: "x", dueAt: null, doneAt: null, author: "system:trial", assignee: null, priority: "normal", createdAt: D + i }) as never);
    const r = crmReports({ leads: [], opportunities: [], companies: [], contacts: [], activities: many }, { from: D - 1000, to: D + 1_000_000, now: D + 2_000_000 });
    expect(r.activityStream.total).toBe(250);
    expect(r.activityStream.events).toHaveLength(200);
    expect(r.activityStream.truncated).toBe(true);
  });
});

describe("indicadores de los informes: mismo criterio que sus listados", () => {
  it("sin tocar (leads) y oportunidades sin responsable", async () => {
    const l = await crm.createLead({ name: "Viejo", email: "v@x.example" }, "ana");
    now += 10 * DAY;
    await crm.createLead({ name: "Reciente", email: "r@x.example" }, "ana");
    const co = await crm.createCompany({ name: "Hotel" }, "ana");
    await crm.createOpportunity({ companyId: co.id, title: "Sin dueño", owner: null }, "ana");
    const stale = (await crm.listLeads({ focus: "untouched" })).items;
    expect(stale.map((x) => x.id)).toEqual([l.id]);
    const opps = await crm.listOpportunities({ focus: "no-owner" });
    const rep = crmReports(
      { leads: (await crm.listLeads({ archived: "all" })).items, opportunities: (await crm.listOpportunities({})).items, companies: [], contacts: [], activities: [] },
      { from: now - 30 * DAY, to: now + DAY, now },
    );
    expect(rep.followUps.untouchedLeads).toBe(stale.length);
    expect(rep.quality.openOpportunitiesWithoutOwner).toBe(opps.total);
  });
});

describe("estados de empresa: grupos exclusivos que suman", () => {
  it("una plataforma sin contrato (prueba) no cuenta como cliente contratado", async () => {
    await seed();
    // Empresa con plataforma pero sin contrato ni venta: caso de una prueba gratuita
    const trial = await crm.createCompany({ name: "Selena" }, "ana");
    await store.update("companies", trial.id, { tenantId: "t15-selena" });
    const { metrics: m } = await crm.dashboard();
    const all = (await crm.listCompanies({ status: "active" })).total;
    expect(m.activeCustomers + m.platformWithoutContract + m.prospects).toBe(all);
    expect(m.platformWithoutContract).toBe(1);
    const names = (await crm.listCompanies({ focus: "platform-only" })).items.map((c) => c.name);
    expect(names).toEqual(["Selena"]);
    expect((await crm.listCompanies({ focus: "customers" })).items.map((c) => c.name)).not.toContain("Selena");
    const sel = (await crm.listCompanies({ q: "Selena" })).items[0];
    expect(sel).toMatchObject({ lifecycle: "tenant", contracted: false });
  });
});
