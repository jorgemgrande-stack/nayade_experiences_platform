/**
 * Facturación por líneas (fase E): detalle de cada factura cobrada (CRM 0019), reparto de los reembolsos entre sus
 * líneas y conciliación de partidas (Stripe frente a la suscripción interna).
 *
 *  - Cada línea enlaza Price → precio aprobado → producto del catálogo; el resto (cliente, empresa, pedido,
 *    suscripción, factura, documento fiscal) ya está en la factura registrada (0016) a la que pertenece.
 *  - Reembolso parcial: se reparte en proporción a lo que queda por reembolsar de cada línea cobrada (resto mayor
 *    para que la suma sea exacta). Nunca se reembolsa más que el importe de una línea.
 *  - Descuadre de partidas: producto o cantidad distintos entre Stripe y lo contratado. Solo se AVISA (alerta);
 *    corregirlo es una decisión del equipo (nunca se cambia Stripe ni la suscripción solos).
 *  - Los documentos fiscales los sigue emitiendo SOLO el sistema de facturación aprobado; aquí no se emite nada ni se
 *    afirma cumplimiento de VeriFactu.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { StripeMode } from "./config";
import type { GwInvoiceLine, GwSubscriptionItem } from "./gateway";

export interface InvoiceLineRow {
  stripeLineId: string;
  stripeInvoiceId: string;
  orderId: number;
  subscriptionItemId: string | null;
  stripePriceId: string | null;
  webPriceId: number | null;
  productKey: string | null;
  quantity: number | null;
  amountCents: number;
  taxCents: number | null;
  proration: boolean;
  periodStart: number | null;
  periodEnd: number | null;
  refundedCents: number;
}

/** Price de Stripe → precio aprobado y producto (desde el catálogo enlazado). */
export type PriceResolver = (stripePriceId: string) => Promise<{ webPriceId: number; productKey: string | null } | null>;

/** Líneas de una factura con su producto. Importes en céntimos; periodos en ms. */
export async function linesOf(invoiceId: string, orderId: number, lines: GwInvoiceLine[], resolve: PriceResolver): Promise<InvoiceLineRow[]> {
  const out: InvoiceLineRow[] = [];
  for (const l of lines) {
    const p = l.priceId ? await resolve(l.priceId) : null;
    out.push({
      stripeLineId: l.id,
      stripeInvoiceId: invoiceId,
      orderId,
      subscriptionItemId: l.subscriptionItemId,
      stripePriceId: l.priceId,
      webPriceId: p?.webPriceId ?? null,
      productKey: p?.productKey ?? null,
      quantity: l.quantity,
      amountCents: l.amount,
      taxCents: l.taxCents,
      proration: l.proration,
      periodStart: l.periodStart === null ? null : l.periodStart * 1000,
      periodEnd: l.periodEnd === null ? null : l.periodEnd * 1000,
      refundedCents: 0,
    });
  }
  return out;
}

/**
 * Reparte `deltaCents` reembolsados entre las líneas cobradas (importe con impuestos > 0), en proporción a lo que
 * queda por reembolsar de cada una. Devuelve el reparto (por línea) y lo que no cupo (debería ser 0).
 */
export function allocateRefund(lines: Array<Pick<InvoiceLineRow, "stripeLineId" | "amountCents" | "taxCents" | "refundedCents">>, deltaCents: number): { allocation: Map<string, number>; unallocated: number } {
  const allocation = new Map<string, number>();
  if (deltaCents <= 0) return { allocation, unallocated: 0 };
  const room = lines.map((l) => ({ id: l.stripeLineId, left: Math.max(l.amountCents + (l.taxCents ?? 0) - l.refundedCents, 0) })).filter((x) => x.left > 0);
  const total = room.reduce((a, x) => a + x.left, 0);
  if (total <= 0) return { allocation, unallocated: deltaCents };
  const amount = Math.min(deltaCents, total);
  const exact = room.map((x) => ({ ...x, share: (amount * x.left) / total }));
  let given = 0;
  for (const x of exact) {
    const v = Math.min(Math.floor(x.share), x.left);
    allocation.set(x.id, v);
    given += v;
  }
  // Resto mayor: los céntimos que faltan, a las líneas con mayor parte decimal (y con hueco)
  for (const x of exact.sort((a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)))) {
    if (given >= amount) break;
    if ((allocation.get(x.id) ?? 0) < x.left) {
      allocation.set(x.id, (allocation.get(x.id) ?? 0) + 1);
      given++;
    }
  }
  return { allocation, unallocated: deltaCents - given };
}

export interface ItemsDrift {
  /** Producto: cantidad en Stripe frente a la contratada (null = no está). */
  differences: Array<{ productKey: string; stripe: number | null; contracted: number | null }>;
  /** Partidas de Stripe con un Price que no es del catálogo enlazado. */
  unknownPrices: string[];
}

