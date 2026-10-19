/**
 * Acceso centralizado de las empresas desde un host de plataforma (p. ej. app.bigelephant.es).
 *
 *  1. POST https://<CENTRAL_LOGIN_HOST>/api/central/login {email, password}
 *     Se comprueba la contraseña en las empresas que admiten acceso al panel. Solo se devuelven aquellas en las
 *     que es correcta (nunca revela en qué empresas existe un correo). Por cada una, un PASE firmado de un solo
 *     uso (5 min) ligado a empresa, host de destino, usuario y huella de la contraseña.
 *  2. El navegador envía el pase por POST (formulario) a https://<host de la empresa>/api/auth/handoff, que
 *     comprueba todo de nuevo con el contexto de ESA empresa y emite su sesión habitual (cookie __Host- del
 *     propio host). La sesión nunca viaja en una URL ni se comparte entre empresas.
 *  3. POST https://<CENTRAL_LOGIN_HOST>/api/central/forgot {email}: recuperación de contraseña de cada empresa en
 *     la que existe el correo, con el flujo y el remitente de esa empresa. Respuesta siempre igual.
 *
 * Inactivo sin CENTRAL_LOGIN_HOST o fuera de multiempresa.
 */
import crypto from "node:crypto";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { accessPolicy } from "./tenantRegistry/lifecycle";
import { normalizeHost } from "./tenantRegistry/host";
import type { Tenant, TenantDomain } from "./tenantRegistry/contract";
import { choosePublicDomain } from "./tenantIdentity";
import { isMultiTenant, peekTenantContext, runWithTenant } from "./tenant";
import { requireSessionSecret, sessionSecret } from "./sessionSecret";
import { loginLockRemaining, recordLoginFailure, recordLoginSuccess } from "./loginThrottle";
import { opsLog } from "./ops/log";

const HANDOFF_PURPOSE = "central-handoff";
const HANDOFF_TTL_S = 5 * 60;
const ALG = "HS256" as const;
/** Mismo coste que los hashes reales: sin candidatos se compara igual (el tiempo no revela correos). */
const DUMMY_HASH = "$2b$12$T155QVv8a8sNEnADh7IrdOjtSQqNTNhE9aTU33dih76.j1hakGl.2";
const MAX_EMAIL = 254;
const MAX_PASSWORD = 256;

export const centralLoginHost = (env: NodeJS.ProcessEnv = process.env): string | null =>
  isMultiTenant() && env.CENTRAL_LOGIN_HOST ? normalizeHost(env.CENTRAL_LOGIN_HOST) : null;

/** Página de inicio según el rol (igual que el cliente, client/src/pages/Login.tsx). */
export function homeForRole(role: string | null | undefined): string {
  if (role === "partner_admin" || role === "partner_user") return "/partner/dashboard";
  if (role === "supplier") return "/supplier/dashboard";
  if (role === "employee") return "/empleado";
  if (role === "gestoria") return "/gestoria";
  return "/admin";
}

const sameOrigin = (req: Request, host: string) => String(req.headers.origin ?? "") === `https://${host}`;
const requestHost = (req: Request) => normalizeHost(req.headers.host);

// ─── Pases de un solo uso ──────────────────────────────────────────────────────

export interface HandoffClaims {
  tid: string;
  aud: string;
  sub: string;
  pwv: string;
  jti: string;
}

export async function signHandoff(c: Omit<HandoffClaims, "jti">, now = Date.now()): Promise<string> {
  return new SignJWT({ purpose: HANDOFF_PURPOSE, tid: c.tid, pwv: c.pwv })
    .setProtectedHeader({ alg: ALG })
    .setSubject(c.sub)
    .setAudience(c.aud)
    .setJti(crypto.randomBytes(16).toString("base64url"))
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + HANDOFF_TTL_S)
    .sign(new TextEncoder().encode(requireSessionSecret()));
}

export async function verifyHandoff(token: string, expected: { tid: string; aud: string }): Promise<HandoffClaims | null> {
  const secret = sessionSecret();
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: [ALG], audience: expected.aud });
    if (payload.purpose !== HANDOFF_PURPOSE || payload.tid !== expected.tid) return null;
    if (typeof payload.sub !== "string" || typeof payload.pwv !== "string" || typeof payload.jti !== "string") return null;
    return { tid: expected.tid, aud: expected.aud, sub: payload.sub, pwv: payload.pwv, jti: payload.jti };
  } catch {
    return null;
  }
}

