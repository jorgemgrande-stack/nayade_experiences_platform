/** Preparación para venta online (`products.saleReadiness.check`): solo lectura, solo administración. */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { loadSaleReadiness } from "../saleReadinessDb";

export const saleReadinessRouter = router({
  check: adminProcedure.input(z.object({ experienceId: z.number().int().positive() })).query(async ({ input }) => {
    const r = await loadSaleReadiness(input.experienceId);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
    return { ...r.result, offerMode: r.offerMode };
  }),
});
