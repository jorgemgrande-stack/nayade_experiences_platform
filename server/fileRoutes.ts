/**
 * Entrega de ficheros del servicio de almacenamiento (server/_core/files/service.ts).
 *
 *  GET    /files/<id>/<nombre>  PÚBLICOS AUTORIZADOS de la empresa del host (sin sesión, con caché).
 *                               Un objeto privado, de otra empresa o inexistente responde 404. No hay
 *                               listado.
 *  GET    /api/files/<id>       PRIVADOS: sesión válida de la empresa del host (la cookie va ligada a la
 *                               empresa), usuario activo y permiso de la categoría; o enlace firmado del
 *                               Core vigente (`?exp=…&sig=…`, ligado a empresa y objeto). Se sirve a
 *                               través del Core o, con STORAGE_PRIVATE_DELIVERY=redirect, con una URL
 *                               prefirmada del proveedor de duración corta.
 *  DELETE /api/files/<id>       Borrado autorizado (permiso de la categoría; nunca «solo lectura»).
 *
 * La empresa es la del host (resolución del registro): los metadatos se buscan en SU base de datos, así
 * que un id de otra empresa simplemente no existe aquí.
 */
import { Router, type Request, type Response } from "express";
import { resolveSessionUser } from "./_core/expressAuth";
import { checkRbacOrLegacy } from "./_core/rbac";
import { getTenantMode, peekTenantContext } from "./_core/tenant";
import { policyOf } from "./_core/files/categories";
import { INLINE_SAFE, extensionFor, safeDisplayName } from "./_core/files/contentType";
import {
  fileService,
  objectStorageEnabled,
  OBJECT_ID_RE,
  StorageUnavailableError,
  verifySignedLink,
} from "./_core/files/service";
import type { StoredObjectRow } from "./storedObjectsDb";
import { legacyPool } from "./_core/legacyDb";
import { getCompanyOwnerEmail } from "./_core/companyOwner";
import { MysqlDataExportStore } from "./dataExport/service";

const router = Router();

function tenantReady(): boolean {
  return getTenantMode() !== "multi" || !!peekTenantContext()?.tenantId;
}

function disposition(row: StoredObjectRow, inline: boolean): string {
  const name = safeDisplayName(row.originalName, `${row.category}-${row.objectId.slice(0, 8)}.${extensionFor(row.contentType)}`);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function commonHeaders(res: Response, row: StoredObjectRow) {
  res.setHeader("Content-Type", row.contentType === "text/html" ? "text/html; charset=utf-8" : row.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("ETag", `"${row.sha256}"`);
  if (row.contentType === "image/svg+xml" || row.contentType === "text/html") {
    // Sin scripts ni recursos externos aunque se abra directamente en el navegador
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:");
  }
}

function unavailable(res: Response) {
  res.setHeader("Retry-After", "30");
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json({ error: "El almacenamiento de ficheros no está disponible. Inténtalo más tarde." });
}

/** Por encima de este tamaño (o siempre en una exportación de datos) el fichero se sirve en streaming. */
const STREAM_FROM_BYTES = 16 * 1024 * 1024;

async function send(res: Response, row: StoredObjectRow, cacheControl: string, inline: boolean) {
  if (row.category === "data-export" || row.sizeBytes > STREAM_FROM_BYTES) {
    const s = await fileService().openStream(row.objectId);
    if (s) {
      commonHeaders(res, row);
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("Content-Disposition", disposition(row, inline));
      res.setHeader("Content-Length", String(row.sizeBytes));
      res.status(200);
      s.stream.on("error", () => res.destroy());
      s.stream.pipe(res);
      return;
    }
  }
  const r = await fileService().read(row.objectId);
  if (!r) {
    res.status(404).end();
    return;
  }
  commonHeaders(res, row);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Disposition", disposition(row, inline));
  res.setHeader("Content-Length", String(r.data.length));
  res.status(200).end(r.data);
}

// ── Públicos ────────────────────────────────────────────────────────────────

router.get(["/files/:id", "/files/:id/:name"], async (req: Request, res: Response, next) => {
  const id = String(req.params.id ?? "");
  if (!objectStorageEnabled() || !OBJECT_ID_RE.test(id)) return next();
  if (!tenantReady()) return res.status(404).end();
  try {
    const row = await fileService().find(id);
    if (!row || row.visibility !== "public") return res.status(404).end();
    const maxAge = Number(process.env.STORAGE_PUBLIC_CACHE_SECONDS) || 86_400;
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.headers["if-none-match"] === `"${row.sha256}"`) {
      res.setHeader("ETag", `"${row.sha256}"`);
      res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
      return res.status(304).end();
    }
    await send(res, row, `public, max-age=${maxAge}`, true);
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable(res);
    console.error(JSON.stringify({ ctx: "Storage", event: "public_get_error", error: err instanceof Error ? err.name : "error" }));
    if (!res.headersSent) res.status(500).end();
  }
});

// ── Privados ────────────────────────────────────────────────────────────────

const deny = (res: Response, status: number, error: string) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error });
};

