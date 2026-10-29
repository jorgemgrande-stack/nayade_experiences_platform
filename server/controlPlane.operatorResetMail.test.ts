/** Restablecimiento de contraseña de operadores por la bandeja de salida de la plataforma (sin SMTP propio). */
import { describe, it, expect, vi } from "vitest";
import type mysql from "mysql2/promise";
import { OperatorAuthService } from "./controlPlane/operatorAuth";
import { MemoryOperatorStore } from "./controlPlane/operatorStore";
import { outboxResetMailer } from "./controlPlane/operatorResetMail";
import { operatorAuthFromEnv } from "./controlPlane/operatorSetup";
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { PlatformMailer } from "./mail/platform";
import crypto from "node:crypto";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { base32Decode, hotp, totpStep } from "./controlPlane/totp";

const PW = "Raiz-Segura-Prado-2026!";
const RESET_URL = "https://admin.bigelephant.es/#/restablecer";

const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);

async function setup(email: string, mode = "sandbox", extra: Record<string, string> = {}) {
  const store = new MemoryMailStore();
  const provider = memoryProvider();
  const policy = mailPolicyFromEnv({ MAIL_MODE: mode, MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "bigelephant.es", ...extra } as NodeJS.ProcessEnv);
  const mailer = new PlatformMailer(new MailService({ lane: "platform", store, provider, policy }), policy);
  const svc = new OperatorAuthService(new MemoryOperatorStore(), { mailer: outboxResetMailer(mailer), resetUrl: RESET_URL, mfaKeyring: ring });
  await svc.bootstrap({ username: "jorge", displayName: "Jorge", email, password: PW });
  return { svc, store, provider };
}

describe("restablecimiento de operadores por la bandeja de la plataforma", () => {
  it("envía el enlace en el momento, desde el dominio corporativo, y no deja el enlace guardado", async () => {
    const { svc, store, provider } = await setup("ops@bigelephant.es");
    expect(svc.resetAvailable).toBe(true);
    await svc.requestReset("jorge");
    expect(provider.sent).toHaveLength(1);
    const m = provider.sent[0] as any;
    expect(JSON.stringify(m)).toContain("ops@bigelephant.es");
    expect(JSON.stringify(m)).toMatch(/no-reply@bigelephant\.es/);
    const link = /https:\/\/admin\.bigelephant\.es\/#\/restablecer\?token=[^\s"<]+/.exec(m.text ?? "")![0];
    // Bandeja: cuerpo y destinatario borrados al enviar (el enlace es un secreto)
    expect(store.rows[0]).toMatchObject({ status: "accepted", category: "password_reset", html: null, text: null, toEmail: null });
    // El enlace funciona
    const token = decodeURIComponent(link.split("token=")[1]);
    await svc.confirmReset(token, "Otra-Clave-Segura-Prado-2026!");
    await expect(svc.login("jorge", "Otra-Clave-Segura-Prado-2026!")).resolves.toBeTruthy();
  });

  it("con MFA activo: el enlace no abre sesión, cierra las abiertas y el login sigue exigiendo el segundo factor", async () => {
    const { svc, provider } = await setup("ops@bigelephant.es");
    // Alta del MFA del operador
    const first = await svc.login("jorge", PW);
    const actor = { id: first.operator.id, username: "jorge", role: first.operator.role, sessionId: first.session.id } as any;
    const { secret } = await svc.setupMfa(actor);
    await svc.enableMfa(actor, hotp(base32Decode(secret), totpStep(Date.now())));
    const full = await svc.verifyMfa((await svc.login("jorge", PW)).token, hotp(base32Decode(secret), totpStep(Date.now()) + 1));
    expect(await svc.validateSession(full.token)).not.toBeNull();

    // Restablecimiento por la bandeja
    await svc.requestReset("jorge");
    const text = (provider.sent.at(-1) as any).text as string;
    const token = decodeURIComponent(/token=(\S+)/.exec(text)![1]);
    const NEW = "Otra-Clave-Segura-Prado-2026!";
    expect(await svc.confirmReset(token, NEW)).toBeUndefined(); // no devuelve sesión ni token
    // Las sesiones abiertas quedan cerradas
    expect(await svc.validateSession(full.token)).toBeNull();
    // Con la contraseña nueva, el login sigue en dos pasos: la sesión pendiente no da acceso
    const pending = await svc.login("jorge", NEW);
    expect(pending.mfa).toBe("pending");
    expect(await svc.validateSession(pending.token)).toBeNull();
    // Y el enlace es de un solo uso
    await expect(svc.confirmReset(token, "Tercera-Clave-Segura-Prado-2026!")).rejects.toMatchObject({ code: "invalid_reset_token" });
  });

  it("con el ámbito de production (solo platform) y password_reset en las categorías, el enlace sale (incidencia 29/10/2026)", async () => {
    const scope = { MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice,contract_invitation,password_reset" };
    const { svc, store, provider } = await setup("ops@bigelephant.es", "sandbox", scope);
    await svc.requestReset("jorge");
    expect(provider.sent).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "accepted", tenantId: "platform", category: "password_reset" });
    // Sin password_reset en las categorías, la bandeja lo rechaza: por eso el arranque no ofrece la recuperación
    const sin = await setup("ops@bigelephant.es", "sandbox", { ...scope, MAIL_SCOPE_CATEGORIES: "lead_request_notice,contract_invitation" });
    await sin.svc.requestReset("jorge");
    expect(sin.provider.sent).toHaveLength(0);
  });
  it("en sandbox, un destinatario fuera de la lista no recibe nada y tampoco queda el enlace", async () => {
    const { svc, store, provider } = await setup("jorge@gmail.example");
    await svc.requestReset("jorge");
    expect(provider.sent).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: "skipped", html: null, text: null, toEmail: null });
  });
});

describe("arranque: transporte del restablecimiento", () => {
  const pool = { query: vi.fn(async () => [[], []]) } as unknown as mysql.Pool;
  const fake = { sendPasswordReset: async () => undefined };

  it("sin SMTP propio usa la bandeja; el SMTP propio tiene prioridad; sin CP_RESET_URL no hay restablecimiento", async () => {
    const outbox = await operatorAuthFromEnv(pool, { CP_RESET_URL: RESET_URL } as NodeJS.ProcessEnv, { resetMailer: fake });
    expect(outbox).toMatchObject({ resetTransport: "outbox" });
    expect(outbox.service!.resetAvailable).toBe(true);

    const smtp = await operatorAuthFromEnv(
      pool,
      { CP_RESET_URL: RESET_URL, CP_RESET_SMTP_URL: "smtp://u:p@127.0.0.1:2525", CP_RESET_FROM: "no-reply@bigelephant.es" } as NodeJS.ProcessEnv,
      { resetMailer: fake },
    );
    expect(smtp.resetTransport).toBe("smtp");

    const none = await operatorAuthFromEnv(pool, {} as NodeJS.ProcessEnv, { resetMailer: fake });
    expect(none.resetTransport).toBeNull();
    expect(none.service!.resetAvailable).toBe(false);

    const off = await operatorAuthFromEnv(pool, { CP_RESET_URL: RESET_URL } as NodeJS.ProcessEnv); // correo apagado: main.ts no pasa la bandeja
    expect(off.resetTransport).toBeNull();
  });
});
