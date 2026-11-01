/**
 * Cargos extraordinarios y gastos variables por empresa (CRM 0028). Contrato: CONTRATO_COBROS_FACTURACION.md (I-4).
 *
 *  - Extraordinario: concepto libre e importe pactado.
 *  - Gasto variable: coste de un proveedor en un periodo + margen pactado (porcentaje o importe). El importe lo calcula
 *    el servidor: nunca se escribe a mano.
 *  - Borrador → aprobado (una persona con `orders:approve`) → nace su factura por devengo (`charge:<id>`, fecha de
 *    operación = la pactada). Anular solo antes de aprobar: lo aprobado ya tiene factura y se corrige con rectificativa.
 *  - Un extraordinario puede llevar desglose (`detail.lines`, notas de cobro de servicios externos): la suma de sus
 *    líneas es el importe y la factura nace con esas líneas (el IVA, sobre la base total, como en el cobro de Stripe).
 *  - El cobro NO se hace aquí (parte de pagos, I-4): queda el método (`payment_link` por defecto) y, para cobrar con la
 *    tarjeta autorizada, la referencia de la autorización expresa (`mandateRef`, obligatoria).
 */
import type mysql from "mysql2/promise";
import { customerOf, lineOf, taxOf, totals, type CompanyFiscal } from "./rules";
import type { InvoicingStore } from "./store";
import { InvoicingError, type Invoice } from "./types";

export type ChargeKind = "extraordinary" | "variable_cost";
export type ChargeStatus = "draft" | "approved" | "cancelled";
export type ChargeMethod = "payment_link" | "card_on_file" | "offline";

export interface ChargeDetail {
  provider?: string;
  /** Periodo del consumo (AAAA-MM-DD). */
  periodStart?: string;
  periodEnd?: string;
  costCents?: number;
  /** Margen pactado: porcentaje (puntos básicos) o importe fijo. */
  marginBp?: number;
  marginCents?: number;
  /** Desglose de un extraordinario: cantidad × precio unitario (céntimos sin IVA; negativo en un descuento). */
  lines?: ChargeLine[];
}

export interface ChargeLine {
  concept: string;
  quantity: number;
  unitCents: number;
}

export interface Charge {
  id: number;
  companyId: number;
  kind: ChargeKind;
  status: ChargeStatus;
  agreementRef: string | null;
  billingRef: string | null;
  concept: string;
  currency: string;
  amountCents: number;
  taxRateBp: number;
  dueDate: string;
  method: ChargeMethod;
  mandateRef: string | null;
  detail: ChargeDetail | null;
  invoiceId: number | null;
  idempotencyKey: string;
  reason: string | null;
  createdBy: string;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  updatedAt: number;
  version: number;
}

export interface NewChargeInput {
  idempotencyKey: string;
  companyId: number;
  kind: ChargeKind;
  concept: string;
  /** Solo extraordinarios; en un gasto variable se calcula. */
  amountCents?: number;
  taxRateBp: number;
  dueDate: string;
  method?: ChargeMethod;
  mandateRef?: string | null;
  agreementRef?: string | null;
  billingRef?: string | null;
  detail?: ChargeDetail | null;
}

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Importe de un gasto variable: coste + margen (importe fijo o porcentaje redondeado al céntimo). */
export function variableAmount(d: ChargeDetail): number {
  const cost = d.costCents ?? 0;
  const margin = d.marginCents ?? Math.round((cost * (d.marginBp ?? 0)) / 10_000);
  return cost + margin;
}

