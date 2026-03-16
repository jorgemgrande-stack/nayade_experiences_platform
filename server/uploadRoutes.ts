import { Router, Request, Response } from "express";
import multer from "multer";
import { storagePut } from "./storage";
import { sdk } from "./_core/sdk";

const router = Router();

// Multer configurado para almacenar en memoria (buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB máximo
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de archivo no permitido. Solo se aceptan imágenes (JPEG, PNG, WebP, GIF, SVG)."));
    }
  },
});

// POST /api/upload/image — sube una imagen a S3 y devuelve la URL pública
router.post(
  "/api/upload/image",
  async (req: Request, res: Response, next) => {
    // Verificar sesión de admin
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: "No autenticado." });
    }
  },
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No se recibió ningún archivo." });
        return;
      }

      const { buffer, mimetype, originalname } = req.file;
      const ext = originalname.split(".").pop() || "jpg";
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const key = `nayade/uploads/${timestamp}-${random}.${ext}`;

      const { url } = await storagePut(key, buffer, mimetype);

      res.json({ url, key, filename: originalname });
    } catch (err: unknown) {
      console.error("[Upload] Error:", err);
      const message = err instanceof Error ? err.message : "Error al subir la imagen";
      res.status(500).json({ error: message });
    }
  }
);

export default router;
