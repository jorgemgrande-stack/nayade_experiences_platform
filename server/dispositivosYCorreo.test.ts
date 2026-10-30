/**
 * Seguridad de la cuenta (bloques 3 y 4):
 *  - dispositivos: un dispositivo nuevo avisa una vez (`security.new_login`), uno conocido no avisa, el primer
 *    dispositivo de un usuario no avisa, un fallo del registro o del aviso nunca rompe el inicio de sesión;
 *  - cambio de correo: token de un solo uso con caducidad, unicidad del correo, aviso `account.email_changed` al
 *    correo ANTERIOR, cierre de sesiones, propietaria de la empresa protegida;
 *  - aislamiento entre empresas (cada empresa, su propio registro).
 *
 * Almacenes en memoria con el mismo contrato que las tablas de la base de cada empresa; inicio de sesión con Express
 * real y una base que falla. Contraseñas: marcadores ficticios.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response } from "express";
import bcrypt from "bcryptjs";

const PW = { current: "ci-only-placeholder-not-a-secret-1", wrong: "ci-only-placeholder-not-a-secret-2" };

const dbState = vi.hoisted(() => ({ user: null as any }));
vi.mock("./db", () => {
  const rows = () => (dbState.user ? [dbState.user] : []);
  const chain = (result: () => unknown): any =>
    new Proxy(function () {}, { get: (_t, p) => (p === "then" ? (ok: (v: unknown) => void) => ok(result()) : chain(result)), apply: () => chain(result) });
  return { getDb: async () => ({ select: () => chain(rows), update: () => chain(() => [{ affectedRows: 1 }]), insert: () => chain(() => [{ affectedRows: 1 }]) }) };
});
// La base de la empresa para el registro de dispositivos falla (sin tabla, caída…): el inicio de sesión no lo nota
vi.mock("./_core/dbRegistry", () => ({ getTenantDatabase: async () => ({ execute: async () => { throw new Error("conexión perdida"); } }) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async () => { throw new Error("correo caído"); }) }));
vi.mock("./emailManager", () => ({ logDirectEmail: vi.fn(async () => undefined) }));

import { createLocalAuthRouter } from "./localAuth";
import { describeUserAgent, deviceFingerprint, listMyDevices, processLoginDevice, trackLoginDevice, DevicesUnavailableError, type DeviceDeps, type DeviceRow, type DeviceStore } from "./accountSecurity/devices";
import { confirmEmailChange, hashToken, requestEmailChange, EmailChangeError, type EmailChangeDeps, type EmailChangeStore, type EmailChangeUser } from "./accountSecurity/emailChange";
import type { MailParams } from "./mailer";

const UA_CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const UA_CHROME_WIN_NEXT = UA_CHROME_WIN.replace("130.0.0.0", "131.0.0.0");
const UA_SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const NOW = new Date(Date.UTC(2026, 9, 30, 9, 0));

// ─── Almacenes en memoria (una instancia = la base de UNA empresa) ─────────────

function memoryDevices(): DeviceStore & { rows: Array<DeviceRow & { userId: number; notifiedAt: Date | null }>; users: Map<number, { email: string | null; name: string | null; isActive: boolean }> } {
  const rows: Array<DeviceRow & { userId: number; notifiedAt: Date | null }> = [];
  const users = new Map<number, { email: string | null; name: string | null; isActive: boolean }>();
  let seq = 0;
  return {
    rows,
    users,
    async touch(userId, fingerprint, label) {
      const r = rows.find((x) => x.userId === userId && x.fingerprint === fingerprint);
      if (r) {
        r.lastSeenAt = new Date();
        return false;
      }
      rows.push({ id: ++seq, userId, fingerprint, label, firstSeenAt: new Date(), lastSeenAt: new Date(), notifiedAt: null });
      return true;
    },
    async countOthers(userId, fingerprint) {
      return rows.filter((x) => x.userId === userId && x.fingerprint !== fingerprint).length;
    },
    async claimNotice(userId, fingerprint) {
      const r = rows.find((x) => x.userId === userId && x.fingerprint === fingerprint && !x.notifiedAt);
      if (!r) return false;
      r.notifiedAt = new Date();
      return true;
    },
    async list(userId) {
      return rows.filter((x) => x.userId === userId);
    },
    async forget(userId, id) {
      const i = rows.findIndex((x) => x.userId === userId && x.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async contact(userId) {
      return users.get(userId) ?? null;
    },
  };
}

function memoryEmailChange(): EmailChangeStore & { users: Map<number, EmailChangeUser & { sessionsRevokedAt: Date | null }>; tokens: Array<{ id: number; userId: number; newEmail: string; tokenHash: string; createdAt: Date; expiresAt: Date; usedAt: Date | null }>; resetTokensRevokedFor: number[] } {
  const users = new Map<number, EmailChangeUser & { sessionsRevokedAt: Date | null }>();
  const tokens: Array<{ id: number; userId: number; newEmail: string; tokenHash: string; createdAt: Date; expiresAt: Date; usedAt: Date | null }> = [];
  const resetTokensRevokedFor: number[] = [];
  return {
    users,
    tokens,
    resetTokensRevokedFor,
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async emailTaken(email, except) {
      return Array.from(users.values()).some((u) => u.id !== except && (u.email ?? "").toLowerCase() === email);
    },
    async countSince(userId, since) {
      return tokens.filter((t) => t.userId === userId && t.createdAt >= since).length;
    },
    async invalidatePending(userId, at) {
      for (const t of tokens) if (t.userId === userId && !t.usedAt) t.usedAt = at;
    },
    async insert(t) {
      tokens.push({ id: tokens.length + 1, ...t, usedAt: null });
    },
    async findValid(tokenHash, now) {
      const t = tokens.find((x) => x.tokenHash === tokenHash && !x.usedAt && x.expiresAt > now);
      return t ? { id: t.id, userId: t.userId, newEmail: t.newEmail } : null;
    },
    async consume(id, now) {
      const t = tokens.find((x) => x.id === id && !x.usedAt);
      if (!t) return false;
      t.usedAt = now;
      return true;
    },
    async apply(userId, newEmail, now) {
      const u = users.get(userId)!;
      u.email = newEmail;
      u.sessionsRevokedAt = now;
      resetTokensRevokedFor.push(userId);
    },
    async pending(userId, now) {
      const t = [...tokens].reverse().find((x) => x.userId === userId && !x.usedAt && x.expiresAt > now);
      return t ? { newEmail: t.newEmail, expiresAt: t.expiresAt } : null;
    },
  };
}

const outbox = () => {
  const sent: MailParams[] = [];
  return { sent, send: async (m: MailParams) => (sent.push(m), true) };
};

// ─── Dispositivos ──────────────────────────────────────────────────────────────

describe("huella y etiqueta del dispositivo", () => {
  it("sin versiones: actualizar el navegador no es un dispositivo nuevo; otra cookie u otro navegador, sí", () => {
    expect(describeUserAgent(UA_CHROME_WIN).label).toBe("Chrome en Windows");
    expect(describeUserAgent(UA_SAFARI_IPHONE).label).toBe("Safari en iPhone");
    expect(describeUserAgent("").label).toBe("Navegador desconocido");
    const id = "a".repeat(43);
    expect(deviceFingerprint(id, UA_CHROME_WIN)).toBe(deviceFingerprint(id, UA_CHROME_WIN_NEXT));
    expect(deviceFingerprint(id, UA_CHROME_WIN)).not.toBe(deviceFingerprint("b".repeat(43), UA_CHROME_WIN));
    expect(deviceFingerprint(id, UA_CHROME_WIN)).not.toBe(deviceFingerprint(id, UA_SAFARI_IPHONE));
    // La huella no contiene ni la cookie ni el user-agent
    expect(deviceFingerprint(id, UA_CHROME_WIN)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("aviso de nuevo inicio de sesión", () => {
  const setup = () => {
    const store = memoryDevices();
    store.users.set(7, { email: "ana@empresa-a.example", name: "Ana", isActive: true });
    const box = outbox();
    const deps: DeviceDeps = { store, send: box.send, brand: () => "Empresa A", baseUrl: () => "https://empresa-a.app.bigelephant.es", now: () => NOW };
    return { store, box, deps };
  };

  it("el primer dispositivo de un usuario se registra sin aviso; uno conocido no avisa", async () => {
    const { deps, box } = setup();
    expect(await processLoginDevice(deps, { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" })).toBe("first_device");
    expect(await processLoginDevice(deps, { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" })).toBe("known");
    expect(box.sent).toEqual([]);
  });

  it("un dispositivo nuevo avisa UNA vez a la propia persona, con fecha, dispositivo y enlace para cambiar la contraseña", async () => {
    const { deps, box } = setup();
    await processLoginDevice(deps, { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" });
    expect(await processLoginDevice(deps, { userId: 7, fingerprint: "f2".repeat(32), label: "Safari en iPhone" })).toBe("notified");
    expect(await processLoginDevice(deps, { userId: 7, fingerprint: "f2".repeat(32), label: "Safari en iPhone" })).toBe("known");
    expect(box.sent).toHaveLength(1);
    const m = box.sent[0];
    expect(m.to).toBe("ana@empresa-a.example");
    expect(m.category).toBe("security_notice");
    expect(m.idempotencyKey).toMatch(/^security\.new_login:7:/);
    expect(m.html).toContain("Safari en iPhone");
    expect(m.html).toContain("30 de octubre de 2026");
    expect(m.html).toContain("https://empresa-a.app.bigelephant.es/recuperar-contrasena");
    expect(m.subject).toContain("Empresa A");
  });

  it("idempotente ante dos inicios de sesión simultáneos desde el mismo dispositivo nuevo", async () => {
    const { deps, box } = setup();
    await processLoginDevice(deps, { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" });
    // Ambos ven el dispositivo como nuevo, pero solo uno reclama el aviso
    const store = deps.store;
    const racy: DeviceDeps = { ...deps, store: { ...store, touch: async (u, f, l) => (await store.touch(u, f, l), true) } };
    await Promise.all([processLoginDevice(racy, { userId: 7, fingerprint: "f3".repeat(32), label: "Firefox en Linux" }), processLoginDevice(racy, { userId: 7, fingerprint: "f3".repeat(32), label: "Firefox en Linux" })]);
    expect(box.sent).toHaveLength(1);
  });

  it("olvidar un dispositivo: solo los propios; vuelve a avisar si se usa otra vez", async () => {
    const { deps, store, box } = setup();
    await processLoginDevice(deps, { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" });
    await processLoginDevice(deps, { userId: 7, fingerprint: "f2".repeat(32), label: "Safari en iPhone" });
    const mine = await listMyDevices(store, 7, "f1".repeat(32));
    expect(mine.devices.map((d) => [d.label, d.current])).toEqual([["Chrome en Windows", true], ["Safari en iPhone", false]]);
    expect(JSON.stringify(mine)).not.toContain("f2f2");
    const iphone = mine.devices.find((d) => !d.current)!;
    expect(await store.forget(8, iphone.id)).toBe(false);
    expect(await store.forget(7, iphone.id)).toBe(true);
    await processLoginDevice(deps, { userId: 7, fingerprint: "f2".repeat(32), label: "Safari en iPhone" });
    expect(box.sent).toHaveLength(2);
  });

  it("sin tabla (empresa sin la migración 0016): no avisa ni falla", async () => {
    const { deps } = setup();
    const broken: DeviceStore = { ...deps.store, touch: async () => { throw new DevicesUnavailableError(); }, list: async () => { throw new DevicesUnavailableError(); } };
    expect(await processLoginDevice({ ...deps, store: broken }, { userId: 7, fingerprint: "f1".repeat(32), label: "x" })).toBe("unavailable");
    expect(await listMyDevices(broken, 7, null)).toEqual({ available: false, devices: [] });
  });

  it("un fallo del aviso no sale del enganche del inicio de sesión: la cookie de dispositivo se fija igualmente", async () => {
    const { deps } = setup();
    await processLoginDevice(deps, { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const cookies: Array<[string, string, Record<string, unknown>]> = [];
      const req = { headers: { "user-agent": UA_SAFARI_IPHONE }, secure: true } as unknown as Request;
      const res = { cookie: (n: string, v: string, o: Record<string, unknown>) => void cookies.push([n, v, o]) } as unknown as Response;
      const failing: DeviceDeps = { ...deps, send: async () => { throw new Error("SMTP caído"); } };
      expect(() => trackLoginDevice(req, res, 7, () => failing)).not.toThrow();
      expect(cookies).toHaveLength(1);
      expect(cookies[0][0]).toBe("__Host-be_device");
      expect(cookies[0][1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookies[0][2]).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      // Y si las dependencias ni siquiera se pueden construir, tampoco
      expect(() => trackLoginDevice(req, res, 7, () => { throw new Error("sin base"); })).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      // El dispositivo quedó registrado aunque el aviso fallase
      expect((await deps.store.list(7)).length).toBe(2);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("inicio de sesión real con el registro de dispositivos y el correo caídos", () => {
  let server: http.Server;
  let port = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => void unhandled.push(e);
  beforeAll(async () => {
    process.env.JWT_SECRET ??= "ci-only-placeholder-not-a-secret-000000000000";
    dbState.user = { id: 7, email: "ana@empresa-a.example", name: "Ana", role: "admin", isActive: true, passwordHash: await bcrypt.hash(PW.current, 4), avatarUrl: null };
    process.on("unhandledRejection", onUnhandled);
    const app = express();
    app.use(express.json());
    app.use(createLocalAuthRouter());
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    process.off("unhandledRejection", onUnhandled);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("200 con la sesión y la cookie de dispositivo; ningún rechazo sin gestionar", async () => {
    const body = JSON.stringify({ email: "ana@empresa-a.example", password: PW.current });
    const r = await new Promise<{ status: number; cookies: string[] }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/auth/login", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": UA_CHROME_WIN } }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, cookies: ([] as string[]).concat(res.headers["set-cookie"] ?? []) }));
      });
      req.on("error", reject);
      req.end(body);
    });
    expect(r.status).toBe(200);
    expect(r.cookies.some((c) => c.startsWith("nayade_session="))).toBe(true);
    expect(r.cookies.some((c) => c.startsWith("be_device="))).toBe(true);
    await new Promise((res) => setTimeout(res, 30));
    expect(unhandled).toEqual([]);
  });
});

// ─── Cambio de correo ──────────────────────────────────────────────────────────

describe("cambio del correo de acceso con verificación", () => {
  const setup = async (o: { owner?: string | null } = {}) => {
    const store = memoryEmailChange();
    const passwordHash = await bcrypt.hash(PW.current, 4);
    store.users.set(7, { id: 7, email: "ana@empresa-a.example", name: "Ana", isActive: true, passwordHash, sessionsRevokedAt: null });
    store.users.set(8, { id: 8, email: "luis@empresa-a.example", name: "Luis", isActive: true, passwordHash, sessionsRevokedAt: null });
    const box = outbox();
    let now = NOW;
    const deps: EmailChangeDeps = { store, send: box.send, brand: () => "Empresa A", baseUrl: () => "https://empresa-a.app.bigelephant.es", now: () => now, ownerEmail: async () => o.owner ?? null };
    const tokenOf = (m: MailParams) => decodeURIComponent(/verificar-correo\?token=([A-Za-z0-9_%-]+)/.exec(m.html)![1]);
    return { store, box, deps, tokenOf, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  };
  const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof EmailChangeError ? e.code : String(e)));

  it("solicitud: enlace al correo NUEVO, solo el hash guardado; confirmación: cambio aplicado, sesiones cerradas y aviso al correo ANTERIOR", async () => {
    const { store, box, deps, tokenOf } = await setup();
    const r = await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "  Ana.Nueva@Empresa-A.example ", currentPassword: PW.current });
    expect(r).toEqual({ sent: true, newEmail: "ana.nueva@empresa-a.example" });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0].to).toBe("ana.nueva@empresa-a.example");
    expect(box.sent[0].category).toBe("email_verification");
    const token = tokenOf(box.sent[0]);
    expect(store.tokens[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(store.tokens)).not.toContain(token);
    expect(store.tokens[0].expiresAt.getTime() - NOW.getTime()).toBe(60 * 60_000);

    const c = await confirmEmailChange(deps, { userId: 7, token });
    expect(c).toEqual({ email: "ana.nueva@empresa-a.example", noticeSent: true });
    expect(store.users.get(7)!.email).toBe("ana.nueva@empresa-a.example");
    expect(store.users.get(7)!.sessionsRevokedAt).toEqual(NOW);
    expect(store.resetTokensRevokedFor).toEqual([7]);
    const notice = box.sent[1];
    expect(notice.to).toBe("ana@empresa-a.example");
    expect(notice.category).toBe("security_notice");
    expect(notice.html).toContain("ana.nueva@empresa-a.example");
    expect(notice.html).toContain("https://www.bigelephant.es/soporte");
    expect(notice.html).not.toContain("token=");
  });

  it("token de un solo uso: el segundo canje falla; uno caducado (60 min) también", async () => {
    const { box, deps, tokenOf, advance } = await setup();
    await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "ana.nueva@empresa-a.example", currentPassword: PW.current });
    const token = tokenOf(box.sent[0]);
    await confirmEmailChange(deps, { userId: 7, token });
    expect(await code(confirmEmailChange(deps, { userId: 7, token }))).toBe("invalid_token");

    await requestEmailChange(deps, { actorId: 8, userId: 8, newEmail: "luis.nuevo@empresa-a.example", currentPassword: PW.current });
    const late = tokenOf(box.sent.at(-1)!);
    advance(60 * 60_000 + 1);
    expect(await code(confirmEmailChange(deps, { userId: 8, token: late }))).toBe("invalid_token");
  });

  it("una nueva solicitud anula la anterior; el token de otra persona no vale (ni se consume)", async () => {
    const { box, deps, tokenOf } = await setup();
    await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "uno@empresa-a.example", currentPassword: PW.current });
    const first = tokenOf(box.sent[0]);
    await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "dos@empresa-a.example", currentPassword: PW.current });
    const second = tokenOf(box.sent[1]);
    expect(await code(confirmEmailChange(deps, { userId: 7, token: first }))).toBe("invalid_token");
    expect(await code(confirmEmailChange(deps, { userId: 8, token: second }))).toBe("invalid_token");
    expect(await code(confirmEmailChange(deps, { userId: 7, token: second }))).toBe("ok");
  });

  it("unicidad: no se puede pedir un correo de otro usuario de la empresa, ni aplicarlo si se ocupó mientras tanto", async () => {
    const { store, box, deps, tokenOf } = await setup();
    expect(await code(requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "LUIS@empresa-a.example", currentPassword: PW.current }))).toBe("email_taken");
    expect(await code(requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "ana@empresa-a.example", currentPassword: PW.current }))).toBe("same_email");
    await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "libre@empresa-a.example", currentPassword: PW.current });
    store.users.get(8)!.email = "libre@empresa-a.example";
    expect(await code(confirmEmailChange(deps, { userId: 7, token: tokenOf(box.sent[0]) }))).toBe("email_taken");
    expect(store.users.get(7)!.email).toBe("ana@empresa-a.example");
  });

  it("autoservicio exige la contraseña actual; un administrador puede pedirlo por otro usuario (confirma el usuario)", async () => {
    const { box, deps, tokenOf } = await setup();
    expect(await code(requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "x@empresa-a.example", currentPassword: PW.wrong }))).toBe("bad_password");
    expect(await code(requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "x@empresa-a.example" }))).toBe("bad_password");
    expect(box.sent).toEqual([]);
    await requestEmailChange(deps, { actorId: 7, userId: 8, newEmail: "luis.nuevo@empresa-a.example" });
    const token = tokenOf(box.sent[0]);
    // El administrador no puede confirmarlo por él
    expect(await code(confirmEmailChange(deps, { userId: 7, token }))).toBe("invalid_token");
    expect((await confirmEmailChange(deps, { userId: 8, token })).email).toBe("luis.nuevo@empresa-a.example");
    expect(box.sent[1].to).toBe("luis@empresa-a.example");
  });

  it("límite de solicitudes por hora y propietaria de la empresa protegida", async () => {
    const { deps } = await setup();
    for (let i = 0; i < 5; i++) await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: `n${i}@empresa-a.example`, currentPassword: PW.current });
    expect(await code(requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "n9@empresa-a.example", currentPassword: PW.current }))).toBe("rate_limited");
    const owned = await setup({ owner: "ana@empresa-a.example" });
    expect(await code(requestEmailChange(owned.deps, { actorId: 7, userId: 7, newEmail: "n@empresa-a.example", currentPassword: PW.current }))).toBe("owner_account");
  });

  it("un fallo del aviso al correo anterior no deshace el cambio", async () => {
    const { store, box, deps, tokenOf } = await setup();
    await requestEmailChange(deps, { actorId: 7, userId: 7, newEmail: "ana.nueva@empresa-a.example", currentPassword: PW.current });
    const token = tokenOf(box.sent[0]);
    const r = await confirmEmailChange({ ...deps, send: async () => { throw new Error("SMTP caído"); } }, { userId: 7, token });
    expect(r.noticeSent).toBe(false);
    expect(store.users.get(7)!.email).toBe("ana.nueva@empresa-a.example");
  });
});

// ─── Aislamiento entre empresas ────────────────────────────────────────────────

describe("aislamiento entre empresas", () => {
  it("el mismo usuario y dispositivo en dos empresas: registros, avisos, tokens y unicidad independientes", async () => {
    const devA = memoryDevices();
    const devB = memoryDevices();
    for (const s of [devA, devB]) s.users.set(7, { email: "ana@ejemplo.example", name: "Ana", isActive: true });
    const box = outbox();
    const dd = (store: DeviceStore, brand: string): DeviceDeps => ({ store, send: box.send, brand: () => brand, baseUrl: () => `https://${brand.toLowerCase()}.app.bigelephant.es`, now: () => NOW });
    await processLoginDevice(dd(devA, "A"), { userId: 7, fingerprint: "f1".repeat(32), label: "Chrome en Windows" });
    await processLoginDevice(dd(devA, "A"), { userId: 7, fingerprint: "f2".repeat(32), label: "Safari en iPhone" });
    // En B ese dispositivo es el primero del usuario: sin aviso, y A no ve los de B
    expect(await processLoginDevice(dd(devB, "B"), { userId: 7, fingerprint: "f2".repeat(32), label: "Safari en iPhone" })).toBe("first_device");
    expect(box.sent.map((m) => m.subject)).toEqual([expect.stringContaining("(A)")]);
    expect((await devA.list(7)).length).toBe(2);
    expect((await devB.list(7)).length).toBe(1);
    expect(await devB.forget(7, (await devA.list(7))[0].id)).toBe(true); // id local de B (1): no toca A
    expect((await devA.list(7)).length).toBe(2);

    const a = memoryEmailChange();
    const b = memoryEmailChange();
    const hash = await bcrypt.hash(PW.current, 4);
    a.users.set(7, { id: 7, email: "ana@ejemplo.example", name: "Ana", isActive: true, passwordHash: hash, sessionsRevokedAt: null });
    a.users.set(8, { id: 8, email: "ocupado@ejemplo.example", name: "Otro", isActive: true, passwordHash: hash, sessionsRevokedAt: null });
    b.users.set(7, { id: 7, email: "ana@ejemplo.example", name: "Ana", isActive: true, passwordHash: hash, sessionsRevokedAt: null });
    const mail = outbox();
    const ed = (store: EmailChangeStore): EmailChangeDeps => ({ store, send: mail.send, brand: () => "X", baseUrl: () => "https://x.app.bigelephant.es", now: () => NOW, ownerEmail: async () => null });
    // El correo ocupado en A está libre en B
    await expect(requestEmailChange(ed(a), { actorId: 7, userId: 7, newEmail: "ocupado@ejemplo.example", currentPassword: PW.current })).rejects.toMatchObject({ code: "email_taken" });
    await requestEmailChange(ed(b), { actorId: 7, userId: 7, newEmail: "ocupado@ejemplo.example", currentPassword: PW.current });
    const token = decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(mail.sent[0].html)![1]);
    // El token emitido en B no vale en A (mismo id de usuario)
    await expect(confirmEmailChange(ed(a), { userId: 7, token })).rejects.toMatchObject({ code: "invalid_token" });
    expect((await confirmEmailChange(ed(b), { userId: 7, token })).email).toBe("ocupado@ejemplo.example");
    expect(a.users.get(7)!.email).toBe("ana@ejemplo.example");
  });
});
