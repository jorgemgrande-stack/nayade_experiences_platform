/**
 * Observabilidad mínima para operar con los primeros clientes:
 *  - identificador de correlación (X-Request-Id) aceptado solo si es seguro, devuelto y propagado a los logs;
 *  - logs estructurados sin datos personales ni secretos;
 *  - alertas por repetición de fallos sobre el mecanismo de incidencias;
 *  - salud: vivo/listo, BD del registro y de la empresa, sin detalles internos;
 *  - plano de control: cabecera devuelta, auditoría con request_id, /readyz y diagnóstico por empresa.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { rebindRequestContext, requestIdMiddleware, sanitizeRequestId } from "./_core/ops/requestContext";
import { formatOpsLog, maskEmail, opsLog, scrub, setLogSink, type LogLevel } from "./_core/ops/log";
import { FailureAlerts } from "./_core/ops/failureAlerts";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { createHealthRouter } from "./_core/health";
import { runWithTenant } from "./_core/tenant";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, type ServiceToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

type Res = { status: number; json: any; text: string; headers: http.IncomingHttpHeaders };

function call(port: number, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(opts.headers ?? {}) },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = JSON.parse(b);
          } catch {
            /* sin JSON */
          }
          resolve({ status: res.statusCode ?? 0, json, text: b, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function serve(app: express.Express | express.Router) {
  const a = express();
  a.use(app);
  const server = http.createServer(a);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const captured: Array<{ level: LogLevel; line: any }> = [];
afterEach(() => {
  captured.length = 0;
  setLogSink(null);
});
const capture = () => setLogSink((level, line) => void captured.push({ level, line: JSON.parse(line) }));

describe("identificador de correlación", () => {
  it("acepta solo identificadores seguros", () => {
    expect(sanitizeRequestId("req-0123456789abcdef")).toBe("req-0123456789abcdef");
    expect(sanitizeRequestId("4f1c2b6e-8d0a-4b7e-9a51-2f6c3d1e0a77")).toBe("4f1c2b6e-8d0a-4b7e-9a51-2f6c3d1e0a77");
    expect(sanitizeRequestId(["trace:abc.def_123"])).toBe("trace:abc.def_123");
    for (const bad of ["corto", "x".repeat(65), "con espacios 12345", "abc\r\nSet-Cookie: x=1", "<script>alert(1)</script>", "", null, undefined, 42]) {
      expect(sanitizeRequestId(bad)).toBeNull();
    }
  });

  it("devuelve el identificador y lo propaga a los logs aunque se lea el cuerpo", async () => {
    capture();
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.use(rebindRequestContext);
    app.post("/x", (req, res) => {
      // Tras la lectura del cuerpo y una espera asíncrona, el contexto sigue disponible
      setTimeout(() => {
        opsLog("info", "Prueba", "procesado", { campos: Object.keys(req.body ?? {}).length });
        res.json({ ok: true });
      }, 5);
    });
    const s = await serve(app);
    try {
      const ok = await call(s.port, "POST", "/x", { body: { a: 1 }, headers: { "x-request-id": "crm-req-000000000001" } });
      expect(ok.headers["x-request-id"]).toBe("crm-req-000000000001");
      expect(captured.at(-1)!.line).toMatchObject({ ctx: "Prueba", event: "procesado", requestId: "crm-req-000000000001" });

      // Valor inseguro: se ignora y se genera uno nuevo (nunca se refleja)
      const bad = await call(s.port, "POST", "/x", { body: {}, headers: { "x-request-id": "malo<script>" } });
      expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(captured.at(-1)!.line.requestId).toBe(bad.headers["x-request-id"]);

      // Sin cabecera: se genera y cada petición tiene el suyo
      const a = await call(s.port, "POST", "/x", { body: {} });
      const b = await call(s.port, "POST", "/x", { body: {} });
      expect(a.headers["x-request-id"]).toBeTruthy();
      expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
    } finally {
      await s.close();
    }
  });
});

describe("logs sin datos personales ni secretos", () => {
  it("enmascara correos y elimina claves sensibles y tokens", () => {
    expect(maskEmail("Ana.Perez@Empresa.example")).toBe("A***@empresa.example");
    const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", "c2lnbmF0dXJhZmljdGljaWE"].join(".");
    const out = scrub({
      email: "cliente@dominio.example",
      password: "valor-ficticio", // gitleaks:allow
      apiKey: "valor-ficticio", // gitleaks:allow
      nested: { inviteToken: "x", detalle: `fallo para cliente@dominio.example con ${fakeJwt}` },
      error: new Error("mysql://usuario:clave@host"),
      largo: "z".repeat(500),
    }) as any;
    expect(out.email).toBe("c***@dominio.example");
    expect(out.password).toBe("[redactado]");
    expect(out.apiKey).toBe("[redactado]");
    expect(out.nested.inviteToken).toBe("[redactado]");
    expect(out.nested.detalle).toBe("fallo para c***@dominio.example con [token]");
    expect(out.error).toBe("Error");
    expect(out.largo.length).toBeLessThanOrEqual(200);
  });

  it("añade el tenant del contexto y conserva el formato { ctx, event }", () => {
    const line = JSON.parse(runWithTenant("acme", () => formatOpsLog("Auth", "login_failed", { reason: "invalid_credentials" })));
    expect(line).toEqual({ ctx: "Auth", event: "login_failed", reason: "invalid_credentials", tenantId: "acme" });
  });

  it("un sumidero que falla nunca rompe la operación", () => {
    setLogSink(() => {
      throw new Error("disco lleno");
    });
    expect(() => opsLog("error", "X", "y")).not.toThrow();
  });
});

describe("alertas por repetición de fallos", () => {
  it("abre una sola incidencia deduplicada al alcanzar el umbral dentro de la ventana", async () => {
    capture();
    let now = 1_000_000;
    const store = new MemoryIncidentStore();
    const incidents = new IncidentService(store, undefined, () => now);
    const alerts = new FailureAlerts({ incidents, now: () => now });
    for (let i = 0; i < 4; i++) expect(await alerts.record("mail.send_failed")).toBe(false);
    expect(await store.list()).toHaveLength(0);
    expect(await alerts.record("mail.send_failed", "acme")).toBe(true);
    expect(await alerts.record("mail.send_failed")).toBe(true);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ dedupeKey: "rate:mail.send_failed", kind: "rate.mail.send_failed", severity: "critical", status: "open", occurrences: 2 });
    expect(captured.some((c) => c.line.event === "threshold_exceeded" && c.line.kind === "mail.send_failed")).toBe(true);

    // Fuera de la ventana los fallos antiguos ya no cuentan
    now += 16 * 60_000;
    expect(await alerts.record("mail.send_failed")).toBe(false);
    expect(alerts.count("mail.send_failed")).toBe(1);
  });

  it("las altas fallidas repetidas abren una incidencia crítica; tipos desconocidos se ignoran", async () => {
    const store = new MemoryIncidentStore();
    const alerts = new FailureAlerts({ incidents: new IncidentService(store) });
    for (let i = 0; i < 3; i++) await alerts.record("provisioning.failed", `t${i}`);
    expect((await store.list())[0]).toMatchObject({ kind: "rate.provisioning.failed", severity: "critical" });
    expect(await alerts.record("desconocido")).toBe(false);
  });

  it("sin servicio de incidencias (Core) la alerta queda en el log", async () => {
    capture();
    const alerts = new FailureAlerts({ rules: { "x.fallo": { threshold: 1, windowMs: 60_000, severity: "warning", title: "X" } } });
    expect(await alerts.record("x.fallo")).toBe(true);
    expect(captured[0]).toMatchObject({ level: "error", line: { ctx: "Alerts", event: "threshold_exceeded", kind: "x.fallo" } });
  });
});

describe("salud en modo multiempresa", () => {
  const ok = async () => undefined;
  const ko = async () => {
    throw new Error("ER_ACCESS_DENIED mysql://u:p@registro.interno");
  };

  it("listo: registro y BD de la empresa del host", async () => {
    const s = await serve(createHealthRouter({ registryPing: ok, tenantPing: async () => ok }));
    const r = await call(s.port, "GET", "/readyz");
    await s.close();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "ready", checks: { registry: "ok", tenantDatabase: "ok" } });
  });

  it("host sin empresa (sonda interna): solo el registro", async () => {
    const s = await serve(createHealthRouter({ registryPing: ok, tenantPing: async () => null }));
    const r = await call(s.port, "GET", "/readyz");
    await s.close();
    expect(r.json).toEqual({ status: "ready", checks: { registry: "ok" } });
  });

  it("registro caído o BD de la empresa caída: 503 sin detalles internos", async () => {
    const s1 = await serve(createHealthRouter({ registryPing: ko, tenantPing: async () => ok }));
    const r1 = await call(s1.port, "GET", "/readyz");
    await s1.close();
    expect(r1.status).toBe(503);
    expect(r1.json).toEqual({ status: "degraded", checks: { registry: "error" } });

    const s2 = await serve(createHealthRouter({ registryPing: ok, tenantPing: async () => ko }));
    const r2 = await call(s2.port, "GET", "/readyz");
    await s2.close();
    expect(r2.status).toBe(503);
    expect(r2.json).toEqual({ status: "degraded", checks: { registry: "ok", tenantDatabase: "error" } });
    expect(r1.text + r2.text).not.toMatch(/ER_ACCESS|mysql:|registro\.interno/);
  });

  it("/healthz (vivo) no depende de ninguna base de datos", async () => {
    const s = await serve(createHealthRouter({ registryPing: ko }));
    const r = await call(s.port, "GET", "/healthz");
    await s.close();
    expect(r.status).toBe(200);
  });
});

