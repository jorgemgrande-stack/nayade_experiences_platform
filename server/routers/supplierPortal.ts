/**
 * Router: Portal de Proveedor (supplier)
 * Acceso para usuarios con rol "supplier": ven SUS productos y las ventas de esos
 * productos por TODOS los canales (online, TPV, partner, ticketing…), además de sus
 * liquidaciones. Todo acotado a su propio supplierId vía supplierProcedure.
 */
import { TRPCError } from "@trpc/server";
import { router, supplierProcedure } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  suppliers, experiences, packs, roomTypes, spaTreatments,
  reservations, supplierSettlements,
} from "../../drizzle/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

const supplierIdOf = (ctx: { user: unknown }) => (ctx.user as { supplierId: number }).supplierId;

/** IDs de los productos (experiencias + packs + habitaciones) de un proveedor.
 *  Son los que aparecen como reservations.productId en todos los canales. */
async function getSupplierProductIds(supplierId: number): Promise<number[]> {
  const [exps, pks, rooms] = await Promise.all([
    db.select({ id: experiences.id }).from(experiences).where(eq(experiences.supplierId, supplierId)),
    db.select({ id: packs.id }).from(packs).where(eq(packs.supplierId, supplierId)),
    db.select({ id: roomTypes.id }).from(roomTypes).where(eq(roomTypes.supplierId, supplierId)),
  ]);
  return [...exps, ...pks, ...rooms].map(r => r.id);
}

export const supplierPortalRouter = router({
  /** Datos del proveedor del usuario logueado. */
  getMySupplier: supplierProcedure.query(async ({ ctx }) => {
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierIdOf(ctx))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado" });
    return row;
  }),

  /** Productos vinculados al proveedor (experiencias, packs, hotel, spa). */
  getMyProducts: supplierProcedure.query(async ({ ctx }) => {
    const supplierId = supplierIdOf(ctx);
    const [exps, pks, rooms, spas] = await Promise.all([
      db.select({ id: experiences.id, title: experiences.title, slug: experiences.slug, basePrice: experiences.basePrice })
        .from(experiences).where(eq(experiences.supplierId, supplierId)),
      db.select({ id: packs.id, title: packs.title, slug: packs.slug, basePrice: packs.basePrice })
        .from(packs).where(eq(packs.supplierId, supplierId)),
      db.select({ id: roomTypes.id, title: roomTypes.name, slug: roomTypes.slug, basePrice: roomTypes.basePrice })
        .from(roomTypes).where(eq(roomTypes.supplierId, supplierId)),
      db.select({ id: spaTreatments.id, title: spaTreatments.name, slug: spaTreatments.slug, basePrice: spaTreatments.price })
        .from(spaTreatments).where(eq(spaTreatments.supplierId, supplierId)),
    ]);
    return [
      ...exps.map(p => ({ ...p, type: "experiencia" as const })),
      ...pks.map(p => ({ ...p, type: "pack" as const })),
      ...rooms.map(p => ({ ...p, type: "hotel" as const })),
      ...spas.map(p => ({ ...p, type: "spa" as const })),
    ];
  }),

  /** Ventas de los productos del proveedor por TODOS los canales. */
  getMySales: supplierProcedure.query(async ({ ctx }) => {
    const productIds = await getSupplierProductIds(supplierIdOf(ctx));
    if (productIds.length === 0) {
      return { sales: [], summary: { totalSales: 0, totalRevenueEur: 0, byChannel: [] as Array<{ channel: string; count: number; revenueEur: number }> } };
    }
    const rows = await db.select({
      id: reservations.id,
      productId: reservations.productId,
      productName: reservations.productName,
      channel: reservations.channel,
      channelDetail: reservations.channelDetail,
      platformName: reservations.platformName,
      bookingDate: reservations.bookingDate,
      people: reservations.people,
      amountTotal: reservations.amountTotal,
      status: reservations.status,
      customerName: reservations.customerName,
      createdAt: reservations.createdAt,
    }).from(reservations)
      .where(and(
        inArray(reservations.productId, productIds),
        inArray(reservations.status, ["paid", "pending_payment", "cancelled", "failed"]),
      ))
      .orderBy(desc(reservations.createdAt));

    const sales = rows.map(r => ({ ...r, amountEur: (r.amountTotal ?? 0) / 100 }));

    // Resumen: solo ventas efectivas (status = paid), agregadas por canal.
    const paid = sales.filter(s => s.status === "paid");
    const byChannelMap = new Map<string, { count: number; revenueEur: number }>();
    for (const s of paid) {
      const k = s.channel ?? "OTRO";
      const cur = byChannelMap.get(k) ?? { count: 0, revenueEur: 0 };
      cur.count += 1;
      cur.revenueEur += s.amountEur;
      byChannelMap.set(k, cur);
    }
    const byChannel = Array.from(byChannelMap.entries()).map(([channel, v]) => ({ channel, count: v.count, revenueEur: Math.round(v.revenueEur * 100) / 100 }));
    const summary = {
      totalSales: paid.length,
      totalRevenueEur: Math.round(paid.reduce((s, x) => s + x.amountEur, 0) * 100) / 100,
      byChannel,
    };
    return { sales, summary };
  }),

  /** Liquidaciones del proveedor. */
  getMySettlements: supplierProcedure.query(async ({ ctx }) => {
    return db.select().from(supplierSettlements)
      .where(eq(supplierSettlements.supplierId, supplierIdOf(ctx)))
      .orderBy(desc(supplierSettlements.periodTo));
  }),
});
