/**
 * Facturas propias (serie EB) de las ventas cobradas por Stripe desde el panel: alta de Essential o Business desde la
 * prueba, compra de módulos y ampliaciones (prorrateo), cambios de plan y renovaciones de esas suscripciones.
 *
 * Fuente: la cola `fiscal_documents` (CRM 0016), que el procesador de eventos de Stripe llena SOLO con cobros
 * verificados (factura releída en Stripe, pagada, del pedido y del cliente correctos), junto con la copia de la factura
 * (`stripe_invoices`), sus líneas (`stripe_invoice_lines`) y el perfil fiscal del comprador (`stripe_buyer_profiles`).
 * Aquí todo es LECTURA de esas tablas salvo marcar el documento fiscal como emitido con el número EB
 * (`markFiscalDocumentIssued`, el método ya existente del almacén de Stripe).
 *
 *  - Borrador: uno por factura de Stripe cobrada (`order:<pedido>:in:<factura>`, único por entorno): repetir la pasada,
 *    o que el evento llegue dos veces, nunca crea otra factura. Líneas e importes los del cobro real; el IVA, el que se
 *    cobró (cuota por línea de Stripe Tax), sin recalcularlo. Fecha de operación: el día del cobro (cobro anticipado).
 *  - Expedición: la de siempre (`InvoicingAutomation.issueDue`): contraste por API con Stripe, número correlativo, PDF y
 *    envío. Antes, `readiness` exige los datos fiscales completos del comprador y el IVA del 21 % de la península y
 *    Baleares; si falta algo, la factura queda bloqueada con el motivo (`invoice_issue_blocked`).
 *  - Expedida: el documento fiscal queda «emitido» con el número EB. Una rectificativa expedida sobre una de estas
 *    facturas marca el documento de reembolso pendiente del mismo importe.
 *  - Reembolsos: la factura queda «reembolsada» (total) o con aviso (parcial); la rectificativa la decide y expide una
 *    persona (`POST /invoicing/invoices/:id/rectify`), como en el resto de la facturación propia.
 */
import { classifyTerritory, territoryGroup, type BuyerProfile } from "../stripe/buyerProfile";
import { STRIPE_PRODUCT_NAME } from "../stripe/catalog";
import { invoiceSourceKey, type FiscalDocument, type FiscalDocumentStatus, type StripeInvoiceRecord } from "../stripe/fiscalDocuments";
import type { InvoiceLineRow } from "../stripe/invoiceLines";
import { customerOf, taxOf, ymd, type CompanyFiscal } from "./rules";
import type { InvoicingStore } from "./store";
import type { FiscalParty, Invoice, InvoiceLine, NewInvoice } from "./types";

/** Tipo de IVA de las ventas de Elephant Source a compradores de la península y Baleares. */
export const STANDARD_VAT_BP = 2100;
const SALE_KEY = /^order:(\d+):in:(.+)$/;

export const stripeSaleSourceKey = (orderId: number, stripeInvoiceId: string) => `order:${orderId}:in:${stripeInvoiceId}`;
export const isStripeSale = (inv: Pick<Invoice, "sourceKey" | "kind">) => inv.kind === "invoice" && SALE_KEY.test(inv.sourceKey);
export function parseStripeSale(sourceKey: string): { orderId: number; stripeInvoiceId: string } | null {
  const m = SALE_KEY.exec(sourceKey);
  return m ? { orderId: Number(m[1]), stripeInvoiceId: m[2] } : null;
}

/** Lo que se lee del registro de Stripe (solo lectura) y el único método de escritura permitido. */
export interface StripeSalesRegistry {
  listFiscalDocuments(q: { status?: FiscalDocumentStatus; orderId?: number; limit: number }): Promise<FiscalDocument[]>;
  fiscalDocumentBySource(sourceKey: string): Promise<FiscalDocument | null>;
  invoiceRecord(stripeInvoiceId: string): Promise<StripeInvoiceRecord | null>;
  buyerProfile(orderId: number): Promise<BuyerProfile | null>;
  markFiscalDocumentIssued(id: number, externalRef: string, by: string, at: number): Promise<FiscalDocument | null>;
}