/** Comprueba un cargo nuevo y devuelve su importe (calculado en los gastos variables). */
export function validateCharge(i: NewChargeInput): { amountCents: number; problems: string[] } {
  const p: string[] = [];
  if (!i.idempotencyKey?.trim() || i.idempotencyKey.length > 120) p.push("clave de idempotencia no válida");
  if (!i.concept?.trim() || i.concept.trim().length < 3 || i.concept.length > 200) p.push("el concepto debe tener entre 3 y 200 caracteres");
  if (!Number.isInteger(i.taxRateBp) || i.taxRateBp < 0 || i.taxRateBp > 2700) p.push("tipo de IVA no válido");
  if (!YMD.test(i.dueDate ?? "")) p.push("fecha de la operación no válida (AAAA-MM-DD)");
  const method = i.method ?? "payment_link";
  if (method === "card_on_file" && !i.mandateRef?.trim()) p.push("para cobrar con la tarjeta autorizada hace falta la referencia de la autorización expresa (mandateRef)");
  let amountCents = 0;
  if (i.kind === "extraordinary") {
    amountCents = i.amountCents ?? 0;
    if (!Number.isInteger(amountCents) || amountCents <= 0) p.push("el importe debe ser positivo (céntimos)");
    if (i.detail?.costCents !== undefined) p.push("un cargo extraordinario no lleva coste de proveedor (usa un gasto variable)");
    const lines = i.detail?.lines;
    if (lines !== undefined) {
      if (!Array.isArray(lines) || !lines.length || lines.length > 50) p.push("el desglose debe tener entre 1 y 50 líneas");
      else {
        for (const l of lines)
          if (!l || typeof l.concept !== "string" || l.concept.trim().length < 3 || l.concept.length > 200 || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 100_000 || !Number.isInteger(l.unitCents) || l.unitCents === 0) {
            p.push("línea del desglose no válida (concepto de 3 a 200 caracteres, cantidad entera y precio distinto de cero)");
            break;
          }
        if (lines.reduce((a, l) => a + (l?.quantity ?? 0) * (l?.unitCents ?? 0), 0) !== amountCents) p.push("la suma del desglose no coincide con el importe");
      }
    }
  } else if (i.kind === "variable_cost") {
    const d = i.detail ?? {};
    if (i.amountCents !== undefined) p.push("el importe de un gasto variable se calcula: coste + margen");
    if (!d.provider?.trim()) p.push("falta el proveedor del gasto");
    if (!Number.isInteger(d.costCents) || (d.costCents ?? 0) <= 0) p.push("falta el coste del proveedor (céntimos)");
    if (d.marginBp !== undefined && d.marginCents !== undefined) p.push("el margen es un porcentaje o un importe, no los dos");
    if (d.marginBp !== undefined && (!Number.isInteger(d.marginBp) || d.marginBp < 0 || d.marginBp > 10_000)) p.push("margen (%) no válido");
    if (d.marginCents !== undefined && (!Number.isInteger(d.marginCents) || d.marginCents < 0)) p.push("margen (importe) no válido");
    if (d.periodStart && !YMD.test(d.periodStart)) p.push("inicio del periodo no válido");
    if (d.periodEnd && !YMD.test(d.periodEnd)) p.push("fin del periodo no válido");
    if (d.periodStart && d.periodEnd && d.periodStart > d.periodEnd) p.push("el periodo termina antes de empezar");
    amountCents = variableAmount(d);
  } else p.push("tipo de cargo no válido");
  return { amountCents, problems: p };
}

export interface ChargeStore {
  /** Crea el cargo o devuelve el de la misma clave (`created: false`). */
  insert(c: Omit<Charge, "id" | "status" | "invoiceId" | "reason" | "decidedBy" | "decidedAt" | "updatedAt" | "version">): Promise<{ charge: Charge; created: boolean }>;
  get(id: number): Promise<Charge | null>;
  list(f?: { companyId?: number; status?: ChargeStatus }): Promise<Charge[]>;
  /** Cambio optimista: `conflict` si otro lo cambió antes. */
  update(id: number, expectedVersion: number, patch: Partial<Pick<Charge, "status" | "invoiceId" | "reason" | "decidedBy" | "decidedAt">>, now: number): Promise<Charge>;
}

