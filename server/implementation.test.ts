/**
 * Implantación asistida (server/implementation): circuito completo con datos sintéticos en memoria — solicitud de la
 * web → contacto y oportunidad → expediente con responsable → propuesta con condiciones y plazo escritos por una
 * persona → aceptación (contrato firmado) → orden con hitos → preparada → habilitada → comunicada → prueba de 15 días
 * desde la comunicación (o suscripción pactada). Idempotencia y concurrencia de cada paso.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCrmStore } from "./crm/store";
import { CrmService } from "./crm/service";
import { WebRequestService } from "./crm/webRequests";
import { ImplementationService, ASSISTED_TRIAL_DAYS, DEFAULT_MILESTONES, requestedSolution, type AvailabilityNotice, type SolutionInfo } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { assistedImplementationEnabled } from "./implementation/config";
import { solutionFromWebStore } from "./implementation/ports";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9);
const SOLUTIONS: Record<string, SolutionInfo> = {
  "solucion-demo": { key: "solucion-demo", name: "Solución Demo", mode: "assisted", commercialStatus: "available" },
  "modulo-inmediato": { key: "modulo-inmediato", name: "Módulo inmediato", mode: "immediate", commercialStatus: "available" },
  "bajo-solicitud": { key: "bajo-solicitud", name: "Bajo solicitud", mode: null, commercialStatus: "on_request" },
};
const CONDITIONS = "Implantación acompañada en cuatro sesiones; precio del plan Essential sin recargos.";

describe("implantación asistida (memoria)", () => {
  let clock: number;
  let crmStore: MemoryCrmStore;
  let crm: CrmService;
  let web: WebRequestService;
  let store: MemoryImplementationStore;
  let svc: ImplementationService;
  let platformCalls: number;
  let starts: Array<{ trialDays: number; contractId: number }>;
  let notices: Array<{ to: string; n: AvailabilityNotice }>;

  beforeEach(() => {
    clock = T0;
    crmStore = new MemoryCrmStore();
    // La activación del contrato (al iniciar) reutiliza la plataforma ya creada: idempotente, sin invitar
    crm = new CrmService({ store: crmStore, activation: { activate: async ({ company }) => ({ tenantId: company.tenantId ?? "sin-plataforma" }) }, now: () => clock });
    web = new WebRequestService({ store: crmStore, crm, now: () => clock });
    store = new MemoryImplementationStore();
    platformCalls = 0;
    starts = [];
    notices = [];
    svc = new ImplementationService({
      store,
      crm,
      crmStore,
      solution: async (k) => SOLUTIONS[k] ?? null,
      platform: { activate: async ({ company }) => (platformCalls++, { tenantId: `t-${company.id}` }) },
      starter: { start: async (i) => (starts.push({ trialDays: i.trialDays, contractId: i.contract.id }), { subscriptionId: 100 + starts.length, trialEndsAt: i.trialDays ? clock + i.trialDays * DAY : null }) },
      notify: async (to, n) => (notices.push({ to, n }), { queued: true }),
      reissueInvite: async () => "token-de-prueba",
      platformDomain: "elephant.test",
      assignees: async () => [{ id: "laura", name: "Laura Demo" }],
      markAttended: (id, actor) => web.setStatus(id, "attended", actor),
      now: () => clock,
    });
  });

  const intake = async (interest: string, email = "ana@cliente-demo.example") =>
    (await web.receive({ type: "module_info", name: "Ana Demo", email, company: "Cliente Demo SL", interest, marketingConsent: false, privacyVersion: "v1" }, { idempotencyKey: `k-${email}-${interest}`, ipHash: null })).request;

  async function toAccepted(startMode: "trial" | "subscription" = "trial") {
    const r = await intake("solucion-demo");
    const o = (await svc.fromIntake(r))!;
    await svc.prepareProposal(o.id, { conditions: CONDITIONS, timeline: "Cuatro semanas desde la reunión de arranque", startMode, planId: "essential" }, "operator:laura");
    const contractId = (await store.get(o.id))!.contractId!;
    await crm.setContractStatus(contractId, "sent", "operator:laura");
    await crm.setContractStatus(contractId, "signed", "operator:laura", { signatureRef: "firma-demo-1" });
    await svc.syncAcceptance(o.id, "operator:laura");
    return (await store.get(o.id))!;
  }
  async function completeMilestones(id: number) {
    for (const m of await store.milestones(id)) await svc.setMilestoneDone(id, m.id, true, "operator:laura");
  }

  it("el interruptor está apagado por defecto", () => {
    expect(assistedImplementationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(assistedImplementationEnabled({ CP_ASSISTED_IMPLEMENTATION_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(assistedImplementationEnabled({ CP_ASSISTED_IMPLEMENTATION_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("1-5: la solicitud de una solución asistida crea contacto, oportunidad y expediente en la cola, una sola vez", async () => {
    const r = await intake("solucion-demo");
    const o = (await svc.fromIntake(r))!;
    expect(o).toMatchObject({ status: "requested", solutionKey: "solucion-demo", solutionName: "Solución Demo", queue: "implantacion", leadRequestId: r.id });
    const lead = (await crmStore.get("leads", r.leadId))!;
    expect(lead.status).toBe("converted");
    expect(o.companyId).toBe(lead.convertedCompanyId);
    expect(o.opportunityId).toBe(lead.convertedOpportunityId);
    expect((await crmStore.list("contacts", { companyId: o.companyId })).map((c) => c.email)).toEqual(["ana@cliente-demo.example"]);
    expect((await crmStore.get("leadRequests", r.id))!.status).toBe("attended");
    // Repetir (intake o apertura manual) no duplica nada
    expect((await svc.fromIntake(r))!.id).toBe(o.id);
    expect(await svc.open({ leadRequestId: r.id }, "operator:laura")).toMatchObject({ created: false, order: { id: o.id } });
    expect(store.rows).toHaveLength(1);
    expect((await crmStore.list("opportunities", {})).length).toBe(1);
    // Responsable: solo operadores válidos
    await expect(svc.assign(o.id, { assigneeId: "desconocido" }, "operator:x")).rejects.toThrow(/responsable/);
    expect(await svc.assign(o.id, { assigneeId: "laura" }, "operator:x")).toMatchObject({ assigneeId: "laura", assigneeName: "Laura Demo" });
  });

  it("la solicitud de algo inmediato (o de otro tipo) no abre expediente; «bajo solicitud» sin modalidad, sí", async () => {
    expect(await svc.fromIntake(await intake("modulo-inmediato", "b@demo.example"))).toBeNull();
    expect(await svc.fromIntake(await intake("no-existe", "c@demo.example"))).toBeNull();
    expect((await svc.fromIntake(await intake("bajo-solicitud", "d@demo.example")))?.solutionKey).toBe("bajo-solicitud");
    expect(requestedSolution({ interest: null, configuration: { plan: "essential", extensions: ["ext-a"], industries: ["hotel"], interests: [] } })).toBe("hotel");
  });

  it("6-9: propuesta con condiciones y plazo de una persona; la aceptación se comprueba en el contrato y abre la orden", async () => {
    const r = await intake("solucion-demo");
    const o = (await svc.fromIntake(r))!;
    await expect(svc.prepareProposal(o.id, { conditions: "corto", timeline: "4 semanas", startMode: "trial", planId: "essential" }, "operator:laura")).rejects.toThrow(/condiciones/);
    await expect(svc.prepareProposal(o.id, { conditions: CONDITIONS, timeline: "", startMode: "trial", planId: "essential" }, "operator:laura")).rejects.toThrow(/plazo/);
    const p = await svc.prepareProposal(o.id, { conditions: CONDITIONS, timeline: "Cuatro semanas", startMode: "trial", planId: "essential" }, "operator:laura");
    expect(p).toMatchObject({ status: "proposal", timeline: "Cuatro semanas", targetDate: null, startMode: "trial", termsBy: "operator:laura" });
    const contract = (await crmStore.get("contracts", p.contractId!))!;
    expect(contract).toMatchObject({ status: "draft", conditions: CONDITIONS, planId: "essential", opportunityId: o.opportunityId });
    expect((await crmStore.get("opportunities", o.opportunityId!))!.stage).toBe("proposal");
    // Rehacer la propuesta reutiliza el mismo contrato (nueva versión de sus condiciones)
    const p2 = await svc.prepareProposal(o.id, { conditions: `${CONDITIONS} Incluye formación.`, timeline: "Cinco semanas", startMode: "trial" }, "operator:laura");
    expect(p2.contractId).toBe(p.contractId);
    expect((await crmStore.list("contracts", {})).length).toBe(1);
    // Sin firma no hay aceptación ni hitos
    expect((await svc.syncAcceptance(o.id, "operator:laura")).accepted).toBe(false);
    expect(await store.milestones(o.id)).toHaveLength(0);
    await crm.setContractStatus(p.contractId!, "sent", "operator:laura");
    await crm.setContractStatus(p.contractId!, "signed", "operator:laura", { signatureRef: "firma-1" });
    const [a, b] = await Promise.all([svc.syncAcceptance(o.id, "operator:laura"), svc.syncAcceptance(o.id, "operator:laura")]);
    expect(a.accepted && b.accepted).toBe(true);
    expect((await svc.syncAcceptance(o.id, "operator:laura")).order.status).toBe("accepted");
    expect((await store.milestones(o.id)).map((m) => m.title)).toEqual(DEFAULT_MILESTONES.map((m) => m.title));
    expect(store.eventRows.filter((e) => e.type === "accepted")).toHaveLength(1);
    expect((await crmStore.get("opportunities", o.opportunityId!))!.stage).toBe("won");
    await expect(svc.prepareProposal(o.id, { conditions: CONDITIONS, timeline: "x semanas", startMode: "trial" }, "operator:laura")).rejects.toThrow(/ya no se cambia/);
  });

  it("10-12: hitos y pendientes; «preparada» exige los obligatorios y confirmarla dos veces no duplica", async () => {
    const o = await toAccepted();
    const extra = await svc.addMilestone(o.id, { title: "Certificado del dominio propio", kind: "pending", required: false, dueAt: T0 + 10 * DAY }, "operator:laura");
    expect(extra).toMatchObject({ kind: "pending", required: false, dueAt: T0 + 10 * DAY, status: "open" });
    await expect(svc.markReady(o.id, {}, "operator:laura")).rejects.toThrow(/Faltan hitos obligatorios/);
    await completeMilestones(o.id);
    await svc.setMilestoneDone(o.id, extra.id, false, "operator:laura");
    const [r1, r2] = await Promise.all([svc.markReady(o.id, { note: "Validado con el cliente" }, "operator:laura"), svc.markReady(o.id, {}, "operator:laura")]);
    expect(r1.status).toBe("ready");
    expect(r2.status).toBe("ready");
    expect((await svc.markReady(o.id, {}, "operator:laura")).version).toBe(r1.version);
    expect(store.eventRows.filter((e) => e.type === "ready")).toHaveLength(1);
    await expect(svc.addMilestone(o.id, { title: "Otro hito" }, "operator:laura")).rejects.toThrow(/no se cambian/);
  });

  it("13-15: habilitar, comunicar e iniciar la prueba de 15 días DESDE la comunicación; todo idempotente", async () => {
    const o = await toAccepted("trial");
    await completeMilestones(o.id);
    await svc.markReady(o.id, {}, "operator:laura");
    await expect(svc.communicate(o.id, "operator:laura")).rejects.toThrow(/habilita/);
    const [e1, e2] = await Promise.all([svc.enable(o.id, "operator:laura"), svc.enable(o.id, "operator:laura")]);
    expect(e1.status).toBe("enabled");
    expect(e2.tenantId).toBe(e1.tenantId);
    await svc.enable(o.id, "operator:laura");
    expect(platformCalls).toBe(1);
    expect((await crmStore.get("companies", o.companyId))!.tenantId).toBe(e1.tenantId);
    // Pasa tiempo entre habilitar y comunicar: la prueba aún no ha empezado
    clock += 9 * DAY;
    expect((await store.get(o.id))!.trialEndsAt).toBeNull();
    expect(starts).toHaveLength(0);
    const communicatedAt = clock;
    const [c1] = await Promise.all([svc.communicate(o.id, "operator:laura"), svc.communicate(o.id, "operator:laura")]);
    expect(c1.status).toBe("started");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: "ana@cliente-demo.example", n: { startMode: "trial", inviteToken: "token-de-prueba", domain: `${e1.tenantId}.elephant.test`, trialEndsAt: communicatedAt + ASSISTED_TRIAL_DAYS * DAY } });
    expect(starts).toEqual([{ trialDays: ASSISTED_TRIAL_DAYS, contractId: o.contractId! }]);
    const done = (await store.get(o.id))!;
    expect(done).toMatchObject({ status: "started", communicatedAt, trialEndsAt: communicatedAt + ASSISTED_TRIAL_DAYS * DAY, subscriptionId: 101 });
    expect((await crmStore.get("contracts", o.contractId!))!.status).toBe("active");
    // Repetir comunicar o iniciar no vuelve a avisar ni a crear suscripciones
    await svc.communicate(o.id, "operator:laura");
    await svc.start(o.id, "operator:laura");
    expect(notices).toHaveLength(1);
    expect(starts).toHaveLength(1);
    expect(store.eventRows.filter((e) => ["enabled", "communicated", "started"].includes(e.type)).map((e) => e.type)).toEqual(["enabled", "communicated", "started"]);
    await expect(svc.cancel(o.id, { reason: "Ya no lo quiere" }, "operator:laura")).rejects.toThrow(/iniciada/);
  });

  it("suscripción pactada: sin días de prueba; un fallo al iniciar se reintenta sin volver a comunicar", async () => {
    const o = await toAccepted("subscription");
    await completeMilestones(o.id);
    await svc.markReady(o.id, {}, "operator:laura");
    await svc.enable(o.id, "operator:laura");
    let fail = true;
    const starter = { start: async (i: { trialDays: number; contract: { id: number } }) => {
      if (fail) throw new Error("catálogo sin precio");
      starts.push({ trialDays: i.trialDays, contractId: i.contract.id });
      return { subscriptionId: 7, trialEndsAt: null };
    } };
    (svc as unknown as { d: { starter: unknown } }).d.starter = starter;
    await expect(svc.communicate(o.id, "operator:laura")).rejects.toThrow(/iniciar/);
    expect((await store.get(o.id))!).toMatchObject({ status: "available", trialEndsAt: null });
    expect((await store.get(o.id))!.lastError).toMatch(/catálogo sin precio/);
    fail = false;
    expect((await svc.start(o.id, "operator:laura")).status).toBe("started");
    expect(starts).toEqual([{ trialDays: 0, contractId: o.contractId! }]);
    expect(notices).toHaveLength(1);
  });

  it("desde una oportunidad existente: un expediente abierto por empresa y solución; cancelar lo cierra", async () => {
    const company = await crm.createCompany({ name: "Otra Empresa SL" }, "operator:x");
    const opp = await crm.createOpportunity({ companyId: company.id, title: "Interés", planId: "essential" }, "operator:x");
    await expect(svc.open({ opportunityId: opp.id }, "operator:x")).rejects.toThrow(/solución/);
    const a = await svc.open({ opportunityId: opp.id, solutionKey: "solucion-demo", assigneeId: "laura" }, "operator:x");
    expect(a).toMatchObject({ created: true, order: { assigneeId: "laura", queue: null } });
    expect((await svc.open({ opportunityId: opp.id, solutionKey: "solucion-demo" }, "operator:x")).created).toBe(false);
    await svc.cancel(a.order.id, { reason: "El cliente lo pospone" }, "operator:x");
    expect((await svc.open({ opportunityId: opp.id, solutionKey: "solucion-demo" }, "operator:x")).created).toBe(true);
  });

  it("la solución se lee del catálogo publicado con su modalidad EFECTIVA (la que ve la web)", async () => {
    const entry = (published: unknown, prices: unknown[] = []) => ({ getEntry: async () => ({ id: 7, kind: "product", publication: "published", published }) as never, listPrices: async () => prices as never });
    expect(await solutionFromWebStore(entry({ name: "Hotel", catalog: { commercialStatus: "on_request" } }))("hotel")).toEqual({ key: "hotel", name: "Hotel", mode: "assisted", commercialStatus: "on_request" });
    expect((await solutionFromWebStore(entry({ name: "Hotel", catalog: { offer: { modality: "assisted" } } }))("hotel"))?.mode).toBe("assisted");
    // Regresión 31/10/2026: sin `catalog.offer` y en un estado que no es «on_request», la web lo ofrece asistido y el expediente se abría a null
    expect((await solutionFromWebStore(entry({ name: "Connect Tax", technicalStatus: "partial", catalog: { commercialStatus: "planned" } }))("connect-tax"))?.mode).toBe("assisted");
    // Inmediata configurada pero no entregable (técnico parcial): asistida, como en la web
    expect((await solutionFromWebStore(entry({ name: "X", technicalStatus: "partial", catalog: { commercialStatus: "available", offer: { modality: "immediate", trial: true } } }))("x"))?.mode).toBe("assisted");
    // Inmediata entregable: se queda en inmediata (el autoservicio no abre expediente)
    const live = { name: "Y", technicalStatus: "available", catalog: { commercialStatus: "available", offer: { modality: "immediate", checkout: true } } };
    expect((await solutionFromWebStore(entry(live, [{ status: "approved" }]))("y"))?.mode).toBe("immediate");
    expect((await solutionFromWebStore(entry(live, [{ status: "draft" }]))("y"))?.mode).toBe("assisted");
    expect(await solutionFromWebStore({ getEntry: async () => null })("x")).toBeNull();
  });
});
