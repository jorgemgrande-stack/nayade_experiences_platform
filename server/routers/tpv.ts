import { z } from "zod";
import { permissionProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { buildReservationConfirmHtml, buildTpvTicketHtml, buildCashOpenHtml, buildCashCloseHtml, type ChannelSummary } from "../emailTemplates";
import { sendEmail } from "../mailer";
import { sendManagedEmail } from "../emailManager";
import { getBusinessEmail, getFeatureFlag, getSystemSetting } from "../config";
import { madridDateKey } from "../utils/timezone";
import { createReavExpedient, attachReavDocument, upsertClientFromReservation, postConfirmOperation, logActivity, getGHLCredentials } from "../db";
import { createGHLContact, triggerGHLWorkflow, syncLeadUrlsToGHL } from "../ghl";
import { createCashMovementIfNotExists, getDefaultCashAccountId, recordCashTransferToCentral } from "./cashRegisterHelper";
import { calcularREAVSimple } from "../reav";
import { getDailyControlCenter } from "./dailyControl";
import {
  cashRegisters,
  cashSessions,
  cashMovements,
  tpvSales,
  tpvSaleItems,
  tpvSalePayments,
  experiences,
  experienceVariants,
  packs,
  spaTreatments,
  roomTypes,
  reservations,
  transactions,
  legoPacks,
  legoPackSnapshots,
  finCashAccounts,
  finCashMovements,
  finCashClosures,
  finCashAlerts,
  expenses,
  expenseCategories,
  costCenters,
  invoices,
  leads,
} from "../../drizzle/schema";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { generateDocumentNumber } from "../documentNumbers";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

// --- RBAC-AWARE PROCEDURES ----------------------------------------------------
// Fallback: legacy staff roles (admin + agente) for all TPV access.
// RBAC expands access to commercial_agent / sales_cashier without touching fallback.
const tpvAccessProc    = permissionProcedure("tpv.access",     ["admin", "agente"]);
const tpvSellProc      = permissionProcedure("tpv.sell",       ["admin", "agente"]);
const tpvOpenCloseProc = permissionProcedure("tpv.open_close", ["admin", "agente"]);
const tpvBackofficeProc= permissionProcedure("tpv.backoffice", ["admin"]);

// --- HELPERS -----------------------------------------------------------------
// generateTicketNumber y generateReservationRef reemplazadas por el helper centralizado
async function generateTicketNumber(userId?: string): Promise<string> {
  return generateDocumentNumber("tpv", "tpv:createSale", userId ?? "system");
}
async function generateReservationRef(userId?: string): Promise<string> {
  return generateDocumentNumber("reserva", "tpv:createSale", userId ?? "system");
}

function generateTransactionNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `TXN-${date}-${rand}`;
}

import { normalizeRegime, calcGeneralTax } from "../taxUtils";

type FiscalData = { fiscalRegime: "reav" | "general" | "mixed"; taxRate: number; providerPercent: number; agencyMarginPercent: number };

/**
 * Obtiene el régimen fiscal y porcentajes REAV de un producto consultando la BD.
 * Coerciona valores legacy "general_21" automáticamente.
 */
async function getProductFiscalData(
  productType: string,
  productId: number
): Promise<FiscalData> {
  const fallback: FiscalData = { fiscalRegime: "general", taxRate: 21, providerPercent: 60, agencyMarginPercent: 40 };
  try {
    const toFiscalData = (row: { fiscalRegime: string | null; taxRate?: unknown; providerPercent: unknown; agencyMarginPercent: unknown }): FiscalData => {
      const { regime, taxRate: legacyRate } = normalizeRegime(row.fiscalRegime);
      return {
        fiscalRegime: regime,
        taxRate: row.taxRate != null ? parseFloat(String(row.taxRate)) : legacyRate,
        providerPercent: parseFloat(String(row.providerPercent ?? 60)),
        agencyMarginPercent: parseFloat(String(row.agencyMarginPercent ?? 40)),
      };
    };
    if (productType === "experience") {
      const [row] = await db.select({ fiscalRegime: experiences.fiscalRegime, taxRate: experiences.taxRate, providerPercent: experiences.providerPercent, agencyMarginPercent: experiences.agencyMarginPercent }).from(experiences).where(eq(experiences.id, productId));
      if (row) return toFiscalData(row);
    } else if (productType === "pack") {
      const [row] = await db.select({ fiscalRegime: packs.fiscalRegime, taxRate: packs.taxRate, providerPercent: packs.providerPercent, agencyMarginPercent: packs.agencyMarginPercent }).from(packs).where(eq(packs.id, productId));
      if (row) return toFiscalData(row);
    } else if (productType === "spa") {
      const [row] = await db.select({ fiscalRegime: spaTreatments.fiscalRegime, taxRate: spaTreatments.taxRate, providerPercent: spaTreatments.providerPercent, agencyMarginPercent: spaTreatments.agencyMarginPercent }).from(spaTreatments).where(eq(spaTreatments.id, productId));
      if (row) return toFiscalData(row);
    } else if (productType === "hotel") {
      const [row] = await db.select({ fiscalRegime: roomTypes.fiscalRegime, taxRate: roomTypes.taxRate, providerPercent: roomTypes.providerPercent, agencyMarginPercent: roomTypes.agencyMarginPercent }).from(roomTypes).where(eq(roomTypes.id, productId));
      if (row) return toFiscalData(row);
    }
  } catch { /* fallback */ }
  return fallback;
}

/**
 * Calcula la fiscalidad de una línea de venta.
 * Para régimen "general": base = precio / (1 + taxRate/100) — soporta 21%, 10%, etc.
 * Para REAV: usa calcularREAVSimple() — lógica separada, sin IVA repercutido.
 */
function calcLineFiscal(
  lineTotal: number,
  fiscalRegime: "reav" | "general" | "mixed",
  taxRate = 21,
  providerPercent = 60,
  agencyMarginPercent = 40
): { taxBase: number; taxAmount: number; taxRate: number; reavCost: number; reavMargin: number; reavTax: number } {
  if (fiscalRegime === "reav") {
    const { costeProveedor, margenAgencia, iva } = calcularREAVSimple(lineTotal, providerPercent, agencyMarginPercent);
    return { taxBase: 0, taxAmount: 0, taxRate: 0, reavCost: costeProveedor, reavMargin: margenAgencia, reavTax: iva };
  }
  const { taxBase, taxAmount } = calcGeneralTax(lineTotal, taxRate);
  return { taxBase, taxAmount, taxRate, reavCost: 0, reavMargin: 0, reavTax: 0 };
}

// --- EMAIL DE CIERRE DE CAJA -------------------------------------------------

/**
 * Compone y envía el email de cierre de caja para una sesión TPV ya cerrada.
 *
 * Reutilizable desde:
 *   - El handler `closeSession` (envío automático al cerrar).
 *   - Scripts de re-envío manual (p.ej. para QA o reenviar a otro destinatario).
 *
 * Enriquece el email con el snapshot del Centro de Control Diario
 * (`getDailyControlCenter`) para incluir resumen ejecutivo del día y desglose
 * por canal con cobrado/pendiente/personas/ticket medio.
 *
 * No lanza si falla la llamada al Control Diario: degrada elegantemente al
 * formato clásico del email para no bloquear el aviso del cierre.
 *
 * @param sessionId  ID de la sesión TPV cerrada.
 * @param opts.toOverride  Destinatario alternativo (anula `admin_alerts`).
 *                         Útil para re-envíos de prueba.
 * @param opts.subjectPrefix Prefijo opcional al subject (p.ej. "[REENVÍO] ").
 */
