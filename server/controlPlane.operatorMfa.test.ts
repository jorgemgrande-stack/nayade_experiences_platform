/**
 * Segundo factor (TOTP) de los operadores: vectores de la RFC, alta con confirmación y códigos de
 * recuperación, login en dos pasos con cambio de token, sesión pendiente sin acceso ni CSRF, códigos no
 * reutilizables, bloqueo por códigos erróneos, caducidad del paso pendiente, MFA obligatorio por rol,
 * restablecimiento por un administrador, baja propia y entorno sin MFA (comportamiento de siempre).
 */
import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { OperatorAuthService } from "./controlPlane/operatorAuth";
import { MemoryOperatorStore } from "./controlPlane/operatorStore";
import { mfaRolesFromEnv } from "./controlPlane/operatorSetup";
import { base32Decode, base32Encode, hotp, otpauthUri, totpStep, verifyTotp } from "./controlPlane/totp";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import type { OperatorRole } from "./controlPlane/operatorRoles";

const ORIGIN = "https://admin.bigelephant.es";
const PW = { root: "Raiz-Segura-Prado-2026!", sara: "Monte-Gestion-Roble-7731", ana: "Ventas-Luna-Sol-4821" };
const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);

interface Ctx {
  base: string;
  svc: OperatorAuthService;
  store: MemoryOperatorStore;
  clock: { t: number };
}
const servers: http.Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