describe("plano de control", () => {
  const FULL = "obs-token-" + crypto.randomBytes(12).toString("hex");
  const NOOPS = "obs-token-" + crypto.randomBytes(12).toString("hex");
  const tokens: ServiceToken[] = [
    { id: "crm-main", sha256: hashToken(FULL), scopes: ["tenants:read", "tenants:write", "ops:read"] },
    { id: "crm-ro", sha256: hashToken(NOOPS), scopes: ["tenants:read"] },
  ];
  let port: number;
  let server: http.Server;
  let registryUp = true;

  beforeAll(async () => {
    const store = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(store, () => ring);
    await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "seed" });
    await registry.setStatus("acme", "trial", { type: "operator", id: "seed" });
    const app = createControlPlaneApp({
      tokens,
      registry,
      reader: store,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example",
      perMinute: 1000,
      health: {
        registryPing: async () => {
          if (!registryUp) throw new Error("ECONNREFUSED registro.interno:3306");
        },
      },
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("devuelve X-Request-Id y lo guarda en la auditoría del registro", async () => {
    const auth = { authorization: `Bearer ${FULL}` };
    const r = await call(port, "POST", "/cp/v1/tenants/acme/status", { body: { status: "active" }, headers: { ...auth, "x-request-id": "crm-op-0000000042" } });
    expect(r.status).toBe(200);
    expect(r.headers["x-request-id"]).toBe("crm-op-0000000042");
    const ev = await call(port, "GET", "/cp/v1/tenants/acme/events", { headers: auth });
    const last = ev.json.events.filter((e: any) => e.action === "status.changed").pop();
    expect(last).toMatchObject({ actorId: "crm-main", requestId: "crm-op-0000000042" });
    // Incluso en errores y rutas inexistentes se devuelve el identificador
    const nf = await call(port, "GET", "/no-existe");
    expect(nf.status).toBe(404);
    expect(nf.headers["x-request-id"]).toBeTruthy();
  });

  it("/readyz comprueba la BD del registro sin exponer detalles", async () => {
    const up = await call(port, "GET", "/readyz");
    expect(up.json).toEqual({ status: "ready", checks: { registry: "ok" } });
    registryUp = false;
    capture();
    const down = await call(port, "GET", "/readyz");
    registryUp = true;
    expect(down.status).toBe(503);
    expect(down.json).toEqual({ status: "degraded", checks: { registry: "error" } });
    expect(down.text).not.toMatch(/ECONNREFUSED|registro\.interno/);
    expect(captured.some((c) => c.line.event === "registry_unavailable" && c.line.requestId)).toBe(true);
  });

  it("diagnóstico por empresa: solo con ops:read y sin secretos", async () => {
    const denied = await call(port, "GET", "/cp/v1/tenants/acme/diagnostics", { headers: { authorization: `Bearer ${NOOPS}` } });
    expect(denied.status).toBe(403);
    const r = await call(port, "GET", "/cp/v1/tenants/acme/diagnostics", { headers: { authorization: `Bearer ${FULL}` } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ tenantId: "acme", ok: false });
    expect(r.json.checks.find((c: any) => c.name === "has_active_database")).toMatchObject({ ok: false });
    expect(r.text).not.toMatch(/mysql:\/\//);
  });

  it("un JSON mal formado responde 400 en JSON (no la página de error de Express)", async () => {
    const r = await new Promise<Res>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/cp/v1/tenants/acme/status", method: "POST", headers: { authorization: `Bearer ${FULL}`, "content-type": "application/json" } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(b), text: b, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.end("{malo");
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "invalid_request" });
  });
});
