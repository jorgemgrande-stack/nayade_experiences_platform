/**
 * Cobro de los cargos extraordinarios y gastos variables APROBADOS (CRM 0029; contrato CONTRATO_COBROS_FACTURACION.md,
 * I-4). No es un motor de cobros nuevo: usa Stripe (Checkout de pago único) o registra un pago externo, y actualiza el
 * estado de cobro de la factura que nació al aprobar el cargo (`charge:<id>`).
 *
 *  - Enlace de pago (`payment_link`): Checkout en modo `payment` por el importe SIN IVA del cargo con su tipo de IVA
 *    fijo. Clave de idempotencia por cargo e intento: repetir devuelve el mismo enlace mientras siga abierto. En live
 *    exige el interruptor protegido de cobros reales (el de los servicios externos).
 *  - El cobro solo se da por hecho con el webhook firmado (o la conciliación), RELEYENDO la sesión en Stripe: cliente,
 *    moneda, importe sin IVA y total deben coincidir con el cargo y su factura; si no, `conflict` y nada cambia.
 *  - Pago externo (`offline`): transferencia u otro medio, con su referencia, por alguien con `orders:approve`.
 *  - Pago por transferencia (`offline` + `method = bank_transfer`, CRM 0050): lo confirma un administrador con el
 *    justificante en PDF (obligatorio; prueba aportada por él, no verificada con el banco), solo por el total pendiente
 *    (el modelo no admite pagos parciales) y con una clave de idempotencia (repetir el envío devuelve el mismo pago).
 *    Antes de consolidarlo se cierran en Stripe los enlaces abiertos del cargo (se caduca la sesión de Checkout); si
 *    Stripe ya había cobrado, se registra ese cobro y la transferencia se rechaza.
 *  - Un solo pago liquida cada cargo (`settles_charge_id`, único por entorno) y todo cobro de un cargo se serializa con
 *    un cerrojo por cargo: un cobro de Stripe que llegue tras la transferencia (o a la vez) NO se contabiliza otra vez;
 *    queda `duplicate` y sale la alerta de error de cobro para revisarlo y reembolsarlo.
 *  - Rectificaciones administrativas (fecha, referencia, justificante) y anulación con motivo: la fila se conserva y el
 *    antes y el después quedan en el historial de quien lo llama.
 *  - Nunca se cobra una tarjeta guardada sin autorización expresa para ese cargo: `card_on_file` no se ejecuta aquí.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { StripeGateway, GwPaymentSession } from "../stripe/gateway";
import type { StripeStore } from "../stripe/store";
import type { StripeMode } from "../stripe/config";
import { memoryKeyedLock, type KeyedLock } from "../finance/ownInvoices";
import type { Charge, ChargeService } from "./charges";
import type { InvoicingStore } from "./store";
import { parseReceipt, type ReceiptDoc, type ReceiptStore } from "./transferReceipts";
import { InvoicingError, type Invoice } from "./types";

export type ChargePaymentKind = "stripe_link" | "offline";
/** `duplicate`: cobro de Stripe de un cargo ya liquidado por otro pago (a revisar y reembolsar); `voided`: anulado. */
export type ChargePaymentStatus = "open" | "paid" | "expired" | "cancelled" | "duplicate" | "voided";
export type ChargePaymentMethod = "bank_transfer";

export interface ChargePayment {
  id: number;
  chargeId: number;
  kind: ChargePaymentKind;
  status: ChargePaymentStatus;
  amountCents: number;
  totalCents: number;
  currency: string;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  reference: string | null;
  expiresAt: number | null;
  createdBy: string;
  createdAt: number;
  paidAt: number | null;
  updatedAt: number;
  // CRM 0050 (null en las filas anteriores o sin la migración)
  method?: ChargePaymentMethod | null;
  receiptDocumentId?: number | null;
  idempotencyKey?: string | null;
  settlesChargeId?: number | null;
  voidedAt?: number | null;
  voidedBy?: string | null;
  voidReason?: string | null;
}

/** Pago externo que liquida su cargo al darse de alta (transferencia con justificante u otro medio). */
export interface NewSettledPayment {
  chargeId: number;
  amountCents: number;
  totalCents: number;
  currency: string;
  reference: string | null;
  method: ChargePaymentMethod | null;
  receiptDocumentId: number | null;
  idempotencyKey: string | null;
  createdBy: string;
  createdAt: number;
  paidAt: number;
}

export interface ChargePaymentStore {
  insert(p: Omit<ChargePayment, "id" | "updatedAt">): Promise<ChargePayment>;
  update(id: number, patch: Partial<Pick<ChargePayment, "status" | "stripePaymentIntentId" | "paidAt">>, now: number): Promise<ChargePayment>;
  byCharge(chargeId: number): Promise<ChargePayment[]>;
  bySession(sessionId: string): Promise<ChargePayment | null>;
  /** Migración 0050 aplicada: transferencias, liquidación única por cargo e idempotencia. */
  readonly transfers: boolean;
  byId(id: number): Promise<ChargePayment | null>;
  byIdempotencyKey(key: string): Promise<ChargePayment | null>;
  /** Pago que liquida el cargo (null: ninguno registrado con 0050). */
  settledOf(chargeId: number): Promise<ChargePayment | null>;
  /** Alta de un pago que liquida su cargo. `settled`: otro pago ya lo liquida; misma clave: devuelve el existente. */
  insertSettled(p: NewSettledPayment): Promise<{ payment: ChargePayment; created: boolean } | { conflict: "settled" }>;
  /** El cobro de Stripe liquida el cargo. false: otro pago ya lo liquidaba (nada cambia). */
  settle(id: number, patch: { stripePaymentIntentId: string | null; paidAt: number }, chargeId: number, now: number): Promise<boolean>;
  /** Rectificación administrativa de un pago externo (fecha, referencia o justificante vigente). */
  amend(id: number, patch: { reference?: string | null; paidAt?: number; receiptDocumentId?: number }, now: number): Promise<ChargePayment>;
  /** Anulación: el pago deja de liquidar el cargo (la fila se conserva con quién, cuándo y por qué). */
  release(id: number, patch: { voidedAt: number; voidedBy: string; voidReason: string }, now: number): Promise<ChargePayment>;
  /** Pagos cobrados con fecha de pago en [from, to] (métricas). */
  paidBetween(from: number, to: number): Promise<ChargePayment[]>;
}

