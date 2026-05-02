/**
 * Centro de Control Diario — Backend
 *
 * Read-only aggregation of daily economic/operational data.
 * Sources: reservations (bookingDate), tpv_sales (serviceDate),
 *          tpv_sale_items, tpv_sale_payments.
 * Does NOT modify any existing table or flow.
 */

import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  reservations,
  tpvSales,
  tpvSaleItems,
  tpvSalePayments,
} from "../../drizzle/schema";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(pool);

const dailyControlProc = permissionProcedure("accounting.daily_control", ["admin", "controler"]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function p(v: string | null | undefined): number {
  return parseFloat(v ?? "0") || 0;
}

const CHANNEL_LABELS: Record<string, string> = {
  ONLINE_DIRECTO: "Ecommerce / Online",
  ONLINE_ASISTIDO: "Online asistido",
  VENTA_DELEGADA: "Venta delegada",
  TPV_FISICO: "TPV físico (reserva)",
  PARTNER: "Partner / Operador",
  MANUAL: "Manual / Admin",
  API: "API",
  web: "Web",
  crm: "CRM",
  telefono: "Teléfono",
  email: "Email",
  otro: "Otro",
  tpv: "TPV",
  groupon: "Groupon",
  tpv_module: "TPV (módulo caja)",
};

function channelLabel(ch: string | null | undefined): string {
  return CHANNEL_LABELS[ch ?? ""] ?? ch ?? "Desconocido";
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  other: "Otro",
};

// ─── Core function ───────────────────────────────────────────────────────────

export async function getDailyControlCenter(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Formato de fecha inválido (YYYY-MM-DD)" });
  }

  const yesterday = offsetDate(date, -1);

  // Reservations auto-created by createSale are already counted via tpv_sales.
  // Exclude them from all reservations aggregations to avoid double-counting.
  const notLinkedToTpv = sql`${reservations.id} NOT IN (
  SELECT ${tpvSales.reservationId} FROM ${tpvSales}
  WHERE ${tpvSales.reservationId} IS NOT NULL
)`;

  const [
    resExecSum,         // 0  reservations executed today — aggregate
    tpvExecSum,         // 1  tpv_sales executed today — aggregate
    resByChannel,       // 2  reservations channel breakdown (exec today)
    resActivities,      // 3  reservations product breakdown (exec today)
    tpvActivities,      // 4  tpv_sale_items product breakdown (exec today)
    resList,            // 5  reservations list (exec today)
    tpvList,            // 6  tpv_sales list (exec today)
    tpvPayMethods,      // 7  tpv payment methods (exec today, completed)
    tpvCancelled,       // 8  tpv cancelled today
    resCancelled,       // 9  reservations cancelled today (exec date)
    yRes,               // 10 yesterday reservations exec
    yTpv,               // 11 yesterday tpv exec
    pendingPayAlert,    // 12 exec today + payment pending
    missingPhoneAlert,  // 13 exec today + no phone
  ] = await Promise.all([

    // 0 — reservations exec today summary
    db.select({
      count:      sql<number>`COUNT(*)`,
      totalCents: sql<string>`COALESCE(SUM(${reservations.amountTotal}), 0)`,
      paidCents:  sql<string>`COALESCE(SUM(${reservations.amountPaid}), 0)`,
      people:     sql<string>`COALESCE(SUM(${reservations.people}), 0)`,
    }).from(reservations).where(
      and(
        eq(reservations.bookingDate, date),
        sql`${reservations.status} NOT IN ('cancelled','failed')`,
        notLinkedToTpv,
      )
    ),

    // 1 — tpv exec today summary
    db.select({
      count:      sql<number>`COUNT(*)`,
      total:      sql<string>`COALESCE(SUM(${tpvSales.total}), 0)`,
      taxBase:    sql<string>`COALESCE(SUM(${tpvSales.taxBase}), 0)`,
      taxAmount:  sql<string>`COALESCE(SUM(${tpvSales.taxAmount}), 0)`,
      reavMargin: sql<string>`COALESCE(SUM(${tpvSales.reavMargin}), 0)`,
    }).from(tpvSales).where(
      and(
        eq(tpvSales.serviceDate, date),
        sql`${tpvSales.status} NOT IN ('cancelled','refunded')`
      )
    ),

    // 2 — reservations by channel (exec today)
    db.select({
      channel:    reservations.channel,
      count:      sql<number>`COUNT(*)`,
      totalCents: sql<string>`COALESCE(SUM(${reservations.amountTotal}), 0)`,
      paidCents:  sql<string>`COALESCE(SUM(${reservations.amountPaid}), 0)`,
      people:     sql<string>`COALESCE(SUM(${reservations.people}), 0)`,
    }).from(reservations).where(
      and(
        eq(reservations.bookingDate, date),
        sql`${reservations.status} NOT IN ('cancelled','failed')`,
        notLinkedToTpv,
      )
    ).groupBy(reservations.channel),

    // 3 — reservations by product (exec today)
    db.select({
      activity:   reservations.productName,
      count:      sql<number>`COUNT(*)`,
      people:     sql<string>`COALESCE(SUM(${reservations.people}), 0)`,
      totalCents: sql<string>`COALESCE(SUM(${reservations.amountTotal}), 0)`,
      paidCents:  sql<string>`COALESCE(SUM(${reservations.amountPaid}), 0)`,
    }).from(reservations).where(
      and(
        eq(reservations.bookingDate, date),
        sql`${reservations.status} NOT IN ('cancelled','failed')`,
        notLinkedToTpv,
      )
    ).groupBy(reservations.productName)
      .orderBy(sql`SUM(${reservations.amountTotal}) DESC`),

    // 4 — tpv items by product (exec today)
    db.select({
      activity:   tpvSaleItems.productName,
      count:      sql<number>`COUNT(DISTINCT ${tpvSaleItems.saleId})`,
      people:     sql<string>`COALESCE(SUM(${tpvSaleItems.participants}), 0)`,
      total:      sql<string>`COALESCE(SUM(${tpvSaleItems.subtotal}), 0)`,
      reavMargin: sql<string>`COALESCE(SUM(${tpvSaleItems.reavMargin}), 0)`,
      taxAmount:  sql<string>`COALESCE(SUM(${tpvSaleItems.taxAmount}), 0)`,
    }).from(tpvSaleItems)
      .innerJoin(tpvSales, eq(tpvSaleItems.saleId, tpvSales.id))
      .where(
        and(
          eq(tpvSales.serviceDate, date),
          sql`${tpvSales.status} NOT IN ('cancelled','refunded')`
        )
      )
      .groupBy(tpvSaleItems.productName)
      .orderBy(sql`SUM(${tpvSaleItems.subtotal}) DESC`),

    // 5 — reservations list (exec today, all statuses)
    db.select({
      id:                reservations.id,
      reservationNumber: reservations.reservationNumber,
      customerName:      reservations.customerName,
      customerPhone:     reservations.customerPhone,
      customerEmail:     reservations.customerEmail,
      channel:           reservations.channel,
      status:            reservations.status,
      statusReservation: reservations.statusReservation,
      statusPayment:     reservations.statusPayment,
      bookingDate:       reservations.bookingDate,
      createdAt:         reservations.createdAt,
      amountTotal:       reservations.amountTotal,
      amountPaid:        reservations.amountPaid,
      people:            reservations.people,
      productName:       reservations.productName,
      paymentMethod:     reservations.paymentMethod,
      notes:             reservations.notes,
    }).from(reservations)
      .where(and(eq(reservations.bookingDate, date), notLinkedToTpv))
      .orderBy(desc(reservations.createdAt))
      .limit(200),

    // 6 — tpv sales list (exec today, all statuses)
    db.select({
      id:           tpvSales.id,
      ticketNumber: tpvSales.ticketNumber,
      customerName: tpvSales.customerName,
      customerPhone:tpvSales.customerPhone,
      customerEmail:tpvSales.customerEmail,
      serviceDate:  tpvSales.serviceDate,
      createdAt:    tpvSales.createdAt,
      total:        tpvSales.total,
      status:       tpvSales.status,
      saleChannel:  tpvSales.saleChannel,
      taxBase:      tpvSales.taxBase,
      taxAmount:    tpvSales.taxAmount,
      reavMargin:   tpvSales.reavMargin,
      sellerName:   tpvSales.sellerName,
      paidAt:       tpvSales.paidAt,
    }).from(tpvSales)
      .where(eq(tpvSales.serviceDate, date))
      .orderBy(desc(tpvSales.createdAt))
      .limit(200),

    // 7 — tpv payment methods (exec today, completed)
    db.select({
      method: tpvSalePayments.method,
      total:  sql<string>`COALESCE(SUM(${tpvSalePayments.amount}), 0)`,
      count:  sql<number>`COUNT(*)`,
    }).from(tpvSalePayments)
      .innerJoin(tpvSales, eq(tpvSalePayments.saleId, tpvSales.id))
      .where(
        and(
          eq(tpvSales.serviceDate, date),
          eq(tpvSalePayments.status, "completed"),
          sql`${tpvSales.status} NOT IN ('cancelled','refunded')`
        )
      )
      .groupBy(tpvSalePayments.method),

    // 8 — tpv cancelled today
    db.select({
      count: sql<number>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${tpvSales.total}), 0)`,
    }).from(tpvSales).where(
      and(
        eq(tpvSales.serviceDate, date),
        sql`${tpvSales.status} IN ('cancelled','refunded')`
      )
    ),

    // 9 — reservations cancelled (exec today)
    db.select({
      count:      sql<number>`COUNT(*)`,
      totalCents: sql<string>`COALESCE(SUM(${reservations.amountTotal}), 0)`,
    }).from(reservations).where(
      and(
        eq(reservations.bookingDate, date),
        sql`${reservations.status} IN ('cancelled','failed')`,
        notLinkedToTpv,
      )
    ),

    // 10 — yesterday reservations executed
    db.select({
      count:      sql<number>`COUNT(*)`,
      totalCents: sql<string>`COALESCE(SUM(${reservations.amountTotal}), 0)`,
      people:     sql<string>`COALESCE(SUM(${reservations.people}), 0)`,
    }).from(reservations).where(
      and(
        eq(reservations.bookingDate, yesterday),
        sql`${reservations.status} NOT IN ('cancelled','failed')`,
        notLinkedToTpv,
      )
    ),

    // 11 — yesterday tpv executed
    db.select({
      count: sql<number>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${tpvSales.total}), 0)`,
    }).from(tpvSales).where(
      and(
        eq(tpvSales.serviceDate, yesterday),
        sql`${tpvSales.status} NOT IN ('cancelled','refunded')`
      )
    ),

    // 12 — exec today + pending payment (alert)
    db.select({
      count:      sql<number>`COUNT(*)`,
      totalCents: sql<string>`COALESCE(SUM(${reservations.amountTotal} - ${reservations.amountPaid}), 0)`,
    }).from(reservations).where(
      and(
        eq(reservations.bookingDate, date),
        sql`${reservations.status} NOT IN ('cancelled','failed')`,
        sql`${reservations.statusPayment} IN ('PENDIENTE','PAGO_PARCIAL')`,
        notLinkedToTpv,
      )
    ),

    // 13 — exec today + missing phone (alert)
    db.select({ count: sql<number>`COUNT(*)` })
      .from(reservations)
      .where(
        and(
          eq(reservations.bookingDate, date),
          sql`${reservations.status} NOT IN ('cancelled','failed')`,
          sql`(${reservations.customerPhone} IS NULL OR ${reservations.customerPhone} = '')`,
          notLinkedToTpv,
        )
      ),
  ]);

  // ─── Derived KPIs ────────────────────────────────────────────────────────

  const re = resExecSum[0]!;
  const te = tpvExecSum[0]!;

  const resTotalEur   = p(re.totalCents) / 100;
  const resPaidEur    = p(re.paidCents)  / 100;
  const tpvTotalEur   = p(te.total);
  const facturacion   = resTotalEur + tpvTotalEur;
  const cobradoHoy    = resPaidEur  + tpvTotalEur; // TPV is always paid when status=paid
  const pendiente     = resTotalEur - resPaidEur;
  const nOps          = Number(re.count) + Number(te.count);
  const nPersonas     = Number(p(re.people));
  const ticketMedio   = nOps > 0 ? facturacion / nOps : 0;
  const importeIVA    = p(te.taxAmount);
  const importeReav   = p(te.reavMargin);
  const nAnuladas     = Number(resCancelled[0]?.count ?? 0) + Number(tpvCancelled[0]?.count ?? 0);

  // ─── Channel breakdown ───────────────────────────────────────────────────

  const chMap = new Map<string, {
    channel: string; label: string; count: number; total: number;
    paid: number; pending: number; people: number;
  }>();

  for (const r of resByChannel) {
    const key   = r.channel ?? "MANUAL";
    const total = p(r.totalCents) / 100;
    const paid  = p(r.paidCents)  / 100;
    const cur   = chMap.get(key) ?? { channel: key, label: channelLabel(key), count: 0, total: 0, paid: 0, pending: 0, people: 0 };
    cur.count  += Number(r.count);
    cur.total  += total;
    cur.paid   += paid;
    cur.pending += total - paid;
    cur.people += Number(p(r.people));
    chMap.set(key, cur);
  }

  if (Number(te.count) > 0) {
    const key = "tpv_module";
    const cur = chMap.get(key) ?? { channel: key, label: "TPV (módulo caja)", count: 0, total: 0, paid: 0, pending: 0, people: 0 };
    cur.count  += Number(te.count);
    cur.total  += tpvTotalEur;
    cur.paid   += tpvTotalEur;
    chMap.set(key, cur);
  }

  const channels = Array.from(chMap.values())
    .map(c => ({ ...c, ticketMedio: c.count > 0 ? c.total / c.count : 0 }))
    .sort((a, b) => b.total - a.total);

  // ─── Activity breakdown ──────────────────────────────────────────────────

  const actMap = new Map<string, {
    name: string; count: number; people: number; totalEur: number;
    paidEur: number; reavMargin: number; taxAmount: number; source: string;
  }>();

  for (const r of resActivities) {
    const key   = r.activity;
    const total = p(r.totalCents) / 100;
    const paid  = p(r.paidCents)  / 100;
    const cur   = actMap.get(key) ?? { name: key, count: 0, people: 0, totalEur: 0, paidEur: 0, reavMargin: 0, taxAmount: 0, source: "Reservas" };
    cur.count  += Number(r.count);
    cur.people += Number(p(r.people));
    cur.totalEur += total;
    cur.paidEur  += paid;
    actMap.set(key, cur);
  }

  for (const r of tpvActivities) {
    const key   = r.activity;
    const total = p(r.total);
    const cur   = actMap.get(key) ?? { name: key, count: 0, people: 0, totalEur: 0, paidEur: 0, reavMargin: 0, taxAmount: 0, source: "TPV" };
    cur.count     += Number(r.count);
    cur.people    += Number(p(r.people));
    cur.totalEur  += total;
    cur.paidEur   += total;
    cur.reavMargin += p(r.reavMargin);
    cur.taxAmount  += p(r.taxAmount);
    actMap.set(key, cur);
  }

  const activities = Array.from(actMap.values())
    .map(a => ({
      ...a,
      avgPrice:  a.count > 0 ? a.totalEur / a.count : 0,
      pendingEur: a.totalEur - a.paidEur,
    }))
    .sort((a, b) => b.totalEur - a.totalEur);

  // ─── Operations list ─────────────────────────────────────────────────────

  const operations = [
    ...resList.map(r => ({
      type:              "reservation" as const,
      id:                r.id,
      ref:               r.reservationNumber ?? `RES-${r.id}`,
      customer:          r.customerName,
      phone:             r.customerPhone  ?? null,
      email:             r.customerEmail  ?? null,
      channel:           channelLabel(r.channel),
      channelKey:        r.channel ?? "MANUAL",
      status:            r.status,
      statusReservation: r.statusReservation ?? "PENDIENTE_CONFIRMACION",
      statusPayment:     r.statusPayment     ?? "PENDIENTE",
      saleDate:          r.createdAt,
      executionDate:     r.bookingDate,
      totalEur:          r.amountTotal / 100,
      paidEur:           (r.amountPaid ?? 0) / 100,
      pendingEur:        (r.amountTotal - (r.amountPaid ?? 0)) / 100,
      paymentMethod:     r.paymentMethod ?? null,
      activity:          r.productName,
      people:            r.people,
      notes:             r.notes ?? null,
    })),
    ...tpvList.map(t => ({
      type:              "tpv" as const,
      id:                t.id,
      ref:               t.ticketNumber,
      customer:          t.customerName ?? "—",
      phone:             t.customerPhone ?? null,
      email:             t.customerEmail ?? null,
      channel:           "TPV (módulo caja)",
      channelKey:        "tpv_module",
      status:            t.status,
      statusReservation: "CONFIRMADA" as const,
      statusPayment:     (t.status === "paid" ? "PAGADO" : "PENDIENTE") as string,
      saleDate:          t.createdAt,
      executionDate:     t.serviceDate ?? date,
      totalEur:          p(t.total),
      paidEur:           t.status === "paid" ? p(t.total) : 0,
      pendingEur:        t.status === "paid" ? 0 : p(t.total),
      paymentMethod:     null,
      activity:          "—",
      people:            0,
      notes:             null,
    })),
  ].sort((a, b) => Number(b.saleDate) - Number(a.saleDate));

  // ─── Cash & payments ─────────────────────────────────────────────────────

  const byMethod = tpvPayMethods.map(m => ({
    method: m.method,
    label:  METHOD_LABELS[m.method] ?? m.method,
    amount: p(m.total),
    count:  Number(m.count),
  }));

  // ─── Yesterday comparison ─────────────────────────────────────────────────

  const yr = yRes[0]!;
  const yt = yTpv[0]!;
  const yFact = p(yr.totalCents) / 100 + p(yt.total);
  const yOps  = Number(yr.count) + Number(yt.count);
  const yPers = Number(p(yr.people));

  function pctChange(today: number, yesterday: number): number | null {
    if (yesterday === 0) return null;
    return Math.round(((today - yesterday) / yesterday) * 100);
  }

  // ─── Alerts ──────────────────────────────────────────────────────────────

  const alerts: Array<{
    level: "info" | "warning" | "critical";
    type: string;
    description: string;
    amount?: number;
  }> = [];

  const pendingCount = Number(pendingPayAlert[0]?.count ?? 0);
  if (pendingCount > 0) {
    alerts.push({
      level: "warning",
      type: "pending_payment",
      description: `${pendingCount} reserva${pendingCount > 1 ? "s" : ""} ejecutada${pendingCount > 1 ? "s" : ""} hoy con pago pendiente`,
      amount: p(pendingPayAlert[0]!.totalCents) / 100,
    });
  }

  const noPhoneCount = Number(missingPhoneAlert[0]?.count ?? 0);
  if (noPhoneCount > 0) {
    alerts.push({
      level: "info",
      type: "missing_phone",
      description: `${noPhoneCount} reserva${noPhoneCount > 1 ? "s" : ""} sin teléfono de contacto`,
    });
  }

  const cancelledCount = Number(resCancelled[0]?.count ?? 0) + Number(tpvCancelled[0]?.count ?? 0);
  if (cancelledCount > 0) {
    const cancelledAmt = p(resCancelled[0]?.totalCents) / 100 + p(tpvCancelled[0]?.total);
    alerts.push({
      level: "info",
      type: "cancelled",
      description: `${cancelledCount} operación${cancelledCount > 1 ? "es" : ""} anulada${cancelledCount > 1 ? "s" : ""} en el día`,
      amount: cancelledAmt,
    });
  }

  // ─── Fiscal summary ───────────────────────────────────────────────────────

  const fiscal = {
    taxBase:             p(te.taxBase),
    ivaAmount:           importeIVA,
    reavMargin:          importeReav,
    total:               facturacion,
    operacionesTPV:      Number(te.count),
    operacionesReservas: Number(re.count),
  };

  return {
    date,
    yesterday,
    lastUpdatedAt: new Date().toISOString(),
    kpis: {
      facturacionTotal:    facturacion,
      cobradoHoy,
      pendienteCobro:      pendiente,
      nReservasEjecutadas: Number(re.count),
      nOperacionesTPV:     Number(te.count),
      nPersonasAtendidas:  nPersonas,
      ticketMedio,
      importeReav,
      importeIVA,
      nAnuladas,
      // Yesterday deltas
      pctFacturacion: pctChange(facturacion,  yFact),
      pctOperaciones: pctChange(nOps,          yOps),
      pctPersonas:    pctChange(nPersonas,     yPers),
    },
    channels,
    operations,
    activities,
    cash: {
      totalCobrado: cobradoHoy,
      byMethod,
      pendiente,
      anulaciones: p(resCancelled[0]?.totalCents) / 100 + p(tpvCancelled[0]?.total),
    },
    alerts,
    fiscal,
  };
}

// ─── tRPC router ─────────────────────────────────────────────────────────────

export const dailyControlRouter = router({
  get: dailyControlProc
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida") }))
    .query(async ({ input }) => {
      return getDailyControlCenter(input.date);
    }),
});

export type DailyControlData = Awaited<ReturnType<typeof getDailyControlCenter>>;
