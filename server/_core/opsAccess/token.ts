/**
 * Canal interno plano de control → Core para gestionar los ACCESOS de una empresa (lista de usuarios, enlace de
 * restablecimiento, invitación, desbloqueo, activación). Sin red pública: el plano de control llama al Core por la
 * red privada (`/_ops/access`) con un token firmado de vida muy corta y un solo uso.
 *
 *  - Clave DERIVADA de SUPPORT_JWT_SECRET (HMAC con una etiqueta propia): un token de soporte no sirve aquí ni al revés.
 *  - Audiencia propia, caducidad ≤ 2 min y `jti` único (el Core rechaza su reutilización).
 *  - Empresa, acción, usuario y operador van FIRMADOS: el Core no acepta parámetros sin firmar.
 */
import { createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const OPS_ACCESS_AUDIENCE = "elephant-source:ops-access";
export const OPS_ACCESS_PATH = "/_ops/access";
export const OPS_ACCESS_ACTIONS = ["list", "reset", "invite", "unlock", "activate", "deactivate", "revoke", "integrations", "integration_check"] as const;
/** Acciones sin usuario de la empresa (todas las demás exigen `uid`). */
const NO_USER_ACTIONS: readonly string[] = ["list", "integrations", "integration_check"];
const PROVIDER_RE = /^[a-z][a-z_]{1,31}$/;
export type OpsAccessAction = (typeof OPS_ACCESS_ACTIONS)[number];
const MAX_TTL_SECONDS = 120;

export interface OpsAccessClaims {
  /** Empresa (tenant) en cuyo contexto se ejecuta la acción. */
  tid: string;
  act: OpsAccessAction;
  /** Usuario de la empresa al que se aplica (todas salvo `list`). */
  uid?: number;
  /** Correo que el operador ha tecleado para confirmar un envío (`reset`, `invite`): debe coincidir. */
  confirm?: string;
  /** Operador autenticado en el plano de control (para la auditoría del Core). */
  op: string;
  /** Proveedor de la integración que se comprueba (solo `integration_check`). */
  prv?: string;
}

const TENANT_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function opsAccessKey(secret: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update("elephant-source/ops-access/v1").digest());
}

export async function signOpsAccessToken(c: OpsAccessClaims, secret: string, ttlSeconds = 60): Promise<string> {
  if (!secret || secret.length < 32) throw new Error("secreto del canal interno no configurado");
  return new SignJWT({ tid: c.tid, act: c.act, ...(c.uid !== undefined ? { uid: c.uid } : {}), ...(c.confirm ? { confirm: c.confirm } : {}), ...(c.prv ? { prv: c.prv } : {}), op: c.op })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(OPS_ACCESS_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${Math.min(Math.max(1, ttlSeconds), MAX_TTL_SECONDS)}s`)
    .sign(opsAccessKey(secret));
}

export async function verifyOpsAccessToken(token: string, secret: string | undefined): Promise<(OpsAccessClaims & { jti: string; exp: number }) | null> {
  if (!secret || secret.length < 32 || !token) return null;
  try {
    const { payload: p } = await jwtVerify(token, opsAccessKey(secret), { algorithms: ["HS256"], audience: OPS_ACCESS_AUDIENCE, maxTokenAge: `${MAX_TTL_SECONDS}s` });
    if (typeof p.tid !== "string" || !TENANT_RE.test(p.tid)) return null;
    if (typeof p.act !== "string" || !(OPS_ACCESS_ACTIONS as readonly string[]).includes(p.act)) return null;
    if (typeof p.jti !== "string" || typeof p.exp !== "number" || typeof p.op !== "string") return null;
    const uid = p.uid === undefined ? undefined : Number(p.uid);
    if (!NO_USER_ACTIONS.includes(p.act) && !(Number.isInteger(uid) && uid! > 0)) return null;
    const prv = typeof p.prv === "string" ? p.prv : undefined;
    if (p.act === "integration_check" ? !(prv && PROVIDER_RE.test(prv)) : prv !== undefined) return null;
    return { tid: p.tid, act: p.act as OpsAccessAction, uid, confirm: typeof p.confirm === "string" ? p.confirm : undefined, ...(prv ? { prv } : {}), op: p.op.slice(0, 100), jti: p.jti, exp: p.exp };
  } catch {
    return null;
  }
}
