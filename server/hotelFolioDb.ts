/**
 * Hotel Net · folio de estancia, cierre del día e informes — acceso a datos. La lógica vive en `hotelFolio.ts` y
 * `hotelAudit.ts`.
 *
 * Tablas de db/migrations/0034_hotel_folio (fuera de drizzle/schema.ts, como las de 0032): sin la migración, cada función
 * responde con un error claro (`[module_not_installed]`) y el resto del hotel sigue igual.
 *
 * Folio: una cuenta por reserva. El alojamiento se carga noche a noche (al hacer check-in y, si faltara, al cerrar) con el
 * importe de la reserva y el IVA de alojamiento de la empresa; si la reserva ya tenía factura (cobro web), el alojamiento
 * no se vuelve a facturar y el folio recoge solo los extras. Un pago previo de la reserva sin factura entra como pago.
 * Al cerrar (saldo 0) se emite UNA factura con el circuito de facturas del Core: número de la serie «factura»
 * (`generateDocumentNumber`), copia del emisor (`issuerSnapshotForNewInvoice`) y desglose de IVA (`chargedInvoiceAmounts`),
 * todo en la transacción que bloquea el folio: dos cierres a la vez nunca emiten dos facturas.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, like, sql } from "drizzle-orm";
import { bigint, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { invoices } from "../drizzle/schema";
import { chargedInvoiceAmounts } from "./invoiceCalc";
import { issuerSnapshotForNewInvoice } from "./issuerSnapshot";
import { generateDocumentNumber } from "./documentNumbers";
import {
  DEFAULT_ACCOMMODATION_TAX_BP,
  PREVIOUS_PAYMENT_CATEGORY,
  chargeAmount,
  folioCloseBlocker,
  folioEditBlocker,
  folioInvoiceLines,
  folioTotals,
  invoicePaymentMethod,
  splitAccommodation,
  type FolioItem,
} from "./hotelFolio";
import { nightKpis, periodKpis, type AuditStay, type NightKpis } from "./hotelAudit";
import { stayNights } from "./inventoryHolds";
import { externalChargeIdOf, externalChargeSource, externalItemKey, externalLinesProblem, type ExternalChargeLine, type ExternalChargeModule } from "./hotelFolioChargeSources";
import { addDaysIso, todayInTimeZone } from "./hotelPms";
import {
  assignmentsForReservations,
  db,
  inTx,
  isMissingPmsSchema,
  listHotelReservations,
  lockReservation,
  rows,
  type Db,
  type Exec,
  type HotelReservation,
} from "./hotelPmsDb";

/** Solo para borrar con el ORM (el resto de lecturas y escrituras van en SQL explícito). */
const hotelFolioItems = mysqlTable("hotel_folio_items", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  folioId: int("folio_id").notNull(),
  sourceKey: varchar("source_key", { length: 64 }),
});

export const FOLIO_NOT_INSTALLED_MESSAGE =
  "[module_not_installed] El folio y los informes del hotel aún no están preparados en tu empresa: falta aplicar la actualización 0034_hotel_folio de su base de datos.";

async function folioSchema<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingPmsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: FOLIO_NOT_INSTALLED_MESSAGE, cause: e });
    throw e;
  }
}

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

// ─── Ajustes ──────────────────────────────────────────────────────────────────

async function accommodationTaxBp(exec: Pick<Db, "execute">): Promise<number> {
  const [s] = await rows<{ accommodation_tax_bp: number }>(exec, sql`SELECT accommodation_tax_bp FROM hotel_pms_settings WHERE id = 1`);
  return s ? Number(s.accommodation_tax_bp) : DEFAULT_ACCOMMODATION_TAX_BP;
}

export async function getPmsSettings() {
  return folioSchema(async () => ({ accommodationTaxBp: await accommodationTaxBp(await db()) }));
}

