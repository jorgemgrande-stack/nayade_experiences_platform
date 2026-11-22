/**
 * Almacén de los cobros por empresa (migración 0080), en la base de la empresa activa. Interfaz + implementación MySQL.
 * Sin la migración, las lecturas devuelven «vacío» y las escrituras lanzan `PaymentsSchemaMissing`, que el router
 * traduce a un aviso claro.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { PaymentAccountStatus, PaymentMode } from "../../shared/paymentAccounts";

export class PaymentsSchemaMissing extends Error {
  constructor() {
    super("Falta la migración 0080 (payment_accounts) en la base de la empresa");
    this.name = "PaymentsSchemaMissing";
  }
}

export interface PaymentAccountRow {
  mode: PaymentMode;
  accountId: string;
  status: PaymentAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  onlineEnabled: boolean;
  connectedAt: number;
  verifiedAt: number | null;
  lastEventId: string | null;
  lastEventType: string | null;
  lastEventAt: number | null;
}

export interface CheckoutRow {
  sessionId: string;
  mode: PaymentMode;
  accountId: string;
  kind: "quote" | "shop_order";
  /** Presupuesto (kind = quote); null en un pedido de la tienda. */
  quoteId: number | null;
  /** Pedido de la tienda (kind = shop_order); null en un presupuesto. */
  merchantOrder: string | null;
  amountCents: number;
  currency: string;
  status: "pending" | "paid" | "expired" | "failed";
  paymentIntentId: string | null;
  createdAt: number;
  paidAt: number | null;
}

export interface AccountUpdate {
  status: PaymentAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  now: number;
  by?: string | null;
}

export interface PaymentStore {
  getAccount(mode: PaymentMode): Promise<PaymentAccountRow | null>;
  /** Alta de la cuenta del modo. Si ya hay una con otro identificador, no la pisa (devuelve la existente). */
  insertAccount(mode: PaymentMode, accountId: string, now: number, by: string | null): Promise<PaymentAccountRow>;
  updateAccount(mode: PaymentMode, u: AccountUpdate): Promise<PaymentAccountRow | null>;
  /** El interruptor se apaga siempre; solo se enciende con la cuenta verificada (condición en la propia escritura). */
  setOnline(mode: PaymentMode, enabled: boolean, now: number, by: string | null): Promise<boolean>;
  noteEvent(mode: PaymentMode, e: { id: string; type: string; at: number }): Promise<void>;
  /** Registra el evento por su id. `true` = es nuevo; `false` = ya se había recibido (repetido). */
  claimEvent(e: { eventId: string; accountId: string | null; mode: PaymentMode; type: string; outcome: string; at: number }): Promise<boolean>;
  setEventOutcome(eventId: string, outcome: string): Promise<void>;
  /** Un evento que falló al aplicarse (outcome «failed») se puede reintentar: lo reserva de nuevo. `true` si lo reserva esta llamada. */
  reclaimFailedEvent(eventId: string): Promise<boolean>;
  insertCheckout(c: Omit<CheckoutRow, "status" | "paidAt" | "paymentIntentId">): Promise<void>;
  getCheckout(sessionId: string): Promise<CheckoutRow | null>;
  /** Todas las sesiones de pago creadas para un presupuesto (cualquier estado), de la más antigua a la más reciente. */
  listQuoteCheckouts(quoteId: number): Promise<CheckoutRow[]>;
  /** pending → paid de forma atómica. `true` solo para la llamada que hace el cambio. */
  markCheckoutPaid(sessionId: string, paymentIntentId: string | null, now: number): Promise<boolean>;
  /** Vuelve a «pending» una sesión marcada «paid» cuyo efecto no llegó a aplicarse (para que el reintento de Stripe actúe). */
  revertCheckoutPaid(sessionId: string): Promise<void>;
  setCheckoutStatus(sessionId: string, status: "expired" | "failed"): Promise<void>;
}

type Row = Record<string, any>;
const bool = (v: unknown) => Number(v) === 1;
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

