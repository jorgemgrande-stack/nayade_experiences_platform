import { Router, Request, Response } from "express";
import multer from "multer";
import { storagePut } from "./storage";
import { sdk } from "./_core/sdk";
import { createMediaFile } from "./db";
import { getUserFromRequest } from "./localAuth";

const USE_LOCAL_AUTH = process.env.LOCAL_AUTH === "true";

const router = Router();

// Multer configurado para almacenar en memoria (buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB máximo
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/webp",
      "image/gif", "image/svg+xml", "image/avif",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de archivo no permitido. Solo se aceptan imágenes (JPEG, PNG, WebP, GIF, SVG, AVIF)."));
    }
  },
});

// Middleware de autenticación admin reutilizable
async function requireAdmin(req: Request, res: Response, next: () => void) {
  try {
    if (USE_LOCAL_AUTH) {
      const user = await getUserFromRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
        return;
      }
      (req as Request & { adminUser: typeof user }).adminUser = user;
    } else {
      const user = await sdk.authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
        return;
      }
      (req as Request & { adminUser: typeof user }).adminUser = user;
    }
    next();
  } catch {
    res.status(401).json({ error: "No autenticado." });
  }
}

// POST /api/upload/image — sube una imagen a S3, la registra en media_files y devuelve la URL
router.post(
  "/api/upload/image",
  (req, res, next) => requireAdmin(req, res, next),
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No se recibió ningún archivo." });
        return;
      }

      const { buffer, mimetype, originalname, size } = req.file;
      const ext = originalname.split(".").pop() || "jpg";
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const key = `nayade/uploads/${timestamp}-${random}.${ext}`;

      const { url } = await storagePut(key, buffer, mimetype);

      // Registrar en la base de datos de multimedia
      const adminUser = (req as Request & { adminUser?: { id: number } }).adminUser;
      const mediaRecord = await createMediaFile({
        filename: `${timestamp}-${random}.${ext}`,
        originalName: originalname,
        url,
        fileKey: key,
        mimeType: mimetype,
        size: size,
        type: "image",
        uploadedBy: adminUser?.id,
      });

      res.json({ url, key, filename: originalname, id: mediaRecord.id });
    } catch (err: unknown) {
      console.error("[Upload] Error:", err);
      const message = err instanceof Error ? err.message : "Error al subir la imagen";
      res.status(500).json({ error: message });
    }
  }
);

// POST /api/upload/media — alias para compatibilidad con MultimediaManager antiguo
router.post(
  "/api/upload-media",
  (req, res, next) => requireAdmin(req, res, next),
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No se recibió ningún archivo." });
        return;
      }

      const { buffer, mimetype, originalname, size } = req.file;
      const ext = originalname.split(".").pop() || "jpg";
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const key = `nayade/uploads/${timestamp}-${random}.${ext}`;

      const { url } = await storagePut(key, buffer, mimetype);

      const adminUser = (req as Request & { adminUser?: { id: number } }).adminUser;
      const mediaRecord = await createMediaFile({
        filename: `${timestamp}-${random}.${ext}`,
        originalName: originalname,
        url,
        fileKey: key,
        mimeType: mimetype,
        size: size,
        type: "image",
        uploadedBy: adminUser?.id,
      });

      res.json({ url, key, filename: originalname, id: mediaRecord.id });
    } catch (err: unknown) {
      console.error("[Upload] Error:", err);
      const message = err instanceof Error ? err.message : "Error al subir la imagen";
      res.status(500).json({ error: message });
    }
  }
);

export default router;
