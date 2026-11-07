/**
 * Care Net · bonos y paquetes de sesiones y reservas de SPA (namespace `careNet`, licenciado con la capacidad
 * `care-net` en server/_core/capabilities/routeGuard.ts y en el manifiesto del módulo de SPA).
 *
 * Permisos: definir bonos es de administración (settings.manage, como la configuración del SPA); vender, consumir,
 * citas en mostrador y consultas son de quien vende en el TPV (tpv.sell: admin y agente), porque la venta se cobra
 * con tpv.createSale con la sesión de caja de quien vende. La lógica vive en server/careNetDb.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, permissionProcedure } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { tpvRouter } from "./tpv";
import * as care from "../careNetDb";
import { hotelChargesEnabled, listInHouseGuests } from "../hotelFolioCharges";
import { REQUEST_KEY_RE } from "../../shared/careNet";

const manageProc = permissionProcedure("settings.manage", ["admin"]);
const deskProc = permissionProcedure("tpv.sell", ["admin", "agente"]);

const id = z.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const payment = z.object({ method: z.enum(["cash", "card", "bizum", "other"]), amount: z.number().positive().max(100000), amountTendered: z.number().positive().max(100000).optional() });

export const careNetRouter = router({
  // ── Definiciones de bono ────────────────────────────────────────────────
  listPacks: deskProc.input(z.object({ includeArchived: z.boolean().optional() }).optional()).query(({ input }) => care.listPacks(input?.includeArchived)),

  upsertPack: manageProc
    .input(z.object({
      id: id.optional(),
      name: z.string().trim().min(1, "Indica el nombre del bono").max(160),
      description: z.string().max(512).nullish(),
      sessions: z.number().int(),
      validityDays: z.number().int(),
      price: z.number(),
      treatmentIds: z.array(id).max(200).default([]),
      categoryIds: z.array(id).max(100).default([]),
    }))
    .mutation(({ input }) => care.upsertPack(input)),

  setPackActive: manageProc.input(z.object({ id, active: z.boolean() })).mutation(({ input }) => care.setPackActive(input.id, input.active)),

  // ── Venta y saldo ───────────────────────────────────────────────────────
  searchClients: deskProc.input(z.object({ q: z.string().trim().min(2).max(100) })).query(({ input }) => care.searchClients(input.q)),

  /** Vende un bono a un cliente del CRM y lo cobra con el TPV del Core (una sola venta por compra). */
  sellPack: deskProc
    .input(z.object({ packId: id, clientId: id, sessionId: id, payments: z.array(payment).min(1).max(10), requestKey: z.string().regex(REQUEST_KEY_RE), notes: z.string().max(500).nullish() }))
    .mutation(async ({ ctx, input }) => care.sellPack(input, ctx.user.id, await packSaleOf(ctx))),

  /** Vuelve a intentar el cobro de un bono que quedó pendiente. */
  payPurchase: deskProc
    .input(z.object({ purchaseId: id, sessionId: id, payments: z.array(payment).min(1).max(10) }))
    .mutation(async ({ ctx, input }) => care.payPurchase(input.purchaseId, input.sessionId, input.payments, await packSaleOf(ctx))),

  cancelPendingPurchase: deskProc.input(z.object({ purchaseId: id })).mutation(({ input }) => care.cancelPendingPurchase(input.purchaseId)),

  clientsWithPacks: deskProc
    .input(z.object({ filter: z.enum(["active", "expired", "all"]).default("active"), search: z.string().max(100).optional() }))
    .query(({ input }) => care.clientsWithPacks(input.filter, input.search)),

  clientPacks: deskProc.input(z.object({ clientId: id })).query(({ input }) => care.clientPacks(input.clientId)),

  // ── Reservas de SPA y consumo ───────────────────────────────────────────
  spaReservations: deskProc.input(z.object({ from: day, to: day })).query(({ input }) => care.spaReservations(input.from, input.to)),

  spaCatalog: deskProc.query(() => care.spaCatalog()),

  spaSlotsOfDay: deskProc.input(z.object({ date: day })).query(({ input }) => care.spaSlotsOfDay(input.date)),

  /** Paga una reserva de SPA con una sesión de bono (el indicado o el que caduca antes). */
  consumeForReservation: deskProc
    .input(z.object({ reservationId: id, purchaseId: id.nullish(), clientId: id.nullish() }))
    .mutation(({ ctx, input }) => care.consumeForReservation(input, ctx.user.id)),

  /** Cita en mostrador con bono: plaza retenida, reserva del cliente y sesión consumida. */
  counterAppointment: deskProc
    .input(z.object({ clientId: id, slotId: id, persons: z.number().int().min(1).max(20).optional(), purchaseId: id.nullish(), notes: z.string().max(500).nullish() }))
    .mutation(({ ctx, input }) => care.counterAppointment(input, ctx.user.id)),

  // ── Cargo a habitación (solo con Hotel Net) ─────────────────────────────
  /** ¿Se puede cargar a la habitación? y huéspedes en casa. Sin Hotel Net: no disponible (la opción no aparece). */
  roomGuests: deskProc.query(async () => {
    if (!(await hotelChargesEnabled())) return { available: false, guests: [] };
    return { available: true, guests: await listInHouseGuests() };
  }),

  /** Carga una reserva de SPA pendiente al folio del huésped (sin venta del TPV). */
  chargeReservationToRoom: deskProc
    .input(z.object({ reservationId: id, hotelReservationId: id }))
    .mutation(({ ctx, input }) => care.chargeSpaReservationToRoom(input.reservationId, input.hotelReservationId, ctx.user.id)),

  /** Vende un bono y lo carga al folio del huésped en lugar de cobrarlo en el TPV. */
  sellPackToRoom: deskProc
    .input(z.object({ packId: id, clientId: id, hotelReservationId: id, requestKey: z.string().regex(REQUEST_KEY_RE), notes: z.string().max(500).nullish() }))
    .mutation(({ ctx, input }) => care.sellPackToRoom(input, ctx.user.id)),

  revertConsumption: deskProc
    .input(z.object({ consumptionId: id, reason: z.string().trim().min(3, "Indica el motivo").max(255), cancelReservation: z.boolean().default(false) }))
    .mutation(({ ctx, input }) => care.revertConsumption(input.consumptionId, input.reason, input.cancelReservation, ctx.user.id)),
});

/** Venta del bono con el TPV del Core, con la sesión (y permisos) de quien vende. */
async function packSaleOf(ctx: Parameters<typeof tpvRouter.createCaller>[0]): Promise<care.CreatePackSale> {
  // Llamar al TPV desde aquí no pasa por el guardián HTTP de su namespace: se comprueba su licencia (caja)
  const cash = await getCapabilityAccess().check("bill-cash", { write: true }).catch(() => ({ allowed: false }));
  if (!cash.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "La caja (TPV) no está incluida en tu plan o está en solo lectura: no se puede cobrar el bono." });
  const tpv = tpvRouter.createCaller(ctx);
  return async (req) => {
    const r = await tpv.createSale({ ...req, discountAmount: 0, items: req.items.map((i) => ({ ...i, isManual: false })) });
    return { saleId: Number(r.sale?.id), replayed: Boolean(r.replayed) };
  };
}