export class MemoryChargePaymentStore implements ChargePaymentStore {
  readonly transfers = true;
  rows: ChargePayment[] = [];
  async insert(p: Omit<ChargePayment, "id" | "updatedAt">) {
    const row = { ...p, id: this.rows.length + 1, updatedAt: p.createdAt };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: number, patch: Partial<Pick<ChargePayment, "status" | "stripePaymentIntentId" | "paidAt">>, now: number) {
    const i = this.rows.findIndex((r) => r.id === id);
    this.rows[i] = { ...this.rows[i], ...patch, updatedAt: now };
    return { ...this.rows[i] };
  }
  async byCharge(chargeId: number) {
    return this.rows.filter((r) => r.chargeId === chargeId).sort((a, b) => b.id - a.id).map((r) => ({ ...r }));
  }
  async bySession(sessionId: string) {
    const r = this.rows.find((x) => x.stripeSessionId === sessionId);
    return r ? { ...r } : null;
  }
  async byId(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async byIdempotencyKey(key: string) {
    const r = this.rows.find((x) => x.idempotencyKey === key);
    return r ? { ...r } : null;
  }
  async settledOf(chargeId: number) {
    const r = this.rows.find((x) => x.settlesChargeId === chargeId);
    return r ? { ...r } : null;
  }
  async insertSettled(p: NewSettledPayment) {
    // Mismas claves únicas que la tabla: idempotencia y un solo pago por cargo
    const same = p.idempotencyKey ? this.rows.find((x) => x.idempotencyKey === p.idempotencyKey) : undefined;
    if (same) return { payment: { ...same }, created: false };
    if (this.rows.some((x) => x.settlesChargeId === p.chargeId)) return { conflict: "settled" as const };
    const row: ChargePayment = { id: this.rows.length + 1, chargeId: p.chargeId, kind: "offline", status: "paid", amountCents: p.amountCents, totalCents: p.totalCents, currency: p.currency, stripeSessionId: null, stripePaymentIntentId: null, reference: p.reference, expiresAt: null, createdBy: p.createdBy, createdAt: p.createdAt, paidAt: p.paidAt, updatedAt: p.createdAt, method: p.method, receiptDocumentId: p.receiptDocumentId, idempotencyKey: p.idempotencyKey, settlesChargeId: p.chargeId, voidedAt: null, voidedBy: null, voidReason: null };
    this.rows.push(row);
    return { payment: { ...row }, created: true };
  }
  async settle(id: number, patch: { stripePaymentIntentId: string | null; paidAt: number }, chargeId: number, now: number) {
    if (this.rows.some((x) => x.settlesChargeId === chargeId && x.id !== id)) return false;
    await this.update(id, { status: "paid", ...patch }, now);
    this.rows.find((r) => r.id === id)!.settlesChargeId = chargeId;
    return true;
  }
  async amend(id: number, patch: { reference?: string | null; paidAt?: number; receiptDocumentId?: number }, now: number) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, patch, { updatedAt: now });
    return { ...r };
  }
  async release(id: number, patch: { voidedAt: number; voidedBy: string; voidReason: string }, now: number) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, patch, { status: "voided", settlesChargeId: null, updatedAt: now });
    return { ...r };
  }
  async paidBetween(from: number, to: number) {
    return this.rows.filter((r) => r.status === "paid" && r.paidAt !== null && r.paidAt >= from && r.paidAt <= to).map((r) => ({ ...r }));
  }
}

type Row = RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
function rowOf(r: Row): ChargePayment {
  return {
    id: Number(r.id),
    chargeId: Number(r.charge_id),
    kind: String(r.kind) as ChargePaymentKind,
    status: String(r.status) as ChargePaymentStatus,
    amountCents: Number(r.amount_cents),
    totalCents: Number(r.total_cents),
    currency: String(r.currency),
    stripeSessionId: str(r.stripe_session_id),
    stripePaymentIntentId: str(r.stripe_payment_intent_id),
    reference: str(r.reference),
    expiresAt: num(r.expires_at),
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    paidAt: num(r.paid_at),
    updatedAt: Number(r.updated_at),
    method: (str(r.method) as ChargePaymentMethod | null) ?? null,
    receiptDocumentId: num(r.receipt_document_id),
    idempotencyKey: str(r.idempotency_key),
    settlesChargeId: num(r.settles_charge_id),
    voidedAt: num(r.voided_at),
    voidedBy: str(r.voided_by),
    voidReason: str(r.void_reason),
  };
}

const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";
const noTransfers = () => new InvoicingError("unavailable", "Falta la migración 0050 del CRM (pagos por transferencia con justificante)");

