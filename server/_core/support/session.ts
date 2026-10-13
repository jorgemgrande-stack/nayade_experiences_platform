/**
 * Sesión de soporte en el Core.
 *
 *  - `/_support/enter?t=<token>` canjea el token (de un solo uso práctico: TTL corto) por una
 *    cookie HttpOnly/SameSite=Strict ligada al tenant del host.
 *  - Cada petición con la cookie revalida: firma, caducidad, tenant resuelto == `tid`,
 *    concesión vigente y no revocada (lectura del registro).
 *  - Solo lectura por defecto: métodos que modifican se rechazan en el borde.
 *  - Los tokens jamás se registran; se registran concesión, operador, ruta y método.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { SignJWT, jwtVerify } from "jose";
import { peekTenantContext } from "../tenant";
import { MAX_SUPPORT_MINUTES, grantActive, type SupportGrant, type SupportGrantReader } from "./grants";

export const SUPPORT_COOKIE = "es_support";

let reader: SupportGrantReader | null = null;
let secretRaw: string | undefined;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function configureSupport(r: SupportGrantReader | null, secret: string | undefined = process.env.SUPPORT_JWT_SECRET): void {
  reader = r;
  secretRaw = secret && secret.length >= 32 ? secret : undefined;
}

const key = () => new TextEncoder().encode(secretRaw ?? "");
export const supportEnabled = () => !!reader && !!secretRaw;

export async function signSupportToken(g: SupportGrant, secret: string, ttlSeconds?: number): Promise<string> {
  const ttl = Math.min(ttlSeconds ?? Math.floor((g.expiresAt - Date.now()) / 1000), MAX_SUPPORT_MINUTES * 60);
  return new SignJWT({ gid: g.id, tid: g.tenantId, op: g.operator, ro: g.readOnly })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${Math.max(1, ttl)}s`)
    .sign(new TextEncoder().encode(secret));
}

async function verify(token: string): Promise<{ gid: string; tid: string; op: string; ro: boolean } | null> {
  if (!secretRaw) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.gid !== "string" || typeof payload.tid !== "string") return null;
    return { gid: payload.gid, tid: payload.tid, op: String(payload.op ?? ""), ro: payload.ro !== false };
  } catch {
    return null;
  }
}

function cookieOf(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface SupportIdentity {
  grant: SupportGrant;
  readOnly: boolean;
}

/** Valida la sesión de soporte de la petición contra el tenant resuelto. */
export async function getSupportIdentity(req: Request): Promise<SupportIdentity | null> {
  if (!supportEnabled()) return null;
  const token = cookieOf(req, SUPPORT_COOKIE);
  if (!token) return null;
  const claims = await verify(token);
  if (!claims) return null;
  const tenant = peekTenantContext()?.tenantId;
  if (!tenant || claims.tid !== tenant) return null; // nunca fuera del tenant concedido
  const grant = await reader!.getGrant(claims.gid);
  if (!grant || grant.tenantId !== tenant || !grantActive(grant)) return null;
  return { grant, readOnly: grant.readOnly };
}

/** Usuario sintético para el contexto tRPC/autorización (rol admin; lectura impuesta en el borde). */
export async function getSupportUser(req: Request) {
  const id = await getSupportIdentity(req);
  if (!id) return null;
  const now = new Date();
  return {
    id: -1,
    openId: `support:${id.grant.id}`,
    name: `Soporte Big Elephant (${id.grant.operator})`,
    email: null,
    loginMethod: "support",
    role: "admin" as const,
    partnerId: null,
    supplierId: null,
    phone: null,
    avatarUrl: null,
    isActive: true,
    passwordHash: null,
    inviteToken: null,
    inviteTokenExpiry: null,
    inviteAccepted: true,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    supportGrantId: id.grant.id,
  };
}

/** Rechaza escrituras de una sesión de soporte de solo lectura y deja traza de cada intento. */
export function supportReadOnlyGuard(log: (l: string) => void = (l) => console.warn(l)): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!supportEnabled() || !cookieOf(req, SUPPORT_COOKIE)) return next();
    const id = await getSupportIdentity(req);
    if (!id) return next(); // cookie no válida: la sesión de soporte simplemente no existe
    if (id.readOnly && !SAFE.has(req.method) && !req.path.startsWith("/_support/")) {
      log(JSON.stringify({ ctx: "Support", event: "write_blocked", grant: id.grant.id, op: id.grant.operator, method: req.method, path: req.path.slice(0, 120) }));
      res.status(403).json({ error: "support_read_only" });
      return;
    }
    next();
  };
}

export function createSupportRouter(): Router {
  const r = express.Router();

  r.get("/_support/enter", async (req, res) => {
    if (!supportEnabled()) return void res.status(404).end();
    const token = String(req.query.t ?? "");
    const claims = await verify(token);
    const tenant = peekTenantContext()?.tenantId;
    const grant = claims && claims.tid === tenant ? await reader!.getGrant(claims.gid) : null;
    if (!claims || !grant || grant.tenantId !== tenant || !grantActive(grant)) {
      return void res.status(403).type("text/plain").send("Acceso no válido o caducado");
    }
    console.warn(JSON.stringify({ ctx: "Support", event: "enter", grant: grant.id, op: grant.operator, tenant }));
    res.cookie(SUPPORT_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: Math.max(1000, grant.expiresAt - Date.now()),
    });
    res.redirect(302, "/admin");
  });

  r.post("/_support/exit", (req, res) => {
    res.clearCookie(SUPPORT_COOKIE, { path: "/" });
    res.status(204).end();
  });

  return r;
}

/** Utilidad para pruebas: token aleatorio no válido. */
export const _randomToken = () => crypto.randomBytes(24).toString("hex");