/** Partidas de Stripe frente a las contratadas (producto → cantidad vigente). */
export async function itemsDrift(stripeItems: GwSubscriptionItem[], contracted: Map<string, number>, resolve: PriceResolver): Promise<ItemsDrift> {
  const inStripe = new Map<string, number>();
  const unknownPrices: string[] = [];
  for (const i of stripeItems) {
    const p = await resolve(i.priceId);
    if (!p?.productKey) {
      unknownPrices.push(i.priceId);
      continue;
    }
    inStripe.set(p.productKey, (inStripe.get(p.productKey) ?? 0) + i.quantity);
  }
  const keys = Array.from(new Set([...Array.from(inStripe.keys()), ...Array.from(contracted.keys())])).sort();
  const differences = keys.filter((k) => (inStripe.get(k) ?? null) !== (contracted.get(k) ?? null)).map((k) => ({ productKey: k, stripe: inStripe.get(k) ?? null, contracted: contracted.get(k) ?? null }));
  return { differences, unknownPrices };
}

// ── Almacén ──────────────────────────────────────────────────────────────────

export interface InvoiceLineStore {
  /** Inserta las líneas que falten (idempotente por línea de Stripe; las existentes no se tocan). */
  upsertLines(lines: InvoiceLineRow[], now: number): Promise<number>;
  linesOf(stripeInvoiceId: string): Promise<InvoiceLineRow[]>;
  /** Suma lo reembolsado a cada línea (nunca por encima de su importe: lo garantiza la BD). */
  addRefunded(allocation: Map<string, number>, now: number): Promise<void>;
}

export class MemoryInvoiceLineStore implements InvoiceLineStore {
  rows: InvoiceLineRow[] = [];
  async upsertLines(lines: InvoiceLineRow[]) {
    let n = 0;
    for (const l of lines) {
      if (this.rows.some((r) => r.stripeLineId === l.stripeLineId)) continue;
      this.rows.push({ ...l });
      n++;
    }
    return n;
  }
  async linesOf(id: string) {
    return this.rows.filter((r) => r.stripeInvoiceId === id).map((r) => ({ ...r }));
  }
  async addRefunded(allocation: Map<string, number>) {
    for (const [id, v] of Array.from(allocation.entries())) {
      const r = this.rows.find((x) => x.stripeLineId === id);
      if (!r) continue;
      if (r.refundedCents + v > Math.max(r.amountCents + (r.taxCents ?? 0), 0)) throw new Error("Reembolso por encima del importe de la línea");
      r.refundedCents += v;
    }
  }
}

type Row = RowDataPacket & Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class MysqlInvoiceLineStore implements InvoiceLineStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    readonly mode: StripeMode = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  async upsertLines(lines: InvoiceLineRow[], now: number) {
    let created = 0;
    for (const l of lines) {
      try {
        await this.pool.query(
        `INSERT INTO stripe_invoice_lines (livemode, stripe_line_id, stripe_invoice_id, order_id, subscription_item_id, stripe_price_id, web_price_id, product_key, quantity, amount_cents, tax_cents, proration, period_start, period_end, refunded_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
        [this.lm, l.stripeLineId, l.stripeInvoiceId, l.orderId, l.subscriptionItemId, l.stripePriceId, l.webPriceId, l.productKey, l.quantity, l.amountCents, l.taxCents, l.proration ? 1 : 0, l.periodStart, l.periodEnd, now, now],
      );
        created++;
      } catch (e) {
        // Ya registrada (misma línea de Stripe): no se toca. Cualquier otro error (p. ej. sin factura) se propaga
        if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      }
    }
    return created;
  }
  async linesOf(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_invoice_lines WHERE stripe_invoice_id = ? AND livemode = ? ORDER BY id", [id, this.lm]);
    return rows.map((r) => ({
      stripeLineId: String(r.stripe_line_id),
      stripeInvoiceId: String(r.stripe_invoice_id),
      orderId: Number(r.order_id),
      subscriptionItemId: (r.subscription_item_id as string | null) ?? null,
      stripePriceId: (r.stripe_price_id as string | null) ?? null,
      webPriceId: n(r.web_price_id),
      productKey: (r.product_key as string | null) ?? null,
      quantity: n(r.quantity),
      amountCents: Number(r.amount_cents),
      taxCents: n(r.tax_cents),
      proration: Number(r.proration) === 1,
      periodStart: n(r.period_start),
      periodEnd: n(r.period_end),
      refundedCents: Number(r.refunded_cents),
    }));
  }
  async addRefunded(allocation: Map<string, number>, now: number) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      for (const [id, v] of Array.from(allocation.entries())) if (v > 0) await c.query("UPDATE stripe_invoice_lines SET refunded_cents = refunded_cents + ?, updated_at = ? WHERE stripe_line_id = ? AND livemode = ?", [v, now, id, this.lm]);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
}
