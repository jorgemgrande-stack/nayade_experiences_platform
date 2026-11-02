/**
 * Embudo de ventas configurable (Business, crm-funnel-advanced) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0021).
 * Essential no llega al embudo y conserva lo de siempre; con Business, administración configura y el equipo comercial
 * mueve; cada empresa solo ve sus etapas y sus oportunidades.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "crm-funnel-advanced";

describe.skipIf(!URL_)("Embudo configurable (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let agA: string;
  let adA: string;
  let agB: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "embudo");
    agA = await ess.login("a", "agente");
    adA = await ess.login("a", "admin");
    agB = await ess.login("b", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("Essential: sin acceso al embudo configurable; oportunidades y resumen de siempre intactos", async () => {
    const lead = data(await ess.m("a", "crm.leads.create", { name: "Lead Essential", email: "essential@cliente-a.example" }, agA)).id;
    expect(isLicenseDenied(await ess.q("a", "crmFunnel.board", undefined, agA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.q("a", "crmFunnel.board", undefined, adA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "crmFunnel.createStage", { name: "X", probability: 10, kind: "abierta", color: "gris" }, adA), CAP)).toBe(true);
    const sum = await ess.q("a", "crm.pipeline.summary", undefined, agA);
    expect(sum.status).toBe(200);
    expect(data(sum).leads).toEqual(expect.arrayContaining([expect.objectContaining({ status: "nueva" })]));
    expect(data(await ess.q("a", "crm.leads.list", { opportunityStatus: "nueva" }, agA)).rows.map((l: any) => l.id)).toContain(lead);
    // Nada del embudo se ha creado en la empresa
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_funnel_stages"))[0].n).toBe(0);
  });

  it("Business: etapas por defecto, configuración solo de administración, mover con motivo de pérdida y previsión", async () => {
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    const l1 = data(await ess.m("a", "crm.leads.create", { name: "Lead Uno", email: "uno@cliente-a.example" }, agA)).id;
    const l2 = data(await ess.m("a", "crm.leads.create", { name: "Lead Dos", email: "dos@cliente-a.example" }, agA)).id;
    await ess.sql("a", "UPDATE leads SET budget = 1000 WHERE id = ?", [l1]);
    await ess.sql("a", "UPDATE leads SET budget = 2000 WHERE id = ?", [l2]);
    // Flujo de siempre: marcar como perdida (sin pasar por el embudo)
    const lost = data(await ess.m("a", "crm.leads.create", { name: "Lead Perdido", email: "perdido@cliente-a.example" }, agA)).id;
    expect((await ess.m("a", "crm.leads.markLost", { id: lost, reason: "Precio" }, agA)).status).toBe(200);

    const b0 = data(await ess.q("a", "crmFunnel.board", undefined, agA));
    expect(b0.stages.map((s: any) => s.name)).toEqual(["Nueva", "Propuesta enviada", "Ganada", "Perdida"]);
    const st = (b: any, name: string) => b.stages.find((s: any) => s.name === name);
    const card = (b: any, id: number) => b.cards.find((c: any) => c.id === id);
    // Lo existente cae en la etapa de su estado, sin migrar datos
    expect(card(b0, l1).stageId).toBe(st(b0, "Nueva").id);
    expect(card(b0, lost).stageId).toBe(st(b0, "Perdida").id);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_lead_stages"))[0].n).toBe(0);

    // Configurar: administración sí, comercial no
    expect(errCode(await ess.m("a", "crmFunnel.createStage", { name: "Negociación", probability: 70, kind: "abierta", color: "ambar" }, agA))).toBe("FORBIDDEN");
    const neg = await ess.m("a", "crmFunnel.createStage", { name: "Negociación", probability: 70, kind: "abierta", color: "ambar" }, adA);
    expect(neg.status).toBe(200);
    const negId = data(neg).id;
    expect(errCode(await ess.m("a", "crmFunnel.createStage", { name: "negociación", probability: 70, kind: "abierta", color: "ambar" }, adA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "crmFunnel.createStage", { name: "Mal", probability: 50, kind: "ganada", color: "verde" }, adA))).toBe("BAD_REQUEST");
    // Siempre queda una etapa ganada
    expect(errCode(await ess.m("a", "crmFunnel.removeStage", { id: st(b0, "Ganada").id }, adA))).toBe("BAD_REQUEST");

    // Mover (comercial): a Negociación; a Perdida exige motivo
    expect((await ess.m("a", "crmFunnel.moveLead", { leadId: l1, stageId: negId }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT opportunityStatus FROM leads WHERE id = ?", [l1]))[0].opportunityStatus).toBe("nueva");
    expect(errCode(await ess.m("a", "crmFunnel.moveLead", { leadId: l2, stageId: st(b0, "Perdida").id }, agA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "crmFunnel.moveLead", { leadId: l2, stageId: st(b0, "Perdida").id, lostReason: "Sin presupuesto" }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT opportunityStatus, status, lostReason FROM leads WHERE id = ?", [l2]))[0]).toEqual({ opportunityStatus: "perdida", status: "perdido", lostReason: "Sin presupuesto" });
    const log = await ess.sql("a", "SELECT action FROM crm_activity_log WHERE entityType = 'lead' AND entityId = ? ORDER BY id", [l2]);
    expect(log.map((r: any) => r.action)).toContain("stage_changed");

    const b1 = data(await ess.q("a", "crmFunnel.board", undefined, agA));
    expect(card(b1, l1)).toMatchObject({ stageId: negId, amount: 1000, probability: 70 });
    const fNeg = b1.forecast.stages.find((f: any) => f.stageId === negId);
    expect(fNeg).toMatchObject({ count: 1, amount: 1000, weighted: 700 });
    expect(b1.forecast.weightedTotal).toBe(700);

    // Un flujo de siempre que cierra la oportunidad manda sobre la etapa elegida
    await ess.sql("a", "UPDATE leads SET opportunityStatus = 'ganada' WHERE id = ?", [l1]);
    const b2 = data(await ess.q("a", "crmFunnel.board", undefined, agA));
    expect(card(b2, l1).stageId).toBe(st(b2, "Ganada").id);
    expect(b2.forecast.wonAmount).toBe(1000);

    // Quitar una etapa con oportunidades: vuelven a la de su estado
    await ess.sql("a", "UPDATE leads SET opportunityStatus = 'enviada' WHERE id = ?", [l1]);
    const rm = await ess.m("a", "crmFunnel.removeStage", { id: negId }, adA);
    expect(data(rm).released).toBe(1);
    expect(card(data(await ess.q("a", "crmFunnel.board", undefined, agA)), l1).stageId).toBe(st(b2, "Propuesta enviada").id);

    // Empresa B: sus etapas por defecto, ninguna oportunidad ni etapa de A
    const bB = data(await ess.q("b", "crmFunnel.board", undefined, agB));
    expect(bB.stages.map((s: any) => s.name)).toEqual(["Nueva", "Propuesta enviada", "Ganada", "Perdida"]);
    expect(bB.cards).toEqual([]);
    expect(errCode(await ess.m("b", "crmFunnel.moveLead", { leadId: l1, stageId: bB.stages[0].id }, agB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM crm_lead_stages"))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM crm_funnel_stages WHERE name = 'Negociación'"))[0].n).toBe(0);

    // Licencia en solo lectura: se consulta, no se mueve
    const lic = await licenseMatrix(ess, CAP, {
      query: () => ess.q("a", "crmFunnel.board", undefined, agA),
      mutation: () => ess.m("a", "crmFunnel.moveLead", { leadId: l1, stageId: st(b2, "Nueva").id }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, CAP)).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, CAP)).toBe(true);
  });
});
