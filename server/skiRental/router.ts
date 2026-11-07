/**
 * API tRPC de Ski Rental (`skiRental.*`). Solo administración: todavía no hay reserva pública ni pago. La v1 por unidad
 * añade procedimientos (tiendas, modelos, unidades, entregas, contratos y taller) sin cambiar los de la v0.1.
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
import { SkiRentalUnitsService } from "./unitService";
import { TenantDbSkiRentalUnitStore } from "./unitStore";
import { UNIT_STATUSES } from "./units";

// Un módulo que no valida no impide arrancar al Core: queda sin registrar y sus rutas responden NOT_FOUND
try {
  installSdkModule(skiRentalModule);
} catch (e) {
  console.warn(JSON.stringify({ ctx: "SkiRental", event: "install_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
}

const store = new TenantDbSkiRentalStore();
const service = new SkiRentalService({
  store,
  gate: () => getSdkRuntime().gate,
  events: () => getSdkRuntime().events,
});
const units = new SkiRentalUnitsService({
  store: new TenantDbSkiRentalUnitStore(),
  activation: store,
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
const id = z.number().int().positive();
const time = z.string().regex(/^\d{2}:\d{2}$/);
const hours = { openingTime: time, closingTime: time, overdueReturnTime: time };
const codeLabels = z.array(z.object({ code: z.string().max(24), label: z.string().max(60) })).max(30);
/** Evidencia del equipo donde se firma: IP (según el `trust proxy` del Core) y navegador. */
const evidence = (ctx: { req: { ip?: string; headers: Record<string, string | string[] | undefined> } }) => {
  const ua = ctx.req.headers["user-agent"];
  return { ip: ctx.req.ip ?? null, userAgent: typeof ua === "string" ? ua.slice(0, 300) : null };
};

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

  // ── v1 por unidad ──
  settings: adminProcedure.input(site).query(({ input }) => handle(() => units.settings(input.siteId))),
  updateSettings: adminProcedure
    .input(site.extend({ assetTypes: codeLabels.optional(), contractTerms: z.string().max(20_000).nullable().optional() }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.updateSettings(siteId, rest, actor(ctx)));
    }),
  listStores: adminProcedure.input(site).query(({ input }) => handle(() => units.listStores(input.siteId))),
  createStore: adminProcedure.input(site.extend({ name: z.string().max(120), ...hours })).mutation(({ input }) => {
    const { siteId, ...rest } = input;
    return handle(() => units.createStore(siteId, rest));
  }),
  updateStore: adminProcedure
    .input(site.extend({ storeId: id, name: z.string().max(120).optional(), openingTime: time.optional(), closingTime: time.optional(), overdueReturnTime: time.optional(), active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const { siteId, storeId, ...rest } = input;
      return handle(() => units.updateStore(siteId, storeId, rest));
    }),
  listModels: adminProcedure.input(site).query(({ input }) => handle(() => units.listModels(input.siteId))),
  createModel: adminProcedure
    .input(site.extend({ assetType: z.string().max(24), name: z.string().max(120), brand: z.string().max(80).nullable().optional(), size: z.string().max(16).nullable().optional(), replacementValueCents: z.number().int().nullable().optional() }))
    .mutation(({ input }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.createModel(siteId, rest));
    }),
  updateModel: adminProcedure
    .input(site.extend({ modelId: id, name: z.string().max(120).optional(), brand: z.string().max(80).nullable().optional(), replacementValueCents: z.number().int().nullable().optional(), active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const { siteId, modelId, ...rest } = input;
      return handle(() => units.updateModel(siteId, modelId, rest));
    }),
  listUnits: adminProcedure
    .input(site.extend({ modelId: id.optional(), status: z.enum(UNIT_STATUSES).optional() }))
    .query(({ input }) => handle(() => units.listUnits(input.siteId, { modelId: input.modelId, status: input.status }))),
  createUnits: adminProcedure
    .input(site.extend({ modelId: id, storeId: id.nullable().optional(), codes: z.array(z.string().max(40)).max(200).optional(), count: z.number().int().optional() }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.createUnits(siteId, rest, actor(ctx)));
    }),
  scanUnit: adminProcedure.input(site.extend({ code: z.string().max(60) })).query(({ input }) => handle(() => units.scan(input.siteId, input.code))),
  unitHistory: adminProcedure.input(site.extend({ unitId: id })).query(({ input }) => handle(() => units.unitHistory(input.siteId, input.unitId))),
  setUnitStatus: adminProcedure
    .input(site.extend({ unitId: id, status: z.enum(UNIT_STATUSES), note: z.string().max(300).nullable().optional() }))
    .mutation(({ input, ctx }) => handle(() => units.setUnitStatus(input.siteId, input.unitId, input.status, input.note, actor(ctx)))),
  listDeliveries: adminProcedure
    .input(site.extend({ status: z.enum(["open", "returned"]).optional() }))
    .query(({ input }) => handle(() => units.listDeliveries(input.siteId, input.status))),
  getDelivery: adminProcedure.input(site.extend({ deliveryId: id })).query(({ input }) => handle(() => units.getDelivery(input.siteId, input.deliveryId))),
  createDelivery: adminProcedure
    .input(
      site.extend({
        storeId: id,
        customerName: z.string().max(120),
        reservationId: id.nullable().optional(),
        startDate: day,
        expectedReturnDate: day,
        lines: z
          .array(
            z.object({
              code: z.string().max(60),
              requestedType: z.string().max(24),
              requestedSize: z.string().max(16).nullable().optional(),
              confirmSize: z.boolean().optional(),
              reason: z.string().max(200).nullable().optional(),
            }),
          )
          .max(30),
      }),
    )
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.createDelivery(siteId, rest, actor(ctx)));
    }),
  returnLine: adminProcedure
    .input(site.extend({ lineId: id, condition: z.enum(["ok", "damaged", "lost"]), note: z.string().max(300).nullable().optional() }))
    .mutation(({ input, ctx }) => handle(() => units.returnLine(input.siteId, input.lineId, input.condition, input.note, actor(ctx)))),
  signContract: adminProcedure
    .input(site.extend({ deliveryId: id, signerName: z.string().max(120), accepted: z.boolean() }))
    .mutation(({ input, ctx }) => handle(() => units.signContract(input.siteId, input.deliveryId, input, evidence(ctx), actor(ctx)))),
  listContracts: adminProcedure
    .input(site.extend({ status: z.enum(["pending", "signed"]).optional() }))
    .query(({ input }) => handle(() => units.listContracts(input.siteId, input.status))),
  listTickets: adminProcedure
    .input(site.extend({ status: z.enum(["open", "done"]).optional() }))
    .query(({ input }) => handle(() => units.listTickets(input.siteId, input.status))),
  openTicket: adminProcedure
    .input(site.extend({ unitId: id, reason: z.string().max(300) }))
    .mutation(({ input, ctx }) => handle(() => units.openTicket(input.siteId, input.unitId, input.reason, actor(ctx)))),
  closeTicket: adminProcedure
    .input(site.extend({ ticketId: id, resolution: z.enum(["available", "incident", "retired"]), notes: z.string().max(500).nullable().optional() }))
    .mutation(({ input, ctx }) => handle(() => units.closeTicket(input.siteId, input.ticketId, input.resolution, input.notes, actor(ctx)))),
});
