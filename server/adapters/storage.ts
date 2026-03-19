/**
 * adapters/storage.ts — Storage S3 estándar independiente de Manus.
 *
 * Compatible con AWS S3, MinIO, Cloudflare R2 y cualquier proveedor S3-compatible.
 * Variables de entorno:
 *
 *   S3_ENDPOINT        → URL del endpoint (ej. https://s3.amazonaws.com o http://localhost:9000)
 *   S3_REGION          → región AWS (default: us-east-1)
 *   S3_BUCKET          → nombre del bucket
 *   S3_ACCESS_KEY      → Access Key ID
 *   S3_SECRET_KEY      → Secret Access Key
 *   S3_PUBLIC_URL      → URL pública base para los archivos (opcional; si no se define, se construye desde endpoint+bucket)
 *
 * Si no está configurado, las operaciones de subida guardan los archivos en
 * /tmp/local-storage/ y devuelven rutas relativas (útil para desarrollo sin S3).
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

function getS3Config() {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
    publicUrl: process.env.S3_PUBLIC_URL ?? "",
  };
}

function createS3Client() {
  const cfg = getS3Config();
  return new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
    credentials: cfg.accessKey
      ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
      : undefined,
  });
}

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_PATH ?? "/tmp/local-storage";

/** Sube bytes a S3 (o al sistema de archivos local si S3 no está configurado). */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType?: string
): Promise<{ key: string; url: string }> {
  const cfg = getS3Config();
  const key = relKey.replace(/^\/+/, "");

  if (!cfg.bucket || !cfg.accessKey) {
    // Fallback: almacenamiento local en /tmp/local-storage
    const filePath = path.join(LOCAL_STORAGE_DIR, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data as Buffer);
    const url = `/local-storage/${key}`;
    console.warn(`[Storage] S3 no configurado — archivo guardado en ${filePath}`);
    return { key, url };
  }

  const client = createS3Client();
  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType ?? "application/octet-stream",
  }));

  const publicBase = cfg.publicUrl
    ? cfg.publicUrl.replace(/\/$/, "")
    : cfg.endpoint
      ? `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}`
      : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;

  const url = `${publicBase}/${key}`;
  return { key, url };
}

/** Devuelve una URL pre-firmada (o URL pública si el bucket es público). */
export async function storageGet(
  relKey: string,
  expiresIn = 3600
): Promise<{ key: string; url: string }> {
  const cfg = getS3Config();
  const key = relKey.replace(/^\/+/, "");

  if (!cfg.bucket || !cfg.accessKey) {
    return { key, url: `/local-storage/${key}` };
  }

  const client = createS3Client();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn }
  );
  return { key, url };
}
