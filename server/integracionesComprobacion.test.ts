/**
 * Comprobación real de integraciones (unitarias, sin red): resultado por proveedor (conectada, credenciales rechazadas,
 * error), buzones IMAP/SMTP sin leer ni enviar, estado a partir de lo último ocurrido, canal interno firmado y ficha.
 */
import { describe, it, expect } from "vitest";
import { testProvider, type MailProbes } from "./_core/credentials/testers";
import { connectionOf } from "./_core/credentials/health";
import { signOpsAccessToken, verifyOpsAccessToken } from "./_core/opsAccess/token";
import { runIntegrationAction } from "./_core/opsAccess/integrations";
import { integrationStatus } from "./controlPlane/tenantIntegrations";
import { PROVIDERS } from "./_core/credentials/catalog";

const SECRET = "s".repeat(40);
const http = (status: number) => async () => ({ ok: status >= 200 && status < 300, status });
const probes = (o: { imap?: Error | null; smtp?: Error | null } = {}): MailProbes & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    imapLogin: async (x) => {
      calls.push(`imap:${x.host}:${x.port}:${x.secure}:${x.mailbox}`);
      if (o.imap) throw o.imap;
    },
    smtpVerify: async (x) => {
      calls.push(`smtp:${x.host}:${x.port}:${x.secure}`);
      if (o.smtp) throw o.smtp;
    },
  };
};

describe("resultado de cada comprobación", () => {
  it("HTTP: 200 conectada, 401/403 credenciales rechazadas, otros y red caída son error", async () => {
    expect(await testProvider("vapi", { apiKey: "k".repeat(10) }, http(200))).toMatchObject({ ok: true, outcome: "connected" });
    expect(await testProvider("vapi", { apiKey: "k".repeat(10) }, http(401))).toMatchObject({ ok: false, outcome: "rejected" });
    expect(await testProvider("ghl", { apiKey: "k".repeat(10), locationId: "loc123" }, http(403))).toMatchObject({ outcome: "rejected" });
    expect(await testProvider("meta", { capiAccessToken: "t".repeat(10) }, http(500))).toMatchObject({ outcome: "error" });
    expect(await testProvider("vapi", { apiKey: "k".repeat(10) }, async () => { throw new Error("red"); })).toMatchObject({ outcome: "error", message: "No se pudo contactar con el proveedor" });
    expect(await testProvider("ghl", {}, http(200))).toMatchObject({ ok: false, outcome: "error" });
  });

  it("IMAP: inicio de sesión y carpeta en solo lectura; credenciales rechazadas frente a servidor inaccesible", async () => {
    const p = probes();
    const v = { host: "imap.ejemplo.example", user: "tickets@ejemplo.example", pass: "x" };
    expect(await testProvider("imap_tpv", v, http(200), p)).toMatchObject({ ok: true, outcome: "connected" });
    expect(p.calls).toEqual(["imap:imap.ejemplo.example:993:true:INBOX"]);
    const authErr = Object.assign(new Error("Command failed"), { authenticationFailed: true });
    expect(await testProvider("imap_expenses", v, http(200), probes({ imap: authErr }))).toMatchObject({ outcome: "rejected" });
    expect(await testProvider("imap_expenses", v, http(200), probes({ imap: new Error("getaddrinfo ENOTFOUND") }))).toMatchObject({ outcome: "error", message: "No se pudo conectar con el servidor IMAP" });
    expect(await testProvider("imap_tpv", { ...v, port: "99999" }, http(200), p)).toMatchObject({ outcome: "error", message: "Puerto no válido" });
  });

  it("SMTP: verificación sin enviar; 535 es credencial rechazada; el puerto 465 implica TLS directo", async () => {
    const p = probes();
    const v = { host: "smtp.ejemplo.example", user: "u@ejemplo.example", pass: "x", port: "465" };
    expect(await testProvider("mail_smtp", v, http(200), p)).toMatchObject({ outcome: "connected" });
    expect(p.calls).toEqual(["smtp:smtp.ejemplo.example:465:true"]);
    expect(await testProvider("mail_smtp", v, http(200), probes({ smtp: Object.assign(new Error("Invalid login"), { responseText: "535 5.7.8 Authentication failed" }) }))).toMatchObject({ outcome: "rejected" });
  });

  it("los mensajes nunca llevan el secreto", async () => {
    const pass = "contraseña-super-secreta-123";
    const r = await testProvider("imap_tpv", { host: "h.example", user: "u", pass }, http(200), probes({ imap: new Error(`login failed for ${pass}`) }));
    expect(JSON.stringify(r)).not.toContain(pass);
  });
});