type SessionUser = NonNullable<Awaited<ReturnType<typeof resolveSessionUser>>>;

async function authorize(user: SessionUser | null, row: StoredObjectRow, write: boolean): Promise<200 | 401 | 403> {
  if (!user || user.isActive === false) return 401;
  if (write && String(user.role) === "readonly") return 403;
  const policy = policyOf(row.category);
  // Los públicos solo los modifica quien gestiona la web; leerlos con sesión no requiere más
  if (row.visibility === "public" && !write) return 200;
  // Exportación de datos: solo la persona propietaria (con sesión); con enlace firmado, el enlace es la autorización
  if (row.category === "data-export") {
    const owner = await getCompanyOwnerEmail().catch(() => null);
    return !write && String(user.role) === "admin" && !!owner && String(user.email ?? "").trim().toLowerCase() === owner ? 200 : 403;
  }
  let ok = false;
  try {
    ok = await checkRbacOrLegacy(user.id, String(user.role), policy.permission, policy.fallbackRoles);
  } catch {
    ok = policy.fallbackRoles.includes(String(user.role));
  }
  return ok ? 200 : 403;
}

router.get("/api/files/:id", async (req: Request, res: Response, next) => {
  const id = String(req.params.id ?? "");
  if (!objectStorageEnabled()) return next();
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!OBJECT_ID_RE.test(id) || !tenantReady()) return deny(res, 404, "Fichero no encontrado.");
  try {
    const signed = req.query.sig !== undefined || req.query.exp !== undefined;
    if (signed) {
      const check = verifySignedLink(id, req.query.exp, req.query.sig);
      if (check === "expired") return deny(res, 410, "El enlace ha caducado. Solicita uno nuevo.");
      if (check !== "valid") return deny(res, 403, "Enlace no válido.");
    }
    const user = signed ? null : await resolveSessionUser(req);
    // Sin sesión no se revela si el fichero existe
    if (!signed && (!user || user.isActive === false)) return deny(res, 401, "No autenticado.");
    const row = await fileService().find(id);
    if (!row) return deny(res, 404, "Fichero no encontrado.");
    if (!signed) {
      const auth = await authorize(user, row, false);
      if (auth !== 200) return deny(res, auth, auth === 401 ? "No autenticado." : "No tienes permiso para ver este fichero.");
    }
    // Cada descarga de una exportación queda registrada (auditoría); un fallo del registro no impide descargar
    if (row.category === "data-export") {
      await new MysqlDataExportStore(() => legacyPool()).downloaded(row.objectId, Date.now()).catch(() => undefined);
      console.info(JSON.stringify({ ctx: "DataExport", event: "downloaded", objectId: row.objectId, via: signed ? "link" : "session" }));
    }
    const inline = INLINE_SAFE.has(row.contentType) || row.contentType === "text/html";
    const backend = fileService().storage;
    if (process.env.STORAGE_PRIVATE_DELIVERY === "redirect" && backend.presign) {
      const ttl = Math.min(Math.max(Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS) || 60, 5), 900);
      const url = await backend.presign(row.storageKey, ttl, { contentType: row.contentType, disposition: disposition(row, inline && row.contentType !== "text/html") });
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, url);
    }
    await send(res, row, "private, no-store", inline);
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable(res);
    console.error(JSON.stringify({ ctx: "Storage", event: "private_get_error", error: err instanceof Error ? err.name : "error" }));
    if (!res.headersSent) deny(res, 500, "No se pudo servir el fichero.");
  }
});

router.delete("/api/files/:id", async (req: Request, res: Response, next) => {
  const id = String(req.params.id ?? "");
  if (!objectStorageEnabled()) return next();
  if (!OBJECT_ID_RE.test(id) || !tenantReady()) return deny(res, 404, "Fichero no encontrado.");
  try {
    const user = await resolveSessionUser(req);
    if (!user || user.isActive === false) return deny(res, 401, "No autenticado.");
    const row = await fileService().find(id);
    if (!row) return deny(res, 404, "Fichero no encontrado.");
    const auth = await authorize(user, row, true);
    if (auth !== 200) return deny(res, auth, "No tienes permiso para borrar este fichero.");
    await fileService().delete(id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable(res);
    console.error(JSON.stringify({ ctx: "Storage", event: "delete_error", error: err instanceof Error ? err.name : "error" }));
    if (!res.headersSent) deny(res, 500, "No se pudo borrar el fichero.");
  }
});

export default router;
