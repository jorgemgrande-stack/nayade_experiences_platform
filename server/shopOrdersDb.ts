/**
 * Pedidos de la tienda online de una pyme (lógica de BD). Un pedido = las líneas de `reservations` con el mismo
 * número de pedido del pago (`merchantOrder`), canal ONLINE_DIRECTO y sin presupuesto. Estados, validación y textos
 * en shared/shopOrders.ts.
 *
 *  - `recordCheckoutDetails`: guarda los datos fiscales del comprador al iniciar el pago.
 *  - `finalizePaidShopOrder`: con el pago confirmado, vincula el cliente del CRM y emite UNA factura para todo el
 *    pedido (idempotente: si alguna línea ya tiene factura, no emite otra).
 *  - `sendShopOrderConfirmation` / `setOnlineOrderStage`: correos al comprador con la plantilla genérica.
 *  - `listOnlineOrders` / `getOnlineOrder`: panel.
 */
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { clients, crmActivityLog, experiences, invoices, reservations } from "../drizzle/schema";
import {
  allowedStageChanges,
  billingFromLog,
  billingLogEntry,
  buyerCommentsFromNotes,
  canChangeStage,
  ORDER_STAGE_LABELS,
  stageEmailText,
  stageOfOrder,
  stageOfRow,
  stagePatch,
  STAGES_NOTIFIED,
  type OrderBilling,
  type OrderStage,
} from "../shared/shopOrders";
import { formatEuros } from "../shared/storefront";
import { chargedInvoiceAmounts } from "./invoiceCalc";
import { issuerSnapshotForNewInvoice } from "./issuerSnapshot";

type Row = typeof reservations.$inferSelect;

const eur = (cents: number | null | undefined) => formatEuros((Number(cents) || 0) / 100) ?? "0,00 €";

/** Condición de las líneas de pedidos de la tienda (pago online directo, sin presupuesto). */
const onlineShop = () => and(eq(reservations.channel, "ONLINE_DIRECTO"), isNull(reservations.quoteId));

// ─── Pago ────────────────────────────────────────────────────────────────────

/** Datos fiscales del comprador en el historial de cada línea del pedido (sin columnas nuevas). */
export async function recordCheckoutDetails(merchantOrder: string, billing: OrderBilling | null): Promise<void> {
  if (!billing) return;
  const db = await getDb();
  if (!db) return;
  const rows = await db.select({ id: reservations.id, changesLog: reservations.changesLog }).from(reservations).where(eq(reservations.merchantOrder, merchantOrder));
  const entry = billingLogEntry(billing, Date.now());
  for (const r of rows) {
    const log = Array.isArray(r.changesLog) ? r.changesLog : [];
    await db.update(reservations).set({ changesLog: [...log, entry] }).where(eq(reservations.id, r.id));
  }
}

export interface FinalizeResult {
  clientId: number | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  created: boolean;
}

/** Cliente del CRM del comprador: el de su correo o uno nuevo; completa NIF y dirección si faltaban. */
async function linkClient(rows: Row[], billing: OrderBilling | null): Promise<number | null> {
  const db = await getDb();
  const first = rows[0];
  const email = (first?.customerEmail ?? "").trim().toLowerCase();
  if (!db || !first || !email) return null;
  let [client] = await db.select().from(clients).where(eq(clients.email, email)).limit(1);
  if (!client) {
    try {
      await db.insert(clients).values({ source: "tienda", name: first.customerName, email, phone: first.customerPhone ?? "", company: billing?.name ?? "", nif: billing?.nif ?? "", address: billing?.address ?? null, tags: [], isConverted: true, totalBookings: 0 });
    } catch {
      /* creado a la vez por otra petición: se lee abajo */
    }
    [client] = await db.select().from(clients).where(eq(clients.email, email)).limit(1);
    if (!client) return null;
  } else {
    const patch: Partial<typeof clients.$inferInsert> = { isConverted: true };
    if (billing && !(client.nif ?? "").trim()) patch.nif = billing.nif;
    if (billing?.address && !(client.address ?? "").trim()) patch.address = billing.address;
    if (billing?.name && !(client.company ?? "").trim()) patch.company = billing.name;
    if (!(client.phone ?? "").trim() && first.customerPhone) patch.phone = first.customerPhone;
    await db.update(clients).set(patch).where(eq(clients.id, client.id));
  }
  await db.update(reservations).set({ clientId: client.id }).where(and(inArray(reservations.id, rows.map((r) => r.id)), isNull(reservations.clientId)));
  return client.id;
}

