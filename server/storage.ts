// Storage helpers — soporta dos backends:
//  1. Manus Forge proxy  (BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY)
//  2. S3 / MinIO local  (S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY + S3_BUCKET)

import { ENV } from './_core/env';
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

// ─── Backend selector ─────────────────────────────────────────────────────────

function useForge(): boolean {
  return !!(ENV.forgeApiUrl && ENV.forgeApiKey);
}

// ─── S3 / MinIO client (lazy) ────────────────────────────────────────────────

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (_s3) return _s3;
  if (!ENV.s3Endpoint || !ENV.s3AccessKey || !ENV.s3SecretKey) {
    throw new Error(
      "Storage not configured: set either (BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY) or (S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY + S3_BUCKET)"
    );
  }
  _s3 = new S3Client({
    endpoint: ENV.s3Endpoint,
    region: ENV.s3Region,
    credentials: {
      accessKeyId: ENV.s3AccessKey,
      secretAccessKey: ENV.s3SecretKey,
    },
    forcePathStyle: true, // necesario para MinIO
  });
  return _s3;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

// ─── Forge helpers ────────────────────────────────────────────────────────────

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

async function forgePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<{ key: string; url: string }> {
  const { forgeApiUrl, forgeApiKey } = ENV;
  const key = normalizeKey(relKey);
  const uploadUrl = new URL("v1/storage/upload", ensureTrailingSlash(forgeApiUrl));
  uploadUrl.searchParams.set("path", key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(forgeApiKey),
    body: formData,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Storage upload failed (${response.status}): ${message}`);
  }
  const url = (await response.json()).url;
  return { key, url };
}

async function forgeGet(relKey: string): Promise<{ key: string; url: string }> {
  const { forgeApiUrl, forgeApiKey } = ENV;
  const key = normalizeKey(relKey);
  const downloadApiUrl = new URL("v1/storage/downloadUrl", ensureTrailingSlash(forgeApiUrl));
  downloadApiUrl.searchParams.set("path", key);
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(forgeApiKey),
  });
  return { key, url: (await response.json()).url };
}

// ─── S3 / MinIO helpers ───────────────────────────────────────────────────────

async function s3Put(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);
  const body = typeof data === "string" ? Buffer.from(data) : data;
  await s3.send(new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
    Body: body as Buffer,
    ContentType: contentType,
  }));
  const publicBase = ENV.s3PublicUrl
    ? ENV.s3PublicUrl.replace(/\/+$/, "")
    : `${ENV.s3Endpoint}/${ENV.s3Bucket}`;
  const url = `${publicBase}/${key}`;
  return { key, url };
}

async function s3Get(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const publicBase = ENV.s3PublicUrl
    ? ENV.s3PublicUrl.replace(/\/+$/, "")
    : `${ENV.s3Endpoint}/${ENV.s3Bucket}`;
  return { key, url: `${publicBase}/${key}` };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  return useForge()
    ? forgePut(relKey, data, contentType)
    : s3Put(relKey, data, contentType);
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  return useForge() ? forgeGet(relKey) : s3Get(relKey);
}
