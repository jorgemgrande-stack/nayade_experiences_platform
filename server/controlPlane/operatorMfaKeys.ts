/**
 * Llavero y secretos TOTP de los operadores (migración 0012). El secreto va cifrado con AES-256-GCM y la clave
 * activa de REGISTRY_KEYS (AAD `operator-mfa:<id>`), igual que las DSN de las empresas. Al rotar el llavero hay
 * que re-cifrarlo también: si se retira una clave con la que aún hay secretos, esos operadores no pueden
 * completar el segundo paso.
 *
 * Procedimiento seguro de rotación:
 *   1. Añadir la clave nueva a REGISTRY_KEYS y hacerla activa (REGISTRY_ACTIVE_KEY_ID), CONSERVANDO la antigua.
 *   2. `scripts/tenants/cli.ts rotate-keys` (simulación) y después con `--apply`: DSN y secretos TOTP.
 *   3. Comprobar que la simulación ya no encuentra nada pendiente; solo entonces retirar la clave antigua.
 */
import type mysql from "mysql2/promise";
import { reencryptDsn, decryptDsn, type Keyring } from "../_core/tenantRegistry/crypto";

export const mfaAad = (operatorId: number) => `operator-mfa:${operatorId}`;

export interface MfaKeyRotationResult {
  /** `false` si el registro no tiene la migración 0012 (no hay secretos que rotar). */
  supported: boolean;
  /** Secretos con una clave distinta de la activa. */
  pending: number;
  /** Re-cifrados (solo con `apply`). */
  rotated: number;
  /** Operadores cuyo secreto no se puede descifrar con el llavero actual (clave ausente o dato dañado). */
  failed: { operatorId: number; username: string; keyId: string | null; reason: "key_missing" | "decrypt_failed" }[];
}

const missingColumns = (e: any) => e?.code === "ER_BAD_FIELD_ERROR" || e?.code === "ER_NO_SUCH_TABLE";

/**
 * Re-cifra con la clave activa los secretos TOTP que usan otra clave. Sin `apply` solo comprueba (descifra
 * en memoria, no escribe). Con `apply`, en una transacción con las filas bloqueadas: un alta o baja de MFA
 * simultánea no se pisa. Cada rotación queda auditada (`mfa_key_rotated`). Nunca devuelve ni registra secretos.
 */
export async function rotateOperatorMfaKeys(
  pool: mysql.Pool,
  ring: Keyring,
  opts: { apply: boolean; actor: string; now?: () => number },
): Promise<MfaKeyRotationResult> {
  const now = opts.now ?? Date.now;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let rows: any[];
    try {
      [rows] = await conn.query<any[]>(
        `SELECT id, username, mfa_secret_cipher, mfa_key_id FROM cp_operators
          WHERE mfa_secret_cipher IS NOT NULL AND (mfa_key_id IS NULL OR mfa_key_id <> ?)
          ORDER BY id ${opts.apply ? "FOR UPDATE" : ""}`,
        [ring.activeKeyId],
      );
    } catch (e) {
      await conn.rollback();
      if (missingColumns(e)) return { supported: false, pending: 0, rotated: 0, failed: [] };
      throw e;
    }
    const result: MfaKeyRotationResult = { supported: true, pending: rows.length, rotated: 0, failed: [] };
    for (const r of rows) {
      const keyId: string | null = r.mfa_key_id ?? null;
      if (!keyId || !ring.keys.has(keyId)) {
        result.failed.push({ operatorId: r.id, username: r.username, keyId, reason: "key_missing" });
        continue;
      }
      let re: { cipher: string; keyId: string } | null;
      try {
        re = opts.apply ? reencryptDsn(r.mfa_secret_cipher, keyId, mfaAad(r.id), ring) : (decryptDsn(r.mfa_secret_cipher, keyId, mfaAad(r.id), ring), null);
      } catch {
        result.failed.push({ operatorId: r.id, username: r.username, keyId, reason: "decrypt_failed" });
        continue;
      }
      if (!opts.apply || !re) continue;
      await conn.query("UPDATE cp_operators SET mfa_secret_cipher = ?, mfa_key_id = ?, updated_at = ? WHERE id = ?", [re.cipher, re.keyId, now(), r.id]);
      await conn.query(
        "INSERT INTO cp_operator_events (at, operator_id, username, actor, kind, ip, user_agent, details) VALUES (?,?,?,?,?,?,?,?)",
        [now(), r.id, r.username, opts.actor, "mfa_key_rotated", null, null, JSON.stringify({ from: keyId, to: re.keyId })],
      );
      result.rotated++;
    }
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Claves del llavero que faltan para descifrar algún secreto TOTP (comprobación de arranque). Vacío si todo
 * está bien o si el registro no tiene la 0012.
 */
export async function missingMfaKeys(pool: mysql.Pool, ring: Keyring): Promise<string[]> {
  try {
    const [rows] = await pool.query<any[]>("SELECT DISTINCT mfa_key_id AS k FROM cp_operators WHERE mfa_secret_cipher IS NOT NULL");
    return rows.map((r) => r.k ?? "(sin clave)").filter((k: string) => !ring.keys.has(k));
  } catch (e) {
    if (missingColumns(e)) return [];
    throw e;
  }
}
