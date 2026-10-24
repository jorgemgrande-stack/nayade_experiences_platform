/**
 * Regresión de la auditoría de seguridad del plano de control (fase overnight):
 *  - tope por IP aunque cada petición traiga una cabecera Authorization distinta;
 *  - el acceso de soporte queda a nombre de la identidad autenticada, no del nombre enviado;
 *  - parámetros numéricos inválidos → 400 (no 500 por SQL con NaN);
 *  - licencias: módulo desconocido 404; suspender un módulo del que depende otro, rechazado.
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
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const TOK = "sec-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
let server: http.Server | null = null;

async function start(over: Record<string, unknown> = {}) {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "test" });
  const grants: Array<Record<string, unknown>> = [];
  const revokes: string[] = [];
  const ents = new Map<string, { moduleId: string; status: string; validUntil: Date | null }>();
  const app = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(TOK), scopes: ["tenants:read", "tenants:write", "support:write", "entitlements:write"] }],
    registry,
    reader: reg,
    entitlements: {
      listEntitlements: async () => Array.from(ents.values()) as never,
      grant: async (_t: string, m: string, _a: unknown, o: { validUntil: Date | null }) => void ents.set(m, { moduleId: m, status: "active", validUntil: o.validUntil }),
      setStatus: async (_t: string, m: string, s: string) => void ents.set(m, { ...ents.get(m)!, status: s }),
      revoke: async (_t: string, m: string) => void ents.delete(m),
      apply: async (t: string, m: string, target: { status: string; validUntil: Date | null }) => {
        const previous = ents.get(m) ?? null;
        ents.set(m, { moduleId: m, ...target });
        return { changed: true, previous, entitlement: { tenantId: t, moduleId: m, ...target, source: "operator" } };
      },
    } as never,
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    support: {
      create: async (g: Record<string, unknown>) => (grants.push(g), { id: "a".repeat(32), tenantId: "acme", expiresAt: Date.now() + 60_000, readOnly: true, operator: g.operator }),
      revoke: async (_id: string, operator: string) => void revokes.push(operator),
    } as never,
    supportSecret: "s".repeat(40),
    ...over,
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, path: string, o: { token?: string; auth?: string; body?: unknown } = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = o.body === undefined ? undefined : JSON.stringify(o.body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1${path}`,
          method,
          headers: {
            ...(o.token ? { authorization: `Bearer ${o.token}` } : o.auth ? { authorization: o.auth } : {}),
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => {
            let json: any = null;
            try {
              json = b ? JSON.parse(b) : null;
            } catch {
              json = b; // p. ej. el 429 del limitador es texto
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  return { call, grants, revokes, ents };
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

describe("seguridad del plano de control", () => {
  it("tope por IP: cambiar la cabecera Authorization en cada petición no da cubos nuevos", async () => {
    const { call } = await start({ perIpMinute: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await call("GET", "/tenants", { auth: `Bearer inventado-${i}-${crypto.randomBytes(8).toString("hex")}` })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
  });

  it("el acceso de soporte queda a nombre de la identidad autenticada, no del nombre enviado", async () => {
    const { call, grants, revokes } = await start();
    const r = await call("POST", "/tenants/acme/support-access", { token: TOK, body: { operator: "Otra Persona", reason: "Revisión de incidencia", minutes: 10 } });
    expect(r.status).toBe(201);
    // Identidad autenticada del token de servicio (tipo:id), nunca «Otra Persona»
    expect(grants[0].operator).toBe("crm:admin");
    // Sin el campo también funciona (ya no se pide)
    expect((await call("POST", "/tenants/acme/support-access", { token: TOK, body: { reason: "Revisión de incidencia", minutes: 10 } })).status).toBe(201);
    expect((await call("DELETE", `/support-access/${"a".repeat(32)}?operator=Otra%20Persona`, { token: TOK })).status).toBe(204);
    expect(revokes).toEqual(["crm:admin"]);
  });

  it("parámetros numéricos inválidos: 400, nunca 500", async () => {
    const { call } = await start();
    for (const q of ["abc", "-5", "0", "9999"]) expect((await call("GET", `/tenants/acme/events?limit=${q}`, { token: TOK })).status).toBe(400);
    expect((await call("GET", "/tenants/acme/events?limit=10", { token: TOK })).status).toBe(200);
  });

  it("licencias: módulo desconocido 404; no se suspende un módulo del que depende otro activo", async () => {
    const { call, ents } = await start();
    expect((await call("PUT", "/tenants/acme/entitlements/no-existe", { token: TOK, body: {} })).status).toBe(404);
    const withDep = BUILTIN_MODULES.find((m) => (m.dependencies ?? []).length > 0 && !m.includedInBase);
    if (!withDep) return; // catálogo sin dependencias: nada que comprobar
    const dep = withDep.dependencies![0];
    ents.set(dep, { moduleId: dep, status: "active", validUntil: null });
    ents.set(withDep.id, { moduleId: withDep.id, status: "active", validUntil: null });
    const r = await call("PUT", `/tenants/acme/entitlements/${dep}`, { token: TOK, body: { status: "suspended" } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(ents.get(dep)!.status).toBe("active");
  });
});
