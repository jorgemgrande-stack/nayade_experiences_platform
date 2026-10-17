// Storage helpers — soporta tres backends:
//  1. Manus Forge proxy  (BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY)
//  2. S3 / MinIO local  (S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY + S3_BUCKET)
//  3. Fallback local     (/tmp/local-storage — útil en Railway sin S3 configurado)
//
// Con el servicio de objetos activo (STORAGE_OBJECTS; por defecto en multiempresa) `storagePut`
// delega en server/_core/files/service.ts: bucket privado, metadatos en `stored_objects` y entrega por
// rutas del Core. Sin él (instalación única por defecto) el comportamiento es el heredado.

import { ENV } from './_core/env';
import { Metrics, meter } from "./_core/metering";
import { scopeStorageKey } from "./_core/tenantStorage";
import { enforceQuota } from "./_core/erm/runtime";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { TRPCError } from "@trpc/server";
import {
  fileService,
  objectStorageEnabled,
  signedLink,
  objectIdFromUrl,
  FileValidationError,
  StorageUnavailableError,
  type PutInput,
} from "./_core/files/service";
import { categoryFromLegacyKey, type FileCategory } from "./_core/files/categories";

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_PATH ?? "/tmp/local-storage";

// ─── Backend selector ─────────────────────────────────────────────────────────

function useForge(): boolean {
  return !!(ENV.forgeApiUrl && ENV.forgeApiKey);
}

// ─── S3 / MinIO client (lazy) ────────────────────────────────────────────────

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    endpoint: ENV.s3Endpoint || undefined,
    region: ENV.s3Region,
    credentials: {
      accessKeyId: ENV.s3AccessKey,
      secretAccessKey: ENV.s3SecretKey,
    },
    forcePathStyle: true, // necesario para MinIO
  });
  return _s3;
}

// ─── Fallback local (cuando no hay Forge ni S3) ───────────────────────────────

async function localPut(
  key: string,
  data: Buffer | Uint8Array | string
): Promise<{ key: string; url: string }> {
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data as Buffer);
  const base = (process.env.APP_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/+$/, "");
  const url = base ? `${base}/local-storage/${key}` : `/local-storage/${key}`;
  console.warn(`[Storage] Sin S3/Forge — archivo guardado en ${filePath} (temporal, se perderá en el próximo deploy)`);
  return { key, url };
}

// Valida la clave (sin `..`) y la ubica en el espacio del tenant en modo multi.
function normalizeKey(relKey: string): string {
  return scopeStorageKey(relKey);
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

export interface StoragePutOptions {
  /** Clase y política del objeto; si falta, se deduce de la clave (lo desconocido es privado). */
  category?: FileCategory;
  originalName?: string | null;
  owner?: PutInput["owner"];
  uploadedBy?: number | null;
  /** id del objeto que sustituye (el anterior se conserva hasta confirmar el nuevo). */
  replaces?: string | null;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  opts: StoragePutOptions = {}
): Promise<{ key: string; url: string; objectId?: string }> {
  const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
  // Cuota de escritura del tenant (lanza QuotaExceededError si un límite duro se superaría)
  await enforceQuota(Metrics.STORAGE_WRITE_BYTES, bytes);
  if (objectStorageEnabled()) {
    normalizeKey(relKey); // la clave heredada sigue validándose (sin `..`, ni de otra empresa)
    let r: Awaited<ReturnType<ReturnType<typeof fileService>["put"]>>;
    try {
      r = await fileService().put({
        category: opts.category ?? categoryFromLegacyKey(relKey),
        data,
        declaredType: contentType,
        originalName: opts.originalName ?? null,
        owner: opts.owner ?? null,
        uploadedBy: opts.uploadedBy ?? null,
        replaces: opts.replaces ?? null,
      });
    } catch (err) {
      // Errores controlados: 400 (contenido no válido) o 503 (almacenamiento no disponible)
      if (err instanceof FileValidationError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
      if (err instanceof StorageUnavailableError) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: err.message, cause: err });
      throw err;
    }
    meter(Metrics.STORAGE_WRITE_BYTES, bytes, "byte", { backend: fileService().storage.kind });
    return { key: r.key, url: r.url, objectId: r.objectId };
  }
  let backend: "forge" | "s3" | "local";
  let result: { key: string; url: string };
  if (useForge()) {
    backend = "forge";
    result = await forgePut(relKey, data, contentType);
  } else if (ENV.s3AccessKey && ENV.s3SecretKey) {
    backend = "s3";
    result = await s3Put(relKey, data, contentType);
  } else {
    // Fallback: almacenamiento local cuando ni Forge ni S3 están configurados
    backend = "local";
    result = await localPut(normalizeKey(relKey), data);
  }
  meter(Metrics.STORAGE_WRITE_BYTES, bytes, "byte", { backend });
  return result;
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  return useForge() ? forgeGet(relKey) : s3Get(relKey);
}

/**
 * Contenido de un fichero propio a partir de su URL del Core (`/api/files/<id>`, `/files/<id>/…`).
 * `null` si la URL no es del servicio o el objeto no existe en la empresa en curso.
 */
export async function readStoredFile(url: unknown): Promise<{ data: Buffer; contentType: string; name: string } | null> {
  if (!objectIdFromUrl(url)) return null;
  try {
    const r = await fileService().readByUrl(url);
    return r ? { data: r.data, contentType: r.row.contentType, name: r.row.originalName ?? r.row.objectId } : null;
  } catch {
    return null;
  }
}

/**
 * URL apta para enviar fuera (correo a un cliente o proveedor): un fichero PRIVADO del servicio se
 * convierte en un enlace firmado del Core con caducidad (STORAGE_LINK_TTL_SECONDS); el resto no cambia.
 */
export function externalFileUrl(url: string): string {
  const id = objectIdFromUrl(url);
  if (!id || !url.includes("/api/files/")) return url;
  return signedLink(id);
}

/** Retorna true si hay almacenamiento externo (Forge o S3) configurado. */
export function hasExternalStorage(): boolean {
  if (objectStorageEnabled()) return fileService().storage.kind !== "local";
  return useForge() || !!(ENV.s3AccessKey && ENV.s3SecretKey);
}
