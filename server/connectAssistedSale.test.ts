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
import { panelRequestBody, receivePanelRequest } from "./commerce/panelRequests";
import type { SupportGrant } from "./_core/support/grants";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import { ImplementationService } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { solutionFromWebStore } from "./implementation/ports";
import { netCommitmentsText, templateFor } from "./implementation/templates";
import { buildConnectCatalog } from "./connectMarketplace";
import { primaryAction } from "../shared/connectShowcase";
import { CONNECT_ASSISTED, connectOverlap } from "../shared/connectAssisted";
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

  it("nunca dos veces lo mismo: un paquete con un componente ya contratado no ofrece contratación asistida", () => {
    const items = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: true, site }).items;
    // Elephant Tax por licencia (pedido): el Paquete Finance no lleva «Contratar e iniciar implantación»
    const grants = [{ tenantId: "t", capabilityId: "tax-filings", siteId: "", status: "active" as const, validUntil: null, source: "subscription:1", updatedAt: NOW, updatedBy: "x" }];
    const pack = buildConnectCatalog({ items }, grants, NOW, "essential").find((i) => i.key === "connect-pack-finance");
    if (pack) expect(pack.assisted).toBeNull();
    expect(connectOverlap("connect-pack-finance", "connect-tax")).toBe(true);
    expect(connectOverlap("connect-voice", "connect-pack-communications")).toBe(true);
    expect(connectOverlap("connect-pack-ai", "connect-pack-communications")).toBe(false);
    expect(connectOverlap("connect-voice", "connect-seo-control")).toBe(false);
    // Paquetes del registro = paquetes del catálogo (mismos componentes)
    const products = quoteCatalogFromSite(site).products;
    for (const p of CONNECT_ASSISTED.filter((x) => x.bundleOf)) {
      const cat = products.find((x) => x.key === p.key) as unknown as { catalog?: { bundleOf?: string[] } } | undefined;
      if (cat?.catalog?.bundleOf?.length) expect([...p.bundleOf!].sort(), p.key).toEqual([...cat.catalog.bundleOf].sort());
    }
  });

  it("disponible, retirado o sin publicar: la regla de siempre (nunca la asistida)", () => {
    const k = (commercialStatus: string) => offerSaleKind({ key: "connect-voice", commercialStatus, technicalStatus: "partial", hasMonthlyPrice: true });
    expect(k("available")).toBeNull();
    expect(k("retired")).toBeNull();
    expect(k("unpublished")).toBeNull();
  });

  it("la ficha de un Connect asistido muestra lo disponible y lo que está en implantación (no solo el diálogo)", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync(new URL("../client/src/pages/admin/connect/ConnectDetailPage.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/action\.kind === "assisted" && item\.assisted && !item\.net && \(/);
    expect(page).toContain("<AssistedFeatures assisted={item.assisted} columns={false} />");
    const parts = fs.readFileSync(new URL("../client/src/components/connect/ConnectParts.tsx", import.meta.url), "utf8");
    expect(parts).toContain("export function AssistedFeatures(");
    expect(parts).toContain("ASSISTED_CONTRACT_COPY.inImplementationTitle");
  });
});

/**
 * Incidencia del 17/11/2026 (Quantum Soulrise, WhatsApp AI): la solicitud ASISTIDA desde soporte delegado con
 * modificación. La concesión la comprueba el plano de control; el contacto es el de la ficha de la empresa; queda
 * constancia del operador; nunca es aceptación contractual ni cobra nada.
 */
