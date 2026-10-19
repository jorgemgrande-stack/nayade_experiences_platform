/**
 * dataExport.* — exportación de los datos de la empresa en curso (ZIP con CSV, JSON y ficheros).
 *
 * Solo la persona PROPIETARIA (administradora cuyo correo es el `company_owner_email` de la empresa). Funciona
 * también en solo lectura: `request` y `link` están exentos del bloqueo de escrituras (tenantMiddleware) porque
 * exportar es justo lo que se garantiza durante los 30 días tras el fin del periodo pagado.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantIdOrDefault } from "../_core/tenant";
import { legacyPool } from "../_core/legacyDb";
import { fileService, signedLink } from "../_core/files/service";
import { getCompanyOwnerEmail } from "../_core/companyOwner";
import { DataExportError, DataExportService, MysqlDataExportStore, MysqlExportSource } from "../dataExport/service";

const CODE: Record<DataExportError["code"], TRPCError["code"]> = { forbidden: "FORBIDDEN", conflict: "CONFLICT", not_found: "NOT_FOUND", invalid_state: "PRECONDITION_FAILED", unavailable: "PRECONDITION_FAILED" };

async function isOwner(user: { role: unknown; email?: string | null }) {
  if (String(user.role) !== "admin") return false;
  const owner = await getCompanyOwnerEmail();
  return !!owner && (user.email ?? "").trim().toLowerCase() === owner;
}

function service() {
  const pool = () => legacyPool();
  return new DataExportService({
    store: new MysqlDataExportStore(pool),
    source: new MysqlExportSource(pool, (key) => fileService().storage.get(key)),
    saveZip: async (zip, name, uploadedBy) => (await fileService().put({ category: "data-export", data: zip, declaredType: "application/zip", originalName: name, uploadedBy, owner: { type: "data-export", id: name } })).objectId,
    signedLink: (objectId, ttl) => signedLink(objectId, ttl),
    tenantId: getTenantIdOrDefault(),
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
  /** Solicita una exportación nueva (se genera en segundo plano; consulta `list`). */
  request: protectedProcedure.mutation(async ({ ctx }) =>
    run(async () => {
      const { export: row } = await service().request({ id: ctx.user.id, isOwner: await isOwner(ctx.user) });
      return row;
    }),
  ),
  list: protectedProcedure.query(async ({ ctx }) => run(async () => service().list({ isOwner: await isOwner(ctx.user) }))),
  /** Enlace firmado de descarga, válido como mucho hasta 24 h después de generarse la exportación. */
  link: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => run(async () => service().link({ isOwner: await isOwner(ctx.user) }, input.id))),
});