async function setup(o: { mfa?: boolean; required?: OperatorRole[] } = {}): Promise<Ctx> {
  const clock = { t: Date.UTC(2026, 9, 18, 9) };
  const store = new MemoryOperatorStore({ mfa: o.mfa ?? true });
  const svc = new OperatorAuthService(store, { now: () => clock.t, idleMs: 30 * 60_000, maxMs: 8 * 3600_000, mfaKeyring: ring, mfaRequiredRoles: o.required ?? [] });
  await svc.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
  const root = { id: 1, username: "root", role: "superadmin" as const };
  await svc.create(root, { username: "sara", displayName: "Sara Admin", role: "admin", password: PW.sara });
  await svc.create(root, { username: "ana", displayName: "Ana Ventas", role: "sales", password: PW.ana });
  const reg = new MemoryTenantRegistryStore();
  const app = createControlPlaneApp({
    tokens: [],
    registry: new TenantRegistryService(reg, () => ring),
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.bigelephant.es",
    perMinute: 10_000,
    allowedOrigins: [ORIGIN],
    operators: svc,
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`, svc, store, clock };
}

async function call(ctx: Ctx, method: string, path: string, o: { cookie?: string; csrf?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  if (o.csrf) headers["x-csrf-token"] = o.csrf;
  const r = await fetch(ctx.base + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await r.text();
  return { status: r.status, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0], body: text ? JSON.parse(text) : null };
}

const totpAt = (secret: string, t: number) => hotp(base32Decode(secret), totpStep(t));

/** Entra con contraseña (sin MFA) y devuelve cookie y CSRF. */
async function login(ctx: Ctx, username: string, password: string) {
  const r = await call(ctx, "POST", "/auth/login", { body: { username, password } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { cookie: r.cookie, csrf: r.body.csrfToken as string, body: r.body };
}

/** Alta completa del MFA de un operador; devuelve su secreto y sus códigos de recuperación. */
async function enroll(ctx: Ctx, username: string, password: string) {
  const s = await login(ctx, username, password);
  const setup = await call(ctx, "POST", "/auth/mfa/setup", { cookie: s.cookie, csrf: s.csrf });
  expect(setup.status).toBe(200);
  const en = await call(ctx, "POST", "/auth/mfa/enable", { cookie: s.cookie, csrf: s.csrf, body: { code: totpAt(setup.body.secret, ctx.clock.t) } });
  expect(en.status, JSON.stringify(en.body)).toBe(200);
  return { secret: setup.body.secret as string, recovery: en.body.recoveryCodes as string[], session: s };
}

describe("TOTP (RFC 6238 / 4226)", () => {
  it("vectores de la RFC, base32 y ventana de ±30 s", () => {
    const key = Buffer.from("12345678901234567890");
    // RFC 4226, apéndice D (6 cifras)
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "520489"]);
    // RFC 6238, apéndice B, T = 59 s (8 cifras: 94287082)
    expect(hotp(key, totpStep(59_000), 8)).toBe("94287082");
    const b32 = base32Encode(key);
    expect(base32Decode(b32).equals(key)).toBe(true);
    const t = Date.UTC(2026, 9, 18, 9);
    expect(verifyTotp(b32, hotp(key, totpStep(t) - 1), t)).toBe(totpStep(t) - 1);
    expect(verifyTotp(b32, hotp(key, totpStep(t) + 2), t)).toBeNull();
    expect(verifyTotp(b32, "12345", t)).toBeNull();
    expect(otpauthUri(b32, "ana")).toMatch(/^otpauth:\/\/totp\/Big%20Elephant%3Aana\?secret=[A-Z2-7]+&issuer=Big%20Elephant/);
  });
  it("roles obligatorios desde el entorno", () => {
    expect(mfaRolesFromEnv("superadmin, admin,desconocido")).toEqual(["superadmin", "admin"]);
    expect(mfaRolesFromEnv(undefined)).toEqual([]);
  });
});

describe("segundo factor de los operadores", () => {
  it("alta: secreto cifrado, confirmación con código y 10 códigos de recuperación; el resto de sesiones se cierra", async () => {
    const ctx = await setup();
    const other = await login(ctx, "sara", PW.sara);
    const { secret, recovery, session } = await enroll(ctx, "sara", PW.sara);
    expect(recovery).toHaveLength(10);
    const sara = ctx.store.operators.find((o) => o.username === "sara")!;
    expect(sara.mfaEnabledAt).toBeTruthy();
    // Solo cifrado (AES-GCM con el llavero del registro), nunca en claro
    expect(sara.mfaSecretCipher).toBeTruthy();
    expect(sara.mfaSecretCipher).not.toContain(secret);
    expect(ctx.store.recovery.filter((r) => r.operatorId === sara.id).every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
    expect((await call(ctx, "GET", "/auth/session", { cookie: session.cookie })).status).toBe(200);
    expect((await call(ctx, "GET", "/auth/session", { cookie: other.cookie })).status).toBe(401);
    expect((await call(ctx, "GET", "/auth/mfa", { cookie: session.cookie })).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect(ctx.store.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["mfa_setup_started", "mfa_enabled"]));
  });

  it("un código erróneo no activa el alta", async () => {
    const ctx = await setup();
    const s = await login(ctx, "ana", PW.ana);
    await call(ctx, "POST", "/auth/mfa/setup", { cookie: s.cookie, csrf: s.csrf });
    expect((await call(ctx, "POST", "/auth/mfa/enable", { cookie: s.cookie, csrf: s.csrf, body: { code: "000000" } })).status).toBe(401);
    expect(ctx.store.operators.find((o) => o.username === "ana")!.mfaEnabledAt).toBeNull();
  });

  it("login en dos pasos: la sesión pendiente no da acceso ni CSRF; el código abre una sesión con token nuevo", async () => {
    const ctx = await setup();
    const { secret } = await enroll(ctx, "sara", PW.sara);
    ctx.clock.t += 60_000;
    const step1 = await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } });
    expect(step1.status).toBe(200);
    expect(step1.body).toEqual({ mfaRequired: true, expiresAt: expect.any(Number) });
    expect(step1.body.csrfToken).toBeUndefined();
    // Con la sesión pendiente no se puede hacer nada
    expect((await call(ctx, "GET", "/auth/session", { cookie: step1.cookie })).status).toBe(401);
    expect((await call(ctx, "GET", "/operators", { cookie: step1.cookie })).status).toBe(401);
    // Código erróneo
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: step1.cookie, body: { code: "123456" } })).status).toBe(401);
    // Código correcto: token nuevo; el pendiente deja de valer
    const step2 = await call(ctx, "POST", "/auth/mfa/verify", { cookie: step1.cookie, body: { code: totpAt(secret, ctx.clock.t) } });
    expect(step2.status, JSON.stringify(step2.body)).toBe(200);
    expect(step2.cookie).not.toBe(step1.cookie);
    expect(step2.body.csrfToken).toBeTruthy();
    expect((await call(ctx, "GET", "/operators", { cookie: step2.cookie })).status).toBe(200);
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: step1.cookie, body: { code: totpAt(secret, ctx.clock.t) } })).status).toBe(401);
  });

  it("un código TOTP no se puede reutilizar; un código de recuperación sirve una sola vez", async () => {
    const ctx = await setup();
    const { secret, recovery } = await enroll(ctx, "sara", PW.sara);
    ctx.clock.t += 60_000;
    const code = totpAt(secret, ctx.clock.t);
    const a = await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } });
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: a.cookie, body: { code } })).status).toBe(200);
    const b = await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } });
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: b.cookie, body: { code } })).status).toBe(401);
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: b.cookie, body: { code: recovery[0].toUpperCase() } })).status).toBe(200);
    const c = await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } });
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: c.cookie, body: { code: recovery[0] } })).status).toBe(401);
  });

  it("cinco códigos erróneos bloquean la cuenta; el paso pendiente caduca a los 5 minutos", async () => {
    const ctx = await setup();
    const { secret } = await enroll(ctx, "sara", PW.sara);
    ctx.clock.t += 60_000;
    const p = await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } });
    for (let i = 0; i < 4; i++) expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: p.cookie, body: { code: "000000" } })).status).toBe(401);
    expect((await call(ctx, "POST", "/auth/mfa/verify", { cookie: p.cookie, body: { code: "000000" } })).status).toBe(401);
    // Bloqueada: ni con la contraseña ni con el código correcto
    expect((await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } })).status).toBe(429);
    expect(ctx.store.events.some((e) => e.kind === "account_locked" && (e.details as any)?.reason === "bad_mfa_code")).toBe(true);
    // Pasado el bloqueo, el paso pendiente caduca si no se completa a tiempo
    ctx.clock.t += 16 * 60_000;
    const q = await call(ctx, "POST", "/auth/login", { body: { username: "sara", password: PW.sara } });
    ctx.clock.t += 6 * 60_000;
    const late = await call(ctx, "POST", "/auth/mfa/verify", { cookie: q.cookie, body: { code: totpAt(secret, ctx.clock.t) } });
    expect(late.status).toBe(401);
    expect(late.body.error).toBe("mfa_session_expired");
  });

  it("MFA obligatorio por rol: sin alta, la sesión solo sirve para darlo de alta", async () => {
    const ctx = await setup({ required: ["superadmin", "admin"] });
    const s = await login(ctx, "sara", PW.sara);
    expect(s.body.mfaSetupRequired).toBe(true);
    expect((await call(ctx, "GET", "/auth/session", { cookie: s.cookie })).body).toMatchObject({ scopes: [], mfa: { required: true, setupRequired: true, enabled: false } });
    expect((await call(ctx, "GET", "/operators", { cookie: s.cookie })).status).toBe(403);
    expect((await call(ctx, "GET", "/tenants", { cookie: s.cookie })).status).toBe(403);
    const st = await call(ctx, "POST", "/auth/mfa/setup", { cookie: s.cookie, csrf: s.csrf });
    expect((await call(ctx, "POST", "/auth/mfa/enable", { cookie: s.cookie, csrf: s.csrf, body: { code: totpAt(st.body.secret, ctx.clock.t) } })).status).toBe(200);
    // Tras el alta, la misma sesión tiene sus permisos
    expect((await call(ctx, "GET", "/operators", { cookie: s.cookie })).status).toBe(200);
    // Un rol sin obligación entra como siempre
    const ana = await login(ctx, "ana", PW.ana);
    expect(ana.body.mfaSetupRequired).toBe(false);
    expect((await call(ctx, "GET", "/auth/session", { cookie: ana.cookie })).body.scopes.length).toBeGreaterThan(0);
  });

  it("un administrador restablece el MFA de otro (móvil perdido) y cierra sus sesiones; ventas no puede", async () => {
    const ctx = await setup();
    const sara = await enroll(ctx, "sara", PW.sara);
    const ana = await login(ctx, "ana", PW.ana);
    const saraId = ctx.store.operators.find((o) => o.username === "sara")!.id;
    expect((await call(ctx, "POST", `/operators/${saraId}/mfa/reset`, { cookie: ana.cookie, csrf: ana.csrf })).status).toBe(403);
    const root = await login(ctx, "root", PW.root);
    expect((await call(ctx, "POST", `/operators/${saraId}/mfa/reset`, { cookie: root.cookie, csrf: root.csrf })).status).toBe(200);
    expect((await call(ctx, "GET", "/auth/session", { cookie: sara.session.cookie })).status).toBe(401);
    expect(ctx.store.operators.find((o) => o.id === saraId)).toMatchObject({ mfaEnabledAt: null, mfaSecretCipher: null });
    expect(await ctx.store.countRecoveryCodes(saraId)).toBe(0);
    // Vuelve a entrar solo con contraseña
    expect((await login(ctx, "sara", PW.sara)).body.mfaSetupRequired).toBe(false);
  });

  it("desde el servidor se retira el MFA del único superadministrador que perdió el móvil (auditado)", async () => {
    const ctx = await setup();
    const root = await enroll(ctx, "root", PW.root);
    await ctx.svc.adminResetMfaFromServer("root");
    expect(ctx.store.operators.find((o) => o.username === "root")!.mfaEnabledAt).toBeNull();
    expect((await call(ctx, "GET", "/auth/session", { cookie: root.session.cookie })).status).toBe(401);
    expect(ctx.store.events.some((e) => e.kind === "mfa_reset_by_server" && e.actor === "system:cli")).toBe(true);
    await expect(ctx.svc.adminResetMfaFromServer("nadie")).rejects.toMatchObject({ code: "not_found" });
  });

  it("baja propia solo con un código válido; sin CSRF no se puede", async () => {
    const ctx = await setup();
    const { secret, session } = await enroll(ctx, "sara", PW.sara);
    expect((await call(ctx, "POST", "/auth/mfa/disable", { cookie: session.cookie, body: { code: totpAt(secret, ctx.clock.t + 30_000) } })).status).toBe(403);
    expect((await call(ctx, "POST", "/auth/mfa/disable", { cookie: session.cookie, csrf: session.csrf, body: { code: "000000" } })).status).toBe(401);
    ctx.clock.t += 30_000;
    expect((await call(ctx, "POST", "/auth/mfa/disable", { cookie: session.cookie, csrf: session.csrf, body: { code: totpAt(secret, ctx.clock.t) } })).status).toBe(200);
    expect(ctx.store.operators.find((o) => o.username === "sara")!.mfaEnabledAt).toBeNull();
  });

  it("sin la migración 0012 (almacén sin MFA): el acceso es el de siempre y el alta no está disponible", async () => {
    const ctx = await setup({ mfa: false, required: ["admin"] });
    expect((await call(ctx, "GET", "/auth/options")).body).toMatchObject({ mfa: false });
    const s = await login(ctx, "sara", PW.sara);
    expect(s.body.mfaSetupRequired).toBe(false);
    expect((await call(ctx, "GET", "/operators", { cookie: s.cookie })).status).toBe(200);
    expect((await call(ctx, "POST", "/auth/mfa/setup", { cookie: s.cookie, csrf: s.csrf })).status).toBe(501);
  });
});
