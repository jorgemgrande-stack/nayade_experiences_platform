/**
 * Cifrado de las copias de seguridad y autenticación de su manifiesto.
 *
 * Llavero: BACKUP_KEYS=`id:base64(32 bytes),id2:…` y BACKUP_ACTIVE_KEY_ID (mismo formato que
 * REGISTRY_KEYS). Las copias se cifran con la clave activa; su identificador queda en la cabecera del
 * objeto y en el manifiesto, de modo que tras una rotación las copias antiguas siguen descifrándose
 * mientras su clave permanezca en BACKUP_KEYS. Ninguna clave se guarda junto a las copias.
 *
 * De cada clave maestra se derivan (HKDF-SHA256) dos subclaves independientes: una para cifrar
 * (AES-256-GCM) y otra para firmar el manifiesto (HMAC-SHA256).
 *
 * Formato del objeto cifrado:
 *   "ESBK" | versión (1 byte) | longitud del id de clave (1 byte) | id de clave | IV (12) | texto cifrado | etiqueta GCM (16)
 * La cabecera completa y el contexto (`aad`, p. ej. `tenant:acme`) van como datos autenticados: un
 * objeto de una empresa no se descifra como de otra aunque se copie entre rutas.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { keyringFromEnv, type Keyring } from "../tenantRegistry/crypto";

export type { Keyring };

const MAGIC = Buffer.from("ESBK", "ascii");
const FORMAT_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupCryptoError";
  }
}

/** Llavero de copias desde BACKUP_KEYS / BACKUP_ACTIVE_KEY_ID. */
export function backupKeyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  try {
    return keyringFromEnv({ REGISTRY_KEYS: env.BACKUP_KEYS ?? "", REGISTRY_ACTIVE_KEY_ID: env.BACKUP_ACTIVE_KEY_ID ?? "" } as NodeJS.ProcessEnv);
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/REGISTRY_KEYS/g, "BACKUP_KEYS").replace(/REGISTRY_ACTIVE_KEY_ID/g, "BACKUP_ACTIVE_KEY_ID").replace(/de registro/g, "de copias") : "error";
    throw new BackupCryptoError(msg);
  }
}

function masterKey(ring: Keyring, keyId: string): Buffer {
  const k = ring.keys.get(keyId);
  if (!k) throw new BackupCryptoError(`La clave de copias ${keyId} no está en BACKUP_KEYS`);
  return k;
}

function subkey(ring: Keyring, keyId: string, purpose: "data" | "manifest"): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", masterKey(ring, keyId), Buffer.alloc(0), `elephant-backup:${purpose}:v1`, 32));
}

function header(keyId: string, iv: Buffer): Buffer {
  const id = Buffer.from(keyId, "utf8");
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION, id.length]), id, iv]);
}

export interface EncryptResult {
  keyId: string;
  /** SHA-256 del objeto cifrado (lo que se sube). */
  sha256: string;
  bytes: number;
}

/** Cifra `src` en `dst` con la clave activa. `aad` liga el objeto a su destino (p. ej. `tenant:acme`). */
export async function encryptFile(src: string, dst: string, ring: Keyring, aad: string): Promise<EncryptResult> {
  const keyId = ring.activeKeyId;
  const iv = crypto.randomBytes(IV_LEN);
  const head = header(keyId, iv);
  const cipher = crypto.createCipheriv("aes-256-gcm", subkey(ring, keyId, "data"), iv);
  cipher.setAAD(Buffer.concat([head, Buffer.from(aad, "utf8")]));
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const out = fs.createWriteStream(dst);
  const write = (b: Buffer) => {
    hash.update(b);
    bytes += b.length;
    return b;
  };
  out.write(write(head));
  await pipeline(
    fs.createReadStream(src),
    new Transform({
      transform(chunk: Buffer, _enc, cb) {
        cb(null, write(cipher.update(chunk)));
      },
      flush(cb) {
        const last = cipher.final();
        if (last.length) this.push(write(last));
        this.push(write(cipher.getAuthTag()));
        cb();
      },
    }),
    out,
  );
  return { keyId, sha256: hash.digest("hex"), bytes };
}

