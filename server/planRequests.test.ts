/**
 * Solicitudes de plan desde Suscripción: oportunidad del CRM central con origen «Suscripción — Elephant Core», sin
 * duplicados, aisladas por empresa y sin tocar nada de la suscripción; sin ficha de empresa, solicitud web.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { listPlanRequests, PLAN_REQUEST_ORIGIN, PLAN_REQUEST_SOURCE, receivePlanRequest, type PlanRequestBody } from "./commerce/planRequests";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import type { LeadRequest } from "./crm/types";

const NOW = Date.UTC(2026, 10, 2, 18);
let site: SiteDocument;

beforeAll(async () => {
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  site = await web.site("published");
});

async function setup() {
  const store = new MemoryCrmStore();
  const crm = new CrmService({ store, now: () => NOW });
  const created: LeadRequest[] = [];
  const requests = new WebRequestService({ store, crm, now: () => NOW, onCreated: (r) => void created.push(r) });
  for (const [name, tenantId] of [["Escuela Demo", "t9-demo"], ["Otra Empresa", "t9-otra"]] as const) {
    const c = await crm.createCompany({ name, legalName: `${name} SL` }, "operator:test");
    await store.update("companies", c.id, { tenantId });
  }
  return { store, crm, requests, created, d: { site, crm, store, requests, now: () => NOW } };
}

const body = (over: Partial<PlanRequestBody> = {}): PlanRequestBody => ({
  plan: "enterprise",
  kind: "upgrade",
  currentPlan: "essential",
  trial: false,
  requester: { name: "Laura Demo", email: "laura@demo.example", userId: "7" },
  idempotencyKey: "pl-clave-0001",
  ...over,
});

describe("solicitudes de plan desde Suscripción", () => {
  it("crea una oportunidad de la empresa con el plan, el origen y el detalle completo; no toca suscripciones ni pedidos", async () => {
    const t = await setup();
    const r = await receivePlanRequest(t.d, "t9-demo", body({ message: "Somos 30 personas" }));
    expect(r.outcome).toBe("created");
    expect(r.request).toMatchObject({ plan: "enterprise", planName: "Enterprise", status: "received" });
    expect(r.request.reference).toMatch(/^OP-\d+$/);
    const [opp] = await t.store.list("opportunities", {}, {});
    const company = (await t.store.list("companies", {}, {})).find((c) => c.tenantId === "t9-demo")!;
    expect(opp).toMatchObject({ companyId: company.id, planId: "enterprise", stage: "prospecting" });
    expect(opp.title).toBe(`${PLAN_REQUEST_ORIGIN}: Ampliación de Enterprise`);
    expect(opp.nextAction).toMatch(/Laura Demo \(laura@demo\.example\)/);
    const notes = (await t.store.list("activities", { entityType: "opportunity", entityId: opp.id }, {})).map((a) => a.summary).join("\n");
    expect(notes).toMatch(/Escuela Demo \(plataforma t9-demo\)/);
    expect(notes).toMatch(/Plan actual: Essential\. Plan solicitado: Enterprise\./);
    expect(notes).toMatch(/Laura Demo <laura@demo\.example> \(usuario 7\)/);
    expect(notes).toMatch(/Fecha: 2026-11-02 18:00 UTC/);
    expect(notes).toMatch(/Somos 30 personas/);
    // Ni pedidos ni contratos ni solicitudes web: solo la oportunidad y sus notas
    expect(await t.store.list("contracts", {}, {})).toHaveLength(0);
    expect(t.created).toHaveLength(0);
  });

  it("sin duplicados: la misma petición (u otra para el mismo plan abierto) reutiliza la oportunidad y lo anota", async () => {
    const t = await setup();
    const a = await receivePlanRequest(t.d, "t9-demo", body());
    const [b, c] = await Promise.all([receivePlanRequest(t.d, "t9-demo", body()), receivePlanRequest(t.d, "t9-demo", body({ idempotencyKey: "pl-clave-0002", message: "Otra vez" }))]);
    expect([b.outcome, c.outcome]).toEqual(["duplicate", "duplicate"]);
    expect(b.request.reference).toBe(a.request.reference);
    expect(await t.store.list("opportunities", {}, {})).toHaveLength(1);
    // Cerrada la anterior, una nueva petición abre otra oportunidad
    const [opp] = await t.store.list("opportunities", {}, {});
    await t.store.update("opportunities", opp.id, { stage: "lost" });
    expect((await receivePlanRequest(t.d, "t9-demo", body())).outcome).toBe("created");
  });

  it("aislamiento: cada empresa ve solo sus solicitudes y con el estado traducido", async () => {
    const t = await setup();
    const a = await receivePlanRequest(t.d, "t9-demo", body());
    await receivePlanRequest(t.d, "t9-otra", body({ plan: "business", currentPlan: "essential" }));
    const mine = await listPlanRequests(t.d, "t9-demo");
    expect(mine.map((r) => r.reference)).toEqual([a.request.reference]);
    const id = Number(a.request.reference.slice(3));
    await t.store.update("opportunities", id, { stage: "proposal" });
    expect((await listPlanRequests(t.d, "t9-demo"))[0].status).toBe("in_progress");
    await t.store.update("opportunities", id, { stage: "won" });
    expect((await listPlanRequests(t.d, "t9-demo"))[0].status).toBe("completed");
    expect(await listPlanRequests(t.d, "t9-nadie")).toEqual([]);
  });

  it("prueba gratuita: contratación con «Prueba gratuita» como plan actual; el mismo plan de la prueba se puede pedir", async () => {
    const t = await setup();
    const r = await receivePlanRequest(t.d, "t9-demo", body({ plan: "essential", kind: "contract", currentPlan: "essential", trial: true }));
    expect(r.outcome).toBe("created");
    const [opp] = await t.store.list("opportunities", {}, {});
    expect(opp.title).toBe(`${PLAN_REQUEST_ORIGIN}: Contratación de Essential`);
    const notes = (await t.store.list("activities", { entityType: "opportunity", entityId: opp.id }, {})).map((a) => a.summary).join("\n");
    expect(notes).toMatch(/Plan actual: Prueba gratuita de Essential\./);
  });

  it("rechaza planes que no están en el catálogo, módulos y el plan que ya se tiene (fuera de la prueba)", async () => {
    const t = await setup();
    await expect(receivePlanRequest(t.d, "t9-demo", body({ plan: "no-existe" }))).rejects.toMatchObject({ status: 404 });
    await expect(receivePlanRequest(t.d, "t9-demo", body({ plan: "connect-people" }))).rejects.toMatchObject({ status: 404 });
    await expect(receivePlanRequest(t.d, "t9-demo", body({ plan: "essential", currentPlan: "essential" }))).rejects.toMatchObject({ status: 409 });
    expect(await t.store.list("opportunities", {}, {})).toHaveLength(0);
  });

  it("empresa sin ficha en el CRM: solicitud web con el plan en la configuración y el origen de Suscripción", async () => {
    const t = await setup();
    const r = await receivePlanRequest(t.d, "t9-sin-ficha", body({ plan: "business" }));
    expect(r.outcome).toBe("created");
    expect(r.request.reference).toMatch(/^SOL-/);
    await new Promise((x) => setImmediate(x));
    expect(t.created[0]).toMatchObject({ type: "configuration", sourcePage: PLAN_REQUEST_SOURCE, configuration: { plan: "business", extensions: [], industries: [], interests: [] } });
    expect(t.created[0].idempotencyKey.length).toBeLessThanOrEqual(36);
    expect((await receivePlanRequest(t.d, "t9-sin-ficha", body({ plan: "business" }))).outcome).toBe("replayed");
    expect(await t.store.list("opportunities", {}, {})).toHaveLength(0);
  });
});
