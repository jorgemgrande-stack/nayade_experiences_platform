/**
 * Validación del tipo de un fichero POR SU CONTENIDO (firmas binarias), no por la extensión ni por el
 * tipo que declara el cliente. El tipo con el que se guarda y se sirve es siempre el detectado.
 *
 *  - Binarios reconocidos: JPEG, PNG, GIF, WebP, AVIF, PDF, ZIP (y Office moderno: DOCX/XLSX/PPTX,
 *    que son ZIP con una entrada característica) y Office antiguo (contenedor OLE: DOC/XLS).
 *  - Texto (UTF-8 sin NUL): SVG, HTML, XML, CSV o texto plano, según el contenido y lo declarado.
 *  - SVG: solo se admite como objeto PÚBLICO si supera `isSafeSvg` (sin scripts, manejadores de
 *    eventos, `javascript:`, `foreignObject`, entidades ni referencias externas). Como privado se
 *    guarda pero se sirve siempre como descarga.
 */

export type DetectedType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "image/svg+xml"
  | "application/pdf"
  | "application/zip"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/x-ole-storage"
  | "application/msword"
  | "application/vnd.ms-excel"
  | "text/html"
  | "application/xml"
  | "text/csv"
  | "text/plain"
  | "application/octet-stream";

const EXT: Record<DetectedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/x-ole-storage": "bin",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "text/html": "html",
  "application/xml": "xml",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/octet-stream": "bin",
};

export function extensionFor(type: string): string {
  return EXT[type as DetectedType] ?? "bin";
}

/** Tipos que un navegador puede mostrar en línea sin riesgo de ejecutar código en el origen. */
export const INLINE_SAFE = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "application/pdf"]);

const startsWith = (b: Buffer, sig: number[], offset = 0) => b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

function normalizeDeclared(declared?: string | null): string {
  return String(declared ?? "").split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
}

function isUtf8Text(b: Buffer): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, Math.min(b.length, 64 * 1024)));
    return true;
  } catch {
    // Un recorte a mitad de un carácter multibyte no invalida el texto
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return true;
    } catch {
      return false;
    }
  }
}

function zipKind(b: Buffer): DetectedType {
  // Las entradas de un ZIP de Office llevan rutas características en las cabeceras locales
  const head = b.subarray(0, Math.min(b.length, 256 * 1024)).toString("latin1");
  if (head.includes("word/")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (head.includes("xl/")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (head.includes("ppt/")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/zip";
}

/** Tipo real del contenido. `declared` solo decide entre variantes de texto o de OLE. */
export function detectContentType(data: Buffer, declared?: string | null): DetectedType {
  const d = normalizeDeclared(declared);
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(data, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = data.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return "image/avif";
    return "application/octet-stream";
  }
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04]) || startsWith(data, [0x50, 0x4b, 0x05, 0x06])) return zipKind(data);
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (d === "application/msword") return "application/msword";
    if (d === "application/vnd.ms-excel") return "application/vnd.ms-excel";
    return "application/x-ole-storage";
  }
  if (data.length > 0 && isUtf8Text(data)) {
    const text = data.subarray(0, Math.min(data.length, 64 * 1024)).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(text)) return "image/svg+xml";
    if (/^(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>])/.test(text) || /<script[\s>]/.test(text)) return "text/html";
    if (text.startsWith("<?xml") || (d.endsWith("/xml") && text.startsWith("<"))) return "application/xml";
    if (d === "text/csv") return "text/csv";
    return "text/plain";
  }
  return "application/octet-stream";
}

/**
 * SVG apto para servirse como recurso público: se rechaza cualquier construcción que permita
 * ejecutar código o cargar recursos externos. No reescribe el fichero: lo acepta o lo rechaza.
 */
export function isSafeSvg(data: Buffer): boolean {
  const s = data.toString("utf8").toLowerCase();
  if (s.length > 2 * 1024 * 1024) return false;
  const forbidden = [
    /<script[\s>/]/,
    /<!entity/,
    /<!doctype[^>]*\[/,
    /<foreignobject[\s>/]/,
    /<(iframe|embed|object|audio|video|link|meta|base|form|input|button|textarea|frame|frameset|applet|portal)[\s>/]/,
    /\son[a-z]+\s*=/,
    /javascript\s*:/,
    /vbscript\s*:/,
    /data\s*:\s*text\/html/,
    /@import/,
    /<\s*(set|animate)[^>]*attributename\s*=\s*["']?(href|xlink:href|on)/,
  ];
  if (forbidden.some((r) => r.test(s))) return false;
  // Referencias: solo internas (#id) o imágenes embebidas en base64
  for (const m of Array.from(s.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/g))) {
    const v = m[1].trim();
    if (!(v.startsWith("#") || /^data:image\/(png|jpeg|gif|webp);base64,/.test(v))) return false;
  }
  for (const m of Array.from(s.matchAll(/url\(\s*["']?([^"')]*)/g))) {
    if (!m[1].trim().startsWith("#")) return false;
  }
  return true;
}

/**
 * Nombre de fichero seguro para cabeceras y rutas: sin separadores de ruta, `..`, caracteres de
 * control ni comillas. Solo para mostrar (Content-Disposition); nunca forma parte de la clave.
 */
export function safeDisplayName(name: unknown, fallback = "fichero"): string {
  const base = String(name ?? "")
    .normalize("NFC")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return base || fallback;
}
