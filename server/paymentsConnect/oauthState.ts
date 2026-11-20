/**
 * Parámetro `state` del vínculo OAuth de Stripe (modo Real): firmado con HMAC, ligado a la empresa y al administrador que
 * inició el vínculo, y con caducidad corta. Evita que un enlace de autorización de otra persona o de otra empresa vincule
 * una cuenta aquí (CSRF). El código de autorización de Stripe es de un solo uso, así que no hace falta guardar nada.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_TTL_MS = 15 * 60_000;

export interface OAuthStatePayload {
  tenantId: string;
  userId: string;
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", `connect-oauth-state:${secret}`).update(body).digest();

export function signOAuthState(p: { tenantId: string; userId: string }, secret: string, now: number = Date.now()): string {
  if (!secret) throw new Error("Falta el secreto para firmar el estado del vínculo");
  const body = b64(JSON.stringify({ tenantId: p.tenantId, userId: p.userId, exp: now + OAUTH_STATE_TTL_MS } satisfies OAuthStatePayload));
  return `${body}.${b64(mac(secret, body))}`;
}

export function verifyOAuthState(state: string, secret: string, expect: { tenantId: string; userId: string }, now: number = Date.now()): boolean {
  if (!secret || typeof state !== "string" || state.length > 1024) return false;
  const [body, sig, extra] = state.split(".");
  if (!body || !sig || extra !== undefined) return false;
  const good = mac(secret, body);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return false;
  }
  if (given.length !== good.length || !timingSafeEqual(given, good)) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
    return p.tenantId === expect.tenantId && p.userId === expect.userId && typeof p.exp === "number" && p.exp >= now;
  } catch {
    return false;
  }
}

/** Dirección de Stripe donde la empresa elige y autoriza su cuenta existente. */
export function oauthAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ response_type: "code", client_id: p.clientId, scope: "read_write", redirect_uri: p.redirectUri, state: p.state });
  return `https://connect.stripe.com/oauth/authorize?${q.toString()}`;
}