/** Tipo de IVA de cada producto (21 si no consta). */
async function taxRates(productIds: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const out = new Map<number, number>();
  if (!db || !productIds.length) return out;
  const rows = await db.select({ id: experiences.id, taxRate: experiences.taxRate, fiscalRegime: experiences.fiscalRegime }).from(experiences).where(inArray(experiences.id, productIds));
  for (const r of rows) {
    const t = Number(r.taxRate ?? 21);
    out.set(r.id, r.fiscalRegime === "reav" ? 0 : Number.isFinite(t) ? t : 21);
  }
  return out;
}

/** Líneas de la factura de un pedido (importes con IVA incluido, como en la tienda). */
export function invoiceLinesFor(rows: Pick<Row, "productId" | "productName" | "people" | "amountTotal">[], rates: Map<number, number>) {
  return rows.map((r) => {
    const total = Math.round(Number(r.amountTotal) || 0) / 100;
    const qty = Math.max(1, Number(r.people) || 1);
    return { description: r.productName, quantity: qty, unitPrice: Math.round((total / qty) * 100) / 100, total, fiscalRegime: "general" as const, taxRate: rates.get(r.productId) ?? 21 };
  });
}

/**
 * Pedido pagado: cliente vinculado y una factura cobrada para todo el pedido. Idempotente: con factura en alguna
 * línea solo completa el vínculo del cliente.
 */
export async function finalizePaidShopOrder(merchantOrder: string): Promise<FinalizeResult> {
  const db = await getDb();
  if (!db) return { clientId: null, invoiceId: null, invoiceNumber: null, created: false };
  const rows = (await db.select().from(reservations).where(and(eq(reservations.merchantOrder, merchantOrder), onlineShop()))).filter((r) => r.status === "paid");
  if (!rows.length) return { clientId: null, invoiceId: null, invoiceNumber: null, created: false };
  const billing = rows.map((r) => billingFromLog(r.changesLog)).find(Boolean) ?? null;
  const clientId = await linkClient(rows, billing);
  const existing = rows.find((r) => r.invoiceId);
  if (existing) return { clientId, invoiceId: existing.invoiceId, invoiceNumber: existing.invoiceNumber, created: false };

  const items = invoiceLinesFor(rows, await taxRates(Array.from(new Set(rows.map((r) => r.productId)))));
  const paidCents = rows.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
  const charged = paidCents > 0 ? paidCents / 100 : items.reduce((s, i) => s + i.total, 0);
  const a = chargedInvoiceAmounts(items, charged);
  const { generateDocumentNumber } = await import("./documentNumbers");
  const invoiceNumber = await generateDocumentNumber("factura", "tienda:pedido", "system");
  const now = new Date();
  const first = rows[0];
  const [res] = await db.insert(invoices).values({
    issuerSnapshot: await issuerSnapshotForNewInvoice(),
    invoiceNumber,
    reservationId: first.id,
    clientName: billing?.name || first.customerName || "Cliente",
    clientEmail: first.customerEmail ?? "",
    clientPhone: first.customerPhone ?? null,
    clientNif: billing?.nif ?? null,
    clientAddress: billing?.address ?? null,
    itemsJson: items,
    subtotal: a.subtotal.toFixed(2),
    discount: a.discount.toFixed(2),
    discountReason: a.discount > 0 ? "Código de descuento" : null,
    taxRate: a.taxRate.toFixed(2),
    taxAmount: a.taxAmount.toFixed(2),
    taxBreakdown: a.taxBreakdown.length ? a.taxBreakdown : undefined,
    total: a.total.toFixed(2),
    status: "cobrada",
    paymentMethod: "tarjeta_redsys",
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const invoiceId = (res as unknown as { insertId: number }).insertId;
  await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() }).where(inArray(reservations.id, rows.map((r) => r.id)));
  return { clientId, invoiceId, invoiceNumber, created: true };
}

// ─── Correos al comprador ────────────────────────────────────────────────────

/** ¿Llegan los correos a los compradores? En la prueba gratuita solo salen a los buzones de la empresa. */
export async function buyerEmailsEnabled(): Promise<boolean> {
  try {
    const { currentCommercialState } = await import("./trialRestrictions");
    return !(await currentCommercialState()).restricted;
  } catch {
    return false;
  }
}

