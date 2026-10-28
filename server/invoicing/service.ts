/**
 * Facturación propia de Elephant Source: facturas por DEVENGO, estado de cobro aparte (contrato §5).
 *
 *  - Servicios externos: un borrador por periodo devengado (día de vencimiento pactado), idempotente por
 *    `external:<id>:<AAAA-MM>`. Solo contrataciones aceptadas y en curso (programada, al día o con pago pendiente).
 *    «Decisión pendiente» (método de pago autorizado tarde) no se factura sola: la primera mensualidad la decide una
 *    persona. Nunca se factura un periodo anterior al primer vencimiento pactado.
 *  - Cobro: se lee, sin escribir nada, del historial de la contratación (`invoice_paid` / `invoice_payment_failed`,
 *    con la mensualidad en `detail.period`). Un descuadre de importes es un aviso, nunca una corrección.
 *  - Expedir: solo con la emisión real habilitada en el entorno, con los datos fiscales del cliente completos y
 *    válidos, y no antes de la fecha de operación. Número correlativo y datos congelados al expedir.
 */
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import { customerOf, externalPeriods, externalSourceKey, lineOf, totals, ymd, type CompanyFiscal } from "./rules";
import type { InvoicingStore } from "./store";
import { InvoicingError, type FiscalParty, type Invoice } from "./types";

/** Contrataciones externas que se facturan solas: aceptadas, con el método de pago autorizado y en curso. */
const BILLABLE = new Set(["scheduled", "active", "past_due"]);

export interface InvoicingDeps {
  store: InvoicingStore;
  /** Contrataciones de servicios externos (solo lectura). */
  external?: { list(f?: { companyId?: number }): Promise<ExternalSubscription[]>; events(externalId: number): Promise<ExternalEvent[]> };
  /** Ficha fiscal de la empresa (CRM). */
  company(id: number): Promise<CompanyFiscal | null>;
  issuer: FiscalParty;
  seriesCode: string;
  /** Expedición real habilitada (`CP_INVOICING_ISSUE_ENABLED=1`); apagada, solo se preparan borradores. */
  issueEnabled: boolean;
  now?: () => number;
}

export interface GenerateReport {
  created: Array<{ id: number; sourceKey: string; totalCents: number }>;
  existing: number;
  skipped: Array<{ externalId: number; reason: string }>;
  payments: Array<{ invoiceId: number; paymentStatus: string }>;
  warnings: string[];
}