export interface StripeSalesDeps {
  stripe: StripeSalesRegistry;
  /** Líneas de las facturas cobradas (CRM 0019); sin ellas, una línea con los totales del cobro. */
  lines?: { linesOf(stripeInvoiceId: string): Promise<InvoiceLineRow[]> } | null;
  /** Empresa del pedido comercial (null si no existe). */
  orderCompany(orderId: number): Promise<number | null>;
  /** Ficha fiscal de la empresa (CRM): solo si el pedido no tiene perfil fiscal del comprador. */
  company(id: number): Promise<CompanyFiscal | null>;
  now?: () => number;
}

export interface StripeSalesReport {
  created: Array<{ id: number; sourceKey: string; totalCents: number }>;
  existing: number;
  /** Documentos fiscales marcados como emitidos en esta pasada (reparación de una marca que falló al expedir). */
  marked: number;
  /** Cobros sin borrador (no se factura lo que no consta cobrado o no tiene empresa). */
  skipped: Array<{ documentId: number; stripeInvoiceId: string; reason: string }>;
  payments: Array<{ invoiceId: number; paymentStatus: string }>;
  warnings: string[];
}

/** Lo que la facturación necesita de las ventas de Stripe (la implementa `StripeSalesInvoicing`). */
export interface StripeSalesPort {
  generate(store: InvoicingStore, actor: string, f?: { companyId?: number }): Promise<StripeSalesReport>;
  /** Comprador y motivos por los que aún no se puede expedir (vacío = se puede). */
  readiness(inv: Invoice): Promise<{ party: FiscalParty | null; problems: string[] }>;
  /** Tras expedir: el documento fiscal del cobro (o del reembolso) queda emitido con el número. */
  issued(inv: Invoice, store: Pick<InvoicingStore, "get">): Promise<void>;
}

const PURPOSE_CONCEPT: Record<StripeInvoiceRecord["purpose"], string> = {
  initial: "Alta de la suscripción a Elephant Source",
  change: "Ampliación de la suscripción a Elephant Source (prorrateo)",
  renewal: "Renovación de la suscripción a Elephant Source",
};

const DAY_MS = 86_400_000;
const dmy = (ms: number) => {
  const d = ymd(ms);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};
const span = (start: number | null, end: number | null) => (start !== null && end !== null && end > start ? `${dmy(start)} a ${dmy(end - DAY_MS >= start ? end - DAY_MS : end - 1)}` : null);
const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