async function orderEmail(rows: Row[], o: { title: string; badge: string; intro: string; statusLabel?: string; withTotals: boolean }) {
  const { buildShopOrderEmailHtml } = await import("./emailTemplates");
  const first = rows[0];
  const lineCents = rows.reduce((s, r) => s + (Number(r.amountTotal) || 0), 0);
  const paidCents = rows.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
  const discount = paidCents > 0 && paidCents < lineCents ? eur(lineCents - paidCents) : null;
  return buildShopOrderEmailHtml({
    title: o.title,
    badge: o.badge,
    customerName: first.customerName,
    orderNumber: first.merchantOrder,
    intro: o.intro,
    lines: rows.map((r) => ({ name: r.productName, quantity: r.people ?? 1, total: eur(r.amountTotal) })),
    total: o.withTotals ? eur(paidCents > 0 ? paidCents : lineCents) : null,
    discount: o.withTotals ? discount : null,
    invoiceNumber: first.invoiceNumber ?? null,
    statusLabel: o.statusLabel ?? null,
  });
}

/** Confirmación del pedido pagado al comprador (plantilla «Confirmación de Pedido») y copia a la empresa. */
export async function sendShopOrderConfirmation(merchantOrder: string): Promise<{ sent: boolean }> {
  const db = await getDb();
  if (!db) return { sent: false };
  const rows = (await db.select().from(reservations).where(and(eq(reservations.merchantOrder, merchantOrder), onlineShop()))).filter((r) => r.status === "paid");
  const first = rows[0];
  if (!first || first.confirmationEmailSentAt || !first.customerEmail) return { sent: false };
  const { brandName } = await import("./tenantBrand");
  const { sendManagedEmail, logDirectEmail } = await import("./emailManager");
  const html = await orderEmail(rows, { title: "Pedido confirmado", badge: "Pedido", intro: "Hemos recibido tu pago y tu pedido está confirmado. Este es el resumen:", withTotals: true });
  const subject = `Pedido confirmado ${first.merchantOrder} · ${brandName()}`;
  const r = await sendManagedEmail({ templateKey: "reservation_confirm", triggerEvent: "shop_order_paid", recipientEmail: first.customerEmail, subject, html, relatedEntityType: "reservation", relatedEntityId: first.id, reservationId: first.id, isAutomatic: true });
  // Copia a la empresa (buzón de pedidos): así se entera de la venta aunque el comprador no reciba el correo
  try {
    const { getBusinessEmail } = await import("./config");
    const copy = await getBusinessEmail("reservations");
    if (copy) {
      const { sendEmail } = await import("./mailer");
      const copySubject = `[Copia] Pedido ${first.merchantOrder} · ${first.customerName}`;
      const ok = await sendEmail({ to: copy, subject: copySubject, html }).catch(() => false);
      logDirectEmail({ templateKey: "reservation_confirm", triggerEvent: "shop_order_paid_copy", recipientEmail: copy, subject: copySubject, sent: !!ok, isAutomatic: true }).catch(() => {});
    }
  } catch {
    /* sin buzón de la empresa: solo el del comprador */
  }
  await db.update(reservations).set({ confirmationEmailSentAt: new Date() }).where(inArray(reservations.id, rows.map((x) => x.id)));
  return { sent: !!r.sent };
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export interface OnlineOrderSummary {
  merchantOrder: string;
  createdAt: number;
  customerName: string;
  customerEmail: string | null;
  items: number;
  productNames: string[];
  totalCents: number;
  stage: OrderStage;
  stageLabel: string;
  invoiceNumber: string | null;
}

function summarize(rows: Row[]): OnlineOrderSummary {
  const first = rows[0];
  const stage = stageOfOrder(rows);
  const lineCents = rows.reduce((s, r) => s + (Number(r.amountTotal) || 0), 0);
  const paidCents = rows.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
  return {
    merchantOrder: first.merchantOrder,
    createdAt: Math.min(...rows.map((r) => Number(r.createdAt) || 0)),
    customerName: first.customerName,
    customerEmail: first.customerEmail ?? null,
    items: rows.reduce((s, r) => s + (r.people ?? 1), 0),
    productNames: rows.map((r) => r.productName),
    totalCents: paidCents > 0 ? paidCents : lineCents,
    stage,
    stageLabel: ORDER_STAGE_LABELS[stage],
    invoiceNumber: rows.find((r) => r.invoiceNumber)?.invoiceNumber ?? null,
  };
}

/** Pedidos online, más recientes primero. Se agrupan en memoria las últimas líneas (volumen de una pyme). */
export async function listOnlineOrders(f: { stage?: OrderStage | "all"; search?: string; limit?: number; offset?: number }): Promise<{ items: OnlineOrderSummary[]; total: number; counts: Record<OrderStage, number> }> {
  const db = await getDb();
  const counts = { pending_payment: 0, paid: 0, prepared: 0, delivered: 0, cancelled: 0, failed: 0 } as Record<OrderStage, number>;
  if (!db) return { items: [], total: 0, counts };
  const q = (f.search ?? "").trim();
  const where = q
    ? and(onlineShop(), or(like(reservations.merchantOrder, `%${q}%`), like(reservations.customerName, `%${q}%`), like(reservations.customerEmail, `%${q}%`), like(reservations.productName, `%${q}%`)))
    : onlineShop();
  const rows = await db.select().from(reservations).where(where).orderBy(desc(reservations.createdAt)).limit(2000);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groups.get(r.merchantOrder);
    if (g) g.push(r);
    else groups.set(r.merchantOrder, [r]);
  }
  const all = Array.from(groups.values()).map(summarize);
  for (const o of all) counts[o.stage]++;
  const filtered = f.stage && f.stage !== "all" ? all.filter((o) => o.stage === f.stage) : all;
  const offset = f.offset ?? 0;
  return { items: filtered.slice(offset, offset + (f.limit ?? 50)), total: filtered.length, counts };
}