export class MysqlChargePaymentStore implements ChargePaymentStore {
  private lm: number;
  /** Columnas de la 0050 presentes (las comprueba quien monta el almacén). */
  readonly transfers: boolean;
  constructor(private pool: mysql.Pool, mode: StripeMode | "test" | "live", opts: { transfers?: boolean } = {}) {
    this.lm = mode === "live" ? 1 : 0;
    this.transfers = opts.transfers === true;
  }
  async byId(id: number) {
    return this.get(id);
  }
  async byIdempotencyKey(key: string) {
    if (!this.transfers) return null;
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charge_payments WHERE idempotency_key = ? AND livemode = ?", [key, this.lm]);
    return rows[0] ? rowOf(rows[0]) : null;
  }
  async settledOf(chargeId: number) {
    if (!this.transfers) return null;
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charge_payments WHERE settles_charge_id = ? AND livemode = ?", [chargeId, this.lm]);
    return rows[0] ? rowOf(rows[0]) : null;
  }
  async insertSettled(p: NewSettledPayment) {
    if (!this.transfers) throw noTransfers();
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(
        "INSERT INTO billing_charge_payments (livemode, charge_id, kind, status, amount_cents, total_cents, currency, reference, method, receipt_document_id, idempotency_key, settles_charge_id, created_by, created_at, paid_at, updated_at) VALUES (?, ?, 'offline', 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [this.lm, p.chargeId, p.amountCents, p.totalCents, p.currency, p.reference, p.method, p.receiptDocumentId, p.idempotencyKey, p.chargeId, p.createdBy.slice(0, 120), p.createdAt, p.paidAt, p.createdAt],
      );
      return { payment: (await this.get(r.insertId))!, created: true };
    } catch (e) {
      if (!isDup(e)) throw e;
      // La misma clave (envío repetido) gana sobre «ya liquidado»: es el mismo pago
      const same = p.idempotencyKey ? await this.byIdempotencyKey(p.idempotencyKey) : null;
      return same ? { payment: same, created: false } : { conflict: "settled" as const };
    }
  }
  async settle(id: number, patch: { stripePaymentIntentId: string | null; paidAt: number }, chargeId: number, now: number) {
    if (!this.transfers) {
      await this.update(id, { status: "paid", ...patch }, now);
      return true;
    }
    try {
      await this.pool.query("UPDATE billing_charge_payments SET status = 'paid', stripe_payment_intent_id = ?, paid_at = ?, settles_charge_id = ?, updated_at = ? WHERE id = ? AND livemode = ?", [patch.stripePaymentIntentId, patch.paidAt, chargeId, now, id, this.lm]);
      return true;
    } catch (e) {
      if (isDup(e)) return false;
      throw e;
    }
  }
  async amend(id: number, patch: { reference?: string | null; paidAt?: number; receiptDocumentId?: number }, now: number) {
    if (!this.transfers) throw noTransfers();
    const cols: string[] = ["updated_at = ?"];
    const args: unknown[] = [now];
    if (patch.reference !== undefined) (cols.push("reference = ?"), args.push(patch.reference));
    if (patch.paidAt !== undefined) (cols.push("paid_at = ?"), args.push(patch.paidAt));
    if (patch.receiptDocumentId !== undefined) (cols.push("receipt_document_id = ?"), args.push(patch.receiptDocumentId));
    await this.pool.query(`UPDATE billing_charge_payments SET ${cols.join(", ")} WHERE id = ? AND livemode = ?`, [...args, id, this.lm]);
    return (await this.get(id))!;
  }
  async release(id: number, patch: { voidedAt: number; voidedBy: string; voidReason: string }, now: number) {
    if (!this.transfers) throw noTransfers();
    await this.pool.query("UPDATE billing_charge_payments SET status = 'voided', settles_charge_id = NULL, voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ? WHERE id = ? AND livemode = ?", [patch.voidedAt, patch.voidedBy.slice(0, 120), patch.voidReason.slice(0, 300), now, id, this.lm]);
    return (await this.get(id))!;
  }
  async paidBetween(from: number, to: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charge_payments WHERE livemode = ? AND status = 'paid' AND paid_at BETWEEN ? AND ? ORDER BY paid_at, id LIMIT 5000", [this.lm, from, to]);
    return rows.map(rowOf);
  }
  async insert(p: Omit<ChargePayment, "id" | "updatedAt">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT INTO billing_charge_payments (livemode, charge_id, kind, status, amount_cents, total_cents, currency, stripe_session_id, stripe_payment_intent_id, reference, expires_at, created_by, created_at, paid_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [this.lm, p.chargeId, p.kind, p.status, p.amountCents, p.totalCents, p.currency, p.stripeSessionId, p.stripePaymentIntentId, p.reference, p.expiresAt, p.createdBy.slice(0, 120), p.createdAt, p.paidAt, p.createdAt],
    );
    return (await this.get(r.insertId))!;
  }
  private async get(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charge_payments WHERE id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? rowOf(rows[0]) : null;
  }
  async update(id: number, patch: Partial<Pick<ChargePayment, "status" | "stripePaymentIntentId" | "paidAt">>, now: number) {
    const cols: string[] = ["updated_at = ?"];
    const args: unknown[] = [now];
    if (patch.status !== undefined) (cols.push("status = ?"), args.push(patch.status));
    if (patch.stripePaymentIntentId !== undefined) (cols.push("stripe_payment_intent_id = ?"), args.push(patch.stripePaymentIntentId));
    if (patch.paidAt !== undefined) (cols.push("paid_at = ?"), args.push(patch.paidAt));
    await this.pool.query(`UPDATE billing_charge_payments SET ${cols.join(", ")} WHERE id = ? AND livemode = ?`, [...args, id, this.lm]);
    return (await this.get(id))!;
  }
  async byCharge(chargeId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charge_payments WHERE charge_id = ? AND livemode = ? ORDER BY id DESC", [chargeId, this.lm]);
    return rows.map(rowOf);
  }
  async bySession(sessionId: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charge_payments WHERE stripe_session_id = ? AND livemode = ?", [sessionId, this.lm]);
    return rows[0] ? rowOf(rows[0]) : null;
  }
}

