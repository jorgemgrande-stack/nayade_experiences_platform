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
 *
 * Requiere la migración db/registry/0007_operators.sql aplicada. Al arrancar solo se COMPRUEBA
 * que existen las tablas (lectura); nunca se migra en el arranque.
 */
import type mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import { OperatorAuthService, type ResetMailer } from "./operatorAuth";
import { MysqlOperatorStore } from "./operatorStore";

function smtpMailer(url: string, from: string): ResetMailer {
  const transport = nodemailer.createTransport(url);
  return {
    async sendPasswordReset(to, link) {
      await transport.sendMail({
        from,
        to,
        subject: "Big Elephant CRM — restablecer la contraseña",
        text: `Se ha solicitado restablecer tu contraseña de Big Elephant CRM.\n\nAbre este enlace (válido 30 minutos, un solo uso):\n${link}\n\nSi no lo has solicitado, ignora este mensaje.`,
      });
    },
  };
}

export async function operatorAuthFromEnv(pool: mysql.Pool, env: NodeJS.ProcessEnv): Promise<{ service?: OperatorAuthService; cookieSecure: "auto" | boolean; reason?: string }> {
  const cookieSecure = env.CP_COOKIE_SECURE === "true" ? true : env.CP_COOKIE_SECURE === "false" ? false : "auto";
  if (env.CP_OPERATOR_AUTH === "off") return { cookieSecure, reason: "desactivado (CP_OPERATOR_AUTH=off)" };
  try {
    await pool.query("SELECT id FROM cp_operators LIMIT 1");
    await pool.query("SELECT id FROM cp_operator_sessions LIMIT 1");
  } catch (e: any) {
    if (e?.code === "ER_NO_SUCH_TABLE") return { cookieSecure, reason: "falta la migración db/registry/0007_operators.sql" };
    throw e;
  }
  const idle = Number(env.CP_SESSION_IDLE_MINUTES ?? 120);
  const max = Number(env.CP_SESSION_MAX_HOURS ?? 12);
  const mail = env.CP_RESET_SMTP_URL && env.CP_RESET_FROM && env.CP_RESET_URL ? smtpMailer(env.CP_RESET_SMTP_URL, env.CP_RESET_FROM) : undefined;
  const service = new OperatorAuthService(new MysqlOperatorStore(pool), {
    idleMs: Math.min(Math.max(Number.isFinite(idle) ? idle : 120, 5), 24 * 60) * 60_000,
    maxMs: Math.min(Math.max(Number.isFinite(max) ? max : 12, 1), 24) * 3600_000,
    mailer: mail,
    resetUrl: mail ? env.CP_RESET_URL : undefined,
  });
  return { service, cookieSecure };
}