export async function sendCashCloseEmailForSession(
  sessionId: number,
  opts: { toOverride?: string; subjectPrefix?: string } = {},
): Promise<{ to: string; subject: string }> {
  const closeEmailEnabled = await getFeatureFlag("tpv_email_notifications_enabled", true);
  if (!closeEmailEnabled && !opts.toOverride) {
    throw new Error("tpv_email_notifications_enabled=false");
  }

  const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, sessionId));
  if (!session) throw new Error(`Sesión ${sessionId} no encontrada`);
  if (session.status !== "closed") {
    throw new Error(`Sesión ${sessionId} no está cerrada (status=${session.status})`);
  }

  const [register] = await db
    .select({ name: cashRegisters.name })
    .from(cashRegisters)
    .where(eq(cashRegisters.id, session.registerId));

  // Derivar fecha del día desde openedAt (clave para snapshot del Control Diario).
  const sessionDate = new Date(Number(session.openedAt)).toISOString().slice(0, 10);

  // Reservas del día (excluyendo TPV físico) para el desglose por canal LEGACY,
  // que se usa como fallback si no llega snapshot del Control Diario.
  const dayReservations = await db
    .select({
      channel: reservations.channel,
      paymentMethod: reservations.paymentMethod,
      amountTotal: reservations.amountTotal,
    })
    .from(reservations)
    .where(and(
      gte(reservations.bookingDate, sessionDate),
      lte(reservations.bookingDate, sessionDate),
      eq(reservations.status, "paid"),
    ));

  const channelMap: Record<string, ChannelSummary> = {};
  const CHANNEL_LABELS: Record<string, string> = {
    WEB: "Online / Redsys",
    CRM: "CRM / Manual",
    EMAIL: "CRM / Manual",
    TRANSFERENCIA: "Transferencia",
    CUPON: "Cupón / Descuento",
  };
  for (const r of dayReservations) {
    const ch = (r.channel ?? "OTRO").toUpperCase();
    if (ch === "TPV_FISICO") continue;
    const pm = (r.paymentMethod ?? "otro").toLowerCase();
    const amt = (r.amountTotal ?? 0) / 100;
    if (!channelMap[ch]) {
      channelMap[ch] = {
        channel: ch,
        label: CHANNEL_LABELS[ch] ?? ch,
        totalEfectivo: 0,
        totalTarjeta: 0,
        totalBizum: 0,
        totalOtro: 0,
        totalVentas: 0,
        numVentas: 0,
      };
    }
    channelMap[ch].numVentas++;
    channelMap[ch].totalVentas += amt;
    if (pm === "efectivo") channelMap[ch].totalEfectivo += amt;
    else if (pm === "redsys" || pm === "tarjeta") channelMap[ch].totalTarjeta += amt;
    else if (pm === "bizum") channelMap[ch].totalBizum += amt;
    else channelMap[ch].totalOtro += amt;
  }

  // Snapshot operativo del día — alimenta el resumen ejecutivo y el desglose
  // enriquecido por canal. Degradación elegante si falla (email sin extras).
  let dailyControl = null as null | {
    kpis: {
      facturacionTotal: number; cobradoHoy: number; pendienteCobro: number;
      nReservasEjecutadas: number; nOperacionesTPV: number;
      nPersonasAtendidas: number; ticketMedio: number;
    };
    channels: Array<{
      label: string; count: number; people: number; paid: number;
      pending: number; total: number; ticketMedio: number;
    }>;
  };
  try {
    const dc = await getDailyControlCenter(sessionDate);
    dailyControl = {
      kpis: {
        facturacionTotal: dc.kpis.facturacionTotal,
        cobradoHoy: dc.kpis.cobradoHoy,
        pendienteCobro: dc.kpis.pendienteCobro,
        nReservasEjecutadas: dc.kpis.nReservasEjecutadas,
        nOperacionesTPV: dc.kpis.nOperacionesTPV,
        nPersonasAtendidas: dc.kpis.nPersonasAtendidas,
        ticketMedio: dc.kpis.ticketMedio,
      },
      channels: dc.channels.map((c) => ({
        label: c.label,
        count: c.count,
        people: c.people,
        paid: c.paid,
        pending: c.pending,
        total: c.total,
        ticketMedio: c.ticketMedio,
      })),
    };
  } catch (e) {
    console.warn("[TPV] sendCashCloseEmailForSession: no se pudo cargar Control Diario, email sin extras:", e);
  }

  const html = buildCashCloseHtml({
    sessionId,
    cashierName: session.cashierName ?? "Cajero",
    registerName: register?.name ?? `Caja #${session.registerId}`,
    openedAt: new Date(Number(session.openedAt)),
    closedAt: session.closedAt ? new Date(Number(session.closedAt)) : new Date(),
    openingAmount: parseFloat(String(session.openingAmount)),
    totalCash: parseFloat(String(session.totalCash ?? "0")),
    totalCard: parseFloat(String(session.totalCard ?? "0")),
    totalBizum: parseFloat(String(session.totalBizum ?? "0")),
    totalMixed: parseFloat(String(session.totalMixed ?? "0")),
    totalManualIn: parseFloat(String(session.totalManualIn ?? "0")),
    totalManualOut: parseFloat(String(session.totalManualOut ?? "0")),
    closingAmount: parseFloat(String(session.closingAmount ?? "0")),
    countedCash: parseFloat(String(session.countedCash ?? "0")),
    cashDifference: parseFloat(String(session.cashDifference ?? "0")),
    channels: Object.values(channelMap),
    notes: session.notes,
    dailyControl,
  });

  const to = opts.toOverride || (await getBusinessEmail("admin_alerts"));
  const subject = `${opts.subjectPrefix ?? ""}?? Cierre de caja — ${register?.name ?? "Caja"} — ${sessionDate} — Náyade Experiences`;
  await sendEmail({ to, subject, html });
  return { to, subject };
}

// --- ROUTER ------------------------------------------------------------------

