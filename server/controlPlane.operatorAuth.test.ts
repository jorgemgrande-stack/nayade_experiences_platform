/**
 * Autenticación de operadores humanos: login, bloqueo y límite de intentos, sesiones (caducidad,
 * cierre, revocación, persistencia), CSRF y CORS, permisos por rol, escalada de privilegios,
 * protección del último superadministrador, recuperación de contraseña y auditoría.
 */
import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, type ServiceToken } from "./controlPlane/auth";
import { OperatorAuthService, generatePassword, passwordProblem, type ResetMailer } from "./controlPlane/operatorAuth";
import { LastSuperadminError, MemoryOperatorStore } from "./controlPlane/operatorStore";
import { ROLE_SCOPES, canManageRole } from "./controlPlane/operatorRoles";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const ORIGIN = "https://crm.elephantsource.es";
const SERVICE = "service-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const tokens: ServiceToken[] = [{ id: "crm-main", sha256: hashToken(SERVICE), scopes: ["tenants:read", "tenants:write", "operators:read", "operators:write"] }];
const PW = { root: "Raiz-Segura-Prado-2026!", ana: "Ventas-Luna-Sol-4821", sara: "Monte-Gestion-Roble-7731", lee: "Lectura-Rio-Nube-5590" };

interface Ctx {
  base: string;
  svc: OperatorAuthService;
  store: MemoryOperatorStore;
  clock: { t: number };
  close: () => Promise<void>;
}
const open: Ctx[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function setup(opts: { mailer?: ResetMailer; store?: MemoryOperatorStore; clock?: { t: number } } = {}): Promise<Ctx> {
  const clock = opts.clock ?? { t: Date.UTC(2026, 9, 15, 9) };
  const store = opts.store ?? new MemoryOperatorStore();
  const svc = new OperatorAuthService(store, {
    now: () => clock.t,
    idleMs: 30 * 60_000,
    maxMs: 8 * 3600_000,
    mailer: opts.mailer,
    resetUrl: opts.mailer ? "https://crm.elephantsource.es/#/restablecer" : undefined,
  });
  if ((await store.countOperators()) === 0) {
    await svc.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
    const root = { id: 1, username: "root", role: "superadmin" as const };
    await svc.create(root, { username: "ana", email: "ana@elephant.test", displayName: "Ana Ventas", role: "sales", password: PW.ana });
    await svc.create(root, { username: "sara", displayName: "Sara Admin", role: "admin", password: PW.sara });
    await svc.create(root, { username: "lee", displayName: "Lee Lectura", role: "readonly", password: PW.lee });
  }
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new MemoryTenantRegistryStore();
  const app = createControlPlaneApp({
    tokens,
    registry: new TenantRegistryService(reg, () => ring),
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.elephantsource.es",
    perMinute: 10_000,
    allowedOrigins: [ORIGIN],
    operators: svc,
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const ctx: Ctx = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`,
    svc,
    store,
    clock,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  open.push(ctx);
  return ctx;
}

interface Session {
  cookie: string;
  csrf: string;
  body: any;
}

async function call(ctx: Ctx, method: string, path: string, o: { session?: Session; cookie?: string; csrf?: string | null; body?: unknown; origin?: string | null; bearer?: string } = {}) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const cookie = o.cookie ?? o.session?.cookie;
  if (cookie) headers.cookie = cookie;
  const csrf = o.csrf === undefined ? o.session?.csrf : o.csrf;
  if (csrf) headers["x-csrf-token"] = csrf;
  const origin = o.origin === undefined ? ORIGIN : o.origin;
  if (origin) headers.origin = origin;
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  const r = await fetch(ctx.base + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
}

async function login(ctx: Ctx, username: string, password: string): Promise<Session> {
  const r = await call(ctx, "POST", "/auth/login", { body: { username, password } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const setCookie = r.headers.get("set-cookie")!;
  return { cookie: setCookie.split(";")[0], csrf: r.body.csrfToken, body: r.body };
}

describe("contraseñas", () => {
  it("política mínima y generación aleatoria fuerte", () => {
    expect(passwordProblem("corta", "ana")).toMatch(/12 caracteres/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa", "ana")).toMatch(/único carácter/);
    expect(passwordProblem("Mi-nombre-es-sara-2026", "sara")).toMatch(/nombre de usuario/);
    expect(passwordProblem("Banana-Split-Roja-2026", "ana")).toBeNull();
    expect(passwordProblem("MiPassword-2026-x", "ana")).toMatch(/común/);
    expect(passwordProblem(PW.ana, "ana")).toBeNull();
    const a = generatePassword();
    const b = generatePassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z2-9]{6}(-[A-Za-z2-9]{6}){3}$/);
    expect(passwordProblem(a, "administrador")).toBeNull();
  });

  it("se guardan con Argon2id, nunca en claro", async () => {
    const ctx = await setup();
    const ana = ctx.store.operators.find((o) => o.username === "ana")!;
    expect(ana.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(JSON.stringify(ctx.store)).not.toContain(PW.ana);
  });
});

describe("inicio de sesión", () => {
  it("login correcto: cookie HttpOnly/SameSite=Strict, CSRF y sesión utilizable; por usuario o correo", async () => {
    const ctx = await setup();
    const r = await call(ctx, "POST", "/auth/login", { body: { username: "Ana", password: PW.ana } });
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toMatch(/^be_cp_session=[A-Za-z0-9_-]{43}; Path=\/cp\/v1; Max-Age=28800; HttpOnly; SameSite=Strict$/);
    expect(r.body.operator).toMatchObject({ username: "ana", role: "sales", roleLabel: "Comercial" });
    expect(r.body).not.toHaveProperty("operator.passwordHash");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const s: Session = { cookie: sc.split(";")[0], csrf: r.body.csrfToken, body: r.body };
    const me = await call(ctx, "GET", "/auth/session", { session: s });
    expect(me.status).toBe(200);
    expect(me.body.scopes.sort()).toEqual([...ROLE_SCOPES.sales].sort());
    expect((await call(ctx, "GET", "/tenants", { session: s })).status).toBe(200);
    // También por correo, sin distinguir mayúsculas
    await login(ctx, "ANA@elephant.test", PW.ana);
    // En la BD solo está el hash del token
    const token = s.cookie.split("=")[1];
    expect(ctx.store.sessions.has(token)).toBe(false);
    expect(ctx.store.sessions.has(hashToken(token))).toBe(true);
  });

  it("contraseña incorrecta y usuario inexistente reciben el mismo mensaje", async () => {
    const ctx = await setup();
    const bad = await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: "otra-contraseña-mala" } });
    const unknown = await call(ctx, "POST", "/auth/login", { body: { username: "nadie", password: "otra-contraseña-mala" } });
    expect([bad.status, unknown.status]).toEqual([401, 401]);
    expect(bad.body).toEqual(unknown.body);
    expect(bad.body).toEqual({ error: "invalid_credentials", message: "Usuario o contraseña incorrectos." });
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("usuario desactivado: solo se informa a quien conoce la contraseña; sus sesiones se cierran", async () => {
    const ctx = await setup();
    const s = await login(ctx, "ana", PW.ana);
    const root = await login(ctx, "root", PW.root);
    expect((await call(ctx, "PATCH", "/operators/2", { session: root, body: { status: "disabled" } })).status).toBe(200);
    expect((await call(ctx, "GET", "/auth/session", { session: s })).status).toBe(401);
    expect((await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: PW.ana } })).body.error).toBe("account_disabled");
    expect((await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: "no-es-la-buena-123" } })).body.error).toBe("invalid_credentials");
  });

  it("bloqueo tras 5 fallos seguidos (también con la contraseña buena) y desbloqueo al pasar el tiempo", async () => {
    const ctx = await setup();
    for (let i = 0; i < 5; i++) expect((await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: `mala-${i}-xxxxxxxx` } })).status).toBe(401);
    const locked = await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: PW.ana } });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe("account_locked");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(800);
    ctx.clock.t += 16 * 60_000;
    await login(ctx, "ana", PW.ana);
    expect(ctx.store.operators.find((o) => o.username === "ana")).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    // Un usuario inexistente se bloquea igual (no se distingue de uno real)
    for (let i = 0; i < 5; i++) await call(ctx, "POST", "/auth/login", { body: { username: "fantasma", password: `mala-${i}-xxxxxxxx` } });
    expect((await call(ctx, "POST", "/auth/login", { body: { username: "fantasma", password: "mala-x-xxxxxxxx" } })).body.error).toBe("account_locked");
  });

  it("límite de intentos fallidos por IP (los correctos no cuentan)", async () => {
    const ctx = await setup();
    // Límite real del servicio: 20 fallos por 15 min. Se comprueba con usuarios distintos para no
    // activar el bloqueo por cuenta.
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await call(ctx, "POST", "/auth/login", { body: { username: `u${i}`, password: "mala-xxxxxxxxxx" } })).status;
    expect(last).toBe(429);
    const r = await call(ctx, "POST", "/auth/login", { body: { username: "root", password: PW.root } });
    expect(r.body.error).toBe("too_many_attempts");
  });

  it("login desde un origen no autorizado se rechaza", async () => {
    const ctx = await setup();
    const r = await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: PW.ana }, origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("origin_not_allowed");
  });
});

describe("sesiones", () => {
  it("caduca por inactividad y por duración máxima", async () => {
    const ctx = await setup();
    const s = await login(ctx, "ana", PW.ana);
    ctx.clock.t += 31 * 60_000;
    const r = await call(ctx, "GET", "/auth/session", { session: s });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("session_expired");

    const s2 = await login(ctx, "ana", PW.ana);
    // Activa cada 20 min durante 8 h: la inactividad no vence, la duración máxima sí
    for (let i = 0; i < 24; i++) {
      ctx.clock.t += 20 * 60_000;
      if ((await call(ctx, "GET", "/auth/session", { session: s2 })).status !== 200) break;
    }
    expect((await call(ctx, "GET", "/auth/session", { session: s2 })).status).toBe(401);
  });

  it("cierre de sesión real: revoca en el servidor y borra la cookie", async () => {
    const ctx = await setup();
    const s = await login(ctx, "ana", PW.ana);
    const r = await call(ctx, "POST", "/auth/logout", { session: s });
    expect(r.status).toBe(204);
    expect(r.headers.get("set-cookie")).toMatch(/^be_cp_session=; Path=\/cp\/v1; Max-Age=0; HttpOnly; SameSite=Strict$/);
    expect((await call(ctx, "GET", "/auth/session", { session: s })).status).toBe(401);
  });

  it("revocación por un administrador y cambio de contraseña (cierra las demás sesiones)", async () => {
    const ctx = await setup();
    const a1 = await login(ctx, "ana", PW.ana);
    const a2 = await login(ctx, "ana", PW.ana);
    const sara = await login(ctx, "sara", PW.sara);
    const list = await call(ctx, "GET", "/operators/2/sessions", { session: sara });
    expect(list.body.sessions).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain(a1.cookie.split("=")[1]);
    expect((await call(ctx, "POST", "/operators/2/sessions/revoke", { session: sara })).body.revoked).toBe(2);
    expect((await call(ctx, "GET", "/auth/session", { session: a1 })).status).toBe(401);
    expect((await call(ctx, "GET", "/auth/session", { session: a2 })).status).toBe(401);

    const b1 = await login(ctx, "ana", PW.ana);
    const b2 = await login(ctx, "ana", PW.ana);
    const wrong = await call(ctx, "POST", "/auth/password", { session: b1, body: { currentPassword: "no-es-la-actual-9", newPassword: "Nueva-Clave-Sol-9931" } });
    expect(wrong.body.error).toBe("invalid_credentials");
    const ok = await call(ctx, "POST", "/auth/password", { session: b1, body: { currentPassword: PW.ana, newPassword: "Nueva-Clave-Sol-9931" } });
    expect(ok.status).toBe(200);
    expect((await call(ctx, "GET", "/auth/session", { session: b1 })).status).toBe(200);
    expect((await call(ctx, "GET", "/auth/session", { session: b2 })).status).toBe(401);
    expect((await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: PW.ana } })).status).toBe(401);
    await login(ctx, "ana", "Nueva-Clave-Sol-9931");
  });

  it("persiste tras reiniciar el servicio (mismo almacén, proceso nuevo)", async () => {
    const store = new MemoryOperatorStore();
    const clock = { t: Date.UTC(2026, 9, 15, 9) };
    const first = await setup({ store, clock });
    const s = await login(first, "ana", PW.ana);
    await first.close();
    open.splice(open.indexOf(first), 1);
    const second = await setup({ store, clock });
    expect((await call(second, "GET", "/auth/session", { session: s })).status).toBe(200);
  });
});

describe("CSRF y CORS", () => {
  it("las escrituras con cookie exigen el token CSRF de la sesión y un origen autorizado", async () => {
    const ctx = await setup();
    const s = await login(ctx, "root", PW.root);
    const body = { displayName: "Ana V." };
    expect((await call(ctx, "PATCH", "/operators/2", { session: s, csrf: null, body })).body.error).toBe("csrf_failed");
    expect((await call(ctx, "PATCH", "/operators/2", { session: s, csrf: "x".repeat(43), body })).body.error).toBe("csrf_failed");
    expect((await call(ctx, "PATCH", "/operators/2", { session: s, body, origin: "https://evil.example" })).body.error).toBe("csrf_failed");
    // El token CSRF de otra sesión tampoco sirve
    const other = await login(ctx, "sara", PW.sara);
    expect((await call(ctx, "PATCH", "/operators/2", { session: s, csrf: other.csrf, body })).body.error).toBe("csrf_failed");
    expect((await call(ctx, "PATCH", "/operators/2", { session: s, body })).status).toBe(200);
    // Lecturas sin CSRF; tokens de servicio sin cambios (no usan cookie)
    expect((await call(ctx, "GET", "/operators", { session: s, csrf: null })).status).toBe(200);
    expect((await call(ctx, "GET", "/tenants", { bearer: SERVICE })).status).toBe(200);
  });

  it("CORS: credenciales y cabecera CSRF solo para orígenes autorizados", async () => {
    const ctx = await setup();
    const ok = await fetch(`${ctx.base}/auth/login`, { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    expect(ok.headers.get("access-control-allow-headers")).toContain("x-csrf-token");
    const bad = await fetch(`${ctx.base}/auth/login`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect(bad.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("permisos y escalada de privilegios", () => {
  it("los roles se traducen a ámbitos comprobados en el servidor", async () => {
    const ctx = await setup();
    const ana = await login(ctx, "ana", PW.ana);
    const lee = await login(ctx, "lee", PW.lee);
    expect((await call(ctx, "GET", "/tenants", { session: lee })).status).toBe(200);
    expect((await call(ctx, "POST", "/tenants/acme/status", { session: lee, body: { status: "suspended", reason: "prueba" } })).status).toBe(403);
    expect((await call(ctx, "POST", "/tenants/acme/status", { session: ana, body: { status: "suspended", reason: "prueba" } })).status).toBe(403);
    expect((await call(ctx, "GET", "/operators", { session: ana })).status).toBe(403);
    expect((await call(ctx, "POST", "/operators", { session: lee, body: { username: "x1", displayName: "X", role: "readonly", password: "Una-Clave-Larga-4410" } })).status).toBe(403);
  });

  it("un administrador no puede crear ni gestionar administradores o superadministradores", async () => {
    const ctx = await setup();
    const sara = await login(ctx, "sara", PW.sara);
    const mk = (role: string) => call(ctx, "POST", "/operators", { session: sara, body: { username: `n-${role}`, displayName: "Nuevo", role, password: "Una-Clave-Larga-4410" } });
    expect((await mk("superadmin")).status).toBe(403);
    expect((await mk("admin")).status).toBe(403);
    expect((await mk("support")).status).toBe(201);
    expect((await call(ctx, "PATCH", "/operators/2", { session: sara, body: { role: "admin" } })).status).toBe(403);
    expect((await call(ctx, "PATCH", "/operators/1", { session: sara, body: { status: "disabled" } })).status).toBe(403);
    expect((await call(ctx, "POST", "/operators/1/password", { session: sara, body: { password: "Toma-El-Control-0001" } })).status).toBe(403);
    expect((await call(ctx, "POST", "/operators/1/sessions/revoke", { session: sara })).status).toBe(403);
    // Ni a sí mismo: no puede cambiar su propio rol ni desactivarse
    expect((await call(ctx, "PATCH", "/operators/3", { session: sara, body: { role: "superadmin" } })).status).toBe(403);
    expect((await call(ctx, "PATCH", "/operators/3", { session: sara, body: { status: "disabled" } })).status).toBe(403);
    // Sí gestiona roles inferiores
    expect((await call(ctx, "PATCH", "/operators/2", { session: sara, body: { role: "support" } })).body.operator.role).toBe("support");
    expect(canManageRole("admin", "admin")).toBe(false);
    expect(canManageRole("sales", "readonly")).toBe(false);
  });

  it("un cambio de rol surte efecto de inmediato en las sesiones abiertas", async () => {
    const ctx = await setup();
    const ana = await login(ctx, "ana", PW.ana);
    expect((await call(ctx, "GET", "/tenants", { session: ana })).status).toBe(200);
    const root = await login(ctx, "root", PW.root);
    await call(ctx, "PATCH", "/operators/2", { session: root, body: { role: "readonly" } });
    expect((await call(ctx, "GET", "/auth/session", { session: ana })).body.scopes).not.toContain("crm:write");
  });

  it("un token de servicio no puede gestionar operadores aunque tenga los ámbitos", async () => {
    const ctx = await setup();
    const r = await call(ctx, "POST", "/operators", { bearer: SERVICE, body: { username: "intruso", displayName: "X", role: "superadmin", password: "Una-Clave-Larga-4410" } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("operator_session_required");
    // El token de servicio sigue funcionando igual y no tiene sesión de operador
    expect((await call(ctx, "GET", "/auth/me", { bearer: SERVICE })).body).toEqual({ actor: { type: "crm", id: "crm-main" }, scopes: tokens[0].scopes });
    expect((await call(ctx, "GET", "/auth/session", { bearer: SERVICE })).body.error).toBe("operator_session_required");
  });

  it("siempre queda al menos un superadministrador activo", async () => {
    const ctx = await setup();
    // Por la API, nadie puede desactivarse ni degradarse a sí mismo…
    const root = await login(ctx, "root", PW.root);
    expect((await call(ctx, "PATCH", "/operators/1", { session: root, body: { status: "disabled" } })).status).toBe(403);
    // …y el servicio y el almacén lo garantizan aunque actúe otro superadministrador
    const other = { id: 99, username: "otro", role: "superadmin" as const };
    await expect(ctx.svc.update(other, 1, { status: "disabled" })).rejects.toMatchObject({ code: "last_superadmin", status: 409 });
    await expect(ctx.svc.update(other, 1, { role: "admin" })).rejects.toMatchObject({ code: "last_superadmin" });
    await expect(ctx.store.update(1, { status: "disabled" }, { keepSuperadmin: true })).rejects.toBeInstanceOf(LastSuperadminError);
    // Con un segundo superadministrador activo, sí se puede
    expect((await call(ctx, "PATCH", "/operators/3", { session: root, body: { role: "superadmin" } })).status).toBe(200);
    await ctx.svc.update(other, 1, { role: "admin" });
    expect(ctx.store.operators.find((o) => o.id === 1)!.role).toBe("admin");
  });
});

describe("recuperación de contraseña", () => {
  it("sin proveedor de correo no se simula el envío", async () => {
    const ctx = await setup();
    expect((await call(ctx, "GET", "/auth/options")).body).toEqual({ passwordLogin: true, passwordReset: false, mfa: false, emailChange: false });
    const r = await call(ctx, "POST", "/auth/password-reset/request", { body: { username: "ana" } });
    expect(r.status).toBe(501);
    expect(r.body.error).toBe("reset_unavailable");
  });

  it("enlace temporal de un solo uso; cierra las sesiones; misma respuesta exista o no la cuenta", async () => {
    const sent: Array<{ to: string; link: string }> = [];
    const ctx = await setup({ mailer: { sendPasswordReset: async (to, link) => void sent.push({ to, link }) } });
    const s = await login(ctx, "ana", PW.ana);
    const a = await call(ctx, "POST", "/auth/password-reset/request", { body: { username: "ana" } });
    const b = await call(ctx, "POST", "/auth/password-reset/request", { body: { username: "nadie" } });
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body).toEqual(b.body);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ana@elephant.test");
    const token = new URL(sent[0].link.replace("#/", "")).searchParams.get("token")!;
    expect(ctx.store.resets.has(token)).toBe(false); // solo el hash
    expect((await call(ctx, "POST", "/auth/password-reset/confirm", { body: { token, password: "corta" } })).body.error).toBe("weak_password");
    expect((await call(ctx, "POST", "/auth/password-reset/confirm", { body: { token, password: "Recuperada-Sol-5512" } })).status).toBe(200);
    expect((await call(ctx, "POST", "/auth/password-reset/confirm", { body: { token, password: "Otra-Vez-Sol-5512x" } })).body.error).toBe("invalid_reset_token");
    expect((await call(ctx, "GET", "/auth/session", { session: s })).status).toBe(401);
    await login(ctx, "ana", "Recuperada-Sol-5512");
    // Caducado
    await call(ctx, "POST", "/auth/password-reset/request", { body: { username: "ana" } });
    const t2 = new URL(sent[1].link.replace("#/", "")).searchParams.get("token")!;
    ctx.clock.t += 31 * 60_000;
    expect((await call(ctx, "POST", "/auth/password-reset/confirm", { body: { token: t2, password: "Recuperada-Sol-9999" } })).body.error).toBe("invalid_reset_token");
  });
});

describe("auditoría", () => {
  it("registra accesos y cambios sensibles sin contraseñas ni tokens", async () => {
    const ctx = await setup();
    await call(ctx, "POST", "/auth/login", { body: { username: "ana", password: "mala-mala-mala-1" } });
    const s = await login(ctx, "ana", PW.ana);
    const root = await login(ctx, "root", PW.root);
    await call(ctx, "PATCH", "/operators/2", { session: root, body: { role: "support" } });
    await call(ctx, "POST", "/auth/logout", { session: s });
    const ev = await call(ctx, "GET", "/operators/2/events", { session: root });
    expect(ev.body.events.map((e: any) => e.kind).reverse()).toEqual(["operator_created", "login_failed", "login_success", "role_changed", "logout"]);
    const role = ev.body.events.find((e: any) => e.kind === "role_changed");
    expect(role).toMatchObject({ actor: "operator:root", details: { from: { role: "sales" }, changes: { role: "support" } } });
    const all = JSON.stringify(ctx.store.events);
    for (const secret of [PW.ana, PW.root, s.cookie.split("=")[1], root.cookie.split("=")[1], s.csrf]) expect(all).not.toContain(secret);
  });
});