describe("estado de conexión a partir de lo último ocurrido", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 24, 10, m)).toISOString();
  it("sin nada: no comprobada; manda la comprobación o la sincronización más reciente", () => {
    expect(connectionOf(null, null)).toEqual({ connection: "not_checked", at: null });
    expect(connectionOf({ at: at(5), outcome: "rejected", message: "", by: null }, { at: at(1), ok: true, message: "" }).connection).toBe("disconnected");
    expect(connectionOf({ at: at(1), outcome: "rejected", message: "", by: null }, { at: at(5), ok: true, message: "" }).connection).toBe("connected");
    expect(connectionOf(null, { at: at(5), ok: false, message: "" }).connection).toBe("error");
    expect(connectionOf({ at: at(5), outcome: "error", message: "", by: null }, null).connection).toBe("error");
  });
});

describe("canal interno: acciones de integraciones firmadas", () => {
  it("la comprobación exige el proveedor firmado; el estado no lleva usuario ni proveedor", async () => {
    const ok = await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "integration_check", prv: "imap_tpv", op: "operator:ana" }, SECRET), SECRET);
    expect(ok).toMatchObject({ act: "integration_check", prv: "imap_tpv" });
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "integration_check", op: "operator:ana" }, SECRET), SECRET)).toBeNull();
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "integration_check", prv: "../../x", op: "o" }, SECRET), SECRET)).toBeNull();
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "integrations", op: "o" }, SECRET), SECRET)).toMatchObject({ act: "integrations" });
    // Un proveedor colado en otra acción invalida el token
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "reset", uid: 3, prv: "ghl", op: "o" }, SECRET), SECRET)).toBeNull();
    // Las acciones de usuario siguen exigiendo usuario
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "reset", op: "o" }, SECRET), SECRET)).toBeNull();
  });

  it("comprobación desde el plano de control: registra el resultado con el operador; nada sin configurar", async () => {
    const recorded: unknown[][] = [];
    const deps = {
      resolve: async (p: string) => (p === "vapi" ? { apiKey: "k".repeat(12) } : {}),
      test: (async () => ({ ok: false, message: "Credenciales rechazadas por el proveedor", outcome: "rejected" as const })) as typeof testProvider,
      record: (async (...a: unknown[]) => void recorded.push(a)) as never,
    };
    expect(await runIntegrationAction("integration_check", "vapi", "operator:ana", deps)).toMatchObject({ ok: true, check: { provider: "vapi", outcome: "rejected" } });
    expect(recorded).toEqual([["vapi", "rejected", "Credenciales rechazadas por el proveedor", "operator:ana"]]);
    expect(await runIntegrationAction("integration_check", "ghl", "o", deps)).toMatchObject({ ok: false, error: "not_configured" });
    expect(await runIntegrationAction("integration_check", "inventado", "o", deps)).toMatchObject({ ok: false, error: "unknown_provider" });
    expect(recorded).toHaveLength(1);
  });
});

describe("ficha: estado real, capacidades y operaciones", () => {
  const rows = [
    { provider: "imap_tpv", field: "host", updatedAt: "2026-10-20T10:00:00Z", updatedBy: "admin:1" },
    { provider: "imap_tpv", field: "user", updatedAt: "2026-10-20T10:00:00Z", updatedBy: "admin:1" },
    { provider: "imap_tpv", field: "pass", updatedAt: "2026-10-20T10:00:00Z", updatedBy: "admin:1" },
  ];
  const h = (provider: string, connection: "connected" | "error") => ({
    provider,
    connection,
    stateAt: "2026-10-24T10:00:00.000Z",
    lastCheck: null,
    lastSync: { at: "2026-10-24T10:00:00.000Z", ok: connection === "connected", message: "Lectura del buzón correcta" },
    lastOkSyncAt: "2026-10-24T10:00:00.000Z",
    lastError: null,
    incidents: [{ at: "2026-10-23T10:00:00.000Z", kind: "sync", outcome: "error", message: "No se pudo leer el buzón", actor: "sistema" }],
  });
  it("con credenciales y sin datos del Core: no comprobada (tener credenciales no es estar conectado)", () => {
    const by = Object.fromEntries(integrationStatus(rows).map((x) => [x.id, x]));
    expect(by.imap_tpv).toMatchObject({ state: "configured", connection: "not_checked", operations: ["check"] });
  });
  it("con datos del Core: su estado, la última sincronización y las incidencias; sin configurar, nunca conectada", () => {
    const by = Object.fromEntries(integrationStatus(rows, [h("imap_tpv", "connected"), h("vapi", "connected")]).map((x) => [x.id, x]));
    expect(by.imap_tpv).toMatchObject({ connection: "connected", lastOkSyncAt: "2026-10-24T10:00:00.000Z", incidents: [expect.objectContaining({ outcome: "error" })] });
    expect(by.vapi).toMatchObject({ state: "not_configured", connection: "not_checked", operations: [] });
  });
  it("cada proveedor declara sus capacidades y cómo se comprueba", () => {
    for (const p of PROVIDERS) {
      expect(p.capabilities.length, p.id).toBeGreaterThan(0);
      expect(p.check, p.id).toBeTruthy();
    }
  });
});
