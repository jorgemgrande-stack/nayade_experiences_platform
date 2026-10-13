/**
 * Autenticación del plano de control (API para Big Elephant CRM y operadores).
 *
 *  - Tokens de servicio con ámbitos (`scopes`); se guardan solo como hash SHA-256.
 *  - Comparación en tiempo constante; sin token válido no hay información alguna.
 *  - Cada petición queda atribuida a un actor `crm:<id del token>` para la auditoría.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Actor } from "../_core/tenantRegistry/service";

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

export function authenticate(tokens: ServiceToken[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(\S{16,256})$/.exec(header);
    const t = m ? match(tokens, m[1]) : null;
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

export function requireScope(scope: Scope): RequestHandler {
  return (req, res, next) => {
    if (!getAuth(req)?.scopes.has(scope)) {
      res.status(403).json({ error: "forbidden", scope });
      return;
    }
    next();
  };
}
