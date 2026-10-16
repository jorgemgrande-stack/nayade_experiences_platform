/**
 * API tRPC de Ski Rental (`skiRental.*`). Solo administración: todavía no hay reserva pública ni pago.
 *
 * La licencia NO va en `capabilityRouteGuard` (que no conoce la sede): la aplica el servicio en cada
 * procedimiento con la licencia por capacidad de la sede. Los errores del SDK salen tipados
 * (`[module_not_licensed] …`, `[module_read_only] …`, `[module_not_active] …`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { SdkError, getSdkRuntime, installSdkModule, toTrpcError } from "../sdk";
import { ITEM_CATEGORIES, RENTAL_STATUSES } from "./availability";
import { skiRentalModule } from "./manifest";
import { SkiRentalError, SkiRentalService } from "./service";
import { TenantDbSkiRentalStore } from "./store";

// Un módulo que no valida no impide arrancar al Core: queda sin registrar y sus rutas responden NOT_FOUND
try {
  installSdkModule(skiRentalModule);
} catch (e) {
  console.warn(JSON.stringify({ ctx: "SkiRental", event: "install_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
}

const service = new SkiRentalService({
  store: new TenantDbSkiRentalStore(),
  gate: () => getSdkRuntime().gate,
  events: () => getSdkRuntime().events,
});

const CODES: Record<SkiRentalError["code"], TRPCError["code"]> = { invalid_input: "BAD_REQUEST", not_found: "NOT_FOUND", conflict: "CONFLICT" };

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SdkError) throw toTrpcError(e);
    if (e instanceof SkiRentalError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    throw e;
  }
}

const site = z.object({ siteId: z.string().min(1).max(63) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const actor = (ctx: { user: { id: number } }) => `user:${ctx.user.id}`;

export const skiRentalRouter = router({
  status: adminProcedure.input(site).query(({ input }) => handle(() => service.status(input.siteId))),
  activateSite: adminProcedure.input(site).mutation(({ input, ctx }) => handle(() => service.activateSite(input.siteId, actor(ctx)))),
  deactivateSite: adminProcedure.input(site).mutation(({ input, ctx }) => handle(() => service.deactivateSite(input.siteId, actor(ctx)))),

  listItems: adminProcedure.input(site).query(({ input }) => handle(() => service.listItems(input.siteId))),
  createItem: adminProcedure
    .input(site.extend({ category: z.enum(ITEM_CATEGORIES), name: z.string(), size: z.string().optional(), quantity: z.number().int() }))
    .mutation(({ input }) => handle(() => service.createItem(input.siteId, input))),
  updateItem: adminProcedure
    .input(site.extend({ itemId: z.number().int().positive(), name: z.string().optional(), quantity: z.number().int().optional(), active: z.boolean().optional() }))
    .mutation(({ input }) => handle(() => service.updateItem(input.siteId, input.itemId, input))),

  availability: adminProcedure
    .input(site.extend({ from: day, to: day, category: z.enum(ITEM_CATEGORIES).optional() }))
    .query(({ input }) => handle(() => service.availability(input.siteId, input.from, input.to, input.category))),

  listRentals: adminProcedure.input(site.extend({ status: z.enum(RENTAL_STATUSES).optional() })).query(({ input }) => handle(() => service.listRentals(input.siteId, input.status))),
  createRental: adminProcedure
    .input(site.extend({ itemId: z.number().int().positive(), quantity: z.number().int(), customerName: z.string(), startDate: day, endDate: day }))
    .mutation(({ input, ctx }) => handle(() => service.createRental(input.siteId, input, actor(ctx)))),
  pickUp: adminProcedure.input(site.extend({ rentalId: z.number().int().positive() })).mutation(({ input }) => handle(() => service.pickUp(input.siteId, input.rentalId))),
  returnRental: adminProcedure.input(site.extend({ rentalId: z.number().int().positive() })).mutation(({ input }) => handle(() => service.returnRental(input.siteId, input.rentalId))),
  cancelRental: adminProcedure.input(site.extend({ rentalId: z.number().int().positive() })).mutation(({ input }) => handle(() => service.cancelRental(input.siteId, input.rentalId))),
});