export const tpvRouter = router({
  // -- REGISTERS --------------------------------------------------------------
  getRegisters: tpvAccessProc.query(async () => {
    return await db.select().from(cashRegisters).where(eq(cashRegisters.isActive, true));
  }),

  // -- SESSIONS ---------------------------------------------------------------
  getActiveSession: tpvAccessProc
    .input(z.object({ registerId: z.number() }))
    .query(async ({ input }) => {
      const sessions = await db
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.registerId, input.registerId),
            eq(cashSessions.status, "open")
          )
        )
        .limit(1);
      return sessions[0] ?? null;
    }),

  openSession: tpvOpenCloseProc
    .input(
      z.object({
        registerId: z.number(),
        openingAmount: z.number().min(0),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check no open session exists
      const existing = await db
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.registerId, input.registerId),
            eq(cashSessions.status, "open")
          )
        )
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe una sesión abierta para esta caja",
        });
      }
      const [result] = await db.insert(cashSessions).values({
        registerId: input.registerId,
        cashierUserId: ctx.user.id,
        cashierName: ctx.user.name ?? ctx.user.email ?? "Cajero",
        openingAmount: String(input.openingAmount),
        status: "open",
        notes: input.notes,
        openedAt: Date.now(),
      });
      const id = (result as any).insertId as number;
      const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, id));

      // Email de apertura (no bloquea si falla)
      try {
        const emailEnabled = await getFeatureFlag('tpv_email_notifications_enabled', true);
        if (emailEnabled) {
          const [register] = await db.select({ name: cashRegisters.name }).from(cashRegisters).where(eq(cashRegisters.id, input.registerId));
          const html = buildCashOpenHtml({
            sessionId: id,
            cashierName: ctx.user.name ?? ctx.user.email ?? "Cajero",
            registerName: register?.name ?? `Caja #${input.registerId}`,
            openingAmount: input.openingAmount,
            openedAt: new Date(),
          });
          const toEmail = await getBusinessEmail('admin_alerts');
          await sendEmail({
            to: toEmail,
            subject: `?? Apertura de caja — ${register?.name ?? "Caja"} — Náyade Experiences`,
            html,
          });
        }
      } catch (e) {
        console.error("[TPV] Error enviando email apertura caja:", e);
      }

      return session;
    }),

  closeSession: tpvOpenCloseProc
    .input(
      z.object({
        sessionId: z.number(),
        countedCash: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [session] = await db
        .select()
        .from(cashSessions)
        .where(eq(cashSessions.id, input.sessionId));
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión no encontrada" });
      if (session.status === "closed") {
        throw new TRPCError({ code: "CONFLICT", message: "La sesión ya está cerrada" });
      }

      // Calculate totals from payments — solo ventas confirmadas como 'paid'.
      // Excluye 'cancelled' (anuladas por admin desde CRM, ventas de prueba, etc.)
      // y 'pending' (rollback de createSale). Asume "anulación administrativa" —
      // si en el futuro hay devoluciones físicas reales, deberá registrarse como
      // movimiento de caja separado.
      const salesRows = await db
        .select()
        .from(tpvSales)
        .where(and(
          eq(tpvSales.sessionId, input.sessionId),
          eq(tpvSales.status, "paid"),
        ));
      const saleIds = salesRows.map((s) => s.id);

      let totalCash = 0, totalCard = 0, totalBizum = 0, totalMixed = 0;
      if (saleIds.length > 0) {
        for (const saleId of saleIds) {
          const payments = await db
            .select()
            .from(tpvSalePayments)
            .where(and(eq(tpvSalePayments.saleId, saleId), eq(tpvSalePayments.status, "completed")));
          for (const p of payments) {
            const amt = parseFloat(String(p.amount));
            if (p.method === "cash") totalCash += amt;
            else if (p.method === "card") totalCard += amt;
            else if (p.method === "bizum") totalBizum += amt;
            else totalMixed += amt;
          }
        }
      }

      // Manual movements
      const movements = await db
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.sessionId, input.sessionId));
      let totalManualOut = 0, totalManualIn = 0;
      for (const m of movements) {
        if (m.type === "out") totalManualOut += parseFloat(String(m.amount));
        else totalManualIn += parseFloat(String(m.amount));
      }

      const openingAmt = parseFloat(String(session.openingAmount));
      const closingAmount = openingAmt + totalCash + totalManualIn - totalManualOut;
      const cashDifference = input.countedCash - closingAmount;

      await db.update(cashSessions).set({
        status: "closed",
        closedAt: Date.now(),
        countedCash: String(input.countedCash),
        closingAmount: String(closingAmount),
        cashDifference: String(cashDifference),
        totalCash: String(totalCash),
        totalCard: String(totalCard),
        totalBizum: String(totalBizum),
        totalMixed: String(totalMixed),
        totalManualOut: String(totalManualOut),
        totalManualIn: String(totalManualIn),
        notes: input.notes ?? session.notes,
      }).where(eq(cashSessions.id, input.sessionId));

      const [updated] = await db.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId));

      // Crear cierre contable en fin_cash_closures (idempotente, no bloquea si falla)
      try {
        const [defaultAcc] = await db
          .select({ id: finCashAccounts.id })
          .from(finCashAccounts)
          .where(and(eq(finCashAccounts.type, "principal"), eq(finCashAccounts.isActive, true)))
          .limit(1);

        if (defaultAcc) {
          const [existingClosure] = await db
            .select({ id: finCashClosures.id })
            .from(finCashClosures)
            .where(and(
              eq(finCashClosures.sourceEntityType, "tpv_session"),
              eq(finCashClosures.sourceEntityId, input.sessionId),
            ))
            .limit(1);

          if (!existingClosure) {
            const closureDate = madridDateKey(new Date(Number(session.openedAt)));
            const cashTolerance = parseFloat(await getSystemSetting('cash_register_tolerance', '0.01')) || 0.01;
            const alertThreshold = parseFloat(await getSystemSetting('cash_alert_threshold', '20')) || 20;
            const closureStatus = Math.abs(cashDifference) < cashTolerance ? "balanced" : "difference";
            const [closureResult] = await db.insert(finCashClosures).values({
              accountId: defaultAcc.id,
              date: closureDate,
              openingBalance: String(openingAmt.toFixed(2)),
              totalIncome: String((totalCash + totalManualIn).toFixed(2)),
              totalExpenses: String(totalManualOut.toFixed(2)),
              closingBalance: String(closingAmount.toFixed(2)),
              countedAmount: String(input.countedCash.toFixed(2)),
              difference: String(cashDifference.toFixed(2)),
              status: closureStatus as "balanced" | "difference",
              sourceEntityType: "tpv_session",
              sourceEntityId: input.sessionId,
              notes: input.notes,
              closedBy: typeof session.cashierUserId === "number" ? session.cashierUserId : undefined,
              closedAt: new Date(),
            });
            const closureId = (closureResult as any).insertId as number;

            if (Math.abs(cashDifference) >= cashTolerance) {
              const severity: "warning" | "critical" = Math.abs(cashDifference) < alertThreshold ? "warning" : "critical";
              await db.insert(finCashAlerts).values({
                type: "cash_difference",
                severity,
                amount: String(Math.abs(cashDifference).toFixed(2)),
                closureId,
                sessionId: input.sessionId,
                message: `Diferencia de ${cashDifference >= 0 ? "+" : ""}${cashDifference.toFixed(2)} € en cierre de sesión TPV #${input.sessionId}${cashDifference < 0 ? " (faltante)" : " (sobrante)"}`,
              });
            }
          }
        }
      } catch (e) {
        console.error("[TPV] Error creando cierre contable:", e);
      }

      // Email de cierre con desglose multicanal y resumen operativo del día
      // (no bloquea si falla).
      try {
        await sendCashCloseEmailForSession(input.sessionId);
      } catch (e) {
        console.error("[TPV] Error enviando email cierre caja:", e);
      }

      return updated;
    }),

  getSessionSummary: tpvOpenCloseProc
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId));
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión no encontrada" });

      // Solo ventas 'paid' — alineado con closeSession y dailyControl.
      const sales = await db.select().from(tpvSales).where(and(
        eq(tpvSales.sessionId, input.sessionId),
        eq(tpvSales.status, "paid"),
      ));
      const movements = await db.select().from(cashMovements).where(eq(cashMovements.sessionId, input.sessionId));

      const totalSales = sales.reduce((acc, s) => acc + parseFloat(String(s.total)), 0);
      const totalOut = movements.filter(m => m.type === "out").reduce((acc, m) => acc + parseFloat(String(m.amount)), 0);
      const totalIn = movements.filter(m => m.type === "in").reduce((acc, m) => acc + parseFloat(String(m.amount)), 0);

      // Desglose por método de pago — MISMA lógica que closeSession (línea ~242)
      // para que el modal de cierre muestre el "Efectivo esperado" correcto
      // ANTES de cerrar. Sin esto, el frontend mostraba 0,00€ aunque hubiera
      // cobros en cash y el cajero se confundía (caso real: sesión #18, 40€
      // cobrados en efectivo aparecían como 0€ esperado).
      let totalCash = 0, totalCard = 0, totalBizum = 0, totalMixed = 0;
      const saleIds = sales.map((s) => s.id);
      if (saleIds.length > 0) {
        const payments = await db.select().from(tpvSalePayments).where(and(
          inArray(tpvSalePayments.saleId, saleIds),
          eq(tpvSalePayments.status, "completed"),
        ));
        for (const p of payments) {
          const amt = parseFloat(String(p.amount));
          if (p.method === "cash") totalCash += amt;
          else if (p.method === "card") totalCard += amt;
          else if (p.method === "bizum") totalBizum += amt;
          else totalMixed += amt;
        }
      }

      return {
        session, sales, movements,
        totalSales, totalOut, totalIn,
        totalCash, totalCard, totalBizum, totalMixed,
      };
    }),

  // -- CASH MOVEMENTS ---------------------------------------------------------
  addCashMovement: tpvOpenCloseProc
    .input(
      z.object({
        sessionId: z.number(),
        type: z.enum(["out", "in"]),
        amount: z.number().positive(),
        reason: z.string().min(1),
        // Para salidas: "gasto" (compra/proveedor ? gasto real) o "traspaso"
        // (llevar el efectivo a la Caja Central ? movimiento interno, NO gasto).
        outKind: z.enum(["gasto", "traspaso"]).default("gasto"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(cashMovements).values({
        sessionId: input.sessionId,
        type: input.type,
        amount: String(input.amount),
        reason: input.reason,
        cashierName: ctx.user.name ?? ctx.user.email ?? "Cajero",
        createdAt: Date.now(),
      });
      const id = (result as any).insertId as number;
      const [movement] = await db.select().from(cashMovements).where(eq(cashMovements.id, id));

      // Propagación a Contabilidad ? Caja (fire-and-forget, no bloquea TPV).
      //
      // Retirada (out) ? apunte 'expense' + gasto conciliado en expenses
      //                  (la retirada es coste contable real).
      // Entrada  (in)  ? apunte 'income' en fin_cash_movements.
      //                  NO genera ningún ingreso comercial: una entrada
      //                  manual ("regularización", "cambio de billete",
      //                  "aporte de socio") es un ajuste de saldo, no una
      //                  venta. Antes este branch no existía y las entradas
      //                  quedaban huérfanas (solo en cash_movements TPV) sin
      //                  reflejo en /admin/contabilidad/caja.
      if (input.type === "out") {
        (async () => {
          try {
            const today = new Date().toISOString().slice(0, 10);
            const cashAccountId = await getDefaultCashAccountId();

            if (input.outKind === "traspaso") {
              // TRASPASO a Caja Central: NO es gasto. El efectivo sale del cajón
              // del TPV pero se conserva en la Caja Central (transfer_out + transfer_in).
              // No se crea ninguna fila en `expenses`.
              if (cashAccountId) {
                await recordCashTransferToCentral({
                  fromAccountId: cashAccountId,
                  amount: input.amount,
                  concept: `Traspaso a Caja Central — ${input.reason}`,
                  notes: `Traspaso desde TPV sesión #${input.sessionId} por ${ctx.user.name ?? ctx.user.email}`,
                  createdBy: ctx.user.id ? Number(ctx.user.id) : undefined,
                });
              }
              return;
            }

            // GASTO real: apunte 'expense' en caja + gasto conciliado en /gastos.
            const concept = `Retirada de caja TPV — ${input.reason}`;

            // 1. Movimiento en /contabilidad/caja
            if (cashAccountId) {
              await db.insert(finCashMovements).values({
                accountId: cashAccountId,
                date: today,
                type: "expense",
                amount: String(input.amount),
                concept,
                relatedEntityType: "manual",
                notes: `Retirada registrada en TPV sesión #${input.sessionId} por ${ctx.user.name ?? ctx.user.email}`,
                createdBy: ctx.user.id ? Number(ctx.user.id) : undefined,
              });
              await db.update(finCashAccounts)
                .set({ currentBalance: sql`current_balance - ${input.amount}` })
                .where(eq(finCashAccounts.id, cashAccountId));
            }

            // 2. Gasto en /contabilidad/gastos (conciliado)
            const [cat] = await db.select({ id: expenseCategories.id })
              .from(expenseCategories)
              .where(sql`TRIM(${expenseCategories.name}) = 'Salidas de caja'`)
              .limit(1)
              .then(async (rows) => rows.length ? rows : db.select({ id: expenseCategories.id }).from(expenseCategories).limit(1));
            const [cc] = await db.select({ id: costCenters.id })
              .from(costCenters).where(eq(costCenters.active, true)).limit(1);

            if (cat && cc) {
              await db.insert(expenses).values({
                date: today,
                concept,
                amount: String(input.amount),
                categoryId: cat.id,
                costCenterId: cc.id,
                paymentMethod: "cash",
                status: "conciliado",
                notes: `Retirada de caja TPV — sesión #${input.sessionId}. Cajero: ${ctx.user.name ?? ctx.user.email}. Motivo: ${input.reason}`,
                source: "tpv",
                createdBy: ctx.user.id ? Number(ctx.user.id) : undefined,
              });
            }
          } catch (e) {
            console.error("[TPV] Error registrando retirada en contabilidad:", e);
          }
        })();
      } else if (input.type === "in") {
        (async () => {
          try {
            const today = new Date().toISOString().slice(0, 10);
            const concept = `Entrada de caja TPV — ${input.reason}`;
            const cashAccountId = await getDefaultCashAccountId();
            if (cashAccountId) {
              await db.insert(finCashMovements).values({
                accountId: cashAccountId,
                date: today,
                type: "income",
                amount: String(input.amount),
                concept,
                relatedEntityType: "manual",
                notes: `Entrada registrada en TPV sesión #${input.sessionId} por ${ctx.user.name ?? ctx.user.email}. Motivo: ${input.reason}`,
                createdBy: ctx.user.id ? Number(ctx.user.id) : undefined,
              });
              await db.update(finCashAccounts)
                .set({ currentBalance: sql`current_balance + ${input.amount}` })
                .where(eq(finCashAccounts.id, cashAccountId));
            }
          } catch (e) {
            console.error("[TPV] Error registrando entrada en contabilidad:", e);
          }
        })();
      }

      return movement;
    }),

  // -- CATALOG ----------------------------------------------------------------
  getCatalog: tpvAccessProc.query(async () => {
    const [exps, pkgs, spas, rooms, legoPkgs] = await Promise.all([
      db.select({
        id: experiences.id,
        title: experiences.title,
        basePrice: experiences.basePrice,
        coverImageUrl: experiences.coverImageUrl,
        discountPercent: experiences.discountPercent,
        categoryId: experiences.categoryId,
        isActive: experiences.isActive,
        hasTimeSlots: experiences.hasTimeSlots,
      }).from(experiences).where(and(eq(experiences.isActive, true), eq(experiences.isPresentialSale, true))),

      db.select({
        id: packs.id,
        title: packs.title,
        basePrice: packs.basePrice,
        coverImageUrl: packs.image1,
        discountPercent: packs.discountPercent,
        isActive: packs.isActive,
      }).from(packs).where(and(eq(packs.isActive, true), eq(packs.isPresentialSale, true))),

      db.select({
        id: spaTreatments.id,
        title: spaTreatments.name,
        basePrice: spaTreatments.price,
        coverImageUrl: spaTreatments.coverImageUrl,
        discountPercent: spaTreatments.discountPercent,
        isActive: spaTreatments.isActive,
      }).from(spaTreatments).where(and(eq(spaTreatments.isActive, true), eq(spaTreatments.isPresentialSale, true))),

      db.select({
        id: roomTypes.id,
        title: roomTypes.name,
        basePrice: roomTypes.basePrice,
        coverImageUrl: roomTypes.coverImageUrl,
        discountPercent: roomTypes.discountPercent,
        isActive: roomTypes.isActive,
      }).from(roomTypes).where(and(eq(roomTypes.isActive, true), eq(roomTypes.isPresentialSale, true))),

      db.select({
        id: legoPacks.id,
        title: legoPacks.title,
        coverImageUrl: legoPacks.coverImageUrl,
        isActive: legoPacks.isActive,
      }).from(legoPacks).where(and(eq(legoPacks.isActive, true), eq(legoPacks.isPresentialSale, true))),
    ]);

    // Variantes de experiencias
    const expIds = exps.map(e => e.id);
    const allVariants = expIds.length > 0
      ? await db.select({
          id: experienceVariants.id,
          experienceId: experienceVariants.experienceId,
          name: experienceVariants.name,
          priceModifier: experienceVariants.priceModifier,
          priceType: experienceVariants.priceType,
          sortOrder: experienceVariants.sortOrder,
        }).from(experienceVariants)
          .where(inArray(experienceVariants.experienceId, expIds))
      : [];

    const varsByExp: Record<number, typeof allVariants> = {};
    for (const v of allVariants) {
      if (!varsByExp[v.experienceId]) varsByExp[v.experienceId] = [];
      varsByExp[v.experienceId].push(v);
    }

    return {
      experiences: exps.map(p => ({
        ...p,
        productType: "experience" as const,
        variants: (varsByExp[p.id] ?? []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      })),
      packs: pkgs.map(p => ({ ...p, productType: "pack" as const })),
      spa: spas.map(p => ({ ...p, productType: "spa" as const })),
      hotel: rooms.map(p => ({ ...p, productType: "hotel" as const })),
      legoPacks: legoPkgs.map(p => ({ ...p, basePrice: null, discountPercent: null, productType: "legoPack" as const })),
    };
  }),

  // -- SALES ------------------------------------------------------------------
  createSale: tpvSellProc
    .input(
      z.object({
        sessionId: z.number(),
        customerName: z.string().optional(),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().optional(),
        discountAmount: z.number().min(0).default(0),
        discountReason: z.string().optional(),
        discountCodeId: z.number().optional(),
        notes: z.string().optional(),
        serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD fecha de la actividad
        items: z.array(
          z.object({
            productType: z.enum(["experience", "pack", "spa", "hotel", "restaurant", "extra", "legoPack"]),
            productId: z.number().min(0),
            productName: z.string(),
            quantity: z.number().int().positive(),
            unitPrice: z.number().min(0.01).max(10000),
            discountPercent: z.number().min(0).max(100).default(0),
            eventDate: z.string().optional(),
            eventTime: z.string().optional(),
            participants: z.number().int().positive().default(1),
            notes: z.string().optional(),
            isManual: z.boolean().optional().default(false),
            conceptText: z.string().max(500).optional(),
            legoPackLineIds: z.array(z.number()).optional(), // Para Lego Packs personalizados
            legoPackLinePeople: z.record(z.number(), z.number()).optional(), // Personas por línea
          })
        ).min(1),
        payments: z.array(
          z.object({
            payerName: z.string().optional(),
            method: z.enum(["cash", "card", "bizum", "other"]),
            amount: z.number().positive(),
            amountTendered: z.number().optional(),
          })
        ).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // -- 1. Calcular totales básicos ----------------------------------------
      const subtotal = input.items.reduce((acc, item) => {
        const lineTotal = item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
        return acc + lineTotal;
      }, 0);
      const total = Math.max(0, subtotal - input.discountAmount);

      // Validate payments sum
      const paymentsTotal = input.payments.reduce((acc, p) => acc + p.amount, 0);
      if (Math.abs(paymentsTotal - total) > 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Los pagos (${paymentsTotal.toFixed(2)}€) no coinciden con el total (${total.toFixed(2)}€)`,
        });
      }

      // Manual items require admin role
      const hasManual = input.items.some(i => i.isManual);
      if (hasManual && (ctx as any).user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden añadir conceptos libres" });
      }

      // -- 2. Calcular fiscalidad por línea ------------------------------------
      const linesFiscal: Array<{
        fiscalRegime: "reav" | "general" | "mixed";
        taxBase: number; taxAmount: number; taxRate: number;
        reavCost: number; reavMargin: number; reavTax: number;
        lineSubtotal: number;
      }> = [];

      for (const item of input.items) {
        const lineSubtotal = item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
        const fiscalData = item.isManual
          ? { fiscalRegime: "reav" as const, taxRate: 0, providerPercent: 60, agencyMarginPercent: 40 }
          : await getProductFiscalData(item.productType, item.productId);
        const fiscal = calcLineFiscal(lineSubtotal, fiscalData.fiscalRegime, fiscalData.taxRate, fiscalData.providerPercent, fiscalData.agencyMarginPercent);
        linesFiscal.push({ fiscalRegime: fiscalData.fiscalRegime, ...fiscal, lineSubtotal });
      }

      // Totales fiscales agregados
      const totalTaxBase   = linesFiscal.reduce((s, l) => s + l.taxBase,   0);
      const totalTaxAmount = linesFiscal.reduce((s, l) => s + l.taxAmount, 0);
      const totalReavMargin= linesFiscal.reduce((s, l) => s + l.reavMargin,0);
      const totalReavCost  = linesFiscal.reduce((s, l) => s + l.reavCost,  0);
      const totalReavTax   = linesFiscal.reduce((s, l) => s + l.reavTax,   0);
      const hasReav = linesFiscal.some(l => l.fiscalRegime === "reav");
      const hasIva  = linesFiscal.some(l => l.fiscalRegime === "general");
      const fiscalSummary = hasReav && hasIva ? "mixed" : hasReav ? "reav_only" : "iva_only";
      const effectiveTaxRatePct = totalTaxBase > 0 ? (totalTaxAmount / totalTaxBase * 100) : 21;

      const ticketNumber = await generateTicketNumber(String((ctx as any).user?.id ?? "system"));
      const sellerName = (ctx as any).user?.name ?? null;
      const sellerUserId = (ctx as any).user?.id ?? null;

      // -- 3. Insertar venta con datos fiscales ---------------------------------
      // Bug #2 audit: insertamos con status='pending'. Solo cambia a 'paid' al
      // final del flujo, cuando TODOS los pasos posteriores (líneas, pagos,
      // reserva, factura, transacción contable, REAV) han completado sin error.
      // Si algo falla, la fila queda 'pending' y el Control Diario la filtra
      // automáticamente (NOT IN ('cancelled','refunded') — pending no aparece).
      const mainItemForDate = input.items[0]; // usado para serviceDate fallback
      const [saleResult] = await db.insert(tpvSales).values({
        ticketNumber,
        sessionId: input.sessionId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        subtotal: String(subtotal.toFixed(2)),
        discountAmount: String(input.discountAmount.toFixed(2)),
        discountReason: input.discountReason,
        discountCodeId: input.discountCodeId ?? null,
        total: String(total.toFixed(2)),
        status: "pending",
        notes: input.notes,
        serviceDate: input.serviceDate ?? mainItemForDate?.eventDate ?? new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
        taxBase:        String(totalTaxBase.toFixed(2)),
        taxAmount:      String(totalTaxAmount.toFixed(2)),
        taxRate:        String(effectiveTaxRatePct.toFixed(2)),
        reavMargin:     String(totalReavMargin.toFixed(2)),
        reavCost:       String(totalReavCost.toFixed(2)),
        reavTax:        String(totalReavTax.toFixed(2)),
        fiscalSummary,
        saleChannel:    "tpv",
        sellerUserId,
        sellerName,
      } as any);
      const saleId = (saleResult as any).insertId as number;

      // -- 4. Insertar líneas con fiscalidad -----------------------------------
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const lf   = linesFiscal[i];
        await db.insert(tpvSaleItems).values({
          saleId,
          productType: item.productType,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice.toFixed(2)),
          discountPercent: String(item.discountPercent.toFixed(2)),
          subtotal: String(lf.lineSubtotal.toFixed(2)),
          eventDate: item.eventDate,
          eventTime: item.eventTime,
          participants: item.participants,
          notes: item.notes,
          fiscalRegime: lf.fiscalRegime,
          taxBase:    String(lf.taxBase.toFixed(2)),
          taxAmount:  String(lf.taxAmount.toFixed(2)),
          taxRate:    String(lf.taxRate.toFixed(2)),
          reavCost:   String(lf.reavCost.toFixed(2)),
          reavMargin: String(lf.reavMargin.toFixed(2)),
          reavTax:    String(lf.reavTax.toFixed(2)),
          isManual:   item.isManual ? 1 : 0,
          conceptText: item.conceptText ?? null,
        } as any);
      }

      // -- 5. Insertar pagos ----------------------------------------------------
      const primaryPaymentMethod = input.payments[0]?.method ?? "other";
      for (const payment of input.payments) {
        const changeGiven = payment.method === "cash" && payment.amountTendered
          ? Math.max(0, payment.amountTendered - payment.amount)
          : 0;
        await db.insert(tpvSalePayments).values({
          saleId,
          payerName: payment.payerName,
          method: payment.method,
          amount: String(payment.amount.toFixed(2)),
          amountTendered: payment.amountTendered ? String(payment.amountTendered.toFixed(2)) : null,
          changeGiven: String(changeGiven.toFixed(2)),
          status: "completed",
          createdAt: Date.now(),
        });
      }

      // -- 6. Generar reserva automática siempre que haya producto principal ----
      // Total de personas = S(quantity × participants). Esta fórmula es la única
      // fuente de verdad en TODO el flujo TPV (reserva, calendario, REAV, email, GHL).
      // - Pase individual:     quantity=N, participants=1 ? N personas
      // - Pack para K personas: quantity=N, participants=K ? N×K personas
      const totalPeople = input.items.reduce((sum, it) => sum + (it.quantity * (it.participants ?? 1)), 0);

      let reservationId: number | null = null;
      const mainItem = mainItemForDate;
      if (mainItem) {
        try {
          const reservationNumber = await generateReservationRef(String((ctx as any).user?.id ?? "system"));
          const merchantOrder = reservationNumber; // reutilizamos el mismo número correlativo
          const amountCents = Math.round(total * 100);
          // Resumen de actividades ADICIONALES (extras) — NO incluye el item principal.
          // El principal queda representado por productId/productName a nivel raíz de la reserva.
          const extrasForReservation = input.items.slice(1).map(it => ({
            productId: it.productId,
            productName: it.productName,
            productType: it.productType,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            participants: it.participants,
            eventDate: it.eventDate,
            eventTime: it.eventTime,
          }));
          const productSummary = input.items.length > 1
            ? `${mainItem.productName} (+${input.items.length - 1} más)`
            : mainItem.productName;
          const [resResult] = await db.insert(reservations).values({
            productId: mainItem.productId,
            productName: productSummary,
            bookingDate: mainItem.eventDate ?? new Date().toISOString().slice(0, 10),
            people: totalPeople,
            extrasJson: JSON.stringify(extrasForReservation),
            amountTotal: amountCents,
            amountPaid: amountCents,
            discountAmount: String(input.discountAmount.toFixed(2)),
            discountReason: input.discountReason ?? null,
            status: "paid",
            customerName: input.customerName || "Cliente TPV",
            customerEmail: input.customerEmail || null,
            customerPhone: input.customerPhone || null,
            merchantOrder,
            reservationNumber,
            notes: [
              `[ORIGEN_TPV] Ticket: ${ticketNumber}`,
              input.customerName ? `Cliente: ${input.customerName}` : null,
              input.customerEmail ? `Email: ${input.customerEmail}` : null,
              input.customerPhone ? `Teléfono: ${input.customerPhone}` : null,
              input.items.length > 1 ? `Productos: ${input.items.map(i => i.productName).join(', ')}` : null,
              input.notes ? `Notas: ${input.notes}` : null,
            ].filter(Boolean).join(' · '),
            paymentMethod: primaryPaymentMethod === "card" ? "tarjeta_fisica" :
                           primaryPaymentMethod === "cash" ? "efectivo" : "otro",
            channel: "TPV_FISICO",
            statusReservation: "CONFIRMADA",
            statusPayment: "PAGADO",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            paidAt: Date.now(),
          } as any);
          reservationId = (resResult as any).insertId as number;
          // Actualizar la venta con el ID de reserva
          await db.update(tpvSales).set({ reservationId } as any).where(eq(tpvSales.id, saleId));
          // Crear/actualizar cliente en el CRM
          if (input.customerName && input.customerName !== "Cliente TPV") {
            await upsertClientFromReservation({
              name: input.customerName,
              email: input.customerEmail ?? null,
              phone: input.customerPhone ?? null,
              source: "tpv",
            });
          }
        } catch (e) {
          console.error("[TPV] Error creando reserva automática:", e);
        }
      }

      // -- 7. Registrar transacción unificada en el libro maestro ---------------
      try {
        const methodMap: Record<string, string> = {
          cash: "efectivo", card: "tarjeta_fisica", bizum: "otro", other: "otro"
        };
        const txMethod = methodMap[primaryPaymentMethod] ?? "otro";
        const txNumber = generateTransactionNumber();
        await db.insert(transactions).values({
          transactionNumber: txNumber,
          type: "ingreso",
          amount: String(total.toFixed(2)),
          currency: "EUR",
          paymentMethod: txMethod as any,
          status: "completado",
          description: `Venta TPV ${ticketNumber}${mainItem ? ` — ${mainItem.productName}` : ""}`,
          processedAt: new Date(),
          clientName: input.customerName ?? null,
          clientEmail: input.customerEmail ?? null,
          clientPhone: input.customerPhone ?? null,
          productName: mainItem?.productName ?? null,
          saleChannel: "tpv",
          sellerUserId,
          sellerName,
          taxBase:    String(totalTaxBase.toFixed(2)),
          taxAmount:  String(totalTaxAmount.toFixed(2)),
          reavMargin: String(totalReavMargin.toFixed(2)),
          fiscalRegime: (fiscalSummary === "iva_only" ? "general" : fiscalSummary === "reav_only" ? "reav" : "mixed") as any,
          tpvSaleId: saleId,
          reservationId: reservationId ?? undefined,
          reservationRef: reservationId ? `TPV-RES-${saleId}` : undefined,
          operationStatus: "confirmada",
        } as any);
      } catch (e) {
        console.error("[TPV] Error registrando transacción:", e);
      }

      // -- 8. Crear expediente REAV automáticamente si hay líneas REAV ----------
      let reavExpedientId: number | undefined;
      let reavExpedientNumber: string | undefined;
      if (hasReav) {
        try {
          const reavLines = linesFiscal.filter(l => l.fiscalRegime === "reav");
          const reavSaleAmount = reavLines.reduce((s, l) => s + l.lineSubtotal, 0);
          const reavResult = await createReavExpedient({
            reservationId: reservationId ?? undefined,
            tpvSaleId: saleId,
            serviceDescription: input.items
              .filter((_, idx) => linesFiscal[idx]?.fiscalRegime === "reav")
              .map(i => i.productName)
              .join(" | "),
            serviceDate: mainItem?.eventDate ?? new Date().toISOString().split("T")[0],
            // Personas REAV = S(quantity × participants) de las líneas con fiscalRegime='reav'
            numberOfPax: input.items
              .filter((_, idx) => linesFiscal[idx]?.fiscalRegime === "reav")
              .reduce((sum, it) => sum + (it.quantity * (it.participants ?? 1)), 0),
            saleAmountTotal: String(reavSaleAmount.toFixed(2)),
            providerCostEstimated: String((reavSaleAmount * 0.6).toFixed(2)),
            agencyMarginEstimated: String((reavSaleAmount * 0.4).toFixed(2)),
            // Datos del cliente
            clientName: input.customerName ?? undefined,
            clientEmail: input.customerEmail ?? undefined,
            clientPhone: input.customerPhone ?? undefined,
            // Canal y referencia
            channel: "tpv",
            sourceRef: ticketNumber,
            internalNotes: [
              `Expediente creado automáticamente desde TPV.`,
              `Ticket: ${ticketNumber}`,
              input.customerName ? `Cliente: ${input.customerName}` : null,
              input.customerEmail ? `Email: ${input.customerEmail}` : null,
              input.customerPhone ? `Teléfono: ${input.customerPhone}` : null,
              `Importe REAV: ${reavSaleAmount.toFixed(2)}€`,
              `Cajero: ${sellerName}`,
            ].filter(Boolean).join(" · "),
          });
          reavExpedientId = reavResult.id;
          reavExpedientNumber = reavResult.expedientNumber;
          // Vincular el expediente a la venta TPV
          await db.update(tpvSales).set({ reavExpedientId } as any).where(eq(tpvSales.id, saleId));
          // Adjuntar el ticket como documento del cliente en el expediente
          // El ticket PDF se genera en el frontend; guardamos la URL de acceso al ticket
          const ticketViewUrl = `/admin/tpv/ticket/${saleId}`;
          await attachReavDocument({
            expedientId: reavExpedientId!,
            side: "client",
            docType: "otro",
            title: `Ticket TPV ${ticketNumber}`,
            fileUrl: ticketViewUrl,
            mimeType: "text/html",
            notes: `Ticket de venta TPV generado automáticamente. Fecha: ${new Date().toLocaleDateString("es-ES")}. Cajero: ${sellerName}.`,
          });
          console.log(`[TPV] Expediente REAV ${reavExpedientNumber} creado para venta ${ticketNumber}`);
        } catch (e) {
          console.error("[TPV] Error creando expediente REAV:", e);
        }
      }

      // -- 8b. Registrar en calendario de operaciones (reservation_operational) ------
      // Esto permite que las ventas TPV aparezcan en el calendario del día y en
      // las órdenes del día de los monitores, igual que las ventas CRM y Redsys.
      try {
        const serviceDate = mainItem?.eventDate ?? new Date().toISOString().split("T")[0];
        const people = totalPeople;
        const fiscalRegimeForOp = fiscalSummary === "iva_only" ? "general"
          : fiscalSummary === "reav_only" ? "reav" : "mixed";
        const paymentMethodForOp = primaryPaymentMethod === "cash" ? "efectivo"
          : primaryPaymentMethod === "card" ? "tarjeta_fisica" : "otro";
        // Mapear método de pago TPV al enum de postConfirmOperation
        const opPaymentMethod: "efectivo" | "tarjeta_fisica" | "otro" =
          primaryPaymentMethod === "cash" ? "efectivo" :
          primaryPaymentMethod === "card" ? "tarjeta_fisica" : "otro";
        await postConfirmOperation({
          reservationId: reservationId ?? 0,
          productId: mainItem?.productId ?? 0,
          productName: mainItem?.productName ?? input.items.map(i => i.productName).join(", "),
          serviceDate,
          people,
          amountCents: Math.round(total * 100),
          customerName: input.customerName || "Cliente TPV",
          customerEmail: input.customerEmail || "",
          customerPhone: input.customerPhone || "",
          totalAmount: total,
          paymentMethod: opPaymentMethod,
          saleChannel: "tpv",
          invoiceNumber: ticketNumber,
          reservationRef: reservationId ? `TPV-RES-${saleId}` : ticketNumber,
          sellerUserId: sellerUserId ?? undefined,
          sellerName: sellerName ?? undefined,
          taxBase: totalTaxBase,
          taxAmount: totalTaxAmount,
          reavMargin: totalReavMargin,
          fiscalRegime: fiscalRegimeForOp,
          description: `Venta TPV ${ticketNumber}${mainItem ? ` — ${mainItem.productName}` : ""}`,
          quoteId: null,
          sourceChannel: opPaymentMethod,
        });
      } catch (e) {
        console.error("[TPV] Error registrando en operaciones:", e);
      }

      // -- 8b-bis. Movimiento de caja automático para ventas en efectivo ---------
      if (primaryPaymentMethod === "cash" && reservationId) {
        try {
          const cashAccountId = await getDefaultCashAccountId();
          if (cashAccountId) {
            await createCashMovementIfNotExists({
              accountId: cashAccountId,
              date: madridDateKey().slice(0, 10),
              type: "income",
              amount: total,
              concept: `Cobro efectivo ${ticketNumber} — ${input.customerName || "Cliente TPV"}`,
              relatedEntityType: "reservation",
              relatedEntityId: reservationId,
              createdBy: sellerUserId ?? undefined,
            });
          }
        } catch (e) {
          console.error("[TPV] Error registrando movimiento de caja automático:", e);
        }
      }

      // -- 8c. Generar factura automática (solo pagos con tarjeta — efectivo requiere factura manual) --
      if (primaryPaymentMethod !== "cash") {
        try {
          const invoiceNumber = await generateDocumentNumber("factura", "tpv:createSale", "system");
          const invoicePayMethod = primaryPaymentMethod === "card" ? "tarjeta_fisica" : "otro";

          const invoiceItems = input.items.map((item, idx) => ({
            description: item.productName,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            total:       linesFiscal[idx]?.lineSubtotal ?? item.unitPrice * item.quantity,
            fiscalRegime: linesFiscal[idx]?.fiscalRegime ?? "reav",
            taxRate:     linesFiscal[idx]?.taxRate ?? 0,
            productId:   item.productId,
          }));

          const now = new Date();
          const [invResult] = await db.insert(invoices).values({
            invoiceNumber,
            reservationId:  reservationId ?? undefined,
            clientName:     input.customerName || "Cliente TPV",
            clientEmail:    input.customerEmail || "",
            clientPhone:    input.customerPhone || null,
            itemsJson:      invoiceItems,
            subtotal:       String(subtotal.toFixed(2)),
            discount:       String(input.discountAmount.toFixed(2)),
            discountReason: input.discountReason ?? null,
            taxRate:        String(effectiveTaxRatePct.toFixed(2)),
            taxAmount:      String(totalTaxAmount.toFixed(2)),
            total:          String(total.toFixed(2)),
            status:         "cobrada",
            paymentMethod:  invoicePayMethod,
            issuedAt:       now,
            createdAt:      now,
            updatedAt:      now,
          } as any);
          const invoiceId = (invResult as any).insertId as number;

          await db.update(tpvSales).set({ invoiceId } as any).where(eq(tpvSales.id, saleId));
          if (reservationId) {
            await db.update(reservations)
              .set({ invoiceId, invoiceNumber } as any)
              .where(eq(reservations.id, reservationId));
          }
        } catch (e) {
          console.error("[TPV] Error generando factura:", e);
        }
      }

      // -- 8b. CONFIRMAR venta TPV como pagada ----------------------------------
      // Punto de no retorno: si llegamos aquí los pasos críticos (líneas, pagos,
      // reserva, transacción contable, REAV, factura) han completado. Marcamos la
      // venta como 'paid' con paidAt. Si CUALQUIERA de los pasos anteriores hubiera
      // lanzado una excepción no capturada, llegaríamos aquí y la fila se quedaría
      // como 'pending' — invisible para el Control Diario hasta que se revise
      // manualmente. Los pasos siguientes (email, GHL, logActivity) son
      // fire-and-forget — su fallo no debe afectar el estado de la venta.
      await db.update(tpvSales)
        .set({ status: "paid", paidAt: Date.now() } as any)
        .where(eq(tpvSales.id, saleId));

      // -- 9. Email de confirmación (cliente si hay email + siempre a reservas@) -
      try {
        // Recuperar publicToken de la reserva auto-generada para el botón "Ver tu reserva"
        let reservationUrl: string | undefined;
        if (reservationId) {
          const [resForUrl] = await db.select({ publicToken: reservations.publicToken })
            .from(reservations).where(eq(reservations.id, reservationId)).limit(1);
          if (resForUrl?.publicToken) {
            const baseUrl = process.env.APP_URL ?? "https://www.skicenter.es";
            reservationUrl = `${baseUrl}/presupuesto/${resForUrl.publicToken}`;
          }
        }
        // Desglose para el email — solo si hay UN único producto (caso típico TPV).
        // Con múltiples productos no tiene sentido un único "qty × unitPrice".
        const singleItem = input.items.length === 1 ? input.items[0] : null;
        const emailHtml = buildReservationConfirmHtml({
          merchantOrder: ticketNumber,
          productName: mainItem?.productName ?? input.items.map(i => i.productName).join(", "),
          customerName: input.customerName || "Cliente TPV",
          date: new Date().toLocaleDateString("es-ES"),
          people: totalPeople,
          amount: `${total.toFixed(2).replace(".", ",")} €`,
          reservationUrl,
          quantity:       singleItem?.quantity,
          unitPrice:      singleItem?.unitPrice,
          subtotal:       singleItem ? subtotal : undefined,
          discount:       input.discountAmount > 0 ? input.discountAmount : undefined,
          discountReason: input.discountReason,
        });
        const subject = `[TPV] Compra confirmada ${ticketNumber} — Náyade Experiences`;
        const saleNotifyEmail = await getBusinessEmail('reservations');
        await sendEmail({ to: saleNotifyEmail, subject, html: emailHtml });
        if (input.customerEmail) {
          await sendEmail({ to: input.customerEmail, cc: saleNotifyEmail, subject, html: emailHtml });
        }
      } catch (e) {
        console.error("[TPV] Error enviando email de confirmación:", e);
      }

      // -- 9. Registrar en el log de actividad del dashboard ---------------------------------
      await logActivity(
        "reservation",
        reservationId ?? saleId,
        "tpv_sale_created",
        sellerUserId,
        sellerName,
        {
          ticketNumber,
          total,
          customerName: input.customerName ?? "Cliente TPV",
          items: input.items.map(i => i.productName).join(", "),
          paymentMethod: input.payments.map(p => p.method).join("+"),
        }
      ).catch(() => {});

      // -- 9b. GHL: contacto + workflow para ventas TPV con email del cliente -----
      // Solo si hay email — sin email no podemos identificar al contacto en GHL.
      if (input.customerEmail) {
        try {
          const ghlCreds = await getGHLCredentials();
          if (ghlCreds) {
            const [existingLead] = await db
              .select({ ghlContactId: leads.ghlContactId })
              .from(leads)
              .where(eq(leads.email, input.customerEmail))
              .limit(1);

            const ghlContactId = existingLead?.ghlContactId
              ?? await createGHLContact({
                name: input.customerName || "Cliente TPV",
                email: input.customerEmail,
                phone: input.customerPhone ?? undefined,
                tags: ["reserva_confirmada", "venta_tpv"],
              }, ghlCreds);

            if (ghlContactId) {
              // Sincronizar presupuesto_url al contacto (WhatsApp lee este campo).
              // Solo si la venta creó reserva (cuando hay producto principal).
              if (reservationId) {
                const [resForUrl] = await db.select({ publicToken: reservations.publicToken })
                  .from(reservations).where(eq(reservations.id, reservationId)).limit(1);
                if (resForUrl?.publicToken) {
                  const base = process.env.APP_URL ?? "https://www.skicenter.es";
                  syncLeadUrlsToGHL({
                    ghlContactId,
                    quoteUrl: `${base}/presupuesto/${resForUrl.publicToken}`,
                    email: input.customerEmail,
                    phone: input.customerPhone ?? undefined,
                    credentials: ghlCreds,
                  });
                }
              }
              const webhookUrl = process.env.GHL_RESERVATION_WEBHOOK_URL;
              if (webhookUrl) {
                await triggerGHLWorkflow(webhookUrl, {
                  contactId: ghlContactId,
                  reservationId: reservationId ?? null,
                  ticketNumber,
                  productName: mainItem?.productName ?? input.items.map(i => i.productName).join(", "),
                  bookingDate: input.serviceDate ?? mainItemForDate?.eventDate ?? new Date().toISOString().slice(0, 10),
                  people: totalPeople,
                  amountPaid: Math.round(total * 100),
                  customerName: input.customerName || "Cliente TPV",
                  customerEmail: input.customerEmail,
                  customerPhone: input.customerPhone ?? null,
                  source: "venta_tpv",
                });
              }
            }
          }
        } catch (ghlErr: any) {
          console.error("[TPV] Error en integración GHL:", ghlErr.message);
        }
      }

      // -- 9b. Guardar snapshots de Lego Packs -----------------------------------
      // Importar saveSnapshot dinámicamente para evitar circular dependency
      const { calculateLegoPackPrice } = await import("./legoPacks.ts");
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        if (item.productType === "legoPack" && item.legoPackLineIds && item.legoPackLineIds.length > 0) {
          try {
            const pricing = await calculateLegoPackPrice(item.productId, item.legoPackLineIds);
            await db.insert(legoPackSnapshots).values({
              legoPackId: item.productId,
              legoPackTitle: item.productName,
              operationType: "tpv_sale",
              operationId: saleId,
              linesSnapshot: pricing.lines as any,
              totalOriginal: String(pricing.totalOriginal.toFixed(2)),
              totalDiscount: String(pricing.totalDiscount.toFixed(2)),
              totalFinal: String(pricing.totalFinal.toFixed(2)),
            });
          } catch (err) {
            console.error(`[TPV] Error saving Lego Pack snapshot: ${err}`);
            // No fallar la venta si el snapshot falla
          }
        }
      }

      // -- 10. Devolver venta completa -----------------------------------------------------------
      const [sale] = await db.select().from(tpvSales).where(eq(tpvSales.id, saleId));
      const items = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, saleId));
      const payments = await db.select().from(tpvSalePayments).where(eq(tpvSalePayments.saleId, saleId));
      return { sale, items, payments, reservationId, reavExpedientId, reavExpedientNumber };
    }),

  getSale: tpvAccessProc
    .input(z.object({ saleId: z.number() }))
    .query(async ({ input }) => {
      const [sale] = await db.select().from(tpvSales).where(eq(tpvSales.id, input.saleId));
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });
      const items = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, input.saleId));
      const payments = await db.select().from(tpvSalePayments).where(eq(tpvSalePayments.saleId, input.saleId));
      return { sale, items, payments };
    }),

  getSessionSales: tpvAccessProc
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      return await db
        .select()
        .from(tpvSales)
        .where(eq(tpvSales.sessionId, input.sessionId))
        .orderBy(desc(tpvSales.createdAt));
    }),

  // -- BACKOFFICE -------------------------------------------------------------
  getBackoffice: tpvBackofficeProc
    .input(
      z.object({
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const sessions = await db
        .select()
        .from(cashSessions)
        .orderBy(desc(cashSessions.openedAt))
        .limit(input.limit)
        .offset(offset);

      // Enrich with register names
      const registers = await db.select().from(cashRegisters);
      const registerMap = Object.fromEntries(registers.map(r => [r.id, r.name]));

      // Aggregate sales per session in one batch query — solo 'paid'
      // (mismo criterio que cierre de caja para que cuadre con el histórico real).
      const sessionIds = sessions.map(s => s.id);
      const salesRows = sessionIds.length > 0
        ? await db
            .select({ sessionId: tpvSales.sessionId, total: tpvSales.total })
            .from(tpvSales)
            .where(and(
              inArray(tpvSales.sessionId, sessionIds),
              eq(tpvSales.status, "paid"),
            ))
        : [];

      const salesBySession = new Map<number, { count: number; total: number }>();
      for (const row of salesRows) {
        const acc = salesBySession.get(row.sessionId) ?? { count: 0, total: 0 };
        acc.count += 1;
        acc.total += parseFloat(String(row.total));
        salesBySession.set(row.sessionId, acc);
      }

      return sessions.map(s => ({
        ...s,
        registerName: registerMap[s.registerId] ?? "Caja",
        salesCount: salesBySession.get(s.id)?.count ?? 0,
        totalSales: salesBySession.get(s.id)?.total ?? 0,
      }));
    }),

  getBackofficeSalesByProduct: tpvBackofficeProc
    .input(z.object({ sessionId: z.number().optional() }))
    .query(async ({ input }) => {
      const items = await db.select().from(tpvSaleItems);
      // Group by product name
      const grouped: Record<string, { productName: string; productType: string; totalQty: number; totalRevenue: number }> = {};
      for (const item of items) {
        const key = `${item.productType}:${item.productId}`;
        if (!grouped[key]) {
          grouped[key] = {
            productName: item.productName,
            productType: item.productType,
            totalQty: 0,
            totalRevenue: 0,
          };
        }
        grouped[key].totalQty += item.quantity;
        grouped[key].totalRevenue += parseFloat(String(item.subtotal));
      }
      return Object.values(grouped).sort((a, b) => b.totalRevenue - a.totalRevenue);
    }),

  // -- SEND TICKET EMAIL -----------------------------------------------------
  sendTicketEmail: tpvSellProc
    .input(
      z.object({
        ticketNumber: z.string(),
        email: z.string().email(),
      })
    )
    .mutation(async ({ input }) => {
      const [sale] = await db
        .select()
        .from(tpvSales)
        .where(eq(tpvSales.ticketNumber, input.ticketNumber))
        .limit(1);
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });

      const items = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, sale.id));
      const payments = await db.select().from(tpvSalePayments).where(eq(tpvSalePayments.saleId, sale.id));

      const METHOD_LABELS: Record<string, string> = {
        cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otro",
      };

      const emailHtml = buildTpvTicketHtml({
        ticketNumber: sale.ticketNumber,
        customerName: sale.customerName ?? undefined,
        createdAt: Number(sale.createdAt),
        items: items.map(item => ({
          name: item.productName,
          quantity: item.quantity,
          unitPrice: parseFloat(String(item.unitPrice)),
          total: parseFloat(String(item.subtotal)),
        })),
        payments: payments.map(p => ({
          method: p.method,
          amount: parseFloat(String(p.amount)),
        })),
        total: parseFloat(String(sale.total)),
      });
      await sendManagedEmail({
        templateKey: "tpv_ticket",
        triggerEvent: "tpv_ticket",
        recipientEmail: input.email,
        subject: `Tu ticket de compra ${sale.ticketNumber} — Náyade Experiences`,
        html: emailHtml,
        relatedEntityType: "tpv_sale",
        relatedEntityId: sale.id,
        forceCustomer: true,
      });

      return { ok: true };
    }),
});

