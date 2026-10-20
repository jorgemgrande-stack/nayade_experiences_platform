/**
 * passwordReset.ts — Flujo de recuperación de contraseña.
 *
 * Endpoints:
 *  POST /api/auth/forgot-password  → genera token, envía email con enlace
 *  POST /api/auth/reset-password   → valida token, actualiza contraseña
 *
 * Compatible con LOCAL_AUTH=true. En modo Manus, estos endpoints no se montan.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { users, passwordResetTokens } from "../drizzle/schema";
import { buildPasswordResetHtml } from "./emailTemplates";
import { sendEmail } from "./mailer";
import { logDirectEmail } from "./emailManager";
import { brandName } from "./tenantBrand";
import { getTrustedBaseUrl } from "./_core/publicUrl";

// ─── Configuración ────────────────────────────────────────────────────────────
const TOKEN_EXPIRY_MINUTES = 60; // El enlace caduca en 1 hora
const BCRYPT_ROUNDS = 12;

/**
 * Aviso de seguridad tras cambiar la contraseña: a la propia persona, sin enlaces (si no fue ella, que avise a su
 * administración o a soporte). Nunca lleva copia global (categoría security_notice).
 */
export function passwordChangedEmail(name: string | null, at: Date) {
  const brand = brandName();
  const when = at.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
  const hello = name ? `Hola ${escapeHtml(name)},` : "Hola,";
  const text = `${name ? `Hola ${name},` : "Hola,"}

La contraseña de tu cuenta de ${brand} se ha cambiado el ${when} (hora de Madrid).

Si has sido tú, no tienes que hacer nada. Si no has sido tú, avisa cuanto antes a la administración de tu empresa o a soporte: las sesiones abiertas con la contraseña anterior ya se han cerrado.

${brand}`;
  const html = `<p>${hello}</p><p>La contraseña de tu cuenta de <strong>${escapeHtml(brand)}</strong> se ha cambiado el ${escapeHtml(when)} (hora de Madrid).</p><p>Si has sido tú, no tienes que hacer nada. Si no has sido tú, avisa cuanto antes a la administración de tu empresa o a soporte: las sesiones abiertas con la contraseña anterior ya se han cerrado.</p><p>${escapeHtml(brand)}</p>`;
  return { subject: `Tu contraseña se ha cambiado — ${brand}`, html, text };
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);

async function sendResetEmail(to: string, resetUrl: string, name: string) {
  const html = buildPasswordResetHtml({ name: name ?? "", resetUrl, expiryMinutes: TOKEN_EXPIRY_MINUTES });
  const resetSubject = `Recuperar contraseña — ${brandName()}`;
  const sent = await sendEmail({ to, subject: resetSubject, html, category: "password_reset" });
  logDirectEmail({ templateKey: "password_reset", triggerEvent: "password_reset_requested", recipientEmail: to, subject: resetSubject, sent }).catch(() => {});
  if (!sent) {
    if (process.env.NODE_ENV !== "production") {
      // Solo en desarrollo: imprimir el enlace en consola
      console.log(`\n[PasswordReset] 📧 Enlace de recuperación para ${to}:\n  ${resetUrl}\n`);
    } else {
      // En producción el enlace contiene un token: nunca va a los logs
      console.warn("[PasswordReset] No se pudo enviar el e-mail de recuperación.");
    }
  }
}

/** Filas afectadas de un UPDATE de drizzle/mysql2 ([ResultSetHeader, …]). */
export function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

/** Canje y validación de enlaces: límite por IP (el token no es adivinable, pero se evita el sondeo). */
const tokenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera 1 minuto antes de volver a intentarlo.", code: "RATE_LIMIT_EXCEEDED" },
});

/**
 * Solicitud de restablecimiento en la empresa en curso (contexto de tenant): invalida los enlaces anteriores,
 * crea uno nuevo y lo envía con el remitente y la URL pública de la empresa. No revela si el correo existe.
 * La usan /api/auth/forgot-password y el acceso centralizado (_core/centralAuth.ts).
 */
