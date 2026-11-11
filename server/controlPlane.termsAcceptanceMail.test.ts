/**
 * Envío automático y recuperación permanente del enlace de aceptación de unas condiciones comerciales personalizadas
 * (plano de control, por HTTP): el contrato sale por el correo de plataforma (proveedor en memoria, nunca un cliente
 * real), el enlace se guarda cifrado y se recupera tras «cerrar y recargar», abrirlo no lo consume, el reenvío no crea
 * otro contrato, el enlace caducado se regenera para el mismo contrato y la misma versión, solo vale una aceptación y
 * el contrato aceptado se descarga en PDF. En todo el recorrido no se llama a Stripe ni a la facturación (espía).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { ROLE_SCOPES } from "./controlPlane/operatorRoles";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryTermsStore } from "./commercialTerms/store";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryExternalStore } from "./external/store";
import { MemoryAcceptanceLinkStore } from "./commercialTerms/acceptanceLinks";
import type { NegotiatedBillingGateway } from "./commercialTerms/billing";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { PlatformMailer } from "./mail/platform";
import { MailProviderError } from "./mail/types";

const TOK = { admin: "send-admin-token-aaaaaaaaaaaaaaaaaaaaaa", sales: "send-sales-token-bbbbbbbbbbbbbbbbbbbbbb", service: "send-service-token-cccccccccccccccccccc" };
const PUBLIC = "https://admin.example.test/cp/v1/public/contract-acceptance";
const DAY = 86_400_000;
let clock = Date.UTC(2026, 10, 11, 10);
const servers: http.Server[] = [];
let port = 0;
let P: Record<string, number> = {};
let companyId = 0;
let subscriptionId = 0;

// Almacenes que sobreviven a «cerrar y recargar» (otra instancia del plano de control sobre los mismos datos)
const crmStore = new MemoryCrmStore();
const acceptanceStore = new MemoryExternalStore("test");
const linkStore = new MemoryAcceptanceLinkStore();
const subsStore = new MemorySubscriptionStore();
const termsStore = new MemoryTermsStore();
const caps = new MemoryCapabilityStore();
const tenantLimits = new MemoryTenantLimitStore();
const webStore = new MemoryWebStore();
const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);

// Correo de plataforma con el proveedor en memoria: solo el dominio de pruebas está autorizado
const mailStore = new MemoryMailStore();
const provider = memoryProvider();
const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.example", MAIL_SANDBOX_ALLOWLIST: "cliente-prueba.example", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "contract_invitation" } as NodeJS.ProcessEnv);
const mailService = new MailService({ lane: "platform", store: mailStore, provider, policy, now: () => clock });
const mailer = new PlatformMailer(mailService, policy);

// Espía de la facturación: cualquier llamada a la pasarela de Stripe o al enlace con Stripe queda registrada
const billingCalls: string[] = [];
const gateway = new Proxy({} as NegotiatedBillingGateway, {
  get: (_t, prop) =>
    typeof prop === "string" && prop !== "then"
      ? async () => {
          billingCalls.push(prop);
          throw new Error("No se debe llamar a Stripe");
        }
      : undefined,
});
const link = async () => {
  billingCalls.push("link");
  return null;
};

const call = (method: string, path: string, o: { token?: string; body?: unknown; p?: number } = {}) =>
  new Promise<{ status: number; json: any; headers: http.IncomingHttpHeaders; buf: Buffer }>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request(
      { host: "127.0.0.1", port: o.p ?? port, path: `/cp/v1${path}`, method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const isJson = String(res.headers["content-type"] ?? "").includes("json");
          resolve({ status: res.statusCode ?? 0, json: isJson && buf.length ? JSON.parse(buf.toString("utf8")) : null, headers: res.headers, buf });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const raw = (method: string, path: string, form?: Record<string, string>) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const data = form ? new URLSearchParams(form).toString() : undefined;
    const req = http.request({ host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(data ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(data) } : {}), "user-agent": "navegador-de-prueba" } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const publicPath = (url: string) => url.replace("https://admin.example.test/cp/v1", "");
const tokenOf = (url: string) => url.split("token=")[1];

/** Una instancia del plano de control sobre los almacenes compartidos (cada una es «otra carga» de la aplicación). */
async function boot(o: { bare?: boolean } = {}): Promise<number> {
  const reg = new MemoryTenantRegistryStore();
  const registry = new TenantRegistryService(reg, () => ring);
  const crm = new CrmService({ store: crmStore });
  const admin = ROLE_SCOPES.admin.filter((s) => !s.startsWith("commerce:"));
  const app = createControlPlaneApp({
    tokens: [
      { id: "ana", sha256: hashToken(TOK.admin), scopes: [...admin], actorType: "operator" },
      { id: "comercial", sha256: hashToken(TOK.sales), scopes: [...ROLE_SCOPES.sales], actorType: "operator" },
      { id: "integracion", sha256: hashToken(TOK.service), scopes: [...admin] },
    ],
    registry,
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock, terms: termsStore, termsBilling: { enabled: true, gateway, link } },
    external: { store: acceptanceStore, urls: { acceptance: PUBLIC, setupSuccess: `${PUBLIC}/autorizado`, setupCancel: `${PUBLIC}/cancelado`, portalReturn: `${PUBLIC}/portal` }, ipSalt: "sal-de-pruebas-para-seudonimizar-ips" },
    // `bare`: entorno sin la migración 0051 ni correo de plataforma (como antes)
    ...(o.bare ? {} : { termsAcceptance: { links: { store: linkStore, keyring: ring } }, mail: { platform: mailer } }),
    capabilities: caps,
    limits: tenantLimits,
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

beforeAll(async () => {
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  for (const key of ["essential", "connect-voice", "hotel-net-complete"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  companyId = (await new CrmService({ store: crmStore }).createCompany({ name: "PRUEBA TÉCNICA Condiciones", legalName: "Prueba Técnica Condiciones, S.L.", taxId: "B12345674" }, "t")).id;
  port = await boot();
  const s = await call("POST", "/subscriptions", { token: TOK.admin, body: { companyId, interval: "month", plan: { productKey: "essential", priceId: P.essential }, addons: [{ productKey: "connect-voice", priceId: P["connect-voice"] }] } });
  expect(s.status).toBe(201);
  subscriptionId = s.json.subscription.id;
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe("condiciones personalizadas · envío automático y enlace recuperable", () => {
  const signer = { name: "Marta Ruiz", email: "marta@cliente-prueba.example", role: "Administradora única" };
  let termsId = 0;
  let revision = 0;
  let url = "";
  let contractId = 0;
  let contractVersion = 0;
  let sha = "";

  it("«Enviar a aceptación»: genera el contrato y su enlace, y manda el correo al representante con las cifras del documento", async () => {
    const created = await call("POST", `/subscriptions/${subscriptionId}/terms`, {
      token: TOK.admin,
      body: {
        pricingMode: "global",
        globalAmountCents: 12900,
        presentation: "global",
        packageName: "Paquete Hotel",
        requiresAcceptance: true,
        reason: "Oferta negociada con el cliente",
        lines: [
          { kind: "catalog", productKey: "essential", priceId: P.essential },
          { kind: "catalog", productKey: "hotel-net-complete", priceId: P["hotel-net-complete"] },
        ],
      },
    });
    expect(created.status).toBe(201);
    termsId = created.json.terms.id;
    const sent = await call("POST", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin, body: { signer, expectedRevision: created.json.terms.revision } });
    expect(sent.status).toBe(201);
    url = sent.json.url;
    contractId = sent.json.contract.id;
    contractVersion = sent.json.contract.version;
    sha = sent.json.documentSha256;
    revision = sent.json.terms.revision;
    expect(sent.json.recoverable).toBe(true);
    expect(sent.json.mail).toMatchObject({ to: "marta@cliente-prueba.example", ok: true, message: null });
    expect(["pending", "accepted"]).toContain(sent.json.mail.status);
    // El correo sale por la bandeja de plataforma, categoría del contrato, al representante indicado
    await mailService.drain(10);
    expect(provider.sent).toHaveLength(1);
    const m = provider.sent[0];
    expect(m.to).toBe("marta@cliente-prueba.example");
    expect(m.subject).toContain(sent.json.contract.reference);
    const html = m.html.replace(/&amp;/g, "&");
    expect(html).toContain("Prueba Técnica Condiciones, S.L.");
    expect(html).toContain("Essential");
    expect(html).toContain("Hotel Net");
    expect(html).toContain("Revisar y aceptar contrato");
    expect(html).toContain(url);
    // Mismas cifras que el documento; con cuota global, ningún importe por partida
    const doc = (await call("GET", `/commercial-terms/${termsId}/document`, { token: TOK.admin })).json;
    expect(doc.text).toMatch(/Cuota global pactada: 129,00\s€ al mes/);
    expect(html).toMatch(/129,00\s€/);
    expect(html).toMatch(/156,09\s€/);
    const preview = (await call("GET", `/commercial-terms/${termsId}/preview`, { token: TOK.admin })).json;
    for (const l of preview.summary.recurring.lines) expect(html.includes((l.netCents / 100).toFixed(2).replace(".", ","))).toBe(l.netCents === 12900);
    // Constan destinatario, fecha, resultado y contrato
    const status = (await call("GET", `/commercial-terms/${termsId}/acceptance`, { token: TOK.sales })).json;
    expect(status.sends).toEqual([expect.objectContaining({ kind: "sent", recipientEmail: "marta@cliente-prueba.example", contractId, contractVersion, status: "accepted", ok: true, createdAt: clock })]);
    // El estado (lectura) nunca lleva el enlace
    expect(JSON.stringify(status)).not.toContain(tokenOf(url));
    // Y el enlace no se guarda en claro
    expect(JSON.stringify(Array.from(linkStore.links.values()))).not.toContain(tokenOf(url));
  });

  it("el enlace se recupera tras cerrar y recargar, tantas veces como haga falta, y solo con el permiso de precios", async () => {
    const other = await boot();
    for (const p of [port, other, other]) {
      const l = await call("GET", `/commercial-terms/${termsId}/acceptance/link`, { token: TOK.admin, p });
      expect(l.status).toBe(200);
      expect(l.headers["cache-control"]).toBe("no-store");
      expect(l.json).toMatchObject({ url, status: "pending", recoverable: true, signer: { email: "marta@cliente-prueba.example" }, contract: { id: contractId, version: contractVersion }, documentSha256: sha });
    }
    for (const token of [TOK.sales, TOK.service]) expect((await call("GET", `/commercial-terms/${termsId}/acceptance/link`, { token })).status).toBe(403);
    expect((await call("GET", `/commercial-terms/${termsId}/acceptance/link`)).status).toBe(401);
  });

  it("abrir el enlace no lo consume: se abre varias veces sin sesión antes de aceptar", async () => {
    for (let i = 0; i < 3; i++) {
      const page = await raw("GET", publicPath(url));
      expect(page.status).toBe(200);
      expect(page.body).toContain("Marta Ruiz");
    }
    expect((await call("GET", `/commercial-terms/${termsId}/acceptance/link`, { token: TOK.admin })).json).toMatchObject({ url, status: "pending" });
  });

  it("si el correo falla se ve el motivo y se reenvía el mismo enlace sin crear otro contrato", async () => {
    provider.failWith = new MailProviderError("rejected", false, 422);
    const again = await call("POST", `/commercial-terms/${termsId}/acceptance/resend`, { token: TOK.admin, body: {} });
    expect(again.status).toBe(200);
    expect(again.json.url).toBe(url);
    await mailService.drain(10);
    const failed = (await call("GET", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin })).json.sends[0];
    expect(failed).toMatchObject({ kind: "resent", status: "failed", ok: false });
    expect(failed.message).toBeTruthy();
    provider.failWith = null;
    const retry = await call("POST", `/commercial-terms/${termsId}/acceptance/resend`, { token: TOK.admin, body: {} });
    expect(retry.status).toBe(200);
    expect(retry.json.mail).toMatchObject({ ok: true, to: "marta@cliente-prueba.example" });
    await mailService.drain(10);
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[1].html.replace(/&amp;/g, "&")).toContain(url);
    // Un solo contrato y la misma versión; el enlace sigue siendo el mismo y válido
    expect((await crmStore.list("contracts", { companyId })).filter((c) => c.status !== "cancelled")).toHaveLength(1);
    expect((await crmStore.get("contracts", contractId))!.version).toBe(contractVersion);
    expect((await raw("GET", publicPath(url))).status).toBe(200);
    const sends = (await call("GET", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin })).json.sends;
    expect(sends.map((s: { kind: string }) => s.kind)).toEqual(["resent", "resent", "sent"]);
    // Solo quien gestiona precios reenvía
    expect((await call("POST", `/commercial-terms/${termsId}/acceptance/resend`, { token: TOK.sales, body: {} })).status).toBe(403);
  });

  it("caducado: no se reenvía; se regenera para el mismo contrato y versión, el antiguo muere y el nuevo funciona", async () => {
    const before = (await call("GET", `/commercial-terms/${termsId}`, { token: TOK.admin })).json.terms;
    // Pasa el plazo del enlace (30 días): se adelanta su caducidad para no arrastrar las renovaciones del mes
    clock += DAY;
    for (const r of acceptanceStore.acceptRows) if (r.status === "pending") r.expiresAt = clock - 1;
    expect((await raw("GET", publicPath(url))).status).toBe(409);
    const dead = (await call("GET", `/commercial-terms/${termsId}/acceptance/link`, { token: TOK.admin })).json;
    expect(dead).toMatchObject({ status: "expired", url: null });
    const resend = await call("POST", `/commercial-terms/${termsId}/acceptance/resend`, { token: TOK.admin, body: {} });
    expect(resend.status).toBe(409);
    expect(resend.json.details).toMatchObject({ reason: "link_not_pending" });
    expect((await call("POST", `/commercial-terms/${termsId}/acceptance/regenerate`, { token: TOK.sales, body: { expectedRevision: revision } })).status).toBe(403);
    const regen = await call("POST", `/commercial-terms/${termsId}/acceptance/regenerate`, { token: TOK.admin, body: { expectedRevision: revision } });
    expect(regen.json?.message ?? null).toBeNull();
    expect(regen.status).toBe(201);
    expect(regen.json.url).not.toBe(url);
    expect(regen.json.contract).toMatchObject({ id: contractId, version: contractVersion });
    expect(regen.json.documentSha256).toBe(sha);
    expect(regen.json.mail).toMatchObject({ ok: true });
    const old = url;
    url = regen.json.url;
    revision = regen.json.terms.revision;
    // Las condiciones económicas no cambian
    const after = (await call("GET", `/commercial-terms/${termsId}`, { token: TOK.admin })).json.terms;
    expect({ lines: after.lines, adjustments: after.adjustments, globalAmountCents: after.globalAmountCents, presentation: after.presentation }).toEqual({ lines: before.lines, adjustments: before.adjustments, globalAmountCents: before.globalAmountCents, presentation: before.presentation });
    expect((await crmStore.get("contracts", contractId))!.version).toBe(contractVersion);
    expect((await raw("GET", publicPath(old))).status).toBe(409);
    expect((await raw("GET", publicPath(url))).status).toBe(200);
    expect((await call("GET", `/commercial-terms/${termsId}/acceptance/link`, { token: TOK.admin })).json).toMatchObject({ url, status: "pending", contract: { id: contractId, version: contractVersion } });
    await mailService.drain(10);
    expect(provider.sent.at(-1)!.html.replace(/&amp;/g, "&")).toContain(url);
    // Un enlace vigente que se ha filtrado también se puede sustituir; la revisión leída protege de pisar a otro
    expect((await call("POST", `/commercial-terms/${termsId}/acceptance/regenerate`, { token: TOK.admin, body: { expectedRevision: revision - 1 } })).status).toBe(409);
  });

  it("antes de aceptar no hay contrato aceptado que descargar", async () => {
    expect((await call("GET", `/commercial-terms/${termsId}/acceptance/contract.pdf`, { token: TOK.admin })).status).toBe(409);
    // Enviar, consultar, abrir, reenviar y regenerar el enlace: ninguna llamada a Stripe ni a su enlace
    expect(billingCalls).toEqual([]);
  });

  it("solo una aceptación vale: el enlace se cierra al aceptar y el antiguo nunca sirve", async () => {
    const token = tokenOf(url);
    const [a, b] = await Promise.all([raw("POST", publicPath(url), { token, name: "Marta Ruiz Gómez", accept: "1" }), raw("POST", publicPath(url), { token, name: "Otra Persona", accept: "1" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await raw("GET", publicPath(url))).status).toBe(409);
    const rows = await acceptanceStore.acceptances(contractId);
    expect(rows.filter((r) => r.status === "accepted")).toHaveLength(1);
    expect(rows.find((r) => r.status === "accepted")).toMatchObject({ contractVersion, documentSha256: sha, signerEmail: "marta@cliente-prueba.example" });
    const status = (await call("GET", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin })).json;
    expect(status.acceptanceStatus).toBe("accepted");
    expect(status.contract).toMatchObject({ id: contractId, status: "signed" });
    // Ya no hay enlace que consultar ni reenviar
    expect((await call("GET", `/commercial-terms/${termsId}/acceptance/link`, { token: TOK.admin })).json).toMatchObject({ status: "accepted", url: null });
    expect((await call("POST", `/commercial-terms/${termsId}/acceptance/resend`, { token: TOK.admin, body: {} })).status).toBe(409);
  });

  it("el contrato aceptado se descarga en PDF con su versión y huella", async () => {
    const pdf = await call("GET", `/commercial-terms/${termsId}/acceptance/contract.pdf`, { token: TOK.sales });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(String(pdf.headers["content-disposition"])).toMatch(new RegExp(`attachment; filename="CT-[^"]*-v${contractVersion}-aceptado\\.pdf"`));
    expect(pdf.buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("en todo el recorrido no se cobró nada: ninguna operación de la pasarela de Stripe", () => {
    // La activación tras aceptar solo PREGUNTA si la suscripción está enlazada con Stripe (no lo está: nada que cobrar)
    expect(billingCalls.filter((c) => c !== "link")).toEqual([]);
  });
});

describe("condiciones personalizadas · sin la migración 0051 ni correo de plataforma", () => {
  it("se envía a aceptación como antes: el enlace se entrega una vez, el correo consta como no disponible y no se reenvía", async () => {
    const p = await boot({ bare: true });
    const company = (await new CrmService({ store: crmStore }).createCompany({ name: "Empresa sin correo" }, "t")).id;
    const created = await call("POST", "/commercial-terms/packages", { p, token: TOK.admin, body: { companyId: company, interval: "month", pricingMode: "global", globalAmountCents: 9900, presentation: "global", requiresAcceptance: true, reason: "Oferta negociada con el cliente", lines: [{ kind: "catalog", productKey: "essential", priceId: P.essential }] } });
    expect(created.status).toBe(201);
    const id = created.json.terms.id;
    const before = provider.sent.length;
    const sent = await call("POST", `/commercial-terms/${id}/acceptance`, { p, token: TOK.admin, body: { signer: { name: "Luis Pérez", email: "luis@cliente-prueba.example" }, expectedRevision: created.json.terms.revision } });
    expect(sent.status).toBe(201);
    expect(sent.json.url).toMatch(/token=[A-Za-z0-9_-]{40,60}$/);
    expect(sent.json.recoverable).toBe(false);
    expect(sent.json.mail).toMatchObject({ status: "unavailable", ok: false, message: "El correo de plataforma no está configurado en este entorno." });
    expect(provider.sent.length).toBe(before);
    expect((await call("GET", `/commercial-terms/${id}/acceptance/link`, { p, token: TOK.admin })).json).toMatchObject({ available: false, status: "pending", url: null, recoverable: false });
    const resend = await call("POST", `/commercial-terms/${id}/acceptance/resend`, { p, token: TOK.admin, body: {} });
    expect(resend.status).toBe(409);
    expect(resend.json.details).toMatchObject({ reason: "links_unavailable" });
    // Sigue pudiéndose sustituir por uno nuevo (mismo contrato), que se entrega en la respuesta
    const regen = await call("POST", `/commercial-terms/${id}/acceptance/regenerate`, { p, token: TOK.admin, body: { expectedRevision: sent.json.terms.revision } });
    expect(regen.status).toBe(201);
    expect(regen.json.contract.id).toBe(sent.json.contract.id);
    expect(regen.json.url).not.toBe(sent.json.url);
  });
});
