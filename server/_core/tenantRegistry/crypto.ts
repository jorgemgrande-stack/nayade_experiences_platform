/**
 * Cifrado de las credenciales de conexión (DSN) de cada tenant.
 *
 * AES-256-GCM con identificador de clave (`keyId`) para poder rotar o migrar a un KMS sin
 * tocar el formato. El identificador del tenant va como datos autenticados adicionales
 * (AAD): un DSN cifrado para el tenant A NO descifra como del tenant B aunque alguien
 * copie el valor entre filas. La clave nunca vive en el registro.
 *
 * Formato (base64): [versión:1][iv:12][tag:16][texto cifrado]
 */
import crypto from "node:crypto";
import { RegistryError } from "./contract";

const FORMAT_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_ID_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export type Keyring = {
  /** Clave activa para cifrar. */
  activeKeyId: string;
  /** Todas las claves conocidas (para descifrar durante la rotación). */
  keys: Map<string, Buffer>;
};

/**
 * Carga el llavero desde variables de entorno:
 *   REGISTRY_KEYS=k1:<base64 de 32 bytes>,k2:<base64>
 *   REGISTRY_ACTIVE_KEY_ID=k2
 * Preparado para sustituir por un proveedor KMS con la misma interfaz.
 */
export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  const raw = env.REGISTRY_KEYS ?? "";
  const keys = new Map<string, Buffer>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx < 1) throw new RegistryError("crypto", "REGISTRY_KEYS mal formado (esperado id:base64)");
    const id = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (!KEY_ID_RE.test(id)) throw new RegistryError("crypto", "Identificador de clave no válido");
    if (key.length !== 32) throw new RegistryError("crypto", `La clave ${id} debe tener 32 bytes`);
    keys.set(id, key);
  }
  const activeKeyId = env.REGISTRY_ACTIVE_KEY_ID ?? "";
  if (!keys.size) throw new RegistryError("crypto", "No hay claves de registro configuradas (REGISTRY_KEYS)");
  if (!keys.has(activeKeyId)) throw new RegistryError("crypto", "REGISTRY_ACTIVE_KEY_ID no figura en REGISTRY_KEYS");
  return { activeKeyId, keys };
}

export function encryptDsn(dsn: string, tenantId: string, ring: Keyring): { cipher: string; keyId: string } {
  const key = ring.keys.get(ring.activeKeyId);
  if (!key) throw new RegistryError("crypto", "Clave activa no disponible");
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(tenantId, "utf8"));
  const enc = Buffer.concat([c.update(dsn, "utf8"), c.final()]);
  const out = Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, c.getAuthTag(), enc]);
  return { cipher: out.toString("base64"), keyId: ring.activeKeyId };
}

export function decryptDsn(cipherB64: string, keyId: string, tenantId: string, ring: Keyring): string {
  const key = ring.keys.get(keyId);
  if (!key) throw new RegistryError("crypto", `Clave ${keyId} no disponible`);
  const buf = Buffer.from(cipherB64, "base64");
  if (buf.length < 1 + IV_LEN + TAG_LEN + 1 || buf[0] !== FORMAT_VERSION) {
    throw new RegistryError("crypto", "Formato de credencial no válido");
  }
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const enc = buf.subarray(1 + IV_LEN + TAG_LEN);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(tenantId, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    // Mensaje deliberadamente opaco: no distingue «clave mala» de «manipulado» de «otro tenant».
    throw new RegistryError("crypto", "No se pudo descifrar la credencial");
  }
}

/** Re-cifra con la clave activa (rotación). Devuelve null si ya usa la clave activa. */
export function reencryptDsn(
  cipherB64: string,
  keyId: string,
  tenantId: string,
  ring: Keyring,
): { cipher: string; keyId: string } | null {
  if (keyId === ring.activeKeyId) return null;
  return encryptDsn(decryptDsn(cipherB64, keyId, tenantId, ring), tenantId, ring);
}