function toAccount(r: Row): PaymentAccountRow {
  let due: string[] = [];
  try {
    const p = r.requirements_due ? JSON.parse(String(r.requirements_due)) : [];
    if (Array.isArray(p)) due = p.map(String);
  } catch {
    /* valor ilegible: sin requisitos conocidos */
  }
  return {
    mode: r.mode,
    accountId: String(r.account_id),
    status: r.status,
    chargesEnabled: bool(r.charges_enabled),
    payoutsEnabled: bool(r.payouts_enabled),
    detailsSubmitted: bool(r.details_submitted),
    requirementsDue: due,
    disabledReason: r.disabled_reason ?? null,
    onlineEnabled: bool(r.online_enabled),
    connectedAt: Number(r.connected_at),
    verifiedAt: numOrNull(r.verified_at),
    lastEventId: r.last_event_id ?? null,
    lastEventType: r.last_event_type ?? null,
    lastEventAt: numOrNull(r.last_event_at),
  };
}

function toCheckout(r: Row): CheckoutRow {
  return {
    sessionId: String(r.session_id),
    mode: r.mode,
    accountId: String(r.account_id),
    kind: r.kind === "shop_order" ? "shop_order" : "quote",
    quoteId: r.quote_id == null ? null : Number(r.quote_id),
    merchantOrder: r.merchant_order ?? null,
    amountCents: Number(r.amount_cents),
    currency: String(r.currency),
    status: r.status,
    paymentIntentId: r.payment_intent_id ?? null,
    createdAt: Number(r.created_at),
    paidAt: numOrNull(r.paid_at),
  };
}

const isMissing = (e: unknown) => {
  const x = e as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
  const code = x?.code ?? x?.cause?.code;
  const errno = x?.errno ?? x?.cause?.errno;
  return code === "ER_NO_SUCH_TABLE" || errno === 1146;
};
const isDuplicate = (e: unknown) => {
  const x = e as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
  return (x?.code ?? x?.cause?.code) === "ER_DUP_ENTRY" || (x?.errno ?? x?.cause?.errno) === 1062;
};

