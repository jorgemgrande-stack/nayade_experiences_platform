/**
 * Autenticación del plano de control (API para Big Elephant CRM y operadores).
 *
 *  - Tokens de servicio con ámbitos (`scopes`); se guardan solo como hash SHA-256.
 *  - Comparación en tiempo constante; sin token válido no hay información alguna.
 *  - Cada petición queda atribuida a un actor `crm:<id del token>` para la auditoría.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { parse as parseCookie } from "cookie";
import type { Actor } from "../_core/tenantRegistry/service";
import type { OperatorAuthService, ValidSession } from "./operatorAuth";

/** Cookie de sesión de operador (HttpOnly). En la BD solo está su SHA-256. */
export const SESSION_COOKIE = "be_cp_session";

export const SCOPES = [
  "tenants:read",
  "tenants:write",
  "domains:write",
  "entitlements:write",
  "quotas:write",
  "provisioning:write",
  "billing:read",
  "billing:write",
  "usage:read",
  "support:write",
  "crm:read",
  "crm:write",
  "ops:read",
  "ops:write",
  "tickets:read",
  "tickets:write",
  // Gestión de operadores humanos: solo con sesión de operador, nunca con token de servicio
  "operators:read",
  "operators:write",
  // Web comercial: editar borradores y publicar son permisos distintos
  "web:read",
  "web:write",
  "web:publish",
] as const;
export type Scope = (typeof SCOPES)[number];

export interface ServiceToken {
  id: string;
  /** SHA-256 hex del token. */
  sha256: string;
  scopes: Scope[];
  /** `operator` | `crm`: tipo de actor que se registra en la auditoría. */
  actorType?: "operator" | "crm";
}

export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

export function parseTokens(json: string | undefined): ServiceToken[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (t): t is ServiceToken =>
        t &&
        typeof t.id === "string" &&
        /^[a-f0-9]{64}$/.test(t.sha256) &&
        Array.isArray(t.scopes) &&
        t.scopes.every((s: string) => (SCOPES as readonly string[]).includes(s)),
    );
  } catch {
    return [];
  }
}

export interface Authed {
  tokenId: string;
  actor: Actor;
  scopes: ReadonlySet<Scope>;
  /** Solo con sesión de operador humano (cookie); nunca con token de servicio ni SSO. */
  operator?: ValidSession;
}

const authed = new WeakMap<Request, Authed>();
export const getAuth = (req: Request): Authed | undefined => authed.get(req);

function match(tokens: ServiceToken[], presented: string): ServiceToken | null {
  const h = Buffer.from(hashToken(presented), "hex");
  let found: ServiceToken | null = null;
  // Recorre todos para no filtrar por temporización cuál coincidió
  for (const t of tokens) {
    const ok = crypto.timingSafeEqual(h, Buffer.from(t.sha256, "hex"));
    if (ok && !found) found = t;
  }
  return found;
}

/** Verificador de sesiones SSO (JWT propio). */
export type SessionVerifier = (token: string) => Promise<{ email: string; scopes: Scope[] } | null>;

/** Sesiones de operadores humanos (cookie HttpOnly + token CSRF). */
export interface OperatorSessionOptions {
  operators: Pick<OperatorAuthService, "validateSession">;
  /** Orígenes del navegador autorizados: una escritura con otro `Origin` se rechaza. */
  allowedOrigins: ReadonlySet<string>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw || raw.length > 8192) return null;
  return parseCookie(raw)[name] ?? null;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function authenticate(tokens: ServiceToken[], sessions?: SessionVerifier, opSessions?: OperatorSessionOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(\S{16,2048})$/.exec(header);
    // Sin cabecera Authorization: sesión de operador por cookie (las integraciones siguen con Bearer)
    if (!header && opSessions) {
      const cookie = readCookie(req, SESSION_COOKIE);
      if (cookie) {
        let v: ValidSession | null;
        try {
          v = await opSessions.operators.validateSession(cookie);
        } catch {
          res.status(503).json({ error: "auth_unavailable", message: "No se pudo comprobar la sesión" });
          return;
        }
        if (!v) {
          res.status(401).json({ error: "session_expired", message: "La sesión ha caducado o se ha cerrado" });
          return;
        }
        if (!SAFE_METHODS.has(req.method)) {
          const origin = req.headers.origin;
          const csrf = String(req.headers["x-csrf-token"] ?? "");
          if ((typeof origin === "string" && !opSessions.allowedOrigins.has(origin)) || !safeEqual(csrf, v.session.csrfToken)) {
            res.status(403).json({ error: "csrf_failed", message: "Petición rechazada por protección CSRF" });
            return;
          }
        }
        authed.set(req, {
          tokenId: `session:${v.session.id.slice(0, 12)}`,
          actor: { type: "operator", id: v.operator.username },
          scopes: new Set(v.scopes),
          operator: v,
        });
        return next();
      }
    }
    // Sesión SSO (JWT: tres segmentos) o token de servicio (hash)
    if (m && sessions && m[1].split(".").length === 3) {
      const s = await sessions(m[1]);
      if (s) {
        authed.set(req, { tokenId: `sso:${s.email}`, actor: { type: "operator", id: s.email }, scopes: new Set(s.scopes) });
        return next();
      }
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const t = m && m[1].length <= 256 ? match(tokens, m[1]) : null;
    if (!t) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    authed.set(req, {
      tokenId: t.id,
      actor: { type: t.actorType ?? "crm", id: t.id },
      scopes: new Set(t.scopes),
    });
    next();
  };
}

/** Solo personas: la gestión de operadores nunca se hace con un token de servicio. */
export function requireOperatorSession(): RequestHandler {
  return (req, res, next) => {
    if (!getAuth(req)?.operator) {
      res.status(403).json({ error: "operator_session_required", message: "Esta operación requiere iniciar sesión como operador" });
      return;
    }
    next();
  };
}

export function requireScope(scope: Scope): RequestHandler {
  return (req, res, next) => {
    if (!getAuth(req)?.scopes.has(scope)) {
      res.status(403).json({ error: "forbidden", scope });
      return;
    }
    next();
  };
}
