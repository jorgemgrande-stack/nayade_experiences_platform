/**
 * Elephant LMS: entrega y subida de recursos del curso.
 *
 *  GET  /api/learning/resource/:id   El alumno abre un recurso (vídeo, audio, PDF) SOLO si una matrícula suya, activa y en
 *                                    ventana, abre el módulo donde se usa. Sin sesión → 401; sin matrícula → 403; recurso
 *                                    sin fichero verificado → 404. Con STORAGE_PRIVATE_DELIVERY=redirect responde con una
 *                                    URL prefirmada de ≤ 300 s (S3 sirve los rangos); si no, el Core lo envía. Nunca
 *                                    cacheable (`private, no-store`), sin indexar y sin referer. Cada apertura queda en el
 *                                    historial de la matrícula. `?download=1` solo vale para PDF y documentos.
 *  POST /api/learning/upload/:id     La administración sube el fichero de un recurso pendiente (admin; el tipo se detecta por
 *                                    el contenido). Streaming a disco (sin cargarlo en memoria), huella SHA-256, aviso de
 *                                    duplicados y verificación del recurso.
 *
 * No hay URLs permanentes: ni el recurso ni su fichero se pueden abrir sin sesión y matrícula vigentes.
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSessionUser } from "./_core/expressAuth";
import { getTenantMode, peekTenantContext } from "./_core/tenant";
import { fileService, objectStorageEnabled, StorageUnavailableError } from "./_core/files/service";
import { FileValidationError } from "./_core/files/service";
import { safeDisplayName } from "./_core/files/contentType";
import { CATEGORIES } from "./_core/files/categories";
import { learningStorageLimit } from "./_core/files/limits";
import { checkUpload } from "../shared/learningMaterials";
import { previewFile, stageFile } from "./learningMaterials";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { LearningError, attachResourceFile, authorizePreviewResource, authorizeResource, isMissingLearningSchema, logPreviewAccess, logResourceOpened } from "./learningDb";

const router = Router();
const ID_RE = /^[1-9]\d{0,9}$/;
const tenantReady = () => getTenantMode() !== "multi" || !!peekTenantContext()?.tenantId;

function deny(res: Response, status: number, message: string) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: message });
}

function privateHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

const disposition = (name: string, inline: boolean) => {
  const safe = safeDisplayName(name, "recurso");
  return `${inline ? "inline" : "attachment"}; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
};

/**
 * Entrega de un recurso ya AUTORIZADO (la comprobación va siempre antes, en cada ruta). Con STORAGE_PRIVATE_DELIVERY=redirect
 * responde con una URL prefirmada de ≤ 300 s; si no, el Core lo envía en streaming. Nunca cacheable ni con URL permanente.
 */
async function sendResource(
  req: Request,
  res: Response,
  r: { objectId: string; kind: string; resourceId: number; originalName: string | null },
  log: (via: "stream" | "redirect" | "download") => Promise<void>,
) {
  const row = await fileService().find(r.objectId);
  if (!row) return deny(res, 404, "Recurso no encontrado.");
  const downloadable = r.kind === "pdf" || r.kind === "document";
  const wantsDownload = req.query.download === "1" && downloadable;
  const name = r.originalName ?? `${r.kind}-${r.resourceId}`;
  const backend = fileService().storage;
  if (process.env.STORAGE_PRIVATE_DELIVERY === "redirect" && backend.presign) {
    const ttl = Math.min(Math.max(Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS) || 60, 5), 300);
    const url = await backend.presign(row.storageKey, ttl, { contentType: row.contentType, disposition: disposition(name, !wantsDownload) });
    await log(wantsDownload ? "download" : "redirect");
    return res.redirect(302, url);
  }
  const s = await fileService().openStream(row.objectId);
  await log(wantsDownload ? "download" : "stream");
  res.setHeader("Content-Type", row.contentType);
  res.setHeader("Content-Disposition", disposition(name, !wantsDownload));
  res.setHeader("Content-Length", String(row.sizeBytes));
  if (s) {
    s.stream.on("error", () => res.destroy());
    return void s.stream.pipe(res.status(200));
  }
  const rd = await fileService().read(row.objectId);
  if (!rd) return deny(res, 404, "Recurso no encontrado.");
  res.status(200).end(rd.data);
}

function failure(res: Response, err: unknown) {
  if (isMissingLearningSchema(err)) return deny(res, 404, "Recurso no encontrado.");
  if (err instanceof StorageUnavailableError) {
    res.setHeader("Retry-After", "30");
    return deny(res, 503, "El almacenamiento no está disponible. Inténtalo más tarde.");
  }
  console.error(JSON.stringify({ ctx: "Learning", event: "resource_error", error: err instanceof Error ? err.name : "error" }));
  if (!res.headersSent) deny(res, 500, "No se pudo servir el recurso.");
}