export function mysqlPaymentStore(): PaymentStore {
  async function exec() {
    const d = await getDb();
    if (!d) throw new Error("Base de datos no disponible");
    return d;
  }
  async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
    try {
      const [r] = (await (await exec()).execute(q)) as unknown as [Row[]];
      return Array.isArray(r) ? r : [];
    } catch (e) {
      if (isMissing(e)) throw new PaymentsSchemaMissing();
      throw e;
    }
  }
  async function run(q: ReturnType<typeof sql>): Promise<number> {
    try {
      const [r] = (await (await exec()).execute(q)) as unknown as [{ affectedRows: number }];
      return Number(r?.affectedRows ?? 0);
    } catch (e) {
      if (isMissing(e)) throw new PaymentsSchemaMissing();
      throw e;
    }
  }
  return {
    async getAccount(mode) {
      try {
        const r = await rows(sql`SELECT * FROM payment_accounts WHERE provider='stripe' AND mode=${mode} LIMIT 1`);
        return r[0] ? toAccount(r[0]) : null;
      } catch (e) {
        if (e instanceof PaymentsSchemaMissing) return null;
        throw e;
      }
    },
    async insertAccount(mode, accountId, now, by) {
      try {
        await run(sql`INSERT INTO payment_accounts (provider, mode, account_id, status, connected_at, updated_at, updated_by)
                      VALUES ('stripe', ${mode}, ${accountId}, 'pendiente', ${now}, ${now}, ${by})`);
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
      const r = await rows(sql`SELECT * FROM payment_accounts WHERE provider='stripe' AND mode=${mode} LIMIT 1`);
      return toAccount(r[0]);
    },
    async updateAccount(mode, u) {
      // Si la cuenta deja de estar verificada, el interruptor se apaga en la misma sentencia
      await run(sql`UPDATE payment_accounts SET status=${u.status}, charges_enabled=${u.chargesEnabled ? 1 : 0},
                    payouts_enabled=${u.payoutsEnabled ? 1 : 0}, details_submitted=${u.detailsSubmitted ? 1 : 0},
                    requirements_due=${JSON.stringify(u.requirementsDue)}, disabled_reason=${u.disabledReason},
                    online_enabled=IF(${u.status} = 'verificada', online_enabled, 0),
                    verified_at=IF(${u.status} = 'verificada', COALESCE(verified_at, ${u.now}), NULL),
                    updated_at=${u.now}, updated_by=${u.by ?? null}
                    WHERE provider='stripe' AND mode=${mode}`);
      const r = await rows(sql`SELECT * FROM payment_accounts WHERE provider='stripe' AND mode=${mode} LIMIT 1`);
      return r[0] ? toAccount(r[0]) : null;
    },
    async setOnline(mode, enabled, now, by) {
      const n = await run(
        enabled
          ? sql`UPDATE payment_accounts SET online_enabled=1, updated_at=${now}, updated_by=${by} WHERE provider='stripe' AND mode=${mode} AND status='verificada'`
          : sql`UPDATE payment_accounts SET online_enabled=0, updated_at=${now}, updated_by=${by} WHERE provider='stripe' AND mode=${mode}`,
      );
      return n > 0;
    },
    async noteEvent(mode, e) {
      await run(sql`UPDATE payment_accounts SET last_event_id=${e.id}, last_event_type=${e.type}, last_event_at=${e.at}
                    WHERE provider='stripe' AND mode=${mode}`);
    },
    async claimEvent(e) {
      try {
        await run(sql`INSERT INTO payment_events (event_id, account_id, mode, type, outcome, received_at)
                      VALUES (${e.eventId}, ${e.accountId}, ${e.mode}, ${e.type}, ${e.outcome}, ${e.at})`);
        return true;
      } catch (err) {
        if (isDuplicate(err)) return false;
        throw err;
      }
    },
    async setEventOutcome(eventId, outcome) {
      await run(sql`UPDATE payment_events SET outcome=${outcome} WHERE event_id=${eventId}`);
    },
    async reclaimFailedEvent(eventId) {
      return (await run(sql`UPDATE payment_events SET outcome='processing' WHERE event_id=${eventId} AND outcome='failed'`)) > 0;
    },
    async insertCheckout(c) {
      await run(sql`INSERT IGNORE INTO payment_checkouts (session_id, provider, mode, account_id, kind, quote_id, merchant_order, amount_cents, currency, status, created_at)
                    VALUES (${c.sessionId}, 'stripe', ${c.mode}, ${c.accountId}, ${c.kind}, ${c.quoteId}, ${c.merchantOrder}, ${c.amountCents}, ${c.currency}, 'pending', ${c.createdAt})`);
    },
    async getCheckout(sessionId) {
      try {
        const r = await rows(sql`SELECT * FROM payment_checkouts WHERE session_id=${sessionId} LIMIT 1`);
        return r[0] ? toCheckout(r[0]) : null;
      } catch (e) {
        if (e instanceof PaymentsSchemaMissing) return null;
        throw e;
      }
    },
    async listQuoteCheckouts(quoteId) {
      try {
        const r = await rows(sql`SELECT * FROM payment_checkouts WHERE quote_id=${quoteId} AND kind='quote' ORDER BY created_at, session_id`);
        return r.map(toCheckout);
      } catch (e) {
        if (e instanceof PaymentsSchemaMissing) return [];
        throw e;
      }
    },
    async markCheckoutPaid(sessionId, paymentIntentId, now) {
      const n = await run(sql`UPDATE payment_checkouts SET status='paid', payment_intent_id=${paymentIntentId}, paid_at=${now}
                              WHERE session_id=${sessionId} AND status IN ('pending','expired','failed')`);
      return n > 0;
    },
    async revertCheckoutPaid(sessionId) {
      await run(sql`UPDATE payment_checkouts SET status='pending', paid_at=NULL WHERE session_id=${sessionId} AND status='paid'`);
    },
    async setCheckoutStatus(sessionId, status) {
      await run(sql`UPDATE payment_checkouts SET status=${status} WHERE session_id=${sessionId} AND status='pending'`);
    },
  };
}