export async function getOnlineOrder(merchantOrder: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(reservations).where(and(eq(reservations.merchantOrder, merchantOrder), onlineShop())).orderBy(reservations.id);
  if (!rows.length) return null;
  const s = summarize(rows);
  const first = rows[0];
  const lineCents = rows.reduce((sum, r) => sum + (Number(r.amountTotal) || 0), 0);
  const paidCents = rows.reduce((sum, r) => sum + (Number(r.amountPaid) || 0), 0);
  let clientId = rows.find((r) => r.clientId)?.clientId ?? null;
  if (!clientId && first.customerEmail) {
    const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.email, first.customerEmail.toLowerCase())).limit(1);
    clientId = c?.id ?? null;
  }
  const invIds = Array.from(new Set(rows.map((r) => r.invoiceId).filter((x): x is number => !!x)));
  const invs = invIds.length ? await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status, total: invoices.total, pdfUrl: invoices.pdfUrl }).from(invoices).where(inArray(invoices.id, invIds)) : [];
  const history = rows
    .flatMap((r) => (Array.isArray(r.changesLog) ? r.changesLog : []))
    .filter((e) => e && e.action === "order_stage")
    .sort((a, b) => a.ts - b.ts)
    .filter((e, i, arr) => i === 0 || arr[i - 1].ts !== e.ts || arr[i - 1].to !== e.to);
  return {
    ...s,
    stageChanges: allowedStageChanges(s.stage),
    buyerEmails: await buyerEmailsEnabled(),
    customerPhone: first.customerPhone ?? null,
    billing: rows.map((r) => billingFromLog(r.changesLog)).find(Boolean) ?? null,
    comments: buyerCommentsFromNotes(first.notes),
    lines: rows.map((r) => ({ id: r.id, productName: r.productName, quantity: r.people ?? 1, amountCents: Number(r.amountTotal) || 0, date: /^\d{4}-\d{2}-\d{2}$/.test(r.bookingDate ?? "") ? r.bookingDate : null, stage: stageOfRow(r) })),
    lineCents,
    paidCents,
    discountCents: paidCents > 0 && paidCents < lineCents ? lineCents - paidCents : 0,
    paidAt: rows.find((r) => r.paidAt)?.paidAt ?? null,
    clientId,
    invoices: invs,
    firstLineId: first.id,
    history: history.map((e) => ({ ts: e.ts, actor: e.actor, from: e.from ?? null, to: e.to ?? null })),
  };
}

export class OrderStageError extends Error {}