/** Nombre comercial de un producto del catálogo (planes con su nombre en Stripe; el resto, desde su clave). */
export function productLabel(key: string | null): string {
  if (!key) return "Suscripción a Elephant Source";
  const plan = (STRIPE_PRODUCT_NAME as Record<string, string>)[key];
  if (plan) return plan;
  return key
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Tipo de IVA de una línea a partir de la cuota que cobró Stripe. Si la cuota es la del 21 % (con el redondeo de
 * Stripe, ±1 céntimo por línea), 21 %; si no, el tipo efectivo, que `readiness` bloquea para revisión.
 */
export function rateOf(baseCents: number, taxCents: number, tolerance = 1): number {
  if (baseCents === 0) return taxCents === 0 ? STANDARD_VAT_BP : 0;
  if (Math.abs(taxOf(baseCents, STANDARD_VAT_BP) - taxCents) <= tolerance) return STANDARD_VAT_BP;
  return Math.round((taxCents * 10_000) / baseCents);
}

/**
 * Líneas de la factura propia con los importes EXACTOS del cobro: base total − IVA y la cuota cobrada. Se usan las
 * líneas de Stripe cuando cuadran al céntimo con la factura; si no (descuentos, saldo, líneas sin registrar), una sola
 * línea con los totales cobrados.
 */
export function saleLines(rec: Pick<StripeInvoiceRecord, "purpose" | "totalCents" | "taxCents" | "periodStart">, stripeLines: InvoiceLineRow[]): InvoiceLine[] {
  const tax = rec.taxCents ?? 0;
  const base = rec.totalCents - tax;
  const usable = stripeLines.filter((l) => l.amountCents !== 0 || (l.taxCents ?? 0) !== 0);
  const fits = usable.length > 0 && usable.reduce((a, l) => a + l.amountCents, 0) === base && usable.reduce((a, l) => a + (l.taxCents ?? 0), 0) === tax && (tax === 0 || usable.every((l) => l.taxCents !== null));
  if (!fits) {
    const period = span(Math.min(...stripeLines.map((l) => l.periodStart ?? Infinity), rec.periodStart ?? Infinity), Math.max(...stripeLines.map((l) => l.periodEnd ?? -Infinity), -Infinity));
    return [{ position: 1, concept: `${PURPOSE_CONCEPT[rec.purpose]}${period ? ` — ${period}` : ""}`.slice(0, 300), quantity: 1, unitCents: base, baseCents: base, taxRateBp: rateOf(base, tax, Math.max(1, stripeLines.length)), taxCents: tax }];
  }
  return usable.map((l, k) => {
    const lineTax = l.taxCents ?? 0;
    const q = l.quantity && l.quantity > 1 && l.amountCents % l.quantity === 0 ? l.quantity : 1;
    const period = span(l.periodStart, l.periodEnd);
    const what = `${productLabel(l.productKey)}${l.proration ? (l.amountCents < 0 ? " (abono por prorrateo)" : " (prorrateo)") : ""}${q === 1 && l.quantity && l.quantity > 1 ? ` × ${l.quantity}` : ""}`;
    return { position: k + 1, concept: `${what}${period ? ` — ${period}` : ""}`.slice(0, 300), quantity: q, unitCents: l.amountCents / q, baseCents: l.amountCents, taxRateBp: rateOf(l.amountCents, lineTax), taxCents: lineTax };
  });
}

export class StripeSalesInvoicing implements StripeSalesPort {
  private readonly now: () => number;
  constructor(private readonly d: StripeSalesDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Datos fiscales del comprador del pedido: su perfil fiscal (lo que usó Stripe Tax) o, sin él, la ficha del CRM. */
  async buyer(orderId: number, companyId: number, rec: Pick<StripeInvoiceRecord, "customerCountry" | "customerPostalCode"> | null): Promise<{ party: FiscalParty | null; problems: string[] }> {
    const profile = await this.d.stripe.buyerProfile(orderId).catch(() => null);
    if (!profile || profile.orderId !== orderId) {
      const company = await this.d.company(companyId);
      if (!company) return { party: null, problems: ["comprador: la empresa no existe"] };
      const r = customerOf(company);
      return { party: r.party, problems: r.problems.map((p) => `comprador: ${p}`) };
    }
    const a = profile.billingAddress;
    const r = customerOf({ name: profile.displayName, legalName: profile.displayName, taxId: profile.taxId, address: a ? [a.line1, a.line2].filter(Boolean).join(", ") : null, postalCode: profile.postalCode, city: a?.city ?? null, country: profile.country, billingEmail: profile.billingEmail });
    const problems = [...r.problems];
    // La dirección con la que Stripe calculó el impuesto debe ser del mismo territorio que la declarada
    const t = rec?.customerCountry ? classifyTerritory(rec.customerCountry, rec.customerPostalCode) : null;
    if (rec?.customerCountry && (!t || territoryGroup(t) !== territoryGroup(profile.territory))) problems.push("la dirección de la factura de Stripe no es del territorio del perfil fiscal declarado");
    return { party: problems.length ? null : r.party, problems: problems.map((p) => `comprador: ${p}`) };
  }

  async generate(store: InvoicingStore, actor: string, f: { companyId?: number } = {}): Promise<StripeSalesReport> {
    const rep: StripeSalesReport = { created: [], existing: 0, marked: 0, skipped: [], payments: [], warnings: [] };
    const docs = await this.d.stripe.listFiscalDocuments({ status: "pending", limit: 500 });
    for (const doc of docs.filter((x) => x.kind === "invoice")) {
      const skip = (reason: string) => rep.skipped.push({ documentId: doc.id, stripeInvoiceId: doc.stripeInvoiceId, reason });
      const companyId = await this.d.orderCompany(doc.orderId);
      if (companyId === null) {
        if (f.companyId === undefined) skip(`el pedido ${doc.orderId} no existe`);
        continue;
      }
      if (f.companyId !== undefined && companyId !== f.companyId) continue;
      const key = stripeSaleSourceKey(doc.orderId, doc.stripeInvoiceId);
      const cur = await store.bySource(key);
      if (cur) {
        rep.existing++;
        // Expedida pero sin marcar (la marca falló al expedir): se repara aquí
        if (cur.status !== "draft" && cur.number && (await this.mark(doc, cur))) rep.marked++;
        continue;
      }
      // Nunca una factura sin cobro verificado: la copia de la factura de Stripe debe constar pagada y por el total
      const rec = await this.d.stripe.invoiceRecord(doc.stripeInvoiceId);
      if (!rec) {
        skip("no consta la copia de la factura de Stripe");
        continue;
      }
      if (rec.status !== "paid") {
        skip(`la factura de Stripe no consta cobrada (${rec.status})`);
        continue;
      }
      if (rec.amountPaidCents <= 0) {
        skip("la factura de Stripe no tiene importe cobrado (saldo a favor o descuento total): la factura la decide una persona");
        continue;
      }
      if (rec.orderId !== doc.orderId || rec.totalCents !== doc.totalCents || rec.currency.toUpperCase() !== doc.currency.toUpperCase()) {
        skip("el documento fiscal no casa con la factura de Stripe (pedido, importe o moneda)");
        continue;
      }
      const draft = await this.draftOf(doc, rec, companyId, actor);
      const r = await store.insertDraft(draft);
      if (!r.created) {
        rep.existing++;
        continue;
      }
      await store.setPayment(r.invoice.id, { paymentStatus: "paid", paymentRef: `stripe:in:${rec.stripeInvoiceId}`, paidAt: doc.createdAt }, this.now());
      rep.created.push({ id: r.invoice.id, sourceKey: r.invoice.sourceKey, totalCents: r.invoice.totalCents });
    }
    await this.syncRefunds(store, docs, f, rep);
    return rep;
  }

  private async draftOf(doc: FiscalDocument, rec: StripeInvoiceRecord, companyId: number, actor: string): Promise<NewInvoice> {
    const stripeLines = this.d.lines ? await this.d.lines.linesOf(rec.stripeInvoiceId).catch(() => []) : [];
    const lines = saleLines(rec, stripeLines.filter((l) => l.orderId === doc.orderId));
    const baseCents = lines.reduce((a, l) => a + l.baseCents, 0);
    const taxCents = lines.reduce((a, l) => a + l.taxCents, 0);
    const starts = stripeLines.map((l) => l.periodStart).filter((x): x is number => x !== null);
    const ends = stripeLines.map((l) => l.periodEnd).filter((x): x is number => x !== null);
    const periodStart = starts.length ? Math.min(...starts) : rec.periodStart;
    const periodEnd = ends.length ? Math.max(...ends) : null;
    return {
      sourceKey: stripeSaleSourceKey(doc.orderId, rec.stripeInvoiceId),
      kind: "invoice",
      paymentStatus: "paid",
      companyId,
      billingRef: `order:${doc.orderId}`,
      paymentRef: `stripe:in:${rec.stripeInvoiceId}`,
      originalInvoiceId: null,
      // Servicio cobrado por anticipado: el IVA se devenga con el cobro (art. 75.2 de la Ley 37/1992)
      operationDate: ymd(doc.createdAt),
      periodStart,
      periodEnd,
      periodLabel: span(periodStart, periodEnd),
      currency: rec.currency.toUpperCase(),
      baseCents,
      taxCents,
      totalCents: baseCents + taxCents,
      customer: (await this.buyer(doc.orderId, companyId, rec)).party,
      notes: `Cobrada con Stripe (factura ${rec.number ?? rec.stripeInvoiceId}).`,
      createdBy: actor,
      createdAt: this.now(),
      lines,
    };
  }

  /** Reembolsos: la factura queda «reembolsada» (total) o con aviso (parcial); la rectificativa la expide una persona. */
  private async syncRefunds(store: InvoicingStore, docs: FiscalDocument[], f: { companyId?: number }, rep: StripeSalesReport) {
    const seen = new Set<string>();
    for (const doc of docs.filter((x) => x.kind === "rectification")) {
      const key = stripeSaleSourceKey(doc.orderId, doc.stripeInvoiceId);
      if (seen.has(key)) continue;
      seen.add(key);
      const inv = await store.bySource(key);
      if (!inv || (f.companyId !== undefined && inv.companyId !== f.companyId)) continue;
      const rec = await this.d.stripe.invoiceRecord(doc.stripeInvoiceId);
      if (!rec || rec.amountRefundedCents <= 0) continue;
      const label = inv.number ?? `#${inv.id}`;
      if (rec.amountRefundedCents >= inv.totalCents && inv.paymentStatus !== "refunded") {
        await store.setPayment(inv.id, { paymentStatus: "refunded", paymentRef: inv.paymentRef, paidAt: inv.paidAt }, this.now());
        rep.payments.push({ invoiceId: inv.id, paymentStatus: "refunded" });
      }
      rep.warnings.push(`Factura ${label}: reembolso de ${euros(rec.amountRefundedCents)} en Stripe; ${inv.status === "draft" ? "no se expide sola: decidir si se expide y se rectifica" : "hay que expedir la rectificativa"}`);
    }
  }

  async readiness(inv: Invoice): Promise<{ party: FiscalParty | null; problems: string[] }> {
    const ref = parseStripeSale(inv.sourceKey);
    if (!ref) return { party: null, problems: ["no es una venta de Stripe"] };
    const problems: string[] = [];
    const doc = await this.d.stripe.fiscalDocumentBySource(invoiceSourceKey(ref.stripeInvoiceId));
    // Una sola factura por cobro: si el documento ya consta emitido con otro número, no se expide otra
    if (!doc || doc.orderId !== ref.orderId) problems.push("no consta el cobro verificado de Stripe de esta venta");
    else {
      if (doc.status === "issued" && doc.externalRef !== inv.number) problems.push(`el cobro ya consta facturado (${doc.externalRef})`);
      if (doc.totalCents !== inv.totalCents) problems.push(`el total de la factura (${inv.totalCents}) no es el cobrado en Stripe (${doc.totalCents}) (céntimos)`);
    }
    const companyId = await this.d.orderCompany(ref.orderId);
    if (companyId !== inv.companyId) problems.push("el pedido no es de la empresa de la factura");
    const rec = await this.d.stripe.invoiceRecord(ref.stripeInvoiceId);
    const buyer = await this.buyer(ref.orderId, inv.companyId, rec);
    problems.push(...buyer.problems);
    const rates = Array.from(new Set(inv.lines.filter((l) => l.taxRateBp !== STANDARD_VAT_BP).map((l) => l.taxRateBp)));
    if (rates.length) problems.push(`el IVA cobrado en Stripe (${rates.map((r) => `${(r / 100).toLocaleString("es-ES")} %`).join(", ")}) no es el 21 % de un comprador de la península o Baleares: requiere revisión fiscal`);
    return { party: problems.length ? null : buyer.party, problems };
  }

  async issued(inv: Invoice, store: Pick<InvoicingStore, "get">): Promise<void> {
    if (!inv.number) return;
    if (isStripeSale(inv)) {
      const ref = parseStripeSale(inv.sourceKey)!;
      const doc = await this.d.stripe.fiscalDocumentBySource(invoiceSourceKey(ref.stripeInvoiceId));
      if (doc && doc.orderId === ref.orderId) await this.mark(doc, inv);
      return;
    }
    // Rectificativa de una venta de Stripe: liquida el documento de reembolso pendiente del mismo importe
    if (inv.kind !== "rectification" || !inv.originalInvoiceId) return;
    const original = await store.get(inv.originalInvoiceId);
    const ref = original && isStripeSale(original) ? parseStripeSale(original.sourceKey) : null;
    if (!ref) return;
    const pending = await this.d.stripe.listFiscalDocuments({ status: "pending", orderId: ref.orderId, limit: 500 });
    const doc = pending.find((x) => x.kind === "rectification" && x.stripeInvoiceId === ref.stripeInvoiceId && x.totalCents === inv.totalCents);
    if (doc) await this.mark(doc, inv);
  }

  private async mark(doc: FiscalDocument, inv: Invoice): Promise<boolean> {
    if (doc.status === "issued" || !inv.number) return false;
    await this.d.stripe.markFiscalDocumentIssued(doc.id, inv.number, `invoicing:${inv.issuedBy ?? "system"}`.slice(0, 120), inv.issuedAt ?? this.now());
    return true;
  }
}
