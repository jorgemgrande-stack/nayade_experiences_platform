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

const tpvReportsProc = permissionProcedure("tpv.backoffice", ["admin"]);

const filterInput = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  registerId: z.number().int().positive().nullish(),
});

async function loadReport(input: z.infer<typeof filterInput>) {
  try {
    return await getTpvReport(input);
  } catch (e) {
    if (e instanceof TpvReportRangeError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

export const tpvReportsRouter = router({
  registers: tpvReportsProc.query(() => listReportRegisters()),

  summary: tpvReportsProc.input(filterInput).query(({ input }) => loadReport(input)),

  exportCsv: tpvReportsProc
    .input(filterInput.extend({ section: z.enum(REPORT_SECTIONS) }))
    .query(async ({ input }) => {
      const report = await loadReport(input);
      return { filename: reportCsvFilename(report, input.section), csv: reportSectionCsv(report, input.section) };
    }),
});
