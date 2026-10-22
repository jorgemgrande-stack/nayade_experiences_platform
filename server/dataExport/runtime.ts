/**
 * Servicio de exportación con la infraestructura real de la empresa en curso: su BD (legacyPool), su
 * almacenamiento (FileService, en streaming), el gestor de recursos (cuotas y medición), los avisos por correo y
 * el directorio de temporales. Lo usan el router (solicitud, lista y enlace) y el trabajo (generación).
 */
import fs from "node:fs/promises";
import { legacyPool } from "../_core/legacyDb";
import { fileService, signedLink } from "../_core/files/service";
import { getTenantIdOrDefault } from "../_core/tenant";
import { withTenantDb } from "../_core/dbRegistry";
import { enforceQuota } from "../_core/erm/runtime";
import { meter } from "../_core/metering";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { sendEmail } from "../mailer";
import { brandName } from "../tenantBrand";
import { EXPORT_PANEL_PATH, exportFailedContent, exportReadyContent } from "../mail/exportTemplates";
import { DataExportService, MysqlDataExportStore, MysqlExportSource, type ExportNotice } from "./service";

function panelUrl(): string | null {
  try {
    return `${getTrustedBaseUrl()}${EXPORT_PANEL_PATH}`;
  } catch {
    return null;
  }
}

/** Aviso «Exportación disponible» / «Exportación fallida» (categoría data_export: sin copia global ni enlace). */
export async function notifyExport(n: ExportNotice): Promise<void> {
  const brand = brandName();
  const e = n.export;
  const c =
    n.kind === "ready"
      ? exportReadyContent(brand, { name: n.to.name, tables: e.tableCount ?? 0, rows: e.rowCount ?? 0, files: e.fileCount ?? 0, warning: e.warning, expiresAt: e.expiresAt ?? Date.now(), panelUrl: panelUrl() })
      : exportFailedContent(brand, { name: n.to.name, reason: e.error ?? "error desconocido.", panelUrl: panelUrl() });
  await sendEmail({ to: n.to.email, subject: c.subject, html: c.html, text: c.text, category: "data_export", idempotencyKey: `data-export:${e.id}:${n.kind}` });
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await fs.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export function exportService(): DataExportService {
  const pool = () => legacyPool();
  return new DataExportService({
    store: new MysqlDataExportStore(pool),
    openSource: () => new MysqlExportSource(pool, async (key) => {
      const backend = fileService().storage;
      return backend.getStream ? backend.getStream(key) : backend.get(key);
    }).open(),
    saveZip: async (z) =>
      (await fileService().putFile({ category: "data-export", filePath: z.filePath, sizeBytes: z.sizeBytes, sha256: z.sha256, declaredType: "application/zip", originalName: z.name, uploadedBy: z.uploadedBy, owner: { type: "data-export", id: z.owner } })).objectId,
    listOwned: async (owner) => (await fileService().listByOwner("data-export", owner)).filter((r) => r.category === "data-export" && r.status === "active").map((r) => r.objectId),
    removeObject: async (objectId) => {
      await fileService().delete(objectId);
    },
    signedLink: (objectId, ttl) => signedLink(objectId, ttl),
    requester: async (userId) => {
      const [rows] = await pool().query("SELECT email, name FROM users WHERE id = ? LIMIT 1", [userId]);
      const r = (rows as Array<{ email: string | null; name: string | null }>)[0];
      return r?.email ? { email: r.email, name: r.name ?? null } : null;
    },
    notify: notifyExport,
    quota: (metric, qty) => enforceQuota(metric, qty),
    meter: (metric, qty, unit) => meter(metric, qty, unit),
    freeBytes,
    tenantId: getTenantIdOrDefault(),
  });
}

/** Primer intento inmediato tras solicitarla (en segundo plano, con la BD de la empresa arrendada). */
export function kickExport(): void {
  const tenantId = getTenantIdOrDefault();
  void withTenantDb(tenantId, () => exportService().processNext()).catch(() => undefined);
}
