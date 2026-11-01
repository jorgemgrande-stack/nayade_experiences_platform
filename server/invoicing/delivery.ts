/**
 * Facturación fiscal automática de Big Elephant (DF-2, aprobada el 01/11/2026). Reutiliza el motor de `./service`:
 * aquí solo se decide CUÁNDO expedir y se entregan los documentos.
 *
 * Circuito ordinario:
 *  1. Proforma: el borrador de la mensualidad nace `proformaLeadDays` antes del cobro (5 por defecto) y se envía al
 *     correo de facturación del cliente como «PROFORMA — SIN VALIDEZ FISCAL» (sin número, no se contabiliza). Nunca se
 *     envía una proforma de un periodo ya vencido (nada retroactivo).
 *  2. Cobro: lo ejecuta Stripe (sin tocar su motor); el webhook marca el borrador como cobrado.
 *  3. Contraste: antes de expedir, la factura de Stripe se lee por API (pagada, mismo importe y moneda). Si no casa, no
 *     se expide y queda la incidencia.
 *  4. Factura: se expide UNA vez (número correlativo por serie y año con bloqueo de fila, huella encadenada y datos
 *     fiscales congelados; `InvoicingService.issue`), se genera el PDF y se envía al correo de facturación con clave
 *     idempotente (la bandeja de salida reintenta la entrega). La contabilización la hace la automatización contable
 *     (`invoice:<id>`, una sola vez).
 *
 * Operaciones a crédito: con el cobro fallido (impago de un servicio prestado), la factura se expide igualmente el día 10
 * del mes siguiente a la operación (el plazo legal para empresas es antes del día 16: art. 11 del RD 1619/2012) y queda
 * pendiente de cobro. Sin ningún intento de cobro no se expide sola (puede ser una baja posterior a la proforma). Las
 * rectificativas (reembolsos, abonos) siguen siendo una decisión de una persona: aquí no se expiden.
 */
import type { BrandIssuer, PdfBlock } from "../documents/brandPdf";
import { fmt, renderEmail } from "../mail/design";
import { platformBrand } from "../mail/templates";
import type { MailAttachment, MailCategory, MailContent } from "../mail/types";
import { ymd } from "./rules";
import type { InvoicingService } from "./service";
import type { InvoicingStore } from "./store";
import type { FiscalParty, Invoice } from "./types";

export const PROFORMA_LEGEND = "PROFORMA — SIN VALIDEZ FISCAL";
export const DEFAULT_PROFORMA_LEAD_DAYS = 5;
/** Día del mes siguiente a la operación en que se expide una factura sin cobrar (plazo legal: antes del día 16). */
export const CREDIT_ISSUE_DAY = 10;
/** Facturas expedidas que se vuelven a intentar entregar si el encolado falló (días hacia atrás). */
const REDELIVER_DAYS = 45;
export const INVOICING_ACTOR = "system:invoicing";

const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const date = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES")} %`;
const partyLines = (p: FiscalParty | null) => (p ? [p.legalName, `NIF ${p.taxId}`, p.address, `${p.postalCode} ${p.city} (${p.country})`] : ["Datos fiscales pendientes de verificar"]);

