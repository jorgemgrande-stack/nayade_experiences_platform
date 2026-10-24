/**
 * Ficha 360° → Integraciones con comprobación REAL desde el plano de control (MySQL real, dos empresas, canal interno
 * firmado hacia el Core): la comprobación queda registrada en la base de SU empresa, la ficha muestra el estado y la
 * incidencia, la otra empresa no ve nada, y sin permiso de escritura no se comprueba. Sin red externa: la integración
 * de prueba no tiene todos los datos y la comprobación termina sin llamar a ningún proveedor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startElephantStack, type ElephantStack } from "./elephantStack.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("comprobación de integraciones desde Admin (MySQL real, dos empresas)", () => {
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
  const integrations = async (id: string) => {
    const r = await s.cp("GET", `/tenants/${id}/integrations`, { token: s.adminToken });
    expect(r.status).toBe(200);
    return { body: r.json, by: Object.fromEntries(r.json.integrations.map((x: any) => [x.id, x])) as Record<string, any> };
  };
  beforeAll(async () => {
    s = await startElephantStack(URL_!, { label: "intchk", opsAccessSecret: crypto.randomBytes(32).toString("base64url") });
    A = await signUp("Empresa Comprobación A", `a-${s.run}@comprobacion-a.example`);
    B = await signUp("Empresa Comprobación B", `b-${s.run}@comprobacion-b.example`);
    // A: GoHighLevel con Location ID y una API key ilegible (sin cifrar con la clave de la empresa): la bóveda la omite y la
    // comprobación termina sin red («Faltan API key o Location ID»)
    const c = await s.tenantConn(A);
    try {
      await c.query("INSERT INTO integration_credentials (provider, field, is_secret, value, updated_by) VALUES ('ghl', 'apiKey', 1, ?, 'admin:1'), ('ghl', 'locationId', 0, 'loc12345678', 'admin:1')", [SECRET]);
    } finally {
      await c.end();
    }
  }, 300_000);
  afterAll(async () => {
    await s?.close();
  });

  it("antes de comprobar: configurada pero NO comprobada, con capacidades y la operación disponible", async () => {
    const { body, by } = await integrations(A);
    expect(body.healthAvailable).toBe(true);
    expect(by.ghl).toMatchObject({ state: "configured", connection: "not_checked", operations: ["check"], lastCheck: null });
    expect(by.ghl.capabilities.length).toBeGreaterThan(0);
    expect(by.vapi).toMatchObject({ state: "not_configured", operations: [] });
  });

  it("comprobar ahora: resultado, registro en la base de A con el operador, incidencia y auditoría; sin secretos", async () => {
    const r = await s.cp("POST", `/tenants/${A}/integrations/ghl/check`, { token: s.adminToken, body: { reason: "Revisión de la integración" } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ provider: "ghl", outcome: "error" });
    expect(JSON.stringify(r.json)).not.toContain(SECRET);
    const { by } = await integrations(A);
    expect(by.ghl.connection).toBe("error");
    expect(by.ghl.lastCheck).toMatchObject({ outcome: "error", by: expect.stringContaining(":") });
    expect(by.ghl.incidents[0]).toMatchObject({ kind: "check", outcome: "error" });
    expect(JSON.stringify(by)).not.toContain(SECRET);
    const c = await s.tenantConn(A);
    try {
      const [rows] = await c.query("SELECT provider, kind, outcome FROM integration_events");
      expect(rows).toEqual([{ provider: "ghl", kind: "check", outcome: "error" }]);
    } finally {
      await c.end();
    }
    const ev = await s.cp("GET", `/tenants/${A}/events?limit=20`, { token: s.adminToken });
    expect(JSON.stringify(ev.json)).toContain("integration.check");
  });

  it("B no ve la comprobación de A ni puede comprobar lo que no tiene", async () => {
    const { by } = await integrations(B);
    expect(by.ghl).toMatchObject({ state: "not_configured", connection: "not_checked", lastCheck: null, incidents: [] });
    const r = await s.cp("POST", `/tenants/${B}/integrations/ghl/check`, { token: s.adminToken, body: { reason: "Revisión de la integración" } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("not_configured");
    const c = await s.tenantConn(B);
    try {
      const [rows] = (await c.query("SELECT COUNT(*) AS n FROM integration_events")) as any;
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it("negativas: sin permiso de escritura 403, sin motivo 400, proveedor desconocido 404, empresa inexistente 404, sin sesión 401", async () => {
    expect((await s.cp("POST", `/tenants/${A}/integrations/ghl/check`, { token: s.readerToken, body: { reason: "Revisión de la integración" } })).status).toBe(403);
    expect((await s.cp("POST", `/tenants/${A}/integrations/ghl/check`, { token: s.adminToken, body: {} })).status).toBe(400);
    expect((await s.cp("POST", `/tenants/${A}/integrations/inventado/check`, { token: s.adminToken, body: { reason: "Revisión de la integración" } })).status).toBe(404);
    expect((await s.cp("POST", `/tenants/no-existe-xyz/integrations/ghl/check`, { token: s.adminToken, body: { reason: "Revisión de la integración" } })).status).toBe(404);
    expect((await s.cp("POST", `/tenants/${A}/integrations/ghl/check`, { body: { reason: "Revisión de la integración" } })).status).toBe(401);
  });
});
