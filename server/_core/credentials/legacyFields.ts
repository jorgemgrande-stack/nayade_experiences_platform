/**
 * Cifrado de campo de las credenciales heredadas almacenadas en `system_settings` /
 * `site_settings` (GHL API key, token y secreto de webhook del inbox).
 *
 *  - Formato versionado: `enc:v1:<keyId>:<base64(iv | tag | ciphertext)>`; AES-256-GCM.
 *  - AAD = `legacy|<tabla>|<clave>`: un valor cifrado no se puede copiar a otra clave.
 *  - Compatibilidad: un valor sin prefijo `enc:` es un heredado en claro y se lee tal cual.
 *  - Nunca se incluyen valores (ni fragmentos) en errores, informes o registros.
 *  - Las claves son las de la bóveda de integraciones (`INTEGRATION_KEYS`); sin ellas no se
 *    cifra y los valores cifrados no se pueden leer (falla cerrado → cadena vacía).
 */
import crypto from "node:crypto";
import { keyringFromEnv, type Keyring } from "./vault";

export type LegacyTable = "system_settings" | "site_settings";

/** Únicas claves migrables: todas tienen sus lectores adaptados a `revealLegacySecret`. */
export const LEGACY_SECRET_FIELDS: ReadonlyArray<{ table: LegacyTable; key: string }> = [
  { table: "system_settings", key: "site_ghl_api_key" },
  { table: "site_settings", key: "ghlApiKey" },
  { table: "site_settings", key: "ghlInboxToken" },
  { table: "site_settings", key: "ghlInboxWebhookSecret" },
];

const PREFIX = "enc:v1:";

export class LegacyCryptoError extends Error {
  constructor(public readonly code: "no_key" | "corrupt" | "unknown_key") {
    super(
      code === "no_key"
        ? "Sin claves de cifrado configuradas"
        : code === "unknown_key"
          ? "Clave de cifrado desconocida"
          : "Valor cifrado ilegible o alterado",
    );
    this.name = "LegacyCryptoError";
  }
}

export const isLegacyEncrypted = (v: string | null | undefined): boolean => typeof v === "string" && v.startsWith(PREFIX);

const aad = (table: LegacyTable, key: string) => Buffer.from(`legacy|${table}|${key}`);

export function encryptLegacy(plain: string, table: LegacyTable, key: string, ring: Keyring): string {
  const k = ring.keys.get(ring.activeId);
  if (!k) throw new LegacyCryptoError("no_key");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(aad(table, key));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${ring.activeId}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}

/** Descifra un valor cifrado; devuelve los valores heredados en claro sin tocarlos. */
export function decryptLegacy(stored: string, table: LegacyTable, key: string, ring: Keyring | null): string {
  if (!isLegacyEncrypted(stored)) return stored;
  if (!ring) throw new LegacyCryptoError("no_key");
  const rest = stored.slice(PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 1) throw new LegacyCryptoError("corrupt");
  const k = ring.keys.get(rest.slice(0, i));
  if (!k) throw new LegacyCryptoError("unknown_key");
  const raw = Buffer.from(rest.slice(i + 1), "base64");
  if (raw.length < 29) throw new LegacyCryptoError("corrupt");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAAD(aad(table, key));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new LegacyCryptoError("corrupt");
  }
}

// ── Uso en tiempo de ejecución (lectores y escritores) ────────────────────────

let cachedRing: { raw: string; ring: Keyring | null } | null = null;
function runtimeRing(env: NodeJS.ProcessEnv = process.env): Keyring | null {
  const raw = `${env.INTEGRATION_KEYS ?? ""}|${env.INTEGRATION_ACTIVE_KEY_ID ?? ""}`;
  if (!cachedRing || cachedRing.raw !== raw) cachedRing = { raw, ring: keyringFromEnv(env) };
  return cachedRing.ring;
}

/**
 * Valor utilizable de un secreto heredado. En claro → tal cual (compatibilidad). Cifrado e
 * ilegible → cadena vacía (nunca se propaga el ciphertext como si fuese la credencial).
 */
export function revealLegacySecret(table: LegacyTable, key: string, stored: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!stored) return "";
  if (!isLegacyEncrypted(stored)) return stored;
  try {
    return decryptLegacy(stored, table, key, runtimeRing(env));
  } catch (e) {
    console.error(`[LegacyCredentials] no se pudo leer ${table}.${key}: ${e instanceof LegacyCryptoError ? e.code : "error"}`);
    return "";
  }
}

/**
 * Valor a persistir. Solo cifra si `LEGACY_CREDENTIALS_ENCRYPT=on` y hay claves; en otro caso
 * conserva el comportamiento actual (texto plano) para no alterar producción.
 */
export function protectLegacySecret(table: LegacyTable, key: string, plain: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!plain || isLegacyEncrypted(plain)) return plain;
  if (env.LEGACY_CREDENTIALS_ENCRYPT !== "on") return plain;
  const ring = runtimeRing(env);
  if (!ring) return plain;
  return encryptLegacy(plain, table, key, ring);
}
