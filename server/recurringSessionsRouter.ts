/**
 * API tRPC de las sesiones recurrentes (`recurringSessions.*`): ofertas por producto, participaciones y envío de los datos de Zoom.
 * Todo en administración (rol de administrador). El correo a las personas compradoras sale por el servicio de correo de la empresa.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  counts, hasOffers, listEntitlements, listOffers, OfferInvalid, RecurringNotInstalled, retryNotice, saveOffer, sendZoomAccess, sendZoomToPending,
} from "./recurringSessionsDb";

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RecurringNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    if (e instanceof OfferInvalid) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

const id = z.number().int().positive();

export const recurringSessionsRouter = router({
  /** ¿Hay ofertas configuradas? (entrada del menú de administración). Sin tablas = no. */
  status: protectedProcedure.query(async () => ({ enabled: await hasOffers().catch(() => false) })),

  offers: adminProcedure.query(() => handle(() => listOffers())),

  saveOffer: adminProcedure
    .input(
      z.object({
        productId: id,
        variantId: z.number().int().min(0).optional(),
        title: z.string().max(160).optional(),
        weekday: z.number().int().min(1).max(7),
        startTime: z.string().max(5),
        timezone: z.string().max(64),
        timezoneConfirmed: z.boolean().optional(),
        durationMinutes: z.number().int(),
        sessionsCount: z.number().int(),
        leadMinutes: z.number().int().optional(),
        zoomUrl: z.string().max(500).nullable().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => handle(async () => ({ id: await saveOffer(input) }))),

  summary: adminProcedure.query(() => handle(() => counts())),

  entitlements: adminProcedure
    .input(z.object({ offerId: id.optional(), zoomPending: z.boolean().optional() }).optional())
    .query(({ input }) => handle(() => listEntitlements(input ?? {}))),

  retryNotice: adminProcedure.input(z.object({ id })).mutation(({ input }) => handle(async () => ({ result: await retryNotice(input.id) }))),

  sendZoom: adminProcedure.input(z.object({ id })).mutation(({ input }) => handle(async () => ({ result: await sendZoomAccess(input.id) }))),

  sendZoomToPending: adminProcedure.input(z.object({ offerId: id })).mutation(({ input }) => handle(() => sendZoomToPending(input.offerId))),
});
