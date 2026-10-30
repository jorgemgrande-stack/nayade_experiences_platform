/**
 * Enlaces de restablecimiento de contraseña de los operadores por la bandeja de salida de la plataforma
 * (server/mail: Brevo con el dominio de envío corporativo MAIL_SENDING_DOMAIN), sin un SMTP aparte.
 *
 * Reglas:
 *  - Solo se usa si NO hay CP_RESET_SMTP_URL (el SMTP propio tiene prioridad) y la política de correo no está
 *    en `off`: con el correo apagado, el restablecimiento queda NO disponible en vez de fingir un envío.
 *  - Respeta la política: en `sandbox` solo llega a las direcciones o dominios de MAIL_SANDBOX_ALLOWLIST.
 *  - El enlace es un secreto (en el registro solo está su SHA-256). La bandeja borra cuerpo y destinatario al
 *    enviar (`purge`) y aquí se intenta el envío en el momento, para que no espere al ciclo de la bandeja.
 */
import crypto from "node:crypto";
import type { PlatformMailer } from "../mail/platform";
import { scopeAllows, type MailPolicy } from "../mail/policy";
import type { ResetMailer } from "./operatorAuth";
import { passwordResetContent } from "../mail/accountTemplates";
import { TEMPLATE_CATALOG } from "../notifications/catalog";

/** Por qué la recuperación de contraseña de los operadores NO está disponible (null: lo está). Para el registro de arranque. */
export function resetUnavailableReason(o: { resetUrl: string | undefined; smtp: boolean; mailer: boolean; policy: Pick<MailPolicy, "mode" | "scope"> }): string | null {
  if (!o.resetUrl) return "falta CP_RESET_URL";
  if (o.smtp) return null;
  if (!o.mailer) return "sin proveedor de correo de la plataforma (ni CP_RESET_SMTP_URL)";
  if (o.policy.mode === "off") return "MAIL_MODE=off";
  if (!scopeAllows({ scope: { tenants: o.policy.scope.tenants, categories: null } }, "platform", "password_reset")) return "MAIL_SCOPE_TENANTS no incluye platform";
  if (!scopeAllows({ scope: { tenants: null, categories: o.policy.scope.categories } }, "platform", "password_reset")) return "MAIL_SCOPE_CATEGORIES no incluye password_reset";
  return null;
}


export function outboxResetMailer(mailer: PlatformMailer): ResetMailer {
  return {
    async sendPasswordReset(to, link) {
      // Una clave por enlace (el token es aleatorio): repetir la misma petición no duplica el correo
      const key = `operator-reset:${crypto.createHash("sha256").update(link).digest("hex").slice(0, 40)}`;
      const { subject, html, text } = passwordResetContent({ name: null, url: link, minutes: 30, account: "Big Elephant CRM (administración central)" });
      await mailer.send(null, key, "password_reset", to, { subject, html, text });
      await mailer.service.drain(5).catch(() => undefined);
    },
  };
}

/**
 * Aviso de seguridad al operador tras activar o retirar su verificación en dos pasos (plantilla security.mfa_changed,
 * sin enlaces). Por la bandeja de la plataforma, con su política (modo, autorizados y ámbito).
 */
export function outboxMfaNotice(mailer: PlatformMailer): (to: string, i: { key: string; at: number; enabled: boolean }) => Promise<void> {
  const spec = TEMPLATE_CATALOG.find((t) => t.id === "security.mfa_changed")!;
  return async (to, i) => {
    const content = spec.render!({ at: i.at, enabled: i.enabled }, { supportEmail: mailer.policy.supportEmail ?? null });
    await mailer.send(null, i.key, "security_notice", to, content);
  };
}