router.get("/api/learning/resource/:id", async (req: Request, res: Response, next) => {
  if (!objectStorageEnabled()) return next();
  privateHeaders(res);
  const idText = String(req.params.id ?? "");
  if (!ID_RE.test(idText) || !tenantReady()) return deny(res, 404, "Recurso no encontrado.");
  try {
    const user = await resolveSessionUser(req);
    if (!user || user.isActive === false) return deny(res, 401, "No autenticado.");
    const auth = await authorizeResource(Number(user.id), Number(idText));
    if (!auth.allowed) {
      if (auth.reason === "not_available") return deny(res, 404, "Recurso no encontrado.");
      return deny(res, 403, auth.reason === "expired" ? "Tu acceso a este curso ha caducado." : "No tienes acceso a este recurso.");
    }
    await sendResource(req, res, auth, (via) => logResourceOpened(auth.enrollmentId, auth.resourceId, Number(user.id), via));
  } catch (err) {
    failure(res, err);
  }
});

/**
 * Vista previa de administración: GET /api/learning/preview/resource/:id. SOLO administradores de la empresa en curso (sesión
 * real; sin sesión → 401, otro rol → 403). Cada apertura queda en el registro de auditoría. No es una URL pública ni permanente:
 * usa la misma entrega privada (prefirmada ≤ 300 s o streaming). No sirve ficheros sin bloque de curso ni sin verificar.
 */
router.get("/api/learning/preview/resource/:id", async (req: Request, res: Response, next) => {
  if (!objectStorageEnabled()) return next();
  privateHeaders(res);
  const idText = String(req.params.id ?? "");
  if (!ID_RE.test(idText) || !tenantReady()) return deny(res, 404, "Recurso no encontrado.");
  try {
    const user = await resolveSessionUser(req);
    if (!user || user.isActive === false) return deny(res, 401, "No autenticado.");
    if (String(user.role) !== "admin") return deny(res, 403, "Solo la administración puede usar la vista previa.");
    const auth = await authorizePreviewResource(Number(idText));
    if (!auth.allowed) return deny(res, 404, "Recurso no encontrado.");
    await sendResource(req, res, auth, (via) => logPreviewAccess(Number(user.id), "resource", { resourceId: auth.resourceId, kind: auth.kind, via }));
  } catch (err) {
    failure(res, err);
  }
});

// ── Subida de la administración ─────────────────────────────────────────────────────────────────────────────────────

const MAX = CATEGORIES["learning-content"].maxBytes;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => mkdtemp(path.join(tmpdir(), "learning-")).then((d) => cb(null, d), (e) => cb(e, "")),
    filename: (_req, _file, cb) => cb(null, "upload.bin"),
  }),
  limits: { fileSize: MAX, files: 1 },
});

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve()).on("error", reject));
  return h.digest("hex");
}

router.post("/api/learning/upload/:id", (req: Request, res: Response, next) => {
  if (!objectStorageEnabled()) return next();
  privateHeaders(res);
  const idText = String(req.params.id ?? "");
  if (!ID_RE.test(idText) || !tenantReady()) return deny(res, 404, "Recurso no encontrado.");
  resolveSessionUser(req)
    .then((user) => {
      if (!user || user.isActive === false) return deny(res, 401, "No autenticado.");
      if (String(user.role) !== "admin") return deny(res, 403, "Solo la administración puede subir recursos.");
      upload.single("file")(req, res, async (err?: unknown) => {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        const cleanup = async () => { if (file?.destination) await rm(file.destination, { recursive: true, force: true }).catch(() => undefined); };
        try {
          if (err) return deny(res, err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? "El fichero supera el tamaño máximo permitido." : "Archivo no válido.");
          if (!file) return deny(res, 400, "No se recibió ningún archivo.");
          const sizeBytes = (await stat(file.path)).size;
          const sha256 = await sha256File(file.path);
          const stored = await fileService().putFile({ category: "learning-content", filePath: file.path, sizeBytes, sha256, detectType: true, declaredType: file.mimetype, originalName: file.originalname, uploadedBy: Number(user.id) });
          const attached = await attachResourceFile(Number(idText), { objectId: stored.objectId, sha256, sizeBytes, mimeType: stored.contentType, originalName: file.originalname ? safeDisplayName(file.originalname) : null }, Number(user.id));
          res.json({ ok: true, resourceId: attached.resourceId, contentType: stored.contentType, sizeBytes, sha256, duplicateOf: attached.duplicateOf });
        } catch (e) {
          if (e instanceof FileValidationError) return deny(res, 400, e.message);
          if (e instanceof LearningError) return deny(res, e.code === "NOT_FOUND" ? 404 : 400, e.message);
          if (e instanceof StorageUnavailableError) return deny(res, 503, "El almacenamiento no está disponible. Inténtalo más tarde.");
          if (isMissingLearningSchema(e)) return deny(res, 404, "La formación digital no está activada.");
          console.error(JSON.stringify({ ctx: "Learning", event: "upload_error", error: e instanceof Error ? e.name : "error" }));
          if (!res.headersSent) deny(res, 500, "No se pudo subir el fichero.");
        } finally {
          await cleanup();
        }
      });
    })
    .catch(() => deny(res, 401, "No autenticado."));
});

// ── Materiales (lote 2): subir un fichero NUEVO sin tocar el vigente ─────────────────────────────────────────────────

