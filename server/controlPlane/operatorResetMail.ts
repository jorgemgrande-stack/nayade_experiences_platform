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
import type { ResetMailer } from "./operatorAuth";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function outboxResetMailer(mailer: PlatformMailer): ResetMailer {
  return {
    async sendPasswordReset(to, link) {
      // Una clave por enlace (el token es aleatorio): repetir la misma petición no duplica el correo
      const key = `operator-reset:${crypto.createHash("sha256").update(link).digest("hex").slice(0, 40)}`;
      const subject = "Big Elephant CRM — restablecer la contraseña";
      const text = `Se ha solicitado restablecer tu contraseña de Big Elephant CRM.\n\nAbre este enlace (válido 30 minutos, un solo uso):\n${link}\n\nSi no lo has solicitado, ignora este mensaje.`;
      const html =
        `<p>Se ha solicitado restablecer tu contraseña de Big Elephant CRM.</p>` +
        `<p><a href="${esc(link)}">Restablecer la contraseña</a> (válido 30 minutos, un solo uso).</p>` +
        `<p>Si no lo has solicitado, ignora este mensaje.</p>`;
      await mailer.send(null, key, "password_reset", to, { subject, html, text });
      await mailer.service.drain(5).catch(() => undefined);
    },
  };
}
