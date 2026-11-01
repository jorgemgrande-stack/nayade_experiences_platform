/**
 * Imágenes oficiales del marketplace (fichas, campañas y cabeceras), subidas desde el CRM.
 *
 *  - Se guardan en la BD del CRM (migración 0042): no hace falta bucket ni variables nuevas. Son pocas y acotadas.
 *  - Id = huella del contenido original: subir dos veces la misma imagen no duplica nada.
 *  - Se sirven solo variantes optimizadas (WebP y AVIF a 480, 960, 1600 y 2400 px, sin ampliar), inmutables, por
 *    `GET /cp/v1/public/media/:id/:variant` con caché de un año: la URL es estable y no cambia nunca su contenido.
 *    Sustituir una imagen = subir otra y cambiar la referencia en la ficha (la anterior sigue sirviéndose).
 *  - Texto alternativo obligatorio. Solo JPEG, PNG, WebP o AVIF reales (se comprueba el contenido, no el nombre).
 *  - Borrado seguro: solo si ningún borrador ni publicación del catálogo la usa.
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import type mysql from "mysql2/promise";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import type { WebStore } from "./store";

export const MEDIA_WIDTHS = [480, 960, 1600, 2400] as const;
export const MEDIA_FORMATS = ["webp", "avif"] as const;
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MIN_WIDTH = 320;
const ID_RE = /^[a-f0-9]{32}$/;
const VARIANT_RE = /^w(480|960|1600|2400)\.(webp|avif)$/;

export interface MediaRecord {
  id: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
  createdBy: string;
}
export interface MediaFile {
  variant: string;
  contentType: string;
  width: number;
  data: Buffer;
}

export interface MediaStore {
  get(id: string): Promise<MediaRecord | null>;
  list(): Promise<MediaRecord[]>;
  /** Inserta la imagen y sus variantes; si ya existe (misma huella), no cambia nada. */
  insert(m: MediaRecord, files: MediaFile[]): Promise<{ created: boolean }>;
  file(id: string, variant: string): Promise<Pick<MediaFile, "contentType" | "data"> | null>;
  setAlt(id: string, alt: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export class MemoryMediaStore implements MediaStore {
  rows = new Map<string, { m: MediaRecord; files: MediaFile[] }>();
  async get(id: string) {
    return this.rows.get(id)?.m ?? null;
  }
  async list() {
    return Array.from(this.rows.values()).map((r) => r.m).sort((a, b) => b.createdAt - a.createdAt);
  }
  async insert(m: MediaRecord, files: MediaFile[]) {
    if (this.rows.has(m.id)) return { created: false };
    this.rows.set(m.id, { m: { ...m }, files });
    return { created: true };
  }
  async file(id: string, variant: string) {
    const f = this.rows.get(id)?.files.find((x) => x.variant === variant);
    return f ? { contentType: f.contentType, data: f.data } : null;
  }
  async setAlt(id: string, alt: string) {
    const r = this.rows.get(id);
    if (!r) return false;
    r.m.alt = alt;
    return true;
  }
  async delete(id: string) {
    return this.rows.delete(id);
  }
}

export class MysqlMediaStore implements MediaStore {
  constructor(private pool: mysql.Pool) {}
  private map(r: mysql.RowDataPacket): MediaRecord {
    return { id: r.id, alt: r.alt, width: Number(r.width), height: Number(r.height), bytes: Number(r.bytes), createdAt: Number(r.created_at), createdBy: r.created_by };
  }
  async get(id: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM marketplace_media WHERE id = ?", [id]);
    return rows[0] ? this.map(rows[0]) : null;
  }
  async list() {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM marketplace_media ORDER BY created_at DESC LIMIT 1000");
    return rows.map((r) => this.map(r));
  }
  async insert(m: MediaRecord, files: MediaFile[]) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [res] = await c.query<mysql.ResultSetHeader>(
        "INSERT IGNORE INTO marketplace_media (id, alt, width, height, bytes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [m.id, m.alt, m.width, m.height, m.bytes, m.createdAt, m.createdBy],
      );
      if (res.affectedRows === 0) {
        await c.rollback();
        return { created: false };
      }
      for (const f of files) await c.query("INSERT INTO marketplace_media_files (media_id, variant, content_type, width, data) VALUES (?, ?, ?, ?, ?)", [m.id, f.variant, f.contentType, f.width, f.data]);
      await c.commit();
      return { created: true };
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  async file(id: string, variant: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT content_type, data FROM marketplace_media_files WHERE media_id = ? AND variant = ?", [id, variant]);
    return rows[0] ? { contentType: String(rows[0].content_type), data: rows[0].data as Buffer } : null;
  }
  async setAlt(id: string, alt: string) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>("UPDATE marketplace_media SET alt = ? WHERE id = ?", [alt, id]);
    return res.affectedRows > 0;
  }
  async delete(id: string) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>("DELETE FROM marketplace_media WHERE id = ?", [id]);
    return res.affectedRows > 0;
  }
}

