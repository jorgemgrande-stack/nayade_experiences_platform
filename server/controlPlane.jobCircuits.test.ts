/**
 * Plano de control: cortocircuitos de las tareas en segundo plano del Core (solo lectura, `ops:read`), leídos por el
 * canal interno firmado (`/_ops/access`, acción `jobs`). Core simulado; empresas ficticias.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import type { CoreAccessClient } from "./controlPlane/tenantAccess";
import { signOpsAccessToken, verifyOpsAccessToken } from "./_core/opsAccess/token";

const OPS = "jobs-ops-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const NOOPS = "jobs-crm-token-bbbbbbbbbbbbbbbbbbbbbbbb";
const OP: Actor = { type: "operator", id: "prueba" };
const SECRET = "ci-only-placeholder-not-a-secret-1-ci-only-placeholder";

describe("GET /jobs/circuits", () => {
  let server: http.Server;
  let port: number;
  const asked: string[] = [];

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["emp-uno", "emp-dos", "emp-caida"]) {
      await registry.createTenant({ id, displayName: id }, OP);
      await registry.setStatus(id, "active", OP);
    }
    await registry.createTenant({ id: "emp-alta", displayName: "En alta" }, OP); // sin panel: no se consulta
    const client: CoreAccessClient = {
      async call(x) {
        asked.push(`${x.act}:${x.tenantId}`);
        if (x.tenantId === "emp-caida") return { status: 502, body: { error: "core_unreachable" } };
        const circuits =
          x.tenantId === "emp-dos"
            ? [
                { job: "email-tpv-ingestion", tenantId: "emp-dos", state: "open", consecutiveFailures: 3, opens: 1, openUntil: 1, lastError: "IMAP no responde", lastFailureAt: 1 },
                { job: "tax-reminder", tenantId: "emp-dos", state: "closed", consecutiveFailures: 1, opens: 0, openUntil: null, lastError: "x", lastFailureAt: 1 },
              ]
            : [];
        return { status: 200, body: { ok: true, action: "jobs", jobs: { circuits, runs: [], hung: { "email-tpv-ingestion": 1 } } } };
      },
    };
    server = http.createServer(
      createControlPlaneApp({
        tokens: [
          { id: "ops", sha256: hashToken(OPS), scopes: ["ops:read"] },
          { id: "crm", sha256: hashToken(NOOPS), scopes: ["crm:read"] },
        ] as never,
        registry,
        reader: reg,
        entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
        quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
        platformTarget: "edge.example.com",
        tenantAccess: { client },
      } as never),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const get = (path: string, token: string) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/cp/v1${path}`, method: "GET", headers: { authorization: `Bearer ${token}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      });
      req.on("error", reject);
      req.end();
    });

  it("lista las tareas y empresas en cortocircuito; las empresas sin respuesta aparecen aparte", async () => {
    asked.length = 0;
    const r = await get("/jobs/circuits", OPS);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ available: true, checked: 3, unreachable: ["emp-caida"], hung: { "email-tpv-ingestion": 1 } });
    expect(r.json.circuits).toEqual([expect.objectContaining({ job: "email-tpv-ingestion", tenantId: "emp-dos", state: "open" })]);
    expect(asked.sort()).toEqual(["jobs:emp-caida", "jobs:emp-dos", "jobs:emp-uno"]);
  });

  it("con ?all=1 también las que acumulan fallos; con ?tenant= solo esa empresa", async () => {
    expect((await get("/jobs/circuits?all=1", OPS)).json.circuits).toHaveLength(2);
    asked.length = 0;
    const r = await get("/jobs/circuits?tenant=emp-uno", OPS);
    expect(r.json).toMatchObject({ checked: 1, circuits: [] });
    expect(asked).toEqual(["jobs:emp-uno"]);
  });

  it("exige ops:read", async () => {
    expect((await get("/jobs/circuits", NOOPS)).status).toBe(403);
  });
});

describe("canal interno: acción jobs", () => {
  it("se firma y verifica sin usuario de la empresa", async () => {
    const t = await signOpsAccessToken({ tid: "emp-uno", act: "jobs", op: "operator:prueba" }, SECRET);
    expect(await verifyOpsAccessToken(t, SECRET)).toMatchObject({ tid: "emp-uno", act: "jobs" });
  });
});
