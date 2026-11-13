/**
 * Soporte delegado completo (13/11/2026): modificación solo para administración, sesiones vigentes, auditoría firmada
 * del Core en el historial de la empresa, procedimientos vetados, exportaciones y enmascarado de secretos.
 */
import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { buildGrant, type SupportGrant } from "./_core/support/grants";
import { signSupportAudit, supportAuditSender, verifySupportAudit, SUPPORT_AUDIT_PATH } from "./_core/support/audit";
import { classifySupportRequest, maskForSupport, supportProcedureKind, trpcProcedures } from "./_core/support/policy";
import { signSupportToken } from "./_core/support/session";

const TOK = "sup-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "s".repeat(40);
let server: http.Server | null = null;

async function start(o: { role?: string } = {}) {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "test" });
  await registry.createTenant({ id: "otra", displayName: "Otra" }, { type: "operator", id: "test" });
  const grants = new Map<string, SupportGrant>();
  const events: Array<{ tenantId: string; operator: string; action: string; details: Record<string, unknown> }> = [];
  const support = {
    create: async (i: { tenantId: string; operator: string; reason: string; minutes: number; readOnly?: boolean }) => {
      const g = buildGrant(i, Date.now());
      grants.set(g.id, g);
      return g;
    },
    revoke: async (id: string) => void (grants.get(id)!.revokedAt = Date.now()),
    getGrant: async (id: string) => grants.get(id) ?? null,
    listActive: async (t: string) => [...grants.values()].filter((g) => g.tenantId === t && g.revokedAt === null && g.expiresAt > Date.now()),
    record: async (tenantId: string, operator: string, action: string, details: Record<string, unknown>) => void events.push({ tenantId, operator, action, details }),
  };
  const app = createControlPlaneApp({
    tokens: [{ id: "soporte", sha256: hashToken(TOK), scopes: ["tenants:read", "support:write"] }],
    registry,
    reader: reg,
    platformTarget: "edge.example.com",
    support: support as never,
    supportSecret: SECRET,
    // Sesión de operador humano con su rol (cookie + CSRF)
    ...(o.role ? { operators: { validateSession: async () => ({ operator: { id: 1, username: "persona", role: o.role }, session: { id: "s".repeat(16), csrfToken: "csrf-ok" }, scopes: ["tenants:read", "support:write"] }) } } : {}),
  } as never);
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const raw = (method: string, path: string, o: { token?: string; body?: unknown; session?: boolean } = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        { host: "127.0.0.1", port, path, method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.session ? { cookie: "be_cp_session=abc", "x-csrf-token": "csrf-ok" } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const call = (method: string, path: string, o: { token?: string; body?: unknown; session?: boolean } = {}) => raw(method, `/cp/v1${path}`, o);
  return { call, raw, grants, events, port };
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

describe("plano de control: concesiones", () => {
  it("modificación solo para administración (nunca un token de servicio ni el rol soporte); lectura sí", async () => {
    const h = await start();
    const rw = await h.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #12 de prueba", minutes: 30, readOnly: false } });
    expect(rw.status).toBe(403);
    const ro = await h.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #12 de prueba", minutes: 30 } });
    expect(ro.status).toBe(201);
    expect(ro.json.readOnly).toBe(true);
  });

  it("con sesión de operador: admin y superadmin pueden pedir modificación; el rol soporte no", async () => {
    for (const [role, status] of [["admin", 201], ["superadmin", 201], ["support", 403]] as const) {
      const h = await start({ role });
      const r = await h.call("POST", "/tenants/acme/support-access", { session: true, body: { reason: "Ticket #12 de prueba", minutes: 30, readOnly: false } });
      expect(r.status, role).toBe(status);
      if (status === 201) expect(r.json.readOnly).toBe(false);
      // Sin pedirlo expresamente, siempre solo lectura
      expect((await h.call("POST", "/tenants/acme/support-access", { session: true, body: { reason: "Ticket #12 de prueba", minutes: 30 } })).json.readOnly).toBe(true);
      server!.closeAllConnections();
      await new Promise<void>((x) => server!.close(() => x()));
      server = null;
    }
  });

  it("lista las sesiones vigentes de la empresa, sin las de otras ni las revocadas", async () => {
    const h = await start();
    const a = await h.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #12 de prueba", minutes: 30 } });
    await h.call("POST", "/tenants/otra/support-access", { token: TOK, body: { reason: "Ticket #13 de prueba", minutes: 30 } });
    const b = await h.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #14 de prueba", minutes: 30 } });
    await h.call("DELETE", `/support-access/${b.json.grantId}`, { token: TOK });
    const l = await h.call("GET", "/tenants/acme/support-access", { token: TOK });
    expect(l.status).toBe(200);
    expect(l.json.grants.map((g: { grantId: string }) => g.grantId)).toEqual([a.json.grantId]);
    expect(l.json.grants[0]).toMatchObject({ operator: "crm:soporte", reason: "Ticket #12 de prueba", readOnly: true });
    expect(JSON.stringify(l.json)).not.toMatch(/token/i);
  });
});

describe("plano de control: auditoría firmada del Core", () => {
  it("guarda en el historial la entrada, modificaciones y salida; la salida revoca la concesión", async () => {
    const h = await start();
    const g = await h.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #12 de prueba", minutes: 30 } });
    const send = supportAuditSender({ secret: SECRET, url: `http://127.0.0.1:${h.port}${SUPPORT_AUDIT_PATH}` });
    expect(await send({ gid: g.json.grantId, tid: "acme", ev: "entered", d: {} })).toBe(true);
    expect(await send({ gid: g.json.grantId, tid: "acme", ev: "write_blocked", d: { method: "POST", resource: "/api/trpc/crm.leads.update?batch=1&input=secreto" } })).toBe(true);
    expect(await send({ gid: g.json.grantId, tid: "acme", ev: "exited", d: {} })).toBe(true);
    expect(h.events.map((e) => e.action)).toEqual(["support.entered", "support.write_blocked", "support.exited"]);
    expect(h.events[0]).toMatchObject({ tenantId: "acme", operator: "crm:soporte", details: { reason: "Ticket #12 de prueba", readOnly: true } });
    // Recurso sin la consulta (ni valores)
    expect(h.events[1].details).toMatchObject({ method: "POST", resource: "/api/trpc/crm.leads.update" });
    expect(h.grants.get(g.json.grantId)!.revokedAt).not.toBeNull();
    // Revocada: ya no se registra una entrada ni una modificación
    expect(await send({ gid: g.json.grantId, tid: "acme", ev: "entered", d: {} })).toBe(false);
    expect(await send({ gid: g.json.grantId, tid: "acme", ev: "write", d: {} })).toBe(false);
  });

  it("rechaza otra empresa, otro secreto, reintentos del mismo evento y un token de entrada usado como evento", async () => {
    const h = await start();
    const g = await h.call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Ticket #12 de prueba", minutes: 30 } });
    const post = (token: string) => h.raw("POST", SUPPORT_AUDIT_PATH, { body: { token } });
    expect((await post(await signSupportAudit(SECRET, { gid: g.json.grantId, tid: "otra", ev: "entered", d: {} }))).status).toBe(404);
    expect((await post(await signSupportAudit("x".repeat(40), { gid: g.json.grantId, tid: "acme", ev: "entered", d: {} }))).status).toBe(401);
    const once = await signSupportAudit(SECRET, { gid: g.json.grantId, tid: "acme", ev: "entered", d: {} });
    expect((await post(once)).status).toBe(201);
    expect((await post(once)).status).toBe(409);
    const grant = h.grants.get(g.json.grantId)!;
    expect((await post(await signSupportToken(grant, SECRET))).status).toBe(401);
    expect(await verifySupportAudit(await signSupportToken(grant, SECRET), SECRET)).toBeNull();
    expect(h.events).toHaveLength(1);
  });
});

describe("política del modo soporte", () => {
  it("veta usuarios, permisos, secretos y operaciones críticas; distingue exportaciones", () => {
    for (const p of ["admin.createUser", "admin.setUserPassword", "customRoles.assign", "integrations.save", "ghlInbox.getInboxCredentials", "accountSecurity.forgetDevice", "subscription.cancel", "domains.setPrimary", "cms.updateSiteSettings"]) expect(supportProcedureKind(p)).toBe("forbidden");
    for (const p of ["crm.clients.exportCsv", "crm.invoices.exportForGestoria", "reav.exportZip", "inventory.exportCsv", "algo.downloadPdf"]) expect(supportProcedureKind(p)).toBe("export");
    for (const p of ["crm.leads.list", "admin.getUsers", "integrations.list", "cms.getSiteSettings", "crm.reservations.update"]) expect(supportProcedureKind(p)).toBe("normal");
  });

  it("lee los procedimientos de un lote tRPC (también codificados)", () => {
    expect(trpcProcedures("/api/trpc/crm.leads.list,admin.getUsers?batch=1&input=x")).toEqual(["crm.leads.list", "admin.getUsers"]);
    expect(trpcProcedures("/api/trpc/crm.leads.list%2Cadmin.createUser?batch=1")).toEqual(["crm.leads.list", "admin.createUser"]);
    expect(trpcProcedures("/api/files/3")).toBeNull();
    expect(classifySupportRequest("POST", "/api/auth/change-password").kind).toBe("forbidden");
    expect(classifySupportRequest("GET", "/api/auth/me").kind).toBe("normal");
    expect(classifySupportRequest("GET", "/api/settlements/9/export-excel").kind).toBe("export");
    expect(classifySupportRequest("GET", "/api/files/9").kind).toBe("normal");
  });

  it("enmascara IBAN, secretos, tokens y contraseñas sin tocar el resto", () => {
    const at = new Date(0);
    const out = maskForSupport({
      name: "Ana", iban: "ES91 2100 0418 4502 0005 1332", legalCompanyIban: "ES7620770024003102575766", webhookSecret: "whsec_123", apiKey: "sk_live_x",
      inviteTokenExpiry: at, tokenCount: 3, secretConfigured: true, accessTokenLast4: "1234",
      nested: [{ password: "p", note: "visible" }], createdAt: at,
    });
    expect(out).toMatchObject({ name: "Ana", iban: "•••• 1332", legalCompanyIban: "•••• 5766", webhookSecret: "••••••", apiKey: "••••••", tokenCount: 3, secretConfigured: true, accessTokenLast4: "1234", nested: [{ password: "••••••", note: "visible" }] });
    expect(out.createdAt).toBe(at);
    expect(out.inviteTokenExpiry).toBe(at);
  });
});

describe("procedimientos tRPC en modo soporte", () => {
  it("solo lectura: vetados y enmascarado; con modificación (administración): derechos plenos y exportaciones registradas", async () => {
    const { router, publicProcedure } = await import("./_core/trpc");
    const { configureSupport } = await import("./_core/support/session");
    const { MemorySupportStore } = await import("./_core/support/grants");
    const { runWithTenant } = await import("./_core/tenant");
    const evs: string[] = [];
    configureSupport(new MemorySupportStore(), SECRET, { audit: async (c) => (evs.push(`${c.ev}:${c.d.resource}`), true) });
    const app = router({
      admin: router({ createUser: publicProcedure.mutation(() => 1) }),
      crm: router({ clients: router({ exportCsv: publicProcedure.query(() => "csv") }) }),
      hr: router({ employees: router({ list: publicProcedure.query(() => [{ name: "Ana", iban: "ES9121000418450200051332" }]) }) }),
    });
    const caller = (readOnly: boolean, loginMethod = "support") => app.createCaller({ user: { id: -1, role: "admin", loginMethod, supportGrantId: "g".repeat(32), supportReadOnly: readOnly } } as never);
    await runWithTenant("acme", async () => {
      await expect(caller(true).admin.createUser()).rejects.toThrow(/modo soporte/);
      expect(await caller(false).admin.createUser()).toBe(1);
      await expect(caller(true).crm.clients.exportCsv()).rejects.toThrow(/modificación/);
      expect(await caller(false).crm.clients.exportCsv()).toBe("csv");
      expect(await caller(true).hr.employees.list()).toEqual([{ name: "Ana", iban: "•••• 1332" }]);
      expect(await caller(false).hr.employees.list()).toEqual([{ name: "Ana", iban: "ES9121000418450200051332" }]);
      // Un usuario normal no se ve afectado
      expect(await caller(true, "local").hr.employees.list()).toEqual([{ name: "Ana", iban: "ES9121000418450200051332" }]);
      expect(await caller(true, "local").admin.createUser()).toBe(1);
    });
    expect(evs).toEqual(["blocked:admin.createUser", "blocked:crm.clients.exportCsv", "export:crm.clients.exportCsv"]);
    configureSupport(null);
  });
});

describe("revisión de seguridad: nombres, ajustes sensibles y entradas con secretos", () => {
  it("cada procedimiento vetado o de exportación existe en el router (un nombre mal escrito no veta nada)", async () => {
    const { appRouter } = await import("./routers");
    const { SUPPORT_POLICY_NAMES } = await import("./_core/support/policy");
    const all = new Set(Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures));
    const missing = [...SUPPORT_POLICY_NAMES.forbidden, ...SUPPORT_POLICY_NAMES.export].filter((n) => !all.has(n));
    expect(missing).toEqual([]);
    for (const p of SUPPORT_POLICY_NAMES.forbiddenPrefixes) expect([...all].some((n) => n.startsWith(p))).toBe(true);
    for (const p of ["communities.admin.members.invite", "communities.admin.members.setStatus", "config.updateSystemSetting", "config.updateFeatureFlag"]) expect(supportProcedureKind(p)).toBe("forbidden");
  }, 120_000);

  it("filas de ajustes {key, value}: se enmascara por la clave; credenciales con otros nombres y JSON completo", async () => {
    const out = maskForSupport([
      { key: "site_legal_iban", value: "ES7620770024003102575766" },
      { key: "redsys_merchant_key", value: "sq7HjrUOBfKmC576ILgskD5srU870gJ7" },
      { key: "site_name", value: "Acme" },
      { merchantKey: "abc", pass: "x", serviceAccountJson: { private_key: "k" }, tokenFormat: "jwt", accountNumber: 12345678 },
    ]);
    expect(out[0].value).toBe("•••• 5766");
    expect(out[1].value).toBe("••••••");
    expect(out[2].value).toBe("Acme");
    expect(out[3]).toMatchObject({ merchantKey: "••••••", pass: "••••••", serviceAccountJson: "••••••", tokenFormat: "••••••", accountNumber: "•••• 5678" });
  });

  it("con modificación (administración) se pueden cambiar IBAN, secretos y ajustes sensibles (derechos plenos)", async () => {
    const { inputTouchesSecrets } = await import("./_core/support/policy");
    expect(inputTouchesSecrets({ id: 3, name: "Ana", iban: "•••• 1332" })).toBe(true);
    expect(inputTouchesSecrets({ key: "site_legal_iban", value: "ES00" })).toBe(true);
    expect(inputTouchesSecrets({ id: 3, name: "Ana", notes: "ok", iban: undefined })).toBe(false);
    expect(inputTouchesSecrets({ id: 3, items: [{ qty: 1 }] })).toBe(false);
    const { router, publicProcedure } = await import("./_core/trpc");
    const { configureSupport } = await import("./_core/support/session");
    const { MemorySupportStore } = await import("./_core/support/grants");
    const { runWithTenant } = await import("./_core/tenant");
    const { z } = await import("zod");
    const evs: string[] = [];
    configureSupport(new MemorySupportStore(), SECRET, { audit: async (c) => (evs.push(`${c.ev}:${c.d.reason ?? ""}`), true) });
    const app = router({ hr: router({ employees: router({ update: publicProcedure.input(z.object({ id: z.number(), name: z.string(), iban: z.string().optional() })).mutation(() => "ok") }) }) });
    const caller = app.createCaller({ user: { id: -1, role: "admin", loginMethod: "support", supportGrantId: "g".repeat(32), supportReadOnly: false } } as never);
    await runWithTenant("acme", async () => {
      expect(await caller.hr.employees.update({ id: 1, name: "Ana", iban: "ES9121000418450200051332" })).toBe("ok");
      expect(await caller.hr.employees.update({ id: 1, name: "Ana" })).toBe("ok");
    });
    expect(evs).toEqual([]);
    configureSupport(null);
  });
});
