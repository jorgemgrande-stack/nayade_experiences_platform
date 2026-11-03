/**
 * Autoservicio de dominios propios (server/controlPlane/customDomains.ts): orden TXT → alta en el proveedor → DNS →
 * certificado → HTTPS → activo; nunca activo sin la comprobación HTTPS; aislamiento entre empresas; reglas del plan;
 * principal y desconexión; comprobaciones automáticas. También la consulta de la pasarela en el Core (domainCheck.ts)
 * y el canal del panel (commerce/panelDomains.ts). Sin red: DNS, proveedor y HTTPS simulados.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "node:net";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { TenantResolver } from "./_core/tenantRegistry/resolver";
import { expectedTxtValue, VERIFY_LABEL } from "./_core/tenantRegistry/domainVerification";
import { createDomainCheckRouter, domainCheckValue, DOMAIN_CHECK_PATH, PUBLIC_HOST_PATH } from "./_core/tenantRegistry/domainCheck";
import { CustomDomainService, CustomDomainError, type Allowance } from "./controlPlane/customDomains";
import { dnsRecordOf, type DomainProvider, type ProviderDomainStatus } from "./controlPlane/domainProvider";
import { createPanelDomainsRouter } from "./commerce/panelDomains";
import { authenticate, hashToken } from "./controlPlane/auth";
import { isApexDomain, registrableDomain, relativeName } from "../shared/customDomains";

const OP: Actor = { type: "operator", id: "jorge" };
const RAILWAY_TARGET = "abc123.up.railway.app";

let store: MemoryTenantRegistryStore;
let registry: TenantRegistryService;
let txt: Map<string, string[][]>;
let cname: Map<string, string[]>;
let provider: FakeProvider;
let probeOk: Map<string, string>;
let probes: string[];
let activated: string[];
let allowance: Allowance;
let svc: CustomDomainService;

class FakeProvider implements DomainProvider {
  readonly name = "railway" as const;
  registered = new Set<string>();
  cert = new Map<string, string>();
  ensured: string[] = [];
  removed: string[] = [];
  view(domain: string): ProviderDomainStatus {
    if (!this.registered.has(domain)) return { provider: "railway", registered: false, certificate: "unknown", detail: "", records: [] };
    const label = domain.split(".")[0];
    const propagated = (cname.get(domain) ?? []).includes(RAILWAY_TARGET);
    return {
      provider: "railway",
      registered: true,
      certificate: (this.cert.get(domain) as ProviderDomainStatus["certificate"]) ?? "pending",
      detail: "",
      records: [{ type: "CNAME", fqdn: domain, hostlabel: label, zone: registrableDomain(domain), value: RAILWAY_TARGET, current: "", propagated, purpose: "traffic" }],
    };
  }
  async ensure(domain: string) {
    this.ensured.push(domain);
    this.registered.add(domain);
    return this.view(domain);
  }
  async status(domain: string) {
    return this.view(domain);
  }
  async remove(domain: string) {
    this.removed.push(domain);
    this.registered.delete(domain);
  }
}

const dns = {
  resolveTxt: async (h: string) => {
    const v = txt.get(h);
    if (!v) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return v;
  },
  resolveCname: async (h: string) => {
    const v = cname.get(h);
    if (!v) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return v;
  },
};

async function tenant(id: string, sub = true) {
  await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
  await registry.setStatus(id, "active", OP);
  if (sub) {
    await registry.addDomain(id, `${id}.app.bigelephant.es`, "platform_subdomain", OP);
    await registry.activateDomain(`${id}.app.bigelephant.es`, OP);
    await registry.setPrimaryDomain(id, `${id}.app.bigelephant.es`, OP);
  }
}

const tokenOf = async (domain: string) => (await store.resolveDomain(domain))!.domain.verificationToken!;

beforeEach(async () => {
  store = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  registry = new TenantRegistryService(store, () => ring);
  txt = new Map();
  cname = new Map();
  provider = new FakeProvider();
  probeOk = new Map();
  probes = [];
  activated = [];
  allowance = { allowed: true, reason: null, max: 3 };
  svc = new CustomDomainService({
    reader: store,
    registry,
    provider,
    allowance: async () => allowance,
    platformDomains: ["app.bigelephant.es"],
    dns,
    probe: async (domain, expected) => {
      probes.push(domain);
      return probeOk.get(domain) === expected ? { ok: true, detail: "ok" } : { ok: false, detail: "El certificado HTTPS aún no es válido" };
    },
    onActivated: (t, d) => activated.push(`${t}:${d}`),
  });
  await tenant("alfa");
  await tenant("beta");
});

describe("conexión de un dominio propio, paso a paso", () => {
  it("TXT → alta en Railway → DNS → certificado → HTTPS → activo, en ese orden", async () => {
    const added = await svc.add("alfa", "  https://WWW.Alfa-Cliente.es/inicio ");
    expect(added).toMatchObject({ domain: "www.alfa-cliente.es", stage: "pending_verification", apex: false, zone: "alfa-cliente.es", primary: false });
    const token = await tokenOf("www.alfa-cliente.es");
    expect(added.records).toEqual([{ type: "TXT", name: "_elephant-verify.www", fqdn: `${VERIFY_LABEL}.www.alfa-cliente.es`, value: expectedTxtValue(token), purpose: "ownership", ok: false }]);

    // Sin TXT: sigue pendiente y NO se da de alta en el proveedor
    let v = await svc.check("alfa", "www.alfa-cliente.es");
    expect(v.stage).toBe("pending_verification");
    expect(v.message).toMatch(/Aún no vemos el registro TXT/);
    expect(provider.ensured).toEqual([]);

    // Con TXT: verificado y alta en Railway; los registros son los de Railway para ESE dominio
    txt.set(`${VERIFY_LABEL}.www.alfa-cliente.es`, [[expectedTxtValue(token)]]);
    v = await svc.check("alfa", "www.alfa-cliente.es");
    expect(provider.ensured).toEqual(["www.alfa-cliente.es"]);
    expect(v.stage).toBe("pending_dns");
    expect(v.records).toEqual([expect.objectContaining({ type: "CNAME", name: "www", value: RAILWAY_TARGET, purpose: "traffic", ok: false })]);
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain.status).toBe("verified");

    // CNAME creado: certificado en emisión
    cname.set("www.alfa-cliente.es", [RAILWAY_TARGET]);
    v = await svc.check("alfa", "www.alfa-cliente.es");
    expect(v.stage).toBe("pending_certificate");
    expect(probes).toEqual([]);

    // Certificado emitido pero HTTPS aún falla: NO se activa
    provider.cert.set("www.alfa-cliente.es", "issued");
    v = await svc.check("alfa", "www.alfa-cliente.es");
    expect(v.stage).toBe("checking");
    expect(v.https).toMatchObject({ ok: false });
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain.status).toBe("verified");
    expect(activated).toEqual([]);

    // HTTPS responde con el valor de ESTA empresa: activo y aviso
    probeOk.set("www.alfa-cliente.es", domainCheckValue("alfa", "www.alfa-cliente.es"));
    v = await svc.check("alfa", "www.alfa-cliente.es");
    expect(v.stage).toBe("active");
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain.status).toBe("active");
    expect(activated).toEqual(["alfa:www.alfa-cliente.es"]);
    // La auditoría deja rastro con el actor del panel
    const actions = (await store.listEvents("alfa", 50)).map((e) => `${e.action}:${e.actorType}`);
    expect(actions).toEqual(expect.arrayContaining(["domain.added:crm", "domain.verified:crm", "domain.activated:crm"]));
  });

  it("si la web responde con el valor de OTRA empresa (apunta a otro sitio), no se activa", async () => {
    await svc.add("alfa", "www.alfa-cliente.es");
    txt.set(`${VERIFY_LABEL}.www.alfa-cliente.es`, [[expectedTxtValue(await tokenOf("www.alfa-cliente.es"))]]);
    cname.set("www.alfa-cliente.es", [RAILWAY_TARGET]);
    provider.cert.set("www.alfa-cliente.es", "issued");
    probeOk.set("www.alfa-cliente.es", domainCheckValue("beta", "www.alfa-cliente.es"));
    expect((await svc.check("alfa", "www.alfa-cliente.es")).stage).toBe("checking");
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain.status).toBe("verified");
  });

  it("certificado fallido → error con explicación; dominio raíz → aviso de ALIAS o www", async () => {
    await svc.add("alfa", "alfa-cliente.es");
    txt.set(`${VERIFY_LABEL}.alfa-cliente.es`, [[expectedTxtValue(await tokenOf("alfa-cliente.es"))]]);
    let v = await svc.check("alfa", "alfa-cliente.es");
    expect(v.apex).toBe(true);
    expect(v.message).toMatch(/ALIAS\/ANAME o conecta www\.alfa-cliente\.es/);
    expect(v.records[0]).toMatchObject({ name: "@" });
    cname.set("alfa-cliente.es", [RAILWAY_TARGET]);
    provider.cert.set("alfa-cliente.es", "failed");
    v = await svc.check("alfa", "alfa-cliente.es");
    expect(v.stage).toBe("error");
    expect(v.message).toMatch(/certificado/);
  });

  it("un activo que deja de responder se muestra con error (sin desactivarlo solo)", async () => {
    await svc.add("alfa", "www.alfa-cliente.es");
    txt.set(`${VERIFY_LABEL}.www.alfa-cliente.es`, [[expectedTxtValue(await tokenOf("www.alfa-cliente.es"))]]);
    cname.set("www.alfa-cliente.es", [RAILWAY_TARGET]);
    provider.cert.set("www.alfa-cliente.es", "issued");
    probeOk.set("www.alfa-cliente.es", domainCheckValue("alfa", "www.alfa-cliente.es"));
    expect((await svc.check("alfa", "www.alfa-cliente.es")).stage).toBe("active");
    probeOk.delete("www.alfa-cliente.es");
    const v = await svc.check("alfa", "www.alfa-cliente.es");
    expect(v.stage).toBe("error");
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain.status).toBe("active");
  });
});

describe("reglas y aislamiento", () => {
  it("rechaza lo que no puede ser un dominio propio", async () => {
    for (const bad of ["beta.app.bigelephant.es", "admin.bigelephant.es", "bigelephant.es", "core-production.up.railway.app", "192.168.1.1", "localhost", "sin-punto", "a.b/../c", "www.cliente.es:8443"]) {
      await expect(svc.add("alfa", bad)).rejects.toMatchObject({ status: 400, code: "invalid_domain" });
    }
    expect((await store.listDomains("alfa")).filter((d) => d.kind === "custom")).toEqual([]);
  });

  it("el plan decide antes de crear nada (prueba gratuita o límite)", async () => {
    allowance = { allowed: false, reason: "El dominio propio se activa tras el primer pago confirmado.", max: 0 };
    await expect(svc.add("alfa", "www.alfa-cliente.es")).rejects.toMatchObject({ status: 403, code: "not_allowed", message: expect.stringMatching(/primer pago/) });
    expect(await store.resolveDomain("www.alfa-cliente.es")).toBeNull();
    const o = await svc.overview("alfa");
    expect(o.allowance).toMatchObject({ allowed: false, reason: expect.stringMatching(/primer pago/) });
  });

  it("otra empresa no puede reclamar, comprobar, desconectar ni hacer principal un dominio ajeno", async () => {
    await svc.add("alfa", "www.alfa-cliente.es");
    const taken = (await svc.add("beta", "WWW.alfa-cliente.es").catch((e) => e)) as CustomDomainError;
    expect(taken).toMatchObject({ status: 409, code: "domain_taken" });
    expect(taken.message).not.toMatch(/alfa/i);
    for (const op of [() => svc.check("beta", "www.alfa-cliente.es"), () => svc.disconnect("beta", "www.alfa-cliente.es"), () => svc.setPrimary("beta", "www.alfa-cliente.es"), () => svc.setPrimary("beta", "alfa.app.bigelephant.es")]) {
      await expect(op()).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    expect((await svc.overview("beta")).domains).toEqual([]);
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain).toMatchObject({ tenantId: "alfa", status: "pending_verification" });
  });

  it("el subdominio de plataforma no se toca como dominio propio", async () => {
    await expect(svc.check("alfa", "alfa.app.bigelephant.es")).rejects.toMatchObject({ status: 404 });
    await expect(svc.disconnect("alfa", "alfa.app.bigelephant.es")).rejects.toMatchObject({ status: 404 });
  });
});

describe("principal, desconexión y reconexión", () => {
  async function activate(t: string, domain: string) {
    await svc.add(t, domain);
    txt.set(`${VERIFY_LABEL}.${domain}`, [[expectedTxtValue(await tokenOf(domain))]]);
    cname.set(domain, [RAILWAY_TARGET]);
    provider.cert.set(domain, "issued");
    probeOk.set(domain, domainCheckValue(t, domain));
    expect((await svc.check(t, domain)).stage).toBe("active");
  }

  it("solo un dominio activo puede ser principal; desconectar el principal devuelve la dirección de la plataforma", async () => {
    await svc.add("alfa", "tienda.alfa-cliente.es");
    await expect(svc.setPrimary("alfa", "tienda.alfa-cliente.es")).rejects.toMatchObject({ code: "not_active" });
    await activate("alfa", "www.alfa-cliente.es");
    let o = await svc.setPrimary("alfa", "www.alfa-cliente.es");
    expect(o).toMatchObject({ primary: "www.alfa-cliente.es", fallback: "alfa.app.bigelephant.es" });
    o = await svc.disconnect("alfa", "www.alfa-cliente.es");
    expect(o.primary).toBe("alfa.app.bigelephant.es");
    expect(o.domains.find((d) => d.domain === "www.alfa-cliente.es")).toMatchObject({ stage: "disconnected", primary: false });
    expect(provider.removed).toEqual(["www.alfa-cliente.es"]);
    expect((await store.resolveDomain("alfa.app.bigelephant.es"))!.domain.isPrimary).toBe(true);
    // El disconnected no cuenta para el límite
    expect(o.allowance.used).toBe(1);
  });

  it("reconectar pide de nuevo la titularidad con un token nuevo", async () => {
    await activate("alfa", "www.alfa-cliente.es");
    const old = txt.get(`${VERIFY_LABEL}.www.alfa-cliente.es`)![0][0];
    await svc.disconnect("alfa", "www.alfa-cliente.es");
    const again = await svc.add("alfa", "www.alfa-cliente.es");
    expect(again.stage).toBe("pending_verification");
    const token = await tokenOf("www.alfa-cliente.es");
    expect(token).toBeTruthy();
    expect(again.records[0].value).toBe(expectedTxtValue(token));
    expect(again.records[0].value).not.toBe(old);
    // El TXT anterior ya no vale
    expect((await svc.check("alfa", "www.alfa-cliente.es")).stage).toBe("pending_verification");
    // Otra empresa sigue sin poder reclamarlo mientras está desconectado
    await expect(svc.add("beta", "www.alfa-cliente.es")).rejects.toMatchObject({ code: "domain_taken" });
  });
});

describe("comprobaciones automáticas", () => {
  it("avanzan los pendientes de todas las empresas y un fallo no corta a las demás", async () => {
    await svc.add("alfa", "www.alfa-cliente.es");
    await svc.add("beta", "www.beta-cliente.es");
    txt.set(`${VERIFY_LABEL}.www.alfa-cliente.es`, [[expectedTxtValue(await tokenOf("www.alfa-cliente.es"))]]);
    txt.set(`${VERIFY_LABEL}.www.beta-cliente.es`, [[expectedTxtValue(await tokenOf("www.beta-cliente.es"))]]);
    cname.set("www.beta-cliente.es", [RAILWAY_TARGET]);
    provider.cert.set("www.beta-cliente.es", "issued");
    probeOk.set("www.beta-cliente.es", domainCheckValue("beta", "www.beta-cliente.es"));
    const ensure = provider.ensure.bind(provider);
    provider.ensure = async (d: string) => (d.startsWith("www.alfa") ? Promise.reject(new Error("Railway caído")) : ensure(d));
    const r = await svc.runScheduled();
    expect(r).toMatchObject({ checked: 2, activated: 1 });
    expect((await store.resolveDomain("www.beta-cliente.es"))!.domain.status).toBe("active");
    expect((await store.resolveDomain("www.alfa-cliente.es"))!.domain.status).toBe("verified");
    expect((await svc.overview("alfa")).domains[0].stage).toBe("pending_dns");
  });
});

describe("nombres y registros", () => {
  it("zona, dominio raíz y nombre relativo", () => {
    expect(registrableDomain("www.cliente.es")).toBe("cliente.es");
    expect(registrableDomain("reservas.cliente.com.es")).toBe("cliente.com.es");
    expect(isApexDomain("cliente.co.uk")).toBe(true);
    expect(isApexDomain("www.cliente.es")).toBe(false);
    expect(relativeName("_elephant-verify.www.cliente.es", "cliente.es")).toBe("_elephant-verify.www");
    expect(relativeName("cliente.es.", "cliente.es")).toBe("@");
  });

  it("los registros de Railway se traducen tal cual (sin inventar destinos)", () => {
    expect(dnsRecordOf({ fqdn: "www.cliente.es", hostlabel: "www", zone: "cliente.es", recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "x9.up.railway.app", currentValue: "", status: "DNS_RECORD_STATUS_REQUIRES_UPDATE", purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE" })).toEqual({
      type: "CNAME", fqdn: "www.cliente.es", hostlabel: "www", zone: "cliente.es", value: "x9.up.railway.app", current: "", propagated: false, purpose: "traffic",
    });
    expect(dnsRecordOf({ recordType: "DNS_RECORD_TYPE_TXT", requiredValue: "v", status: "DNS_RECORD_STATUS_PROPAGATED", purpose: "DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE" })).toMatchObject({ type: "TXT", propagated: true, purpose: "certificate", hostlabel: "@" });
    expect(dnsRecordOf({ recordType: "DNS_RECORD_TYPE_UNSPECIFIED", requiredValue: "v" })).toBeNull();
    expect(dnsRecordOf({ recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "" })).toBeNull();
  });
});

// ── HTTP: consulta de la pasarela en el Core y canal del panel ──────────────────

function serve(app: express.Express) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const s = http.createServer(app).listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });
}

function get(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("Core: consulta de la pasarela y comprobación HTTPS", () => {
  it("solo un dominio propio ACTIVO se sirve sin la contraseña de la pasarela; el verificado, solo en la comprobación", async () => {
    await registry.addDomain("alfa", "www.activo.es", "custom", OP);
    await registry.markDomainVerified("www.activo.es", OP);
    await registry.activateDomain("www.activo.es", OP);
    await registry.addDomain("beta", "www.verificado.es", "custom", OP);
    await registry.markDomainVerified("www.verificado.es", OP);
    await registry.addDomain("beta", "www.pendiente.es", "custom", OP);
    const app = express();
    app.use(createDomainCheckRouter({ resolver: new TenantResolver(store), reader: store }));
    app.use((_req, res) => void res.status(418).end());
    const s = await serve(app);
    try {
      const gw = (host: string, uri = "/") => get(`${s.url}${PUBLIC_HOST_PATH}`, { host, "x-forwarded-uri": uri }).then((r) => r.status);
      expect(await gw("www.activo.es")).toBe(204);
      expect(await gw("WWW.ACTIVO.ES:443", "/admin")).toBe(204);
      expect(await gw("alfa.app.bigelephant.es")).toBe(403); // los de plataforma van por PUBLIC_HOSTS
      expect(await gw("www.verificado.es")).toBe(403);
      expect(await gw("www.verificado.es", DOMAIN_CHECK_PATH)).toBe(204);
      expect(await gw("www.verificado.es", `${DOMAIN_CHECK_PATH}?x=1`)).toBe(204);
      expect(await gw("www.verificado.es", `${DOMAIN_CHECK_PATH}/../admin`)).toBe(403);
      expect(await gw("www.pendiente.es", DOMAIN_CHECK_PATH)).toBe(403);
      expect(await gw("desconocido.es")).toBe(403);
      expect(await gw("core-production.up.railway.app")).toBe(403);

      const check = (host: string) => get(`${s.url}${DOMAIN_CHECK_PATH}`, { host });
      expect(await check("www.activo.es")).toEqual({ status: 200, text: domainCheckValue("alfa", "www.activo.es") });
      expect(await check("www.verificado.es")).toEqual({ status: 200, text: domainCheckValue("beta", "www.verificado.es") });
      expect((await check("www.pendiente.es")).status).toBe(404);
      expect((await check("alfa.app.bigelephant.es")).status).toBe(404);
      // El resto de rutas sigue su camino (resolución de empresa)
      expect((await get(`${s.url}/`, { host: "www.activo.es" })).status).toBe(418);
    } finally {
      s.close();
    }
  });
});

describe("canal del panel (/commerce/tenants/:id/domains)", () => {
  it("exige el ámbito del canal y valida la empresa; la empresa de la ruta delimita lo que se ve", async () => {
    const CORE = "core-token-aaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER = "other-token-bbbbbbbbbbbbbbbbbbbbbbb";
    const app = express();
    app.use(express.json());
    app.use(authenticate([{ id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] }, { id: "crm", sha256: hashToken(OTHER), scopes: ["tenants:read"] }]));
    app.use("/commerce", createPanelDomainsRouter(svc));
    const s = await serve(app);
    const call = (method: string, path: string, token: string, body?: unknown) =>
      fetch(`${s.url}/commerce${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: (await r.json().catch(() => null)) as any }));
    try {
      expect((await call("GET", "/tenants/alfa/domains", OTHER)).status).toBe(403);
      expect((await call("GET", "/tenants/ALFA!/domains", CORE)).status).toBe(400);
      const add = await call("POST", "/tenants/alfa/domains", CORE, { domain: "www.alfa-cliente.es", requestedBy: "user:1" });
      expect(add.status).toBe(201);
      expect(add.json.domain).toMatchObject({ domain: "www.alfa-cliente.es", stage: "pending_verification" });
      expect((await call("GET", "/tenants/alfa/domains", CORE)).json.overview.domains).toHaveLength(1);
      expect((await call("GET", "/tenants/beta/domains", CORE)).json.overview.domains).toEqual([]);
      const foreign = await call("POST", "/tenants/beta/domains/www.alfa-cliente.es/disconnect", CORE, {});
      expect(foreign).toMatchObject({ status: 404, json: { error: "not_found" } });
      expect((await call("POST", "/tenants/alfa/domains", CORE, { domain: "admin.bigelephant.es" })).status).toBe(400);
      const check = await call("POST", "/tenants/alfa/domains/www.alfa-cliente.es/check", CORE, {});
      expect(check.json.domain.stage).toBe("pending_verification");
    } finally {
      s.close();
    }
  });
});