/** Lee la cabecera de un objeto cifrado (id de clave y longitud). */
export function readHeader(file: string): { keyId: string; iv: Buffer; headerLength: number } {
  const fd = fs.openSync(file, "r");
  try {
    const fixed = Buffer.alloc(6);
    if (fs.readSync(fd, fixed, 0, 6, 0) !== 6 || !fixed.subarray(0, 4).equals(MAGIC)) throw new BackupCryptoError("No es una copia cifrada de Elephant Source");
    if (fixed[4] !== FORMAT_VERSION) throw new BackupCryptoError(`Versión de formato de copia no admitida: ${fixed[4]}`);
    const idLen = fixed[5];
    const rest = Buffer.alloc(idLen + IV_LEN);
    if (fs.readSync(fd, rest, 0, rest.length, 6) !== rest.length) throw new BackupCryptoError("Copia truncada");
    return { keyId: rest.subarray(0, idLen).toString("utf8"), iv: rest.subarray(idLen), headerLength: 6 + rest.length };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Descifra `src` en `dst`. Falla (y borra `dst`) si la clave no está disponible, el objeto se alteró
 * o pertenece a otro contexto (`aad`).
 */
export async function decryptFile(src: string, dst: string, ring: Keyring, aad: string): Promise<{ keyId: string }> {
  const h = readHeader(src);
  const size = fs.statSync(src).size;
  if (size < h.headerLength + TAG_LEN) throw new BackupCryptoError("Copia truncada");
  const tag = Buffer.alloc(TAG_LEN);
  const fd = fs.openSync(src, "r");
  try {
    fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    fs.closeSync(fd);
  }
  const head = header(h.keyId, h.iv);
  const decipher = crypto.createDecipheriv("aes-256-gcm", subkey(ring, h.keyId, "data"), h.iv);
  decipher.setAAD(Buffer.concat([head, Buffer.from(aad, "utf8")]));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      size - TAG_LEN > h.headerLength ? fs.createReadStream(src, { start: h.headerLength, end: size - TAG_LEN - 1 }) : (async function* () {})(),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          cb(null, decipher.update(chunk));
        },
        flush(cb) {
          try {
            const last = decipher.final();
            if (last.length) this.push(last);
            cb();
          } catch {
            cb(new BackupCryptoError("La copia no se pudo autenticar: alterada, de otro destino o clave incorrecta"));
          }
        },
      }),
      fs.createWriteStream(dst),
    );
  } catch (e) {
    fs.rmSync(dst, { force: true });
    throw e instanceof BackupCryptoError ? e : new BackupCryptoError("La copia no se pudo descifrar");
  }
  return { keyId: h.keyId };
}

/** Cifra un contenido pequeño en memoria (mismo formato). */
export function encryptBuffer(plain: Buffer, ring: Keyring, aad: string): Buffer {
  const keyId = ring.activeKeyId;
  const iv = crypto.randomBytes(IV_LEN);
  const head = header(keyId, iv);
  const c = crypto.createCipheriv("aes-256-gcm", subkey(ring, keyId, "data"), iv);
  c.setAAD(Buffer.concat([head, Buffer.from(aad, "utf8")]));
  return Buffer.concat([head, c.update(plain), c.final(), c.getAuthTag()]);
}

export function decryptBuffer(buf: Buffer, ring: Keyring, aad: string): Buffer {
  if (buf.length < 6 + IV_LEN + TAG_LEN || !buf.subarray(0, 4).equals(MAGIC) || buf[4] !== FORMAT_VERSION) {
    throw new BackupCryptoError("No es una copia cifrada de Elephant Source");
  }
  const idLen = buf[5];
  const keyId = buf.subarray(6, 6 + idLen).toString("utf8");
  const iv = buf.subarray(6 + idLen, 6 + idLen + IV_LEN);
  const headLen = 6 + idLen + IV_LEN;
  const d = crypto.createDecipheriv("aes-256-gcm", subkey(ring, keyId, "data"), iv);
  d.setAAD(Buffer.concat([buf.subarray(0, headLen), Buffer.from(aad, "utf8")]));
  d.setAuthTag(buf.subarray(buf.length - TAG_LEN));
  try {
    return Buffer.concat([d.update(buf.subarray(headLen, buf.length - TAG_LEN)), d.final()]);
  } catch {
    throw new BackupCryptoError("La copia no se pudo autenticar: alterada, de otro destino o clave incorrecta");
  }
}

/** JSON canónico (claves ordenadas) para firmar. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k]))
      .join(",") +
    "}"
  );
}

/** Firma un manifiesto con la subclave de la clave indicada en `manifest.keyId`. */
export function signManifest<T extends { keyId: string }>(manifest: T, ring: Keyring): T & { mac: string } {
  const { mac: _drop, ...body } = manifest as T & { mac?: string };
  void _drop;
  const mac = crypto.createHmac("sha256", subkey(ring, manifest.keyId, "manifest")).update(canonicalJson(body)).digest("hex");
  return { ...(body as T), mac };
}

/** Comprueba la firma del manifiesto; lanza si se alteró o no hay clave. */
export function verifyManifest<T extends { keyId: string; mac?: string }>(manifest: T, ring: Keyring): T {
  if (!manifest || typeof manifest.keyId !== "string" || typeof manifest.mac !== "string") throw new BackupCryptoError("Manifiesto sin firma");
  const expected = signManifest(manifest, ring).mac;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(manifest.mac, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new BackupCryptoError("Manifiesto alterado: la firma no coincide");
  return manifest;
}
