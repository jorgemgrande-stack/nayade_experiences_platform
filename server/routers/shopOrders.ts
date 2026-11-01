/**
 * Pedidos de la tienda online en el panel (`reservations.onlineOrders*`): listado, ficha y cambio de estado. Van en el
 * namespace `reservations`, que licencia «Pedidos» (`shop-orders`) en el guardián de capacidades. Lógica en
 * server/shopOrdersDb.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { staffProcedure } from "../_core/trpc";
import { getOnlineOrder, listOnlineOrders, OrderStageError, setOnlineOrderStage } from "../shopOrdersDb";

const stage = z.enum(["pending_payment", "paid", "prepared", "delivered", "cancelled", "failed"]);
const orderNumber = z.string().min(1).max(30);

export const shopOrderProcedures = {
  onlineOrders: staffProcedure
    .input(z.object({ stage: stage.or(z.literal("all")).default("all"), search: z.string().max(100).optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }))
    .query(({ input }) => listOnlineOrders(input)),

  onlineOrder: staffProcedure.input(z.object({ merchantOrder: orderNumber })).query(async ({ input }) => {
    const o = await getOnlineOrder(input.merchantOrder);
    if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "No se encuentra el pedido." });
    return o;
  }),

  setOnlineOrderStage: staffProcedure
    .input(z.object({ merchantOrder: orderNumber, stage }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await setOnlineOrderStage(input.merchantOrder, input.stage, { id: ctx.user.id, name: ctx.user.name ?? null });
      } catch (e) {
        if (e instanceof OrderStageError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }
    }),
};