export interface ChargePaymentDeps {
  payments: ChargePaymentStore;
  charges: Pick<ChargeService, "must">;
  invoices: Pick<InvoicingStore, "get" | "setPayment">;
  /** Empresa del CRM (para crear el Customer de Stripe si aún no tiene). */
  company: (id: number) => Promise<{ id: number; name: string; legalName?: string | null; billingEmail?: string | null; email?: string | null; country?: string | null; postalCode?: string | null; address?: string | null; city?: string | null } | null>;
  gateway?: StripeGateway;
  stripeStore?: Pick<StripeStore, "customerByCompany" | "linkCustomer">;
  mode: StripeMode;
  namespace: string;
  /** Cobros reales en live (interruptor protegido CP_EXTERNAL_LIVE_ENABLED). Sin él, en live no se abre ningún enlace. */
  liveEnabled?: boolean;
  urls: { success: string; cancel: string };
  now?: () => number;
  /** Almacén privado de los justificantes de transferencia (sin él no se registran transferencias). */
  receipts?: ReceiptStore;
  /** Cerrojo por clave (MySQL: GET_LOCK) que serializa los cobros de un mismo cargo entre procesos. */
  lock?: KeyedLock;
  /** Cobro de Stripe de un cargo ya liquidado por otro pago: no se contabiliza; se avisa para revisarlo y reembolsarlo. */
  onDuplicate?: (i: DuplicateCharge) => Promise<void>;
}

export interface DuplicateCharge {
  charge: Charge;
  invoice: Invoice | null;
  /** Fila del cobro de Stripe (queda `duplicate`). */
  payment: ChargePayment;
  sessionId: string;
  paymentIntentId: string | null;
  amountTotalCents: number | null;
  /** Pago que ya liquidaba el cargo (null: factura cobrada antes de la 0050). */
  settledBy: ChargePayment | null;
}

/** Qué se hizo con cada enlace de Stripe abierto al registrar un pago externo. */
export interface LinkClosure {
  sessionId: string;
  /** expired: caducado ahora en Stripe; already_closed: Stripe ya no lo tenía abierto; expire_failed: Stripe no
   * respondió (queda anulado aquí y un cobro tardío se señala como duplicado); no_gateway: sin Stripe en el entorno. */
  outcome: "expired" | "already_closed" | "expire_failed" | "no_gateway";
}

export interface TransferInput {
  /** Importe recibido, IVA incluido (céntimos): debe ser el total pendiente. */
  amountCents: number;
  /** Día en que se recibió (AAAA-MM-DD). */
  receivedOn: string;
  reference?: string | null;
  receipt: { filename?: string | null; contentBase64?: string | null } | null;
  /** Clave del formulario (8 a 80 caracteres [A-Za-z0-9_-]): repetir el envío devuelve el mismo pago. */
  idempotencyKey: string;
  /** Confirmación expresa del administrador. */
  confirmed: boolean;
}

const LINK_TTL_S = 23 * 3600;
const OK_INVOICE = new Set(["pending", "failed"]);
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const IDEM = /^[A-Za-z0-9_-]{8,80}$/;
const madridToday = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
/** Instante guardado para un día de pago (mediodía UTC: no cambia de día en ningún huso de España). */
export const paidAtOfDay = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
export const dayOfPaidAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Referencia de cobro que queda en la factura de un cargo pagado por transferencia. */
export const transferPaymentRef = (paymentId: number) => `transfer:${paymentId}`;
const eurText = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(cents / 100);

export class ChargePaymentService {
  private serialLock: KeyedLock;
  constructor(private d: ChargePaymentDeps) {
    this.serialLock = d.lock ?? memoryKeyedLock();
  }
  private now() {
    return (this.d.now ?? Date.now)();
  }

  /** Un cobro del cargo a la vez (transferencia, webhook de Stripe, rectificación o anulación). */
  private serial<T>(chargeId: number, fn: () => Promise<T>): Promise<T> {
    return this.serialLock(`es-charge-${this.d.mode}-${chargeId}`, fn).catch((e) => {
      // El cerrojo de MySQL se rinde con un error de las finanzas: aquí es «inténtalo de nuevo»
      if (e instanceof Error && e.name === "FinanceError" && (e as { code?: string }).code === "unavailable") throw new InvoicingError("unavailable", "Otro cobro de este cargo sigue en curso: inténtalo de nuevo en unos segundos");
      throw e;
    });
  }

  /** ¿Se pueden registrar transferencias con justificante en este entorno? */
  transfersAvailable() {
    return this.d.payments.transfers && !!this.d.receipts;
  }

  /** Cargo aprobado con su factura (la que liquida el cobro). */
  private async approved(chargeId: number): Promise<{ c: Charge; inv: Invoice }> {
    const c = await this.d.charges.must(chargeId);
    if (c.status !== "approved") throw new InvoicingError("invalid_state", c.status === "draft" ? "El cargo aún no está aprobado" : "El cargo está anulado");
    if (!c.invoiceId) throw new InvoicingError("invalid_state", "El cargo aprobado no tiene factura");
    const inv = await this.d.invoices.get(c.invoiceId);
    if (!inv) throw new InvoicingError("invalid_state", "No se encuentra la factura del cargo");
    if (inv.paymentStatus === "paid") throw new InvoicingError("invalid_state", "El cargo ya está cobrado");
    if (!OK_INVOICE.has(inv.paymentStatus)) throw new InvoicingError("invalid_state", `La factura del cargo está «${inv.paymentStatus}»`);
    return { c, inv };
  }

  async list(chargeId: number) {
    return this.d.payments.byCharge(chargeId);
  }

