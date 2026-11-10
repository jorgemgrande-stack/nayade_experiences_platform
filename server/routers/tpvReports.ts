/**
 * Informes del TPV (`tpv.reports.*`). Solo lectura y por empresa (BD propia). Licencia: la del TPV («bill-cash», por
 * el namespace `tpv` en el guardián de capacidades; en solo lectura se siguen consultando). Rol: el del historial de
 * cajas (`tpv.backoffice`, administradores), para que las ventas por cajero no las vea cualquier cajero.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permissionProcedure, router } from "../_core/trpc";
import { getTpvReport, listReportRegisters, TpvReportRangeError } from "../tpvReportsDb";
import { REPORT_SECTIONS, reportCsvFilename, reportSectionCsv } from "../tpvReports";
import { resolveSiteFilter } from "../sitesDb";
import { assertTpvFeature } from "../tpvRulesDb";
import { consolidatedReport } from "../tpvBusinessDb";

const tpvReportsProc = permissionProcedure("tpv.backoffice", ["admin"]);
// Informes por caja, por empleado y por periodo: Business o superior (estrategia TPV 09/11/2026). Essential tiene el
// resumen diario (tpv.dailySummary) y el historial de sesiones.
const detailedReportsProc = tpvReportsProc.use(async ({ next }) => {
  await assertTpvFeature("detailedReports");
  return next();
});

const filterInput = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  registerId: z.number().int().positive().nullish(),
  // Varias sedes (Business, multi-site): ventas y cierres de esa sede (la principal incluye lo que no tiene sede)
  siteId: z.string().max(63).nullish(),
});

async function loadReport(input: z.infer<typeof filterInput>) {
  try {
    const { siteId, ...rest } = input;
    return await getTpvReport({ ...rest, site: await resolveSiteFilter(siteId) });
  } catch (e) {
    if (e instanceof TpvReportRangeError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

export const tpvReportsRouter = router({
  registers: tpvReportsProc.query(() => listReportRegisters()),

  summary: detailedReportsProc.input(filterInput).query(({ input }) => loadReport(input)),

  exportCsv: detailedReportsProc
    .input(filterInput.extend({ section: z.enum(REPORT_SECTIONS) }))
    .query(async ({ input }) => {
      const report = await loadReport(input);
      return { filename: reportCsvFilename(report, input.section), csv: reportSectionCsv(report, input.section) };
    }),

  // Informes consolidados por establecimiento (Enterprise)
  consolidated: tpvReportsProc
    .input(z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      await assertTpvFeature("consolidatedReports");
      return consolidatedReport(input.dateFrom, input.dateTo);
    }),
});
