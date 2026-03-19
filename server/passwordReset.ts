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
import nodemailer from "nodemailer";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { users, passwordResetTokens } from "../drizzle/schema";

// ─── Configuración ────────────────────────────────────────────────────────────
const TOKEN_EXPIRY_MINUTES = 60; // El enlace caduca en 1 hora
const BCRYPT_ROUNDS = 12;

// ─── Mailer ───────────────────────────────────────────────────────────────────
function createMailer() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? "noreply@nayadeexperiences.es";

  if (!host || !user || !pass) {
    // Sin SMTP configurado: log en consola (útil en desarrollo)
    console.warn("[PasswordReset] SMTP no configurado — el enlace se imprimirá en consola.");
    return null;
  }

  return { transporter: nodemailer.createTransport({ host, port, auth: { user, pass } }), from };
}

async function sendResetEmail(to: string, resetUrl: string, name: string) {
  const mailer = createMailer();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;background:#f5f5f5;margin:0;padding:0">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:#0d1b2a;padding:32px 40px;text-align:center">
      <div style="display:inline-block;background:#f5a623;color:#0d1b2a;font-weight:700;font-size:20px;width:44px;height:44px;line-height:44px;border-radius:10px;margin-bottom:12px">N</div>
      <div style="color:#f5a623;font-size:11px;letter-spacing:3px;text-transform:uppercase">NÁYADE EXPERIENCES</div>
    </div>
    <div style="padding:40px">
      <h2 style="color:#0d1b2a;margin:0 0 12px">Recuperar contraseña</h2>
      <p style="color:#555;line-height:1.6">Hola ${name ?? ""},</p>
      <p style="color:#555;line-height:1.6">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón de abajo para crear una nueva contraseña:</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${resetUrl}" style="background:#f5a623;color:#0d1b2a;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;display:inline-block">
          Restablecer contraseña
        </a>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">Este enlace caduca en <strong>${TOKEN_EXPIRY_MINUTES} minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#aaa;font-size:12px">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${resetUrl}" style="color:#f5a623;word-break:break-all">${resetUrl}</a>
      </p>
    </div>
    <div style="background:#f9f9f9;padding:20px 40px;text-align:center">
      <p style="color:#bbb;font-size:12px;margin:0">Los Ángeles de San Rafael, Segovia · nayadeexperiences.es</p>
    </div>
  </div>
</body>
</html>`;

  if (!mailer) {
    // Sin SMTP: imprimir en consola para desarrollo
    console.log(`\n[PasswordReset] 📧 Enlace de recuperación para ${to}:\n  ${resetUrl}\n`);
    return;
  }

  await mailer.transporter.sendMail({
    from: mailer.from,
    to,
    subject: "Recuperar contraseña — Náyade Experiences",
    html,
  });
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
    const { email, origin } = req.body ?? {};

    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email obligatorio." });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Base de datos no disponible." });
        return;
      }

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);

      const user = rows[0];

      // Responder siempre 200 para no revelar si el email existe
      if (!user || !user.isActive) {
        res.json({ ok: true, message: "Si el email existe, recibirás un enlace en breve." });
        return;
      }

      // Invalidar tokens anteriores del mismo usuario (marcarlos como usados)
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

      // Generar token seguro
      const rawToken = crypto.randomBytes(48).toString("hex");
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token: rawToken,
        expiresAt,
      });

      // Construir URL de reset
      const baseUrl = (origin && typeof origin === "string")
        ? origin.replace(/\/$/, "")
        : (process.env.APP_URL ?? "http://localhost:3000");
      const resetUrl = `${baseUrl}/nueva-contrasena?token=${rawToken}`;

      await sendResetEmail(user.email ?? email, resetUrl, user.name ?? "");

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
  router.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    const { token, password } = req.body ?? {};

    if (!token || !password) {
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

      // Actualizar contraseña
      const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, resetToken.userId));

      // Marcar token como usado
      await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, resetToken.id));

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
  router.get("/api/auth/validate-reset-token", async (req: Request, res: Response) => {
    const token = req.query.token as string;

    if (!token) {
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
