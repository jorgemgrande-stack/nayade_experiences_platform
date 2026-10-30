/**
 * Configuración de la autenticación de operadores a partir del entorno.
 *
 *   CP_OPERATOR_AUTH=off            desactiva el acceso con usuario y contraseña
 *   CP_SESSION_IDLE_MINUTES         inactividad máxima de la sesión (defecto 120)
 *   CP_SESSION_MAX_HOURS            duración máxima de la sesión (defecto 12, máx. 24)
 *   CP_COOKIE_SECURE                auto (defecto: Secure en HTTPS) | true | false
 *   CP_RESET_SMTP_URL, CP_RESET_FROM, CP_RESET_URL
 *                                   recuperación de contraseña por correo; sin los tres no se
 *                                   ofrece (nunca se simula el envío)
 *   CP_OPERATOR_MFA=off             desactiva el segundo factor (por defecto, activo si la migración
 *                                   0012 está aplicada y hay llavero del registro)
 *   CP_OPERATOR_MFA_ROLES           roles que DEBEN usar MFA, separados por comas (p. ej.
 *                                   superadmin,admin). Por defecto ninguno: es opcional para todos
 *
 * Requiere la migración db/registry/0007_operators.sql aplicada (y la 0012 para el segundo factor).
 * Al arrancar solo se COMPRUEBA que existen las tablas (lectura); nunca se migra en el arranque.
 */
import type mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import { passwordResetContent } from "../mail/accountTemplates";
import type { Keyring } from "../_core/tenantRegistry/crypto";
import { OperatorAuthService, type OperatorAuthOptions, type ResetMailer } from "./operatorAuth";
import { isRole, type OperatorRole } from "./operatorRoles";
import { MysqlOperatorStore } from "./operatorStore";
import { missingMfaKeys } from "./operatorMfaKeys";
import { crmUrlFromEnv } from "../crm/leadNotices";

function smtpMailer(url: string, from: string): ResetMailer {
  const transport = nodemailer.createTransport(url);
  return {
    async sendPasswordReset(to, link) {
      const m = passwordResetContent({ name: null, url: link, minutes: 30, account: "Big Elephant CRM (administración central)" });
      await transport.sendMail({ from, to, subject: m.subject, html: m.html, text: m.text });
    },
  };
}

/** Roles con MFA obligatorio a partir de CP_OPERATOR_MFA_ROLES (se ignoran los desconocidos). */
export function mfaRolesFromEnv(raw: string | undefined): OperatorRole[] {
  return (raw ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is OperatorRole => isRole(x));
}

export interface OperatorAuthSetup {
  service?: OperatorAuthService;
  cookieSecure: "auto" | boolean;
  reason?: string;
  /** Cómo se envían los enlaces de restablecimiento (`null`: no disponible). */
  resetTransport?: "smtp" | "outbox" | null;
  mfa?: { available: boolean; requiredRoles: OperatorRole[]; misconfigured: boolean; reason?: string; missingKeys?: string[] };
}