export class MediaError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "in_use",
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Formato real por la firma del fichero (nunca por el nombre ni por la cabecera del navegador). */
export function sniffImage(b: Buffer): "jpeg" | "png" | "webp" | "avif" | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (b.toString("ascii", 4, 8) === "ftyp" && /^avi[fs]/.test(b.toString("ascii", 8, 12))) return "avif";
  return null;
}

const altText = z.string().trim().min(1, "el texto alternativo es obligatorio").max(160);

/** Convierte con sharp (carga diferida: solo el plano de control la usa, y solo al subir). */
export type ImageEncoder = (input: Buffer) => Promise<{ width: number; height: number; files: MediaFile[] }>;
export const sharpEncoder: ImageEncoder = async (input) => {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(input, { failOn: "error" }).metadata();
  if (!meta.width || !meta.height) throw new MediaError("invalid_input", "No se pudo leer la imagen");
  const files: MediaFile[] = [];
  for (const w of MEDIA_WIDTHS) {
    // Sin ampliar: si la original es más pequeña, la variante se queda a su tamaño (sin metadatos EXIF ni GPS)
    const base = sharp(input).rotate().resize({ width: w, withoutEnlargement: true });
    const webp = await base.clone().webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    files.push({ variant: `w${w}.webp`, contentType: "image/webp", width: webp.info.width, data: webp.data });
    const avif = await base.clone().avif({ quality: 55 }).toBuffer({ resolveWithObject: true });
    files.push({ variant: `w${w}.avif`, contentType: "image/avif", width: avif.info.width, data: avif.data });
  }
  const oriented = meta.orientation && meta.orientation >= 5;
  return { width: oriented ? meta.height : meta.width, height: oriented ? meta.width : meta.height, files };
};

/** URL pública de una variante (base: el origen público del plano de control, p. ej. https://admin.bigelephant.es). */
export const mediaUrl = (base: string, id: string, variant = "w1600.webp") => `${base.replace(/\/$/, "")}/cp/v1/public/media/${id}/${variant}`;
/** Id de una URL del almacén (o null si la imagen es de otro sitio). */
export function mediaIdFromUrl(src: string): string | null {
  const m = /\/cp\/v1\/public\/media\/([a-f0-9]{32})\/w\d+\.(webp|avif)$/.exec(src);
  return m ? m[1] : null;
}
/** srcset de una URL del almacén por formato (anchos nominales), o null si no es del almacén. */
export function mediaSrcset(src: string): { webp: string; avif: string } | null {
  const id = mediaIdFromUrl(src);
  if (!id) return null;
  const base = src.slice(0, src.indexOf(`/cp/v1/public/media/`));
  const set = (f: string) => MEDIA_WIDTHS.map((w) => `${mediaUrl(base, id, `w${w}.${f}`)} ${w}w`).join(", ");
  return { webp: set("webp"), avif: set("avif") };
}

export class MediaService {
  constructor(private d: { store: MediaStore; web: Pick<WebStore, "listEntries">; encode?: ImageEncoder; now?: () => number }) {}

  async upload(input: { data: Buffer; alt: string; author: string }): Promise<{ media: MediaRecord; created: boolean }> {
    const alt = altText.safeParse(input.alt);
    if (!alt.success) throw new MediaError("invalid_input", alt.error.issues[0].message);
    if (input.data.length > MAX_UPLOAD_BYTES) throw new MediaError("invalid_input", "La imagen supera 12 MB");
    if (!sniffImage(input.data)) throw new MediaError("invalid_input", "Solo imágenes JPEG, PNG, WebP o AVIF");
    const id = crypto.createHash("sha256").update(input.data).digest("hex").slice(0, 32);
    const existing = await this.d.store.get(id);
    if (existing) return { media: existing, created: false };
    let out: Awaited<ReturnType<ImageEncoder>>;
    try {
      out = await (this.d.encode ?? sharpEncoder)(input.data);
    } catch (e) {
      if (e instanceof MediaError) throw e;
      throw new MediaError("invalid_input", "La imagen está dañada o no se puede procesar");
    }
    if (out.width < MIN_WIDTH) throw new MediaError("invalid_input", `La imagen debe medir al menos ${MIN_WIDTH} px de ancho`);
    const media: MediaRecord = { id, alt: alt.data, width: out.width, height: out.height, bytes: input.data.length, createdAt: (this.d.now ?? Date.now)(), createdBy: input.author.slice(0, 100) };
    const r = await this.d.store.insert(media, out.files);
    return { media: r.created ? media : ((await this.d.store.get(id)) ?? media), created: r.created };
  }

