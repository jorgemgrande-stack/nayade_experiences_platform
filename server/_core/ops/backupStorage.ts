/**
 * Almacenamiento de las copias de seguridad (puerto + adaptadores).
 *
 *  - `S3BackupStorage`: cualquier servicio compatible con S3 (AWS S3, Cloudflare R2, Backblaze B2,
 *    MinIO…). Preferible FUERA del proyecto de Railway: si se pierde el proyecto, las copias siguen.
 *  - `FsBackupStorage`: un directorio (pruebas o un volumen montado). Un volumen del mismo proyecto
 *    NO protege ante la pérdida del proyecto.
 *
 * Ninguno se da por disponible: `backupStorageFromEnv` exige configuración explícita
 * (BACKUP_STORAGE=s3|fs) y devuelve el motivo si falta algo. Las claves de objeto son relativas y se
 * validan (sin `..`, sin barras invertidas).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StoredObject {
  key: string;
  bytes: number;
}

export interface BackupStorage {
  readonly kind: "s3" | "fs";
  /** Descripción sin secretos (para el inventario y los registros). */
  describe(): string;
  putFile(key: string, file: string): Promise<void>;
  putBuffer(key: string, data: Buffer): Promise<void>;
  getFile(key: string, dst: string): Promise<void>;
  /** `null` si no existe. */
  getBuffer(key: string): Promise<Buffer | null>;
  /** Descarga y calcula el SHA-256 del objeto almacenado (verificación de la subida). */
  hash(key: string): Promise<{ sha256: string; bytes: number }>;
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}

export function assertObjectKey(key: string): string {
  if (typeof key !== "string" || !key || key.length > 900 || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Clave de objeto de copia no válida");
  }
  if (key.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error("Clave de objeto de copia no válida");
  return key;
}

async function sha256Stream(stream: NodeJS.ReadableStream): Promise<{ sha256: string; bytes: number }> {
  const h = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    h.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: h.digest("hex"), bytes };
}

export class FsBackupStorage implements BackupStorage {
  readonly kind = "fs" as const;
  constructor(private root: string) {}
  describe() {
    return `fs:${this.root}`;
  }
  private p(key: string) {
    return path.join(this.root, ...assertObjectKey(key).split("/"));
  }
  async putFile(key: string, file: string) {
    const dst = this.p(key);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // Escritura atómica: nunca queda un objeto a medias con el nombre final
    const tmp = `${dst}.partial-${process.pid}`;
    fs.copyFileSync(file, tmp);
    fs.renameSync(tmp, dst);
  }
  async putBuffer(key: string, data: Buffer) {
    const dst = this.p(key);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.partial-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dst);
  }
  async getFile(key: string, dst: string) {
    fs.copyFileSync(this.p(key), dst);
  }
  async getBuffer(key: string) {
    const f = this.p(key);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  async hash(key: string) {
    return sha256Stream(fs.createReadStream(this.p(key)));
  }
  async list(prefix: string) {
    const out: StoredObject[] = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (!e.name.includes(".partial-") && r.startsWith(prefix)) out.push({ key: r, bytes: fs.statSync(path.join(dir, e.name)).size });
      }
    };
    walk(this.root, "");
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  async delete(key: string) {
    fs.rmSync(this.p(key), { force: true });
  }
}

export interface S3BackupConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Prefijo de todas las claves (p. ej. `elephant-source/`). */
  prefix?: string;
  forcePathStyle?: boolean;
}

export class S3BackupStorage implements BackupStorage {
  readonly kind = "s3" as const;
  private client: S3Client;
  private prefix: string;
  constructor(private cfg: S3BackupConfig, client?: S3Client) {
    this.prefix = cfg.prefix ? cfg.prefix.replace(/^\/+/, "").replace(/\/?$/, "/") : "";
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
  }
  describe() {
    const host = this.cfg.endpoint ? new URL(this.cfg.endpoint).host : `s3.${this.cfg.region}`;
    return `s3://${this.cfg.bucket}/${this.prefix}@${host}`;
  }
  private k(key: string) {
    return this.prefix + assertObjectKey(key);
  }
  async putFile(key: string, file: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: this.k(key),
        Body: fs.createReadStream(file),
        ContentLength: fs.statSync(file).size,
        ContentType: "application/octet-stream",
      }),
    );
  }
  async putBuffer(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key), Body: data, ContentType: "application/octet-stream" }));
  }
  private async body(key: string): Promise<Readable | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
      return r.Body as Readable;
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw e;
    }
  }
  async getFile(key: string, dst: string) {
    const b = await this.body(key);
    if (!b) throw new Error("La copia no existe en el almacenamiento");
    await pipeline(b, fs.createWriteStream(dst));
  }
  async getBuffer(key: string) {
    const b = await this.body(key);
    if (!b) return null;
    const parts: Buffer[] = [];
    for await (const c of b as AsyncIterable<Buffer>) parts.push(c);
    return Buffer.concat(parts);
  }
  async hash(key: string) {
    const b = await this.body(key);
    if (!b) throw new Error("La copia no existe en el almacenamiento");
    return sha256Stream(b);
  }
  async list(prefix: string) {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.prefix + prefix, ContinuationToken: token }),
      );
      for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key.slice(this.prefix.length), bytes: Number(o.Size ?? 0) });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
  }
}