export async function operatorAuthFromEnv(
  pool: mysql.Pool,
  env: NodeJS.ProcessEnv,
  /** `resetMailer`: alternativa al SMTP propio (p. ej. la bandeja de salida de la plataforma, operatorResetMail.ts). */
  opts: { keyring?: Keyring; resetMailer?: ResetMailer; securityNotice?: OperatorAuthOptions["securityNotice"]; securityMail?: OperatorAuthOptions["securityMail"] } = {},
): Promise<OperatorAuthSetup> {
  const cookieSecure = env.CP_COOKIE_SECURE === "true" ? true : env.CP_COOKIE_SECURE === "false" ? false : "auto";
  if (env.CP_OPERATOR_AUTH === "off") return { cookieSecure, reason: "desactivado (CP_OPERATOR_AUTH=off)" };
  try {
    await pool.query("SELECT id FROM cp_operators LIMIT 1");
    await pool.query("SELECT id FROM cp_operator_sessions LIMIT 1");
  } catch (e: any) {
    if (e?.code === "ER_NO_SUCH_TABLE") return { cookieSecure, reason: "falta la migración db/registry/0007_operators.sql" };
    throw e;
  }
  // Segundo factor: solo con la migración 0012 (columnas y tabla) y con el llavero del registro. Sin ella,
  // el acceso funciona exactamente como antes.
  let mfaReason: string | undefined;
  let mfaColumns = false;
  if (env.CP_OPERATOR_MFA === "off") mfaReason = "desactivado (CP_OPERATOR_MFA=off)";
  else if (!opts.keyring) mfaReason = "sin llavero del registro";
  else {
    try {
      await pool.query("SELECT mfa_enabled_at FROM cp_operators LIMIT 0");
      await pool.query("SELECT mfa_state FROM cp_operator_sessions LIMIT 0");
      await pool.query("SELECT id FROM cp_operator_recovery_codes LIMIT 0");
      mfaColumns = true;
    } catch (e: any) {
      if (e?.code !== "ER_BAD_FIELD_ERROR" && e?.code !== "ER_NO_SUCH_TABLE") throw e;
      mfaReason = "falta la migración db/registry/0012_operator_mfa.sql";
    }
  }
  // Los roles obligatorios se respetan SIEMPRE: si el MFA no está disponible, esos operadores no entran
  // (falla cerrado) y el arranque lo registra como alerta, en lugar de ignorarlos en silencio.
  const requiredRoles = mfaRolesFromEnv(env.CP_OPERATOR_MFA_ROLES);
  const idle = Number(env.CP_SESSION_IDLE_MINUTES ?? 120);
  const max = Number(env.CP_SESSION_MAX_HOURS ?? 12);
  // Restablecimiento por correo: SMTP propio (CP_RESET_SMTP_URL + CP_RESET_FROM) o, si no hay, el que se pase
  // (bandeja de la plataforma). Siempre con CP_RESET_URL; sin ninguno, el restablecimiento no está disponible.
  const smtp = env.CP_RESET_SMTP_URL && env.CP_RESET_FROM ? smtpMailer(env.CP_RESET_SMTP_URL, env.CP_RESET_FROM) : undefined;
  const mail = env.CP_RESET_URL ? (smtp ?? opts.resetMailer) : undefined;
  const resetTransport = !mail ? null : smtp ? "smtp" : "outbox";
  // Cambio de correo verificado: con la migración 0015. Sin ella, el cambio de correo se rechaza (no se aplica sin verificar)
  let emailChanges = false;
  try {
    await pool.query("SELECT token_hash FROM cp_operator_email_changes LIMIT 0");
    emailChanges = true;
  } catch (e: any) {
    if (e?.code !== "ER_NO_SUCH_TABLE") throw e;
  }
  // La página de confirmación la sirve el plano de control en el mismo origen que el CRM (/cp/v1 tras su pasarela)
  const crmOrigin = crmUrlFromEnv(env);
  const service = new OperatorAuthService(new MysqlOperatorStore(pool, { mfa: mfaColumns, emailChanges }), {
    idleMs: Math.min(Math.max(Number.isFinite(idle) ? idle : 120, 5), 24 * 60) * 60_000,
    maxMs: Math.min(Math.max(Number.isFinite(max) ? max : 12, 1), 24) * 3600_000,
    mailer: mail,
    resetUrl: mail ? env.CP_RESET_URL : undefined,
    mfaKeyring: mfaColumns ? opts.keyring : undefined,
    mfaRequiredRoles: requiredRoles,
    securityNotice: opts.securityNotice,
    securityMail: opts.securityMail,
    emailChangeUrl: crmOrigin ? `${crmOrigin}/cp/v1/auth/email-change/confirm` : undefined,
  });
  if (service.mfaMisconfigured) {
    console.error(
      JSON.stringify({ ctx: "OperatorAuth", event: "mfa_required_but_unavailable", level: "error", requiredRoles, reason: mfaReason ?? "unknown", effect: "esos roles no pueden entrar hasta corregirlo" }),
    );
  }
  // Secretos TOTP cifrados con una clave que ya no está en REGISTRY_KEYS: esos operadores no podrán completar
  // el segundo paso. Suele ser una rotación sin `rotate-keys` (ver operatorMfaKeys.ts). Se avisa al arrancar.
  // Comprobación solo informativa: un fallo transitorio de MySQL no debe impedir el arranque.
  let missingKeys: string[] = [];
  if (mfaColumns && opts.keyring) {
    try {
      missingKeys = await missingMfaKeys(pool, opts.keyring);
    } catch (e: any) {
      console.error(JSON.stringify({ ctx: "OperatorAuth", event: "mfa_key_check_failed", level: "warn", error: e?.code ?? "error" }));
    }
  }
  if (missingKeys.length) {
    console.error(
      JSON.stringify({ ctx: "OperatorAuth", event: "mfa_key_missing", level: "error", missingKeys, effect: "los operadores con esos secretos no pueden completar el segundo paso; restaura la clave en REGISTRY_KEYS y ejecuta rotate-keys" }),
    );
  }
  return {
    service,
    cookieSecure,
    resetTransport,
    mfa: { available: service.mfaAvailable, requiredRoles, ...(mfaReason ? { reason: mfaReason } : {}), misconfigured: service.mfaMisconfigured, ...(missingKeys.length ? { missingKeys } : {}) },
  };
}