export class MemoryChargeStore implements ChargeStore {
  rows: Charge[] = [];
  private seq = 0;
  async insert(c: Parameters<ChargeStore["insert"]>[0]) {
    const cur = this.rows.find((r) => r.idempotencyKey === c.idempotencyKey);
    if (cur) return { charge: structuredClone(cur), created: false };
    const row: Charge = { ...structuredClone(c), id: ++this.seq, status: "draft", invoiceId: null, reason: null, decidedBy: null, decidedAt: null, updatedAt: c.createdAt, version: 1 };
    this.rows.push(row);
    return { charge: structuredClone(row), created: true };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async list(f: { companyId?: number; status?: ChargeStatus } = {}) {
    return this.rows.filter((r) => (f.companyId === undefined || r.companyId === f.companyId) && (!f.status || r.status === f.status)).sort((a, b) => b.id - a.id).map((r) => structuredClone(r));
  }
  async update(id: number, expectedVersion: number, patch: Parameters<ChargeStore["update"]>[2], now: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new InvoicingError("not_found", "Cargo no encontrado");
    if (r.version !== expectedVersion) throw new InvoicingError("conflict", "El cargo ha cambiado: vuelve a cargarlo");
    Object.assign(r, patch, { updatedAt: now, version: r.version + 1 });
    return structuredClone(r);
  }
}

type Row = mysql.RowDataPacket & Record<string, unknown>;
const COLS: Array<[keyof Charge, string]> = [
  ["companyId", "company_id"], ["kind", "kind"], ["status", "status"], ["agreementRef", "agreement_ref"], ["billingRef", "billing_ref"], ["concept", "concept"], ["currency", "currency"],
  ["amountCents", "amount_cents"], ["taxRateBp", "tax_rate_bp"], ["dueDate", "due_date"], ["method", "method"], ["mandateRef", "mandate_ref"], ["invoiceId", "invoice_id"], ["idempotencyKey", "idempotency_key"],
  ["reason", "reason"], ["createdBy", "created_by"], ["createdAt", "created_at"], ["decidedBy", "decided_by"], ["decidedAt", "decided_at"], ["updatedAt", "updated_at"], ["version", "version"],
];
const NUM = new Set<keyof Charge>(["companyId", "amountCents", "taxRateBp", "invoiceId", "createdAt", "decidedAt", "updatedAt", "version"]);

export class MysqlChargeStore implements ChargeStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    mode: "test" | "live" = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private row(r: Row): Charge {
    const out: Record<string, unknown> = { id: Number(r.id), detail: typeof r.detail_json === "string" && r.detail_json ? JSON.parse(r.detail_json) : null };
    for (const [k, c] of COLS) out[k] = r[c] === null || r[c] === undefined ? null : NUM.has(k) ? Number(r[c]) : String(r[c]);
    return out as unknown as Charge;
  }
  async get(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charges WHERE id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  async list(f: { companyId?: number; status?: ChargeStatus } = {}) {
    const w = ["livemode = ?"];
    const a: unknown[] = [this.lm];
    if (f.companyId !== undefined) (w.push("company_id = ?"), a.push(f.companyId));
    if (f.status) (w.push("status = ?"), a.push(f.status));
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM billing_charges WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, a);
    return rows.map((r) => this.row(r));
  }
  async insert(c: Parameters<ChargeStore["insert"]>[0]) {
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(
        `INSERT INTO billing_charges (livemode, company_id, kind, status, agreement_ref, billing_ref, concept, currency, amount_cents, tax_rate_bp, due_date, method, mandate_ref, detail_json, idempotency_key, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.lm, c.companyId, c.kind, c.agreementRef, c.billingRef, c.concept, c.currency, c.amountCents, c.taxRateBp, c.dueDate, c.method, c.mandateRef, c.detail ? JSON.stringify(c.detail) : null, c.idempotencyKey, c.createdBy, c.createdAt, c.createdAt],
      );
      return { charge: (await this.get(r.insertId))!, created: true };
    } catch (e) {
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      const [rows] = await this.pool.query<Row[]>("SELECT * FROM billing_charges WHERE idempotency_key = ? AND livemode = ?", [c.idempotencyKey, this.lm]);
      return { charge: this.row(rows[0]), created: false };
    }
  }
  async update(id: number, expectedVersion: number, patch: Parameters<ChargeStore["update"]>[2], now: number) {
    const map: Record<string, string> = { status: "status", invoiceId: "invoice_id", reason: "reason", decidedBy: "decided_by", decidedAt: "decided_at" };
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE billing_charges SET ${keys.map((k) => `${map[k]} = ?`).join(", ")}${keys.length ? ", " : ""}updated_at = ?, version = version + 1 WHERE id = ? AND livemode = ? AND version = ?`,
      [...keys.map((k) => patch[k] ?? null), now, id, this.lm, expectedVersion],
    );
    if (!r.affectedRows) {
      if (!(await this.get(id))) throw new InvoicingError("not_found", "Cargo no encontrado");
      throw new InvoicingError("conflict", "El cargo ha cambiado: vuelve a cargarlo");
    }
    return (await this.get(id))!;
  }
}

