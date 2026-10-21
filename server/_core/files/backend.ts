/**
 * Proveedores de almacenamiento de objetos. Mismo contrato para los tres:
 *  - S3 compatible (AWS S3, Railway Buckets, Cloudflare R2, Backblaze B2, MinIO…): bucket PRIVADO;
 *    nunca se construyen URL públicas del proveedor. Para entregar, el Core lee y sirve el objeto o
 *    genera una URL prefirmada de duración corta.
 *  - Forge (instalación heredada de Náyade): subida y URL de descarga por su API.
 *  - Disco local (`LOCAL_STORAGE_PATH`): desarrollo y pruebas. En Railway es EFÍMERO.
 *
 * Un fallo de red o del proveedor se convierte en `StorageUnavailableError` (sin detalles internos);
 * un objeto inexistente es `null`, no un error.
 */
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class StorageUnavailableError extends Error {
  constructor(message = "El almacenamiento de ficheros no está disponible. Inténtalo más tarde.") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export interface ListedObject {
  key: string;
  bytes: number;
  lastModified?: number;
}

export interface ObjectBackend {
  readonly kind: "s3" | "local" | "forge";
  describe(): string;
  put(key: string, data: Buffer, contentType: string, meta?: Record<string, string>): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  stat(key: string): Promise<{ bytes: number } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<ListedObject[]>;
  /** URL de descarga temporal firmada por el proveedor (solo si la admite). */
  presign?(key: string, ttlSeconds: number, o: { contentType: string; disposition: string }): Promise<string>;
  /** Sube un fichero del disco en streaming, sin cargarlo en memoria (ficheros grandes: exportaciones). */
  putFile?(key: string, filePath: string, sizeBytes: number, contentType: string, meta?: Record<string, string>): Promise<void>;
  /** Lee el objeto en streaming (entrega de ficheros grandes sin cargarlos en memoria); null si no existe. */
  getStream?(key: string): Promise<Readable | null>;
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; Code?: string };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
};

function unavailable(op: string, err: unknown): StorageUnavailableError {
  const name = err instanceof Error ? err.name : "error";
  console.error(JSON.stringify({ ctx: "Storage", event: "backend_error", op, error: name }));
  return new StorageUnavailableError();
}

// ── S3 compatible ───────────────────────────────────────────────────────────

export interface S3BackendConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  /** Tiempo máximo por petición (ms). */
  timeoutMs?: number;
}

export class S3ObjectBackend implements ObjectBackend {
  readonly kind = "s3" as const;
  private client: S3Client;
  constructor(private cfg: S3BackendConfig, client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        forcePathStyle: cfg.forcePathStyle ?? true,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
        maxAttempts: 3,
        requestHandler: { connectionTimeout: Math.min(cfg.timeoutMs ?? 15_000, 5_000), requestTimeout: cfg.timeoutMs ?? 15_000 },
      });
  }
  describe() {
    return `s3://${this.cfg.bucket}`;
  }
  async put(key: string, data: Buffer, contentType: string, meta?: Record<string, string>) {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data, ContentType: contentType, Metadata: meta }));
    } catch (err) {
      throw unavailable("put", err);
    }
  }
  async putFile(key: string, filePath: string, sizeBytes: number, contentType: string, meta?: Record<string, string>) {
    // Una sola petición PUT en streaming (hasta 5 GB): sin multipart ni dependencias nuevas
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: createReadStream(filePath), ContentLength: sizeBytes, ContentType: contentType, Metadata: meta }));
    } catch (err) {
      throw unavailable("put_file", err);
    }
  }
  async getStream(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return r.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw unavailable("get_stream", err);
    }
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      const parts: Buffer[] = [];
      for await (const c of r.Body as AsyncIterable<Uint8Array>) parts.push(Buffer.from(c));
      return Buffer.concat(parts);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw unavailable("get", err);
    }
  }
  async stat(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { bytes: Number(r.ContentLength ?? 0) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw unavailable("stat", err);
    }
  }
  async delete(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch (err) {
      if (isNotFound(err)) return;
      throw unavailable("delete", err);
    }
  }
  async list(prefix: string) {
    const out: ListedObject[] = [];
    let token: string | undefined;
    try {
      do {
        const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents ?? []) {
          if (o.Key && !o.Key.endsWith("/")) out.push({ key: o.Key, bytes: Number(o.Size ?? 0), lastModified: o.LastModified?.getTime() });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    } catch (err) {
      throw unavailable("list", err);
    }
    return out;
  }
  async presign(key: string, ttlSeconds: number, o: { contentType: string; disposition: string }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ResponseContentType: o.contentType, ResponseContentDisposition: o.disposition }),
      { expiresIn: ttlSeconds },
    );
  }
}

// ── Disco local ─────────────────────────────────────────────────────────────

