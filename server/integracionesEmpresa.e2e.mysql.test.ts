/**
 * Ficha 360° → Integraciones (GET /cp/v1/tenants/:id/integrations) con bases REALES de dos empresas: estado por proveedor,
 * campos obligatorios que faltan, sin ningún valor (ni cifrado) en la respuesta y sin mezclar empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startElephantStack, type ElephantStack } from "./elephantStack.testkit";
import { integrationStatus } from "./controlPlane/tenantIntegrations";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe("integrationStatus (lógica pura)", () => {
  it("sin configurar, incompleta (faltan obligatorios) y configurada; la conexión nunca se da por buena", () => {
    const s = integrationStatus([
      { provider: "imap_tpv", field: "host", updatedAt: "2026-10-20T10:00:00Z", updatedBy: "admin:1" },
      { provider: "ghl", field: "apiKey", updatedAt: "2026-10-21T10:00:00Z", updatedBy: "admin:2" },
      { provider: "ghl", field: "campo-inventado", updatedAt: "2026-10-22T10:00:00Z", updatedBy: "x" },
    ]);
    const by = Object.fromEntries(s.map((x) => [x.id, x]));
    expect(by.ghl).toMatchObject({ state: "configured", configuredFields: 1, lastChangedBy: "admin:2", connection: "not_checked" });
    expect(by.imap_tpv.state).toBe("incomplete");
    expect(by.imap_tpv.missingRequired).toEqual(["Usuario", "Contraseña"]);
    expect(by.vapi.state).toBe("not_configured");
  });
});

describe.skipIf(!URL_)("integraciones por empresa (MySQL real, dos empresas)", () => {
  let s: ElephantStack;
  let A = "";
  let B = "";
  const SECRET = `valor-secreto-${crypto.randomBytes(8).toString("hex")}`;
  const signUp = async (company: string, email: string) => {
    expect((await s.cp("POST", "/public/trial", { body: { email, companyName: company, idempotencyKey: crypto.randomBytes(12).toString("hex") } })).status).toBe(202);
    const v = await s.cp("POST", "/public/trial/verify", { body: s.verificationLink(email) });
    const id = String(v.json.domain).split(".")[0];
    s.tenants.push(id);
    return id;
  };
  beforeAll(async () => {
    s = await startElephantStack(URL_!, { label: "int" });
    A = await signUp("Empresa Integraciones A", `a-${s.run}@integraciones-a.example`);
    B = await signUp("Empresa Integraciones B", `b-${s.run}@integraciones-b.example`);
    const c = await s.tenantConn(A);
    try {
      await c.query("INSERT INTO integration_credentials (provider, field, is_secret, value, updated_by) VALUES ('ghl', 'apiKey', 1, ?, 'admin:1'), ('imap_tpv', 'host', 0, 'imap.ejemplo.example', 'admin:1')", [SECRET]);
    } finally {
      await c.end();
    }
  }, 300_000);
  afterAll(async () => {
    await s?.close();
  });

  it("A: GoHighLevel configurado, IMAP incompleto; ningún valor en la respuesta", async () => {
    const r = await s.cp("GET", `/tenants/${A}/integrations`, { token: s.adminToken });
    expect(r.status).toBe(200);
    expect(r.json.available).toBe(true);
    const by = Object.fromEntries(r.json.integrations.map((x: any) => [x.id, x]));
    expect(by.ghl).toMatchObject({ state: "configured", connection: "not_checked" });
    expect(by.imap_tpv.state).toBe("incomplete");
    expect(r.raw).not.toContain(SECRET);
    expect(r.raw).not.toContain("imap.ejemplo.example");
  });

  it("B no ve las integraciones de A", async () => {
    const r = await s.cp("GET", `/tenants/${B}/integrations`, { token: s.adminToken });
    expect(r.json.integrations.every((x: any) => x.state === "not_configured")).toBe(true);
  });

  it("permisos y empresa inexistente", async () => {
    expect((await s.cp("GET", `/tenants/${A}/integrations`)).status).toBe(401);
    expect((await s.cp("GET", "/tenants/no-existe-abc/integrations", { token: s.adminToken })).status).toBe(404);
    expect((await s.cp("GET", `/tenants/${A}/integrations`, { token: s.readerToken })).status).toBe(200);
  });
});