export class InvoicingService {
  private now: () => number;
  constructor(private d: InvoicingDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Borradores de las mensualidades devengadas de los servicios externos y su estado de cobro. Idempotente. */
  async generateExternal(actor: string, f: { companyId?: number } = {}): Promise<GenerateReport> {
    const rep: GenerateReport = { created: [], existing: 0, skipped: [], payments: [], warnings: [] };
    if (!this.d.external) return rep;
    const now = this.now();
    for (const x of await this.d.external.list(f)) {
      if (!BILLABLE.has(x.status)) {
        if (x.status === "needs_decision") rep.skipped.push({ externalId: x.id, reason: "decisión pendiente sobre la primera mensualidad: se factura cuando se decida" });
        continue;
      }
      const company = await this.d.company(x.companyId);
      const customer = company ? customerOf(company).party : null;
      for (const p of externalPeriods(x, now)) {
        const lines = [lineOf(1, `${x.serviceName} — ${p.label}`, 1, x.amountCents, x.taxRateBp)];
        const r = await this.d.store.insertDraft({
          sourceKey: externalSourceKey(x.id, p.month),
          kind: "invoice",
          paymentStatus: "pending",
          companyId: x.companyId,
          billingRef: `external:${x.id}`,
          paymentRef: null,
          originalInvoiceId: null,
          operationDate: p.operationDate,
          periodStart: p.start,
          periodEnd: p.end,
          periodLabel: p.label,
          currency: x.currency.toUpperCase(),
          ...totals(lines),
          customer,
          notes: x.externalRef ? `Referencia del cliente: ${x.externalRef}` : null,
          createdBy: actor,
          createdAt: now,
          lines,
        });
        if (r.created) rep.created.push({ id: r.invoice.id, sourceKey: r.invoice.sourceKey, totalCents: r.invoice.totalCents });
        else rep.existing++;
      }
      await this.syncExternalPayments(x, rep);
    }
    return rep;
  }

  /** Estado de cobro de las facturas de una contratación externa a partir de su historial (solo lectura). */
  private async syncExternalPayments(x: ExternalSubscription, rep: GenerateReport) {
    const events = await this.d.external!.events(x.id);
    const now = this.now();
    for (const inv of await this.d.store.list({ billingRef: `external:${x.id}` })) {
      if (inv.kind !== "invoice") continue;
      // El periodo del servicio: `periodStart` (ms) si el hecho lo trae, si no la mensualidad legible (`period`)
      const same = (e: ExternalEvent) => {
        const d = (e.detail ?? {}) as { period?: unknown; periodStart?: unknown };
        if (typeof d.periodStart === "number" && inv.periodStart !== null) return Math.abs(d.periodStart - inv.periodStart) < 12 * 3_600_000;
        return d.period === inv.periodLabel;
      };
      const paid = events.find((e) => e.kind === "invoice_paid" && same(e));
      const failed = events.filter((e) => e.kind === "invoice_payment_failed" && same(e));
      const refunded = events.filter((e) => e.kind === "charge_refunded" && same(e) && (e.detail as { fullyRefunded?: unknown }).fullyRefunded === true);
      if (inv.paymentStatus === "refunded") continue;
      if (refunded.length) {
        // Reembolso total: la factura queda reembolsada; la rectificativa la expide una persona (nunca automática)
        await this.d.store.setPayment(inv.id, { paymentStatus: "refunded", paymentRef: inv.paymentRef, paidAt: inv.paidAt }, now);
        rep.payments.push({ invoiceId: inv.id, paymentStatus: "refunded" });
        rep.warnings.push(`Factura ${inv.number ?? `#${inv.id}`}: reembolsada; hay que expedir la rectificativa`);
        continue;
      }
      if (paid) {
        const d = paid.detail as { subtotal?: unknown; baseCents?: unknown };
        const sub = Number(d.baseCents ?? d.subtotal);
        if (Number.isFinite(sub) && sub !== inv.baseCents) rep.warnings.push(`Factura ${inv.number ?? `#${inv.id}`}: el cobro ${paid.ref} tiene base ${sub} y la factura ${inv.baseCents} (céntimos)`);
        if (inv.paymentStatus !== "paid") {
          await this.d.store.setPayment(inv.id, { paymentStatus: "paid", paymentRef: paid.ref ? `stripe:in:${paid.ref}` : null, paidAt: paid.at }, now);
          rep.payments.push({ invoiceId: inv.id, paymentStatus: "paid" });
        }
      } else if (failed.length && inv.paymentStatus === "pending") {
        await this.d.store.setPayment(inv.id, { paymentStatus: "failed", paymentRef: failed[failed.length - 1].ref ? `stripe:in:${failed[failed.length - 1].ref}` : null, paidAt: null }, now);
        rep.payments.push({ invoiceId: inv.id, paymentStatus: "failed" });
      }
    }
  }

  /** ¿Bastan los datos fiscales de la empresa para facturarle? Las mismas reglas que al expedir. */
  async fiscalCheck(companyId: number): Promise<{ ready: boolean; problems: string[]; issueEnabled: boolean }> {
    const company = await this.d.company(companyId);
    if (!company) throw new InvoicingError("not_found", "Empresa no encontrada");
    const { problems } = customerOf(company);
    return { ready: problems.length === 0, problems, issueEnabled: this.d.issueEnabled };
  }

  /** Lo que falta para poder expedir una factura (vacío = se puede). */
  async readiness(id: number): Promise<{ invoice: Invoice; problems: string[] }> {
    const invoice = await this.must(id);
    const problems: string[] = [];
    if (invoice.status !== "draft") problems.push("ya está expedida");
    if (!this.d.issueEnabled) problems.push("la expedición real está apagada en este entorno (CP_INVOICING_ISSUE_ENABLED)");
    if (invoice.operationDate > ymd(this.now())) problems.push(`la fecha de operación (${invoice.operationDate}) todavía no ha llegado`);
    if (invoice.kind === "rectification") {
      // Corrige una factura ya expedida: sus datos fiscales son los de esa factura, que debe seguir vigente
      const original = invoice.originalInvoiceId ? await this.d.store.get(invoice.originalInvoiceId) : null;
      if (!original || original.status !== "issued") problems.push("la factura que rectifica ya no está vigente");
      return { invoice, problems };
    }
    const company = await this.d.company(invoice.companyId);
    if (!company) problems.push("la empresa no existe");
    else problems.push(...customerOf(company).problems.map((p) => `cliente: ${p}`));
    return { invoice, problems };
  }

  /** Expide: número correlativo de la serie, datos del emisor y del cliente congelados y huella encadenada. */
  async issue(id: number, actor: string): Promise<Invoice> {
    const { invoice, problems } = await this.readiness(id);
    if (problems.length) throw new InvoicingError(this.d.issueEnabled ? "invalid_state" : "unavailable", `No se puede expedir: ${problems.join("; ")}`);
    const original = invoice.originalInvoiceId ? await this.must(invoice.originalInvoiceId) : null;
    // Una rectificativa lleva los datos del cliente de la factura que corrige y va en su propia serie (art. 15 RD 1619/2012)
    const customer = original?.customer ?? customerOf((await this.d.company(invoice.companyId))!).party!;
    const seriesCode = invoice.kind === "rectification" ? `${this.d.seriesCode}R` : this.d.seriesCode;
    const now = this.now();
    const issued = await this.d.store.issue({ id, seriesCode, issueDate: ymd(now), issuer: this.d.issuer, customer, issuedBy: actor, issuedAt: now });
    // Rectificación total: la original queda «rectificada» (una parcial la deja vigente por la diferencia)
    if (original && issued.totalCents === -original.totalCents) await this.d.store.setStatus(original.id, "rectified", now);
    return issued;
  }

  /**
   * Borrador de factura rectificativa de una factura expedida (art. 15 RD 1619/2012): total (todas sus líneas en negativo)
   * o parcial (una base menor, con un único tipo de IVA). Misma fecha de operación y cliente que la original; se expide
   * en la serie de rectificativas. Idempotente por importe: repetir devuelve el mismo borrador.
   */
  async rectify(originalId: number, i: { reason: string; baseCents?: number }, actor: string): Promise<Invoice> {
    const o = await this.must(originalId);
    if (o.kind !== "invoice" || o.status !== "issued") throw new InvoicingError("invalid_state", "Solo se rectifica una factura expedida y vigente");
    const reason = (i.reason ?? "").trim();
    if (reason.length < 3 || reason.length > 300) throw new InvoicingError("invalid_input", "Indica el motivo de la rectificación (3 a 300 caracteres)");
    const rates = Array.from(new Set(o.lines.map((l) => l.taxRateBp)));
    const full = i.baseCents === undefined || i.baseCents === o.baseCents;
    if (!full && (!Number.isInteger(i.baseCents) || i.baseCents! <= 0 || i.baseCents! > o.baseCents)) throw new InvoicingError("invalid_input", "La base a rectificar debe ser positiva y no mayor que la de la factura");
    if (!full && rates.length !== 1) throw new InvoicingError("invalid_input", "Con varios tipos de IVA, solo rectificación total");
    const lines = full ? o.lines.map((l, k) => lineOf(k + 1, `Rectificación: ${l.concept}`.slice(0, 300), l.quantity, -l.unitCents, l.taxRateBp)) : [lineOf(1, `Rectificación parcial de la factura ${o.number}`, 1, -i.baseCents!, rates[0])];
    const t = totals(lines);
    const { invoice } = await this.d.store.insertDraft({
      sourceKey: `rectify:${o.id}:${-t.baseCents}`,
      kind: "rectification",
      paymentStatus: o.paymentStatus === "refunded" ? "refunded" : "pending",
      companyId: o.companyId,
      billingRef: o.billingRef,
      paymentRef: null,
      originalInvoiceId: o.id,
      operationDate: o.operationDate,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      periodLabel: o.periodLabel,
      currency: o.currency,
      ...t,
      customer: o.customer,
      notes: `Rectifica la factura ${o.number} de ${o.issueDate}. Motivo: ${reason}`.slice(0, 500),
      createdBy: actor,
      createdAt: this.now(),
      lines,
    });
    return invoice;
  }

  async must(id: number) {
    const x = await this.d.store.get(id);
    if (!x) throw new InvoicingError("not_found", "Factura no encontrada");
    return x;
  }
  list(f: { companyId?: number; status?: string; billingRef?: string; limit?: number } = {}) {
    return this.d.store.list(f);
  }
}