/** Cargo aprobado, tal como lo lee la parte de pagos (I-4 v1). */
export interface ApprovedCharge {
  id: number;
  chargeRef: string;
  companyId: number;
  concept: string;
  currency: string;
  amountCents: number;
  taxRateBp: number;
  method: ChargeMethod;
  mandateRef: string | null;
  approvedBy: string;
  approvedAt: number;
  dueDate: string;
  invoiceId: number | null;
  agreementRef: string | null;
}

export interface ChargeDeps {
  charges: ChargeStore;
  invoices: InvoicingStore;
  company(id: number): Promise<CompanyFiscal | null>;
  now?: () => number;
}

/** Concepto que figura en la factura (el gasto variable añade proveedor y periodo). */
export function invoiceConcept(c: Pick<Charge, "kind" | "concept" | "detail">): string {
  if (c.kind !== "variable_cost" || !c.detail) return c.concept;
  const d = c.detail;
  const period = d.periodStart && d.periodEnd ? ` (${d.periodStart} a ${d.periodEnd})` : "";
  return `${c.concept} — ${d.provider ?? ""}${period}`.slice(0, 300);
}

/**
 * Líneas de factura de un cargo con desglose. El IVA se calcula sobre la base total (como lo cobra Stripe en el enlace
 * de pago); la diferencia de redondeo entre líneas se ajusta en la última, para que la factura y el cobro coincidan.
 */
export function breakdownLines(c: Pick<Charge, "amountCents" | "taxRateBp" | "detail">) {
  const ls = (c.detail?.lines ?? []).map((l, k) => lineOf(k + 1, l.concept.slice(0, 300), l.quantity, l.unitCents, c.taxRateBp));
  const diff = taxOf(c.amountCents, c.taxRateBp) - ls.reduce((a, l) => a + l.taxCents, 0);
  if (diff && ls.length) ls[ls.length - 1] = { ...ls[ls.length - 1], taxCents: ls[ls.length - 1].taxCents + diff };
  return ls;
}

export class ChargeService {
  private now: () => number;
  constructor(private d: ChargeDeps) {
    this.now = d.now ?? Date.now;
  }
  async create(i: NewChargeInput, actor: string): Promise<{ charge: Charge; created: boolean }> {
    const { amountCents, problems } = validateCharge(i);
    if (problems.length) throw new InvoicingError("invalid_input", problems.join("; "));
    if (!(await this.d.company(i.companyId))) throw new InvoicingError("not_found", "Empresa no encontrada");
    return this.d.charges.insert({
      companyId: i.companyId,
      kind: i.kind,
      agreementRef: i.agreementRef ?? null,
      billingRef: i.billingRef ?? null,
      concept: i.concept.trim(),
      currency: "EUR",
      amountCents,
      taxRateBp: i.taxRateBp,
      dueDate: i.dueDate,
      method: i.method ?? "payment_link",
      mandateRef: i.mandateRef?.trim() || null,
      detail: i.kind === "variable_cost" ? (i.detail ?? null) : i.detail?.lines?.length ? { lines: i.detail.lines.map((l) => ({ concept: l.concept.trim(), quantity: l.quantity, unitCents: l.unitCents })) } : null,
      idempotencyKey: i.idempotencyKey.trim(),
      createdBy: actor,
      createdAt: this.now(),
    });
  }

