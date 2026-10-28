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
 *  - Nunca se cobra una tarjeta guardada sin autorización expresa para ese cargo: `card_on_file` no se ejecuta aquí.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { StripeGateway } from "../stripe/gateway";
import type { StripeStore } from "../stripe/store";
import type { StripeMode } from "../stripe/config";
import type { Charge, ChargeService } from "./charges";
import type { InvoicingStore } from "./store";
import { InvoicingError, type Invoice } from "./types";

export type ChargePaymentKind = "stripe_link" | "offline";
export type ChargePaymentStatus = "open" | "paid" | "expired" | "cancelled";

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
}

export interface ChargePaymentStore {
  insert(p: Omit<ChargePayment, "id" | "updatedAt">): Promise<ChargePayment>;
  update(id: number, patch: Partial<Pick<ChargePayment, "status" | "stripePaymentIntentId" | "paidAt">>, now: number): Promise<ChargePayment>;
  byCharge(chargeId: number): Promise<ChargePayment[]>;
  bySession(sessionId: string): Promise<ChargePayment | null>;
}

export class MemoryChargePaymentStore implements ChargePaymentStore {
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
  };
}

export class MysqlChargePaymentStore implements ChargePaymentStore {
  private lm: number;
  constructor(private pool: mysql.Pool, mode: StripeMode | "test" | "live") {
    this.lm = mode === "live" ? 1 : 0;
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
}

const LINK_TTL_S = 23 * 3600;
const OK_INVOICE = new Set(["pending", "failed"]);

export class ChargePaymentService {
  constructor(private d: ChargePaymentDeps) {}
  private now() {
    return (this.d.now ?? Date.now)();
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
    const { c, inv } = await this.approved(chargeId);
    const now = this.now();
    const paidAt = input.paidAt ?? now;
    if (paidAt > now + 60_000) throw new InvoicingError("invalid_input", "La fecha del pago no puede ser futura");
    // Un enlace de Stripe abierto deja de valer: el cargo ya está pagado por otra vía
    for (const p of await this.d.payments.byCharge(c.id)) if (p.status === "open") await this.d.payments.update(p.id, { status: "cancelled" }, now);
    const pay = await this.d.payments.insert({ chargeId: c.id, kind: "offline", status: "paid", amountCents: c.amountCents, totalCents: inv.totalCents, currency: c.currency, stripeSessionId: null, stripePaymentIntentId: null, reference: ref, expiresAt: null, createdBy: actor, createdAt: now, paidAt });
    const invoice = await this.d.invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef: `offline:${ref}`.slice(0, 120), paidAt }, now);
    return { payment: pay, invoice };
  }

  /**
   * Sesión de Checkout de un cargo (webhook firmado o conciliación). null: no es de un cargo. Idempotente; releída en
   * Stripe y cotejada con el cargo y su factura antes de darla por cobrada.
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
    const c = await this.d.charges.must(pay.chargeId);
    const inv = c.invoiceId ? await this.d.invoices.get(c.invoiceId) : null;
    const customer = await this.d.stripeStore?.customerByCompany(c.companyId);
    if (s.metadata.es_charge_id !== String(c.id) || s.metadata.es_env !== this.d.namespace || !customer || s.customerId !== customer.stripeCustomerId) throw new InvoicingError("conflict", "La sesión de Stripe no corresponde a este cargo");
    if (!inv || (s.currency ?? "").toUpperCase() !== c.currency.toUpperCase() || s.amountSubtotal !== c.amountCents || s.amountTotal !== inv.totalCents) throw new InvoicingError("conflict", "El importe cobrado en Stripe no coincide con el cargo y su factura");
    await this.d.payments.update(pay.id, { status: "paid", stripePaymentIntentId: s.paymentIntentId, paidAt: now }, now);
    if (inv.paymentStatus !== "paid") await this.d.invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef: s.paymentIntentId ? `stripe:pi:${s.paymentIntentId}` : `stripe:cs:${s.id}`, paidAt: now }, now);
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
