/**
 * SSO del plano de control (OIDC → sesión corta).
 *
 *  1. El operador se autentica en el proveedor de identidad corporativo (Google Workspace,
 *     Entra ID…) y presenta su `id_token`.
 *  2. Se verifica: firma (JWKS del emisor), `iss`, `aud`, caducidad, `email_verified`, y que
 *     el correo esté en la lista explícita de operadores autorizados (sin comodines).
 *  3. Se emite una sesión propia de corta duración (JWT HS256) con los ámbitos de ese
 *     operador. El actor queda registrado como `operator:<correo>` en la auditoría.
 *
 * Los tokens de servicio siguen existiendo para automatizaciones; el SSO es para personas.
 */
import { SignJWT, jwtVerify, type JWTVerifyGetKey } from "jose";
import { SCOPES, type Scope } from "./auth";

export interface SsoUser {
  email: string;
  scopes: Scope[];
}

export interface SsoConfig {
  issuer: string;
  clientId: string;
  /** Clave de firma de sesiones (≥ 32 caracteres). */
  sessionSecret: string;
  users: SsoUser[];
  /** Duración de la sesión en segundos (por defecto 8 h, máximo 12 h). */
  sessionTtlSeconds?: number;
  /** Fuente de claves públicas del emisor (inyectable para pruebas). */
  getKey: JWTVerifyGetKey;
}

export function parseSsoUsers(json: string | undefined): SsoUser[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (u): u is SsoUser =>
          u &&
          typeof u.email === "string" &&
          /^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(u.email) &&
          Array.isArray(u.scopes) &&
          u.scopes.every((s: string) => (SCOPES as readonly string[]).includes(s)),
      )
      .map((u) => ({ email: u.email.toLowerCase(), scopes: u.scopes }));
  } catch {
    return [];
  }
}

export class SsoError extends Error {
  constructor(public readonly code: "invalid_token" | "not_authorized") {
    super(code);
  }
}

export class SsoService {
  private readonly ttl: number;
  constructor(private cfg: SsoConfig) {
    if (cfg.sessionSecret.length < 32) throw new Error("La clave de sesión del SSO debe tener al menos 32 caracteres");
    this.ttl = Math.min(cfg.sessionTtlSeconds ?? 8 * 3600, 12 * 3600);
  }

  /** Canjea un id_token del emisor por una sesión del plano de control. */
  async exchange(idToken: string): Promise<{ token: string; expiresIn: number; email: string; scopes: Scope[] }> {
    let email = "";
    try {
      const { payload } = await jwtVerify(idToken, this.cfg.getKey, {
        issuer: this.cfg.issuer,
        audience: this.cfg.clientId,
        algorithms: ["RS256", "ES256"],
      });
      if (payload.email_verified !== true) throw new Error("email no verificado");
      email = String(payload.email ?? "").toLowerCase();
      if (!email) throw new Error("sin email");
    } catch {
      throw new SsoError("invalid_token");
    }
    const user = this.cfg.users.find((u) => u.email === email);
    if (!user) throw new SsoError("not_authorized");

    const token = await new SignJWT({ scopes: user.scopes, kind: "cp-session" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(email)
      .setIssuedAt()
      .setExpirationTime(`${this.ttl}s`)
      .sign(new TextEncoder().encode(this.cfg.sessionSecret));
    return { token, expiresIn: this.ttl, email, scopes: user.scopes };
  }

  /** Verifica una sesión emitida por este servicio. `null` si no es válida. */
  async verifySession(token: string): Promise<{ email: string; scopes: Scope[] } | null> {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.cfg.sessionSecret), { algorithms: ["HS256"] });
      if (payload.kind !== "cp-session" || typeof payload.sub !== "string") return null;
      // La lista de operadores se revalida: quitar a alguien surte efecto de inmediato
      const user = this.cfg.users.find((u) => u.email === payload.sub);
      if (!user) return null;
      const scopes = (payload.scopes as Scope[]).filter((s) => user.scopes.includes(s));
      return { email: payload.sub, scopes };
    } catch {
      return null;
    }
  }
}