/** Fecha (AAAA-MM-DD) desde la que una factura sin cobrar se expide a crédito. */
export function creditIssueDate(operationDate: string): string {
  const y = Number(operationDate.slice(0, 4));
  const m = Number(operationDate.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(CREDIT_ISSUE_DAY).padStart(2, "0")}`;
}

/** Nombre del PDF: el número de la factura o, en la proforma, su mensualidad. */
export const documentName = (inv: Invoice, proforma: boolean) => (proforma ? `proforma-${inv.operationDate.slice(0, 7)}-${inv.id}.pdf` : `factura-${inv.number}.pdf`);

/** Bloques del PDF: contenido del art. 6 del RD 1619/2012; la proforma lleva la leyenda y ningún número. */
export function invoicePdfBlocks(inv: Invoice, issuerDraft: FiscalParty, o: { proforma?: boolean } = {}): PdfBlock[] {
  const proforma = !!o.proforma || inv.status === "draft";
  const title = proforma ? "Factura proforma" : inv.kind === "rectification" ? "Factura rectificativa" : "Factura";
  const blocks: PdfBlock[] = [{ kind: "title", text: title, subtitle: proforma ? PROFORMA_LEGEND : `${inv.number}` }];
  if (proforma) blocks.push({ kind: "box", title: PROFORMA_LEGEND, lines: ["Documento informativo previo al cobro. No es una factura: no tiene número fiscal ni se contabiliza.", "La factura definitiva se emitirá y enviará una vez confirmado el cobro."] });
  blocks.push({
    kind: "keyValue",
    rows: [
      ...(proforma ? [] : ([["Número", inv.number ?? "—"], ["Fecha de expedición", date(inv.issueDate)]] as Array<[string, string]>)),
      ["Fecha de operación", `${date(inv.operationDate)}${inv.periodLabel ? ` · periodo: ${inv.periodLabel}` : ""}`],
      ...(inv.kind === "rectification" && inv.originalInvoiceId ? ([["Rectifica", `factura n.º ${inv.originalInvoiceId}`]] as Array<[string, string]>) : []),
    ],
  });
  blocks.push({ kind: "box", title: "Emisor", lines: partyLines(inv.issuer ?? issuerDraft) }, { kind: "box", title: "Cliente", lines: partyLines(inv.customer) });
  blocks.push({
    kind: "table",
    columns: [{ title: "Concepto", width: 40 }, { title: "Cant.", width: 8, align: "right" }, { title: "Base imponible", width: 18, align: "right" }, { title: "IVA", width: 12, align: "right" }, { title: "Cuota", width: 22, align: "right" }],
    rows: inv.lines.map((l) => [l.concept, String(l.quantity), money(l.baseCents, inv.currency), pct(l.taxRateBp), money(l.taxCents, inv.currency)]),
    totals: ["Total", "", money(inv.baseCents, inv.currency), "", money(inv.totalCents, inv.currency)],
  });
  blocks.push({ kind: "keyValue", rows: [["Base imponible", money(inv.baseCents, inv.currency)], ["Cuota de IVA", money(inv.taxCents, inv.currency)], ["Total", money(inv.totalCents, inv.currency)]] });
  const paid = inv.paymentStatus === "paid";
  blocks.push({ kind: "paragraph", muted: true, text: [proforma ? "Cobro previsto mediante el método de pago autorizado en Stripe." : paid ? `Cobrada${inv.paymentRef?.startsWith("stripe:") ? " mediante Stripe" : ""}.` : "Pendiente de cobro.", inv.notes ?? ""].filter(Boolean).join(" ") });
  return blocks;
}

export async function renderInvoicePdf(inv: Invoice, issuerDraft: FiscalParty, o: { proforma?: boolean; logoPng?: Uint8Array | null } = {}): Promise<Uint8Array> {
  const { renderBrandPdf } = await import("../documents/brandPdf");
  const iss = inv.issuer ?? issuerDraft;
  const issuer: BrandIssuer = { legalName: iss.legalName, taxId: iss.taxId, address: `${iss.address}, ${iss.postalCode} ${iss.city}` };
  const proforma = !!o.proforma || inv.status === "draft";
  return renderBrandPdf({ title: proforma ? `Proforma · ${inv.periodLabel ?? inv.operationDate}` : `Factura ${inv.number}`, issuer, logoPng: o.logoPng ?? null, footerNote: proforma ? PROFORMA_LEGEND : `Factura ${inv.number} · huella ${inv.hash?.slice(0, 16) ?? "—"}`, blocks: invoicePdfBlocks(inv, issuerDraft, { proforma }) });
}

const concept = (inv: Invoice) => inv.lines[0]?.concept ?? inv.periodLabel ?? "Servicio";

export function invoiceMail(inv: Invoice, supportEmail: string | null): MailContent {
  return renderEmail(platformBrand(supportEmail), {
    family: "transactional",
    eyebrow: "Factura",
    hero: "pago",
    title: `Tu factura ${inv.number}`,
    subject: `Factura ${inv.number} de Big Elephant`,
    intro: ["Adjuntamos la factura correspondiente a tu servicio. Gracias por confiar en Big Elephant."],
    blocks: [{ card: { status: inv.paymentStatus === "paid" ? { label: "Cobrada", tone: "success" } : { label: "Pendiente de cobro", tone: "warning" }, rows: [{ label: "Número", value: inv.number ?? "—" }, { label: "Concepto", value: concept(inv) }, { label: "Fecha de expedición", value: date(inv.issueDate) }, { label: "Base imponible", value: fmt.money(inv.baseCents, inv.currency) }, { label: "IVA", value: fmt.money(inv.taxCents, inv.currency) }], total: { label: "Total", value: fmt.money(inv.totalCents, inv.currency) } } }, { p: "La factura en PDF va adjunta a este correo." }],
  });
}

export function proformaMail(inv: Invoice, supportEmail: string | null): MailContent {
  return renderEmail(platformBrand(supportEmail), {
    family: "transactional",
    eyebrow: "Proforma",
    hero: "calendario",
    title: "Tu próximo cargo",
    subject: `Proforma de ${inv.periodLabel ?? "tu próximo cargo"} · Big Elephant`,
    intro: [`Te enviamos la proforma del próximo cargo de tu servicio, que se cobrará el ${date(inv.operationDate)} con tu método de pago autorizado.`],
    blocks: [{ card: { status: { label: "Programado", tone: "info" }, rows: [{ label: "Concepto", value: concept(inv) }, { label: "Base imponible", value: fmt.money(inv.baseCents, inv.currency) }, { label: "IVA", value: fmt.money(inv.taxCents, inv.currency) }], total: { label: "Total", value: fmt.money(inv.totalCents, inv.currency) }, foot: { label: "Fecha del cargo", value: date(inv.operationDate) } } }, { notice: { tone: "info", text: `${PROFORMA_LEGEND}: la factura definitiva te llegará cuando se confirme el cobro.` } }],
  });
}

export interface DeliveryDeps {
  /** Encola en la bandeja de salida de plataforma (idempotente por clave; reintenta la entrega). */
  send(i: { key: string; category: MailCategory; to: string; content: MailContent; attachments: MailAttachment[] }): Promise<{ status: string; duplicate: boolean }>;
  /** Correo de facturación del cliente (el de la ficha fiscal o el contacto principal). */
  recipient(inv: Invoice): Promise<string | null>;
  issuer: FiscalParty;
  supportEmail: string | null;
  logo?: () => Promise<Uint8Array | null>;
}

/** Lectura de la factura de Stripe para contrastar el cobro (solo lectura). */
export type StripeInvoiceCheck = (stripeInvoiceId: string) => Promise<{ status: string; amountPaid: number; currency: string } | null>;

export interface InvoicingAutomationDeps {
  svc: Pick<InvoicingService, "issue" | "readiness">;
  store: Pick<InvoicingStore, "list">;
  issueEnabled: boolean;
  delivery: DeliveryDeps | null;
  stripeInvoice?: StripeInvoiceCheck | null;
  timezone?: string;
  now?: () => number;
}

export interface IssueReport {
  issued: Array<{ id: number; number: string | null; totalCents: number; delivery: string }>;
  waiting: number;
  blocked: Array<{ id: number; reason: string }>;
}

export class InvoicingAutomation {
  private readonly now: () => number;
  /** Claves ya encoladas en este proceso (evita rehacer el PDF en cada pasada; la bandeja deduplica igualmente). */
  private readonly done = new Set<string>();
  constructor(private readonly d: InvoicingAutomationDeps) {
    this.now = d.now ?? Date.now;
  }

  private today() {
    return ymd(this.now(), this.d.timezone ?? "Europe/Madrid");
  }

  private async deliver(inv: Invoice, proforma: boolean): Promise<string> {
    const dl = this.d.delivery;
    if (!dl) return "sin correo";
    const key = proforma ? `invoicing:proforma:${inv.sourceKey}:${inv.totalCents}` : `invoicing:invoice:${inv.id}:${inv.number}`;
    if (this.done.has(key)) return "ya enviada";
    const to = await dl.recipient(inv);
    if (!to) return "sin correo de facturación";
    const pdf = await renderInvoicePdf(inv, dl.issuer, { proforma, logoPng: dl.logo ? await dl.logo().catch(() => null) : null });
    const r = await dl.send({ key: key.slice(0, 160), category: proforma ? "quote_sent" : "invoice_available", to, content: proforma ? proformaMail(inv, dl.supportEmail) : invoiceMail(inv, dl.supportEmail), attachments: [{ name: documentName(inv, proforma), url: "", content: Buffer.from(pdf).toString("base64") }] });
    if (r.status !== "failed") this.done.add(key);
    return r.duplicate ? "ya enviada" : r.status;
  }

  /** Proformas de los borradores de periodos FUTUROS (nunca retroactivas). */
  async sendProformas(): Promise<{ sent: number; skipped: Array<{ id: number; reason: string }> }> {
    const today = this.today();
    const out = { sent: 0, skipped: [] as Array<{ id: number; reason: string }> };
    for (const inv of await this.d.store.list({ status: "draft", limit: 500 })) {
      if (inv.kind !== "invoice" || inv.operationDate <= today || inv.paymentStatus === "paid") continue;
      if (!inv.customer) {
        out.skipped.push({ id: inv.id, reason: "faltan los datos fiscales del cliente" });
        continue;
      }
      const st = await this.deliver(inv, true);
      if (st === "pending" || st === "sent") out.sent++;
      else if (st !== "ya enviada") out.skipped.push({ id: inv.id, reason: st });
    }
    return out;
  }

  /** Expide los borradores devengados y cobrados (contrastados con Stripe) o vencido el plazo a crédito, y los envía. */
  async issueDue(): Promise<IssueReport> {
    const rep: IssueReport = { issued: [], waiting: 0, blocked: [] };
    const today = this.today();
    if (!this.d.issueEnabled) return rep;
    for (const inv of await this.d.store.list({ status: "draft", limit: 500 })) {
      if (inv.kind !== "invoice" || inv.operationDate > today) continue;
      const paid = inv.paymentStatus === "paid";
      // A crédito solo con un intento de cobro fallido (impago de un servicio prestado); sin ningún intento, puede ser
      // una baja posterior a la proforma: lo decide una persona
      if (!paid && (inv.paymentStatus !== "failed" || today < creditIssueDate(inv.operationDate))) {
        if (inv.paymentStatus === "pending" && today >= creditIssueDate(inv.operationDate)) rep.blocked.push({ id: inv.id, reason: "sin cobro ni intento de cobro: revisar si el servicio se prestó antes de expedir" });
        else rep.waiting++;
        continue;
      }
      if (paid && inv.paymentRef?.startsWith("stripe:in:")) {
        const id = inv.paymentRef.slice("stripe:in:".length);
        const s = this.d.stripeInvoice ? await this.d.stripeInvoice(id).catch(() => null) : null;
        if (!s) {
          rep.blocked.push({ id: inv.id, reason: `no se pudo contrastar el cobro ${id} con Stripe` });
          continue;
        }
        if (s.status !== "paid" || s.amountPaid !== inv.totalCents || s.currency.toUpperCase() !== inv.currency.toUpperCase()) {
          rep.blocked.push({ id: inv.id, reason: `el cobro de Stripe ${id} no casa con la factura (${s.status}, ${s.amountPaid} ${s.currency.toUpperCase()} frente a ${inv.totalCents} ${inv.currency})` });
          continue;
        }
      }
      const { problems } = await this.d.svc.readiness(inv.id);
      if (problems.length) {
        rep.blocked.push({ id: inv.id, reason: problems.join("; ") });
        continue;
      }
      const issued = await this.d.svc.issue(inv.id, INVOICING_ACTOR);
      const delivery = await this.deliver(issued, false).catch((e) => `error: ${e instanceof Error ? e.message.slice(0, 120) : "envío"}`);
      rep.issued.push({ id: issued.id, number: issued.number, totalCents: issued.totalCents, delivery });
    }
    return rep;
  }

  /** Reintenta encolar el envío de las facturas expedidas recientes (si un encolado falló); idempotente. */
  async redeliver(): Promise<number> {
    if (!this.d.delivery) return 0;
    const from = ymd(this.now() - REDELIVER_DAYS * 86_400_000, this.d.timezone ?? "Europe/Madrid");
    let n = 0;
    for (const inv of await this.d.store.list({ status: "issued", limit: 500 })) {
      if (inv.kind !== "invoice" || !inv.issueDate || inv.issueDate < from || !inv.number) continue;
      const st = await this.deliver(inv, false).catch(() => "error");
      if (st === "pending" || st === "sent") n++;
    }
    return n;
  }

  /** Envía (o reenvía, idempotente) una factura expedida concreta. */
  sendIssued(inv: Invoice) {
    return this.deliver(inv, false);
  }
}
