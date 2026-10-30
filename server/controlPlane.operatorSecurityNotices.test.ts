/**
 * Avisos de seguridad de los operadores del CRM: contraseña cambiada, inicio de sesión desde un dispositivo nuevo y
 * cambio de correo verificado desde el correo nuevo (enlace de un solo uso, 24 h).
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { OperatorAuthService, type OperatorSecurityMail } from "./controlPlane/operatorAuth";
import { MemoryOperatorStore } from "./controlPlane/operatorStore";
import { createPublicAuthRouter } from "./controlPlane/operatorApi";
import { deviceOf } from "./controlPlane/operatorDevice";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { base32Decode, hotp, totpStep } from "./controlPlane/totp";

const PW = { root: "ci-only-placeholder-not-a-secret-1", ana: "ci-only-placeholder-not-a-secret-2", sara: "ci-only-placeholder-not-a-secret-3" };
const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromeWin2: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};
const DAY = 86_400_000;

type Sent = { kind: keyof OperatorSecurityMail; to: string; i: Record<string, unknown> };

async function setup(o: { mail?: OperatorSecurityMail | "record"; emailChangeUrl?: string | null; store?: MemoryOperatorStore; mfa?: boolean } = {}) {
  const clock = { t: Date.UTC(2026, 9, 30, 9) };
  const sent: Sent[] = [];
  const keys = new Set<string>();
  // Como la bandeja: la misma clave se envía una sola vez
  const rec = (kind: keyof OperatorSecurityMail) => async (to: string, i: { key: string }) => {
    if (keys.has(i.key)) return;
    keys.add(i.key);
    sent.push({ kind, to, i: i as Record<string, unknown> });
  };
  const mail: OperatorSecurityMail | undefined =
    o.mail === "record" || o.mail === undefined
      ? { passwordChanged: rec("passwordChanged"), newLogin: rec("newLogin"), emailChangeConfirmation: rec("emailChangeConfirmation"), emailChanged: rec("emailChanged") }
      : o.mail;
  const store = o.store ?? new MemoryOperatorStore();
  const ring = o.mfa ? keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv) : undefined;
  const svc = new OperatorAuthService(store, {
    now: () => clock.t,
    securityMail: mail,
    emailChangeUrl: o.emailChangeUrl === null ? undefined : (o.emailChangeUrl ?? "https://crm.elephant.example/cp/v1/auth/email-change/confirm"),
    mailer: { sendPasswordReset: async (_to, link) => void (lastResetLink.v = link) },
    resetUrl: "https://crm.elephant.example/#/restablecer",
    mfaKeyring: ring,
  });
  const lastResetLink = { v: "" };
  await svc.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
  const root = { id: 1, username: "root", role: "superadmin" as const };
  await svc.create(root, { username: "ana", email: "ana@elephant.example", displayName: "Ana", role: "admin", password: PW.ana });
  await svc.create(root, { username: "sara", displayName: "Sara", role: "sales", password: PW.sara });
  return { svc, store, clock, sent, root, ana: { id: 2, username: "ana", role: "admin" as const }, lastResetLink };
}

const tokenOf = (link: unknown) => new URL(String(link)).searchParams.get("token")!;

describe("dispositivo de una sesión", () => {
  it("familia de navegador y sistema; sin identificar, null", () => {
    expect(deviceOf(UA.chromeWin)).toEqual({ browser: "Chrome", os: "Windows" });
    expect(deviceOf(UA.edgeWin)).toEqual({ browser: "Edge", os: "Windows" });
    expect(deviceOf(UA.firefoxMac)).toEqual({ browser: "Firefox", os: "macOS" });
    expect(deviceOf(UA.safariIphone)).toEqual({ browser: "Safari", os: "iOS" });
    expect(deviceOf(UA.chromeAndroid)).toEqual({ browser: "Chrome", os: "Android" });
    for (const ua of [null, "", "curl/8.4.0", "Mozilla/5.0 (compatible; Googlebot/2.1)", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36"]) expect(deviceOf(ua), String(ua)).toBeNull();
  });
});

describe("aviso de inicio de sesión desde un dispositivo nuevo", () => {
  it("primer acceso sin aviso; mismo dispositivo (otra versión u otra IP) sin aviso; dispositivo nuevo con aviso una sola vez", async () => {
    const { svc, sent, clock } = await setup();
    const logins = () => sent.filter((s) => s.kind === "newLogin");
    await svc.login("ana", PW.ana, { ip: "203.0.113.1", userAgent: UA.chromeWin });
    expect(logins()).toHaveLength(0);
    clock.t += DAY;
    await svc.login("ana", PW.ana, { ip: "198.51.100.7", userAgent: UA.chromeWin2 });
    expect(logins()).toHaveLength(0);
    clock.t += DAY;
    const r = await svc.login("ana", PW.ana, { ip: "203.0.113.9", userAgent: UA.firefoxMac });
    expect(logins()).toEqual([{ kind: "newLogin", to: "ana@elephant.example", i: expect.objectContaining({ key: `operator-new-login:${r.session.id.slice(0, 40)}`, device: "Firefox en macOS", at: clock.t }) }]);
    // Ya conocido: el siguiente acceso con ese dispositivo no avisa
    clock.t += DAY;
    await svc.login("ana", PW.ana, { userAgent: UA.firefoxMac });
    expect(logins()).toHaveLength(1);
  });

  it("solo cuentan las sesiones de los últimos 90 días; sin correo o con user-agent no identificable, nada", async () => {
    const { svc, sent, clock } = await setup();
    await svc.login("ana", PW.ana, { userAgent: UA.chromeWin });
    clock.t += 91 * DAY;
    // La única referencia es de hace más de 90 días: no hay referencia, no avisa
    await svc.login("ana", PW.ana, { userAgent: UA.firefoxMac });
    expect(sent.filter((s) => s.kind === "newLogin")).toHaveLength(0);
    await svc.login("ana", PW.ana, { userAgent: "curl/8.4.0" });
    expect(sent.filter((s) => s.kind === "newLogin")).toHaveLength(0);
    // Sara no tiene correo
    await svc.login("sara", PW.sara, { userAgent: UA.chromeWin });
    await svc.login("sara", PW.sara, { userAgent: UA.safariIphone });
    expect(sent.filter((s) => s.kind === "newLogin")).toHaveLength(0);
  });

  it("con segundo factor: avisa tras completarlo, no tras la contraseña; la sesión pendiente no sirve de referencia", async () => {
    const { svc, sent, clock, ana } = await setup({ mfa: true });
    await svc.login("ana", PW.ana, { userAgent: UA.chromeWin });
    const { secret } = await svc.setupMfa(ana);
    await svc.enableMfa(ana, hotp(base32Decode(secret), totpStep(clock.t)));
    clock.t += 60_000;
    // Contraseña correcta desde otro dispositivo, sin el código: ni aviso ni referencia
    await svc.login("ana", PW.ana, { userAgent: UA.safariIphone });
    expect(sent.filter((s) => s.kind === "newLogin")).toHaveLength(0);
    clock.t += 60_000;
    const p = await svc.login("ana", PW.ana, { userAgent: UA.firefoxMac });
    expect(p.mfa).toBe("pending");
    expect(sent.filter((s) => s.kind === "newLogin")).toHaveLength(0);
    await svc.verifyMfa(p.token, hotp(base32Decode(secret), totpStep(clock.t)), { userAgent: UA.firefoxMac });
    expect(sent.filter((s) => s.kind === "newLogin").map((s) => s.i.device)).toEqual(["Firefox en macOS"]);
  });

  it("un fallo del aviso (o del almacén al consultarlo) nunca rompe el inicio de sesión ni toca sesiones", async () => {
    const boom: OperatorSecurityMail = { newLogin: async () => Promise.reject(new Error("smtp caído")) };
    const { svc, store } = await setup({ mail: boom });
    await svc.login("ana", PW.ana, { userAgent: UA.chromeWin });
    const r = await svc.login("ana", PW.ana, { userAgent: UA.firefoxMac });
    expect(await svc.validateSession(r.token)).not.toBeNull();
    store.recentSessionAgents = async () => Promise.reject(new Error("BD caída"));
    const r2 = await svc.login("ana", PW.ana, { userAgent: UA.safariIphone });
    expect(await svc.validateSession(r2.token)).not.toBeNull();
    expect(Array.from(store.sessions.values()).filter((s) => s.revokedAt !== null)).toHaveLength(0);
  });
});

describe("aviso de contraseña cambiada", () => {
  it("cambio propio, restablecimiento por enlace y contraseña fijada por un administrador avisan; sin correo, nada", async () => {
    const { svc, sent, clock, root, ana, lastResetLink } = await setup();
    await svc.changeOwnPassword(ana, PW.ana, "ci-only-placeholder-not-a-secret-4");
    clock.t += 1000;
    await svc.requestReset("ana");
    await svc.confirmReset(tokenOf(lastResetLink.v.replace("#/restablecer", "x")), "ci-only-placeholder-not-a-secret-5");
    clock.t += 1000;
    await svc.setPassword(root, 2, "ci-only-placeholder-not-a-secret-6");
    await svc.setPassword(root, 3, "ci-only-placeholder-not-a-secret-7");
    const pw = sent.filter((s) => s.kind === "passwordChanged");
    expect(pw.map((s) => s.to)).toEqual(["ana@elephant.example", "ana@elephant.example", "ana@elephant.example"]);
    expect(new Set(pw.map((s) => s.i.key)).size).toBe(3);
    // Una contraseña rechazada no avisa
    await expect(svc.changeOwnPassword(ana, "incorrecta", "ci-only-placeholder-not-a-secret-8")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(sent.filter((s) => s.kind === "passwordChanged")).toHaveLength(3);
  });

  it("un fallo del aviso no rompe el cambio de contraseña", async () => {
    const { svc, ana } = await setup({ mail: { passwordChanged: async () => Promise.reject(new Error("caído")) } });
    await svc.changeOwnPassword(ana, PW.ana, "ci-only-placeholder-not-a-secret-4");
    await expect(svc.login("ana", "ci-only-placeholder-not-a-secret-4")).resolves.toMatchObject({ mfa: "none" });
  });
});

describe("cambio de correo verificado", () => {
  it("queda pendiente; el enlace del correo nuevo lo aplica una vez y avisa al antiguo y al nuevo", async () => {
    const { svc, sent, root, store } = await setup();
    const r = await svc.update(root, 2, { email: "ana.nueva@elephant.example" });
    expect(r).toMatchObject({ email: "ana@elephant.example", pendingEmail: "ana.nueva@elephant.example" });
    expect((await store.get(2))!.email).toBe("ana@elephant.example");
    const confirm = sent.find((s) => s.kind === "emailChangeConfirmation")!;
    expect(confirm).toMatchObject({ to: "ana.nueva@elephant.example", i: { hours: 24, newEmail: "ana.nueva@elephant.example" } });
    expect(String(confirm.i.link)).toMatch(/^https:\/\/crm\.elephant\.example\/cp\/v1\/auth\/email-change\/confirm\?token=/);
    // El correo nuevo aún no sirve para entrar
    await expect(svc.login("ana.nueva@elephant.example", PW.ana)).rejects.toMatchObject({ code: "invalid_credentials" });
    const token = tokenOf(confirm.i.link);
    const open = await svc.login("ana", PW.ana, { userAgent: UA.chromeWin });
    await expect(svc.confirmEmailChange(token)).resolves.toEqual({ email: "ana.nueva@elephant.example" });
    // El cambio de un dato de acceso cierra sus sesiones abiertas
    expect(await svc.validateSession(open.token)).toBeNull();
    expect((await store.get(2))!.email).toBe("ana.nueva@elephant.example");
    expect(sent.filter((s) => s.kind === "emailChanged").map((s) => s.to)).toEqual(["ana@elephant.example", "ana.nueva@elephant.example"]);
    expect(sent.find((s) => s.kind === "emailChanged")!.i).toMatchObject({ oldEmail: "ana@elephant.example", newEmail: "ana.nueva@elephant.example" });
    // Reutilizado: no vale
    await expect(svc.confirmEmailChange(token)).rejects.toMatchObject({ code: "invalid_email_change_token", status: 400 });
    expect(store.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["email_change_requested", "email_changed"]));
  });

  it("caducado a las 24 h, anulado por otra solicitud o con el correo cambiado entretanto: no vale", async () => {
    const { svc, sent, root, clock, store } = await setup();
    await svc.update(root, 2, { email: "a1@elephant.example" });
    clock.t += 24 * 3600_000;
    await expect(svc.confirmEmailChange(tokenOf(sent.at(-1)!.i.link))).rejects.toMatchObject({ code: "invalid_email_change_token" });
    await svc.update(root, 2, { email: "a2@elephant.example" });
    const old = tokenOf(sent.at(-1)!.i.link);
    await svc.update(root, 2, { email: "a3@elephant.example" });
    await expect(svc.confirmEmailChange(old)).rejects.toMatchObject({ code: "invalid_email_change_token" });
    const latest = tokenOf(sent.at(-1)!.i.link);
    // El correo vigente cambia por otra vía (retirado por un administrador): el enlace pendiente deja de valer
    await svc.update(root, 2, { email: null });
    await expect(svc.confirmEmailChange(latest)).rejects.toMatchObject({ code: "invalid_email_change_token" });
    expect((await store.get(2))!.email).toBeNull();
    expect(sent.filter((s) => s.kind === "emailChanged")).toHaveLength(0);
    await expect(svc.confirmEmailChange("corto")).rejects.toMatchObject({ code: "invalid_email_change_token" });
  });

  it("el propio operador también verifica; correo de otro operador, conflicto; sin verificación disponible, se rechaza sin aplicar", async () => {
    const { svc, sent, ana, store } = await setup();
    await svc.update(ana, 2, { email: "ana.propia@elephant.example", displayName: "Ana P." });
    expect((await store.get(2))!).toMatchObject({ email: "ana@elephant.example", displayName: "Ana P." });
    expect(sent.at(-1)).toMatchObject({ kind: "emailChangeConfirmation", to: "ana.propia@elephant.example" });
    await expect(svc.update(ana, 2, { email: "ANA@elephant.example" })).resolves.not.toHaveProperty("pendingEmail");
    const off = await setup({ emailChangeUrl: null });
    await expect(off.svc.update(off.root, 2, { email: "otra@elephant.example" })).rejects.toMatchObject({ code: "email_change_unavailable", status: 503 });
    expect((await off.store.get(2))!.email).toBe("ana@elephant.example");
    const noTable = new MemoryOperatorStore();
    noTable.emailChangeSupported = false;
    const nt = await setup({ store: noTable });
    await expect(nt.svc.update(nt.root, 2, { email: "otra@elephant.example" })).rejects.toMatchObject({ code: "email_change_unavailable" });
    // Sara (sin correo) no puede reclamar el de Ana
    await expect(svc.update({ id: 1, username: "root", role: "superadmin" }, 3, { email: "ana@elephant.example" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("un fallo del aviso de correo cambiado no deshace el cambio", async () => {
    const links: string[] = [];
    const { svc, root, store } = await setup({ mail: { emailChangeConfirmation: async (_to, i) => void links.push(i.link), emailChanged: async () => Promise.reject(new Error("caído")) } });
    await svc.update(root, 2, { email: "ana.nueva@elephant.example" });
    await svc.confirmEmailChange(tokenOf(links[0]));
    expect((await store.get(2))!.email).toBe("ana.nueva@elephant.example");
  });

  it("página del enlace: el GET no confirma nada; el formulario (POST, mismo origen) confirma una sola vez", async () => {
    const { svc, sent, root, store } = await setup();
    const app = express();
    app.use(express.json());
    app.use("/cp/v1", createPublicAuthRouter({ service: svc, allowedOrigins: new Set(["https://crm.elephant.example"]) }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/auth/email-change/confirm`;
    try {
      await svc.update(root, 2, { email: "ana.nueva@elephant.example" });
      const token = tokenOf(sent.at(-1)!.i.link);
      const page = await fetch(`${base}?token=${encodeURIComponent(token)}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("referrer-policy")).toBe("same-origin");
      expect(page.headers.get("cache-control")).toBe("no-store");
      const html = await page.text();
      expect(html).toContain('<form method="post" action="confirm">');
      expect(html).not.toMatch(/<script/);
      expect((await store.get(2))!.email).toBe("ana@elephant.example");
      const post = (origin: string) =>
        fetch(base, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams({ token }).toString() });
      expect((await post("https://evil.example")).status).toBe(403);
      const ok = await post("https://crm.elephant.example");
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("Correo confirmado");
      expect((await store.get(2))!.email).toBe("ana.nueva@elephant.example");
      const again = await post("https://crm.elephant.example");
      expect(again.status).toBe(400);
      expect(await again.text()).toContain("No se ha podido confirmar");
      // Inyección en el token de la página: escapado
      expect(await (await fetch(`${base}?token=${encodeURIComponent('"><script>x</script>')}`)).text()).not.toContain("<script>x");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