export class LocalObjectBackend implements ObjectBackend {
  readonly kind = "local" as const;
  private root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  describe() {
    return `local:${this.root}`;
  }
  private file(key: string) {
    const p = path.resolve(this.root, ...key.split("/"));
    if (!p.startsWith(this.root + path.sep)) throw new Error("Clave de almacenamiento no válida");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.file(key);
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      // Escritura atómica: nunca queda un fichero a medias con el nombre final
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, p);
    } catch (err) {
      throw unavailable("put", err);
    }
  }
  async putFile(key: string, filePath: string) {
    const p = this.file(key);
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      await pipeline(createReadStream(filePath), createWriteStream(tmp));
      await fs.rename(tmp, p);
    } catch (err) {
      throw unavailable("put_file", err);
    }
  }
  async getStream(key: string) {
    const p = this.file(key);
    try {
      await fs.access(p);
    } catch {
      return null;
    }
    return createReadStream(p);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.file(key));
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return null;
      throw unavailable("get", err);
    }
  }
  async stat(key: string) {
    try {
      return { bytes: (await fs.stat(this.file(key))).size };
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return null;
      throw unavailable("stat", err);
    }
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
  async list(prefix: string) {
    const out: ListedObject[] = [];
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith(".tmp")) {
          const key = path.relative(this.root, full).split(path.sep).join("/");
          if (key.startsWith(prefix)) {
            const st = await fs.stat(full);
            out.push({ key, bytes: st.size, lastModified: st.mtimeMs });
          }
        }
      }
    };
    await walk(this.root);
    return out;
  }
}

// ── Forge (heredado) ────────────────────────────────────────────────────────

export class ForgeObjectBackend implements ObjectBackend {
  readonly kind = "forge" as const;
  constructor(private cfg: { apiUrl: string; apiKey: string }) {}
  describe() {
    return "forge";
  }
  private url(p: string) {
    return new URL(p, this.cfg.apiUrl.endsWith("/") ? this.cfg.apiUrl : `${this.cfg.apiUrl}/`);
  }
  async put(key: string, data: Buffer, contentType: string) {
    const u = this.url("v1/storage/upload");
    u.searchParams.set("path", key);
    const form = new FormData();
    form.append("file", new Blob([data as unknown as BlobPart], { type: contentType }), key.split("/").pop() ?? "file");
    let r: Response;
    try {
      r = await fetch(u, { method: "POST", headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, body: form });
    } catch (err) {
      throw unavailable("put", err);
    }
    if (!r.ok) throw unavailable("put", new Error(`HTTP ${r.status}`));
  }
  private async downloadUrl(key: string): Promise<string | null> {
    const u = this.url("v1/storage/downloadUrl");
    u.searchParams.set("path", key);
    let r: Response;
    try {
      r = await fetch(u, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } });
    } catch (err) {
      throw unavailable("get", err);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw unavailable("get", new Error(`HTTP ${r.status}`));
    return ((await r.json()) as { url?: string }).url ?? null;
  }
  async get(key: string) {
    const url = await this.downloadUrl(key);
    if (!url) return null;
    let r: Response;
    try {
      r = await fetch(url);
    } catch (err) {
      throw unavailable("get", err);
    }
    if (r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw unavailable("get", new Error(`HTTP ${r.status}`));
    return Buffer.from(await r.arrayBuffer());
  }
  async stat(key: string) {
    const b = await this.get(key);
    return b ? { bytes: b.length } : null;
  }
  async delete() {
    // La API de Forge no ofrece borrado: el objeto queda sin metadatos activos (no se sirve).
  }
  async list() {
    return [];
  }
}

// ── Selección por variables de entorno ──────────────────────────────────────

let cached: { sig: string; backend: ObjectBackend } | null = null;

export function backendFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectBackend {
  const forge = env.BUILT_IN_FORGE_API_URL && env.BUILT_IN_FORGE_API_KEY;
  const s3 = env.S3_ACCESS_KEY && env.S3_SECRET_KEY;
  const sig = forge
    ? `forge|${env.BUILT_IN_FORGE_API_URL}`
    : s3
      ? `s3|${env.S3_ENDPOINT}|${env.S3_BUCKET}|${env.S3_REGION}|${env.S3_ACCESS_KEY}|${env.S3_FORCE_PATH_STYLE}`
      : `local|${env.LOCAL_STORAGE_PATH}`;
  if (cached?.sig === sig) return cached.backend;
  let backend: ObjectBackend;
  if (forge) backend = new ForgeObjectBackend({ apiUrl: env.BUILT_IN_FORGE_API_URL!, apiKey: env.BUILT_IN_FORGE_API_KEY! });
  else if (s3)
    backend = new S3ObjectBackend({
      bucket: env.S3_BUCKET || "nayade-media",
      region: env.S3_REGION || "us-east-1",
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY!,
      secretAccessKey: env.S3_SECRET_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "0",
      timeoutMs: Number(env.STORAGE_TIMEOUT_MS) || undefined,
    });
  else backend = new LocalObjectBackend(env.LOCAL_STORAGE_PATH ?? "/tmp/local-storage");
  cached = { sig, backend };
  return backend;
}

/** Solo pruebas: olvida el proveedor en caché (p. ej. tras cambiar variables). */
export function resetBackendCache(): void {
  cached = null;
}
