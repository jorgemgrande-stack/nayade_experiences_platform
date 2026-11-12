/**
 * Elephant Connect con contratación asistida (decisión de Jorge del 12/11/2026): todos los Connect vigentes se contratan
 * desde el Marketplace. Los de contratación directa siguen con «Contratar ahora»; los demás, con «Contratar e iniciar
 * implantación», lo disponible y lo pendiente («en implantación»), el mismo circuito de solicitud, expediente, paquete
 * personalizado y aceptación que Elephant Net. Nada se cobra. Datos sintéticos en memoria.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { receivePanelRequest } from "./commerce/panelRequests";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import { ImplementationService } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { solutionFromWebStore } from "./implementation/ports";
import { netCommitmentsText, templateFor } from "./implementation/templates";
import { buildConnectCatalog } from "./connectMarketplace";
import { primaryAction } from "../shared/connectShowcase";
import { CONNECT_ASSISTED } from "../shared/connectAssisted";
import { netAvailabilitySplit, offerSaleKind } from "../shared/netOffer";

const NOW = Date.UTC(2026, 10, 12, 12);
const flush = () => new Promise((r) => setImmediate(r));
let site: SiteDocument;
let webStore: MemoryWebStore;
const DIRECT = ["connect-people", "connect-tax", "connect-partners", "connect-deals", "connect-finance-sync", "connect-geo-control"];

beforeAll(async () => {
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  site = await web.site("published");
});

describe("Elephant Connect: contratación directa o asistida", () => {
  it("el registro cubre los Connect vigentes que no son de venta directa, con lo disponible y lo pendiente", () => {
    const connect = quoteCatalogFromSite(site).products.filter((p) => p.family === "connect" || p.family === "connect_bundle");
    const keys = new Set(connect.map((p) => p.key));
    for (const p of CONNECT_ASSISTED) {
      expect(keys.has(p.key), p.key).toBe(true);
      expect(DIRECT).not.toContain(p.key);
      const split = netAvailabilitySplit(p.key);
      expect(split.available.length, p.key).toBeGreaterThan(0);
    }
    // Todo Connect del catálogo es directo o asistido: ninguno queda sin modalidad
    for (const p of connect) expect(DIRECT.includes(p.key) || CONNECT_ASSISTED.some((a) => a.key === p.key), p.key).toBe(true);
    // Lo que necesita credenciales o la aprobación de un proveedor no se presenta como operativo
    expect(netAvailabilitySplit("connect-voice").inImplementation.join(" ")).toMatch(/Netelip/);
    expect(netAvailabilitySplit("connect-ads-manager").inImplementation.join(" ")).toMatch(/Google Ads/);
    expect(netAvailabilitySplit("connect-whatsapp-ai").available.join(" ")).not.toMatch(/Verificación/);
  });

  it("la clase de venta: asistida para el registro (también «próximamente» o «en preparación»); retirado, no", () => {
    const k = (key: string, commercialStatus: string, hasMonthlyPrice = true) => offerSaleKind({ key, commercialStatus, technicalStatus: "planned", hasMonthlyPrice });
    expect(k("connect-voice", "on_request")).toBe("assisted_contract");
    expect(k("connect-copilot", "coming_soon")).toBe("assisted_contract");
    expect(k("connect-pack-ai", "in_preparation")).toBe("assisted_contract");
    expect(k("connect-voice", "on_request", false)).toBe("request_info");
    expect(k("connect-voice", "retired")).toBeNull();
    expect(k("connect-people", "available")).toBeNull();
    expect(k("hotel-net-complete", "on_request")).toBe("request_info");
  });

  it("marketplace del panel: «Contratar e iniciar implantación» con precio y lo disponible / en implantación; los directos, «Contratar ahora»", () => {
    const items = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: true, site }).items;
    const out = buildConnectCatalog({ items }, [], NOW, "essential");
    const view = { canPurchase: true, interestEnabled: true };
    for (const p of CONNECT_ASSISTED) {
      const card = out.find((i) => i.key === p.key);
      if (!card) continue;
      expect(card.state, p.key).toBe("on_request");
      expect(card.assisted, p.key).not.toBeNull();
      expect(primaryAction(card, view), p.key).toEqual({ kind: "assisted", label: "Contratar e iniciar implantación", href: null });
    }
    const voice = out.find((i) => i.key === "connect-voice")!;
    expect(voice.assisted).toMatchObject({ monthly: { kind: "monthly", amountCents: 3900 } });
    expect(voice.assisted!.inImplementation.join(" ")).toMatch(/Netelip/);
    // Contratado: no se vuelve a ofrecer
    const grants = [{ tenantId: "t", capabilityId: "voice-ai", siteId: "", status: "active" as const, validUntil: null, source: "subscription:1", updatedAt: NOW, updatedBy: "x" }];
    expect(buildConnectCatalog({ items }, grants, NOW, "essential").find((i) => i.key === "connect-voice")!.assisted).toBeNull();
  });

  it("solicitud desde el panel: abre el expediente una sola vez, con su plantilla y los compromisos de implantación; nada se cobra", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const impl = new MemoryImplementationStore();
    const svc: ImplementationService = new ImplementationService({ store: impl, crm, crmStore: store, solution: solutionFromWebStore(webStore), now: () => NOW, markAttended: async (id, who) => void (await requests.setStatus(id, "attended", who)) });
    const requests: WebRequestService = new WebRequestService({ store, crm, now: () => NOW, onCreated: async (r) => void (await svc.fromIntake(r)) });
    const c = await crm.createCompany({ name: "Clínica Demo", legalName: "Clínica Demo SL" }, "operator:test");
    await store.update("companies", c.id, { tenantId: "t9-clinica" });
    const d = { site, internal: false, requests, crm: store, implementations: impl };
    const body = (k: string, over: Record<string, unknown> = {}) => ({ type: "implementation" as const, interest: "connect-voice", requester: { name: "Marta", email: "marta@clinica.example" }, idempotencyKey: k, ...over });
    expect((await receivePanelRequest(d, "t9-clinica", body("clave-voz-0001"))).outcome).toBe("created");
    await flush();
    expect(impl.rows.map((o) => [o.companyId, o.solutionKey, o.status])).toEqual([[c.id, "connect-voice", "requested"]]);
    const again = await receivePanelRequest(d, "t9-clinica", body("clave-voz-0002", { message: "¿Cuándo?" }));
    expect(again).toMatchObject({ outcome: "duplicate", reference: impl.rows[0].reference });
    expect(await store.list("leadRequests", {})).toHaveLength(1);
    // Los de contratación directa no van por aquí (se compran con «Contratar ahora»)
    await expect(receivePanelRequest(d, "t9-clinica", body("clave-people-01", { interest: "connect-people" }))).rejects.toMatchObject({ status: 409 });

    const t = templateFor("connect-voice");
    expect(t).toMatchObject({ key: "connect-voice", generic: false, name: "Implantación de Elephant Voice" });
    expect(t.items.some((i) => i.section === "en_implantacion" && /Netelip/.test(i.title))).toBe(true);
    const text = netCommitmentsText("connect-voice")!;
    expect(text).toMatch(/^Compromisos de implantación de Elephant Voice\./);
    expect(text).toMatch(/En implantación \(incluido en el precio[\s\S]*Netelip/);
    expect(netCommitmentsText("connect-people")).toBeNull();
    expect(templateFor("connect-people").generic).toBe(true);
  });
});