  /** Enlace de pago de Stripe para un cargo aprobado. Repetir devuelve el enlace abierto (sin otro Checkout). */
  async paymentLink(chargeId: number, actor: string) {
    const { c, inv } = await this.approved(chargeId);
    if (c.method !== "payment_link") throw new InvoicingError("invalid_state", c.method === "offline" ? "Este cargo se cobra fuera de Stripe: registra el pago externo" : "El cobro con la tarjeta guardada exige su autorización expresa y no se ejecuta desde aquí");
    const g = this.d.gateway;
    if (!g?.createPaymentSession || !g.ensureTaxRate || !this.d.stripeStore) throw new InvoicingError("unavailable", "Stripe no está configurado en este entorno");
    if (this.d.mode === "live" && !this.d.liveEnabled) throw new InvoicingError("unavailable", "Los cobros reales no están activados (CP_EXTERNAL_LIVE_ENABLED)");
    const now = this.now();
    const prev = (await this.d.payments.byCharge(c.id)).filter((p) => p.kind === "stripe_link");
    const open = prev.find((p) => p.status === "open" && (p.expiresAt ?? 0) > now + 10 * 60_000);
    if (open && g.paymentSession) {
      const s = await g.paymentSession(open.stripeSessionId!);
      if (s?.status === "open" && s.url) return { url: s.url, sessionId: s.id, expiresAt: s.expiresAt * 1000, totalCents: open.totalCents, reused: true };
    }
    if (inv.baseCents !== c.amountCents) throw new InvoicingError("conflict", "La base de la factura no coincide con el importe del cargo");
    const customerId = await this.ensureCustomer(c.companyId);
    const taxRateId = await g.ensureTaxRate({ percentageBp: c.taxRateBp, displayName: "IVA", country: "ES", description: `IVA ${c.taxRateBp / 100} % (España)` });
    const meta = { es_charge_id: String(c.id), es_invoice_id: String(inv.id), es_company_id: String(c.companyId), es_env: this.d.namespace };
    const s = await g.createPaymentSession(
      {
        customerId,
        currency: c.currency,
        productName: c.concept,
        description: inv.number ? `Factura ${inv.number}` : `Cargo ${c.id}`,
        amountCents: c.amountCents,
        taxRateId,
        metadata: meta,
        successUrl: this.d.urls.success,
        cancelUrl: this.d.urls.cancel,
        expiresAt: Math.floor(now / 1000) + LINK_TTL_S,
        notice: `Pago único de ${c.concept}. Importe con IVA incluido; no autoriza cobros futuros.`,
      },
      `es-${this.d.namespace}-charge-${c.id}-link-${prev.length + 1}`,
    );
    if (s.amountTotal !== null && s.amountTotal !== inv.totalCents) throw new InvoicingError("conflict", "El total de Stripe no coincide con la factura del cargo");
    if (!(await this.d.payments.bySession(s.id))) {
      await this.d.payments.insert({ chargeId: c.id, kind: "stripe_link", status: "open", amountCents: c.amountCents, totalCents: inv.totalCents, currency: c.currency, stripeSessionId: s.id, stripePaymentIntentId: null, reference: null, expiresAt: s.expiresAt * 1000, createdBy: actor, createdAt: now, paidAt: null });
    }
    return { url: s.url, sessionId: s.id, expiresAt: s.expiresAt * 1000, totalCents: inv.totalCents, reused: false };
  }