  /** Aprueba: nace la factura en borrador del cargo (idempotente: aprobar dos veces devuelve lo mismo). */
  async approve(id: number, actor: string): Promise<{ charge: Charge; invoice: Invoice }> {
    const c = await this.must(id);
    if (c.status === "cancelled") throw new InvoicingError("invalid_state", "El cargo está anulado");
    if (c.status === "approved" && c.invoiceId) return { charge: c, invoice: (await this.d.invoices.get(c.invoiceId))! };
    const now = this.now();
    const company = await this.d.company(c.companyId);
    const lines = c.detail?.lines?.length ? breakdownLines(c) : [lineOf(1, invoiceConcept(c), 1, c.amountCents, c.taxRateBp)];
    const { invoice } = await this.d.invoices.insertDraft({
      sourceKey: `charge:${c.id}`,
      kind: "invoice",
      paymentStatus: "pending",
      companyId: c.companyId,
      billingRef: c.billingRef ?? `charge:${c.id}`,
      paymentRef: null,
      originalInvoiceId: null,
      operationDate: c.dueDate,
      periodStart: null,
      periodEnd: null,
      periodLabel: c.kind === "variable_cost" && c.detail?.periodStart && c.detail.periodEnd ? `${c.detail.periodStart} a ${c.detail.periodEnd}` : null,
      currency: c.currency,
      ...totals(lines),
      customer: company ? customerOf(company).party : null,
      notes: c.agreementRef ? `Según ${c.agreementRef}` : null,
      createdBy: actor,
      createdAt: now,
      lines,
    });
    const charge = await this.d.charges.update(c.id, c.version, { status: "approved", invoiceId: invoice.id, decidedBy: actor, decidedAt: now }, now);
    return { charge, invoice };
  }

  /** Anula un cargo en borrador (lo aprobado ya tiene factura: se corrige con una rectificativa). */
  async cancel(id: number, reason: string, actor: string): Promise<Charge> {
    const c = await this.must(id);
    if (c.status !== "draft") throw new InvoicingError("invalid_state", c.status === "approved" ? "El cargo ya está aprobado y tiene factura: se corrige con una rectificativa" : "El cargo ya está anulado");
    if (!reason?.trim()) throw new InvoicingError("invalid_input", "Indica el motivo de la anulación");
    const now = this.now();
    return this.d.charges.update(c.id, c.version, { status: "cancelled", reason: reason.trim().slice(0, 300), decidedBy: actor, decidedAt: now }, now);
  }

  /**
   * Lectura ESTABLE para la parte de pagos (I-4, versión 1): cargos aprobados listos para cobrar, sin leer estas tablas.
   * `dueDate` es la fecha pactada de la operación (AAAA-MM-DD, Europe/Madrid); `chargeRef` = `charge:<id>`.
   */
  async approvedCharges(f: { method?: ChargeMethod; companyId?: number } = {}): Promise<ApprovedCharge[]> {
    return (await this.d.charges.list({ status: "approved", companyId: f.companyId }))
      .filter((c) => !f.method || c.method === f.method)
      .map((c) => ({ id: c.id, chargeRef: `charge:${c.id}`, companyId: c.companyId, concept: invoiceConcept(c), currency: c.currency, amountCents: c.amountCents, taxRateBp: c.taxRateBp, method: c.method, mandateRef: c.mandateRef, approvedBy: c.decidedBy ?? "", approvedAt: c.decidedAt ?? 0, dueDate: c.dueDate, invoiceId: c.invoiceId, agreementRef: c.agreementRef }));
  }

  async must(id: number) {
    const c = await this.d.charges.get(id);
    if (!c) throw new InvoicingError("not_found", "Cargo no encontrado");
    return c;
  }
  list(f: { companyId?: number; status?: ChargeStatus } = {}) {
    return this.d.charges.list(f);
  }
}
