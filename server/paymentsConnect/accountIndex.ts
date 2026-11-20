/**
 * Índice global de cuentas de cobro (registro 0018, `tenant_payment_accounts`): qué empresa es dueña de cada `acct_…`.
 *
 * La vinculación de cada empresa vive en SU base de datos, así que ninguna restricción local impide que dos empresas
 * guarden la misma cuenta. El índice lo impone de forma global (clave primaria = cuenta):
 *  - ESCRIBE solo el plano de control. El Core lee el registro con un usuario de solo lectura, así que pide la reserva
 *    con una petición firmada (mismo secreto compartido y patrón que la auditoría de soporte, tipo de token propio).
 *  - LEE el Core, para resolver de forma inequívoca a qué empresa pertenece un evento del webhook de cuentas conectadas
 *    (por `event.account`, sin fiarse de ningún metadato).
 *
 * Dos altas simultáneas de la misma cuenta: gana la primera inserción; la otra recibe «taken» y no guarda nada.
 */
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Pool } from "mysql2/promise";
import type { PaymentMode } from "../../shared/paymentAccounts";

export const PAYMENT_CLAIM_PATH = "/cp/v1/internal/payment-accounts/claim";
export const DEFAULT_PAYMENT_CLAIM_URL = `http://controlplane.railway.internal:4100${PAYMENT_CLAIM_PATH}`;
const TYP = "es_payment_account_claim";
const ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,60}$/;
const TENANT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export type ClaimResult = { ok: true; alreadyOwned: boolean } | { ok: false; reason: "taken" | "tenant_has_other" };

export interface AccountIndexWriter {
  /** Reserva la cuenta para la empresa. Idempotente para la misma empresa; rechaza otra dueña o otra cuenta del mismo modo. */
  claim(tenantId: string, mode: PaymentMode, accountId: string): Promise<ClaimResult>;
}
export interface AccountIndexReader {
  /** Empresa dueña de la cuenta, o null si no consta. */
  tenantOf(accountId: string): Promise<string | null>;
}

const dup = (e: unknown) => (e as { code?: string; errno?: number })?.code === "ER_DUP_ENTRY" || (e as { errno?: number })?.errno === 1062;

export class MysqlAccountIndex implements AccountIndexWriter, AccountIndexReader {
  constructor(private readonly pool: Pick<Pool, "query">, private readonly now: () => number = Date.now) {}

  async claim(tenantId: string, mode: PaymentMode, accountId: string): Promise<ClaimResult> {
    if (!TENANT_RE.test(tenantId) || !ACCOUNT_RE.test(accountId) || (mode !== "test" && mode !== "live")) throw new Error("claim inválida");
    try {
      await this.pool.query("INSERT INTO tenant_payment_accounts (account_id, tenant_id, provider, mode, claimed_at) VALUES (?, ?, 'stripe', ?, ?)", [accountId, tenantId, mode, this.now()]);
      return { ok: true, alreadyOwned: false };
    } catch (e) {
      if (!dup(e)) throw e;
    }
    // Choque de clave: ¿la cuenta es ya de esta empresa (reintento) o de otra? ¿o esta empresa tiene otra cuenta en ese modo?
    const [rows] = await this.pool.query("SELECT account_id, tenant_id, mode FROM tenant_payment_accounts WHERE account_id = ? OR (tenant_id = ? AND provider = 'stripe' AND mode = ?)", [accountId, tenantId, mode]);
    const list = rows as Array<{ account_id: string; tenant_id: string; mode: string }>;
    const byAccount = list.find((r) => r.account_id === accountId);
    if (byAccount) return byAccount.tenant_id === tenantId && byAccount.mode === mode ? { ok: true, alreadyOwned: true } : { ok: false, reason: "taken" };
    return { ok: false, reason: "tenant_has_other" };
  }

  async tenantOf(accountId: string): Promise<string | null> {
    if (!ACCOUNT_RE.test(accountId)) return null;
    const [rows] = await this.pool.query("SELECT tenant_id FROM tenant_payment_accounts WHERE account_id = ? LIMIT 1", [accountId]);
    const r = (rows as Array<{ tenant_id: string }>)[0];
    return r ? r.tenant_id : null;
  }
}

// ─── Canal firmado Core → plano de control ────────────────────────────────────

export async function signPaymentClaim(secret: string, c: { tid: string; mode: PaymentMode; acct: string }): Promise<string> {
  return new SignJWT({ typ: TYP, tid: c.tid, mode: c.mode, acct: c.acct })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomBytes(12).toString("hex"))
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(new TextEncoder().encode(secret));
}

export interface PaymentClaimClaims {
  tid: string;
  mode: PaymentMode;
  acct: string;
  jti: string;
  exp: number;
}

export async function verifyPaymentClaim(token: string, secret: string): Promise<PaymentClaimClaims | null> {
  if (!secret || secret.length < 32 || !token || token.length > 2048) return null;
  try {
    const { payload: p } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    // Un token de soporte, de auditoría o de accesos NO vale como reserva: tipo propio obligatorio
    if (p.typ !== TYP || typeof p.jti !== "string" || typeof p.exp !== "number") return null;
    if (typeof p.tid !== "string" || !TENANT_RE.test(p.tid) || typeof p.acct !== "string" || !ACCOUNT_RE.test(p.acct) || (p.mode !== "test" && p.mode !== "live")) return null;
    return { tid: p.tid, mode: p.mode, acct: p.acct, jti: p.jti, exp: p.exp };
  } catch {
    return null;
  }
}

export class AccountIndexUnavailable extends Error {
  constructor(message = "No se ha podido registrar la cuenta en este momento") {
    super(message);
    this.name = "AccountIndexUnavailable";
  }
}

/** Cliente del Core: pide la reserva al plano de control. Falla cerrado (error) si no puede confirmarla. */
export function httpAccountIndexClient(o: { url?: string; secret?: string; fetchImpl?: typeof fetch }): AccountIndexWriter {
  return {
    async claim(tenantId, mode, accountId) {
      const secret = o.secret ?? "";
      if (secret.length < 32) throw new AccountIndexUnavailable();
      const token = await signPaymentClaim(secret, { tid: tenantId, mode, acct: accountId });
      let res: Response;
      try {
        res = await (o.fetchImpl ?? fetch)(o.url ?? DEFAULT_PAYMENT_CLAIM_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new AccountIndexUnavailable();
      }
      if (res.status === 201 || res.status === 200) return { ok: true, alreadyOwned: res.status === 200 };
      if (res.status === 409) {
        const b = (await res.json().catch(() => ({}))) as { reason?: string };
        return { ok: false, reason: b.reason === "tenant_has_other" ? "tenant_has_other" : "taken" };
      }
      throw new AccountIndexUnavailable();
    },
  };
}
