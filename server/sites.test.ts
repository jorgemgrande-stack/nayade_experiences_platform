/**
 * Varias sedes (Business, multi-site): lógica pura, sedes desde el panel sobre el registro (OrganizationService) con el
 * catálogo oficial (Essential 1 sede, Business 5), y el canal real Core → plano de control por HTTP (commerceClient →
 * /cp/v1/commerce/tenants/:t/sites) con su ámbito y el aislamiento entre empresas.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryOrganizationStore, OrganizationService } from "./organization/service";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { authenticate, hashToken } from "./controlPlane/auth";
import { createPanelSitesRouter } from "./commerce/panelSites";
import { commerceClientFromEnv, CommerceError } from "./commerceClient";
import { PRIMARY_SITE_ID, siteIdFromName, siteOfStored, storedSiteId, userWorksAtSite, validateSiteForm } from "../shared/sites";
import { CAPABILITIES } from "./catalog/capabilities";

const NOW = Date.UTC(2026, 10, 3, 10);

describe("lógica de sedes (shared/sites)", () => {
  it("id a partir del nombre, sin acentos y sin chocar", () => {
    expect(siteIdFromName("Tienda Centro", [])).toBe("tienda-centro");
    expect(siteIdFromName("Málaga · Puerto", [])).toBe("malaga-puerto");
    expect(siteIdFromName("Tienda Centro", ["tienda-centro", "tienda-centro-2"])).toBe("tienda-centro-3");
    expect(siteIdFromName("¡¡!!", [])).toBe("sede");
  });
  it("NULL = sede principal en el Core; los usuarios sin sedes trabajan en todas", () => {
    expect(storedSiteId("principal", "principal")).toBeNull();
    expect(storedSiteId(null, "central")).toBeNull();
    expect(storedSiteId("norte", "central")).toBe("norte");
    expect(siteOfStored(null, "central")).toBe("central");
    expect(siteOfStored("norte", "central")).toBe("norte");
    expect(userWorksAtSite([], "norte")).toBe(true);
    expect(userWorksAtSite(["central"], "norte")).toBe(false);
    expect(userWorksAtSite(["central", "norte"], "norte")).toBe(true);
  });
  it("valida el formulario de sede", () => {
    expect(validateSiteForm({ name: "Centro" })).toEqual({});
    expect(validateSiteForm({ name: " x " }).name).toBeTruthy();
    expect(validateSiteForm({ name: "Centro", phone: "abc" }).phone).toBeTruthy();
    expect(validateSiteForm({ name: "Centro", email: "no-es-correo" }).email).toBeTruthy();
    expect(validateSiteForm({ name: "Centro", phone: "+34 600 000 000", email: "centro@empresa.example", address: "Calle Mayor 1" })).toEqual({});
  });
  it("la capacidad multi-site es Business y ya tiene código", () => {
    expect(CAPABILITIES.find((c) => c.id === "multi-site")).toMatchObject({ tier: "business", technicalStatus: "partial" });
  });
});

let org: OrganizationService;
let subscribe: (tenant: string, plan: string) => Promise<unknown>;

beforeEach(async () => {
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  const priceOf = async (key: string) => (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const crm: CrmPort = { company: async () => ({ id: 1, name: "Acme" }), contract: async () => null };
  const store = new MemorySubscriptionStore();
  const subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => NOW });
  let company = 0;
  subscribe = async (tenantId, plan) => subs.create({ companyId: ++company, tenantId, interval: "month", plan: { productKey: plan, priceId: await priceOf(plan) }, addons: [] }, "t");
  org = new OrganizationService({ store: new MemoryOrganizationStore(), subscriptions: store, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => NOW });
});

describe("sedes desde el panel (registro del plano de control)", () => {
  it("Essential: una sola sede, la principal implícita; no puede añadir otra", async () => {
    await subscribe("acme", "essential");
    const s = await org.panelSites("acme");
    expect(s).toMatchObject({ primarySiteId: PRIMARY_SITE_ID, limit: 1, used: 1, canAdd: false });
    expect(s.sites).toEqual([expect.objectContaining({ siteId: PRIMARY_SITE_ID, isPrimary: true, virtual: true, status: "active" })]);
    await expect(org.createPanelSite("acme", { name: "Norte" }, "core:ana")).rejects.toMatchObject({ code: "limit" });
    // Nada se ha creado al rechazar
    expect((await org.overview("acme")).sites).toEqual([]);
    // Sí puede poner nombre y contacto a su sede: entonces pasa al registro
    const after = await org.updatePanelSite("acme", PRIMARY_SITE_ID, { name: "Tienda Acme", phone: "+34 900 000 000" }, "core:ana");
    expect(after.sites).toEqual([expect.objectContaining({ siteId: PRIMARY_SITE_ID, name: "Tienda Acme", phone: "+34 900 000 000", virtual: false, isPrimary: true })]);
    expect(after.used).toBe(1);
  });

  it("Business: hasta 5 sedes contando la principal; la principal no se desactiva; reactivar respeta el límite", async () => {
    await subscribe("acme", "business");
    const first = await org.createPanelSite("acme", { name: "Norte", address: "Calle Norte 1", email: "norte@acme.example" }, "core:ana");
    // La principal implícita pasa al registro antes (y sigue siendo la principal)
    expect(first.sites.map((s) => [s.siteId, s.isPrimary])).toEqual([["principal", true], ["norte", false]]);
    expect(first).toMatchObject({ limit: 5, used: 2, canAdd: true, primarySiteId: "principal" });
    expect(first.sites[1]).toMatchObject({ address: "Calle Norte 1", email: "norte@acme.example", phone: null });
    for (const n of ["Sur", "Este", "Oeste"]) await org.createPanelSite("acme", { name: n }, "core:ana");
    const full = await org.panelSites("acme");
    expect(full).toMatchObject({ used: 5, canAdd: false });
    await expect(org.createPanelSite("acme", { name: "Sexta" }, "core:ana")).rejects.toMatchObject({ code: "limit" });
    await expect(org.archivePanelSite("acme", "principal")).rejects.toMatchObject({ code: "conflict" });
    // Desactivar no borra: libera el hueco; reactivar con el cupo lleno se rechaza
    const archived = await org.archivePanelSite("acme", "sur");
    expect(archived.sites.find((s) => s.siteId === "sur")).toMatchObject({ status: "archived" });
    expect(archived).toMatchObject({ used: 4, canAdd: true });
    await org.createPanelSite("acme", { name: "Centro" }, "core:ana");
    await expect(org.restorePanelSite("acme", "sur")).rejects.toMatchObject({ code: "limit" });
    await org.archivePanelSite("acme", "centro");
    expect((await org.restorePanelSite("acme", "sur")).sites.find((s) => s.siteId === "sur")).toMatchObject({ status: "active" });
    // Renombrar y contacto (un campo vacío lo borra)
    const renamed = await org.updatePanelSite("acme", "norte", { name: "Norte (puerto)", email: "" }, "core:ana");
    expect(renamed.sites.find((s) => s.siteId === "norte")).toMatchObject({ name: "Norte (puerto)", email: null, address: "Calle Norte 1" });
    await expect(org.updatePanelSite("acme", "no-existe", { name: "X y" }, "core:ana")).rejects.toMatchObject({ code: "not_found" });
    await expect(org.updatePanelSite("acme", "norte", { email: "mal" }, "core:ana")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("una sede creada por el operador es la principal; el panel añade a partir de ella", async () => {
    await subscribe("acme", "business");
    await org.createSite("acme", { siteId: "central", name: "Central" }, "operator:o");
    const s = await org.createPanelSite("acme", { name: "Norte" }, "core:ana");
    expect(s.primarySiteId).toBe("central");
    expect(s.sites.map((x) => x.siteId)).toEqual(["central", "norte"]);
  });

  it("aislamiento: cada empresa ve solo sus sedes", async () => {
    await subscribe("acme", "business");
    await subscribe("beta", "business");
    await org.createPanelSite("acme", { name: "Norte" }, "core:ana");
    const beta = await org.panelSites("beta");
    expect(beta.sites.map((s) => s.siteId)).toEqual([PRIMARY_SITE_ID]);
    await expect(org.archivePanelSite("beta", "norte")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("canal Core → plano de control (HTTP real)", () => {
  const CORE = "token-del-core-de-prueba-0123456789";
  const TEAM = "token-del-equipo-de-prueba-0123456789";
  let server: http.Server;
  let port = 0;
  let svc: OrganizationService;
  beforeAll(async () => {
    svc = new OrganizationService({
      store: new MemoryOrganizationStore(),
      subscriptions: { list: async () => [{ id: 1, tenantId: "acme", status: "active" }, { id: 2, tenantId: "beta", status: "active" }] as never, items: async () => [{ family: "core_plan", productKey: "business", effectiveFrom: 0, effectiveTo: null, quantity: 1 }] as never },
      catalog: async () => ({ products: [{ key: "business", quotas: [{ metric: "sites", included: 2 }] }] }) as never,
      now: () => NOW,
    });
    const app = express();
    app.use(express.json());
    const router = express.Router();
    router.use(authenticate([{ id: "core-commerce", sha256: hashToken(CORE), scopes: ["commerce:purchase", "commerce:support"] }, { id: "equipo", sha256: hashToken(TEAM), scopes: ["tenants:read"] }]));
    router.use("/commerce", createPanelSitesRouter({ org: svc, tenantExists: async (t) => ["acme", "beta"].includes(t) }));
    app.use("/cp/v1", router);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const client = (token = CORE) => commerceClientFromEnv({ CP_COMMERCE_URL: `http://127.0.0.1:${port}`, CP_COMMERCE_TOKEN: token, NODE_ENV: "test" })!;

  it("solo con el token del Core; empresa inexistente, 404", async () => {
    await expect(client(TEAM).sites!("acme")).rejects.toMatchObject({ status: 403 });
    await expect(client().sites!("no-existe")).rejects.toMatchObject({ status: 404 });
    await expect(client().sites!("ACME!")).rejects.toBeInstanceOf(CommerceError);
  });

  it("alta, límite del plan (422), cambios, desactivar y reactivar; la otra empresa no ve nada", async () => {
    const c = client();
    expect((await c.sites!("acme")).sites).toHaveLength(1);
    const created = await c.createSite!("acme", { name: "Norte", phone: "+34 600 000 001", requestedBy: "ana@acme.example" });
    expect(created.sites.map((s) => s.siteId)).toEqual(["principal", "norte"]);
    await expect(c.createSite!("acme", { name: "Sur", requestedBy: "ana@acme.example" })).rejects.toMatchObject({ status: 422 });
    expect((await c.updateSite!("acme", "norte", { name: "Norte 2", requestedBy: "ana@acme.example" })).sites[1].name).toBe("Norte 2");
    expect((await c.archiveSite!("acme", "norte", { requestedBy: "ana@acme.example" })).sites[1].status).toBe("archived");
    await expect(c.archiveSite!("acme", "principal", { requestedBy: "ana@acme.example" })).rejects.toMatchObject({ status: 409 });
    expect((await c.restoreSite!("acme", "norte", { requestedBy: "ana@acme.example" })).sites[1].status).toBe("active");
    await expect(c.createSite!("acme", { name: "x", requestedBy: "ana@acme.example" })).rejects.toMatchObject({ status: 400 });
    // Aislamiento
    expect((await c.sites!("beta")).sites.map((s) => s.siteId)).toEqual(["principal"]);
    await expect(c.updateSite!("beta", "norte", { name: "Robada", requestedBy: "x@beta.example" })).rejects.toMatchObject({ status: 404 });
    // Quién lo hizo queda en el registro
    expect((await svc.overview("acme")).sites.find((s) => s.siteId === "norte")?.createdBy).toBe("core:ana@acme.example");
  });
});