/** Cambia el estado de todo el pedido y, si toca, avisa al comprador. */
export async function setOnlineOrderStage(merchantOrder: string, to: OrderStage, actor: { id: number; name: string | null }): Promise<{ stage: OrderStage; emailed: boolean }> {
  const db = await getDb();
  if (!db) throw new OrderStageError("No se puede acceder a los pedidos ahora mismo.");
  const rows = await db.select().from(reservations).where(and(eq(reservations.merchantOrder, merchantOrder), onlineShop()));
  if (!rows.length) throw new OrderStageError("No se encuentra el pedido.");
  const from = stageOfOrder(rows);
  if (from === to) return { stage: to, emailed: false };
  if (!canChangeStage(from, to)) throw new OrderStageError(`Un pedido «${ORDER_STAGE_LABELS[from].toLowerCase()}» no puede pasar a «${ORDER_STAGE_LABELS[to].toLowerCase()}».`);
  const patch = stagePatch(to);
  if (!patch) throw new OrderStageError("Ese estado no se puede fijar a mano.");
  const now = Date.now();
  const entry = { ts: now, actor: actor.name ?? String(actor.id), action: "order_stage", from, to };
  for (const r of rows) {
    if (stageOfRow(r) === "cancelled" || stageOfRow(r) === "failed") continue;
    const log = Array.isArray(r.changesLog) ? r.changesLog : [];
    await db.update(reservations).set({ ...patch, updatedAt: now, changesLog: [...log, entry] }).where(eq(reservations.id, r.id));
  }
  await db.insert(crmActivityLog).values({ entityType: "reservation", entityId: rows[0].id, action: "status_updated", actorId: actor.id, actorName: actor.name ?? null, details: { from, to, merchantOrder } });

  let emailed = false;
  const text = stageEmailText(to);
  const first = rows[0];
  if (text && STAGES_NOTIFIED.includes(to) && first.customerEmail) {
    try {
      const fresh = await db.select().from(reservations).where(eq(reservations.merchantOrder, merchantOrder));
      const { brandName } = await import("./tenantBrand");
      const { sendManagedEmail } = await import("./emailManager");
      const html = await orderEmail(fresh, { title: text.title, badge: "Pedido", intro: text.paragraph, statusLabel: ORDER_STAGE_LABELS[to], withTotals: to !== "cancelled" });
      const r = await sendManagedEmail({ templateKey: "reservation_confirm", triggerEvent: `shop_order_${to}`, recipientEmail: first.customerEmail, subject: `${text.subject} · ${first.merchantOrder} · ${brandName()}`, html, relatedEntityType: "reservation", relatedEntityId: first.id, reservationId: first.id, isAutomatic: true });
      emailed = !!r.sent;
    } catch (e) {
      console.error("[shopOrders] No se pudo avisar al comprador:", (e as Error).message);
    }
  }
  return { stage: to, emailed };
}

/** Pago no completado: aviso genérico al comprador (plantilla «Pago No Completado»). */
export async function sendShopOrderFailed(merchantOrder: string): Promise<{ sent: boolean }> {
  const db = await getDb();
  if (!db) return { sent: false };
  const rows = await db.select().from(reservations).where(and(eq(reservations.merchantOrder, merchantOrder), onlineShop()));
  const first = rows[0];
  if (!first?.customerEmail) return { sent: false };
  const { brandName } = await import("./tenantBrand");
  const { sendManagedEmail } = await import("./emailManager");
  const html = await orderEmail(rows, { title: "Pago no completado", badge: "Pedido", intro: "No hemos podido completar el pago de tu pedido. No se te ha cobrado nada: puedes volver a intentarlo desde la tienda o escribirnos y te ayudamos.", withTotals: true });
  const r = await sendManagedEmail({ templateKey: "reservation_failed", triggerEvent: "shop_order_payment_failed", recipientEmail: first.customerEmail, subject: `Pago no completado · ${first.merchantOrder} · ${brandName()}`, html, relatedEntityType: "reservation", relatedEntityId: first.id, reservationId: first.id, isAutomatic: true });
  return { sent: !!r.sent };
}

/** ¿El pago es de un pedido de la tienda genérica (pyme)? Solo pedidos web directos, sin presupuesto. */
export async function isGenericShopOrder(rows: Array<{ channel?: string | null; quoteId?: number | null }>): Promise<boolean> {
  if (!rows.length || !rows.every((r) => r.channel === "ONLINE_DIRECTO" && !r.quoteId)) return false;
  const { getStorefront } = await import("./storefront");
  return (await getStorefront()).kind === "generic";
}
