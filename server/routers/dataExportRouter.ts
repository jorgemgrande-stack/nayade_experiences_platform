/**
 * dataExport.* — exportación de los datos de la empresa en curso (ZIP con CSV, JSON y ficheros).
 *
 * Solo la persona PROPIETARIA (administradora cuyo correo es el `company_owner_email` de la empresa). Funciona
 * también en solo lectura: `request` y `link` están exentos del bloqueo de escrituras (tenantMiddleware) porque
 * exportar es justo lo que se garantiza durante los 30 días tras el fin del periodo pagado.
 *
 * Al terminar, aviso por correo a quien la pidió («disponible» o «fallida»; categoría `data_export`, sin copia
 * global y sin el enlace de descarga: el botón lleva a la pantalla del panel).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantIdOrDefault } from "../_core/tenant";
import { legacyPool } from "../_core/legacyDb";
import { fileService, signedLink } from "../_core/files/service";
import { getCompanyOwnerEmail } from "../_core/companyOwner";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { sendEmail } from "../mailer";
import { brandName } from "../tenantBrand";
import { EXPORT_PANEL_PATH, exportFailedContent, exportReadyContent } from "../mail/exportTemplates";
import { DataExportError, DataExportService, EXPORT_LINK_TTL_MS, exportMaxBytes, MysqlDataExportStore, MysqlExportSource, type ExportNotice } from "../dataExport/service";

const CODE: Record<DataExportError["code"], TRPCError["code"]> = { forbidden: "FORBIDDEN", conflict: "CONFLICT", not_found: "NOT_FOUND", invalid_state: "PRECONDITION_FAILED", unavailable: "PRECONDITION_FAILED" };

/** «ana@empresa.es» → «a•••@empresa.es»: quién puede exportar, sin revelar la dirección completa. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : "•••";
}

async function isOwner(user: { role: unknown; email?: string | null }) {
  if (String(user.role) !== "admin") return false;
  const owner = await getCompanyOwnerEmail();
  return !!owner && (user.email ?? "").trim().toLowerCase() === owner;
}

function panelUrl(): string | null {
  try {
    return `${getTrustedBaseUrl()}${EXPORT_PANEL_PATH}`;
  } catch {
    return null;
  }
}

async function notify(n: ExportNotice): Promise<void> {
  const brand = brandName();
  const e = n.export;
  const c =
    n.kind === "ready"
      ? exportReadyContent(brand, { name: n.to.name, tables: e.tableCount ?? 0, rows: e.rowCount ?? 0, files: e.fileCount ?? 0, warning: e.warning, expiresAt: e.expiresAt ?? Date.now(), panelUrl: panelUrl() })
      : exportFailedContent(brand, { name: n.to.name, reason: e.error ?? "error desconocido.", panelUrl: panelUrl() });
  await sendEmail({ to: n.to.email, subject: c.subject, html: c.html, text: c.text, category: "data_export", idempotencyKey: `data-export:${e.id}:${n.kind}` });
}

function service() {
  const pool = () => legacyPool();
  return new DataExportService({
    store: new MysqlDataExportStore(pool),
    source: new MysqlExportSource(pool, (key) => fileService().storage.get(key)),
    saveZip: async (zip, name, uploadedBy) => (await fileService().put({ category: "data-export", data: zip, declaredType: "application/zip", originalName: name, uploadedBy, owner: { type: "data-export", id: name } })).objectId,
    signedLink: (objectId, ttl) => signedLink(objectId, ttl),
    tenantId: getTenantIdOrDefault(),
    notify,
  });
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DataExportError) throw new TRPCError({ code: CODE[e.code], message: e.message });
    throw e;
  }
}

export const dataExportRouter = router({
  /** ¿Puede exportar quien mira? Si no, quién puede (correo enmascarado). Límites que muestra la pantalla. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getCompanyOwnerEmail().catch(() => null);
    const canExport = await isOwner(ctx.user).catch(() => false);
    return {
      canExport,
      ownerConfigured: !!owner,
      owner: !canExport && owner && String(ctx.user.role) === "admin" ? maskEmail(owner) : null,
      linkHours: EXPORT_LINK_TTL_MS / 3600_000,
      maxMb: exportMaxBytes() / 1048576,
    };
  }),
  /** Solicita una exportación nueva (se genera en segundo plano; consulta `list`). */
  request: protectedProcedure.mutation(async ({ ctx }) =>
    run(async () => {
      const { export: row } = await service().request({ id: ctx.user.id, isOwner: await isOwner(ctx.user), email: ctx.user.email ?? null, name: ctx.user.name ?? null });
      return row;
    }),
  ),
  list: protectedProcedure.query(async ({ ctx }) => run(async () => service().list({ isOwner: await isOwner(ctx.user) }))),
  /** Enlace firmado de descarga, válido como mucho hasta 24 h después de generarse la exportación. */
  link: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => run(async () => service().link({ isOwner: await isOwner(ctx.user) }, input.id))),
});
