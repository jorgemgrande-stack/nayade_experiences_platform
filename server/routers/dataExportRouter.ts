/**
 * dataExport.* — exportación de los datos de la empresa en curso (ZIP con CSV, JSON y ficheros).
 *
 * Solo la persona PROPIETARIA (administradora cuyo correo es el `company_owner_email` de la empresa). Funciona
 * también en solo lectura: `request` y `link` están exentos del bloqueo de escrituras (tenantMiddleware) porque
 * exportar es justo lo que se garantiza durante los 30 días tras el fin del periodo pagado.
 *
 * La solicitud solo se registra: la genera un trabajo en segundo plano (../dataExport/job.ts), con un primer
 * intento inmediato. Al terminar, aviso por correo a quien la pidió (../dataExport/runtime.ts).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getCompanyOwnerEmail } from "../_core/companyOwner";
import { getTenantIdOrDefault } from "../_core/tenant";
import { DataExportError, EXPORT_LINK_TTL_MS, exportDailyLimit, exportMaxBytes } from "../dataExport/service";
import { exportService, kickExport } from "../dataExport/runtime";

const CODE: Record<DataExportError["code"], TRPCError["code"]> = {
  forbidden: "FORBIDDEN",
  conflict: "CONFLICT",
  not_found: "NOT_FOUND",
  invalid_state: "PRECONDITION_FAILED",
  unavailable: "PRECONDITION_FAILED",
  rate_limited: "TOO_MANY_REQUESTS",
};

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
      maxMb: exportMaxBytes(process.env, getTenantIdOrDefault()) / 1048576,
      dailyLimit: exportDailyLimit(),
    };
  }),
  /** Solicita una exportación nueva (se genera en segundo plano; consulta `list`). */
  request: protectedProcedure.mutation(async ({ ctx }) =>
    run(async () => {
      const row = await exportService().request({ id: ctx.user.id, isOwner: await isOwner(ctx.user) });
      kickExport();
      return row;
    }),
  ),
  list: protectedProcedure.query(async ({ ctx }) => run(async () => exportService().list({ isOwner: await isOwner(ctx.user) }))),
  /** Enlace firmado de descarga, válido como mucho hasta 24 h después de generarse la exportación. */
  link: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => run(async () => exportService().link({ isOwner: await isOwner(ctx.user) }, input.id))),
});