describe("solicitud asistida desde soporte delegado", () => {
  const GRANT = "c12f1844fed71870a1b2c3d4e5f60718";
  const grant = (over: Partial<SupportGrant> = {}): SupportGrant => ({ id: GRANT, tenantId: "t12-quantum", operator: "operator:jorge", reason: "r", readOnly: false, expiresAt: Date.UTC(2037, 11, 31), untilRevoked: true, createdAt: NOW - 1000, revokedAt: null, ...over });
  async function setup(g: SupportGrant | null, email: string | null = "info@quantum.example") {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const impl = new MemoryImplementationStore();
    const svc: ImplementationService = new ImplementationService({ store: impl, crm, crmStore: store, solution: solutionFromWebStore(webStore), now: () => NOW, markAttended: async (id, who) => void (await requests.setStatus(id, "attended", who)) });
    const requests: WebRequestService = new WebRequestService({ store, crm, now: () => NOW, onCreated: async (r) => void (await svc.fromIntake(r)) });
    const c = await crm.createCompany({ name: "Quantum Soulrise", email }, "operator:test");
    await store.update("companies", c.id, { tenantId: "t12-quantum" });
    const d = { site, internal: false, requests, crm: store, implementations: impl, supportGrant: async (id: string) => (g && id === g.id ? g : null) };
    return { d, store, impl, company: c };
  }
  const body = (k: string, over: Record<string, unknown> = {}) => ({ type: "implementation" as const, interest: "connect-whatsapp-ai", assisted: { grantId: GRANT }, idempotencyKey: k, ...over });

  it("WhatsApp AI con modificación: registra la solicitud, abre el expediente una vez, con el contacto de la empresa y el operador", async () => {
    const { d, store, impl, company } = await setup(grant());
    const r = await receivePanelRequest(d, "t12-quantum", panelRequestBody.parse(body("asistida-0001", { message: "Indira quiere empezar en diciembre" })));
    expect(r).toMatchObject({ outcome: "created", contactEmail: "info@quantum.example" });
    await flush();
    const [req] = await store.list("leadRequests", {});
    expect(req.sourcePage).toBe("panel:/admin/ampliar/connect-whatsapp-ai#contratar-implantacion");
    expect(req.message).toContain("Empresa cliente: Quantum Soulrise (t12-quantum).");
    expect(req.message).toContain("Solicitud asistida por Soporte Big Elephant (jorge)");
    expect(req.message).toMatch(/No equivale a la aceptación del contrato ni autoriza cargos/);
    expect(req.message).toMatch(/Mensaje: Indira quiere empezar en diciembre/);
    const [lead] = await store.list("leads", {});
    expect(lead.email).toBe("info@quantum.example");
    expect(impl.rows.map((o) => [o.companyId, o.solutionKey, o.status])).toEqual([[company.id, "connect-whatsapp-ai", "requested"]]);
    // Reintento con la misma clave: la misma solicitud; con otra clave: la contratación ya en curso (sin duplicar)
    expect((await receivePanelRequest(d, "t12-quantum", panelRequestBody.parse(body("asistida-0001", { message: "Indira quiere empezar en diciembre" })))).outcome).toBe("replayed");
    expect(await receivePanelRequest(d, "t12-quantum", panelRequestBody.parse(body("asistida-0002")))).toMatchObject({ outcome: "duplicate", contactEmail: "info@quantum.example" });
    expect(await store.list("leadRequests", {})).toHaveLength(1);
  });

  it("concesión de otra empresa, revocada, caducada, de solo lectura o inexistente: 403 y nada registrado", async () => {
    for (const g of [grant({ tenantId: "otra-empresa" }), grant({ revokedAt: NOW - 1 }), grant({ untilRevoked: false, expiresAt: NOW - 1 }), grant({ readOnly: true }), null]) {
      const { d, store } = await setup(g);
      await expect(receivePanelRequest(d, "t12-quantum", panelRequestBody.parse(body("asistida-0003")))).rejects.toMatchObject({ status: 403, code: "assisted_forbidden" });
      expect(await store.list("leadRequests", {})).toHaveLength(0);
    }
    // Sin lector de concesiones: no se registra a ciegas
    const { d } = await setup(grant());
    await expect(receivePanelRequest({ ...d, supportGrant: null }, "t12-quantum", panelRequestBody.parse(body("asistida-0004")))).rejects.toMatchObject({ status: 503 });
  });

  it("sin correo en la ficha de la empresa: error claro (409) para completarla y reintentar", async () => {
    const { d, store } = await setup(grant(), null);
    await expect(receivePanelRequest(d, "t12-quantum", panelRequestBody.parse(body("asistida-0005")))).rejects.toMatchObject({ status: 409, code: "no_contact" });
    expect(await store.list("leadRequests", {})).toHaveLength(0);
  });

  it("el cuerpo lleva la persona o la concesión, nunca las dos ni ninguna", () => {
    expect(panelRequestBody.safeParse(body("asistida-0006")).success).toBe(true);
    expect(panelRequestBody.safeParse(body("asistida-0006", { requester: { name: "X", email: "x@y.example" } })).success).toBe(false);
    expect(panelRequestBody.safeParse({ type: "info", interest: "connect-voice", idempotencyKey: "asistida-0007" }).success).toBe(false);
    expect(panelRequestBody.safeParse(body("asistida-0008", { assisted: { grantId: "no-hex!" } })).success).toBe(false);
  });

  it("todos los Connect de contratación asistida con precio se pueden solicitar desde soporte (no solo WhatsApp AI)", async () => {
    const items = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: true, site }).items;
    const assisted = items.filter((i) => !i.legacy && offerSaleKind({ key: i.key, commercialStatus: i.commercialStatus, technicalStatus: i.technicalStatus ?? null, hasMonthlyPrice: !!i.monthly }) === "assisted_contract");
    expect(assisted.map((i) => i.key)).toContain("connect-whatsapp-ai");
    const { d, store } = await setup(grant());
    for (const [n, i] of assisted.entries()) {
      const r = await receivePanelRequest(d, "t12-quantum", panelRequestBody.parse(body(`asistida-todos-${n}`, { interest: i.key })));
      expect(r.outcome, i.key).toBe("created");
    }
    expect(await store.list("leadRequests", {})).toHaveLength(assisted.length);
  });
});