  list() {
    return this.d.store.list();
  }

  async setAlt(id: string, alt: string) {
    const a = altText.safeParse(alt);
    if (!a.success) throw new MediaError("invalid_input", a.error.issues[0].message);
    if (!(await this.d.store.setAlt(id, a.data))) throw new MediaError("not_found", "Imagen no encontrada");
  }

  /** Dónde se usa una imagen: entradas del catálogo cuyo borrador o publicación la referencian. */
  async usage(id: string): Promise<string[]> {
    const entries = await this.d.web.listEntries();
    return entries.filter((e) => JSON.stringify([e.draft, e.published]).includes(`/cp/v1/public/media/${id}/`)).map((e) => `${e.kind}:${e.key}`);
  }

  async delete(id: string) {
    if (!(await this.d.store.get(id))) throw new MediaError("not_found", "Imagen no encontrada");
    const used = await this.usage(id);
    if (used.length) throw new MediaError("in_use", `La imagen se usa en: ${used.join(", ")}`, { usedBy: used });
    await this.d.store.delete(id);
  }
}

const STATUS = { invalid_input: 400, not_found: 404, in_use: 409 } as const;
const fail = (res: Response, e: unknown) => {
  if (e instanceof MediaError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
  opsLog("error", "Web", "media_failed", { error: e instanceof Error ? e.name : "error" });
  res.status(500).json({ error: "internal_error", message: "Error interno" });
};

/** Origen público del plano de control para construir URLs (detrás de la pasarela: https y su host). */
const publicBase = (req: Request) => `https://${req.get("host")}`;
const view = (base: string, m: MediaRecord) => ({ ...m, src: mediaUrl(base, m.id), srcset: mediaSrcset(mediaUrl(base, m.id)) });

/** Rutas del CRM (montar bajo /web/media): subir, listar, cambiar el texto alternativo y borrar si no se usa. */
export function createMediaAdminRouter(svc: MediaService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  r.get("/", requireScope("web:read"), (req, res) => {
    svc.list().then((items) => res.json({ items: items.map((m) => view(publicBase(req), m)) }), (e) => fail(res, e));
  });
  // Cuerpo binario (image/*) con el texto alternativo en ?alt=
  r.post("/", requireScope("web:write"), express.raw({ type: ["image/*", "application/octet-stream"], limit: MAX_UPLOAD_BYTES }), (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    svc.upload({ data, alt: String(req.query.alt ?? ""), author: who(req) }).then(
      ({ media, created }) => res.status(created ? 201 : 200).json({ media: view(publicBase(req), media), created }),
      (e) => fail(res, e),
    );
  });
  r.get("/:id/usage", requireScope("web:read"), (req, res) => {
    if (!ID_RE.test(req.params.id)) return void res.status(400).json({ error: "invalid_input", message: "id" });
    svc.usage(req.params.id).then((usedBy) => res.json({ usedBy }), (e) => fail(res, e));
  });
  r.patch("/:id", requireScope("web:write"), express.json({ limit: "4kb" }), (req, res) => {
    if (!ID_RE.test(req.params.id)) return void res.status(400).json({ error: "invalid_input", message: "id" });
    svc.setAlt(req.params.id, String((req.body as { alt?: unknown })?.alt ?? "")).then(() => res.json({ ok: true }), (e) => fail(res, e));
  });
  r.delete("/:id", requireScope("web:write"), (req, res) => {
    if (!ID_RE.test(req.params.id)) return void res.status(400).json({ error: "invalid_input", message: "id" });
    svc.delete(req.params.id).then(() => res.status(204).end(), (e) => fail(res, e));
  });
  return r;
}

/** Entrega pública (montar bajo /public/media): solo variantes optimizadas, inmutables y con caché de un año. */
export function createPublicMediaRouter(store: Pick<MediaStore, "file">): Router {
  const r = express.Router();
  r.get("/:id/:variant", (req, res) => {
    const { id, variant } = req.params;
    if (!ID_RE.test(id) || !VARIANT_RE.test(variant)) return void res.status(404).end();
    store.file(id, variant).then(
      (f) => {
        if (!f) return void res.status(404).setHeader("Cache-Control", "no-store").end();
        res.setHeader("Content-Type", f.contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Content-Security-Policy", "default-src 'none'");
        res.end(f.data);
      },
      () => res.status(503).setHeader("Cache-Control", "no-store").end(),
    );
  });
  return r;
}
