/**
 * Restaurant Net · sala, carta y comandas (namespace `restaurantNet`, licenciado con la capacidad `restaurant-net`
 * en server/_core/capabilities/routeGuard.ts y en el manifiesto del módulo de restaurantes).
 *
 * Roles: los del módulo de restaurantes (adminrestProcedure: permiso restaurants.view; legado admin | adminrest).
 * La administración gestiona todos los restaurantes; un adminrest, solo los que tiene asignados. El cobro usa además
 * el permiso de caja del TPV (tpv.sell) porque lo registra tpv.createSale con la sesión de quien cobra.
 *
 * La lógica vive en server/restaurantNetDb.ts; aquí solo hay validación de entrada y permisos.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminrestProcedure } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getRestaurantsByUser } from "../restaurantsDb";
import { tpvRouter } from "./tpv";
import * as rn from "../restaurantNetDb";
import { hotelChargesEnabled, listInHouseGuests } from "../hotelFolioCharges";
import * as kds from "../restaurantKdsDb";
import * as qr from "../netPublic/restaurantTable";
import { INCIDENT_TYPES, KITCHEN_FLOW, STATION_TONES } from "../../shared/restaurantKds";
import { MENU_TAX_RATES, PAYMENT_METHODS, ROOM_KINDS, TABLE_SHAPES, madridToday } from "../../shared/restaurantNet";
import type { TrpcContext } from "../_core/context";

type Ctx = TrpcContext & { user: NonNullable<TrpcContext["user"]> };

/** Guardia de restaurante: administración, todos; adminrest, los suyos (como server/routers/restaurants.ts). */
function guardOf(ctx: Ctx): rn.Guard {
  let allowed: number[] | null = null;
  return async (restaurantId: number) => {
    if (ctx.user.role === "admin") return;
    if (ctx.user.role === "adminrest") {
      allowed ??= await getRestaurantsByUser(ctx.user.id);
      if (allowed.includes(restaurantId)) return;
      throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este restaurante" });
    }
    // Como assertRestaurantAccess de server/routers/restaurants.ts: ningún otro rol opera la sala
    throw new TRPCError({ code: "FORBIDDEN" });
  };
}

const id = z.number().int().positive();
const restaurantInput = z.object({ restaurantId: id });
const code = z.string().trim().min(1, "Indica el nombre o número de la mesa").max(40);
const name = z.string().trim().min(1, "Indica un nombre").max(120);
const pos = z.number().min(0).max(2000);
const money = z.number().min(0).max(10000);
const payment = z.object({ method: z.enum(PAYMENT_METHODS), amount: z.number().positive().max(100000), amountTendered: z.number().positive().max(100000).optional() });

