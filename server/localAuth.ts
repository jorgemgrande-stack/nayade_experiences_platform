/**
 * localAuth.ts — Autenticación local email+contraseña que reemplaza Manus OAuth.
 *
 * Flujo:
 *  POST /api/auth/login   → valida credenciales, emite cookie JWT
 *  POST /api/auth/logout  → borra la cookie
 *  GET  /api/auth/me      → devuelve el usuario de la sesión (usado por tRPC context)
 *
 * Compatible con el contexto tRPC existente: lee la misma cookie SESSION_COOKIE_NAME
 * y produce el mismo tipo { User } que el flujo OAuth anterior.
 */

import bcrypt from "bcryptjs";
import express, { type Request, type Response, type Router } from "express";
import { SignJWT, jwtVerify } from "jose";
import { sessionTenantAllowed, sessionTenantClaim } from "./_core/tenantRegistry/sessionBinding";
import { getSupportUser } from "./_core/support/session";
import { requireSessionSecret, sessionSecret, SessionSecretMissingError } from "./_core/sessionSecret";
import { isCrossOriginUnsafe } from "./_core/requestOrigin";
import { clearSessionCookies, readSessionToken, setSessionCookie, SESSION_COOKIE_LEGACY } from "./_core/sessionCookie";
import { loginLockRemaining, recordLoginFailure, recordLoginSuccess } from "./_core/loginThrottle";
import { createHash } from "crypto";
import { opsLog } from "./_core/ops/log";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Configuración ────────────────────────────────────────────────────────────
/** Nombre histórico; por HTTPS se usa `__Host-nayade_session` (ver _core/sessionCookie.ts). */
const COOKIE_NAME = SESSION_COOKIE_LEGACY;
const JWT_ALGO = "HS256" as const;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días en segundos

// Hash bcrypt ficticio (coste 12, como los reales) para igualar el tiempo de respuesta cuando el email no existe
const DUMMY_HASH = "$2b$12$T155QVv8a8sNEnADh7IrdOjtSQqNTNhE9aTU33dih76.j1hakGl.2";

/** En producción sin JWT_SECRET lanza al firmar (login → 503) y no valida ninguna sesión. */
function getSecret(): Uint8Array {
  return new TextEncoder().encode(requireSessionSecret());
}

/**
 * Huella de la contraseña vigente (claim `pwv`): cambiar la contraseña (recuperación, invitación,
 * cambio por un administrador) invalida todas las sesiones emitidas con la anterior.
 * Es un hash del hash: no permite recuperar nada de la contraseña.
 */
export function passwordFingerprint(passwordHash: string | null | undefined): string | undefined {
  if (!passwordHash) return undefined;
  return createHash("sha256").update(`pwv:${passwordHash}`).digest("base64url").slice(0, 16);
}

// ─── Helpers JWT ──────────────────────────────────────────────────────────────
export async function signSessionToken(userId: number, passwordHash?: string | null): Promise<string> {
  const pwv = passwordFingerprint(passwordHash);
  return new SignJWT({ sub: String(userId), ...sessionTenantClaim(), ...(pwv ? { pwv } : {}) })
    .setProtectedHeader({ alg: JWT_ALGO })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

async function verifySessionClaims(token: string): Promise<{ userId: number; pwv?: string } | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: [JWT_ALGO] });
    // El tenant de la sesión debe coincidir con el resuelto por el servidor (host → registro)
    if (!sessionTenantAllowed(payload.tid)) return null;
    const id = parseInt(String(payload.sub ?? ""), 10);
    if (isNaN(id)) return null;
    return { userId: id, pwv: typeof payload.pwv === "string" ? payload.pwv : undefined };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string): Promise<number | null> {
  return (await verifySessionClaims(token))?.userId ?? null;
}