/** Pases ya canjeados (un solo uso). En memoria del proceso: basta con una réplica del Core y TTL corto. */
const usedJti = new Map<string, number>();
export function consumeJti(jti: string, now = Date.now()): boolean {
  usedJti.forEach((exp, k) => {
    if (exp < now) usedJti.delete(k);
  });
  if (usedJti.has(jti)) return false;
  usedJti.set(jti, now + (HANDOFF_TTL_S + 60) * 1000);
  return true;
}

// ─── Dependencias ──────────────────────────────────────────────────────────────

export interface CentralAuthDeps {
  host: string;
  listTenants: () => Promise<Pick<Tenant, "id" | "displayName" | "status">[]>;
  listDomains: (tenantId: string) => Promise<TenantDomain[]>;
  /** Usuario de una empresa por correo (null si no hay BD o no existe). */
  findUser: (tenantId: string, email: string) => Promise<{ id: number; passwordHash: string | null; isActive: boolean } | null>;
  /** Recuperación de contraseña de la empresa (en su contexto). */
  requestReset: (tenantId: string, email: string) => Promise<void>;
  passwordFingerprint: (hash: string | null | undefined) => string | undefined;
  log?: (event: string, data: Record<string, unknown>) => void;
}

async function eachLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ─── Router del host central ───────────────────────────────────────────────────

/** Rutas /api/central/* del host central. Se monta ANTES de la resolución de empresa (el host no es de ninguna). */
export function createCentralAuthRouter(d: CentralAuthDeps): Router {
  const r = express.Router();
  const log = d.log ?? ((event, data) => opsLog("info", "CentralAuth", event, data));
  // Límites por IP independientes: los intentos de login no bloquean la recuperación (ni al revés)
  const limit = (max: number) => rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos. Espera un minuto." } });
  const loginLimiter = limit(10);
  const forgotLimiter = limit(5);
  const onlyCentral: RequestHandler = (req, res, next) => (requestHost(req) === d.host ? next() : next("router"));
  const json = express.json({ limit: "8kb" });

  r.post("/api/central/login", onlyCentral, loginLimiter, json, async (req: Request, res: Response) => {
    try {
      if (!sameOrigin(req, d.host)) return void res.status(403).json({ error: "Origen no permitido." });
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!email || !password || email.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
        return void res.status(400).json({ error: "Correo y contraseña son obligatorios." });
      }
      const key = `central:${email}`;
      const lockMs = loginLockRemaining(key);
      if (lockMs > 0) {
        res.setHeader("Retry-After", String(Math.ceil(lockMs / 1000)));
        return void res.status(429).json({ error: "Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo." });
      }
      const tenants = (await d.listTenants()).filter((t) => accessPolicy(t.status).admin);
      const candidates: { t: (typeof tenants)[number]; u: { id: number; passwordHash: string } }[] = [];
      await eachLimit(tenants, 4, async (t) => {
        const u = await d.findUser(t.id, email).catch(() => null);
        if (u && u.isActive && u.passwordHash) candidates.push({ t, u: { id: u.id, passwordHash: u.passwordHash } });
      });
      const matches: typeof candidates = [];
      if (!candidates.length) await bcrypt.compare(password, DUMMY_HASH);
      for (const c of candidates) if (await bcrypt.compare(password, c.u.passwordHash)) matches.push(c);
      if (!matches.length) {
        recordLoginFailure(key);
        log("login_failed", { tenants: tenants.length });
        return void res.status(401).json({ error: "Correo o contraseña incorrectos." });
      }
      recordLoginSuccess(key);
      const companies = [];
      for (const { t, u } of matches) {
        const host = choosePublicDomain(await d.listDomains(t.id))?.domain;
        if (!host) continue; // sin dominio servible no se puede entrar
        const token = await signHandoff({ tid: t.id, aud: host, sub: String(u.id), pwv: d.passwordFingerprint(u.passwordHash) ?? "" });
        companies.push({ id: t.id, name: t.displayName, host, handoffUrl: `https://${host}/api/auth/handoff`, token });
      }
      companies.sort((a, b) => a.name.localeCompare(b.name, "es"));
      log("login_ok", { companies: companies.length });
      res.setHeader("Cache-Control", "no-store");
      res.json({ companies });
    } catch (e: any) {
      log("login_error", { error: e?.name ?? "error" });
      if (!res.headersSent) res.status(503).json({ error: "Servicio no disponible temporalmente. Inténtalo más tarde." });
    }
  });

  r.post("/api/central/forgot", onlyCentral, forgotLimiter, json, async (req: Request, res: Response) => {
    const ok = () => res.json({ ok: true, message: "Si el correo pertenece a alguna empresa, recibirás un enlace para cada una." });
    try {
      if (!sameOrigin(req, d.host)) return void res.status(403).json({ error: "Origen no permitido." });
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email || email.length > MAX_EMAIL) return void res.status(400).json({ error: "Correo obligatorio." });
      const tenants = (await d.listTenants()).filter((t) => accessPolicy(t.status).admin);
      let sent = 0;
      await eachLimit(tenants, 4, async (t) => {
        const u = await d.findUser(t.id, email).catch(() => null);
        if (!u || !u.isActive) return;
        await d.requestReset(t.id, email).then(() => void sent++, () => undefined);
      });
      log("forgot", { requested: sent });
      ok();
    } catch (e: any) {
      log("forgot_error", { error: e?.name ?? "error" });
      ok();
    }
  });

  return r;
}