// ── Origen de ficheros (medios de las empresas) ─────────────────────────────

/** Bucket de medios (variables S3_* del Core). Solo lectura: list + get. */
export class S3MediaSource {
  private client: S3Client;
  constructor(private cfg: { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string }, client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
  }
  describe() {
    return `s3://${this.cfg.bucket}`;
  }
  async list(prefix: string) {
    const out: Array<{ key: string; bytes: number; etag?: string }> = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key && !o.Key.endsWith("/")) out.push({ key: o.Key, bytes: Number(o.Size ?? 0), etag: o.ETag ?? undefined });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    const parts: Buffer[] = [];
    for await (const c of r.Body as AsyncIterable<Buffer>) parts.push(Buffer.from(c));
    return Buffer.concat(parts);
  }
}

/** Directorio con la misma estructura de claves que el bucket (pruebas, o almacenamiento local). */
export class FsMediaSource {
  constructor(private root: string) {}
  describe() {
    return `fs:${this.root}`;
  }
  async list(prefix: string) {
    const items = await new FsBackupStorage(this.root).list(prefix);
    return items.map((i) => ({ key: i.key, bytes: i.bytes, etag: `${i.bytes}-${Math.floor(fs.statSync(path.join(this.root, ...i.key.split("/"))).mtimeMs)}` }));
  }
  async get(key: string) {
    return fs.readFileSync(path.join(this.root, ...assertObjectKey(key).split("/")));
  }
}

/**
 * Origen de medios para la réplica de ficheros: solo con BACKUP_MEDIA=1 y el bucket de medios
 * configurado (S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY; S3_ENDPOINT, S3_REGION opcionales).
 */
export function mediaSourceFromEnv(env: NodeJS.ProcessEnv = process.env): { media: S3MediaSource } | { media: null; reason: string } {
  if (env.BACKUP_MEDIA !== "1") return { media: null, reason: "BACKUP_MEDIA no activado" };
  const missing = ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"].filter((k) => !env[k]);
  if (missing.length) return { media: null, reason: `Almacenamiento de medios no configurado (faltan ${missing.join(", ")})` };
  return {
    media: new S3MediaSource({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION || "us-east-1",
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY!,
      secretAccessKey: env.S3_SECRET_KEY!,
    }),
  };
}

/**
 * Almacenamiento desde variables de entorno:
 *   BACKUP_STORAGE=s3  BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY,
 *                      BACKUP_S3_REGION (defecto us-east-1), BACKUP_S3_ENDPOINT (R2/MinIO/B2…),
 *                      BACKUP_S3_PREFIX, BACKUP_S3_FORCE_PATH_STYLE=1
 *   BACKUP_STORAGE=fs  BACKUP_FS_DIR (directorio absoluto; p. ej. un volumen)
 */
export function backupStorageFromEnv(env: NodeJS.ProcessEnv = process.env): { storage: BackupStorage } | { storage: null; reason: string } {
  const kind = (env.BACKUP_STORAGE ?? "").trim();
  if (kind === "s3") {
    const missing = ["BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY", "BACKUP_S3_SECRET_KEY"].filter((k) => !env[k]);
    if (missing.length) return { storage: null, reason: `Faltan ${missing.join(", ")}` };
    if (env.BACKUP_S3_ENDPOINT && !/^https?:\/\//.test(env.BACKUP_S3_ENDPOINT)) return { storage: null, reason: "BACKUP_S3_ENDPOINT debe ser una URL http(s)" };
    return {
      storage: new S3BackupStorage({
        bucket: env.BACKUP_S3_BUCKET!,
        region: env.BACKUP_S3_REGION || "us-east-1",
        endpoint: env.BACKUP_S3_ENDPOINT || undefined,
        accessKeyId: env.BACKUP_S3_ACCESS_KEY!,
        secretAccessKey: env.BACKUP_S3_SECRET_KEY!,
        prefix: env.BACKUP_S3_PREFIX || undefined,
        forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === "1" ? true : undefined,
      }),
    };
  }
  if (kind === "fs") {
    const dir = env.BACKUP_FS_DIR ?? "";
    if (!dir || !path.isAbsolute(dir)) return { storage: null, reason: "BACKUP_FS_DIR debe ser una ruta absoluta" };
    return { storage: new FsBackupStorage(dir) };
  }
  return { storage: null, reason: "BACKUP_STORAGE no configurado (s3 o fs)" };
}