  /** Pago recibido fuera de Stripe (transferencia u otro medio), con su referencia. */
  async recordOffline(chargeId: number, input: { reference: string; paidAt?: number | null }, actor: string) {
    const ref = String(input.reference ?? "").trim();
    if (ref.length < 3 || ref.length > 120) throw new InvoicingError("invalid_input", "Indica la referencia del pago (3 a 120 caracteres)");
    return this.serial(chargeId, async () => {
      const { c, inv } = await this.approved(chargeId);
      const now = this.now();
      const paidAt = input.paidAt ?? now;
      if (paidAt > now + 60_000) throw new InvoicingError("invalid_input", "La fecha del pago no puede ser futura");
      if (await this.d.payments.settledOf(c.id)) throw new InvoicingError("invalid_state", "El cargo ya está cobrado");
      // Un enlace de Stripe abierto deja de valer: el cargo ya está pagado por otra vía (se cierra también en Stripe)
      const links = await this.closeLinks(c, now);
      if (links.paid) {
        await this.settleStripe(links.paid.pay.id, links.paid.session);
        throw new InvoicingError("invalid_state", "Stripe ya ha cobrado este cargo con el enlace de pago: no se registra el pago externo");
      }
      let pay: ChargePayment;
      if (this.d.payments.transfers) {
        const r = await this.d.payments.insertSettled({ chargeId: c.id, amountCents: c.amountCents, totalCents: inv.totalCents, currency: c.currency, reference: ref, method: null, receiptDocumentId: null, idempotencyKey: null, createdBy: actor, createdAt: now, paidAt });
        if ("conflict" in r) throw new InvoicingError("invalid_state", "El cargo ya está cobrado");
        pay = r.payment;
      } else pay = await this.d.payments.insert({ chargeId: c.id, kind: "offline", status: "paid", amountCents: c.amountCents, totalCents: inv.totalCents, currency: c.currency, stripeSessionId: null, stripePaymentIntentId: null, reference: ref, expiresAt: null, createdBy: actor, createdAt: now, paidAt });
      const invoice = await this.d.invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef: `offline:${ref}`.slice(0, 120), paidAt }, now);
      return { payment: pay, invoice };
    });
  }

  /**
   * Cierra los enlaces de Stripe abiertos del cargo antes de registrar un pago externo: relee la sesión y la caduca en
   * Stripe si sigue abierta (idempotente: una ya caducada no se toca). Si Stripe YA había cobrado, devuelve esa sesión
   * sin cerrar nada (quien llama registra ese cobro y rechaza el pago externo).
   */
  private async closeLinks(c: Charge, now: number): Promise<{ closures: LinkClosure[]; paid: { pay: ChargePayment; session: GwPaymentSession } | null }> {
    const g = this.d.gateway;
    const open = (await this.d.payments.byCharge(c.id)).filter((p) => p.kind === "stripe_link" && p.status === "open" && p.stripeSessionId);
    const plan: Array<{ pay: ChargePayment; outcome: LinkClosure["outcome"] }> = [];
    for (const p of open) {
      if (!g?.paymentSession) {
        plan.push({ pay: p, outcome: "no_gateway" });
        continue;
      }
      let s = await g.paymentSession(p.stripeSessionId!);
      if (s?.paymentStatus === "paid") return { closures: [], paid: { pay: p, session: s } };
      let outcome: LinkClosure["outcome"] = "already_closed";
      if (s?.status === "open") {
        try {
          await g.expireCheckoutSession(p.stripeSessionId!);
          outcome = "expired";
        } catch {
          outcome = "expire_failed";
        }
        // Releída tras caducarla: el cliente pudo pagar justo antes (Stripe no caduca una sesión completada)
        s = await g.paymentSession(p.stripeSessionId!).catch(() => s);
        if (s?.paymentStatus === "paid") return { closures: [], paid: { pay: p, session: s } };
        if (outcome === "expire_failed" && s?.status === "expired") outcome = "expired";
      }
      plan.push({ pay: p, outcome });
    }
    for (const { pay } of plan) await this.d.payments.update(pay.id, { status: "cancelled" }, now);
    return { closures: plan.map((x) => ({ sessionId: x.pay.stripeSessionId!, outcome: x.outcome })), paid: null };
  }

  /**
   * Pago por transferencia confirmado por un administrador con su justificante en PDF (obligatorio). Solo por el total
   * pendiente: el modelo de cargos no admite pagos parciales. Repetir el envío con la misma clave devuelve el mismo
   * pago (`replay`). Rechazado si el cargo ya está cobrado, también si Stripe acaba de cobrarlo.
   */
  async recordTransfer(chargeId: number, input: TransferInput, actor: string): Promise<{ payment: ChargePayment; invoice: Invoice; receipt: ReceiptDoc | null; replay: boolean; stripe: LinkClosure[] }> {
    if (!this.transfersAvailable()) throw new InvoicingError("unavailable", "El registro de transferencias con justificante no está disponible en este entorno (migración 0050 o almacén de documentos)");
    if (input?.confirmed !== true) throw new InvoicingError("invalid_input", "Confirma expresamente que has recibido la transferencia");
    const key = String(input.idempotencyKey ?? "");
    if (!IDEM.test(key)) throw new InvoicingError("invalid_input", "Falta la clave del formulario: recarga la ficha y vuelve a intentarlo");
    const replay = async () => {
      const same = await this.d.payments.byIdempotencyKey(key);
      if (!same) return null;
      if (same.chargeId !== chargeId) throw new InvoicingError("conflict", "Esa clave ya se usó para otro cobro");
      const c = await this.d.charges.must(chargeId);
      const invoice = (await this.d.invoices.get(c.invoiceId!))!;
      return { payment: same, invoice, receipt: same.receiptDocumentId ? await this.d.receipts!.get(same.receiptDocumentId) : null, replay: true, stripe: [] as LinkClosure[] };
    };
    const first = await replay();
    if (first) return first;
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new InvoicingError("invalid_input", "Indica el importe recibido");
    const day = String(input.receivedOn ?? "");
    if (!YMD.test(day) || Number.isNaN(paidAtOfDay(day)) || dayOfPaidAt(paidAtOfDay(day)) !== day) throw new InvoicingError("invalid_input", "Indica la fecha de recepción (AAAA-MM-DD)");
    if (day > madridToday(this.now())) throw new InvoicingError("invalid_input", "La fecha de recepción no puede ser futura");
    if (day < "2020-01-01") throw new InvoicingError("invalid_input", "Fecha de recepción no válida");
    const ref = input.reference == null ? "" : String(input.reference).trim();
    if (ref && (ref.length < 3 || ref.length > 120)) throw new InvoicingError("invalid_input", "La referencia de la transferencia debe tener entre 3 y 120 caracteres");
    const file = parseReceipt(input.receipt);
    return this.serial(chargeId, async () => {
      const again = await replay();
      if (again) return again;
      const c = await this.d.charges.must(chargeId);
      const current = c.invoiceId ? await this.d.invoices.get(c.invoiceId) : null;
      if (current?.paymentStatus === "paid") throw new InvoicingError("invalid_state", current.paymentRef?.startsWith("stripe:") ? "Stripe ya confirmó el cobro de esta nota de cobro: no se puede registrar otra vez el importe" : "La nota de cobro ya está pagada");
      const { inv } = await this.approved(chargeId);
      if (await this.d.payments.settledOf(c.id)) throw new InvoicingError("invalid_state", "La nota de cobro ya está pagada");
      if (input.amountCents !== inv.totalCents) throw new InvoicingError("invalid_input", `El importe debe ser el total pendiente (${eurText(inv.totalCents)}): no se admiten pagos parciales`);
      const now = this.now();
      const links = await this.closeLinks(c, now);
      if (links.paid) {
        // Stripe cobró antes de que se confirmara la transferencia: ese cobro es el bueno
        await this.settleStripe(links.paid.pay.id, links.paid.session);
        throw new InvoicingError("invalid_state", "Stripe ya ha cobrado esta nota de cobro con el enlace de pago: no se registra la transferencia. Si el cliente también transfirió, hay que devolverle ese importe");
      }
      const receipt = await this.d.receipts!.put(c.id, file, actor, now);
      const r = await this.d.payments.insertSettled({ chargeId: c.id, amountCents: c.amountCents, totalCents: inv.totalCents, currency: c.currency, reference: ref || null, method: "bank_transfer", receiptDocumentId: receipt.id, idempotencyKey: key, createdBy: actor, createdAt: now, paidAt: paidAtOfDay(day) });
      if ("conflict" in r) throw new InvoicingError("invalid_state", "La nota de cobro ya está pagada");
      if (!r.created) return { payment: r.payment, invoice: (await this.d.invoices.get(inv.id))!, receipt: r.payment.receiptDocumentId ? await this.d.receipts!.get(r.payment.receiptDocumentId) : null, replay: true, stripe: [] };
      const invoice = await this.d.invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef: transferPaymentRef(r.payment.id), paidAt: paidAtOfDay(day) }, now);
      return { payment: r.payment, invoice, receipt, replay: false, stripe: links.closures };
    });
  }

  /** Pago por transferencia de este cargo, vigente (para rectificarlo o anularlo). */
  private async liveTransfer(chargeId: number, paymentId: number) {
    const pay = await this.d.payments.byId(paymentId);
    if (!pay || pay.chargeId !== chargeId || pay.method !== "bank_transfer") throw new InvoicingError("not_found", "Pago por transferencia no encontrado");
    if (pay.status !== "paid") throw new InvoicingError("invalid_state", pay.status === "voided" ? "El pago ya está anulado" : "El pago no está vigente");
    const c = await this.d.charges.must(chargeId);
    const inv = c.invoiceId ? await this.d.invoices.get(c.invoiceId) : null;
    if (!inv) throw new InvoicingError("invalid_state", "No se encuentra la factura del cargo");
    return { pay, c, inv };
  }

  /**
   * Rectificación administrativa de una transferencia registrada: fecha de recepción, referencia o justificante (el
   * anterior se conserva). El importe no se rectifica: se anula el pago y se registra otra vez. Devuelve el antes y el
   * después para el historial.
   */
  async rectifyTransfer(chargeId: number, paymentId: number, input: { reason: string; receivedOn?: string | null; reference?: string | null; receipt?: { filename?: string | null; contentBase64?: string | null } | null }, actor: string) {
    if (!this.transfersAvailable()) throw new InvoicingError("unavailable", "El registro de transferencias con justificante no está disponible en este entorno");
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 300) throw new InvoicingError("invalid_input", "Indica el motivo de la rectificación (5 a 300 caracteres)");
    const day = input.receivedOn == null ? null : String(input.receivedOn);
    if (day !== null && (!YMD.test(day) || dayOfPaidAt(paidAtOfDay(day)) !== day || day > madridToday(this.now()) || day < "2020-01-01")) throw new InvoicingError("invalid_input", "Fecha de recepción no válida (AAAA-MM-DD, no futura)");
    const ref = input.reference === undefined ? undefined : input.reference === null ? null : String(input.reference).trim() || null;
    if (ref && (ref.length < 3 || ref.length > 120)) throw new InvoicingError("invalid_input", "La referencia de la transferencia debe tener entre 3 y 120 caracteres");
    const file = input.receipt ? parseReceipt(input.receipt) : null;
    return this.serial(chargeId, async () => {
      const { pay, inv } = await this.liveTransfer(chargeId, paymentId);
      const now = this.now();
      const before = { receivedOn: pay.paidAt ? dayOfPaidAt(pay.paidAt) : null, reference: pay.reference, receiptDocumentId: pay.receiptDocumentId ?? null };
      const patch: { reference?: string | null; paidAt?: number; receiptDocumentId?: number } = {};
      if (day !== null && day !== before.receivedOn) patch.paidAt = paidAtOfDay(day);
      if (ref !== undefined && ref !== before.reference) patch.reference = ref;
      if (file) patch.receiptDocumentId = (await this.d.receipts!.put(chargeId, file, actor, now)).id;
      if (!Object.keys(patch).length) throw new InvoicingError("invalid_input", "No hay nada que rectificar: cambia la fecha, la referencia o el justificante");
      const payment = await this.d.payments.amend(pay.id, patch, now);
      if (patch.paidAt !== undefined && inv.paymentRef === transferPaymentRef(pay.id)) await this.d.invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef: inv.paymentRef, paidAt: patch.paidAt }, now);
      const after = { receivedOn: payment.paidAt ? dayOfPaidAt(payment.paidAt) : null, reference: payment.reference, receiptDocumentId: payment.receiptDocumentId ?? null };
      return { payment, before, after, reason };
    });
  }

  /**
   * Anulación administrativa de una transferencia registrada por error (con motivo): el pago queda `voided` (no se
   * borra), deja de liquidar el cargo y la nota de cobro vuelve a estar pendiente. Los enlaces de Stripe caducados no
   * se reabren: si hace falta, se genera otro.
   */
  async voidTransfer(chargeId: number, paymentId: number, input: { reason: string }, actor: string) {
    if (!this.transfersAvailable()) throw new InvoicingError("unavailable", "El registro de transferencias con justificante no está disponible en este entorno");
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 300) throw new InvoicingError("invalid_input", "Indica el motivo de la anulación (5 a 300 caracteres)");
    return this.serial(chargeId, async () => {
      const { pay, inv } = await this.liveTransfer(chargeId, paymentId);
      if (inv.paymentRef !== transferPaymentRef(pay.id)) throw new InvoicingError("invalid_state", "La factura ya no consta cobrada por esta transferencia");
      const now = this.now();
      const payment = await this.d.payments.release(pay.id, { voidedAt: now, voidedBy: actor, voidReason: reason }, now);
      const invoice = await this.d.invoices.setPayment(inv.id, { paymentStatus: "pending", paymentRef: null, paidAt: null }, now);
      return { payment, invoice, reason };
    });
  }

  /** Justificante de un pago del cargo (solo los de este cargo). */
  async receipt(chargeId: number, documentId: number) {
    const doc = this.d.receipts ? await this.d.receipts.get(documentId) : null;
    if (!doc || doc.chargeId !== chargeId) throw new InvoicingError("not_found", "Justificante no encontrado");
    const content = await this.d.receipts!.content(documentId);
    if (!content) throw new InvoicingError("not_found", "Justificante no encontrado");
    return { doc, content };
  }

  /** Pagos cobrados en la ventana (métricas): no incluye duplicados, anulados ni enlaces sin pagar. */
  collectedBetween(from: number, to: number) {
    return this.d.payments.paidBetween(from, to);
  }

  /**
   * Sesión de Checkout de un cargo (webhook firmado o conciliación). null: no es de un cargo. Idempotente; releída en
   * Stripe y cotejada con el cargo y su factura antes de darla por cobrada. Si el cargo ya estaba liquidado por otro
   * pago (p. ej. una transferencia), el cobro NO se contabiliza: queda `duplicate` y se avisa.
   */
  async handleSession(sessionId: string): Promise<string | null> {
    const pay = await this.d.payments.bySession(sessionId);
    if (!pay) return null;
    const g = this.d.gateway;
    if (!g?.paymentSession) return "Stripe no configurado";
    const s = await g.paymentSession(sessionId);
    if (!s) return "La sesión no existe en Stripe";
    const now = this.now();
    if (s.status === "expired") {
      if (pay.status === "open") await this.d.payments.update(pay.id, { status: "expired" }, now);
      return "Enlace caducado sin pagar";
    }
    if (s.paymentStatus !== "paid") return `Sin cobro (${s.paymentStatus ?? "desconocido"})`;
    if (pay.status === "paid") return "Ya registrado";
    if (pay.status === "duplicate") return "Cobro duplicado ya señalado para revisión";
    return this.serial(pay.chargeId, () => this.settleStripe(pay.id, s));
  }

  /** Registra el cobro de una sesión pagada (con el cerrojo del cargo tomado). */
  private async settleStripe(paymentId: number, s: GwPaymentSession): Promise<string> {
    const pay = (await this.d.payments.byId(paymentId))!;
    if (pay.status === "paid") return "Ya registrado";
    if (pay.status === "duplicate") return "Cobro duplicado ya señalado para revisión";
    const now = this.now();
    const c = await this.d.charges.must(pay.chargeId);
    const inv = c.invoiceId ? await this.d.invoices.get(c.invoiceId) : null;
    const customer = await this.d.stripeStore?.customerByCompany(c.companyId);
    if (s.metadata.es_charge_id !== String(c.id) || s.metadata.es_env !== this.d.namespace || !customer || s.customerId !== customer.stripeCustomerId) throw new InvoicingError("conflict", "La sesión de Stripe no corresponde a este cargo");
    if (!inv || (s.currency ?? "").toUpperCase() !== c.currency.toUpperCase() || s.amountSubtotal !== c.amountCents || s.amountTotal !== inv.totalCents) throw new InvoicingError("conflict", "El importe cobrado en Stripe no coincide con el cargo y su factura");
    const ref = s.paymentIntentId ? `stripe:pi:${s.paymentIntentId}` : `stripe:cs:${s.id}`;
    const other = await this.d.payments.settledOf(c.id);
    const elsewhere = (other !== null && other.id !== pay.id) || (inv.paymentStatus === "paid" && inv.paymentRef !== ref);
    if (elsewhere || !(await this.d.payments.settle(pay.id, { stripePaymentIntentId: s.paymentIntentId, paidAt: now }, c.id, now))) {
      // Primero el aviso (deduplicado por sesión): si falla, el webhook se reintenta y vuelve a avisar
      await this.d.onDuplicate?.({ charge: c, invoice: inv, payment: pay, sessionId: s.id, paymentIntentId: s.paymentIntentId, amountTotalCents: s.amountTotal, settledBy: other ?? (await this.d.payments.settledOf(c.id)) });
      await this.d.payments.update(pay.id, { status: "duplicate", stripePaymentIntentId: s.paymentIntentId, paidAt: now }, now);
      return "Cobro duplicado: la nota de cobro ya estaba pagada por otra vía. No se contabiliza otra vez; revísalo y reembolsa el importe en Stripe";
    }
    if (inv.paymentStatus !== "paid") await this.d.invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef: ref, paidAt: now }, now);
    return "Cargo cobrado";
  }

  private async ensureCustomer(companyId: number): Promise<string> {
    const store = this.d.stripeStore!;
    const g = this.d.gateway!;
    const link = await store.customerByCompany(companyId);
    if (link) return link.stripeCustomerId;
    const company = await this.d.company(companyId);
    if (!company) throw new InvoicingError("not_found", "Empresa no encontrada");
    const created = await g.createCustomer(
      {
        name: company.legalName ?? company.name,
        email: company.billingEmail ?? company.email ?? null,
        metadata: { es_company_id: String(company.id), es_env: this.d.namespace },
        ...(company.country ? { address: { country: company.country, postalCode: company.postalCode ?? null, line1: company.address ?? null, city: company.city ?? null } } : {}),
      },
      `es-${this.d.namespace}-customer-${company.id}-ext`,
    );
    const { link: linked } = await store.linkCustomer({ companyId: company.id, tenantId: null, stripeCustomerId: created.id, now: this.now() });
    return linked.stripeCustomerId;
  }
}
