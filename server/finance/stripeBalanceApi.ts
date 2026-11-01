/**
 * Lector de Stripe por API para la contabilidad (punto de extensión `StripeBalanceSource` de la fase 2).
 *
 *  - Solo lectura (GET) con la clave restringida que ya usa el plano de control (`CP_STRIPE_API_KEY`); nunca crea,
 *    cambia ni cobra nada en Stripe y no toca el motor de cobros (`server/stripe`).
 *  - Devuelve las mismas filas que los informes CSV (`ParsedStripeTxn` y `ParsedPayout`): la deduplicación por id de
 *    transacción de saldo y de payout es la misma, así que la API y el CSV nunca contabilizan dos veces el mismo hecho.
 *  - Sin los permisos de lectura de saldo y payouts en la clave, responde `permission_missing` con los permisos que
 *    faltan (el control diario lo muestra como fuente no sincronizada); no se inventa ningún importe.
 */
import { madridDateKey } from "../utils/timezone";
import { normalizeStripeType } from "./stripeRules";
import type { ParsedPayout, ParsedStripeTxn, PayoutStatus } from "./stripeTypes";

export type StripeApiStatus = "ok" | "permission_missing" | "not_configured" | "error";

export interface StripeApiReadResult {
  status: StripeApiStatus;
  /** Permisos de la clave que faltan (p. ej. `balance_read`, `payout_read`). */
  missing: string[];
  message: string | null;
  txns: ParsedStripeTxn[];
  payouts: ParsedPayout[];
  /** Se alcanzó el tope de páginas: la siguiente pasada continúa. */
  truncated: boolean;
}

type Json = Record<string, unknown>;
type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<unknown> }>;

const API = "https://api.stripe.com/v1/";
const PAGE = 100;

class StripeReadError extends Error {
  constructor(
    readonly status: StripeApiStatus,
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
const dayOf = (ts: unknown) => (typeof ts === "number" ? madridDateKey(new Date(ts * 1000)) : null);
const idOf = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? str((v as Json).id) : null);

/** Transacción de saldo de la API → fila del informe. `payoutOf` da el payout automático que la liquidó. */
export function txnFromApi(bt: Json, o: { invoiceOf?: ReadonlyMap<string, string>; payoutOf?: ReadonlyMap<string, string> } = {}): ParsedStripeTxn {
  const gross = int(bt.amount);
  const fee = int(bt.fee);
  const rawType = str(bt.reporting_category) ?? str(bt.type) ?? "";
  const description = str(bt.description);
  const source = bt.source && typeof bt.source === "object" ? (bt.source as Json) : null;
  const sourceId = idOf(bt.source);
  const type = normalizeStripeType(rawType, gross, description);
  const chargeId = sourceId?.startsWith("ch_") || sourceId?.startsWith("py_") ? sourceId : source ? idOf(source.charge) : null;
  const paymentIntentId = source ? idOf(source.payment_intent) : null;
  const billing = source?.billing_details && typeof source.billing_details === "object" ? (source.billing_details as Json) : null;
  const id = String(bt.id);
  return {
    balanceTransactionId: id,
    type,
    rawType,
    createdTs: typeof bt.created === "number" ? bt.created * 1000 : null,
    createdOn: dayOf(bt.created)!,
    availableOn: dayOf(bt.available_on),
    currency: String(bt.currency ?? "").toUpperCase(),
    grossCents: gross,
    feeCents: fee,
    netCents: gross - fee,
    sourceId,
    description,
    customerId: source ? idOf(source.customer) : null,
    customerEmail: billing ? str(billing.email) : source ? str(source.receipt_email) : null,
    chargeId,
    paymentIntentId,
    stripeInvoiceId: paymentIntentId ? (o.invoiceOf?.get(paymentIntentId) ?? null) : null,
    stripePayoutId: type === "payout" || type === "payout_reversal" ? (sourceId?.startsWith("po_") ? sourceId : null) : (o.payoutOf?.get(id) ?? null),
    payoutArrivalOn: null,
  };
}

const PAYOUT_STATUS: Record<string, PayoutStatus> = { paid: "paid", pending: "pending", in_transit: "in_transit", canceled: "canceled", failed: "failed" };

/** Payout de la API → fila del informe de payouts. */
export function payoutFromApi(p: Json): ParsedPayout {
  return {
    payoutId: String(p.id),
    createdOn: dayOf(p.created),
    arrivalOn: dayOf(p.arrival_date) ?? dayOf(p.created)!,
    currency: String(p.currency ?? "").toUpperCase(),
    amountCents: int(p.amount),
    feeCents: 0,
    status: PAYOUT_STATUS[String(p.status)] ?? "pending",
    description: str(p.description),
  };
}

export class StripeApiBalanceReader {
  private readonly fetch: FetchLike;
  private readonly maxPages: number;
  constructor(private readonly o: { apiKey: string | undefined | null; fetch?: FetchLike; maxPages?: number }) {
    this.fetch = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.maxPages = o.maxPages ?? 10;
  }