/** Tipo del recurso, para validar antes de almacenar. */
async function resourceKind(id: number): Promise<string | null> {
  const d = await getDb();
  if (!d) return null;
  const [r] = (await d.execute(sql`SELECT kind FROM learning_resources WHERE id = ${id}`)) as unknown as [Array<{ kind: string }>];
  return r?.[0]?.kind ?? null;
}

/**
 * POST /api/learning/materials/:id/stage — administrador. Guarda el fichero como «pendiente de publicar» (no cambia lo que ven
 * los alumnos). Valida tipo, tamaño y cuota ANTES de almacenar y responde con un código estable para que la pantalla explique el fallo.
 */
router.post("/api/learning/materials/:id/stage", (req: Request, res: Response, next) => {
  if (!objectStorageEnabled()) return next();
  privateHeaders(res);
  const idText = String(req.params.id ?? "");
  if (!ID_RE.test(idText) || !tenantReady()) return deny(res, 404, "Recurso no encontrado.");
  resolveSessionUser(req)
    .then((user) => {
      if (!user || user.isActive === false) return deny(res, 401, "No autenticado.");
      if (String(user.role) !== "admin") return deny(res, 403, "Solo la administración puede subir materiales.");
      upload.single("file")(req, res, async (err?: unknown) => {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        const cleanup = async () => { if (file?.destination) await rm(file.destination, { recursive: true, force: true }).catch(() => undefined); };
        try {
          if (err) return deny(res, err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? "El fichero supera el tamaño máximo permitido." : "Archivo no válido.");
          if (!file) return deny(res, 400, "No se recibió ningún archivo.");
          const kind = await resourceKind(Number(idText));
          if (!kind) return deny(res, 404, "Recurso no encontrado.");
          const sizeBytes = (await stat(file.path)).size;
          const [used, limit] = await Promise.all([fileService().meta.usedBytes?.("learning") ?? Promise.resolve(0), learningStorageLimit()]);
          const check = checkUpload({ kind, mimeType: file.mimetype, sizeBytes, maxBytes: MAX, usedBytes: Number(used ?? 0), limitGb: limit?.limitGb ?? null });
          if (!check.ok) return res.status(check.problem === "TOO_LARGE" ? 413 : check.problem === "WRONG_TYPE" || check.problem === "EMPTY" ? 400 : 409).json({ ok: false, problem: check.problem, error: check.message });
          const sha256 = await sha256File(file.path);
          const stored = await fileService().putFile({ category: "learning-content", filePath: file.path, sizeBytes, sha256, detectType: true, declaredType: file.mimetype, originalName: file.originalname, uploadedBy: Number(user.id) });
          const staged = await stageFile(Number(idText), { objectId: stored.objectId, sha256, sizeBytes, mimeType: stored.contentType, originalName: file.originalname ? safeDisplayName(file.originalname) : null }, Number(user.id));
          res.json({ ok: true, fileId: staged.fileId, contentType: stored.contentType, sizeBytes, sha256, duplicateOf: staged.duplicateOf });
        } catch (e) {
          if (e instanceof FileValidationError) return res.status(400).json({ ok: false, problem: "WRONG_TYPE", error: e.message });
          if (e instanceof LearningError) return deny(res, e.code === "NOT_FOUND" ? 404 : 400, e.message);
          if (e instanceof StorageUnavailableError) return deny(res, 503, "El almacenamiento no está disponible. Inténtalo más tarde.");
          if (isMissingLearningSchema(e)) return deny(res, 404, "La formación digital no está activada.");
          console.error(JSON.stringify({ ctx: "Learning", event: "stage_error", error: e instanceof Error ? e.name : "error" }));
          if (!res.headersSent) deny(res, 500, "No se pudo subir el fichero.");
        } finally {
          await cleanup();
        }
      });
    })
    .catch(() => deny(res, 401, "No autenticado."));
});

/** GET /api/learning/preview/file/:fileId — administrador: reproduce un fichero pendiente o sustituido antes de publicarlo/recuperarlo. Auditado. */
router.get("/api/learning/preview/file/:fileId", async (req: Request, res: Response, next) => {
  if (!objectStorageEnabled()) return next();
  privateHeaders(res);
  const idText = String(req.params.fileId ?? "");
  if (!ID_RE.test(idText) || !tenantReady()) return deny(res, 404, "Fichero no encontrado.");
  try {
    const user = await resolveSessionUser(req);
    if (!user || user.isActive === false) return deny(res, 401, "No autenticado.");
    if (String(user.role) !== "admin") return deny(res, 403, "Solo la administración puede usar la vista previa.");
    const f = await previewFile(Number(idText));
    if (!f) return deny(res, 404, "Fichero no encontrado.");
    await sendResource(req, res, { resourceId: Number(idText), objectId: f.objectId, kind: f.kind, originalName: f.originalName }, (via) => logPreviewAccess(Number(user.id), "resource", { fileId: Number(idText), kind: f.kind, via }));
  } catch (err) {
    failure(res, err);
  }
});

export default router;