export async function requestPasswordReset(rawEmail: string): Promise<"sent" | "no_user" | "db_unavailable"> {
  const email = rawEmail.toLowerCase().trim();
  const db = await getDb();
  if (!db) return "db_unavailable";

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !user.isActive) return "no_user";

  // Invalidar tokens anteriores del mismo usuario (marcarlos como usados)
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  // Generar token seguro
  const rawToken = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);
  await db.insert(passwordResetTokens).values({ userId: user.id, token: rawToken, expiresAt });

  // Construir URL de reset
  const baseUrl = getTrustedBaseUrl();
  const resetUrl = `${baseUrl}/nueva-contrasena?token=${rawToken}`;
  await sendResetEmail(user.email ?? email, resetUrl, user.name ?? "");
  return "sent";
}

// ─── Router Express ───────────────────────────────────────────────────────────
export function createPasswordResetRouter(): Router {
  const router = express.Router();

  /**
   * POST /api/auth/forgot-password
   * Body: { email: string }
   *
   * Siempre responde 200 (no revela si el email existe).
   */
  router.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    // El `origin` del cuerpo se ignora a propósito: el enlace se construye con una URL de confianza.
    const { email } = req.body ?? {};

    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email obligatorio." });
      return;
    }

    try {
      if ((await requestPasswordReset(email)) === "db_unavailable") {
        res.status(503).json({ error: "Base de datos no disponible." });
        return;
      }
      // Responder siempre 200 para no revelar si el email existe
      res.json({ ok: true, message: "Si el email existe, recibirás un enlace en breve." });
    } catch (err) {
      console.error("[PasswordReset] Error en forgot-password:", err);
      res.status(500).json({ error: "Error interno. Inténtalo más tarde." });
    }
  });

  /**
   * POST /api/auth/reset-password
   * Body: { token: string, password: string }
   */
  router.post("/api/auth/reset-password", tokenRateLimit, async (req: Request, res: Response) => {
    const { token, password } = req.body ?? {};

    if (!token || !password || typeof token !== "string") {
      res.status(400).json({ error: "Token y contraseña son obligatorios." });
      return;
    }

    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de datos no disponible." });
        return;
      }

      const now = new Date();

      // Buscar token válido (no usado, no expirado)
      const tokenRows = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, String(token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now)
          )
        )
        .limit(1);

      const resetToken = tokenRows[0];

      if (!resetToken) {
        res.status(400).json({ error: "El enlace no es válido o ha expirado. Solicita uno nuevo." });
        return;
      }

      // Consumir el token de forma atómica ANTES de cambiar la contraseña: dos peticiones
      // simultáneas con el mismo enlace no pueden usarlo ambas (un solo uso real).
      const consumed = await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokens.id, resetToken.id), isNull(passwordResetTokens.usedAt)));
      if (affectedRows(consumed) !== 1) {
        res.status(400).json({ error: "El enlace no es válido o ha expirado. Solicita uno nuevo." });
        return;
      }

      // Actualizar contraseña (las sesiones abiertas con la anterior quedan revocadas: claim pwv)
      const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, resetToken.userId));

      // Aviso de seguridad a la propia persona (sin enlaces); un fallo del aviso no cambia la respuesta
      const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, resetToken.userId)).limit(1);
      if (u?.email) {
        const m = passwordChangedEmail(u.name ?? null, now);
        void sendEmail({ to: u.email, subject: m.subject, html: m.html, text: m.text, category: "security_notice" }).catch(() => undefined);
      }
      res.json({ ok: true, message: "Contraseña actualizada correctamente." });
    } catch (err) {
      console.error("[PasswordReset] Error en reset-password:", err);
      res.status(500).json({ error: "Error interno. Inténtalo más tarde." });
    }
  });

  /**
   * GET /api/auth/validate-reset-token?token=xxx
   * Verifica si un token es válido sin consumirlo.
   */
  router.get("/api/auth/validate-reset-token", tokenRateLimit, async (req: Request, res: Response) => {
    const token = req.query.token;

    if (!token || typeof token !== "string") {
      res.status(400).json({ valid: false, error: "Token requerido." });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ valid: false });
        return;
      }

      const now = new Date();
      const rows = await db
        .select({ id: passwordResetTokens.id })
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, token),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now)
          )
        )
        .limit(1);

      res.json({ valid: rows.length > 0 });
    } catch {
      res.status(500).json({ valid: false });
    }
  });

  return router;
}