export const restaurantNetRouter = router({
  // ── Plano y salas ────────────────────────────────────────────────────────
  getFloor: adminrestProcedure.input(restaurantInput).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return rn.getFloor(input.restaurantId);
  }),

  listRooms: adminrestProcedure.input(restaurantInput.extend({ includeArchived: z.boolean().optional() })).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return rn.listRooms(input.restaurantId, input.includeArchived);
  }),

  listTables: adminrestProcedure.input(restaurantInput.extend({ includeArchived: z.boolean().optional() })).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return rn.listTables(input.restaurantId, input.includeArchived);
  }),

  createRoom: adminrestProcedure
    .input(z.object({ restaurantId: id, name, kind: z.enum(ROOM_KINDS).default("salon"), sortOrder: z.number().int().min(0).max(999).optional() }))
    .mutation(({ ctx, input }) => rn.createRoom(guardOf(ctx), input)),

  updateRoom: adminrestProcedure
    .input(z.object({ id, name: name.optional(), kind: z.enum(ROOM_KINDS).optional(), sortOrder: z.number().int().min(0).max(999).optional(), isActive: z.boolean().optional() }))
    .mutation(({ ctx, input }) => rn.updateRoom(guardOf(ctx), input)),

  createTable: adminrestProcedure
    .input(z.object({ roomId: id, code, shape: z.enum(TABLE_SHAPES).default("square"), capacity: z.number().int().min(1).max(50).default(4), posX: pos.optional(), posY: pos.optional() }))
    .mutation(({ ctx, input }) => rn.createTable(guardOf(ctx), input)),

  updateTable: adminrestProcedure
    .input(z.object({
      id, roomId: id.optional(), code: code.optional(), shape: z.enum(TABLE_SHAPES).optional(), capacity: z.number().int().min(1).max(50).optional(),
      posX: pos.optional(), posY: pos.optional(), width: z.number().min(40).max(400).optional(), height: z.number().min(40).max(400).optional(), isActive: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => rn.updateTable(guardOf(ctx), input)),

  mergeTables: adminrestProcedure
    .input(z.object({ primaryId: id, secondaryId: id }))
    .mutation(({ ctx, input }) => rn.mergeTables(guardOf(ctx), input.primaryId, input.secondaryId)),

  unmergeTable: adminrestProcedure.input(z.object({ tableId: id })).mutation(({ ctx, input }) => rn.unmergeTable(guardOf(ctx), input.tableId)),

  // ── Carta ────────────────────────────────────────────────────────────────
  listMenu: adminrestProcedure.input(restaurantInput.extend({ includeArchived: z.boolean().optional() })).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return rn.listMenu(input.restaurantId, input.includeArchived);
  }),

  upsertMenuItem: adminrestProcedure
    .input(z.object({
      id: id.optional(),
      restaurantId: id,
      name: z.string().trim().min(1, "Indica el nombre del plato").max(256),
      description: z.string().max(512).nullish(),
      category: z.string().max(128).nullish(),
      price: money,
      taxRate: z.number().refine((n) => (MENU_TAX_RATES as readonly number[]).includes(n), "Tipo de IVA no válido"),
      imageUrl: z.string().max(2000).nullish(),
      allergens: z.array(z.string().max(32)).max(20).optional(),
      station: z.string().max(40).nullish(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => rn.upsertMenuItem(guardOf(ctx), input)),

  setMenuItemActive: adminrestProcedure
    .input(z.object({ id, active: z.boolean() }))
    .mutation(({ ctx, input }) => rn.setMenuItemActive(guardOf(ctx), input.id, input.active)),

  reorderMenu: adminrestProcedure
    .input(z.object({ restaurantId: id, ids: z.array(id).max(1000) }))
    .mutation(({ ctx, input }) => rn.reorderMenu(guardOf(ctx), input.restaurantId, input.ids)),

  // ── Comandas ─────────────────────────────────────────────────────────────
  openOrder: adminrestProcedure
    .input(z.object({ tableId: id, guests: z.number().int().min(1).max(50).default(2), customerName: z.string().max(255).nullish() }))
    .mutation(({ ctx, input }) => rn.openOrder(guardOf(ctx), input, ctx.user.id)),

  getOrder: adminrestProcedure.input(z.object({ orderId: id })).query(({ ctx, input }) => rn.getOrder(guardOf(ctx), input.orderId)),

  updateOrder: adminrestProcedure
    .input(z.object({ orderId: id, guests: z.number().int().min(1).max(50).optional(), customerName: z.string().max(255).nullish(), notes: z.string().max(2000).nullish() }))
    .mutation(({ ctx, input }) => rn.updateOrder(guardOf(ctx), input)),

  addItem: adminrestProcedure
    .input(z.object({ orderId: id, menuItemId: id, quantity: z.number().int().min(1).max(99).default(1), notes: z.string().max(500).nullish(), seat: z.number().int().min(1).max(50).nullish(), course: z.number().int().min(1).max(9).optional() }))
    .mutation(({ ctx, input }) => rn.addItem(guardOf(ctx), input)),

  setItemQty: adminrestProcedure
    .input(z.object({ itemId: id, quantity: z.number().int().min(1).max(99) }))
    .mutation(({ ctx, input }) => rn.setItemQty(guardOf(ctx), input.itemId, input.quantity)),

  voidItem: adminrestProcedure
    .input(z.object({ itemId: id, reason: z.string().trim().min(3, "Indica el motivo de la anulación").max(255) }))
    .mutation(({ ctx, input }) => rn.voidItem(guardOf(ctx), input.itemId, input.reason, ctx.user.id)),

  requestBill: adminrestProcedure.input(z.object({ orderId: id })).mutation(({ ctx, input }) => rn.requestBill(guardOf(ctx), input.orderId)),

  reopenOrder: adminrestProcedure.input(z.object({ orderId: id })).mutation(({ ctx, input }) => rn.reopenOrder(guardOf(ctx), input.orderId)),

  releaseTable: adminrestProcedure
    .input(z.object({ orderId: id, reason: z.string().max(200).nullish() }))
    .mutation(({ ctx, input }) => rn.releaseTable(guardOf(ctx), input.orderId, input.reason ?? null, ctx.user.name ?? null)),

  /**
   * Cobro de la comanda con el TPV del Core (tpv.createSale con la sesión de caja elegida): una sola venta por comanda,
   * con el IVA de cada plato, la numeración de tickets y la caja (y sede) de la sesión. Devuelve el id de la venta; el
   * ticket se muestra con tpv.getSale.
   */
  checkout: adminrestProcedure
    .input(z.object({ orderId: id, sessionId: id, payments: z.array(payment).min(1).max(10), customerName: z.string().max(200).optional(), customerEmail: z.string().email().max(320).optional() }))
    .mutation(async ({ ctx, input }) => {
      // Llamar al TPV desde aquí no pasa por el guardián HTTP de su namespace: se comprueba su licencia (caja)
      const cash = await getCapabilityAccess().check("bill-cash", { write: true }).catch(() => ({ allowed: false }));
      if (!cash.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "La caja (TPV) no está incluida en tu plan o está en solo lectura: no se puede cobrar." });
      const tpv = tpvRouter.createCaller(ctx);
      return rn.checkout(guardOf(ctx), input, async (req) => {
        const r = await tpv.createSale({ ...req, discountAmount: 0, items: req.items.map((i) => ({ ...i, isManual: false })) });
        return { saleId: Number(r.sale?.id), ticketNumber: String(r.sale?.ticketNumber ?? ""), total: Number(r.sale?.total ?? 0), replayed: Boolean(r.replayed) };
      });
    }),

  // ── Cocina (KDS) ─────────────────────────────────────────────────────────
  /** Marchar a cocina las líneas pendientes de la comanda (todas o las de un pase). */
  fireItems: adminrestProcedure
    .input(z.object({ orderId: id, course: z.number().int().min(1).max(9).nullish() }))
    .mutation(({ ctx, input }) => kds.fireItems(guardOf(ctx), input.orderId, input.course ?? null)),

  /** Pantalla de cocina: líneas en cocina de las comandas abiertas (una partida, "" = sin partida, o todas). */
  kdsBoard: adminrestProcedure
    .input(restaurantInput.extend({ station: z.string().max(40).nullish() }))
    .query(async ({ ctx, input }) => {
      await guardOf(ctx)(input.restaurantId);
      return kds.kdsBoard(input.restaurantId, input.station ?? null);
    }),

  setKitchenStatus: adminrestProcedure
    .input(z.object({ itemId: id, status: z.enum(KITCHEN_FLOW) }))
    .mutation(({ ctx, input }) => kds.setKitchenStatus(guardOf(ctx), input.itemId, input.status)),

  serveReady: adminrestProcedure.input(z.object({ orderId: id })).mutation(({ ctx, input }) => kds.serveReady(guardOf(ctx), input.orderId)),

  setPriority: adminrestProcedure
    .input(z.object({ orderId: id, priority: z.enum(["normal", "high"]) }))
    .mutation(({ ctx, input }) => kds.setPriority(guardOf(ctx), input.orderId, input.priority)),

  listStations: adminrestProcedure.input(restaurantInput.extend({ includeArchived: z.boolean().optional() })).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return kds.listStations(input.restaurantId, input.includeArchived);
  }),

  upsertStation: adminrestProcedure
    .input(z.object({ id: id.optional(), restaurantId: id, name: z.string().trim().min(1, "Indica el nombre de la partida").max(40), tone: z.enum(STATION_TONES).default("neutral"), slaMinutes: z.number().int().min(1).max(180).default(15), isActive: z.boolean().optional() }))
    .mutation(({ ctx, input }) => kds.upsertStation(guardOf(ctx), input)),

  listRouting: adminrestProcedure.input(restaurantInput).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return kds.listRouting(input.restaurantId);
  }),

  setRouting: adminrestProcedure
    .input(z.object({ restaurantId: id, category: z.string().trim().min(1).max(128), station: z.string().max(40).nullable() }))
    .mutation(({ ctx, input }) => kds.setRouting(guardOf(ctx), input.restaurantId, input.category, input.station)),

  getKdsSettings: adminrestProcedure.input(restaurantInput).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return kds.getKdsSettings(input.restaurantId);
  }),

  setKdsSettings: adminrestProcedure
    .input(z.object({ restaurantId: id, greenMaxMin: z.number().int(), amberMaxMin: z.number().int() }))
    .mutation(({ ctx, input }) => kds.setKdsSettings(guardOf(ctx), input.restaurantId, input, ctx.user.id)),

  createIncident: adminrestProcedure
    .input(z.object({ orderId: id, itemId: id.nullish(), type: z.enum(INCIDENT_TYPES), reason: z.string().max(255).nullish() }))
    .mutation(({ ctx, input }) => kds.createIncident(guardOf(ctx), input, ctx.user.id)),

  listIncidents: adminrestProcedure
    .input(restaurantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .query(async ({ ctx, input }) => {
      await guardOf(ctx)(input.restaurantId);
      return kds.listIncidents(input.restaurantId, input.date ?? madridToday());
    }),

  kitchenMetrics: adminrestProcedure
    .input(restaurantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .query(async ({ ctx, input }) => {
      await guardOf(ctx)(input.restaurantId);
      return kds.kitchenMetricsOf(input.restaurantId, input.date ?? madridToday());
    }),

  // ── Camareros (usuarios del Core) ────────────────────────────────────────
  listWaiters: adminrestProcedure.input(restaurantInput).query(async ({ ctx, input }) => {
    await guardOf(ctx)(input.restaurantId);
    return kds.listWaiters(input.restaurantId);
  }),

  assignWaiter: adminrestProcedure
    .input(z.object({ orderId: id, userId: id.nullable() }))
    .mutation(({ ctx, input }) => kds.assignWaiter(guardOf(ctx), input.orderId, input.userId)),

  // ── Cargo a habitación (solo con Hotel Net) ──────────────────────────────
  /** ¿Se puede cargar a la habitación? y huéspedes en casa. Sin Hotel Net: no disponible (la opción no aparece). */
  roomGuests: adminrestProcedure.query(async () => {
    if (!(await hotelChargesEnabled())) return { available: false, guests: [] };
    return { available: true, guests: await listInHouseGuests() };
  }),

  /** Carga la comanda al folio del huésped y la cierra sin venta del TPV (se cobra al cerrar el folio). */
  chargeToRoom: adminrestProcedure
    .input(z.object({ orderId: id, hotelReservationId: id }))
    .mutation(({ ctx, input }) => rn.chargeOrderToRoom(guardOf(ctx), input.orderId, input.hotelReservationId, ctx.user.id)),

  // ── Carta QR y pedidos desde la mesa (página pública /mesa/<token>) ─────
  /** Enlace de cada mesa: si hay uno activo (el token no se puede volver a ver: se rota). */
  tableLinks: adminrestProcedure.input(restaurantInput).query(({ ctx, input }) => qr.tableLinks(guardOf(ctx), input.restaurantId)),

  /** Emite o rota el enlace (y el QR) de la mesa: el anterior deja de valer. Devuelve la URL una sola vez. */
  issueTableLink: adminrestProcedure.input(z.object({ tableId: id })).mutation(({ ctx, input }) => qr.issueTableLink(guardOf(ctx), input.tableId, `user:${ctx.user.id}`)),

  revokeTableLink: adminrestProcedure.input(z.object({ tableId: id })).mutation(({ ctx, input }) => qr.revokeTableLink(guardOf(ctx), input.tableId, `user:${ctx.user.id}`)),

  /** Pedidos enviados desde las mesas: pendientes de confirmar y últimos atendidos. */
  tableRequests: adminrestProcedure.input(restaurantInput).query(({ ctx, input }) => qr.listTableRequests(guardOf(ctx), input.restaurantId)),

  /** Confirma el pedido: pasa a la comanda de la mesa (no cobra; el cobro es el de siempre, en sala). */
  acceptTableRequest: adminrestProcedure.input(z.object({ requestId: id })).mutation(({ ctx, input }) => qr.acceptTableRequest(guardOf(ctx), input.requestId, ctx.user.id)),

  rejectTableRequest: adminrestProcedure
    .input(z.object({ requestId: id, reason: z.string().max(255).nullish() }))
    .mutation(({ ctx, input }) => qr.rejectTableRequest(guardOf(ctx), input.requestId, ctx.user.id, input.reason ?? null)),

  // ── Reservas en la sala ──────────────────────────────────────────────────
  listDayBookings: adminrestProcedure
    .input(restaurantInput.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .query(async ({ ctx, input }) => {
      await guardOf(ctx)(input.restaurantId);
      return rn.listDayBookings(input.restaurantId, input.date ?? madridToday());
    }),

  assignBookingTable: adminrestProcedure
    .input(z.object({ bookingId: id, tableId: id }))
    .mutation(({ ctx, input }) => rn.assignBookingTable(guardOf(ctx), input.bookingId, input.tableId)),

  unassignBookingTable: adminrestProcedure
    .input(z.object({ bookingId: id, tableId: id }))
    .mutation(({ ctx, input }) => rn.unassignBookingTable(guardOf(ctx), input.bookingId, input.tableId)),

  seatBooking: adminrestProcedure
    .input(z.object({ bookingId: id, tableId: id.optional() }))
    .mutation(({ ctx, input }) => rn.seatBooking(guardOf(ctx), input.bookingId, input.tableId ?? null, ctx.user.id)),
});
