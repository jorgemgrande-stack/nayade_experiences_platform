/**
 * Descarga de un medio por URL para la importación: https, lista blanca de tipos, tamaño y tiempo máximos,
 * redirecciones limitadas y revalidadas, bloqueo SSRF con conexión fijada a la IP validada. Devuelve los bytes TAL
 * COMO LOS SIRVE el origen (sin recomprimir ni transformar) y su SHA-256.
 */
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { detectContentType } from "../_core/files/contentType";
import { resolvePublicAddress, systemResolver, type Resolver } from "./netGuard";

/** Tipos que se aceptan. El almacén público actual solo guarda imágenes y PDF (vídeo y fuentes: ver docs/studio/importacion.md). */
export const MEDIA_ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml", "application/pdf",
] as const;

export const DOWNLOAD_DEFAULTS = { maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000, maxRedirects: 3 } as const;

export interface DownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedMime?: readonly string[];
  resolver?: Resolver;
  /** SOLO PRUEBAS: admite http y el loopback 127.0.0.0/8 (servidor local de prueba); el resto de redes privadas sigue bloqueado. Nunca se expone en la CLI. */
  unsafeTestMode?: boolean;
}

export interface Downloaded {
  data: Buffer;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  /** Nombre sugerido por el origen (última parte de la ruta final), sin consulta. */
  filename: string;
  finalUrl: string;
  redirects: number;
}

export class DownloadError extends Error {
  constructor(message: string, readonly code: "url" | "blocked" | "redirect" | "status" | "type" | "size" | "timeout" | "network" | "encoding") {
    super(message);
    this.name = "DownloadError";
  }
}

function baseName(u: URL): string {
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  return last.slice(0, 200) || "fichero";
}

function requestOnce(url: URL, ip: string, deadline: number, o: Required<Pick<DownloadOptions, "maxBytes">> & { test: boolean }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const left = deadline - Date.now();
    if (left <= 0) return reject(new DownloadError("Tiempo de descarga agotado", "timeout"));
    const req = lib.request(
      {
        protocol: url.protocol,
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": "ElephantStudioImport/1" },
        // Conexión fijada a la IP ya validada: sin segunda resolución (DNS rebinding)
        lookup: (_h: string, opts: unknown, cb: (...a: unknown[]) => void) => {
          const fam = ip.includes(":") ? 6 : 4;
          if ((opts as { all?: boolean })?.all) cb(null, [{ address: ip, family: fam }]);
          else cb(null, ip, fam);
        },
        timeout: left,
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > o.maxBytes) {
          res.destroy();
          return reject(new DownloadError(`El fichero supera el tamaño máximo (${Math.floor(o.maxBytes / 1048576)} MB)`, "size"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        const timer = setTimeout(() => {
          req.destroy();
          reject(new DownloadError("Tiempo de descarga agotado", "timeout"));
        }, Math.max(1, deadline - Date.now()));
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > o.maxBytes) {
            clearTimeout(timer);
            req.destroy();
            return reject(new DownloadError(`El fichero supera el tamaño máximo (${Math.floor(o.maxBytes / 1048576)} MB)`, "size"));
          }
          chunks.push(c);
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", (e) => {
          clearTimeout(timer);
          reject(new DownloadError(`Error de red: ${e.message}`, "network"));
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new DownloadError("Tiempo de descarga agotado", "timeout"));
    });
    req.on("error", (e) => reject(e instanceof DownloadError ? e : new DownloadError(`Error de red: ${e.message}`, "network")));
    req.end();
  });
}

export async function downloadMedia(rawUrl: string, options: DownloadOptions = {}): Promise<Downloaded> {
  const test = options.unsafeTestMode === true;
  const maxBytes = options.maxBytes ?? DOWNLOAD_DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DOWNLOAD_DEFAULTS.maxRedirects;
  const allowed = options.allowedMime ?? MEDIA_ALLOWED_MIME;
  const resolver = options.resolver ?? systemResolver;
  const deadline = Date.now() + (options.timeoutMs ?? DOWNLOAD_DEFAULTS.timeoutMs);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DownloadError("URL no válida", "url");
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" && !(test && url.protocol === "http:")) throw new DownloadError("Solo se admite https", "url");
    if (url.username || url.password) throw new DownloadError("La URL no puede llevar credenciales", "url");
    let ip: string;
    try {
      ip = await resolvePublicAddress(url.hostname, resolver, { allowLoopback: test });
    } catch (e) {
      throw new DownloadError(e instanceof Error ? e.message : "Destino no permitido", "blocked");
    }
    const res = await requestOnce(url, ip, deadline, { maxBytes, test });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.location;
      if (!loc) throw new DownloadError(`Redirección sin destino (HTTP ${res.status})`, "redirect");
      if (hop >= maxRedirects) throw new DownloadError(`Demasiadas redirecciones (máx. ${maxRedirects})`, "redirect");
      try {
        url = new URL(loc, url);
      } catch {
        throw new DownloadError("Redirección a una URL no válida", "redirect");
      }
      continue; // se revalida el nuevo destino (esquema, host y resolución) en la vuelta siguiente
    }
    if (res.status !== 200) throw new DownloadError(`El origen respondió HTTP ${res.status}`, "status");
    const enc = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
    if (enc !== "identity") throw new DownloadError("El origen comprime la respuesta; no se puede conservar el original byte a byte", "encoding");
    const declared = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (declared && declared !== "application/octet-stream" && !allowed.includes(declared)) {
      throw new DownloadError(`Tipo no permitido (${declared})`, "type");
    }
    if (!res.body.length) throw new DownloadError("El fichero está vacío", "size");
    const detected = detectContentType(res.body, declared || null);
    if (!allowed.includes(detected)) throw new DownloadError(`El contenido no corresponde a un tipo permitido (${detected})`, "type");
    return {
      data: res.body,
      sha256: crypto.createHash("sha256").update(res.body).digest("hex"),
      sizeBytes: res.body.length,
      contentType: detected,
      filename: baseName(url),
      finalUrl: url.toString(),
      redirects: hop,
    };
  }
}
