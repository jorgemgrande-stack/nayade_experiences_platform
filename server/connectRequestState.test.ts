/**
 * Estado de la solicitud comercial por producto en el catálogo del panel (17/11/2026): «Solicitud pendiente»,
 * «Pendiente de aceptación contractual» y «Pendiente de implantación», calculados con lo que hay de verdad en el CRM
 * y en los expedientes. Datos sintéticos en memoria.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelRequestStates, receivePanelRequest } from "./commerce/panelRequests";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import { ImplementationService } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { solutionFromWebStore } from "./implementation/ports";
import { buildConnectCatalog } from "./connectMarketplace";
import { SIM_CATALOG } from "./connectFichas.testkit";
import { parseConnectRequestState, stageOfImplementation } from "../shared/connectRequestState";

const NOW = Date.UTC(2026, 10, 17, 12);
const flush = () => new Promise((r) => setImmediate(r));
let site: SiteDocument;
let webStore: MemoryWebStore;

beforeAll(async () => {
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  site = await web.site("published");
});

describe("etapas", () => {
  it("expediente → etapa (cerrado o ya comunicado: sin etapa)", () => {
    expect(["requested", "proposal", "accepted", "ready", "enabled", "available", "started", "cancelled"].map(stageOfImplementation)).toEqual([
      "requested",
      "contract_pending",
      "implementation_pending",
      "implementation_pending",
      "implementation_pending",
      null,
      null,
      null,
    ]);
  });
  it("lectura defensiva", () => {
    expect(parseConnectRequestState({ stage: "requested", reference: "SOL-AB12" })).toEqual({ stage: "requested", reference: "SOL-AB12" });
    for (const bad of [null, "x", { stage: "otra", reference: "SOL-1" }, { stage: "requested", reference: "<script>" }, { stage: "requested" }]) expect(parseConnectRequestState(bad)).toBeNull();
  });
});

describe("panelRequestStates (plano de control)", () => {
  it("solicitud pendiente, expediente que avanza y aislamiento entre empresas; el «Me interesa» no cuenta", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const impl = new MemoryImplementationStore();
    const svc: ImplementationService = new ImplementationService({ store: impl, crm, crmStore: store, solution: solutionFromWebStore(webStore), now: () => NOW, markAttended: async (id, who) => void (await requests.setStatus(id, "attended", who)) });
    const requests: WebRequestService = new WebRequestService({ store, crm, now: () => NOW, onCreated: async (r) => void (await svc.fromIntake(r)) });
    for (const t of ["t1-uno", "t2-dos"]) {
      const c = await crm.createCompany({ name: `Empresa ${t}` }, "operator:test");
      await store.update("companies", c.id, { tenantId: t });
    }
    const d = { site, internal: false, requests, crm: store, implementations: impl };
    const who = { name: "Ana", email: "ana@uno.example" };
    await receivePanelRequest(d, "t1-uno", { type: "implementation", interest: "connect-whatsapp-ai", requester: who, idempotencyKey: "estado-0001" });
    await receivePanelRequest(d, "t1-uno", { type: "info", interest: "connect-people", requester: who, idempotencyKey: "estado-0002" });
    await flush();

    const one = await panelRequestStates({ crm: store, implementations: impl }, "t1-uno");
    expect(one.get("connect-whatsapp-ai")).toMatchObject({ stage: "requested", reference: impl.rows[0].reference });
    expect(one.get("connect-people")?.stage).toBe("requested");
    // Otra empresa: nada de la primera
    expect((await panelRequestStates({ crm: store, implementations: impl }, "t2-dos")).size).toBe(0);

    // El expediente avanza: propuesta → pendiente de aceptación; aceptado → pendiente de implantación; iniciado → nada
    const row = impl.rows[0];
    for (const [status, stage] of [["proposal", "contract_pending"], ["accepted", "implementation_pending"], ["started", undefined]] as const) {
      row.status = status;
      expect((await panelRequestStates({ crm: store, implementations: impl }, "t1-uno")).get("connect-whatsapp-ai")?.stage, status).toBe(stage);
    }
  });
});

describe("buildConnectCatalog (Core)", () => {
  it("la solicitud se muestra sobre lo no contratado; lo activo manda", () => {
    const keys = SIM_CATALOG.items.map((i) => i.key);
    const withReq = { items: SIM_CATALOG.items.map((i) => ({ ...i, request: { stage: "contract_pending", reference: "IMP-20261117-AB" } })) };
    const items = buildConnectCatalog(withReq, [], NOW, "essential");
    const open = items.filter((i) => ["available", "not_eligible", "on_request", "coming_soon"].includes(i.state));
    expect(open.length).toBeGreaterThan(0);
    for (const i of open) expect(i.request, i.key).toEqual({ stage: "contract_pending", reference: "IMP-20261117-AB" });
    for (const i of items.filter((x) => !open.includes(x))) expect(i.request, i.key).toBeNull();
    // Sin dato del plano de control (catálogo anterior): sin estado
    expect(buildConnectCatalog(SIM_CATALOG, [], NOW, "essential").every((i) => i.request === null)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });
});
