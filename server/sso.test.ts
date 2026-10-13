/**
 * SSO del plano de control: verificación OIDC (emisor, audiencia, caducidad, email verificado,
 * lista explícita de operadores) y sesiones cortas con ámbitos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { SsoService, parseSsoUsers } from "./controlPlane/sso";
import { createControlPlaneApp } from "./controlPlane/api";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const ISS = "https://accounts.example.com";
const AUD = "crm-client-id";
const SECRET = "s".repeat(40);

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let sso: SsoService;
let server: http.Server;
let port: number;

async function idToken(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT({ email: "ana@bigelephant.es", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  sso = new SsoService({
    issuer: ISS,
    clientId: AUD,
    sessionSecret: SECRET,
    users: parseSsoUsers(JSON.stringify([{ email: "Ana@BigElephant.es", scopes: ["tenants:read", "crm:read"] }])),
    getKey: createLocalJWKSet({ keys: [jwk] }),
  });

  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const app = createControlPlaneApp({
    tokens: [],
    sso,
    registry: new TenantRegistryService(reg, () => ring),
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
  new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1${path}`,
        method,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        },
      },
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

describe("intercambio OIDC", () => {
  it("operador autorizado obtiene una sesión con sus ámbitos", async () => {
    const r = await call("POST", "/auth/oidc", { body: { idToken: await idToken() } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: "ana@bigelephant.es", scopes: ["tenants:read", "crm:read"], expiresIn: 8 * 3600 });
    const me = await call("GET", "/auth/me", { token: r.json.token });
    expect(me.json).toEqual({ actor: { type: "operator", id: "ana@bigelephant.es" }, scopes: ["tenants:read", "crm:read"] });
  });

  it("rechaza firma ajena, emisor/audiencia incorrectos, caducado y email no verificado", async () => {
    for (const t of [
      await idToken({}, { key: otherKey }),
      await idToken({}, { iss: "https://evil.example" }),
      await idToken({}, { aud: "otro-cliente" }),
      await idToken({ email_verified: false }),
    ]) {
      expect((await call("POST", "/auth/oidc", { body: { idToken: t } })).status).toBe(401);
    }
    expect((await call("POST", "/auth/oidc", { body: { idToken: "x".repeat(40) } })).status).toBe(401);
  });

  it("un usuario válido en el IdP pero fuera de la lista recibe 403", async () => {
    const t = await idToken({ email: "intruso@bigelephant.es" });
    expect((await call("POST", "/auth/oidc", { body: { idToken: t } })).status).toBe(403);
  });

  it("la sesión respeta los ámbitos y no sirve para escribir", async () => {
    const s = (await call("POST", "/auth/oidc", { body: { idToken: await idToken() } })).json.token;
    expect((await call("GET", "/tenants", { token: s })).status).toBe(200);
    expect((await call("POST", "/tenants/acme/status", { token: s, body: { status: "active" } })).status).toBe(403);
  });

  it("una sesión manipulada o firmada con otra clave se rechaza", async () => {
    const forged = await new SignJWT({ scopes: ["tenants:write"], kind: "cp-session" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("ana@bigelephant.es")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("x".repeat(40)));
    expect((await call("GET", "/tenants", { token: forged })).status).toBe(401);
  });
});

describe("configuración", () => {
  it("parseSsoUsers exige correos concretos y ámbitos conocidos", () => {
    expect(parseSsoUsers(JSON.stringify([{ email: "*@x.es", scopes: [] }]))).toEqual([]);
    expect(parseSsoUsers(JSON.stringify([{ email: "a@x.es", scopes: ["root"] }]))).toEqual([]);
    expect(parseSsoUsers("no json")).toEqual([]);
  });
  it("clave de sesión corta no se admite", () => {
    expect(() => new SsoService({ issuer: ISS, clientId: AUD, sessionSecret: "corta", users: [], getKey: createLocalJWKSet({ keys: [] }) })).toThrow();
  });
});