/** Extrae el usuario de la cookie de sesión (para usar en createContext). */
export async function getUserFromRequest(req: Request) {
  // CSRF: una petición que modifica, declarada desde otro origen (incluida otra empresa de la
  // plataforma, que es el mismo «sitio» para el navegador), no se ejecuta con la sesión.
  if (isCrossOriginUnsafe(req)) return null;
  // Soporte delegado (solo si está configurado y hay una concesión vigente para este tenant)
  const support = await getSupportUser(req);
  if (support) return support as unknown as typeof users.$inferSelect;

  const token = readSessionToken(req);
  if (!token) return null;

  const claims = await verifySessionClaims(token);
  if (!claims) return null;
  const userId = claims.userId;

  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0] ?? null;
  // Un usuario desactivado pierde el acceso aunque su JWT siga vigente (30 días).
  if (user && user.isActive === false) return null;
  // Sesión emitida con una contraseña anterior: revocada. Los tokens previos a esta huella (sin
  // `pwv`) siguen valiendo hasta caducar, para no cerrar todas las sesiones al desplegar.
  if (user && claims.pwv && claims.pwv !== passwordFingerprint(user.passwordHash)) return null;
  return user;
}

/** Fallo de inicio de sesión: solo el motivo; nunca el correo, la contraseña ni si la cuenta existe. */
const loginFailed = (reason: string) => opsLog("warn", "Auth", "login_failed", { reason });

/**
 * Express 4 no captura los rechazos de los manejadores async: un fallo de la base de datos (p. ej. una
 * BD sin tablas) quedaba como rechazo no gestionado y, con Node 22, tumbaba el proceso entero. Este
 * envoltorio lo convierte en una respuesta genérica (503) sin detalles internos y deja constancia
 * solo del tipo de error.
 */
export function safeAuthRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((err: unknown) => {
      console.error(`[Auth] Error no controlado en ${req.method} ${req.path}: ${err instanceof Error ? err.name : "error"}`);
      if (!res.headersSent) res.status(503).json({ error: "Servicio no disponible temporalmente. Inténtalo más tarde." });
    });
  };
}

// ─── Router Express ───────────────────────────────────────────────────────────
export function createLocalAuthRouter(): Router {
  const router = express.Router();

  /** POST /api/auth/login */
  router.post("/api/auth/login", safeAuthRoute(async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Email y contraseña son obligatorios." });
      return;
    }
    // Login CSRF: no se aceptan inicios de sesión enviados desde otro origen
    if (isCrossOriginUnsafe(req)) {
      loginFailed("cross_origin");
      res.status(403).json({ error: "Origen no permitido." });
      return;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const lockMs = loginLockRemaining(normalizedEmail);
    if (lockMs > 0) {
      loginFailed("locked");
      res.setHeader("Retry-After", String(Math.ceil(lockMs / 1000)));
      res.status(429).json({ error: "Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.", code: "RATE_LIMIT_EXCEEDED" });
      return;
    }

    const db = await getDb();
    if (!db) {
      loginFailed("db_unavailable");
      res.status(503).json({ error: "Base de datos no disponible." });
      return;
    }

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    const user = rows[0];
    // Siempre se compara (también sin usuario) para no revelar por el tiempo qué emails existen
    const valid = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !valid) {
      recordLoginFailure(normalizedEmail);
      loginFailed("invalid_credentials");
      res.status(401).json({ error: "Credenciales incorrectas." });
      return;
    }
    recordLoginSuccess(normalizedEmail);

    // El estado de la cuenta solo se revela a quien conoce la contraseña
    if (!user.isActive) {
      loginFailed("account_inactive");
      res.status(403).json({ error: "Cuenta desactivada. Contacta con el administrador." });
      return;
    }

    // Actualizar lastSignedIn
    await db
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, user.id));

    let token: string;
    try {
      token = await signSessionToken(user.id, user.passwordHash);
    } catch (err) {
      if (err instanceof SessionSecretMissingError) {
        console.error("[Auth] JWT_SECRET no configurado: inicio de sesión desactivado");
        res.status(503).json({ error: "Inicio de sesión no disponible temporalmente." });
        return;
      }
      console.error("[Auth] No se pudo emitir la sesión");
      loginFailed("session_error");
      res.status(500).json({ error: "Error interno. Inténtalo más tarde." });
      return;
    }

    setSessionCookie(req, res, token, COOKIE_MAX_AGE * 1000);

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    });
  }));

  /** POST /api/auth/logout */
  router.post("/api/auth/logout", (_req: Request, res: Response) => {
    clearSessionCookies(res);
    res.json({ ok: true });
  });

  /** GET /api/auth/me — útil para el cliente si quiere verificar sesión vía REST */
  router.get("/api/auth/me", safeAuthRoute(async (req: Request, res: Response) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "No autenticado." });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    });
  }));

  return router;
}

export { COOKIE_NAME };
