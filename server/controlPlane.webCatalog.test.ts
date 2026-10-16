/**
 * Web comercial: catálogo (productos, precios, promociones) y contenidos con flujo editorial
 * (borrador → publicación → despublicación, historial, restauración, auditoría), permisos separados
 * de edición y publicación, y lectura pública solo de lo publicado.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { checkPreviewToken, issuePreviewToken } from "./web/publicSite";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { ROLE_SCOPES } from "./controlPlane/operatorRoles";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";

const T0 = Date.UTC(2026, 9, 16, 9);
const A = "operator:ana";

const plan = (over: Record<string, unknown> = {}) => ({
  name: "Business",
  tagline: "Para equipos que crecen",
  technicalStatus: "available",
  activation: { kind: "plan", ref: "business" },
  billingModel: "subscription",
  includes: ["Núcleo empresarial", "Web y CMS"],
  internal: { notes: "margen objetivo 70 %", costCents: 1234, marginNote: "secreto" },
  ...over,
});
const ext = (over: Record<string, unknown> = {}) => ({
  name: "Telefonía con IA",
  technicalStatus: "available",
  activation: { kind: "feature", ref: null },
  billingModel: "recurring_addon",
  thirdPartyCosts: "Minutos del proveedor de voz, aparte.",
  compatibleWith: ["business"],
  ...over,
});
const hotel = (over: Record<string, unknown> = {}) => ({
  name: "Hoteles y alojamientos",
  technicalStatus: "available",
  activation: { kind: "module", ref: "hotel" },
  billingModel: "recurring_addon",
  ...over,
});

describe("WebAdminService", () => {
  let store: MemoryWebStore;
  let svc: WebAdminService;
  let now = T0;
  let published: string[] = [];
  beforeEach(() => {
    now = T0;
    published = [];
    store = new MemoryWebStore();
    svc = new WebAdminService({ store, now: () => now, refs: { moduleIds: ["cms", "commerce", "tpv", "hotel", "spa", "restaurants"], planIds: () => ["essential", "business", "enterprise"] }, onPublish: (v) => published.push(v) });
  });

  it("un producto nuevo nace en borrador y no sale en la web hasta publicarlo; nunca con datos internos", async () => {
    const e = await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    expect(e).toMatchObject({ publication: "draft", draftVersion: 1, publishedVersion: null });
    expect((await svc.site()).catalog.products).toHaveLength(0);
    await svc.publish("product", "business", 1, A);
    const site = await svc.site();
    expect(site.catalog.products).toHaveLength(1);
    expect(site.catalog.products[0]).toMatchObject({ key: "business", family: "core_plan", name: "Business", prices: [] });
    const raw = JSON.stringify(site);
    expect(raw).not.toMatch(/internal|margen objetivo|secreto|1234|operator:ana/);
    expect(published).toEqual([site.version]);
  });

  it("versiones: guardar incrementa, una versión vieja no pisa (409) y restaurar crea otra versión", async () => {
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.save("product", "business", { draft: plan({ tagline: "v2" }), expectedVersion: 1 }, A);
    await expect(svc.save("product", "business", { draft: plan({ tagline: "otra" }), expectedVersion: 1 }, "operator:luis")).rejects.toMatchObject({ code: "version_conflict" });
    await svc.publish("product", "business", 2, A);
    await svc.save("product", "business", { draft: plan({ tagline: "v3 sin publicar" }), expectedVersion: 2 }, A);
    // La web sigue mostrando la v2 publicada mientras la v3 es borrador
    expect((await svc.site()).catalog.products[0].tagline).toBe("v2");
    const r = await svc.restore("product", "business", 1, A);
    expect(r).toMatchObject({ draftVersion: 4 });
    expect((r.draft as { tagline: string }).tagline).toBe("Para equipos que crecen");
    const { versions, events } = await svc.get("product", "business");
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["create", "save", "publish", "restore"]));
    expect(events.every((e) => e.author)).toBe(true);
    // Publicar exige la versión que se revisó
    await expect(svc.publish("product", "business", 3, A)).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("publicar comprueba referencias técnicas, dependencias, compatibilidad y ciclos", async () => {
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.create({ kind: "product", key: "voice-ai", family: "extension", draft: ext() }, A);
    await expect(svc.publish("product", "voice-ai", 1, A)).rejects.toThrow(/plan compatible «business» no está publicado/);
    await svc.publish("product", "business", 1, A);
    await svc.publish("product", "voice-ai", 1, A);

    await svc.create({ kind: "product", key: "ghost", family: "industry_module", draft: hotel({ activation: { kind: "module", ref: "no_existe" } }) }, A);
    await expect(svc.publish("product", "ghost", 1, A)).rejects.toThrow(/módulo de licencia «no_existe» no existe/);
    await svc.create({ kind: "product", key: "plan-x", family: "core_plan", draft: plan({ activation: { kind: "plan", ref: "inventado" } }) }, A);
    await expect(svc.publish("product", "plan-x", 1, A)).rejects.toThrow(/plan de facturación «inventado» no existe/);

    await svc.create({ kind: "product", key: "a", family: "extension", draft: ext({ dependencies: ["b"], compatibleWith: [] }) }, A);
    await svc.create({ kind: "product", key: "b", family: "extension", draft: ext({ dependencies: ["a"], compatibleWith: [] }) }, A);
    await expect(svc.publish("product", "a", 1, A)).rejects.toThrow(/ciclo/);
    await expect(svc.create({ kind: "product", key: "mal", family: "core_plan", draft: plan({ activation: { kind: "module", ref: "hotel" } }) }, A)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("no se despublica lo que otros publicados necesitan", async () => {
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.create({ kind: "product", key: "voice-ai", family: "extension", draft: ext() }, A);
    await svc.publish("product", "business", 1, A);
    await svc.publish("product", "voice-ai", 1, A);
    await expect(svc.unpublish("product", "business", A)).rejects.toThrow(/voice-ai/);
    await svc.unpublish("product", "voice-ai", A);
    await svc.unpublish("product", "business", A);
    expect((await svc.site()).catalog.products).toHaveLength(0);
    expect((await svc.list("product")).map((p) => p.publication)).toEqual(["unpublished", "unpublished"]);
  });

  it("precios: borrador invisible, aprobado visible, sustitución con historial, sin precio en hoja de ruta", async () => {
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.publish("product", "business", 1, A);
    const p1 = await svc.addPrice("business", { kind: "monthly", amountCents: 9900, taxRateBp: 2100 }, A);
    expect((await svc.site()).catalog.products[0].prices).toEqual([]);
    await svc.approvePrice(p1.id, "operator:jefa");
    expect((await svc.site()).catalog.products[0].prices).toEqual([{ kind: "monthly", amountCents: 9900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false }]);
    const p2 = await svc.addPrice("business", { kind: "monthly", amountCents: 10900, taxRateBp: 2100 }, A);
    await svc.approvePrice(p2.id, "operator:jefa");
    const { prices } = await svc.get("product", "business");
    expect(prices.map((p) => [p.amountCents, p.status])).toEqual([
      [10900, "approved"],
      [9900, "retired"],
    ]);
    expect((await svc.site()).catalog.products[0].prices.map((p) => p.amountCents)).toEqual([10900]);
    await expect(svc.deletePrice(p1.id, A)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.addPrice("business", { kind: "monthly", amountCents: -1, taxRateBp: 2100 }, A)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.addPrice("business", { kind: "usage", amountCents: 5, taxRateBp: 2100 }, A)).rejects.toThrow(/unidad/);

    await svc.create({ kind: "product", key: "ski", family: "industry_module", draft: hotel({ technicalStatus: "planned", activation: { kind: "none", ref: null } }) }, A);
    const ps = await svc.addPrice("ski", { kind: "monthly", amountCents: 100, taxRateBp: 2100 }, A);
    // Catálogo de Elephant Source: un producto en hoja de ruta PUEDE tener tarifa aprobada (la web
    // muestra el portfolio con precios); no es contratable por su estado comercial, no por el precio.
    expect((await svc.approvePrice(ps.id, A)).status).toBe("approved");
    // …y «Disponible» con estado técnico «planned» se rechaza
    await expect(
      svc.save("product", "ski", { draft: hotel({ technicalStatus: "planned", activation: { kind: "none", ref: null }, catalog: { commercialStatus: "available" } }), expectedVersion: 1 }, A),
    ).rejects.toThrow(/Disponible/);
  });

  it("cambiar precios no altera contratos existentes (guardan su importe)", async () => {
    const crmStore = new MemoryCrmStore();
    const crm = new CrmService({ store: crmStore });
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.publish("product", "business", 1, A);
    const p1 = await svc.addPrice("business", { kind: "monthly", amountCents: 9900, taxRateBp: 2100 }, A);
    await svc.approvePrice(p1.id, A);
    const company = await crm.createCompany({ name: "Cliente SL" }, A);
    const contract = await crm.createContract({ companyId: company.id, planId: "business", modules: [], amountCents: 9900 }, A);
    const p2 = await svc.addPrice("business", { kind: "monthly", amountCents: 14900, taxRateBp: 2100 }, A);
    await svc.approvePrice(p2.id, A);
    expect((await crmStore.get("contracts", contract.id))!.amountCents).toBe(9900);
  });

  it("promociones: solo con productos publicados y dentro de sus fechas", async () => {
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.create({ kind: "promotion", key: "lanzamiento", draft: { name: "Lanzamiento", discount: { kind: "percent", value: 20 }, products: ["business"], startsAt: T0 + 1000, endsAt: T0 + 10_000 } }, A);
    await expect(svc.publish("promotion", "lanzamiento", 1, A)).rejects.toThrow(/no publicados/);
    await svc.publish("product", "business", 1, A);
    await svc.publish("promotion", "lanzamiento", 1, A);
    expect((await svc.site()).catalog.promotions).toHaveLength(0); // aún no ha empezado
    now = T0 + 5000;
    expect((await svc.site()).catalog.promotions).toMatchObject([{ key: "lanzamiento", discount: { kind: "percent", value: 20 } }]);
    now = T0 + 20_000;
    expect((await svc.site()).catalog.promotions).toHaveLength(0);
    await expect(svc.create({ kind: "promotion", key: "mala", draft: { name: "x", discount: { kind: "percent", value: 120 }, products: ["business"] } }, A)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("contenidos: claves admitidas, enlaces seguros y publicación independiente", async () => {
    await expect(svc.create({ kind: "page", key: "inventada", draft: { title: "x" } }, A)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.create({ kind: "menu", key: "main", draft: { items: [{ label: "Mal", href: "javascript:alert(1)" }] } }, A)).rejects.toMatchObject({ code: "invalid_input" });
    await svc.create({ kind: "menu", key: "main", draft: { items: [{ label: "Precios", href: "/precios" }] } }, A);
    await svc.create({ kind: "faq", key: "general", draft: { items: [{ q: "¿Hay permanencia?", a: "Se publicará con los precios.", topic: "precios" }] } }, A);
    await svc.publish("faq", "general", 1, A);
    const site = await svc.site();
    expect(site.content.faq).toMatchObject({ items: [{ q: "¿Hay permanencia?" }] });
    expect(site.content.menus).toEqual({});
    const preview = await svc.site("preview");
    expect(preview.preview).toBe(true);
    expect(preview.content.menus.main).toMatchObject({ items: [{ href: "/precios" }] });
    expect(preview.version).not.toBe(site.version);
  });

  it("la versión del sitio cambia al publicar y es estable si nada cambia", async () => {
    const v0 = (await svc.site()).version;
    expect((await svc.site()).version).toBe(v0);
    await svc.create({ kind: "faq", key: "general", draft: { items: [] } }, A);
    expect((await svc.site()).version).toBe(v0);
    await svc.publish("faq", "general", 1, A);
    expect((await svc.site()).version).not.toBe(v0);
  });
});

describe("enlaces de vista previa", () => {
  it("firmados, con caducidad y no reutilizables con otro secreto", () => {
    const s = "x".repeat(40);
    const { token, expiresAt } = issuePreviewToken(s, T0);
    expect(checkPreviewToken(s, token, T0 + 1000)).toBe(true);
    expect(checkPreviewToken(s, token, expiresAt + 1)).toBe(false);
    expect(checkPreviewToken("y".repeat(40), token, T0 + 1000)).toBe(false);
    expect(checkPreviewToken(s, token.replace(/^p1\.[^.]+/, `p1.${(T0 + 10 * 86_400_000).toString(36)}`), T0)).toBe(false);
  });
});

// ── HTTP ──────────────────────────────────────────────────────────────────────

const SECRET = crypto.randomBytes(24).toString("hex");
const TOK = { read: "web-read-token-aaaaaaaaaaaaaaaaaaaa", write: "web-write-token-bbbbbbbbbbbbbbbbbbb", publish: "web-publish-token-cccccccccccccccc", crm: "crm-only-token-dddddddddddddddddddd" };

class FlakyWebStore extends MemoryWebStore {
  fail = false;
  override async listEntries(f?: Parameters<MemoryWebStore["listEntries"]>[0]) {
    if (this.fail) throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    return super.listEntries(f);
  }
}

async function start(opts: { publicIntake?: boolean } = {}) {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const crmStore = new MemoryCrmStore();
  const webStore = new FlakyWebStore();
  const app = createControlPlaneApp({
    tokens: [
      { id: "lector", sha256: hashToken(TOK.read), scopes: ["web:read"] },
      { id: "editor", sha256: hashToken(TOK.write), scopes: ["web:read", "web:write"] },
      { id: "jefa", sha256: hashToken(TOK.publish), scopes: ["web:read", "web:write", "web:publish"] },
      { id: "crm", sha256: hashToken(TOK.crm), scopes: ["crm:read", "crm:write"] },
    ],
    registry: new TenantRegistryService(reg, () => ring),
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: new CrmService({ store: crmStore }), store: crmStore },
    publicIntake: opts.publicIntake === false ? undefined : { origins: ["http://localhost:4180"], secret: SECRET },
    web: { store: webStore },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number; json: any; raw: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1${path}`,
          method,
          headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null, raw: b, headers: res.headers }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { call, close, webStore };
}

describe("API de la web comercial", () => {
  let app: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => {
    app = await start();
  });
  afterEach(async () => {
    await app.close();
  });

  it("permisos: sin token 401, sin web:* 403, leer no edita, editar no publica", async () => {
    expect((await app.call("GET", "/web/entries")).status).toBe(401);
    expect((await app.call("GET", "/web/entries", { token: TOK.crm })).status).toBe(403);
    expect((await app.call("GET", "/web/entries", { token: TOK.read })).status).toBe(200);
    const body = { kind: "product", key: "business", family: "core_plan", draft: plan() };
    expect((await app.call("POST", "/web/entries", { token: TOK.read, body })).status).toBe(403);
    expect((await app.call("POST", "/web/entries", { token: TOK.write, body })).status).toBe(201);
    expect((await app.call("POST", "/web/entries/product/business/publish", { token: TOK.write, body: { expectedVersion: 1 } })).status).toBe(403);
    const price = await app.call("POST", "/web/entries/product/business/prices", { token: TOK.write, body: { kind: "monthly", amountCents: 9900, taxRateBp: 2100 } });
    expect(price.status).toBe(201);
    expect((await app.call("POST", `/web/prices/${price.json.price.id}/approve`, { token: TOK.write })).status).toBe(403);
    expect((await app.call("POST", "/web/entries/product/business/publish", { token: TOK.publish, body: { expectedVersion: 1 } })).status).toBe(200);
    expect((await app.call("POST", `/web/prices/${price.json.price.id}/approve`, { token: TOK.publish })).status).toBe(200);
    expect((await app.call("POST", "/web/entries/product/business/unpublish", { token: TOK.write })).status).toBe(403);
    const ev = await app.call("GET", "/web/events", { token: TOK.read });
    expect(ev.json.events.map((e: { author: string }) => e.author)).toEqual(expect.arrayContaining(["crm:editor", "crm:jefa"]));
  });

  it("los roles de operador separan edición y publicación", () => {
    expect(ROLE_SCOPES.sales).toEqual(expect.arrayContaining(["web:read", "web:write"]));
    expect(ROLE_SCOPES.sales).not.toContain("web:publish");
    expect(ROLE_SCOPES.admin).toContain("web:publish");
    expect(ROLE_SCOPES.readonly).toContain("web:read");
    expect(ROLE_SCOPES.readonly).not.toContain("web:write");
  });

  it("lectura pública: solo lo publicado, sin Origin, con ETag y caché corta; vista previa con enlace firmado", async () => {
    await app.call("POST", "/web/entries", { token: TOK.write, body: { kind: "product", key: "business", family: "core_plan", draft: plan() } });
    const empty = await app.call("GET", "/public/site");
    expect(empty.status).toBe(200);
    expect(empty.json.catalog.products).toEqual([]);
    expect(empty.headers["cache-control"]).toBe("public, max-age=30, must-revalidate");
    const etag = String(empty.headers.etag);
    expect((await app.call("GET", "/public/site", { headers: { "if-none-match": etag } })).status).toBe(304);
    await app.call("POST", "/web/entries/product/business/publish", { token: TOK.publish, body: { expectedVersion: 1 } });
    const after = await app.call("GET", "/public/site", { headers: { "if-none-match": etag } });
    expect(after.status).toBe(200);
    expect(after.json.catalog.products[0].key).toBe("business");
    expect(after.raw).not.toMatch(/internal|costCents|marginNote|crm:/);

    expect((await app.call("GET", "/public/site/preview")).status).toBe(401);
    expect((await app.call("GET", "/public/site/preview?token=p1.abc.def")).status).toBe(401);
    const tok = await app.call("POST", "/web/preview-token", { token: TOK.write });
    expect(tok.status).toBe(201);
    await app.call("PATCH", "/web/entries/product/business", { token: TOK.write, body: { draft: plan({ tagline: "borrador nuevo" }), expectedVersion: 1 } });
    const pv = await app.call("GET", `/public/site/preview?token=${encodeURIComponent(tok.json.token)}`);
    expect(pv.status).toBe(200);
    expect(pv.headers["cache-control"]).toBe("no-store");
    expect(pv.headers["x-robots-tag"]).toContain("noindex");
    expect(pv.json.catalog.products[0].tagline).toBe("borrador nuevo");
    expect(pv.raw).not.toMatch(/internal|costCents/);
    expect((await app.call("GET", "/public/site")).json.catalog.products[0].tagline).toBe("Para equipos que crecen");
    expect((await app.call("GET", "/web/events?entity=preview", { token: TOK.read })).json.events[0]).toMatchObject({ action: "issue", author: "crm:editor" });
  });

  it("si la BD falla, la lectura pública responde 503 sin caché (nunca un catálogo viejo como vigente)", async () => {
    app.webStore.fail = true;
    const r = await app.call("GET", "/public/site");
    expect(r.status).toBe(503);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["retry-after"]).toBe("30");
    expect(r.json).toEqual({ error: "unavailable" });
  });

  it("validación y conflictos por HTTP", async () => {
    expect((await app.call("POST", "/web/entries", { token: TOK.write, body: { kind: "product", key: "Mal Clave", family: "core_plan", draft: plan() } })).status).toBe(400);
    expect((await app.call("POST", "/web/entries", { token: TOK.write, body: { kind: "product", key: "x", family: "core_plan", draft: { ...plan(), extra: 1 } } })).status).toBe(400);
    await app.call("POST", "/web/entries", { token: TOK.write, body: { kind: "product", key: "business", family: "core_plan", draft: plan() } });
    expect((await app.call("POST", "/web/entries", { token: TOK.write, body: { kind: "product", key: "business", family: "core_plan", draft: plan() } })).status).toBe(409);
    const stale = await app.call("PATCH", "/web/entries/product/business", { token: TOK.write, body: { draft: plan(), expectedVersion: 7 } });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: "version_conflict", details: { current: 1 } });
    expect((await app.call("GET", "/web/entries/product/nada", { token: TOK.read })).status).toBe(404);
    const refs = await app.call("GET", "/web/refs", { token: TOK.read });
    expect(refs.json.modules.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(["hotel", "spa", "restaurants"]));
  });
});

describe("sin configuración pública", () => {
  it("no existe la lectura pública del sitio", async () => {
    const app = await start({ publicIntake: false });
    try {
      expect((await app.call("GET", "/public/site")).status).toBe(401);
    } finally {
      await app.close();
    }
  });
});


describe("semilla del catálogo", () => {
  it("es válida, publica en orden de dependencias, no trae precios y nunca sobrescribe lo editado", async () => {
    const { seed } = await import("../scripts/web-catalog-seed");
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs: { moduleIds: ["cms", "commerce", "tpv", "hotel", "spa", "restaurants"], planIds: () => null } });
    await svc.create({ kind: "faq", key: "general", draft: { items: [{ q: "Editada en el CRM", a: "Sí", topic: "producto" }] } }, A);
    const r = await seed(store, { publish: true });
    expect(r.created).toBe(24);
    const site = await svc.site();
    expect(site.catalog.products.length).toBe(20);
    expect(site.catalog.products.every((p) => p.prices.length === 0)).toBe(true);
    expect(site.content.faq).toBeNull(); // la editada no se publicó ni se pisó
    expect((await store.getEntry("faq", "general"))!.draft).toMatchObject({ items: [{ q: "Editada en el CRM" }] });
    expect(site.catalog.products.find((p) => p.key === "ski")).toMatchObject({ technicalStatus: "planned" });
  });
});

describe("panel de la web", () => {
  it("lo retirado no cuenta como pendiente de publicar; un borrador o una publicada con cambios, sí", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs: { moduleIds: [], planIds: () => null } });
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan() }, A);
    await svc.create({ kind: "product", key: "otro", family: "core_plan", draft: plan({ name: "Otro" }) }, A);
    await svc.publish("product", "business", 1, A);
    expect((await svc.overview()).pendingChanges.map((p) => p.key)).toEqual(["otro"]);
    await svc.save("product", "business", { draft: plan({ tagline: "cambio" }), expectedVersion: 1 }, A);
    expect((await svc.overview()).pendingChanges.map((p) => p.key).sort()).toEqual(["business", "otro"]);
    await svc.publish("product", "business", 2, A);
    await svc.unpublish("product", "business", A);
    expect((await svc.overview()).pendingChanges.map((p) => p.key)).toEqual(["otro"]);
  });
});

describe("cotizador por API (catálogo de Elephant Source)", () => {
  it("público: cotiza sobre lo publicado, valida la entrada y no admite «owned»; CRM: con permiso y con lo ya contratado", async () => {
    const app = await start();
    try {
      const svc = new WebAdminService({ store: app.webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
      await seedElephantSource(svc, app.webStore);
      const pub = await app.call("POST", "/public/site/quote", { body: { plan: "business", interval: "year", items: [{ key: "hotel-net-complete" }], users: 17 } });
      expect(pub.status).toBe(200);
      expect(pub.headers["cache-control"]).toBe("no-store");
      expect(pub.json.totals).toMatchObject({ yearlyCents: 75900, monthlyCents: 11900 + 1000 });
      expect(pub.json.contractable).toBe("not_available");
      expect((await app.call("POST", "/public/site/quote", { body: { plan: "essential", interval: "semana" } })).status).toBe(400);
      expect((await app.call("POST", "/public/site/quote", { body: { plan: "essential", interval: "month", owned: ["connect-voice"] } })).status).toBe(400);
      // Admin: sin token 401; con web:read, cotiza con lo ya contratado y lista el catálogo
      expect((await app.call("POST", "/web/quote", { body: { plan: "essential", interval: "month" } })).status).toBe(401);
      const crm = await app.call("POST", "/web/quote", { token: TOK.read, body: { plan: "essential", interval: "month", items: [{ key: "connect-pack-communications" }], owned: ["connect-voice"] } });
      expect(crm.json.lines.find((l: { key: string }) => l.key === "connect-pack-communications").replaces).toEqual(["connect-voice"]);
      const cat = await app.call("GET", "/web/catalog", { token: TOK.read });
      expect(cat.json.capabilities).toHaveLength(74);
      expect(cat.json.catalog.products.find((p: { key: string }) => p.key === "essential").commercialStatus).toBe("on_request");
      // Si la BD cae: 503 explícito, nunca un precio inventado
      app.webStore.fail = true;
      expect((await app.call("POST", "/public/site/quote", { body: { plan: "essential", interval: "month" } })).status).toBe(503);
    } finally {
      await app.close();
    }
  });
});

describe("contratos con configuración cotizada (Elephant Source)", () => {
  it("el servidor cotiza y fija plan, periodicidad e importe; ignora importes enviados; rechaza configuraciones inválidas; versiona", async () => {
    const app = await start();
    try {
      const svc = new WebAdminService({ store: app.webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
      await seedElephantSource(svc, app.webStore);
      const co = await app.call("POST", "/crm/companies", { token: TOK.crm, body: { name: "Hotel Prueba SL" } });
      expect(co.status).toBe(201);
      const companyId = co.json.company.id;
      const request = { plan: "business", interval: "year", items: [{ key: "restaurant-net-bookings" }, { key: "connect-voice" }], users: 17 };
      const c = await app.call("POST", "/crm/contracts", { token: TOK.crm, body: { companyId, amountCents: 1, configuration: { request } } });
      expect(c.status).toBe(201);
      // anual: 759 € + 12 × (19 + 39 + 2 × 5) €
      expect(c.json.contract).toMatchObject({ planId: "business", billingInterval: "year", currency: "EUR", amountCents: 75_900 + 12 * 6_800 });
      expect(c.json.contract.configuration.quote).toMatchObject({ contractable: "request", totals: { yearlyCents: 75_900, monthlyCents: 6_800 } });
      expect(c.json.contract.configuration.request).toMatchObject(request);
      const bad = await app.call("POST", "/crm/contracts", { token: TOK.crm, body: { companyId, configuration: { request: { plan: "essential", interval: "month", items: [{ key: "ski-net-courses" }] } } } });
      expect(bad.status).toBe(400);
      expect(bad.json.errors.join()).toMatch(/requiere/);
      const upd = await app.call("PATCH", `/crm/contracts/${c.json.contract.id}`, { token: TOK.crm, body: { configuration: { request: { plan: "essential", interval: "month" } } } });
      expect(upd.json.contract).toMatchObject({ planId: "essential", billingInterval: "month", amountCents: 2_900, version: 2 });
      const detail = await app.call("GET", `/crm/contracts/${c.json.contract.id}`, { token: TOK.crm });
      const snaps = (detail.json.versions ?? []).map((v: { snapshot: { configuration?: { request: { plan: string } } } }) => v.snapshot.configuration?.request.plan);
      expect(snaps).toEqual(expect.arrayContaining(["business", "essential"]));
    } finally {
      await app.close();
    }
  });
});