export async function setPmsSettings(input: { accommodationTaxBp: number; userId: number | null }) {
  return folioSchema(async () => {
    const d = await db();
    await d.execute(sql`
      INSERT INTO hotel_pms_settings (id, accommodation_tax_bp, updated_by, updated_at) VALUES (1, ${input.accommodationTaxBp}, ${input.userId}, ${Date.now()})
      ON DUPLICATE KEY UPDATE accommodation_tax_bp = VALUES(accommodation_tax_bp), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
    return { ok: true as const };
  });
}

// ─── Folio ────────────────────────────────────────────────────────────────────

interface FolioRow {
  id: number;
  reservation_id: number;
  status: string;
  invoice_id: number | null;
  invoice_number: string | null;
  closed_at: number | string | null;
}

interface ItemRow {
  id: number;
  kind: "cargo" | "pago";
  category: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  tax_rate_bp: number | null;
  night_date: string | null;
  source_key: string | null;
  created_at: number | string;
}

interface ReservationBilling {
  invoiceId: number | null;
  invoiceNumber: string | null;
  amountPaid: number;
  paymentMethod: string | null;
}

async function reservationBilling(exec: Pick<Db, "execute">, reservationId: number): Promise<ReservationBilling> {
  const [r] = await rows<{ invoiceId: number | null; invoiceNumber: string | null; amount_paid: number | null; paymentMethod: string | null }>(exec, sql`
    SELECT invoiceId, invoiceNumber, amount_paid, paymentMethod FROM reservations WHERE id = ${reservationId}`);
  return { invoiceId: r?.invoiceId ?? null, invoiceNumber: r?.invoiceNumber ?? null, amountPaid: Number(r?.amount_paid ?? 0), paymentMethod: r?.paymentMethod ?? null };
}

const toItem = (r: ItemRow) => ({
  id: Number(r.id),
  kind: r.kind,
  category: r.category,
  description: r.description,
  quantity: Number(r.quantity),
  unitPriceCents: Number(r.unit_price_cents),
  amountCents: Number(r.amount_cents),
  taxRateBp: r.tax_rate_bp === null ? null : Number(r.tax_rate_bp),
  nightDate: r.night_date,
  sourceKey: r.source_key,
  /** Los cargos automáticos (noches, pago previo) no se borran a mano. */
  automatic: r.source_key !== null && externalChargeIdOf(r.source_key) === null,
  /** Cargo de otro módulo (restaurante, SPA): al borrarlo se anula el cargo entero y su origen queda pendiente de cobro. */
  external: externalChargeIdOf(r.source_key) !== null,
  createdAt: Number(r.created_at),
});

async function items(exec: Pick<Db, "execute">, folioId: number) {
  return (await rows<ItemRow>(exec, sql`
    SELECT id, kind, category, description, quantity, unit_price_cents, amount_cents, tax_rate_bp, night_date, source_key, created_at
    FROM hotel_folio_items WHERE folio_id = ${folioId} ORDER BY kind, COALESCE(night_date, ''), id`)).map(toItem);
}

/** Folio de la reserva (lo crea si no existe) bloqueado en `tx`. */
async function lockFolio(tx: Exec, reservationId: number): Promise<FolioRow> {
  const now = Date.now();
  await tx.execute(sql`
    INSERT INTO hotel_folios (reservation_id, status, created_at, updated_at) VALUES (${reservationId}, 'abierto', ${now}, ${now})
    ON DUPLICATE KEY UPDATE id = id`);
  const [f] = await rows<FolioRow>(tx, sql`
    SELECT id, reservation_id, status, invoice_id, invoice_number, closed_at FROM hotel_folios WHERE reservation_id = ${reservationId} FOR UPDATE`);
  return f;
}

async function insertItem(
  tx: Exec,
  folioId: number,
  it: { kind: "cargo" | "pago"; category: string; description: string | null; quantity: number; unitPriceCents: number; amountCents: number; taxRateBp: number | null; nightDate?: string | null; sourceKey?: string | null; userId?: number | null },
) {
  await tx.execute(sql`
    INSERT INTO hotel_folio_items (folio_id, kind, category, description, quantity, unit_price_cents, amount_cents, tax_rate_bp, night_date, source_key, created_by, created_at)
    VALUES (${folioId}, ${it.kind}, ${it.category}, ${it.description}, ${it.quantity}, ${it.unitPriceCents}, ${it.amountCents}, ${it.taxRateBp},
      ${it.nightDate ?? null}, ${it.sourceKey ?? null}, ${it.userId ?? null}, ${Date.now()})
    ON DUPLICATE KEY UPDATE id = id`);
}

/**
 * Cargos automáticos (idempotentes por source_key): las noches de alojamiento con el importe de la reserva, salvo que la
 * reserva ya tenga factura propia, y el pago previo de la reserva sin factura.
 */
async function postAutomatic(tx: Exec, folioId: number, r: HotelReservation, billing: ReservationBilling, userId: number | null) {
  if (billing.invoiceId) return { accommodation: false };
  const taxBp = await accommodationTaxBp(tx);
  const nights = stayNights(r.checkIn, r.checkOut);
  for (const n of splitAccommodation(r.amountTotal, nights)) {
    await insertItem(tx, folioId, {
      kind: "cargo", category: "alojamiento", description: `Noche ${n.night}`, quantity: 1, unitPriceCents: n.cents, amountCents: n.cents,
      taxRateBp: taxBp, nightDate: n.night, sourceKey: `noche:${n.night}`, userId,
    });
  }
  if (billing.amountPaid > 0) {
    await insertItem(tx, folioId, {
      kind: "pago", category: PREVIOUS_PAYMENT_CATEGORY, description: "Pago de la reserva", quantity: 1, unitPriceCents: billing.amountPaid,
      amountCents: billing.amountPaid, taxRateBp: null, sourceKey: "pago-reserva", userId,
    });
  }
  return { accommodation: true };
}

async function folioView(exec: Pick<Db, "execute">, folio: FolioRow, r: HotelReservation, billing: ReservationBilling) {
  const list = await items(exec, folio.id);
  const totals = folioTotals(list);
  return {
    folio: {
      id: Number(folio.id), reservationId: Number(folio.reservation_id), status: folio.status,
      invoiceId: folio.invoice_id === null ? null : Number(folio.invoice_id), invoiceNumber: folio.invoice_number,
      closedAt: folio.closed_at === null ? null : Number(folio.closed_at),
    },
    reservation: {
      id: r.id, reservationNumber: r.reservationNumber, customerName: r.customerName, customerEmail: r.customerEmail, roomName: r.roomName,
      checkIn: r.checkIn, checkOut: r.checkOut, status: r.status, statusReservation: r.statusReservation, amountTotal: r.amountTotal,
      /** La reserva tiene su propia factura (cobro web): el alojamiento no entra en la del folio. */
      invoiceNumber: billing.invoiceNumber,
    },
    items: list,
    totals,
    editBlocker: folioEditBlocker(folio.status, r),
    closeBlocker: folioCloseBlocker(folio.status, r, totals),
  };
}

/** Folio de la reserva con sus cargos, pagos y saldo (lo abre y carga lo automático la primera vez). */
export async function getFolio(reservationId: number, userId: number | null) {
  return folioSchema(() => inTx(async (tx) => {
    const r = await lockReservation(tx, reservationId);
    const folio = await lockFolio(tx, reservationId);
    const billing = await reservationBilling(tx, reservationId);
    if (folio.status === "abierto" && !folioEditBlocker(folio.status, r) && (r.statusReservation === "EN_CURSO" || r.statusReservation === "FINALIZADA")) {
      await postAutomatic(tx, folio.id, r, billing, userId);
    }
    return folioView(tx, folio, r, billing);
  }));
}

/** Carga el alojamiento al hacer check-in (idempotente). Sin la migración 0034 no hace nada. */
export async function postAccommodationOnCheckIn(reservationId: number, userId: number | null): Promise<void> {
  try {
    await inTx(async (tx) => {
      const r = await lockReservation(tx, reservationId);
      const folio = await lockFolio(tx, reservationId);
      if (folio.status !== "abierto" || folioEditBlocker(folio.status, r)) return;
      await postAutomatic(tx, folio.id, r, await reservationBilling(tx, reservationId), userId);
    });
  } catch (e) {
    if (!isMissingPmsSchema(e)) throw e;
  }
}

export async function addFolioCharge(input: { reservationId: number; category: string; description: string; quantity: number; unitPriceCents: number; taxRateBp: number; userId: number | null }) {
  return folioSchema(() => inTx(async (tx) => {
    const r = await lockReservation(tx, input.reservationId);
    const folio = await lockFolio(tx, input.reservationId);
    const why = folioEditBlocker(folio.status, r);
    if (why) bad(why);
    const amount = chargeAmount(input.quantity, input.unitPriceCents);
    if (amount <= 0) bad("El importe del cargo debe ser mayor que cero.");
    await insertItem(tx, folio.id, {
      kind: "cargo", category: input.category, description: input.description.trim() || null, quantity: Math.max(1, Math.trunc(input.quantity)),
      unitPriceCents: Math.round(input.unitPriceCents), amountCents: amount, taxRateBp: input.taxRateBp, userId: input.userId,
    });
    return { ok: true as const };
  }));
}

export async function addFolioPayment(input: { reservationId: number; method: string; amountCents: number; description?: string; userId: number | null }) {
  return folioSchema(() => inTx(async (tx) => {
    const r = await lockReservation(tx, input.reservationId);
    const folio = await lockFolio(tx, input.reservationId);
    const why = folioEditBlocker(folio.status, r);
    if (why) bad(why);
    if (!(input.amountCents > 0)) bad("El importe del pago debe ser mayor que cero.");
    await insertItem(tx, folio.id, {
      kind: "pago", category: input.method, description: input.description?.trim() || null, quantity: 1, unitPriceCents: Math.round(input.amountCents),
      amountCents: Math.round(input.amountCents), taxRateBp: null, userId: input.userId,
    });
    return { ok: true as const };
  }));
}

/**
 * Cargo de otro módulo (Restaurant Net, Care Net) al folio de un huésped en casa, dentro de la transacción del módulo
 * que carga (la que cierra su comanda o su cita): o quedan las dos cosas o ninguna. Cada línea entra con su IVA. Un
 * mismo origen no puede estar cargado dos veces (índice único de hotel_folio_external_charges, migración 0041).
 */
export async function addExternalChargeInTx(
  tx: Exec,
  input: { reservationId: number; module: ExternalChargeModule; sourceRef: string; description: string; category: "restaurante" | "spa"; lines: ExternalChargeLine[]; userId: number | null },
): Promise<{ chargeId: number; folioId: number; amountCents: number }> {
  const problem = externalLinesProblem(input.lines);
  if (problem) bad(problem);
  const r = await lockReservation(tx, input.reservationId);
  if (r.statusReservation !== "EN_CURSO") bad("El huésped no está alojado ahora (sin check-in o ya salió): no se puede cargar a su habitación.");
  const folio = await lockFolio(tx, input.reservationId);
  const why = folioEditBlocker(folio.status, r);
  if (why) bad(why);
  const amount = input.lines.reduce((s, l) => s + chargeAmount(l.quantity, l.unitPriceCents), 0);
  const now = Date.now();
  let chargeId: number;
  try {
    const [res] = (await tx.execute(sql`
      INSERT INTO hotel_folio_external_charges (folio_id, reservation_id, source_module, source_ref, description, amount_cents, status, created_by, created_at)
      VALUES (${folio.id}, ${input.reservationId}, ${input.module}, ${input.sourceRef}, ${input.description.slice(0, 255)}, ${amount}, 'charged', ${input.userId}, ${now})`)) as unknown as [{ insertId: number }];
    chargeId = Number(res.insertId);
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    if ((x?.code ?? x?.cause?.code) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Esto ya está cargado a una habitación." });
    throw e;
  }
  let n = 0;
  for (const l of input.lines) {
    await insertItem(tx, folio.id, {
      kind: "cargo", category: input.category, description: l.description.slice(0, 255), quantity: l.quantity, unitPriceCents: l.unitPriceCents,
      amountCents: chargeAmount(l.quantity, l.unitPriceCents), taxRateBp: l.taxRateBp, sourceKey: externalItemKey(chargeId, ++n), userId: input.userId,
    });
  }
  return { chargeId, folioId: Number(folio.id), amountCents: amount };
}

/** Anula un cargo externo entero (todas sus líneas) y devuelve su origen a pendiente de cobro (en la misma transacción). */
async function revertExternalCharge(tx: Exec, folioId: number, chargeId: number, userId: number | null) {
  const [c] = await rows<{ id: number; source_module: string; source_ref: string; status: string }>(tx, sql`
    SELECT id, source_module, source_ref, status FROM hotel_folio_external_charges WHERE id = ${chargeId} AND folio_id = ${folioId} FOR UPDATE`);
  if (!c || c.status !== "charged") bad("Este cargo ya está anulado.");
  const reason = "Anulado desde el folio";
  const source = externalChargeSource(c.source_module);
  if (source) await source.onReverted(tx, c.source_ref, { reason, userId });
  await tx.delete(hotelFolioItems).where(and(eq(hotelFolioItems.folioId, folioId), like(hotelFolioItems.sourceKey, `ext:${chargeId}:%`)));
  await tx.execute(sql`UPDATE hotel_folio_external_charges SET status = 'reverted', reverted_by = ${userId}, reverted_at = ${Date.now()}, revert_reason = ${reason} WHERE id = ${chargeId}`);
}

/** Borra un cargo o pago manual de un folio abierto (los automáticos no). Un cargo de otro módulo se anula entero. */
export async function deleteFolioItem(input: { reservationId: number; itemId: number; userId?: number | null }) {
  return folioSchema(() => inTx(async (tx) => {
    const r = await lockReservation(tx, input.reservationId);
    const folio = await lockFolio(tx, input.reservationId);
    const why = folioEditBlocker(folio.status, r);
    if (why) bad(why);
    const [it] = await rows<{ id: number; source_key: string | null }>(tx, sql`SELECT id, source_key FROM hotel_folio_items WHERE id = ${input.itemId} AND folio_id = ${folio.id}`);
    if (!it) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento no encontrado" });
    const external = externalChargeIdOf(it.source_key);
    if (external !== null) {
      await revertExternalCharge(tx, folio.id, external, input.userId ?? null);
      return { ok: true as const };
    }
    if (it.source_key !== null) bad("Los cargos automáticos (noches y pago de la reserva) no se borran a mano.");
    await tx.delete(hotelFolioItems).where(eq(hotelFolioItems.id, input.itemId));
    return { ok: true as const };
  }));
}

/**
 * Cierra el folio y emite su factura (cobrada) con la numeración y el emisor de la empresa. Con el alojamiento dentro,
 * la reserva queda además pagada y enlazada a esa factura. Sin cargos, se cierra sin factura.
 */
export async function closeFolio(input: { reservationId: number; userId: number | null; clientName?: string; clientNif?: string; clientAddress?: string }) {
  return folioSchema(() => inTx(async (tx) => {
    const r = await lockReservation(tx, input.reservationId);
    const folio = await lockFolio(tx, input.reservationId);
    const billing = await reservationBilling(tx, input.reservationId);
    if (folio.status === "abierto" && !folioEditBlocker(folio.status, r)) await postAutomatic(tx, folio.id, r, billing, input.userId);
    const list = await items(tx, folio.id);
    const totals = folioTotals(list);
    const why = folioCloseBlocker(folio.status, r, totals);
    if (why) bad(why);

    const now = Date.now();
    let invoiceId: number | null = null;
    let invoiceNumber: string | null = null;
    if (totals.chargesCents > 0) {
      const taxBp = await accommodationTaxBp(tx);
      const lines = folioInvoiceLines(list as FolioItem[], { roomName: r.roomName, defaultTaxBp: taxBp });
      const a = chargedInvoiceAmounts(lines, totals.chargesCents / 100);
      invoiceNumber = await generateDocumentNumber("factura", "hotel:folio", input.userId != null ? String(input.userId) : "system");
      const issued = new Date(now);
      const [res] = await tx.insert(invoices).values({
        issuerSnapshot: await issuerSnapshotForNewInvoice(),
        invoiceNumber,
        reservationId: r.id,
        clientName: input.clientName?.trim() || r.customerName || "Cliente",
        clientEmail: r.customerEmail ?? "",
        clientPhone: r.customerPhone ?? null,
        clientNif: input.clientNif?.trim() || null,
        clientAddress: input.clientAddress?.trim() || null,
        itemsJson: lines,
        subtotal: a.subtotal.toFixed(2),
        discount: "0.00",
        taxRate: a.taxRate.toFixed(2),
        taxAmount: a.taxAmount.toFixed(2),
        taxBreakdown: a.taxBreakdown.length ? a.taxBreakdown : undefined,
        total: a.total.toFixed(2),
        status: "cobrada",
        paymentMethod: invoicePaymentMethod(list.filter((i) => i.kind === "pago"), billing.paymentMethod),
        isAutomatic: false,
        issuedAt: issued,
        createdAt: issued,
        updatedAt: issued,
      });
      invoiceId = Number((res as unknown as { insertId: number }).insertId);
      const withAccommodation = list.some((i) => i.kind === "cargo" && i.category === "alojamiento");
      if (withAccommodation) {
        // La reserva queda cobrada y con su factura (lo que ve el resto del Core: listados, informes, correos)
        await tx.execute(sql`
          UPDATE reservations SET status = 'paid', status_payment = 'PAGADO', amount_paid = GREATEST(COALESCE(amount_paid, 0), amount_total),
            paid_at = COALESCE(paid_at, ${now}), invoiceId = COALESCE(invoiceId, ${invoiceId}), invoiceNumber = COALESCE(invoiceNumber, ${invoiceNumber}),
            updated_at = ${now}
          WHERE id = ${r.id}`);
      }
    }
    await tx.execute(sql`
      UPDATE hotel_folios SET status = 'cerrado', invoice_id = ${invoiceId}, invoice_number = ${invoiceNumber}, closed_at = ${now}, closed_by = ${input.userId},
        updated_at = ${now}
      WHERE id = ${folio.id}`);
    return { ok: true as const, invoiceId, invoiceNumber, totalCents: totals.chargesCents };
  }));
}

// ─── Cierre del día e informes ────────────────────────────────────────────────

async function capacityNow(exec: Pick<Db, "execute">): Promise<number> {
  const [p] = await rows<{ n: number }>(exec, sql`SELECT COUNT(*) AS n FROM hotel_rooms WHERE is_active = 1`);
  const physical = Number(p?.n ?? 0);
  if (physical > 0) return physical;
  const [t] = await rows<{ n: number | null }>(exec, sql`SELECT SUM(totalUnits) AS n FROM room_types WHERE isActive = 1`);
  return Number(t?.n ?? 0);
}

async function auditStays(exec: Pick<Db, "execute">, from: string, to: string): Promise<AuditStay[]> {
  const list = await listHotelReservations({ from, to, limit: 2000 }, exec);
  const byRes = await assignmentsForReservations(exec, list.map((r) => r.id));
  return list.map((r) => {
    const a = byRes.get(r.id);
    return {
      id: r.id,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      // Solo una salida hecha acorta la estancia (la asignación se recorta en la salida anticipada)
      effectiveCheckOut: r.statusReservation === "FINALIZADA" && a && a.checkOut < r.checkOut ? a.checkOut : null,
      statusReservation: r.statusReservation,
      occupies: r.occupies,
      amountTotalCents: r.amountTotal,
    };
  });
}

/** Indicadores de cada día de [from, to] calculados en vivo, con el resumen del periodo y los cierres guardados. */
export async function getHotelReport(from: string, to: string) {
  return folioSchema(async () => {
    const d = await db();
    const [stays, capacity] = await Promise.all([auditStays(d, addDaysIso(from, -1), to), capacityNow(d)]);
    const days: NightKpis[] = [];
    for (let day = from; day <= to; day = addDaysIso(day, 1)) days.push(nightKpis(stays, day, capacity));
    const audits = await rows<{
      business_date: string; rooms_occupied: number; capacity: number; occupancy_bp: number; room_revenue_cents: number; adr_cents: number;
      revpar_cents: number; arrivals: number; departures: number; in_house: number; no_shows: number; source: string; ran_at: number | string;
    }>(d, sql`
      SELECT business_date, rooms_occupied, capacity, occupancy_bp, room_revenue_cents, adr_cents, revpar_cents, arrivals, departures, in_house,
        no_shows, source, ran_at
      FROM hotel_night_audit WHERE site_key = '' AND business_date >= ${from} AND business_date <= ${to} ORDER BY business_date`);
    return {
      today: todayInTimeZone(),
      days,
      summary: periodKpis(days),
      audits: audits.map((a) => ({
        businessDate: a.business_date, roomsOccupied: Number(a.rooms_occupied), capacity: Number(a.capacity), occupancyBp: Number(a.occupancy_bp),
        roomRevenueCents: Number(a.room_revenue_cents), adrCents: Number(a.adr_cents), revparCents: Number(a.revpar_cents),
        arrivals: Number(a.arrivals), departures: Number(a.departures), inHouse: Number(a.in_house), noShows: Number(a.no_shows),
        source: a.source, ranAt: Number(a.ran_at),
      })),
    };
  });
}

/**
 * Cierre del día de `businessDate` (sede principal): guarda sus indicadores. Repetirlo lo recalcula (único por sede y
 * fecha). No se cierra un día futuro.
 */
export async function runNightAudit(businessDate: string, opts: { userId: number | null; source: "manual" | "automatico" }) {
  return folioSchema(async () => {
    if (businessDate > todayInTimeZone()) bad("No se puede cerrar un día futuro.");
    const d = await db();
    const [stays, capacity] = await Promise.all([auditStays(d, addDaysIso(businessDate, -1), businessDate), capacityNow(d)]);
    const k = nightKpis(stays, businessDate, capacity);
    const now = Date.now();
    await d.execute(sql`
      INSERT INTO hotel_night_audit (site_id, business_date, arrivals, departures, in_house, no_shows, rooms_occupied, capacity, occupancy_bp,
        room_revenue_cents, adr_cents, revpar_cents, source, ran_by, ran_at)
      VALUES (NULL, ${businessDate}, ${k.arrivals}, ${k.departures}, ${k.inHouse}, ${k.noShows}, ${k.roomsOccupied}, ${k.capacity}, ${k.occupancyBp},
        ${k.roomRevenueCents}, ${k.adrCents}, ${k.revparCents}, ${opts.source}, ${opts.userId}, ${now})
      ON DUPLICATE KEY UPDATE arrivals = VALUES(arrivals), departures = VALUES(departures), in_house = VALUES(in_house), no_shows = VALUES(no_shows),
        rooms_occupied = VALUES(rooms_occupied), capacity = VALUES(capacity), occupancy_bp = VALUES(occupancy_bp),
        room_revenue_cents = VALUES(room_revenue_cents), adr_cents = VALUES(adr_cents), revpar_cents = VALUES(revpar_cents),
        source = VALUES(source), ran_by = VALUES(ran_by), ran_at = VALUES(ran_at)`);
    return k;
  });
}