  private async get(path: string): Promise<Json> {
    const r = await this.fetch(API + path, { headers: { Authorization: `Bearer ${this.o.apiKey}`, "Stripe-Version": "2026-09-30.endive" } });
    const j = ((await r.json().catch(() => ({}))) ?? {}) as Json;
    const err = j.error && typeof j.error === "object" ? (j.error as Json) : null;
    if (r.status >= 400 || err) {
      const message = String(err?.message ?? `HTTP ${r.status}`);
      if (err?.code === "more_permissions_required" || r.status === 403) {
        const missing = Array.from(message.matchAll(/\('([a-z_]+)'\)/g), (m) => m[1]);
        throw new StripeReadError("permission_missing", message.replace(/\b[rs]k_[A-Za-z0-9_.]+/g, "(clave)").slice(0, 300), missing);
      }
      throw new StripeReadError("error", message.slice(0, 300));
    }
    return j;
  }

  private async list(path: string, params: string): Promise<{ items: Json[]; truncated: boolean }> {
    const items: Json[] = [];
    let after: string | null = null;
    for (let page = 0; page < this.maxPages; page++) {
      const j = await this.get(`${path}?limit=${PAGE}${params}${after ? `&starting_after=${after}` : ""}`);
      const data = Array.isArray(j.data) ? (j.data as Json[]) : [];
      items.push(...data);
      if (!j.has_more || !data.length) return { items, truncated: false };
      after = String(data[data.length - 1].id);
    }
    return { items, truncated: true };
  }

  /** Factura de Stripe (solo lectura) para contrastar un cobro antes de expedir la factura propia; null si no se puede leer. */
  async invoice(id: string): Promise<{ status: string; amountPaid: number; currency: string } | null> {
    if (!this.o.apiKey || !/^in_[A-Za-z0-9]+$/.test(id)) return null;
    try {
      const j = await this.get(`invoices/${id}`);
      return { status: String(j.status ?? ""), amountPaid: int(j.amount_paid), currency: String(j.currency ?? "").toUpperCase() };
    } catch {
      return null;
    }
  }

  /** Transacciones de saldo y payouts creados desde `sinceTs` (segundos). Nunca lanza: el estado va en el resultado. */
  async read(sinceTs: number): Promise<StripeApiReadResult> {
    const empty = { txns: [], payouts: [], truncated: false };
    if (!this.o.apiKey) return { status: "not_configured", missing: [], message: "Stripe no está configurado en este entorno", ...empty };
    const missing = new Set<string>();
    let message: string | null = null;
    const attempt = async <T>(f: () => Promise<T>): Promise<T | null> => {
      try {
        return await f();
      } catch (e) {
        if (e instanceof StripeReadError && e.status === "permission_missing") {
          e.missing.forEach((m) => missing.add(m));
          message = e.message;
          return null;
        }
        throw e;
      }
    };
    try {
      const since = `&created[gte]=${Math.floor(sinceTs)}`;
      const payouts = await attempt(() => this.list("payouts", since));
      const bts = await attempt(() => this.list("balance_transactions", `${since}&expand[]=data.source`));
      if (!bts || !payouts) return { status: "permission_missing", missing: Array.from(missing), message, ...empty };
      // Payout automático de cada transacción (el informe CSV lo trae en `automatic_payout_id`)
      const payoutOf = new Map<string, string>();
      for (const p of payouts.items) {
        if (!p.automatic) continue;
        const inc = await this.list("balance_transactions", `&payout=${encodeURIComponent(String(p.id))}`);
        for (const t of inc.items) payoutOf.set(String(t.id), String(p.id));
      }
      // Factura de Stripe de cada cobro (por su PaymentIntent), para casarlo con la factura propia
      const invoiceOf = new Map<string, string>();
      for (const bt of bts.items) {
        const src = bt.source && typeof bt.source === "object" ? (bt.source as Json) : null;
        const pi = src ? idOf(src.payment_intent) : null;
        if (!pi || invoiceOf.has(pi) || normalizeStripeType(str(bt.reporting_category) ?? str(bt.type) ?? "", int(bt.amount), str(bt.description)) !== "charge") continue;
        const ip = await this.get(`invoice_payments?limit=1&payment[type]=payment_intent&payment[payment_intent]=${encodeURIComponent(pi)}`).catch(() => null);
        const inv = ip && Array.isArray(ip.data) && ip.data[0] ? idOf((ip.data[0] as Json).invoice) : null;
        if (inv) invoiceOf.set(pi, inv);
      }
      return {
        status: "ok",
        missing: [],
        message: null,
        txns: bts.items.map((bt) => txnFromApi(bt, { invoiceOf, payoutOf })),
        payouts: payouts.items.map(payoutFromApi),
        truncated: bts.truncated || payouts.truncated,
      };
    } catch (e) {
      return { status: "error", missing: [], message: e instanceof Error ? e.message.slice(0, 300) : "error", ...empty };
    }
  }
}