// ─── Canje en el host de la empresa ────────────────────────────────────────────

export interface HandoffDeps {
  centralHost: string;
  getUser: (id: number) => Promise<{ id: number; passwordHash: string | null; isActive: boolean; role: string | null } | null>;
  touchUser: (id: number) => Promise<void>;
  passwordFingerprint: (hash: string | null | undefined) => string | undefined;
  issueSession: (req: Request, res: Response, user: { id: number; passwordHash: string | null }) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/** POST /api/auth/handoff (formulario): se monta DESPUÉS de ligar la empresa del host. */
export function createHandoffRouter(d: HandoffDeps): Router {
  const r = express.Router();
  const log = d.log ?? ((event, data) => opsLog("info", "CentralAuth", event, data));
  const limiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
  const fail = (res: Response, reason: string, tid?: string) => {
    log("handoff_rejected", { reason, ...(tid ? { tenantId: tid } : {}) });
    res.redirect(303, "/login?acceso=caducado");
  };
  r.post("/api/auth/handoff", limiter, express.urlencoded({ extended: false, limit: "4kb" }), async (req: Request, res: Response) => {
    const tid = peekTenantContext()?.tenantId;
    try {
      const host = requestHost(req);
      if (!tid || !host) return fail(res, "no_tenant");
      // Solo desde la página central (evita que otro sitio inicie sesión en nombre de alguien: login CSRF)
      if (!sameOrigin(req, d.centralHost)) return fail(res, "origin", tid);
      const claims = await verifyHandoff(String(req.body?.token ?? ""), { tid, aud: host });
      if (!claims) return fail(res, "invalid", tid);
      if (!consumeJti(claims.jti)) return fail(res, "reused", tid);
      const user = await d.getUser(Number(claims.sub));
      if (!user || !user.isActive || !user.passwordHash || d.passwordFingerprint(user.passwordHash) !== claims.pwv) return fail(res, "user", tid);
      await d.touchUser(user.id);
      await d.issueSession(req, res, user);
      log("handoff_ok", { tenantId: tid });
      res.setHeader("Cache-Control", "no-store");
      res.redirect(303, homeForRole(user.role));
    } catch (e: any) {
      log("handoff_error", { tenantId: tid, error: e?.name ?? "error" });
      if (!res.headersSent) res.redirect(303, "/login");
    }
  });
  return r;
}

/** Utilidad para los adaptadores: usuario de una empresa por correo, en la BD de esa empresa. */
export function tenantUserFinder(getTenantDatabase: (id: string) => Promise<any>) {
  return async (tenantId: string, email: string) => {
    const db = await getTenantDatabase(tenantId);
    if (!db) return null;
    const rows = await db
      .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.email, email)))
      .limit(1);
    return rows[0] ?? null;
  };
}

export { runWithTenant };
