/**
 * Auditoría de las sesiones de soporte delegado.
 *
 * El Core lee el registro con un usuario de SOLO LECTURA, así que no puede escribir `tenant_events`. Cada evento de una
 * sesión de soporte (entrada, salida, modificaciones, intentos bloqueados, exportaciones) lo firma el Core con el mismo
 * secreto que ya comparten ambos lados para los tokens de soporte (`SUPPORT_JWT_SECRET`) y lo entrega al plano de
 * control, que lo valida contra la concesión y lo guarda en `tenant_events` (lo muestra el historial de la empresa en
 * el CRM). Nunca viajan contraseñas, tokens, cuerpos de petición ni valores: solo método, recurso y resultado.
 */
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const SUPPORT_AUDIT_PATH = "/cp/v1/internal/support-audit";
/** Plano de control por la red privada (mismo patrón que `DEFAULT_CORE_INTERNAL_URL`); `SUPPORT_AUDIT_URL` lo cambia. */
export const DEFAULT_SUPPORT_AUDIT_URL = `http://controlplane.railway.internal:4100${SUPPORT_AUDIT_PATH}`;
const TYP = "es_support_audit";

export const SUPPORT_AUDIT_EVENTS = ["entered", "exited", "write", "write_result", "write_blocked", "blocked", "export"] as const;
export type SupportAuditEvent = (typeof SUPPORT_AUDIT_EVENTS)[number];

export interface SupportAuditDetails {
  method?: string;
  /** Recurso sin consulta ni valores: ruta o procedimientos tRPC (`users.create`). */
  resource?: string;
  status?: number;
  reason?: string;
}

export interface SupportAuditClaims {
  gid: string;
  tid: string;
  ev: SupportAuditEvent;
  d: SupportAuditDetails;
  jti: string;
  exp: number;
}

/** Detalle acotado y sin datos: nunca cuerpo, consulta ni cabeceras. */
export function cleanAuditDetails(d: SupportAuditDetails): SupportAuditDetails {
  const out: SupportAuditDetails = {};
  if (d.method) out.method = String(d.method).toUpperCase().slice(0, 10);
  if (d.resource) out.resource = String(d.resource).split("?")[0].slice(0, 200);
  if (typeof d.status === "number" && Number.isInteger(d.status)) out.status = d.status;
  if (d.reason) out.reason = String(d.reason).slice(0, 60);
  return out;
}

export async function signSupportAudit(secret: string, c: { gid: string; tid: string; ev: SupportAuditEvent; d: SupportAuditDetails }): Promise<string> {
  return new SignJWT({ typ: TYP, gid: c.gid, tid: c.tid, ev: c.ev, d: cleanAuditDetails(c.d) })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomBytes(12).toString("hex"))
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(new TextEncoder().encode(secret));
}

export async function verifySupportAudit(token: string, secret: string): Promise<SupportAuditClaims | null> {
  if (!secret || secret.length < 32 || !token || token.length > 4096) return null;
  try {
    const { payload: p } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    // Un token de soporte (entrada al panel) o de accesos NO vale como evento: tipo propio obligatorio
    if (p.typ !== TYP || typeof p.gid !== "string" || !/^[a-f0-9]{32}$/.test(p.gid) || typeof p.tid !== "string" || typeof p.jti !== "string" || typeof p.exp !== "number") return null;
    if (!(SUPPORT_AUDIT_EVENTS as readonly string[]).includes(String(p.ev))) return null;
    return { gid: p.gid, tid: p.tid, ev: p.ev as SupportAuditEvent, d: cleanAuditDetails((p.d ?? {}) as SupportAuditDetails), jti: p.jti, exp: p.exp };
  } catch {
    return null;
  }
}

export type SupportAuditSender = (c: { gid: string; tid: string; ev: SupportAuditEvent; d: SupportAuditDetails }) => Promise<boolean>;

/** Cliente del Core: entrega el evento firmado (3 s). `false` si no consta registrado. */
export function supportAuditSender(o: { secret: string; url?: string; fetchImpl?: typeof fetch }): SupportAuditSender {
  const url = o.url || DEFAULT_SUPPORT_AUDIT_URL;
  const f = o.fetchImpl ?? fetch;
  return async (c) => {
    try {
      const token = await signSupportAudit(o.secret, c);
      const r = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(3_000) });
      return r.status === 201;
    } catch {
      return false;
    }
  };
}
